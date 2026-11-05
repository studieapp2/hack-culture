/** Cursor expands these paths locally; no server credentials enter the browser. */
export function cursorMcpConfiguration(): string {
  return JSON.stringify({
    mcpServers: {
      patchpilot: {
        type: 'stdio',
        command: 'node',
        args: ['${workspaceFolder}/build/mcp/index.js'],
        env: { DOTENV_CONFIG_PATH: '${workspaceFolder}/.env' },
      },
    },
  }, null, 2);
}
