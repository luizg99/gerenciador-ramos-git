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
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
    try {
      const createPullRequests = vi.fn(async () => ({ prs: [{ source: 'feature', target: 'main', url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/1', created: true }] }));
      const api = { createPullRequests, reviewHistory: async () => [] } as unknown as Api;
      const c = new AppController(api);
      c.set({ snapshot: { settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] } });
      expect(c.getSnapshot().prRows).toHaveLength(4);
      c.setPrRow(0, { source: 'feature', target: 'main' });
      c.setPrRow(1, { source: 'other' });
      c.setRememberPrDestinations(true);
      await c.createPullRequests();
      expect(createPullRequests).toHaveBeenCalledWith(a.id, [{ source: 'feature', target: 'main' }], '');
      expect(c.getSnapshot().prRows.map(row => row.target)).toEqual(['main', '', '', '']);
      c.setRememberPrDestinations(false);
      expect(c.getSnapshot().prRows.every(row => !row.target)).toBe(true);
      expect(store.get(`prDestinations:${a.id}`)).toBe('[]');
    } finally { vi.unstubAllGlobals(); }
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
  it('marca e desmarca arquivos na hora e sincroniza com o Git em segundo plano, em ordem', async () => {
    const files = [{ path: 'a.txt', index: ' ', worktree: 'M' }, { path: 'novo.txt', index: '?', worktree: '?' }];
    const calls: string[] = []; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const api = {
      snapshot: async () => ({ settings: { roots: [], activeRepository: a.id }, repositories: [a], executions: [] }),
      status: vi.fn(async () => ({ ...status('main'), files: [{ path: 'a.txt', index: 'M', worktree: ' ' }, { path: 'novo.txt', index: '?', worktree: '?' }] })),
      branches: async () => [],
      stage: vi.fn(async (_id: string, paths: string[], unstage: boolean) => { calls.push(`${unstage ? '-' : '+'}${paths.join()}`); await gate; }),
      onProgress: () => () => {}, onSnapshot: () => () => {}
    } as unknown as Api;
    const c = new AppController(api); c.connect();
    await vi.waitFor(() => expect(c.getSnapshot().loadingRepository).toBe(false));
    c.set({ status: { ...status('main'), files } });
    const done = [c.stage(['a.txt']), c.stage(['novo.txt']), c.stage(['novo.txt'], true)];
    const now = c.getSnapshot();
    expect(now.busy).toBe(false);
    expect(now.status?.files).toEqual([{ path: 'a.txt', index: 'M', worktree: ' ' }, { path: 'novo.txt', index: '?', worktree: '?' }]);
    await vi.waitFor(() => expect(calls).toEqual(['+a.txt']));
    release(); await Promise.all(done);
    expect(calls).toEqual(['+a.txt', '+novo.txt', '-novo.txt']);
    await vi.waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
  });
  it('lembra os checks entre aberturas e começa com tudo desmarcado', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    try {
      const first = new AppController(fakeApi().api);
      expect(first.getSnapshot()).toMatchObject({ dynamicBranches: false, dynamicPr: true, installOnSwitch: false, publishNew: true });
      expect(first.getSnapshot().prRows).toHaveLength(4);
      first.set({ dynamicBranches: true, installOnSwitch: true });
      const second = new AppController(fakeApi().api);
      expect(second.getSnapshot()).toMatchObject({ dynamicBranches: true, dynamicPr: true, installOnSwitch: true, publishNew: true, switchRow: 0 });
    } finally { vi.unstubAllGlobals(); }
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
