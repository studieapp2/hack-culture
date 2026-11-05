import React, { useState } from 'react';
import { Plug, Copy, Check, RefreshCw, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { apiClient } from '../services/apiClient';
import { cursorMcpConfiguration } from '../services/mcpSetup';

export function Connect() {
  const [probe, setProbe] = useState<'idle' | 'checking' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const configuration = cursorMcpConfiguration();

  const checkBackend = async () => {
    setProbe('checking');
    setError('');
    try {
      await apiClient.getReadiness();
      setProbe('ready');
    } catch (cause) {
      setProbe('error');
      setError(cause instanceof Error ? cause.message : 'Backend connection failed.');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(configuration);
      setCopyState('copied');
    } catch { setCopyState('error'); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title="Connect" breadcrumb="Editor integration"
        subtitle="Use PatchPilot inside your coding agent. Start with the local stdio server; no source files are changed by its tool." />

      <section className="bg-white rounded-xl border border-[#E3EAE6] p-5 space-y-4">
        <div className="flex items-center gap-2 text-[#17201D]">
          <Plug className="w-5 h-5 text-[#08775E]" />
          <h2 className="font-semibold">Connection checks</h2>
        </div>
        <dl className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-[#66736F]">Dashboard backend</dt>
            <dd role="status" className="font-medium mt-1">
              {probe === 'ready' ? 'Backend reachable' : probe === 'checking' ? 'Checking…'
                : probe === 'error' ? 'Connection failed' : 'Not checked'}
            </dd>
          </div>
          <div><dt className="text-[#66736F]">Cursor / Codex / Claude Code</dt>
            <dd className="font-medium mt-1">Editor discovery not verified</dd>
          </div>
        </dl>
        <button onClick={checkBackend} disabled={probe === 'checking'}
          className="inline-flex items-center gap-2 rounded-lg border border-[#E3EAE6] px-3 py-2 text-xs font-medium hover:bg-[#F8FAF9] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${probe === 'checking' ? 'animate-spin' : ''}`} />
          Check backend
        </button>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <p className="text-xs text-[#66736F]">
          This readiness check makes no model or search requests. A reachable backend does not prove
          that an editor is connected or that Bifrost/Tavily generation succeeds.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-[#E3EAE6] p-5 space-y-4">
        <h2 className="font-semibold text-[#17201D]">1. Build on the computer running your editor</h2>
        <p className="text-sm text-[#66736F]">
          Use this repository with Node 20.19+ or 22.12+ and Bun 1.4.0.
          A remote dashboard cannot start a local stdio process on your computer.
        </p>
        <pre className="rounded-lg bg-[#F8FAF9] p-4 overflow-x-auto text-xs">
          <code>{'bun install --frozen-lockfile\nbun run mcp:build'}</code>
        </pre>
        <p className="text-sm text-[#66736F]">
          Keep Bifrost and Tavily credentials server-side in your private, ignored .env file.
          Never paste keys into the dashboard or commit them. The strict engine requires both
          providers and returns explicit configuration errors when they are missing.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-[#E3EAE6] p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-3">
          <h2 className="font-semibold text-[#17201D]">2. Register PatchPilot in Cursor</h2>
          <button onClick={copy} className="inline-flex items-center gap-1.5 text-xs text-[#08775E]">
            {copyState === 'copied' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Copy configuration
          </button>
        </div>
        <p className="text-sm text-[#66736F]">
          Add this entry to the project&apos;s <code>.cursor/mcp.json</code>, preserving existing servers.
          Cursor expands <code>${'{workspaceFolder}'}</code> to your local checkout.
        </p>
        <pre className="rounded-lg bg-[#F8FAF9] p-4 overflow-x-auto text-xs"><code>{configuration}</code></pre>
        <p aria-live="polite" className="text-xs text-[#66736F]">
          {copyState === 'copied' ? 'Configuration copied. This does not confirm a connection.'
            : copyState === 'error' ? 'Clipboard unavailable. Select the configuration and copy it manually.' : ''}
        </p>
      </section>

      <section className="bg-white rounded-xl border border-[#E3EAE6] p-5 space-y-3">
        <h2 className="font-semibold text-[#17201D]">3. Verify discovery, then an actual tool call</h2>
        <p className="text-sm text-[#66736F]">
          Enable the server in Cursor and confirm it discovers <code>diagnose_api_error</code>.
          Ask the agent to send an actual API/SDK error and the relevant source snippet.
          Review source links, uncertainty, usage and any pending patch. Require human review
          before consequential host-agent edits.
        </p>
        <pre className="rounded-lg bg-[#F8FAF9] p-4 overflow-x-auto text-xs">
          <code>{'bun run mcp:build\nbun run test:mcp'}</code>
        </pre>
        <p className="text-xs text-[#66736F]">
          Automated tests include protocol and missing-configuration paths. Passing them is not
          a real Cursor invocation or evidence of successful model generation.
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-[#08775E]">
          {[
            ['Cursor documentation', 'https://cursor.com/docs/mcp'],
            ['Codex documentation', 'https://developers.openai.com/codex/mcp'],
            ['Claude Code documentation', 'https://code.claude.com/docs/en/mcp'],
          ].map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1">{label}<ExternalLink className="w-3 h-3" /></a>
          ))}
        </div>
      </section>
    </div>
  );
}
