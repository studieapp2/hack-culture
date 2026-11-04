import { serverConfig, IntegrationHealth } from '../config';
import { VerifiedSource } from '../types';

export interface TavilySearchOptions {
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
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
  private readonly MAX_CACHE_ENTRIES = 200;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // Test search connectivity with an authoritative query
      const resp = await fetch('https://api.tavily.com/search', {
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
    } finally {
      clearTimeout(timeout);
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
      .replace(/\b(?:sk-|tvly-)[a-zA-Z0-9_-]{8,}\b/g, '[redacted]')
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
    const cacheKey = JSON.stringify([cleanQuery, options.searchDepth || 'basic',
      options.maxResults || 3, options.includeDomains || [], options.excludeDomains || []]);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const maxResults = Math.max(1, Math.min(options.maxResults || 3, 20));
    const controller = new AbortController();
    const requestTimeout = Math.min(options.timeoutMs ?? serverConfig.requestTimeoutMs, serverConfig.requestTimeoutMs);
    if (requestTimeout <= 0) throw new Error('The run deadline was reached before documentation retrieval.');
    const timeout = setTimeout(() => controller.abort(), requestTimeout);

    try {
      const response = await fetch('https://api.tavily.com/search', {
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
        throw new Error(`Tavily search request failed with status ${response.status}.`);
      }

      const data = (await response.json()) as TavilyRawResponse;
      const retrievedAt = new Date().toISOString();

      if (!Array.isArray(data.results)) throw new Error('Tavily returned an invalid search response.');
      const sources: VerifiedSource[] = data.results.filter((r) => {
        try { return ['http:', 'https:'].includes(new URL(r.url).protocol); } catch { return false; }
      }).map((r, index) => {
        let publisher = 'External Reference';
        try {
          const parsed = new URL(r.url);
          publisher = parsed.hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }

        return {
          id: `tavily-src-${Date.now()}-${index}`,
          title: typeof r.title === 'string' ? r.title : 'Technical Reference',
          url: r.url,
          publisher,
          publishedAt: r.published_date,
          retrievedAt,
          excerpt: typeof r.content === 'string' ? r.content.slice(0, 600).trim() : '',
          score: r.score
        };
      });

      for (const [key, value] of this.cache) {
        if (Date.now() - value.timestamp >= this.CACHE_TTL_MS) this.cache.delete(key);
      }
      if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
        this.cache.delete(this.cache.keys().next().value!);
      }
      this.cache.set(cacheKey, { data: sources, timestamp: Date.now() });
      return sources;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Tavily search timed out after ${requestTimeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
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
      const response = await fetch('https://api.tavily.com/extract', {
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
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const tavilyService = new TavilyService();
