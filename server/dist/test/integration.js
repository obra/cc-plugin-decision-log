import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callTool, storageDir, text } from './helpers.js';
const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, '.test-project-'));
let client;
let transport;
describe('decision-log MCP server', () => {
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
            'close_problem',
            'get_context',
            'list_problems',
            'log_approach',
            'log_decision',
            'open_problem',
            'search_decisions',
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
        const result = text(await callTool(client, 'search_decisions', {
            query: 'nonexistent-xyzzy',
        }));
        assert.match(result, /No matching decisions/);
    });
    let problemId;
    test('open_problem creates a problem', async () => {
        const result = text(await callTool(client, 'open_problem', {
            problem: 'Auth tests failing with 401',
        }));
        assert.match(result, /Problem opened.*Auth tests failing/);
        problemId = result.match(/ID: (.+)/)[1];
    });
    test('log_approach records a failed approach', async () => {
        const result = text(await callTool(client, 'log_approach', {
            problem_id: problemId,
            approach: 'Mock the auth middleware',
            outcome: 'failed',
            details: 'Tests passed but did not catch the real bug',
        }));
        assert.match(result, /FAILED.*Mock the auth middleware/);
    });
    test('log_approach records a successful approach', async () => {
        const result = text(await callTool(client, 'log_approach', {
            problem_id: problemId,
            approach: 'Use real auth flow with test database',
            outcome: 'succeeded',
            details: 'Found the token validation was checking wrong claim',
        }));
        assert.match(result, /SUCCEEDED.*Use real auth flow/);
    });
    test('log_approach rejects invalid problem_id', async () => {
        const result = await callTool(client, 'log_approach', {
            problem_id: 'nonexistent-id',
            approach: 'Whatever',
            outcome: 'failed',
            details: 'Should not work',
        });
        assert.ok(result.isError);
        assert.match(text(result), /not found/);
    });
    test('close_problem marks it resolved', async () => {
        const result = text(await callTool(client, 'close_problem', {
            problem_id: problemId,
            resolution: 'Token validation was checking sub claim instead of user_id. Fixed in auth.ts.',
        }));
        assert.match(result, /closed.*Auth tests failing/);
        assert.match(result, /2.*1 failed/);
    });
    test('close_problem rejects invalid id', async () => {
        const result = await callTool(client, 'close_problem', {
            problem_id: 'nonexistent',
            resolution: 'whatever',
        });
        assert.ok(result.isError);
    });
    test('get_context returns full session state', async () => {
        const result = text(await callTool(client, 'get_context'));
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
