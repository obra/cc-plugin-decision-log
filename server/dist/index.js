import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Storage } from './storage.js';
import { registerTools } from './tools.js';
const sessionId = randomUUID();
const cwd = process.cwd();
const server = new McpServer({
    name: 'decision-log',
    version: '0.1.0',
});
const storage = new Storage(cwd, sessionId);
registerTools(server, storage, sessionId);
const transport = new StdioServerTransport();
await server.connect(transport);
