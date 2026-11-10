import { describe, expect, it } from 'vitest';
import { tortoiseArgs, tortoiseExecutable, windowWatchScript } from '../electron/services/tortoiseGit';
describe('TortoiseGit', () => {
  it('monta o comando de commit e de log para a pasta do repositório', () => {
    expect(tortoiseArgs('commit', 'C:\\Projetos\\meu repo')).toEqual(['/command:commit', '/path:C:\\Projetos\\meu repo']);
    expect(tortoiseArgs('log', 'C:\\r')).toEqual(['/command:log', '/path:C:\\r']);
  });
  it('no log, limita ao ramo escolhido e posiciona no commit; o commit ignora essas opções', () => {
    const hash = 'a'.repeat(40);
    expect(tortoiseArgs('log', 'C:\\r', { ref: 'origin/dev', rev: hash })).toEqual(['/command:log', '/path:C:\\r', '/endrev:origin/dev', `/rev:${hash}`]);
    expect(tortoiseArgs('log', 'C:\\r', { ref: 'HEAD' })).toEqual(['/command:log', '/path:C:\\r']);
    expect(tortoiseArgs('commit', 'C:\\r', { ref: 'dev', rev: hash })).toEqual(['/command:commit', '/path:C:\\r']);
  });
  it('o monitor de janela acompanha o PID informado', () => {
    expect(windowWatchScript(4321)).toContain('Get-Process -Id 4321');
    expect(windowWatchScript(4321)).toContain('MainWindowHandle');
  });
  it('acha o executável instalado ou usa o PATH', () => {
    const installed = 'C:\\Program Files\\TortoiseGit\\bin\\TortoiseGitProc.exe';
    expect(tortoiseExecutable({ ProgramFiles: 'C:\\Program Files' }, file => file === installed)).toBe(installed);
    expect(tortoiseExecutable({}, () => false)).toBe('TortoiseGitProc.exe');
  });
});
