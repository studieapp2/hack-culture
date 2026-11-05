import type { DiagnoseApiErrorErrorCode } from '../diagnoseApiError.contract';

/** Safe provider errors carry classifications, never raw bodies or credentials. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: 'bifrost' | 'tavily',
    public readonly code: DiagnoseApiErrorErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = ['TIMEOUT', 'PROVIDER_ERROR'].includes(code) &&
      (status === undefined || status === 429 || status >= 500)
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
