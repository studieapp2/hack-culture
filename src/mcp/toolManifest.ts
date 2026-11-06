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
