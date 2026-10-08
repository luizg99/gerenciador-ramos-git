import { randomUUID } from 'node:crypto';
import type { CherryPlan, Execution, TargetRun } from '../../src/models/domain';
import { planSchema } from '../../src/models/validation';
import { GitService, type Reporter } from '../services/gitService';
import { Storage } from '../services/storage';
export class CherryPickController {
  executions: Execution[] = [];
  constructor(private git: GitService, private storage: Storage, private report: Reporter = () => {}) {}
  async initialize() {
    this.executions = await this.storage.executions();
    for (const execution of this.executions) for (const target of execution.targets) {
      if (['switching', 'pman', 'applying', 'pushing'].includes(target.phase)) {
        target.failedAt = target.phase;
        target.phase = 'interrupted';
        target.error = 'O aplicativo foi interrompido. Confira o repositório antes de retomar. Nenhuma operação foi desfeita automaticamente.';
      }
    }
    await this.save();
  }
  private save() { return this.storage.saveExecutions(this.executions); }
  private async phase(execution: Execution, target: TargetRun, phase: TargetRun['phase']) {
    target.phase = phase; target.error = undefined;
    await this.save();
    this.report(execution.repoPath, `${target.branch}: ${({ switching: 'trocando ramo', pman: 'instalando dependências', applying: 'aplicando commits', pushing: 'enviando commits', done: 'concluído', pending: 'aguardando', failed: 'falhou', interrupted: 'interrompido' })[phase]}`);
  }
  async start(repo: string, input: CherryPlan): Promise<Execution> {
    const plan = planSchema.parse(input);
    const initial = await this.git.ensureIdle(repo);
    if (this.executions.some(e => e.repoPath === repo && !e.finished)) throw new Error('Existe uma sequência pendente neste repositório. Retome ou conclua manualmente antes de iniciar outra.');
    await this.git.branches(repo, true);
    const origin = await this.git.resolveBranch(repo, plan.source);
    const resolved = await Promise.all(plan.targets.map(t => this.git.resolveBranch(repo, t)));
    const canonical = resolved.map(t => t.name);
    if (new Set(canonical).size !== canonical.length || canonical.includes(origin.name)) throw new Error('Origem e destinos não podem representar o mesmo ramo local.');
    const order = (await this.git.git(repo, ['rev-list', '--reverse', '--topo-order', plan.source, '--'])).trim().split('\n');
    const commits = order.filter(c => plan.commits.includes(c));
    if (commits.length !== plan.commits.length) throw new Error('Um commit selecionado não pertence ao histórico da origem. Atualize a seleção.');
    for (const commit of commits) {
      const parents = (await this.git.git(repo, ['rev-list', '--parents', '-n', '1', commit])).trim().split(' ');
      if (parents.length > 2) throw new Error('Commits de merge exigem escolha de pai. Faça esse cherry-pick manualmente; selecione commits comuns nesta tela.');
    }
    const execution: Execution = { id: randomUUID(), repoPath: repo, source: plan.source, commits, targets: plan.targets.map(branch => ({ branch, phase: 'pending' })), startedAt: new Date().toISOString(), finished: false, initialBranch: initial.branch && !initial.branch.startsWith('(') ? initial.branch : undefined };
    this.executions.unshift(execution); await this.save();
    await this.continue(execution);
    return structuredClone(execution);
  }
  private async apply(execution: Execution, target: TargetRun): Promise<boolean> {
    const repo = execution.repoPath;
    let applying = false;
    try {
      await this.git.ensureIdle(repo);
      await this.phase(execution, target, 'switching');
      await this.git.checkout(repo, target.branch);
      const info = await this.git.prepareTarget(repo);
      target.remote = info.remote; target.remoteBranch = info.remoteBranch;
      target.beforeHead = await this.git.head(repo);
      await this.phase(execution, target, 'applying');
      applying = true;
      // One invocation owns the entire sequence: --abort restores the state before the FIRST selected commit.
      await this.git.git(repo, ['cherry-pick', ...execution.commits]);
      applying = false;
      target.appliedHead = await this.git.head(repo);
      await this.phase(execution, target, 'pushing');
      await this.git.ensureIdle(repo);
      await this.git.push(repo, info);
      await this.phase(execution, target, 'done');
      return true;
    } catch (error) {
      target.failedAt = target.phase;
      target.error = (error as Error).message;
      if (applying) {
        try {
          const operation = await this.git.operation(repo);
          if (operation === 'CHERRY_PICK_HEAD' || operation === 'sequencer') await this.git.git(repo, ['cherry-pick', '--abort']);
          target.aborted = await this.git.head(repo) === target.beforeHead && !(await this.git.operation(repo));
          target.error = target.aborted
            ? `Cherry-pick de ${target.branch} falhou; a tentativa inteira nesse destino foi desfeita. Faça o cherry-pick manual e resolva o problema, ou corrija a causa e tente novamente.\n${target.error}`
            : `Não foi possível confirmar o cancelamento completo. Revise o repositório manualmente.\n${target.error}`;
        } catch (abortError) { target.aborted = false; target.error += `\nFalha ao cancelar: ${(abortError as Error).message}`; }
      }
      target.phase = applying && !target.aborted ? 'interrupted' : 'failed';
      await this.save(); this.report(repo, target.error);
      return false;
    }
  }
  private async continue(execution: Execution) {
    for (const target of execution.targets) {
      if (target.phase === 'done') continue;
      if (!await this.apply(execution, target)) return;
    }
    execution.finished = true; await this.save();
    // Devolve o usuário ao ramo em que estava antes da sequência; se falhar, o cherry-pick já concluído não é afetado.
    if (execution.initialBranch) try {
      await this.git.checkout(execution.repoPath, execution.initialBranch);
      this.report(execution.repoPath, `Voltou para o ramo ${execution.initialBranch}.`);
    } catch (error) { this.report(execution.repoPath, `Sequência concluída, mas não foi possível voltar para ${execution.initialBranch}: ${(error as Error).message}`); }
  }
  async resume(repo: string, id: string, action: 'retry' | 'manual'): Promise<Execution> {
    const execution = this.executions.find(e => e.id === id && e.repoPath === repo && !e.finished);
    if (!execution) throw new Error('Sequência pendente não encontrada.');
    const target = execution.targets.find(t => t.phase !== 'done')!;
    const status = await this.git.ensureIdle(repo);
    const expected = await this.git.resolveBranch(repo, target.branch);
    if (action === 'manual' || target.failedAt === 'pushing') {
      if (status.branch !== expected.name) throw new Error(`Selecione manualmente o ramo ${expected.name} antes de retomar.`);
      const head = await this.git.head(repo);
      if (action === 'retry' && (!target.appliedHead || head !== target.appliedHead)) throw new Error('Os commits locais mudaram. Revise o resultado e utilize a confirmação de conclusão manual.');
      // Manual adoption requires an explicit UI acknowledgement; no reset or reapplication occurs.
      target.appliedHead = head;
      const info = target.remote && target.remoteBranch ? { remote: target.remote, remoteBranch: target.remoteBranch } : await this.git.pushInfo(repo);
      target.remote = info.remote; target.remoteBranch = info.remoteBranch;
      await this.phase(execution, target, 'pushing');
      try { await this.git.push(repo, info); await this.phase(execution, target, 'done'); }
      catch (error) { target.failedAt = 'pushing'; target.phase = 'failed'; target.error = (error as Error).message; await this.save(); return structuredClone(execution); }
    } else {
      if (target.phase === 'interrupted') throw new Error('Interrupção com estado incerto. Confira/conclua manualmente o destino e confirme a conclusão manual.');
      if (target.failedAt === 'applying' && (!target.aborted || status.branch !== expected.name || await this.git.head(repo) !== target.beforeHead)) throw new Error('O estado do destino mudou após o cancelamento. Revise e conclua manualmente.');
      target.phase = 'pending'; target.aborted = undefined; target.error = undefined;
    }
    await this.continue(execution);
    return structuredClone(execution);
  }
}
