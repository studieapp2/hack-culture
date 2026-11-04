import { z } from 'zod';

// This is an MCP boundary, not a replacement for the backend contract.
export const diagnosisInput = z.object({
  error: z.string().min(1).max(16_384).refine(value => value.trim().length > 0),
  code: z.string().min(1).max(131_072).refine(value => value.trim().length > 0),
  fileName: z.string().min(1).max(256).regex(/^[^\r\n\0]+$/).optional(),
  language: z.string().min(1).max(64).regex(/^[^\r\n\0]+$/).optional(),
}).strict();

export type DiagnosisInput = z.infer<typeof diagnosisInput>;
