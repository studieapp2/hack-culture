import { serverConfig, IntegrationHealth } from '../config';
import { VerifiedSource } from '../types';
import { RunBudget } from './runBudget';
import { ProviderError } from './providerError';
import { containsCredentials, redactProviderSecrets } from './sensitiveData';

export interface TavilySearchOptions {
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
  bypassCache?: boolean;
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
  usage?: { credits?: number };
}

export interface TavilyRawExtractResult {
  url: string;
  raw_content: string;
}

export interface TavilyRawExtractResponse {
  results: TavilyRawExtractResult[];
  failed_results: Array<{ url: string; error: string }>;
  usage?: { credits?: number };
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
      const data = await resp.json();
      if (!Array.isArray(data?.results)) {
        return { configured: true, status: 'provider_error', error: 'Tavily returned an invalid search response.' };
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
        error: err?.name === 'AbortError' ? 'Tavily health check timed out.' : 'Could not reach a valid Tavily search endpoint.'
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
    options: TavilySearchOptions = {},
    budget?: RunBudget
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
    if (!options.bypassCache && cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data.map((source) => ({ ...source }));
    }

    const maxResults = Math.max(1, Math.min(options.maxResults || 3, 20));
    const controller = new AbortController();
    const requestTimeout = Math.min(options.timeoutMs ?? serverConfig.requestTimeoutMs, serverConfig.requestTimeoutMs);
    if (requestTimeout <= 0) throw new Error('The run deadline was reached before documentation retrieval.');
    const timeout = setTimeout(() => controller.abort(), requestTimeout);

    try {
      if (budget) budget.searchRequests++;
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
          exclude_domains: options.excludeDomains,
          include_usage: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          throw new ProviderError('tavily', 'PROVIDER_ERROR', 'Tavily API rate limit reached. Please wait before retrying.', 429);
        }
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError('tavily', 'PROVIDER_ERROR', 'Tavily authorization failed. Please check your TAVILY_API_KEY.', response.status);
        }
        throw new ProviderError('tavily', 'PROVIDER_ERROR', `Tavily search request failed with status ${response.status}.`, response.status);
      }

      const data = (await response.json()) as TavilyRawResponse;
      if (budget && typeof data?.usage?.credits === 'number' &&
        Number.isFinite(data.usage.credits) && data.usage.credits >= 0) {
        budget.searchCredits += data.usage.credits;
        budget.searchUsageReports++;
      }
      const retrievedAt = new Date().toISOString();

      if (!Array.isArray(data?.results)) throw new ProviderError('tavily', 'INVALID_PROVIDER_RESPONSE', 'Tavily returned an invalid search response.', undefined, false);
      const sources: VerifiedSource[] = data.results.filter((r) => {
        try {
          if (typeof r?.url !== 'string') return false;
          const url = new URL(r.url);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
            !containsCredentials(r.url);
        } catch { return false; }
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
          title: typeof r.title === 'string' ? redactProviderSecrets(r.title) : 'Technical Reference',
          url: r.url,
          publisher,
          publishedAt: typeof r.published_date === 'string' && Number.isFinite(Date.parse(r.published_date))
            ? r.published_date : undefined,
          retrievedAt,
          excerpt: typeof r.content === 'string' ? redactProviderSecrets(r.content.slice(0, 600).trim()) : '',
          score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : undefined
        };
      });

      for (const [key, value] of this.cache) {
        if (Date.now() - value.timestamp >= this.CACHE_TTL_MS) this.cache.delete(key);
      }
      if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
        this.cache.delete(this.cache.keys().next().value!);
      }
      this.cache.set(cacheKey, { data: sources, timestamp: Date.now() });
      return sources.map((source) => ({ ...source }));
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      if (controller.signal.aborted) throw new ProviderError('tavily', 'TIMEOUT', `Tavily search timed out after ${requestTimeout}ms`);
      if (err instanceof SyntaxError) throw new ProviderError('tavily', 'INVALID_PROVIDER_RESPONSE', 'Tavily returned unreadable JSON.', undefined, false);
      throw new ProviderError('tavily', 'PROVIDER_ERROR', 'Could not reach the Tavily search service.');
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extracts page content for verification using Tavily Extract API
   */
  public async extractSources(
    urls: string[],
    options: { strict?: boolean; timeoutMs?: number; budget?: RunBudget } = {}
  ): Promise<Map<string, string>> {
    if (!this.isConfigured()) {
      throw new Error('TAVILY_API_KEY is not configured on the server.');
    }

    const validUrls = Array.from(new Set(urls)).filter((u) => {
      try {
        const parsed = new URL(u);
        return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    });

    if (validUrls.length === 0) {
      return new Map();
    }

    const controller = new AbortController();
    const requestTimeout = Math.min(options.timeoutMs ?? serverConfig.requestTimeoutMs, serverConfig.requestTimeoutMs);
    if (requestTimeout <= 0) throw new ProviderError('tavily', 'TIMEOUT', 'The run deadline was reached before extraction.');
    const timeout = setTimeout(() => controller.abort(), requestTimeout);
    const requestedUrls = validUrls.slice(0, options.strict ? 2 : 3);

    try {
      if (options.budget) options.budget.extractionRequests++;
      const response = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          urls: requestedUrls,
          extract_depth: 'basic',
          include_usage: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError('tavily', 'PROVIDER_ERROR', `Tavily extract failed with status ${response.status}`, response.status);
      }

      const data = (await response.json()) as TavilyRawExtractResponse;
      if (!Array.isArray(data?.results)) throw new ProviderError('tavily', 'INVALID_PROVIDER_RESPONSE', 'Tavily returned an invalid extract response.', undefined, false);
      if (options.budget && typeof data.usage?.credits === 'number' &&
        Number.isFinite(data.usage.credits) && data.usage.credits >= 0) {
        options.budget.extractionCredits += data.usage.credits;
        options.budget.extractionUsageReports++;
      }
      const resultMap = new Map<string, string>();

      for (const item of data.results || []) {
        if (requestedUrls.includes(item?.url) && typeof item.raw_content === 'string' && item.raw_content.trim()) {
          resultMap.set(item.url, redactProviderSecrets(item.raw_content.slice(0, 3000)));
        }
      }

      return resultMap;
    } catch (err: any) {
      if (options.strict) {
        if (err instanceof ProviderError) throw err;
        if (controller.signal.aborted) throw new ProviderError('tavily', 'TIMEOUT', 'Tavily extraction timed out.');
        if (err instanceof SyntaxError) throw new ProviderError('tavily', 'INVALID_PROVIDER_RESPONSE', 'Tavily returned unreadable extract JSON.', undefined, false);
        throw new ProviderError('tavily', 'PROVIDER_ERROR', 'Could not reach the Tavily extraction service.');
      }
      console.warn('Tavily extraction unavailable; no extracted content was returned.');
      return new Map();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const tavilyService = new TavilyService();
