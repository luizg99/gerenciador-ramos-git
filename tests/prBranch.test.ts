import { describe, expect, it } from 'vitest';
import { GitService } from '../electron/services/gitService';
import { prBranchProblem, type PrBranchInfo } from '../src/models/prBranch';
import { change, fixture, git } from './helpers';

const info = (patch: Partial<PrBranchInfo>): PrBranchInfo => ({ source: 'feature', target: 'dev', sourceState: 'remote', targetState: 'remote', ahead: 2, ...patch });

describe('verificação dos ramos do pull request', () => {
  it('ramo que não existe em lugar nenhum', () => {
    expect(prBranchProblem(info({ sourceState: 'none', ahead: null }))?.error).toContain('não existe');
  });
  it('ramo sem nenhum commit novo em relação ao destino', () => {
    expect(prBranchProblem(info({ ahead: 0 }))?.error).toContain('não tem nenhum commit');
    expect(prBranchProblem(info({ sourceState: 'local', ahead: 0 }))?.error).toContain('não tem nenhum commit');
  });
  it('ramo só local com commits: sem erro, informa quantos faltam enviar', () => {
    expect(prBranchProblem(info({ sourceState: 'local', ahead: 3 }))).toEqual({ error: '', toPush: 3 });
  });
  it('ramo publicado com commits ou sem informação: sem problema', () => {
    expect(prBranchProblem(info({}))).toBeNull();
    expect(prBranchProblem(undefined)).toBeNull();
  });

  it('git: distingue ramo publicado, só local, vazio e inexistente', async () => {
    const { repo, source } = await fixture();
    const service = new GitService();
    // vazio: criado do dev e publicado, sem commit próprio
    await git(repo, 'switch', '-c', 'vazio', 'origin/dev'); await git(repo, 'push', '-u', 'origin', 'vazio');
    // só local, com 1 commit
    await git(repo, 'switch', '-c', 'so-local', 'origin/dev'); await change(repo, 'local.txt', 'x\n', 'Commit local');
    const result = await service.prBranchInfo(repo, 'origin', [
      { source, target: 'dev' }, { source: 'vazio', target: 'dev' }, { source: 'so-local', target: 'dev' }, { source: 'nao-existe', target: 'dev' }
    ]);
    const by = Object.fromEntries(result.map(item => [item.source, item]));
    expect(by[source]).toMatchObject({ sourceState: 'remote', targetState: 'remote', ahead: 2 });
    expect(by.vazio).toMatchObject({ sourceState: 'remote', ahead: 0 });
    expect(by['so-local']).toMatchObject({ sourceState: 'local', ahead: 1 });
    expect(by['nao-existe']).toMatchObject({ sourceState: 'none', ahead: null });
  });
});
