import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export const STORAGE_ROOT = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude',
  'decision-log'
);

export function getProjectSlug(cwd: string): string {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (remote) return shortHash(remote);
  } catch {
    // not a git repo or no remote
  }
  return shortHash(cwd);
}
