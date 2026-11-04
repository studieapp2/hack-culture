import { serverConfig, IntegrationHealth } from '../config';
import { VerifiedSource } from '../types';

export interface TavilySearchOptions {
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface TavilyRawSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

export interface TavilyRawResponse {
  results: TavilyRawSearchResult[];
  query: string;
}

export interface TavilyRawExtractResult {
  url: string;
  raw_content: string;
}

export interface TavilyRawExtractResponse {
  results: TavilyRawExtractResult[];
  failed_results: Array<{ url: string; error: string }>;
}

export class TavilyService {
  private cache = new Map<string, { data: VerifiedSource[]; timestamp: number }>();
  private readonly CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes cache

  private get apiKey(): string | undefined {
    return serverConfig.tavilyApiKey;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  public async checkHealth(): Promise<IntegrationHealth> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        status: 'missing_configuration',
        details: 'TAVILY_API_KEY is not set in server environment.'
      };
    }

    try {
      // Test search connectivity with an authoritative query
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch('https://api.tavily.com/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: 'Python official documentation',
          search_depth: 'basic',
          max_results: 1
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (resp.status === 401 || resp.status === 403) {
        return {
          configured: true,
          status: 'provider_error',
          error: 'Tavily returned 401/403 Invalid API Key.'
        };
      }

      if (resp.status === 429) {
        return {
          configured: true,
          status: 'provider_error',
          error: 'Tavily rate limit exceeded.'
        };
      }

      if (!resp.ok) {
        return {
          configured: true,
          status: 'provider_error',
          error: `Tavily API responded with status ${resp.status}`
        };
      }

      return {
        configured: true,
        status: 'connected_and_verified',
        details: 'Tavily Search API connected and authorized.'
      };
    } catch (err: any) {
      return {
        configured: true,
        status: 'disconnected',
        error: `Failed to connect to Tavily: ${err?.message || 'Network error'}`
      };
    }
  }

  /**
   * Sanitizes search queries so no proprietary code or secret tokens are leaked
   */
  public sanitizeQuery(query: string): string {
    return query
      .replace(/api[-_]?key\s*[:=]\s*['"]?[a-zA-Z0-9_\-]+['"]?/gi, '')
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, '')
      .replace(/password\s*[:=]\s*['"]?[^'"\s]+['"]?/gi, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  /**
   * Searches sources using Tavily Search API
   */
  public async searchSources(
    query: string,
    options: TavilySearchOptions = {}
  ): Promise<VerifiedSource[]> {
    if (!this.isConfigured()) {
      throw new Error(
        'TAVILY_API_KEY is not configured on the server. Live source retrieval requires a valid Tavily API key.'
      );
    }

    const cleanQuery = this.sanitizeQuery(query);
    if (!cleanQuery) {
      throw new Error('Search query cannot be empty after sanitization.');
    }

    // Check cache
    const cached = this.cache.get(cleanQuery);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const maxResults = Math.min(options.maxResults || 3, serverConfig.maxTavilySearchesPerRun);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), serverConfig.requestTimeoutMs);

    try {
      const response = await fetch('https://api.tavily.com/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: cleanQuery,
          search_depth: options.searchDepth || 'basic',
          max_results: maxResults,
          include_domains: options.includeDomains,
          exclude_domains: options.excludeDomains
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Tavily API rate limit reached. Please wait before retrying.');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('Tavily authorization failed. Please check your TAVILY_API_KEY.');
        }
        const text = await response.text();
        throw new Error(`Tavily search request failed with status ${response.status}: ${text}`);
      }

      const data = (await response.json()) as TavilyRawResponse;
      const retrievedAt = new Date().toISOString();

      const sources: VerifiedSource[] = (data.results || []).map((r, index) => {
        let publisher = 'External Reference';
        try {
          const parsed = new URL(r.url);
          publisher = parsed.hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }

        return {
          id: `tavily-src-${Date.now()}-${index}`,
          title: r.title || 'Technical Reference',
          url: r.url,
          publisher,
          publishedAt: r.published_date,
          retrievedAt,
          excerpt: (r.content || '').slice(0, 600).trim(),
          score: r.score
        };
      });

      this.cache.set(cleanQuery, { data: sources, timestamp: Date.now() });
      return sources;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Tavily search timed out after ${serverConfig.requestTimeoutMs}ms`);
      }
      throw err;
    }
  }

  /**
   * Extracts page content for verification using Tavily Extract API
   */
  public async extractSources(urls: string[]): Promise<Map<string, string>> {
    if (!this.isConfigured()) {
      throw new Error('TAVILY_API_KEY is not configured on the server.');
    }

    const validUrls = urls.filter((u) => {
      try {
        const parsed = new URL(u);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    });

    if (validUrls.length === 0) {
      return new Map();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), serverConfig.requestTimeoutMs);

    try {
      const response = await fetch('https://api.tavily.com/v1/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          urls: validUrls.slice(0, 3)
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Tavily extract failed with status ${response.status}`);
      }

      const data = (await response.json()) as TavilyRawExtractResponse;
      const resultMap = new Map<string, string>();

      for (const item of data.results || []) {
        if (item.url && item.raw_content) {
          resultMap.set(item.url, item.raw_content.slice(0, 3000));
        }
      }

      return resultMap;
    } catch (err: any) {
      console.warn('Tavily extract warning:', err?.message);
      return new Map();
    }
  }
}

export const tavilyService = new TavilyService();
