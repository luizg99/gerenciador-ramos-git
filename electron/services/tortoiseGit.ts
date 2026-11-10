import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
// Procura o TortoiseGitProc.exe nas pastas de instalação padrão; cai no PATH se não achar.
export function tortoiseExecutable(env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync) {
  const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter((value): value is string => !!value);
  return roots.map(root => path.win32.join(root, 'TortoiseGit', 'bin', 'TortoiseGitProc.exe')).find(exists) ?? 'TortoiseGitProc.exe';
}
// No log, `ref` limita o histórico até aquele ramo (/endrev) e `rev` abre já posicionado no commit (/rev).
export function tortoiseArgs(command: 'commit' | 'log', repoPath: string, options: { ref?: string; rev?: string } = {}) {
  const args = [`/command:${command}`, `/path:${repoPath}`];
  if (command === 'log') {
    if (options.ref && options.ref !== 'HEAD') args.push(`/endrev:${options.ref}`);
    if (options.rev) args.push(`/rev:${options.rev}`);
  }
  return args;
}
// Espera (até ~15 s) o processo ter uma janela visível; termina também se ele fechar antes.
export function windowWatchScript(pid: number) {
  return `$p = Get-Process -Id ${Math.trunc(pid)} -ErrorAction SilentlyContinue; if (-not $p) { exit 0 }; for ($i = 0; $i -lt 100; $i++) { $p.Refresh(); if ($p.HasExited -or $p.MainWindowHandle -ne 0) { exit 0 }; Start-Sleep -Milliseconds 150 }`;
}
function waitForWindow(pid: number): Promise<void> {
  return new Promise(resolve => {
    const watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowWatchScript(pid)], { windowsHide: true, stdio: 'ignore' });
    const guard = setTimeout(() => { watcher.kill(); resolve(); }, 20000);
    watcher.once('error', () => { clearTimeout(guard); setTimeout(resolve, 1500); });
    watcher.once('close', () => { clearTimeout(guard); resolve(); });
  });
}
// Resolve quando a janela do TortoiseGit aparece de fato (não apenas quando o processo é iniciado).
export function openTortoise(command: 'commit' | 'log', repoPath: string, options: { ref?: string; rev?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tortoiseExecutable(), tortoiseArgs(command, repoPath, options), { cwd: repoPath, detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    child.once('error', () => reject(new Error('Não foi possível abrir o TortoiseGit. Confirme se ele está instalado.')));
    child.once('spawn', () => { child.unref(); void waitForWindow(child.pid ?? 0).then(resolve); });
  });
}
