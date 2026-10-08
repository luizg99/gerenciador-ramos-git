import { spawn } from 'node:child_process';
export class CommandError extends Error {
  constructor(message: string, public exitCode: number | null, public output: string) { super(message); }
}
export function redact(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@').replace(/\x1b\[[0-9;]*m/g, '');
}
export function runProcess(command: string, args: string[], cwd: string, onOutput?: (text: string) => void, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', GIT_PAGER: 'cat' } });
    let stdout = '', stderr = '', failure: string | undefined;
    const stop = (reason: string) => {
      failure = reason;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('O comando excedeu o tempo limite. Verifique o estado do repositório antes de continuar.'), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => { stdout += s; onOutput?.(redact(s)); if (stdout.length > 16_000_000) stop('Saída muito grande. Selecione um arquivo menor.'); });
    child.stderr.on('data', (s: string) => { stderr += s; onOutput?.(redact(s)); if (stderr.length > 1_000_000) stop('Saída de erro muito grande.'); });
    child.on('error', error => { clearTimeout(timer); reject(new CommandError(`Não foi possível executar ${command}: ${error.message}`, null, '')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !failure) resolve(stdout);
      else reject(new CommandError(failure ?? redact(stderr.trim() || stdout.trim() || `Comando terminou com código ${code}.`), code, redact(stderr + stdout)));
    });
  });
}
const allowed = new Set(['status', 'symbolic-ref', 'branch', 'switch', 'stash', 'log', 'show', 'diff', 'add', 'restore', 'rm', 'commit', 'push', 'fetch', 'cherry-pick', 'rev-parse', 'for-each-ref', 'rev-list', 'merge', 'merge-base', 'config', 'remote', 'check-ref-format']);
export function runGit(repo: string, args: string[]): Promise<string> {
  if (!allowed.has(args[0]) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Comando Git não permitido.');
  if (args[0] === 'rm' && !args.includes('--cached')) throw new Error('A remoção de arquivos do disco não é permitida.');
  return runProcess('git', ['-c', 'core.quotepath=false', ...args], repo);
}
