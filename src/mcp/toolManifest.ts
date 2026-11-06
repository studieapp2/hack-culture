// Pure metadata shared by the transport and Connect page. No server imports.
export const codeTools = [
  {
    name: 'diagnose_api_error',
    title: 'Diagnose an API/SDK error',
    description: 'Analyze actual error and relevant code using PatchPilot. Returns backend evidence and an optional unexecuted patch. Never edits files. Host agent must request human review before consequential changes. Supplied code is sent to configured backend providers; do not submit secrets.',
  },
  {
    name: 'propose_verified_patch',
    title: 'Propose an evidence-backed patch',
    description: 'Ask the existing strict PatchPilot engine for a minimal pending patch for actual error and code. A patch may be absent when evidence is insufficient or no change is supported. Returns the original engine diagnosis, evidence, usage and safety flags. Never executes code or applies edits; human review is required.',
  },
] as const;
export const verificationTool = {
  name: 'verify_technical_claims',
  title: 'Verify technical claims',
  description: 'Send technical text to the existing local PatchPilot backend verification pipeline. Returns its exact ServerRun with original claims, sources, status and usage, and records the run in backend history. Unverified claims remain uncertain. Token counters are measured only when usage.isMeasured is true; cost is an estimate, not an invoice. Do not submit secrets or private source code.',
} as const;
export const mcpTools = [...codeTools, verificationTool] as const;
