import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../electron/services/processRunner', () => ({ runProcess: vi.fn().mockResolvedValue('') }));
vi.mock('../electron/services/azurePullRequests', () => ({ gitAuthorization: vi.fn().mockResolvedValue('Bearer test') }));
import { runProcess } from '../electron/services/processRunner';
import { cloneRepository, listAzureRepositories, listGitHubRepositories, validateCloneUrl } from '../electron/services/cloneRepository';

describe('Clonagem de repositórios', () => {
  it('restringe a origem selecionada e rejeita URLs com credenciais ou protocolos locais', () => {
    expect(validateCloneUrl('github', 'https://github.com/equipe/repo.git')).toBe('https://github.com/equipe/repo.git');
    expect(validateCloneUrl('enterprise', 'git@github.empresa.com:equipe/repo.git')).toContain('github.empresa.com');
    expect(validateCloneUrl('azure', 'git@ssh.dev.azure.com:v3/org/proj/repo')).toContain('ssh.dev.azure.com');
    expect(() => validateCloneUrl('github', 'https://github.empresa.com/equipe/repo')).toThrow('github.com');
    expect(() => validateCloneUrl('enterprise', 'https://github.com/equipe/repo')).toThrow('Enterprise');
    expect(() => validateCloneUrl('url', 'file:///C:/segredo')).toThrow('HTTPS ou SSH');
    expect(() => validateCloneUrl('url', 'https://user:senha@example.com/repo')).toThrow('credenciais');
  });

  it('clona em uma pasta nova sem sobrescrever uma pasta existente', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'ramos-clone-'));
    const result = await cloneRepository('github', 'https://github.com/equipe/repo.git', parent, 'repo');
    expect(result.destination).toBe(path.join(parent, 'repo'));
    expect(runProcess).toHaveBeenCalledWith('git', ['clone', '--progress', '--', 'https://github.com/equipe/repo.git', result.destination], parent, undefined, 600000);
    await mkdir(path.join(parent, 'ocupado'));
    await expect(cloneRepository('github', 'https://github.com/equipe/repo.git', parent, 'ocupado')).rejects.toThrow('Já existe');
    await expect(cloneRepository('github', 'https://github.com/equipe/repo.git', parent, '../fora')).rejects.toThrow('nome de pasta');
    const suggested = path.join(parent, 'GitHub');
    await cloneRepository('github', 'https://github.com/equipe/repo.git', suggested, 'novo');
    expect((await stat(suggested)).isDirectory()).toBe(true);
  });

  it('lista repositórios do Azure pela organização e projeto', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ value: [{ name: 'repo-b', remoteUrl: 'https://dev.azure.com/org/proj/_git/repo-b', project: { name: 'proj' } }, { name: 'repo-a', remoteUrl: 'https://dev.azure.com/org/proj/_git/repo-a', project: { name: 'proj' } }] }) } as Response);
    const repos = await listAzureRepositories('https://dev.azure.com/org', 'proj');
    expect(repos.map(repo => repo.name)).toEqual(['repo-a', 'repo-b']);
    expect(request.mock.calls[0][0].toString()).toContain('/org/proj/_apis/git/repositories');
    request.mockRestore();
    await expect(listAzureRepositories('https://other.example/org', '')).rejects.toThrow('dev.azure.com');
  });

  it('lista repositórios autenticados no GitHub.com e Enterprise', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [{ full_name: 'equipe/repo', name: 'repo', clone_url: 'https://github.com/equipe/repo.git', owner: { login: 'equipe' } }] } as Response);
    expect((await listGitHubRepositories('github')).map(repo => repo.name)).toEqual(['equipe/repo']);
    expect(request.mock.calls[0][0].toString()).toContain('api.github.com/user/repos');
    await listGitHubRepositories('enterprise', 'https://github.empresa.com');
    expect(request.mock.calls[1][0].toString()).toContain('github.empresa.com/api/v3/user/repos');
    await listGitHubRepositories('enterprise', 'https://empresa.ghe.com');
    expect(request.mock.calls[2][0].toString()).toContain('api.empresa.ghe.com/user/repos');
    request.mockRestore();
    await expect(listGitHubRepositories('enterprise', 'https://github.com')).rejects.toThrow('Enterprise');
  });
});
