import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const STORAGE_ROOT = path.join(process.env.HOME, '.claude', 'decision-log');
const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
export { STORAGE_ROOT, PLUGIN_ROOT };
export function storageDir(tmpDir) {
    const slug = createHash('sha256').update(tmpDir).digest('hex').slice(0, 12);
    return path.join(STORAGE_ROOT, slug);
}
export function callTool(client, name, args = {}) {
    return client.callTool({ name, arguments: args });
}
export function text(result) {
    return result.content
        .map((c) => c.text)
        .join('\n');
}
export function runHook(hookScript, input) {
    return execFileSync('bash', [path.join(PLUGIN_ROOT, 'hooks', hookScript)], {
        input: JSON.stringify(input),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
}
