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
}

export function loadConfig(): ServerConfig {
  return {
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || undefined,
    bifrostBaseUrl: process.env.BIFROST_BASE_URL?.trim() || undefined,
    bifrostApiKey: process.env.BIFROST_API_KEY?.trim() || undefined,
    bifrostModel: process.env.BIFROST_MODEL?.trim() || 'default',
    bifrostFallbackModel: process.env.BIFROST_FALLBACK_MODEL?.trim() || undefined,
    maxModelCallsPerRun: parseInt(process.env.MAX_MODEL_CALLS_PER_RUN || '4', 10),
    maxTavilySearchesPerRun: parseInt(process.env.MAX_TAVILY_SEARCHES_PER_RUN || '3', 10),
    maxTokensPerRun: parseInt(process.env.MAX_TOKENS_PER_RUN || '15000', 10),
    maxCostPerRunUsd: parseFloat(process.env.MAX_COST_PER_RUN_USD || '0.50'),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
    isProduction: process.env.NODE_ENV === 'production'
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
