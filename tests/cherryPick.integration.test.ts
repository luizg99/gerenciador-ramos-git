import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CherryPickController } from '../electron/controllers/cherryPickController';
import { GitService } from '../electron/services/gitService';
import { Storage } from '../electron/services/storage';
import { change, fixture, git } from './helpers';
async function setup() {
  const f = await fixture(); const pmanCalls: string[] = [];
  const service = new GitService(undefined, async repo => { pmanCalls.push(await git(repo, 'branch', '--show-current')); });
  const storage = new Storage(path.join(f.root, 'app-data'));
  const controller = new CherryPickController(service, storage); await controller.initialize();
  return { ...f, controller, storage, service, pmanCalls };
}
describe('Cherry-pick real, cancelamento, push e recuperação', () => {
  it('ordena commits e aplica/envia os três destinos sem executar pman', async () => {
    const f = await setup();
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.second, f.first], targets: ['main', 'dev', 'release'] });
    expect(result.finished).toBe(true); expect(result.commits).toEqual([f.first, f.second]); expect(f.pmanCalls).toEqual([]);
    for (const branch of ['main', 'dev', 'release']) {
      expect(await git(f.remote, 'rev-parse', branch)).toBe(await git(f.repo, 'rev-parse', branch));
      expect(await git(f.repo, 'log', '--format=%s', `${f.base}..${branch}`)).toBe('Segunda alteração\nPrimeira alteração');
      expect(await git(f.repo, 'show', `${branch}:first.txt`)).toBe('primeiro');
      expect(await git(f.repo, 'show', `${branch}:shared.txt`)).toBe('origem');
    }
    expect(await git(f.repo, 'status', '--porcelain')).toBe('');
    expect((await f.storage.executions())[0].finished).toBe(true);
  });
  it('conflito no segundo commit cancela TODOS os commits desse destino e preserva os anteriores', async () => {
    const f = await setup();
    await git(f.repo, 'switch', 'dev'); const devBefore = await change(f.repo, 'shared.txt', 'destino incompatível\n', 'Conflito no destino'); await git(f.repo, 'push');
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first, f.second], targets: ['main', 'dev', 'release'] });
    expect(result.targets.map(t => t.phase)).toEqual(['done', 'failed', 'pending']); expect(result.targets[1].aborted).toBe(true);
    expect(await git(f.repo, 'rev-parse', 'dev')).toBe(devBefore); expect(await git(f.remote, 'rev-parse', 'dev')).toBe(devBefore);
    await expect(readFile(path.join(f.repo, 'first.txt'))).rejects.toThrow();
    expect(await git(f.repo, 'status', '--porcelain')).toBe(''); expect(await f.service.operation(f.repo)).toBeNull();
    expect(await git(f.remote, 'show', 'main:first.txt')).toBe('primeiro');
    expect(await git(f.remote, 'rev-parse', 'release')).toBe(f.base); expect(f.pmanCalls).toEqual([]);
  });
  it('push rejeitado preserva commits locais e a retomada envia sem duplicar o cherry-pick', async () => {
    const f = await setup();
    const hook = path.join(f.remote, 'hooks', 'update');
    await writeFile(hook, '#!/bin/sh\nif [ "$1" = "refs/heads/dev" ]; then echo "push rejeitado no teste" >&2; exit 1; fi\nexit 0\n', { mode: 0o755 });
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first, f.second], targets: ['main', 'dev', 'release'] });
    expect(result.targets.map(t => t.phase)).toEqual(['done', 'failed', 'pending']); expect(result.targets[1].failedAt).toBe('pushing');
    const localHead = await git(f.repo, 'rev-parse', 'dev'); expect(localHead).not.toBe(f.base); expect(await git(f.remote, 'rev-parse', 'dev')).toBe(f.base);
    await writeFile(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const restarted = new CherryPickController(f.service, f.storage); await restarted.initialize();
    const resumed = await restarted.resume(f.repo, result.id, 'retry');
    expect(resumed.finished).toBe(true); expect(await git(f.repo, 'rev-parse', 'dev')).toBe(localHead); expect(await git(f.remote, 'rev-parse', 'dev')).toBe(localHead);
    expect(f.pmanCalls).toEqual([]);
  });
  it('bloqueia alterações locais antes de qualquer troca ou sequência', async () => {
    const f = await setup(); await writeFile(path.join(f.repo, 'novo.txt'), 'trabalho local');
    await expect(f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] })).rejects.toThrow('alterações locais');
    expect(await git(f.repo, 'branch', '--show-current')).toBe(f.source); expect(f.pmanCalls).toHaveLength(0); expect(f.controller.executions).toHaveLength(0);
  });
  it('não executa pman no cherry-pick, nem quando ele falharia', async () => {
    const f = await setup(); const service = new GitService(undefined, async () => { throw new Error('pman não deveria rodar'); });
    const controller = new CherryPickController(service, f.storage); await controller.initialize();
    const result = await controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main', 'dev'] });
    expect(result.finished).toBe(true); expect(result.targets.map(t => t.phase)).toEqual(['done', 'done']);
    expect(await git(f.remote, 'rev-parse', 'main')).not.toBe(f.base);
  });
  it('não envia commits locais preexistentes junto com a automação', async () => {
    const f = await setup(); await git(f.repo, 'switch', 'main'); const head = await change(f.repo, 'outro.txt', 'pendente', 'Commit que não deve ser enviado');
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] });
    expect(result.targets[0].error).toContain('commits locais'); expect(await git(f.remote, 'rev-parse', 'main')).toBe(f.base); expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(head);
  });
  it('rejeita origem/destino equivalentes, commits de outra origem e destinos duplicados', async () => {
    const f = await setup();
    await expect(f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main', 'origin/main'] })).rejects.toThrow('mesmo ramo');
    await expect(f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: [`origin/${f.source}`] })).rejects.toThrow('mesmo ramo');
    await git(f.repo, 'switch', 'dev'); const unrelated = await change(f.repo, 'unrelated.txt', 'x', 'Outro histórico'); await git(f.repo, 'push');
    await expect(f.controller.start(f.repo, { source: f.source, commits: [unrelated], targets: ['main'] })).rejects.toThrow('não pertence');
    expect(f.controller.executions).toHaveLength(0);
  });
  it('commit já aplicado causa parada controlada, sem deixar sequenciador ou mudar o destino', async () => {
    const f = await setup(); await git(f.repo, 'switch', 'main'); await git(f.repo, 'cherry-pick', f.first); await git(f.repo, 'push'); const before = await git(f.repo, 'rev-parse', 'HEAD');
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main', 'dev'] });
    expect(result.targets[0].aborted).toBe(true); expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(before); expect(await f.service.operation(f.repo)).toBeNull(); expect(result.targets[1].phase).toBe('pending');
  });
  it('cancela a sequência vazia após reiniciar e libera um novo cherry-pick', async () => {
    const f = await setup();
    await git(f.repo, 'switch', 'main'); await git(f.repo, 'cherry-pick', f.first); await git(f.repo, 'push');
    const before = await git(f.repo, 'rev-parse', 'HEAD');
    const failed = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main', 'dev'] });
    expect(failed.targets[0].aborted).toBe(true);
    const restarted = new CherryPickController(f.service, f.storage); await restarted.initialize();
    await expect(restarted.cancel(f.remote, failed.id)).rejects.toThrow('não encontrada');
    const cancelled = await restarted.cancel(f.repo, failed.id);
    expect(cancelled.finished).toBe(true); expect(cancelled.cancelledAt).toBeTruthy();
    expect(cancelled.targets).toEqual(failed.targets);
    expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(await git(f.remote, 'rev-parse', 'main')).toBe(before);
    expect((await f.storage.executions())[0]).toEqual(cancelled);
    const again = new CherryPickController(f.service, f.storage); await again.initialize();
    await expect(again.resume(f.repo, failed.id, 'retry')).rejects.toThrow('não encontrada');
    const next = await again.start(f.repo, { source: f.source, commits: [f.first], targets: ['dev'] });
    expect(next.finished).toBe(true); expect(next.targets[0].phase).toBe('done');
  });
  it('cancelar após falha de push preserva destinos enviados, commits locais e arquivos', async () => {
    const f = await setup();
    await writeFile(path.join(f.remote, 'hooks', 'update'), '#!/bin/sh\nif [ "$1" = "refs/heads/dev" ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
    const failed = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main', 'dev', 'release'] });
    expect(failed.targets.map(t => t.phase)).toEqual(['done', 'failed', 'pending']);
    const head = await git(f.repo, 'rev-parse', 'HEAD');
    const sent = await git(f.remote, 'rev-parse', 'main');
    await writeFile(path.join(f.repo, 'manual.txt'), 'trabalho manual');
    await f.controller.cancel(f.repo, failed.id);
    expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(f.remote, 'rev-parse', 'main')).toBe(sent);
    expect(await git(f.remote, 'rev-parse', 'dev')).toBe(f.base);
    expect(await git(f.remote, 'rev-parse', 'release')).toBe(f.base);
    expect(await readFile(path.join(f.repo, 'manual.txt'), 'utf8')).toBe('trabalho manual');
  });
  it('uma interrupção durante aplicação exige revisão manual e não reaplica silenciosamente', async () => {
    const f = await setup(); await git(f.repo, 'switch', 'main');
    const interrupted = { id: '00000000-0000-4000-8000-000000000001', repoPath: f.repo, source: f.source, commits: [f.first], targets: [{ branch: 'main', phase: 'applying' as const, beforeHead: f.base }], startedAt: new Date().toISOString(), finished: false };
    await f.storage.saveExecutions([interrupted]);
    const controller = new CherryPickController(f.service, f.storage); await controller.initialize();
    expect(controller.executions[0].targets[0].phase).toBe('interrupted');
    await expect(controller.resume(f.repo, interrupted.id, 'retry')).rejects.toThrow('estado incerto');
    expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(f.base);
    await git(f.repo, 'cherry-pick', f.first);
    expect((await controller.resume(f.repo, interrupted.id, 'manual')).finished).toBe(true);
    expect(await git(f.remote, 'show', 'main:first.txt')).toBe('primeiro');
  });
  it('retomada de push recusa HEAD alterado pelo usuário', async () => {
    const f = await setup(); await writeFile(path.join(f.remote, 'hooks', 'update'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] });
    await change(f.repo, 'outro.txt', 'mais', 'Alteração posterior');
    await expect(f.controller.resume(f.repo, result.id, 'retry')).rejects.toThrow('commits locais mudaram');
    expect(await git(f.remote, 'rev-parse', 'main')).toBe(f.base);
  });
  it('uma falha no próprio abort preserva o conflito e bloqueia a retomada automática', async () => {
    const f = await setup(); await git(f.repo, 'switch', 'main'); await change(f.repo, 'shared.txt', 'conflito no destino', 'Conflito'); await git(f.repo, 'push');
    const originalGit = f.service.git;
    f.service.git = (repo, args) => args[0] === 'cherry-pick' && args[1] === '--abort' ? Promise.reject(new Error('abort bloqueado no teste')) : originalGit(repo, args);
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first, f.second], targets: ['main', 'dev'] });
    expect(result.targets[0].phase).toBe('interrupted'); expect(result.targets[0].aborted).toBe(false); expect(result.targets[0].error).toContain('Falha ao cancelar');
    expect(result.targets[1].phase).toBe('pending'); expect(await f.service.operation(f.repo)).not.toBeNull();
    await expect(f.controller.resume(f.repo, result.id, 'retry')).rejects.toThrow('operação Git em andamento');
    await git(f.repo, 'cherry-pick', '--abort');
  });
  it('merge é rejeitado antes de alterar qualquer destino', async () => {
    const f = await setup(); await git(f.repo, 'switch', '-c', 'side', f.base); await change(f.repo, 'side.txt', 'side', 'Side');
    await git(f.repo, 'switch', f.source); await git(f.repo, 'merge', '--no-ff', 'side', '-m', 'Merge de teste'); const merge = await git(f.repo, 'rev-parse', 'HEAD');
    await expect(f.controller.start(f.repo, { source: f.source, commits: [merge], targets: ['main'] })).rejects.toThrow('Commits de merge');
    expect(f.pmanCalls).toHaveLength(0); expect(await git(f.remote, 'rev-parse', 'main')).toBe(f.base);
  });
  it('ao terminar a sequência volta para o ramo em que o usuário estava', async () => {
    const f = await setup(); await git(f.repo, 'switch', f.source);
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] });
    expect(result.finished).toBe(true); expect(result.initialBranch).toBe(f.source);
    expect(await git(f.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(f.source);
  });
  it('destino atrasado recebe apenas fast-forward antes da aplicação', async () => {
    const f = await setup(); await git(f.repo, 'switch', '-c', 'remote-change', f.base); const updated = await change(f.repo, 'remoto.txt', 'remote', 'Atualização no remoto');
    await git(f.repo, 'push', 'origin', 'HEAD:refs/heads/main');
    const result = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] });
    expect(result.finished).toBe(true); expect(result.targets[0].beforeHead).toBe(updated); expect(await git(f.remote, 'show', 'main:remoto.txt')).toBe('remote');
    expect(await git(f.remote, 'show', 'main:first.txt')).toBe('primeiro');
  });
  it('interrupção após push pode ser retomada de modo idempotente usando o HEAD registrado', async () => {
    const f = await setup(); const completed = await f.controller.start(f.repo, { source: f.source, commits: [f.first], targets: ['main'] });
    completed.finished = false; completed.targets[0].phase = 'pushing'; await f.storage.saveExecutions([completed]);
    const restarted = new CherryPickController(f.service, f.storage); await restarted.initialize();
    await git(f.repo, 'switch', 'main'); const head = await git(f.repo, 'rev-parse', 'HEAD'); expect((await restarted.resume(f.repo, completed.id, 'retry')).finished).toBe(true);
    expect(await git(f.repo, 'rev-parse', 'main')).toBe(head); expect(f.pmanCalls).toEqual([]);
  });
});
