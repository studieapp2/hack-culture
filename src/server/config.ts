import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  appUrl: string;
  tavilyApiKey?: string;
  bifrostBaseUrl?: string;
  bifrostApiKey?: string;
  bifrostModel: string;
  bifrostFallbackModel?: string;
  maxModelCallsPerRun: number;
  maxTavilySearchesPerRun: number;
  maxTokensPerRun: number;
  maxCostPerRunUsd: number;
  requestTimeoutMs: number;
  isProduction: boolean;
  bifrostInputUsdPerMillion?: number;
  bifrostOutputUsdPerMillion?: number;
  tavilyUsdPerCredit?: number;
}

export function loadConfig(): ServerConfig {
  const positiveNumber = (name: string, fallback: number, integer = false) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 && (!integer || Number.isInteger(value)) ? value : fallback;
  };
  const optionalRate = (name: string) => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  return {
    appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || '3000'}`,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || undefined,
    bifrostBaseUrl: process.env.BIFROST_BASE_URL?.trim() || undefined,
    bifrostApiKey: process.env.BIFROST_API_KEY?.trim() || undefined,
    bifrostModel: process.env.BIFROST_MODEL?.trim() || 'default',
    bifrostFallbackModel: process.env.BIFROST_FALLBACK_MODEL?.trim() || undefined,
    maxModelCallsPerRun: positiveNumber('MAX_MODEL_CALLS_PER_RUN', 4, true),
    maxTavilySearchesPerRun: positiveNumber('MAX_TAVILY_SEARCHES_PER_RUN', 3, true),
    maxTokensPerRun: positiveNumber('MAX_TOKENS_PER_RUN', 15000, true),
    maxCostPerRunUsd: positiveNumber('MAX_COST_PER_RUN_USD', 0.50),
    requestTimeoutMs: positiveNumber('REQUEST_TIMEOUT_MS', 30000, true),
    isProduction: process.env.NODE_ENV === 'production',
    bifrostInputUsdPerMillion: optionalRate('BIFROST_INPUT_USD_PER_MILLION'),
    bifrostOutputUsdPerMillion: optionalRate('BIFROST_OUTPUT_USD_PER_MILLION'),
    tavilyUsdPerCredit: optionalRate('TAVILY_USD_PER_CREDIT')
  };
}

export interface IntegrationHealth {
  configured: boolean;
  status: 'configured' | 'connected_and_verified' | 'disconnected' | 'missing_configuration' | 'provider_error';
  details?: string;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unconfigured';
  timestamp: string;
  version: string;
  integrations: {
    tavily: IntegrationHealth;
    bifrost: IntegrationHealth;
  };
  budgets: {
    maxTokensPerRun: number;
    maxCostPerRunUsd: number;
    maxModelCallsPerRun: number;
    maxSearchesPerRun: number;
  };
}

export const serverConfig = loadConfig();
