import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Repository } from '../../src/models/domain';
const ignored = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'release', 'bin', 'obj', 'target', 'coverage', '__pycache__', 'venv']);
const concurrency = 16;
// A .git folder with HEAD (normal repository) or a .git file pointing to a gitdir (worktree/submodule).
export async function isRepository(directory: string) {
  const dotGit = path.join(directory, '.git');
  try {
    const info = await stat(dotGit);
    if (info.isDirectory()) return (await stat(path.join(dotGit, 'HEAD'))).isFile();
    return info.isFile() && (await readFile(dotGit, 'utf8')).startsWith('gitdir:');
  } catch { return false; }
}
export async function scanRepositories(roots: string[]): Promise<Repository[]> {
  const found = new Map<string, Repository>();
  let visited = 0, running = 0;
  const queue: (() => void)[] = [];
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= concurrency) await new Promise<void>(resolve => queue.push(resolve));
    running++;
    try { return await work(); } finally { running--; queue.shift()?.(); }
  };
  async function visit(directory: string, depth: number): Promise<void> {
    if (++visited > 10000 || depth > 4) return;
    const entries = await slot(() => readdir(directory, { withFileTypes: true })).catch(() => null);
    if (!entries) return;
    if (entries.some(e => e.name === '.git')) {
      if (await isRepository(directory)) {
        const root = await realpath(directory);
        const key = process.platform === 'win32' ? root.toLowerCase() : root;
        found.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0, 24), path: root, name: path.basename(root) });
      }
      return;
    }
    await Promise.all(entries.filter(e => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !ignored.has(e.name)).map(e => visit(path.join(directory, e.name), depth + 1)));
  }
  await Promise.all(roots.map(async root => { if (await stat(root).then(s => s.isDirectory()).catch(() => false)) await visit(root, 0); }));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
