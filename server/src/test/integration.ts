import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { callTool, text, storageDir } from './helpers.js';

const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, '.test-project-'));

let client: Client;
let transport: StdioClientTransport;

describe('session-memory MCP server', () => {
  before(async () => {
    transport = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(import.meta.dirname, '..', 'index.js')],
      cwd: tmpDir,
    });
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);
  });

  after(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(storageDir(tmpDir), { recursive: true, force: true });
  });

  test('lists all 7 tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'get_session_context',
      'list_investigations',
      'log_attempt',
      'log_decision',
      'resolve_investigation',
      'search_decisions',
      'start_investigation',
    ]);
  });

  test('log_decision records a decision', async () => {
    const result = text(await callTool(client, 'log_decision', {
      topic: 'Database choice',
      options: [
        { name: 'SQLite', description: 'Simple, file-based' },
        { name: 'PostgreSQL', description: 'Full-featured relational' },
      ],
      chosen: 'SQLite',
      rationale: 'Single server, no external dependencies needed',
      tags: ['database', 'architecture'],
    }));
    assert.match(result, /Decision logged.*Database choice.*SQLite/);
  });

  test('search_decisions finds the logged decision', async () => {
    const result = text(await callTool(client, 'search_decisions', { query: 'database' }));
    assert.match(result, /Database choice/);
    assert.match(result, /SQLite/);
  });

  test('search_decisions by tags', async () => {
    const result = text(await callTool(client, 'search_decisions', { tags: ['architecture'] }));
    assert.match(result, /Database choice/);
  });

  test('search_decisions returns empty for non-match', async () => {
    const result = text(await callTool(client, 'search_decisions', { query: 'nonexistent-xyzzy' }));
    assert.match(result, /No matching decisions/);
  });

  let investigationId: string;

  test('start_investigation creates an investigation', async () => {
    const result = text(await callTool(client, 'start_investigation', {
      problem: 'Auth tests failing with 401',
    }));
    assert.match(result, /Investigation started.*Auth tests failing/);
    investigationId = result.match(/ID: (.+)/)![1];
  });

  test('log_attempt records a failed approach', async () => {
    const result = text(await callTool(client, 'log_attempt', {
      investigation_id: investigationId,
      approach: 'Mock the auth middleware',
      outcome: 'failed',
      details: 'Tests passed but did not catch the real bug',
    }));
    assert.match(result, /FAILED.*Mock the auth middleware/);
  });

  test('log_attempt records a successful approach', async () => {
    const result = text(await callTool(client, 'log_attempt', {
      investigation_id: investigationId,
      approach: 'Use real auth flow with test database',
      outcome: 'succeeded',
      details: 'Found the token validation was checking wrong claim',
    }));
    assert.match(result, /SUCCEEDED.*Use real auth flow/);
  });

  test('log_attempt rejects invalid investigation_id', async () => {
    const result = await callTool(client, 'log_attempt', {
      investigation_id: 'nonexistent-id',
      approach: 'Whatever',
      outcome: 'failed',
      details: 'Should not work',
    });
    assert.ok(result.isError);
    assert.match(text(result), /not found/);
  });

  test('resolve_investigation marks it resolved', async () => {
    const result = text(await callTool(client, 'resolve_investigation', {
      investigation_id: investigationId,
      resolution: 'Token validation was checking sub claim instead of user_id. Fixed in auth.ts.',
    }));
    assert.match(result, /resolved.*Auth tests failing/);
    assert.match(result, /2.*1 failed/);
  });

  test('resolve_investigation rejects invalid id', async () => {
    const result = await callTool(client, 'resolve_investigation', {
      investigation_id: 'nonexistent',
      resolution: 'whatever',
    });
    assert.ok(result.isError);
  });

  test('get_session_context returns full session state', async () => {
    const result = text(await callTool(client, 'get_session_context'));
    assert.match(result, /RESOLVED.*Auth tests failing/);
    assert.match(result, /FAILED.*Mock the auth middleware/);
    assert.match(result, /SUCCEEDED.*Use real auth flow/);
    assert.match(result, /RESOLUTION.*Token validation/);
    assert.match(result, /Database choice.*SQLite/);
  });

  test('log a second decision for search variety', async () => {
    const result = text(await callTool(client, 'log_decision', {
      topic: 'Auth token format',
      options: [
        { name: 'JWT', description: 'Stateless, self-contained' },
        { name: 'Opaque token', description: 'Server-side lookup' },
      ],
      chosen: 'Opaque token',
      rationale: 'No need for stateless verification, simpler',
      tags: ['auth', 'architecture'],
    }));
    assert.match(result, /Decision logged/);
  });

  test('search_decisions finds multiple results', async () => {
    const result = text(await callTool(client, 'search_decisions', { tags: ['architecture'] }));
    assert.match(result, /Found 2 decision/);
  });
});
