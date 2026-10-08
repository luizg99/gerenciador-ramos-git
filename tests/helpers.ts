import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
export async function git(repo: string, ...args: string[]) {
  return (await exec('git', args, { cwd: repo, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 4_000_000 })).stdout.trim();
}
export async function tempDirectory(prefix = 'git-') {
  const root = path.resolve('.local/test-repositories'); await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}
export async function configure(repo: string) {
  await git(repo, 'config', 'user.name', 'Teste Ramos'); await git(repo, 'config', 'user.email', 'ramos@example.invalid');
  await git(repo, 'config', 'commit.gpgsign', 'false'); await git(repo, 'config', 'core.autocrlf', 'false');
}
export async function fixture() {
  const root = await tempDirectory(); const repo = path.join(root, 'work'); const remote = path.join(root, 'remote.git');
  await git(root, 'init', '--bare', remote); await git(root, 'init', '-b', 'main', repo); await configure(repo);
  await mkdir(path.join(repo, 'source')); await writeFile(path.join(repo, 'source', 'dependencies.txt'), 'dependencies\n');
  await writeFile(path.join(repo, 'shared.txt'), 'base\n'); await writeFile(path.join(repo, 'README.md'), 'Projeto\n');
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'Base'); const base = await git(repo, 'rev-parse', 'HEAD');
  await git(repo, 'remote', 'add', 'origin', remote); await git(repo, 'push', '-u', 'origin', 'main');
  for (const branch of ['dev', 'release']) { await git(repo, 'switch', '-c', branch, base); await git(repo, 'push', '-u', 'origin', branch); }
  await git(repo, 'switch', '-c', 'DDVENDAS-63455-supp37', base);
  const first = await change(repo, 'first.txt', 'primeiro\n', 'Primeira alteração');
  const second = await change(repo, 'shared.txt', 'origem\n', 'Segunda alteração');
  await git(repo, 'push', '-u', 'origin', 'DDVENDAS-63455-supp37');
  return { root, repo, remote, base, first, second, source: 'DDVENDAS-63455-supp37' };
}
export async function change(repo: string, file: string, content: string, message: string) {
  await writeFile(path.join(repo, file), content); await git(repo, 'add', '--', file); await git(repo, 'commit', '-m', message); return git(repo, 'rev-parse', 'HEAD');
}
