/**
 * End-to-end workflow simulation:
 * Simulates a realistic debugging session where Claude is working on a project,
 * makes decisions, investigates bugs, hits compaction, and recovers context.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callTool, runHook, storageDir, text } from './helpers.js';

describe('E2E: realistic debugging session workflow', () => {
  let client: Client;
  let transport: StdioClientTransport;
  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), '.test-e2e-')),
  );

  before(async () => {
    // Clean up stale storage from prior interrupted runs
    fs.rmSync(storageDir(tmpDir), { recursive: true, force: true });
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

  // Phase 1: Early session — make architectural decisions
  test('Phase 1: Log architectural decisions', async () => {
    await callTool(client, 'log_decision', {
      topic: 'API framework',
      options: [
        { name: 'Express', description: 'Mature, large ecosystem' },
        { name: 'Fastify', description: 'Faster, schema validation built-in' },
        { name: 'Hono', description: 'Lightweight, edge-ready' },
      ],
      chosen: 'Express',
      rationale:
        'Existing codebase uses Express middleware, migration cost too high',
      tags: ['architecture', 'api'],
    });

    await callTool(client, 'log_decision', {
      topic: 'Session storage',
      options: [
        { name: 'Redis', description: 'Fast, distributed' },
        { name: 'SQLite', description: 'Zero-dependency, file-based' },
      ],
      chosen: 'SQLite',
      rationale:
        'Single server deployment, no Redis infra needed, already using better-sqlite3',
      tags: ['architecture', 'storage'],
    });

    const ctx = text(await callTool(client, 'get_context'));
    assert.match(ctx, /API framework.*Express/);
    assert.match(ctx, /Session storage.*SQLite/);
  });

  // Phase 2: Hit a bug, investigate
  let authProblemId: string;
  test('Phase 2: Start investigating auth bug', async () => {
    const result = text(
      await callTool(client, 'open_problem', {
        problem: 'Login endpoint returns 500 after session middleware added',
      }),
    );
    authProblemId = result.match(/ID: (.+)/)![1];

    // First approach: check middleware order
    await callTool(client, 'log_approach', {
      problem_id: authProblemId,
      approach: 'Reorder middleware — move session before auth',
      outcome: 'failed',
      details: 'Same 500 error. Stack trace points to session.save() callback',
    });

    // Second approach: check SQLite config
    await callTool(client, 'log_approach', {
      problem_id: authProblemId,
      approach: 'Check SQLite WAL mode and connection pooling',
      outcome: 'failed',
      details: 'WAL mode enabled, single connection — not a concurrency issue',
    });
  });

  // Phase 3: Second bug appears while investigating first
  let cssProblemId: string;
  test('Phase 3: Second bug appears, open parallel problem', async () => {
    const result = text(
      await callTool(client, 'open_problem', {
        problem: 'Dashboard layout broken after Tailwind upgrade to v4',
      }),
    );
    cssProblemId = result.match(/ID: (.+)/)![1];

    await callTool(client, 'log_approach', {
      problem_id: cssProblemId,
      approach: 'Replace deprecated @apply directives',
      outcome: 'succeeded',
      details: 'Tailwind v4 changed @apply syntax. Replaced 12 occurrences.',
    });

    await callTool(client, 'close_problem', {
      problem_id: cssProblemId,
      resolution:
        'Tailwind v4 @apply syntax changed — find-and-replace across 4 files',
    });
  });

  // Phase 4: Continue auth problem
  test('Phase 4: Resolve auth bug', async () => {
    await callTool(client, 'log_approach', {
      problem_id: authProblemId,
      approach: 'Add error handler to session.save() callback',
      outcome: 'succeeded',
      details:
        'Session store was throwing because sessions table schema was wrong — missing expires column',
    });

    await callTool(client, 'close_problem', {
      problem_id: authProblemId,
      resolution:
        'Sessions table missing expires column. Migration was incomplete.',
    });
  });

  // Phase 5: Compaction event — verify the PreCompact hook captures everything
  test('Phase 5: PreCompact hook captures session state', () => {
    const output = runHook('pre-compact.sh', { cwd: tmpDir });
    const parsed = JSON.parse(output);
    const msg = parsed.systemMessage;

    // Header
    assert.match(msg, /DECISION LOG.*preserved through compaction/);

    // Both problems should be in RESOLVED section (summarized)
    assert.match(msg, /RESOLVED PROBLEMS/);
    assert.match(msg, /Login endpoint.*Sessions table missing expires/);
    assert.match(msg, /Dashboard layout.*Tailwind v4 @apply/);
    // Auth bug had 2 failed approaches
    assert.match(msg, /2 failed approach/);

    // Decisions
    assert.match(msg, /DECISIONS THIS SESSION/);
    assert.match(msg, /API framework.*Express/);
    assert.match(msg, /Session storage.*SQLite/);

    // No open problems
    assert.doesNotMatch(msg, /OPEN PROBLEMS/);
  });

  // Phase 6: After compaction — simulate recovery with get_context
  test('Phase 6: Post-compaction recovery via get_context', async () => {
    const ctx = text(await callTool(client, 'get_context'));

    // Should still have all the data (MCP server is still running, data is on disk)
    assert.match(ctx, /RESOLVED.*Login endpoint/);
    assert.match(ctx, /FAILED.*Reorder middleware/);
    assert.match(ctx, /FAILED.*Check SQLite WAL/);
    assert.match(ctx, /SUCCEEDED.*Add error handler/);
    assert.match(ctx, /RESOLUTION.*Sessions table missing/);

    assert.match(ctx, /RESOLVED.*Dashboard layout/);
    assert.match(ctx, /SUCCEEDED.*Replace deprecated @apply/);

    assert.match(ctx, /API framework.*Express/);
    assert.match(ctx, /Session storage.*SQLite/);
  });

  // Phase 7: Verify search works across decisions
  test('Phase 7: Search decisions by different criteria', async () => {
    const archSearch = text(
      await callTool(client, 'search_decisions', { tags: ['architecture'] }),
    );
    assert.match(archSearch, /Found 2 decision/);

    const sqliteSearch = text(
      await callTool(client, 'search_decisions', { query: 'sqlite' }),
    );
    assert.match(sqliteSearch, /Session storage/);

    const apiSearch = text(
      await callTool(client, 'search_decisions', { tags: ['api'] }),
    );
    assert.match(apiSearch, /Found 1 decision/);
    assert.match(apiSearch, /API framework/);
  });

  // Phase 8: List problems with status filter
  test('Phase 8: List problems shows all resolved', async () => {
    const all = text(await callTool(client, 'list_problems', {}));
    assert.match(all, /2 problem/);

    const open = text(
      await callTool(client, 'list_problems', { status: 'open' }),
    );
    assert.match(open, /No problems found/);

    const resolved = text(
      await callTool(client, 'list_problems', { status: 'resolved' }),
    );
    assert.match(resolved, /2 problem/);
  });
});

describe('E2E: cross-session decision persistence', () => {
  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), '.test-e2e-cross-')),
  );

  before(() => {
    // Clean up stale storage from prior interrupted runs
    fs.rmSync(storageDir(tmpDir), { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(storageDir(tmpDir), { recursive: true, force: true });
  });

  test('decisions from session 1 are searchable in session 2', async () => {
    // Session 1
    const transport1 = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(import.meta.dirname, '..', 'index.js')],
      cwd: tmpDir,
    });
    const client1 = new Client({ name: 'session-1', version: '1.0.0' });
    await client1.connect(transport1);

    await callTool(client1, 'log_decision', {
      topic: 'ORM choice',
      options: [
        { name: 'Prisma', description: 'Type-safe, migration support' },
        { name: 'Drizzle', description: 'Lightweight, SQL-first' },
      ],
      chosen: 'Drizzle',
      rationale: 'Less abstraction, better raw SQL support',
      tags: ['database'],
    });

    await client1.close();

    // Session 2
    const transport2 = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(import.meta.dirname, '..', 'index.js')],
      cwd: tmpDir,
    });
    const client2 = new Client({ name: 'session-2', version: '1.0.0' });
    await client2.connect(transport2);

    // Search should find session 1's decision
    const search = text(
      await callTool(client2, 'search_decisions', { query: 'ORM' }),
    );
    assert.match(search, /ORM choice/);
    assert.match(search, /Drizzle/);

    // get_context should show it as "from prior sessions"
    const ctx = text(await callTool(client2, 'get_context'));
    assert.match(ctx, /1 additional project decision.*prior sessions/);

    // SessionStart hook should report it
    const hookOutput = runHook('session-start.sh', { cwd: tmpDir });
    const parsed = JSON.parse(hookOutput);
    assert.match(parsed.systemMessage, /1 project decision/);

    await client2.close();
  });
});
