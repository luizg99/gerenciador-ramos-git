import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/controllers/appController';
import type { Api, Snapshot, Status } from '../src/models/domain';
const a = { id: 'a'.repeat(24), path: 'C:/p/a', name: 'a' };
const b = { id: 'b'.repeat(24), path: 'C:/p/b', name: 'b' };
const status = (branch: string): Status => ({ branch, files: [], operation: null, ahead: 0, behind: 0, upstream: null });
function fakeApi() {
  let active = a.id;
  const pending = new Map<string, (value: Status) => void>();
  const snapshot = (): Snapshot => ({ settings: { roots: ['C:/p'], activeRepository: active }, repositories: [a, b], executions: [] });
  const api = {
    snapshot: async () => snapshot(),
    status: (id: string) => new Promise<Status>(resolve => pending.set(id, resolve)),
    branches: async () => [],
    log: vi.fn(async () => [{ hash: 'c'.repeat(40), subject: 'Commit', author: 'Eu', date: '2026-10-05', parents: ['d'.repeat(40)] }]),
    selectRepository: vi.fn(async (id: string) => { active = id; }),
    onProgress: () => () => {}, onSnapshot: () => () => {}
  } as unknown as Api;
  return { api, finish: (id: string, branch: string) => pending.get(id)!(status(branch)) };
}
describe('AppController', () => {
  it('abre quatro PRs, ignora linhas incompletas e lembra destinos somente quando marcado', async () => {
    const createPullRequests = vi.fn(async () => ({ prs: [{ source: 'feature', target: 'main', url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/1', created: true }] }));
    const updateSettings = vi.fn(async () => ({ settings: { roots: [] }, repositories: [], executions: [] }));
    const api = { createPullRequests, updateSettings, reviewHistory: async () => [] } as unknown as Api;
    const c = new AppController(api);
    c.set({ snapshot: { settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] } });
    expect(c.getSnapshot().prRows).toHaveLength(4);
    c.setPrRow(0, { source: 'feature', target: 'main' });
    c.setPrRow(1, { source: 'other' });
    c.setRememberPrDestinations(true);
    expect(updateSettings).toHaveBeenCalledWith({ ui: { rememberPrDestinations: true } });
    await c.createPullRequests();
    expect(createPullRequests).toHaveBeenCalledWith(a.id, [{ source: 'feature', target: 'main' }], '');
    expect(c.getSnapshot().prRows.map(row => row.target)).toEqual(['main', '', '', '']);
    expect(c.getSnapshot().snapshot.settings.ui?.prDestinations).toEqual({ [a.id]: ['main'] });
    expect(updateSettings).toHaveBeenLastCalledWith({ ui: { prDestinations: { [a.id]: ['main'] } } });
    c.setRememberPrDestinations(false);
    expect(c.getSnapshot().prRows.every(row => !row.target)).toBe(true);
    expect(c.getSnapshot().snapshot.settings.ui?.prDestinations).toEqual({ [a.id]: [] });
  });
  it('preenche as origens com pushes recentes sem sobrescrever uma limpeza feita pelo usuário', async () => {
    let finishRecent!: (branches: string[]) => void;
    const recent = new Promise<string[]>(resolve => { finishRecent = resolve; });
    const api = {
      pullRequestInfo: async () => ({ remote: 'origin', remoteUrl: 'https://dev.azure.com/org/project/_git/repo', webUrl: 'https://dev.azure.com/org/project/_git/repo', defaultTarget: 'main' }),
      reviewHistory: async () => [], recentPushBranches: () => recent
    } as unknown as Api;
    const c = new AppController(api);
    c.set({ snapshot: { settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] }, status: status('current') });
    c.selectTab('pr');
    await vi.waitFor(() => expect(c.getSnapshot().prInfo?.remote).toBe('origin'));
    expect(c.getSnapshot().prRows[0].source).toBe('current');
    c.clearPrSources();
    finishRecent(['old', 'new']);
    await vi.waitFor(() => expect(c.getSnapshot().prRows.every(row => !row.source)).toBe(true));
    c.selectTab('switch'); c.selectTab('pr');
    await vi.waitFor(() => expect(c.getSnapshot().prRows.map(row => row.source)).toEqual(['old', 'new', '', '']));
  });
  it('deixa trocar de projeto enquanto o anterior ainda carrega e descarta o resultado antigo', async () => {
    const { api, finish } = fakeApi(); const c = new AppController(api);
    c.connect();
    await vi.waitFor(() => expect(c.getSnapshot().loadingRepository).toBe(true));
    expect(c.getSnapshot().busy).toBe(false);
    await c.selectRepository(b.id);
    expect(api.selectRepository).toHaveBeenCalledWith(b.id);
    await vi.waitFor(() => expect(c.getSnapshot().snapshot.settings.activeRepository).toBe(b.id));
    finish(a.id, 'ramo-de-a');
    finish(b.id, 'ramo-de-b');
    await vi.waitFor(() => expect(c.getSnapshot().loadingRepository).toBe(false));
    expect(c.getSnapshot().status?.branch).toBe('ramo-de-b');
  });
  it('cherry-pick já começa com o ramo atual como origem e carrega seus commits', async () => {
    const { api, finish } = fakeApi(); const c = new AppController(api);
    c.connect(); await vi.waitFor(() => expect(c.getSnapshot().loadingRepository).toBe(true));
    finish(a.id, 'feature/atual'); await vi.waitFor(() => expect(c.getSnapshot().status?.branch).toBe('feature/atual'));
    c.selectTab('cherry');
    expect(c.getSnapshot().source).toBe('feature/atual');
    await vi.waitFor(() => expect(c.getSnapshot().sourceCommits).toHaveLength(1));
    expect(api.log).toHaveBeenCalledWith(a.id, 'feature/atual', 0);
    c.setSource('outro'); c.selectTab('switch'); c.selectTab('cherry');
    expect(c.getSnapshot().source).toBe('outro');
  });
  it('lembra os checks e a organização Azure entre aberturas, lendo do settings.json', async () => {
    const saved = { roots: [], activeRepository: a.id, ui: { dynamicBranches: true, installOnSwitch: true, rememberPrDestinations: true, azureOrganizationUrl: 'https://totvstfs.visualstudio.com/Linha-Winthor', prDestinations: { [a.id]: ['main'] } } };
    const first = new AppController(fakeApi().api);
    expect(first.getSnapshot()).toMatchObject({ dynamicBranches: false, dynamicPr: true, installOnSwitch: false, rememberPrDestinations: false, publishNew: true });
    expect(first.getSnapshot().prRows).toHaveLength(4);
    const api = { snapshot: async () => ({ settings: saved, repositories: [a], executions: [] }), status: async () => status('main'), branches: async () => [], onProgress: () => () => {}, onSnapshot: () => () => {} } as unknown as Api;
    const second = new AppController(api); second.connect();
    await vi.waitFor(() => expect(second.getSnapshot().loadingRepository).toBe(false));
    expect(second.getSnapshot()).toMatchObject({ dynamicBranches: true, dynamicPr: true, installOnSwitch: true, rememberPrDestinations: true, publishNew: true, switchRow: 0 });
    expect(second.azureOrganizationUrl).toBe('https://totvstfs.visualstudio.com/Linha-Winthor');
  });
  it('criação dinâmica começa com 4 linhas e ignora as vazias ao criar', async () => {
    const createBranches = vi.fn(async () => ({ created: ['x', 'y'], published: [], failures: [] }));
    const api = { ...fakeApi().api, createBranches, snapshot: async () => ({ settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] }), status: async () => status('main'), branches: async () => [] } as unknown as Api;
    const c = new AppController(api); c.connect();
    await vi.waitFor(() => expect(c.getSnapshot().loadingRepository).toBe(false));
    expect(c.getSnapshot().branchRows).toHaveLength(4);
    c.setBranchRow(1, { name: 'x' }); c.setBranchRow(3, { name: ' y ', base: 'x' });
    c.set({ switchRow: 3 });
    await c.createBranches();
    expect(createBranches).toHaveBeenCalledWith(a.id, [{ name: 'x', base: 'main' }, { name: 'y', base: 'x' }], 1, 'block', true, false);
    expect(c.getSnapshot().branchRows).toHaveLength(4);
  });
  it('abre o TortoiseGit uma vez e bloqueia novos cliques por 5 segundos', async () => {
    vi.useFakeTimers();
    try {
      const openTortoise = vi.fn(async () => {});
      const c = new AppController({ openTortoise } as unknown as Api);
      c.set({ snapshot: { settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] } });
      await c.openTortoise('log', { rev: 'abc' }); await c.openTortoise('log', { rev: 'def' });
      expect(openTortoise).toHaveBeenCalledTimes(1);
      expect(c.getSnapshot().tortoiseLocked).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(c.getSnapshot().tortoiseLocked).toBe(false);
      await c.openTortoise('commit');
      expect(openTortoise).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('linhas dinâmicas: até 4, remoção ajusta qual ramo será o atual', () => {
    const c = new AppController(fakeApi().api);
    for (let i = 0; i < 5; i++) c.addBranchRow();
    expect(c.getSnapshot().branchRows).toHaveLength(4);
    c.toggleSwitchRow(2); c.removeBranchRow(0); expect(c.getSnapshot().switchRow).toBe(1);
    c.removeBranchRow(1); expect(c.getSnapshot().switchRow).toBe(0);
    c.toggleSwitchRow(0); expect(c.getSnapshot().switchRow).toBeNull();
  });
});
