import type { Api, Branch, Commit, CommitDetail, Execution, FileChange, Progress, PullRequestInfo, Snapshot, Status, SwitchMode } from '../models/domain';
import { planSchema, targetsFromFields } from '../models/validation';
import { formatReviewMessage, parseJiraIssue, reviewInputSchema, type ReviewMessage } from '../models/reviewMessage';
export type Tab = 'switch' | 'history' | 'commit' | 'cherry' | 'pr' | 'projects' | 'settings';
export interface ViewModel {
  snapshot: Snapshot; tab: Tab; busy: boolean; busyMessage: string; error: string; notice: string; status?: Status; branches: Branch[];
  switchTarget: string; switchMode: SwitchMode; historyRef: string; history: Commit[]; detail?: CommitDetail; selectedCommit: string;
  selectedCommitFile: string;
  source: string; sourceCommits: Commit[]; selectedCommits: string[]; targets: string[]; review: boolean;
  commitMessage: string; workingFile: string; workingStaged: boolean; workingDiff: string; progress: Progress[];
  manualConfirmed: boolean; loadingRepository: boolean;
  createBase: string; publishNew: boolean; installOnSwitch: boolean; prInfo?: PullRequestInfo; prSource: string; prTarget: string;
  dynamicBranches: boolean; branchRows: BranchRow[]; switchRow: number | null; dynamicPr: boolean; prRows: PrRow[];
  jiraIssue: string; prUrl: string; reviewMessages: ReviewMessage[]; reviewSearch: string; generatedReview?: ReviewMessage;
}
// Estado esperado de um arquivo logo após marcar/desmarcar, até o status real chegar.
function optimistic(f: FileChange, unstage: boolean): FileChange {
  if (unstage) return f.index === 'A' ? { ...f, index: '?', worktree: '?' } : { ...f, index: ' ', worktree: f.worktree !== ' ' ? f.worktree : f.index };
  return f.index === '?' ? { ...f, index: 'A', worktree: ' ' } : { ...f, index: f.worktree !== ' ' ? f.worktree : f.index, worktree: ' ' };
}
export interface BranchRow { name: string; base: string }
export interface PrRow { source: string; target: string; url?: string }
// Checks lembrados entre aberturas (só nesta máquina). Na primeira vez, todos desmarcados.
const preferenceKeys = ['dynamicBranches', 'dynamicPr', 'installOnSwitch'] as const;
function loadPreferences(): Partial<ViewModel> {
  try {
    const saved = JSON.parse(localStorage.getItem('preferences') ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(preferenceKeys.filter(key => typeof saved[key] === 'boolean').map(key => [key, saved[key]]));
  } catch { return {}; }
}
function savePreferences(state: ViewModel) {
  try { localStorage.setItem('preferences', JSON.stringify(Object.fromEntries(preferenceKeys.map(key => [key, state[key]])))); } catch { /* sem armazenamento: só não lembra */ }
}
export class AppController {
  private listeners = new Set<() => void>();
  private loadToken = 0;
  private stageQueue: Promise<void> = Promise.resolve();
  private pendingStages = 0;
  private state: ViewModel = {
    snapshot: { settings: { roots: [] }, repositories: [], executions: [] }, tab: 'switch', busy: false, busyMessage: '', error: '', notice: '', branches: [],
    switchTarget: '', switchMode: 'block', historyRef: 'HEAD', history: [], selectedCommit: '', selectedCommitFile: '', source: '', sourceCommits: [], selectedCommits: [], targets: ['', '', ''], review: false,
    commitMessage: '', workingFile: '', workingStaged: false, workingDiff: '', progress: [], manualConfirmed: false, loadingRepository: false,
    createBase: '', publishNew: true, installOnSwitch: false, prSource: '', prTarget: '',
    dynamicBranches: false, branchRows: [{ name: '', base: '' }], switchRow: null, dynamicPr: false, prRows: [{ source: '', target: '' }],
    jiraIssue: '', prUrl: '', reviewMessages: [], reviewSearch: '',
    ...loadPreferences()
  };
  constructor(private api: Api) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  set(patch: Partial<ViewModel>) {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l());
    if (preferenceKeys.some(key => key in patch)) savePreferences(this.state);
  }
  get id() { const id = this.state.snapshot.settings.activeRepository; if (!id) throw new Error('Selecione um projeto.'); return id; }
  get repository() { return this.state.snapshot.repositories.find(r => r.id === this.state.snapshot.settings.activeRepository); }
  get execution(): Execution | undefined { return this.state.snapshot.executions.find(e => e.repoPath === this.repository?.path); }
  connect() {
    const unsubscribe = this.api.onProgress(p => {
      this.set({ progress: [...this.state.progress.slice(-199), p] });
      if (/: (trocando ramo|instalando dependências|aplicando commits|enviando commits|concluído)$/.test(p.message)) {
        void this.api.snapshot().then(snapshot => {
          if (snapshot.settings.activeRepository === this.state.snapshot.settings.activeRepository) this.set({ snapshot });
        }).catch(() => {});
      }
    });
    const unsubscribeSnapshot = this.api.onSnapshot(snapshot => this.applySnapshot(snapshot));
    // Detecta alterações feitas fora do app (editor, terminal): consulta periódica na aba Commitar e ao voltar o foco para a janela.
    const timer = setInterval(() => { if (this.state.tab === 'commit') void this.pollStatus(); }, 2000);
    const onFocus = () => { void this.pollStatus(); };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('focus', onFocus);
    void this.initialize(); return () => { unsubscribe(); unsubscribeSnapshot(); clearInterval(timer); if (hasWindow) window.removeEventListener('focus', onFocus); };
  }
  private polling = false;
  // Atualização silenciosa: só mexe na tela se o status (ou o diff aberto) realmente mudou.
  private async pollStatus() {
    if (this.polling || this.state.busy || this.state.loadingRepository || this.pendingStages || typeof document !== 'undefined' && document.hidden || !this.repository || !this.state.status) return;
    this.polling = true;
    const id = this.id;
    try {
      const status = await this.api.status(id);
      if (this.pendingStages || this.state.busy || this.repository?.id !== id) return;
      if (JSON.stringify(status) !== JSON.stringify(this.state.status)) this.set({ status });
      const { workingFile } = this.state;
      if (!workingFile) return;
      const file = status.files.find(f => f.path === workingFile);
      if (!file) { this.set({ workingFile: '', workingDiff: '' }); return; }
      const staged = file.worktree === ' ';
      const diff = await this.api.workingDiff(id, workingFile, staged);
      if (this.repository?.id === id && this.state.workingFile === workingFile && !this.pendingStages && (diff !== this.state.workingDiff || staged !== this.state.workingStaged)) this.set({ workingDiff: diff, workingStaged: staged });
    } catch { /* falhas transitórias (ex.: git ocupado) são ignoradas; a próxima consulta tenta de novo */ }
    finally { this.polling = false; }
  }
  // Lista atualizada pela varredura em segundo plano ou por um projeto que deixou de existir.
  private applySnapshot(snapshot: Snapshot) {
    const hadRepository = !!this.repository;
    this.set({ snapshot });
    if (hadRepository && !this.repository) this.set({ status: undefined, branches: [], tab: 'projects', notice: 'O projeto aberto não foi mais encontrado e saiu da lista.' });
  }
  private async action(work: () => Promise<void>, refresh = false, busyMessage = 'Carregando...') {
    if (this.state.busy) return;
    this.set({ busy: true, busyMessage, error: '', notice: '' });
    try { await work(); } catch (error) { this.set({ error: (error as Error).message }); }
    finally {
      if (refresh) try { await this.refreshData(); } catch (error) { this.set({ error: [this.state.error, (error as Error).message].filter(Boolean).join('\n') }); }
      this.set({ busy: false, busyMessage: '' });
    }
  }
  // Cada carga invalida as anteriores: se o usuário trocar de projeto no meio, o resultado antigo é descartado.
  private async refreshData() {
    const token = ++this.loadToken;
    const snapshot = await this.api.snapshot(); if (token !== this.loadToken) return; this.set({ snapshot });
    if (!this.repository) { this.set({ status: undefined, branches: [] }); return; }
    const [status, branches] = await Promise.all([this.api.status(this.id), this.api.branches(this.id, false)]);
    if (token === this.loadToken) this.set({ status, branches });
  }
  // Carrega o estado do projeto sem bloquear a tela, para a lista de projetos continuar clicável.
  private async loadInBackground() {
    const token = this.loadToken + 1;
    this.set({ loadingRepository: true });
    try { await this.refreshData(); if (token === this.loadToken) this.prefillSource(); } catch (error) { if (token === this.loadToken) this.set({ error: (error as Error).message }); }
    finally { if (token === this.loadToken) this.set({ loadingRepository: false }); }
  }
  initialize = async () => { await this.loadInBackground(); if (!this.repository) this.set({ tab: 'projects' }); };
  refresh = () => this.action(() => this.refreshData());
  // "Usa pman" fica gravado em settings.json e vale para todo o aplicativo; padrão: desmarcado.
  get usePman() { return this.state.snapshot.settings.usePman ?? false; }
  // O pman na troca/criação só roda com o ajuste geral ligado E o check da aba marcado.
  get installOnSwitch() { return this.usePman && this.state.installOnSwitch; }
  setUsePman = (usePman: boolean) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ usePman }) }); });
  chooseRoot = () => this.action(async () => { this.set({ snapshot: await this.api.chooseRoot() }); });
  removeRoot = (root: string) => this.action(async () => { this.set({ snapshot: await this.api.removeRoot(root) }); }, true);
  scan = () => this.action(async () => { this.set({ snapshot: await this.api.scan() }); }, true, 'Procurando repositórios…');
  selectRepository = (id: string) => this.action(async () => {
    await this.api.selectRepository(id);
    this.set({ jiraIssue: '', prUrl: '', generatedReview: undefined });
    this.set({ status: undefined, branches: [], switchTarget: '', history: [], historyRef: 'HEAD', detail: undefined, source: '', sourceCommits: [], selectedCommits: [], targets: ['', '', ''], review: false, createBase: '', prInfo: undefined, prSource: '', prTarget: '', branchRows: [{ name: '', base: '' }], switchRow: null, prRows: [{ source: '', target: '' }], workingFile: '', workingDiff: '', commitMessage: '', progress: [], manualConfirmed: false, tab: 'switch' });
    void this.loadInBackground();
  });
  selectTab = (tab: Tab) => { this.set({ tab, detail: undefined, selectedCommit: '' }); if (tab === 'history' && this.repository) void this.loadHistory(this.state.historyRef); if (tab === 'pr') void this.loadPullRequest(); this.prefillSource(); };
  // No cherry-pick, a origem já começa no ramo atual; o usuário pode trocar.
  private prefillSource() {
    const branch = this.state.status?.branch;
    if (this.state.tab !== 'cherry' || this.state.source || !branch || branch.startsWith('(')) return;
    this.setSource(branch); void this.loadSource();
  }
  fetch = () => this.action(async () => { this.set({ branches: await this.api.branches(this.id, true), notice: 'Ramos remotos atualizados.' }); }, true);
  switchBranch = () => this.action(async () => {
    const result = await this.api.switchBranch(this.id, this.state.switchTarget, this.state.switchMode, this.installOnSwitch);
    this.set({ notice: `Pronto! Ramo ${result.branch} selecionado${this.installOnSwitch ? ' e dependências instaladas' : ''}.${result.stash ? ` Stash preservado: ${result.stash.slice(0, 10)}.` : ''}`, switchTarget: '' });
  }, true);
  createBranch = () => this.action(async () => {
    const name = this.state.switchTarget.trim(); const base = this.state.createBase || this.state.status?.branch || '';
    const result = await this.api.createBranch(this.id, name, base, this.state.switchMode, this.state.publishNew, this.installOnSwitch);
    this.set({ notice: `Pronto! Ramo ${result.branch} criado a partir de ${base}${result.published ? ' e enviado para o remoto' : ''}, selecionado${this.installOnSwitch ? ' e com dependências instaladas' : ''}.${result.stash ? ` Stash preservado: ${result.stash.slice(0, 10)}.` : ''}`, switchTarget: '', createBase: '' });
  }, true, 'Criando ramo…');
  // Pull request: origem começa no ramo atual e destino no ramo padrão do remoto.
  private async loadPullRequest() {
    if (!this.repository) return;
    try {
      const id = this.id; const [prInfo, reviewMessages] = await Promise.all([this.api.pullRequestInfo(id), this.api.reviewHistory()]);
      if (this.repository?.id !== id) return;
      const current = this.state.status?.branch;
      const source = current && !current.startsWith('(') ? current : '';
      const [first, ...rest] = this.state.prRows;
      this.set({ prInfo, reviewMessages, prSource: this.state.prSource || source, prTarget: this.state.prTarget || prInfo.defaultTarget || '', prRows: [{ ...first, source: first.source || source, target: first.target || prInfo.defaultTarget || '' }, ...rest] });
    } catch (error) { this.set({ error: (error as Error).message }); }
  }
  // Criação dinâmica: até 4 ramos, cada um com sua base; no máximo um vira o ramo atual.
  setBranchRow = (index: number, patch: Partial<BranchRow>) => this.set({ branchRows: this.state.branchRows.map((row, i) => i === index ? { ...row, ...patch } : row) });
  addBranchRow = () => { if (this.state.branchRows.length < 4) this.set({ branchRows: [...this.state.branchRows, { name: '', base: '' }] }); };
  removeBranchRow = (index: number) => {
    const rows = this.state.branchRows.filter((_, i) => i !== index); const current = this.state.switchRow;
    this.set({ branchRows: rows.length ? rows : [{ name: '', base: '' }], switchRow: current === null || current === index ? null : current > index ? current - 1 : current });
  };
  toggleSwitchRow = (index: number) => this.set({ switchRow: this.state.switchRow === index ? null : index });
  createBranches = () => this.action(async () => {
    const current = this.state.status?.branch ?? '';
    const items = this.state.branchRows.map(row => ({ name: row.name.trim(), base: row.base.trim() || current }));
    const result = await this.api.createBranches(this.id, items, this.state.switchRow, this.state.switchMode, this.state.publishNew, this.installOnSwitch);
    const parts = [`Ramos criados: ${result.created.join(', ')}.`];
    if (result.published.length) parts.push(`Enviados para o remoto: ${result.published.join(', ')}.`);
    if (result.branch) parts.push(`Ramo atual: ${result.branch}${this.installOnSwitch ? ', dependências instaladas' : ''}.`);
    if (result.stash) parts.push(`Stash preservado: ${result.stash.slice(0, 10)}.`);
    this.set({ notice: parts.join(' '), branchRows: [{ name: '', base: '' }], switchRow: null, ...(result.failures.length ? { error: `Falha ao enviar para o remoto:\n${result.failures.join('\n')}` } : {}) });
  }, true, 'Criando ramos…');
  // PR dinâmico: até 4 pares origem → destino, abertos de uma vez.
  setPrRow = (index: number, patch: Partial<PrRow>) => this.set({ prRows: this.state.prRows.map((row, i) => i === index ? { ...row, ...patch, url: undefined } : row) });
  setSinglePr = (patch: Partial<Pick<ViewModel, 'prSource' | 'prTarget'>>) => this.set({ ...patch, prUrl: '' });
  get reviewInput() {
    return { issue: this.state.jiraIssue, prs: this.state.dynamicPr ? this.state.prRows.map(row => ({ target: row.target, url: row.url ?? '' })) : [{ target: this.state.prTarget, url: this.state.prUrl }] };
  }
  get reviewPreview() {
    if (this.state.generatedReview) return { ...this.state.generatedReview, ...formatReviewMessage(this.state.generatedReview) };
    try {
      const input = reviewInputSchema.parse(this.reviewInput);
      const remote = this.state.prInfo?.remote;
      const prs = input.prs.map(pr => ({ ...pr, target: remote && pr.target.startsWith(remote + '/') ? pr.target.slice(remote.length + 1) : pr.target }));
      const issue = parseJiraIssue(input.issue);
      return { issue, prs, ...formatReviewMessage({ issue, prs }) };
    } catch { return undefined; }
  }
  findPullRequests = () => this.action(async () => {
    parseJiraIssue(this.state.jiraIssue);
    const pairs = this.state.dynamicPr ? this.state.prRows : [{ source: this.state.prSource, target: this.state.prTarget }];
    const found = await this.api.findPullRequests(this.id, pairs.map(({ source, target }) => ({ source: source.trim(), target: target.trim() })));
    if (this.state.dynamicPr) this.set({ prRows: this.state.prRows.map((row, index) => ({ ...row, url: found[index].url })) });
    else this.set({ prUrl: found[0].url });
    const generatedReview = await this.api.saveReviewMessage(this.id, this.reviewInput);
    this.set({ generatedReview });
    this.set({ reviewMessages: await this.api.reviewHistory(), notice: 'PRs encontrados. Mensagem gerada e salva no histórico; pronta para copiar.' });
  }, false, 'Buscando os PRs no Azure…');
  copyReview = () => this.action(async () => {
    const message = this.state.generatedReview ?? await this.api.saveReviewMessage(this.id, this.reviewInput);
    this.set({ reviewMessages: await this.api.reviewHistory() });
    await this.api.copyReviewMessage(message.id);
    this.set({ notice: 'Mensagem copiada com o link formatado do Jira. Cole no Google Chat com Ctrl+V.' });
  });
  copyPreviousReview = (messageId: string) => this.action(async () => {
    await this.api.copyReviewMessage(messageId);
    this.set({ notice: 'Mensagem do histórico copiada com a saudação do horário atual. Cole no Google Chat com Ctrl+V.' });
  });
  openReviewLink = (url: string) => this.action(async () => { await this.api.openReviewLink(url); });
  updateReviewIssue = async (messageId: string, issue: string) => {
    let updated = false;
    await this.action(async () => {
      const message = await this.api.updateReviewIssue(messageId, issue);
      this.set({ reviewMessages: this.state.reviewMessages.map(item => item.id === message.id ? message : item), ...(this.state.generatedReview?.id === message.id ? { generatedReview: message } : {}), reviewSearch: '', notice: 'Issue Jira atualizada na mensagem e no histórico.' });
      updated = true;
    });
    return updated;
  };
  addPrRow = () => { if (this.state.prRows.length < 4) this.set({ prRows: [...this.state.prRows, { source: this.state.prRows[0]?.source ?? '', target: '' }] }); };
  removePrRow = (index: number) => { const rows = this.state.prRows.filter((_, i) => i !== index); this.set({ prRows: rows.length ? rows : [{ source: '', target: '' }] }); };
  createPullRequests = () => this.action(async () => {
    parseJiraIssue(this.state.jiraIssue);
    const pairs = this.state.dynamicPr ? this.state.prRows : [{ source: this.state.prSource, target: this.state.prTarget }];
    const result = await this.api.createPullRequests(this.id, pairs.map(({ source, target }) => ({ source: source.trim(), target: target.trim() })), this.state.jiraIssue);
    this.set({ generatedReview: result.message });
    const remote = this.state.prInfo?.remote;
    const short = (value: string) => remote && value.trim().startsWith(remote + '/') ? value.trim().slice(remote.length + 1) : value.trim();
    const urlFor = (row: PrRow) => result.prs.find(pr => pr.source === short(row.source) && pr.target === short(row.target))?.url;
    if (this.state.dynamicPr) this.set({ prRows: this.state.prRows.map(row => ({ ...row, url: urlFor(row) })) });
    else this.set({ prUrl: urlFor(pairs[0]) ?? '' });
    if (!result.error) this.set({ jiraIssue: '', prSource: '', prTarget: '', prUrl: '', prRows: [{ source: '', target: '' }] });
    this.set({ error: result.error ?? '', notice: `${result.prs.filter(pr => pr.created).length} PR(s) criado(s), ${result.prs.filter(pr => !pr.created).length} já existente(s).${result.error ? ' Os resultados concluídos foram preservados; tente novamente para continuar.' : ' Descrições preenchidas com as mensagens dos commits. Mensagem para revisão pronta para copiar.'}` });
    this.set({ reviewMessages: await this.api.reviewHistory() });
  }, false, 'Criando PRs com as mensagens dos commits…');
  runPman = () => this.action(async () => { await this.api.runPman(this.id); this.set({ notice: 'Dependências instaladas.' }); }, true);
  loadHistory = (ref: string, more = false) => this.action(async () => {
    this.set({ historyRef: ref });
    const commits = await this.api.log(this.id, ref, more ? this.state.history.length : 0);
    this.set({ history: more ? [...this.state.history, ...commits] : commits, detail: undefined, selectedCommit: '' });
  });
  showCommit = (hash: string) => this.action(async () => {
    this.set({ detail: undefined, selectedCommit: hash, selectedCommitFile: '' });
    this.set({ detail: await this.api.detail(this.id, hash) });
  }, false, 'Carregando alterações do commit...');
  showCommitFile = (file: string) => this.action(async () => {
    const diff = await this.api.commitFileDiff(this.id, this.state.selectedCommit, file);
    if (this.state.detail) this.set({ detail: { ...this.state.detail, diff }, selectedCommitFile: file });
  }, false, 'Carregando alterações do arquivo...');
  setSource = (source: string) => { this.set({ source, sourceCommits: [], selectedCommits: [], review: false, detail: undefined }); };
  loadSource = (more = false) => this.action(async () => {
    const commits = await this.api.log(this.id, this.state.source, more ? this.state.sourceCommits.length : 0);
    this.set({ sourceCommits: more ? [...this.state.sourceCommits, ...commits] : commits, ...(more ? {} : { selectedCommits: [] }), review: false });
  });
  toggleCommit = (hash: string) => this.set({ selectedCommits: this.state.selectedCommits.includes(hash) ? this.state.selectedCommits.filter(c => c !== hash) : [...this.state.selectedCommits, hash], review: false });
  setTarget = (index: number, value: string) => { const targets = [...this.state.targets]; targets[index] = value; if (!value) targets.fill('', index + 1); this.set({ targets, review: false }); };
  review = () => { try { planSchema.parse({ source: this.state.source, commits: this.state.selectedCommits, targets: targetsFromFields(this.state.targets) }); this.set({ review: true, error: '' }); } catch { this.set({ error: 'Selecione a origem, pelo menos um commit e destinos diferentes preenchidos em sequência.' }); } };
  execute = () => this.action(async () => {
    const execution = await this.api.cherryPick(this.id, { source: this.state.source, commits: this.state.selectedCommits, targets: targetsFromFields(this.state.targets) });
    this.set({ review: false, manualConfirmed: false, notice: execution.finished ? 'Todos os destinos receberam os commits e o push foi concluído.' : 'Sequência interrompida. Confira o destino abaixo.' });
  }, true);
  cancelCherryPick = () => this.action(async () => {
    const execution = this.execution;
    if (!execution || execution.finished) return;
    await this.api.cancelCherryPick(this.id, execution.id);
    this.set({ review: false, manualConfirmed: false, notice: 'Sequência cancelada. Você pode preparar um novo cherry-pick. Os commits e arquivos foram preservados; se houver uma operação Git em andamento, resolva-a antes de executar a nova sequência.' });
  }, true);
  resume = (action: 'retry' | 'manual') => this.action(async () => {
    const execution = this.execution;
    if (!execution || action === 'manual' && !this.state.manualConfirmed) return;
    const result = await this.api.resume(this.id, execution.id, action);
    this.set({ manualConfirmed: false, notice: result.finished ? 'Sequência concluída e enviada.' : 'Confira o estado da sequência.' });
  }, true);
  // Marca/desmarca na hora; o git add/restore roda numa fila em segundo plano e o status real é sincronizado no fim.
  stage = (paths: string[], unstage = false) => {
    const status = this.state.status; if (!status || !paths.length) return this.stageQueue;
    const selected = new Set(paths);
    this.set({ status: { ...status, files: status.files.map(f => selected.has(f.path) ? optimistic(f, unstage) : f) }, error: '' });
    const id = this.id; this.pendingStages++;
    this.stageQueue = this.stageQueue
      .then(() => this.api.stage(id, paths, unstage))
      .catch(error => { if (this.repository?.id === id) this.set({ error: (error as Error).message }); })
      .finally(async () => { if (--this.pendingStages === 0) await this.syncStatus(id, paths); });
    return this.stageQueue;
  };
  private async syncStatus(id: string, touched: string[]) {
    try {
      const status = await this.api.status(id);
      if (this.pendingStages || this.repository?.id !== id) return;
      this.set({ status });
      const file = status.files.find(f => f.path === this.state.workingFile);
      if (file && touched.includes(file.path)) this.set({ workingDiff: await this.api.workingDiff(id, file.path, file.worktree === ' '), workingStaged: file.worktree === ' ' });
      else if (!file && this.state.workingFile) this.set({ workingFile: '', workingDiff: '' });
    } catch (error) { if (this.repository?.id === id) this.set({ error: (error as Error).message }); }
  }
  discard = (files: string[]) => this.action(async () => {
    await this.stageQueue;
    await this.api.discard(this.id, files);
    this.set({ notice: files.length === 1 ? 'Alterações descartadas.' : `Alterações de ${files.length} arquivos descartadas.`, ...(files.includes(this.state.workingFile) ? { workingFile: '', workingDiff: '' } : {}) });
  }, true, 'Descartando alterações…');
  showWorkingDiff = (file: string, staged: boolean) => this.action(async () => { this.set({ workingDiff: await this.api.workingDiff(this.id, file, staged), workingFile: file, workingStaged: staged }); });
  commit = () => this.action(async () => { await this.stageQueue; await this.api.commit(this.id, this.state.commitMessage); this.set({ commitMessage: '', workingDiff: '', workingFile: '', notice: 'Commit criado. Use Enviar commits para fazer o push.' }); }, true);
  push = () => this.action(async () => { await this.stageQueue; await this.api.push(this.id); this.set({ notice: 'Push concluído.' }); }, true);
}
