// Install safe logging before dynamically importing backend configuration:
// dotenv and future backend diagnostics must never contaminate protocol stdout.
console.log = () => { process.stderr.write('PatchPilot: diagnostic output suppressed.\n'); };
console.info = console.log;
console.debug = console.log;
console.warn = console.log;
console.error = console.log;

async function main() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { createMcpServer } = await import('./server');
  const server = createMcpServer();
  // Covers valid JSON escaping/UTF-8 expansion of the 120,000-character input.
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 1_048_576 });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    // MCP owns this dedicated process; terminate outstanding provider requests.
    process.exit(0);
  };
  await server.connect(transport);
  transport.onclose = () => { void close(); };
  process.stdin.once('end', () => { void close(); });
  process.stdin.once('error', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}

main().catch(() => {
  process.stderr.write('PatchPilot MCP startup failed; check installation and backend configuration.\n');
  process.exitCode = 1;
});
