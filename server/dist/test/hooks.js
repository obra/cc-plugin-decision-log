import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { runHook, storageDir } from './helpers.js';
const tmpProject = fs.mkdtempSync(path.join(import.meta.dirname, '.test-hook-project-'));
const projectDir = storageDir(tmpProject);
const sessionId = randomUUID();
const sessionDir = path.join(projectDir, 'sessions', sessionId);
describe('hook scripts', () => {
    before(() => {
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
            session_id: sessionId,
            project_slug: 'test',
            cwd: tmpProject,
            started_at: new Date().toISOString(),
        }));
        fs.writeFileSync(path.join(projectDir, 'decisions.json'), JSON.stringify([
            {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                session_id: sessionId,
                topic: 'Database engine',
                options: [
                    { name: 'SQLite', description: 'Simple file-based' },
                    { name: 'PostgreSQL', description: 'Full relational' },
                ],
                chosen: 'SQLite',
                rationale: 'No external dependencies needed',
                tags: ['database'],
            },
            {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                session_id: 'old-session',
                topic: 'Framework choice',
                options: [
                    { name: 'Express', description: 'Minimal' },
                    { name: 'Fastify', description: 'Fast' },
                ],
                chosen: 'Express',
                rationale: 'Team familiarity',
                tags: ['framework'],
            },
        ]));
        fs.writeFileSync(path.join(sessionDir, 'problems.json'), JSON.stringify([
            {
                id: randomUUID(),
                session_id: sessionId,
                problem: 'Auth middleware returning 401',
                status: 'open',
                created_at: new Date().toISOString(),
                approaches: [
                    {
                        approach: 'Check token expiry logic',
                        outcome: 'failed',
                        details: 'Tokens were valid, issue is elsewhere',
                        timestamp: new Date().toISOString(),
                    },
                ],
            },
            {
                id: randomUUID(),
                session_id: sessionId,
                problem: 'CSS grid layout broken on mobile',
                status: 'resolved',
                created_at: new Date().toISOString(),
                approaches: [
                    {
                        approach: 'Add media query for small screens',
                        outcome: 'succeeded',
                        details: 'Grid switched to single column below 640px',
                        timestamp: new Date().toISOString(),
                    },
                ],
                resolution: 'Added responsive breakpoint at 640px',
            },
        ]));
    });
    after(() => {
        fs.rmSync(tmpProject, { recursive: true, force: true });
        fs.rmSync(projectDir, { recursive: true, force: true });
    });
    test('session-start.sh outputs decision count', () => {
        const output = runHook('session-start.sh', { cwd: tmpProject });
        const parsed = JSON.parse(output);
        assert.equal(parsed.continue, true);
        assert.match(parsed.systemMessage, /2 project decision/);
    });
    test('session-start.sh exits cleanly when no data exists', () => {
        const output = runHook('session-start.sh', {
            cwd: '/tmp/nonexistent-project-xyzzy',
        });
        assert.equal(output, '');
    });
    test('pre-compact.sh outputs problem and decision summary', () => {
        const output = runHook('pre-compact.sh', { cwd: tmpProject });
        const parsed = JSON.parse(output);
        assert.equal(parsed.continue, true);
        assert.equal(parsed.suppressOutput, true);
        const msg = parsed.systemMessage;
        // Open problems shown in detail
        assert.match(msg, /OPEN PROBLEMS/);
        assert.match(msg, /Auth middleware/);
        assert.match(msg, /FAILED/i);
        assert.match(msg, /Check token expiry/);
        // Resolved problems shown as summaries
        assert.match(msg, /RESOLVED PROBLEMS/);
        assert.match(msg, /CSS grid/);
        // Should mention this session's decision
        assert.match(msg, /Database engine/);
        assert.match(msg, /SQLite/);
        // Should mention other decisions available
        assert.match(msg, /1 additional project decision/);
    });
    test('pre-compact.sh exits cleanly when no data exists', () => {
        const output = runHook('pre-compact.sh', {
            cwd: '/tmp/nonexistent-project-xyzzy',
        });
        assert.equal(output, '');
    });
});
