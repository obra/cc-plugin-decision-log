import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const STORAGE_ROOT = path.join(process.env.HOME!, '.claude', 'decision-log');
const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export function storageDir(tmpDir: string): string {
  const slug = createHash('sha256').update(tmpDir).digest('hex').slice(0, 12);
  return path.join(STORAGE_ROOT, slug);
}

export function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  return client.callTool({ name, arguments: args });
}

export function text(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content as Array<{ type: string; text: string }>)
    .map((c) => c.text)
    .join('\n');
}

export function runHook(hookScript: string, input: object): string {
  return execFileSync('bash', [path.join(PLUGIN_ROOT, 'hooks', hookScript)], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
