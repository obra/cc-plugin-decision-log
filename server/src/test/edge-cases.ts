import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { callTool, text as getText, runHook, storageDir, STORAGE_ROOT } from './helpers.js';

describe('edge cases', () => {
  let client: Client;
  let transport: StdioClientTransport;
  const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, '.test-edge-'));

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
    // Clean up storage for this test project
    const slug = createHash('sha256').update(tmpDir).digest('hex').slice(0, 12);
    const projectDir = path.join(STORAGE_ROOT, slug);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('get_session_context with no data returns empty message', async () => {
    const result = await callTool(client, 'get_session_context');
    const text = getText(result);
    assert.match(text, /No decisions or investigations/);
  });

  test('search_decisions with no query and no tags returns all', async () => {
    // First log a decision
    await callTool(client, 'log_decision', {
      topic: 'Test topic',
      options: [{ name: 'A', description: 'Option A' }],
      chosen: 'A',
      rationale: 'Only option',
    });

    const result = await callTool(client, 'search_decisions', {});
    const text = getText(result);
    assert.match(text, /Test topic/);
  });

  test('log_decision with empty tags array', async () => {
    const result = await callTool(client, 'log_decision', {
      topic: 'No tags decision',
      options: [{ name: 'X', description: 'Only choice' }],
      chosen: 'X',
      rationale: 'Because',
      tags: [],
    });
    const text = getText(result);
    assert.match(text, /Decision logged/);
  });

  test('log_decision with special characters in text', async () => {
    const result = await callTool(client, 'log_decision', {
      topic: 'Use "quoted" values & <special> chars',
      options: [
        { name: 'Option with\nnewlines', description: 'Has\ttabs too' },
      ],
      chosen: 'Option with\nnewlines',
      rationale: 'Because we need to handle "edge" cases & more',
      tags: ['special-chars'],
    });
    const text = getText(result);
    assert.match(text, /Decision logged/);

    // Verify it's searchable
    const search = await callTool(client, 'search_decisions', { query: 'quoted' });
    assert.match(getText(search), /quoted/);
  });

  test('multiple investigations can be open simultaneously', async () => {
    const inv1 = await callTool(client, 'start_investigation', {
      problem: 'Problem Alpha',
    });
    const id1 = getText(inv1).match(/ID: (.+)/)![1];

    const inv2 = await callTool(client, 'start_investigation', {
      problem: 'Problem Beta',
    });
    const id2 = getText(inv2).match(/ID: (.+)/)![1];

    // Log attempts to both
    await callTool(client, 'log_attempt', {
      investigation_id: id1,
      approach: 'Alpha approach 1',
      outcome: 'failed',
      details: 'Did not work',
    });

    await callTool(client, 'log_attempt', {
      investigation_id: id2,
      approach: 'Beta approach 1',
      outcome: 'succeeded',
      details: 'Worked great',
    });

    // Resolve only one
    await callTool(client, 'resolve_investigation', {
      investigation_id: id2,
      resolution: 'Beta was easy',
    });

    // Session context should show both
    const ctx = await callTool(client, 'get_session_context');
    const text = getText(ctx);
    assert.match(text, /OPEN.*Problem Alpha/s);
    assert.match(text, /RESOLVED.*Problem Beta/s);
  });

  test('list_investigations shows all and filters by status', async () => {
    // Should have investigations from previous tests
    const all = await callTool(client, 'list_investigations', {});
    const allText = getText(all);
    assert.match(allText, /Problem Alpha/);
    assert.match(allText, /Problem Beta/);

    const openOnly = await callTool(client, 'list_investigations', { status: 'open' });
    const openText = getText(openOnly);
    assert.match(openText, /Problem Alpha/);
    assert.doesNotMatch(openText, /Problem Beta/);

    const resolvedOnly = await callTool(client, 'list_investigations', { status: 'resolved' });
    const resolvedText = getText(resolvedOnly);
    assert.doesNotMatch(resolvedText, /Problem Alpha/);
    assert.match(resolvedText, /Problem Beta/);
  });

  test('many attempts on one investigation', async () => {
    const inv = await callTool(client, 'start_investigation', {
      problem: 'Flaky test',
    });
    const id = getText(inv).match(/ID: (.+)/)![1];

    for (let i = 1; i <= 5; i++) {
      await callTool(client, 'log_attempt', {
        investigation_id: id,
        approach: `Attempt ${i}`,
        outcome: i === 5 ? 'succeeded' : 'failed',
        details: `Details for attempt ${i}`,
      });
    }

    const result = await callTool(client, 'resolve_investigation', {
      investigation_id: id,
      resolution: 'Fifth time is the charm',
    });
    const text = getText(result);
    assert.match(text, /Attempts: 5.*4 failed/);
  });
});

describe('multi-session hook behavior', () => {
  const tmpProject = fs.mkdtempSync(path.join(import.meta.dirname, '.test-multi-'));
  const projectSlug = createHash('sha256').update(tmpProject).digest('hex').slice(0, 12);
  const projectDir = path.join(STORAGE_ROOT, projectSlug);

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('pre-compact finds the most recent session, not the oldest', () => {
    // Create two sessions with different timestamps
    const oldSessionId = randomUUID();
    const newSessionId = randomUUID();
    const oldDir = path.join(projectDir, 'sessions', oldSessionId);
    const newDir = path.join(projectDir, 'sessions', newSessionId);
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });

    // Old session
    fs.writeFileSync(path.join(oldDir, 'metadata.json'), JSON.stringify({
      session_id: oldSessionId, project_slug: projectSlug, cwd: tmpProject,
      started_at: '2025-01-01T00:00:00Z',
    }));
    fs.writeFileSync(path.join(oldDir, 'investigations.json'), JSON.stringify([{
      id: randomUUID(), session_id: oldSessionId, problem: 'OLD PROBLEM',
      status: 'open', created_at: '2025-01-01T00:00:00Z', attempts: [],
    }]));

    // Touch old metadata to have old mtime
    const oldTime = new Date('2025-01-01');
    fs.utimesSync(path.join(oldDir, 'metadata.json'), oldTime, oldTime);

    // New session
    fs.writeFileSync(path.join(newDir, 'metadata.json'), JSON.stringify({
      session_id: newSessionId, project_slug: projectSlug, cwd: tmpProject,
      started_at: new Date().toISOString(),
    }));
    fs.writeFileSync(path.join(newDir, 'investigations.json'), JSON.stringify([{
      id: randomUUID(), session_id: newSessionId, problem: 'NEW PROBLEM',
      status: 'open', created_at: new Date().toISOString(), attempts: [],
    }]));

    // Decisions
    fs.writeFileSync(path.join(projectDir, 'decisions.json'), JSON.stringify([{
      id: randomUUID(), timestamp: new Date().toISOString(), session_id: newSessionId,
      topic: 'New decision', options: [], chosen: 'Yes', rationale: 'Because',
      tags: [],
    }]));

    const output = runHook('pre-compact.sh', { cwd: tmpProject });
    const parsed = JSON.parse(output);

    // Should show NEW PROBLEM, not OLD PROBLEM
    assert.match(parsed.systemMessage, /NEW PROBLEM/);
    assert.doesNotMatch(parsed.systemMessage, /OLD PROBLEM/);
  });
});
