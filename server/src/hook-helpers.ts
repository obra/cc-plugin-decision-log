import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectSlug, STORAGE_ROOT } from './project-slug.js';

interface HookInput {
  cwd?: string;
  session_id?: string;
  [key: string]: unknown;
}

function readInput(): HookInput {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function output(result: { continue: boolean; suppressOutput: boolean; systemMessage: string }) {
  process.stdout.write(JSON.stringify(result));
}

function findLatestSessionDir(sessionsDir: string): string | null {
  if (!fs.existsSync(sessionsDir)) return null;

  let latest: { dir: string; mtime: number } | null = null;
  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(sessionsDir, entry.name, 'metadata.json');
    try {
      const stat = fs.statSync(metaPath);
      if (!latest || stat.mtimeMs > latest.mtime) {
        latest = { dir: path.join(sessionsDir, entry.name), mtime: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return latest?.dir ?? null;
}

export function runSessionStart() {
  const input = readInput();
  const cwd = input.cwd;
  if (!cwd) process.exit(0);

  const slug = getProjectSlug(cwd);
  const decisionsPath = path.join(STORAGE_ROOT, slug, 'decisions.json');

  if (!fs.existsSync(decisionsPath)) process.exit(0);

  try {
    const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf-8'));
    if (!Array.isArray(decisions) || decisions.length === 0) process.exit(0);

    output({
      continue: true,
      suppressOutput: true,
      systemMessage: `Session memory: ${decisions.length} project decision(s) on record from prior sessions. Use search_decisions to query history.`,
    });
  } catch {
    process.exit(0);
  }
}

export function runPreCompact() {
  const input = readInput();
  const cwd = input.cwd;
  if (!cwd) process.exit(0);

  const slug = getProjectSlug(cwd);
  const projectDir = path.join(STORAGE_ROOT, slug);

  if (!fs.existsSync(projectDir)) process.exit(0);

  const latestSessionDir = findLatestSessionDir(path.join(projectDir, 'sessions'));
  if (!latestSessionDir) process.exit(0);

  // Read session metadata for session_id
  let sessionId = '';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(latestSessionDir, 'metadata.json'), 'utf-8'));
    sessionId = meta.session_id || '';
  } catch {
    // continue without session_id filtering
  }

  const lines: string[] = [];

  // Investigations — full detail for open, summarized for resolved
  const invPath = path.join(latestSessionDir, 'investigations.json');
  if (fs.existsSync(invPath)) {
    try {
      const investigations = JSON.parse(fs.readFileSync(invPath, 'utf-8'));
      if (Array.isArray(investigations) && investigations.length > 0) {
        const open = investigations.filter((i: any) => i.status !== 'resolved');
        const resolved = investigations.filter((i: any) => i.status === 'resolved');

        if (open.length > 0) {
          lines.push('OPEN INVESTIGATIONS:');
          for (const inv of open) {
            lines.push(`[OPEN] ${inv.problem}`);
            if (Array.isArray(inv.attempts)) {
              for (const a of inv.attempts) {
                const label = a.outcome === 'failed' ? 'FAILED' : 'SUCCEEDED';
                const details = a.details.length > 120
                  ? a.details.slice(0, 120) + '...'
                  : a.details;
                lines.push(`  - ${label}: ${a.approach} — ${details}`);
              }
            }
            lines.push('');
          }
        }

        if (resolved.length > 0) {
          lines.push('RESOLVED INVESTIGATIONS:');
          for (const inv of resolved) {
            const failCount = Array.isArray(inv.attempts)
              ? inv.attempts.filter((a: any) => a.outcome === 'failed').length
              : 0;
            const suffix = failCount > 0 ? ` (${failCount} failed attempt${failCount > 1 ? 's' : ''})` : '';
            lines.push(`- ${inv.problem} → ${inv.resolution || 'resolved'}${suffix}`);
          }
          lines.push('');
        }
      }
    } catch {
      // skip malformed investigations
    }
  }

  // Decisions
  const decPath = path.join(projectDir, 'decisions.json');
  let sessionDecCount = 0;
  let totalDecCount = 0;
  if (fs.existsSync(decPath)) {
    try {
      const decisions = JSON.parse(fs.readFileSync(decPath, 'utf-8'));
      if (Array.isArray(decisions)) {
        totalDecCount = decisions.length;
        const sessionDecs = sessionId
          ? decisions.filter((d: any) => d.session_id === sessionId)
          : decisions;
        sessionDecCount = sessionDecs.length;

        if (sessionDecs.length > 0) {
          lines.push('DECISIONS THIS SESSION:');
          for (const d of sessionDecs) {
            lines.push(`- ${d.topic}: ${d.chosen} — ${d.rationale}`);
          }
          lines.push('');
        }

        const other = totalDecCount - sessionDecCount;
        if (other > 0) {
          lines.push(`${other} additional project decision(s) from prior sessions available via search_decisions.`);
        }
      }
    } catch {
      // skip malformed decisions
    }
  }

  if (lines.length === 0) process.exit(0);

  const message = [
    'SESSION MEMORY (preserved through compaction) — use get_session_context for full details.',
    '',
    ...lines,
  ].join('\n');

  output({
    continue: true,
    suppressOutput: true,
    systemMessage: message,
  });
}
