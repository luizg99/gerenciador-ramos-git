import type { Api, Branch, CloneSource, Commit, Execution, Progress, PullRequestInfo, RemoteRepository, Snapshot, Status, SwitchMode, TortoiseOptions, UiPreferences } from '../models/domain';
import { planSchema, targetsFromFields } from '../models/validation';
import { formatReviewMessage, parseJiraIssue, reviewInputSchema, type ReviewMessage } from '../models/reviewMessage';
export type Tab = 'switch' | 'history' | 'commit' | 'cherry' | 'pr' | 'projects' | 'settings' | 'gemini' | 'jira';
export interface ViewModel {
  snapshot: Snapshot; tab: Tab; busy: boolean; busyMessage: string; error: string; notice: string; status?: Status; branches: Branch[];
  switchTarget: string; switchMode: SwitchMode; historyRef: string; history: Commit[];
  tortoiseLocked: boolean; tortoiseOpened: boolean;
  source: string; sourceCommits: Commit[]; selectedCommits: string[]; targets: string[]; review: boolean;
  progress: Progress[];
  manualConfirmed: boolean; loadingRepository: boolean;
  createBase: string; publishNew: boolean; installOnSwitch: boolean; prInfo?: PullRequestInfo; prSource: string; prTarget: string;
  dynamicBranches: boolean; branchRows: BranchRow[]; switchRow: number | null; dynamicPr: boolean; prRows: PrRow[]; rememberPrDestinations: boolean;
  jiraIssue: string; prUrl: string; reviewMessages: ReviewMessage[]; reviewSearch: string; generatedReview?: ReviewMessage;
}
export interface BranchRow { name: string; base: string }
export interface PrRow { source: string; target: string; url?: string }
// Checks lembrados entre aberturas: ficam no settings.json (não dependem do armazenamento do navegador).
const preferenceKeys = ['dynamicBranches', 'installOnSwitch', 'rememberPrDestinations'] as const;
const emptyPrRows = (targets: string[] = []): PrRow[] => Array.from({ length: 4 }, (_, index) => ({ source: '', target: targets[index] ?? '' }));
const emptyBranchRows = (): BranchRow[] => Array.from({ length: 4 }, () => ({ name: '', base: '' }));
export class AppController {
  private hydrated = false;
  private listeners = new Set<() => void>();
  private loadToken = 0;
  private prLoadToken = 0;
  private prSourcesVersion = 0;
  private state: ViewModel = {
    snapshot: { settings: { roots: [] }, repositories: [], executions: [] }, tab: 'switch', busy: false, busyMessage: '', error: '', notice: '', branches: [],
    switchTarget: '', switchMode: 'block', historyRef: 'HEAD', history: [], tortoiseLocked: false, tortoiseOpened: false, source: '', sourceCommits: [], selectedCommits: [], targets: ['', '', ''], review: false,
    progress: [], manualConfirmed: false, loadingRepository: false,
    createBase: '', publishNew: true, installOnSwitch: false, prSource: '', prTarget: '',
    dynamicBranches: false, branchRows: emptyBranchRows(), switchRow: null, dynamicPr: true, prRows: emptyPrRows(), rememberPrDestinations: false,
    jiraIssue: '', prUrl: '', reviewMessages: [], reviewSearch: ''
  };
  constructor(private api: Api) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  set(patch: Partial<ViewModel>) {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l());
    const changed = preferenceKeys.filter(key => key in patch);
    if (changed.length) this.savePreferences(Object.fromEntries(changed.map(key => [key, this.state[key]])));
  }
  // Grava no settings.json sem bloquear a tela; o estado local é atualizado na hora.
  private savePreferences(patch: UiPreferences) {
    const snapshot = this.state.snapshot;
    this.state = { ...this.state, snapshot: { ...snapshot, settings: { ...snapshot.settings, ui: { ...snapshot.settings.ui, ...patch } } } };
    void Promise.resolve(this.api.updateSettings?.({ ui: patch })).catch(() => {});
  }
  // Na primeira carga, aplica as preferências salvas.
  private hydrate(snapshot: Snapshot) {
    if (this.hydrated) return;
    this.hydrated = true;
    const ui = snapshot.settings.ui ?? {};
    const dynamicBranches = ui.dynamicBranches ?? false;
    this.state = { ...this.state, dynamicBranches, installOnSwitch: ui.installOnSwitch ?? false, rememberPrDestinations: ui.rememberPrDestinations ?? false, switchRow: dynamicBranches ? 0 : null };
  }
  get azureOrganizationUrl() { return this.state.snapshot.settings.ui?.azureOrganizationUrl ?? ''; }
  saveAzureOrganization = (value: string) => { const url = value.trim(); if (url && url !== this.azureOrganizationUrl) this.savePreferences({ azureOrganizationUrl: url }); };
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
    // Detecta alterações feitas fora do app (editor, TortoiseGit): a cada 1 s na aba de commit, a cada 5 s nas outras e ao voltar o foco.
    let tick = 0;
    const timer = setInterval(() => { tick++; if (this.state.tab === 'commit' || tick % 5 === 0) void this.pollStatus(); }, 1000);
    const onFocus = () => { void this.pollStatus(); };
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('focus', onFocus);
    void this.initialize(); return () => { unsubscribe(); unsubscribeSnapshot(); clearInterval(timer); if (hasWindow) window.removeEventListener('focus', onFocus); };
  }
  private polling = false;
  // Atualização silenciosa: só mexe na tela se o status (ou o diff aberto) realmente mudou.
  private async pollStatus() {
    if (this.polling || this.state.busy || this.state.loadingRepository || typeof document !== 'undefined' && document.hidden || !this.repository || !this.state.status) return;
    this.polling = true;
    const id = this.id;
    try {
      const status = await this.api.status(id);
      if (this.state.busy || this.repository?.id !== id) return;
      if (JSON.stringify(status) !== JSON.stringify(this.state.status)) this.set({ status });
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
    const snapshot = await this.api.snapshot(); if (token !== this.loadToken) return; this.hydrate(snapshot); this.set({ snapshot });
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
  get useGemini() { return this.state.snapshot.settings.useGemini ?? false; }
  get useJira() { return this.state.snapshot.settings.useJira ?? false; }
  get theme() { return this.state.snapshot.settings.theme ?? 'dark'; }
  setTheme = (theme: 'light' | 'dark') => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ theme }) }); });
  get useAzure() { return this.state.snapshot.settings.useAzure ?? false; }
  // O pman na troca/criação só roda com o ajuste geral ligado E o check da aba marcado.
  get installOnSwitch() { return this.usePman && this.state.installOnSwitch; }
  setUsePman = (usePman: boolean) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ usePman }) }); });
  setUseGemini = (useGemini: boolean) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ useGemini }) }); });
  setUseJira = (useJira: boolean) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ useJira }) }); });
  setUseAzure = (useAzure: boolean) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ useAzure }) }); });
  chooseRoot = () => this.action(async () => { this.set({ snapshot: await this.api.chooseRoot() }); });
  defaultCloneFolder = () => this.api.defaultCloneFolder();
  chooseCloneFolder = (current?: string) => this.api.chooseCloneFolder(current);
  listAzureRepositories = (organizationUrl: string, project: string): Promise<RemoteRepository[]> => this.api.listAzureRepositories(organizationUrl, project);
  listGitHubRepositories = (source: 'github' | 'enterprise', enterpriseUrl: string): Promise<RemoteRepository[]> => this.api.listGitHubRepositories(source, enterpriseUrl);
  cloneRepository = (source: CloneSource, url: string, parent: string, name: string) => this.action(async () => {
    const snapshot = await this.api.cloneRepository(source, url, parent, name);
    this.set({ snapshot, notice: `Repositório ${name} clonado em ${parent}.` });
  }, false, 'Clonando repositório…');
  chooseReviewHistoryFolder = () => this.action(async () => { this.set({ snapshot: await this.api.chooseReviewHistoryFolder() }); });
  setReviewHistoryPath = (reviewHistoryPath?: string) => this.action(async () => { this.set({ snapshot: await this.api.updateSettings({ reviewHistoryPath }) }); });
  removeRoot = (root: string) => this.action(async () => { this.set({ snapshot: await this.api.removeRoot(root) }); }, true);
  scan = () => this.action(async () => { this.set({ snapshot: await this.api.scan() }); }, true, 'Procurando repositórios…');
  selectRepository = (id: string) => this.action(async () => {
    await this.api.selectRepository(id);
    this.prSourcesVersion++;
    this.set({ jiraIssue: '', prUrl: '', generatedReview: undefined });
    this.set({ status: undefined, branches: [], switchTarget: '', history: [], historyRef: 'HEAD', source: '', sourceCommits: [], selectedCommits: [], targets: ['', '', ''], review: false, createBase: '', prInfo: undefined, prSource: '', prTarget: '', branchRows: emptyBranchRows(), switchRow: this.state.dynamicBranches ? 0 : null, prRows: emptyPrRows(this.savedPrDestinations(id)), progress: [], manualConfirmed: false, tab: 'switch' });
    void this.loadInBackground();
  });
  selectTab = (tab: Tab) => { this.set({ tab }); if (tab === 'history' && this.repository) void this.loadHistory(this.state.historyRef); if (tab === 'pr') void this.loadPullRequest(); this.prefillSource(); };
  // No cherry-pick, a origem já começa no ramo atual; o usuário pode trocar.
  private prefillSource() {
    const branch = this.state.status?.branch;
    if (this.state.tab !== 'cherry' || this.state.source || !branch || branch.startsWith('(')) return;
    this.setSource(branch); void this.loadSource();
  }
  fetch = () => this.action(async () => {
    const branch = this.state.status?.upstream?.split('/').slice(1).join('/') || this.state.status?.branch;
    this.set({ branches: await this.api.fetchCurrentBranch(this.id), notice: `Ramo ${branch} consultado no remoto.` });
  }, true);
  switchBranch = () => this.action(async () => {
    const result = await this.api.switchBranch(this.id, this.state.switchTarget, this.state.switchMode, this.installOnSwitch);
    this.set({ notice: `Pronto! Ramo ${result.branch} selecionado${this.installOnSwitch ? ' e dependências instaladas' : ''}.${result.stash ? ` Stash preservado: ${result.stash.slice(0, 10)}.` : ''}`, switchTarget: '' });
  }, true);
  createBranch = () => this.action(async () => {
    const name = this.state.switchTarget.trim(); const base = this.state.createBase || this.state.status?.branch || '';
    const result = await this.api.createBranch(this.id, name, base, this.state.switchMode, this.state.publishNew, this.installOnSwitch);
    this.set({ notice: `Pronto! Ramo ${result.branch} criado a partir de ${base}${result.published ? ' e enviado para o remoto' : ''}, selecionado${this.installOnSwitch ? ' e com dependências instaladas' : ''}.${result.stash ? ` Stash preservado: ${result.stash.slice(0, 10)}.` : ''}`, switchTarget: '', createBase: '' });
  }, true, 'Criando ramo…');
  private savedPrDestinations(id: string): string[] {
    if (!this.state.rememberPrDestinations) return [];
    const value = this.state.snapshot.settings.ui?.prDestinations?.[id];
    return Array.isArray(value) ? value.slice(0, 4) : [];
  }
  private storePrDestinations(id: string, destinations: string[]) {
    this.savePreferences({ prDestinations: { ...this.state.snapshot.settings.ui?.prDestinations, [id]: destinations } });
  }
  setRememberPrDestinations = (enabled: boolean) => {
    this.set({ rememberPrDestinations: enabled, ...(enabled ? {} : { prTarget: '', prRows: this.state.prRows.map(row => ({ ...row, target: '', url: undefined })) }) });
    if (!enabled) this.storePrDestinations(this.id, []);
  };
  clearPrSources = () => { this.prSourcesVersion++; this.set({ prSource: '', prRows: this.state.prRows.map(row => ({ ...row, source: '', url: undefined })) }); };
  clearPrTargets = () => {
    this.set({ prTarget: '', prRows: this.state.prRows.map(row => ({ ...row, target: '', url: undefined })) });
    this.storePrDestinations(this.id, []);
  };
  // Pull request: quatro pares disponíveis, com destinos lembrados somente quando solicitado.
  private async loadPullRequest() {
    if (!this.repository) return;
    try {
      const id = this.id; const token = ++this.prLoadToken;
      const recentPromise = this.api.recentPushBranches(id).catch(() => []);
      const [prInfo, reviewMessages] = await Promise.all([this.api.pullRequestInfo(id), this.api.reviewHistory()]);
      if (this.repository?.id !== id) return;
      const current = this.state.status?.branch;
      const source = current && !current.startsWith('(') ? current : '';
      const remembered = this.savedPrDestinations(id);
      const [first, ...rest] = this.state.prRows;
      const sourcesVersion = this.prSourcesVersion;
      const initialRows = [first, ...rest].map((row, index) => ({ ...row, source: row.source || (index === 0 ? source : ''), target: row.target || remembered[index] || '' }));
      this.set({ prInfo, reviewMessages, prSource: this.state.prSource || source, prTarget: this.state.prTarget || remembered[0] || '', prRows: initialRows });
      const recent = await recentPromise;
      if (this.repository?.id === id && token === this.prLoadToken && sourcesVersion === this.prSourcesVersion && recent.length) {
        this.set({ prRows: this.state.prRows.map((row, index) => ({ ...row, source: row.source === initialRows[index]?.source ? recent[index] || row.source : row.source })) });
      }
    } catch (error) { this.set({ error: (error as Error).message }); }
  }
  // Criação dinâmica: até 4 ramos, cada um com sua base; no máximo um vira o ramo atual.
  setBranchRow = (index: number, patch: Partial<BranchRow>) => this.set({ branchRows: this.state.branchRows.map((row, i) => i === index ? { ...row, ...patch } : row) });
  setDynamicBranches = (enabled: boolean) => this.set({ dynamicBranches: enabled, ...(enabled && this.state.switchRow === null && this.state.branchRows.length ? { switchRow: 0 } : {}) });
  addBranchRow = () => { if (this.state.branchRows.length < 4) this.set({ branchRows: [...this.state.branchRows, { name: '', base: '' }] }); };
  removeBranchRow = (index: number) => {
    const rows = this.state.branchRows.filter((_, i) => i !== index); const current = this.state.switchRow;
    this.set({ branchRows: rows.length ? rows : [{ name: '', base: '' }], switchRow: current === null ? null : current === index ? rows.length ? 0 : null : current > index ? current - 1 : current });
  };
  // Linhas sem nome são ignoradas; o índice do ramo a trocar acompanha a lista filtrada.
  private filledBranchRows() {
    const filled = this.state.branchRows.map((row, index) => ({ row, index })).filter(({ row }) => row.name.trim());
    const switchIndex = filled.findIndex(({ index }) => index === this.state.switchRow);
    return { items: filled.map(({ row }) => ({ name: row.name.trim(), base: row.base.trim() || (this.state.status?.branch ?? '') })), switchTo: switchIndex < 0 ? null : switchIndex };
  }
  toggleSwitchRow = (index: number) => this.set({ switchRow: this.state.switchRow === index ? null : index });
  createBranches = () => this.action(async () => {
    const { items, switchTo } = this.filledBranchRows();
    if (!items.length) throw new Error('Informe o nome de ao menos um ramo.');
    const result = await this.api.createBranches(this.id, items, switchTo, this.state.switchMode, this.state.publishNew, this.installOnSwitch);
    const parts = [`Ramos criados: ${result.created.join(', ')}.`];
    if (result.published.length) parts.push(`Enviados para o remoto: ${result.published.join(', ')}.`);
    if (result.branch) parts.push(`Ramo atual: ${result.branch}${this.installOnSwitch ? ', dependências instaladas' : ''}.`);
    if (result.stash) parts.push(`Stash preservado: ${result.stash.slice(0, 10)}.`);
    this.set({ notice: parts.join(' '), branchRows: emptyBranchRows(), switchRow: this.state.dynamicBranches ? 0 : null, ...(result.failures.length ? { error: `Falha ao enviar para o remoto:\n${result.failures.join('\n')}` } : {}) });
  }, true, 'Criando ramos…');
  // PR dinâmico: até 4 pares origem → destino, abertos de uma vez.
  setPrRow = (index: number, patch: Partial<PrRow>) => { if ('source' in patch) this.prSourcesVersion++; this.set({ prRows: this.state.prRows.map((row, i) => i === index ? { ...row, ...patch, url: undefined } : row) }); };
  setSinglePr = (patch: Partial<Pick<ViewModel, 'prSource' | 'prTarget'>>) => this.set({ ...patch, prUrl: '' });
  get reviewInput() {
    return { issue: this.state.jiraIssue, prs: this.state.dynamicPr ? this.state.prRows.filter(row => row.target.trim() && row.url).map(row => ({ target: row.target, url: row.url! })) : [{ target: this.state.prTarget, url: this.state.prUrl }] };
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
    const pairs = (this.state.dynamicPr ? this.state.prRows : [{ source: this.state.prSource, target: this.state.prTarget }]).filter(row => row.source.trim() && row.target.trim());
    if (!pairs.length) throw new Error('Preencha ao menos uma origem e um destino para buscar PRs.');
    const found = await this.api.findPullRequests(this.id, pairs.map(({ source, target }) => ({ source: source.trim(), target: target.trim() })));
    if (this.state.dynamicPr) {
      const remote = this.state.prInfo?.remote;
      const short = (value: string) => remote && value.trim().startsWith(remote + '/') ? value.trim().slice(remote.length + 1) : value.trim();
      this.set({ prRows: this.state.prRows.map(row => ({ ...row, url: found.find(pr => pr.source === short(row.source) && pr.target === short(row.target))?.url })) });
    }
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
  addPrRow = () => { if (this.state.prRows.length < 4) { this.prSourcesVersion++; this.set({ prRows: [...this.state.prRows, { source: '', target: '' }] }); } };
  removePrRow = (index: number) => { this.prSourcesVersion++; const rows = this.state.prRows.filter((_, i) => i !== index); this.set({ prRows: rows.length ? rows : [{ source: '', target: '' }] }); };
  createPullRequests = () => this.action(async () => {
    parseJiraIssue(this.state.jiraIssue);
    const pairs = (this.state.dynamicPr ? this.state.prRows : [{ source: this.state.prSource, target: this.state.prTarget }]).filter(row => row.source.trim() && row.target.trim());
    if (!pairs.length) throw new Error('Preencha ao menos uma origem e um destino para criar PR.');
    const result = await this.api.createPullRequests(this.id, pairs.map(({ source, target }) => ({ source: source.trim(), target: target.trim() })), this.state.jiraIssue);
    this.set({ generatedReview: result.message });
    const remote = this.state.prInfo?.remote;
    const short = (value: string) => remote && value.trim().startsWith(remote + '/') ? value.trim().slice(remote.length + 1) : value.trim();
    const urlFor = (row: PrRow) => result.prs.find(pr => pr.source === short(row.source) && pr.target === short(row.target))?.url;
    if (this.state.dynamicPr) this.set({ prRows: this.state.prRows.map(row => ({ ...row, url: urlFor(row) })) });
    else this.set({ prUrl: urlFor(pairs[0]) ?? '' });
    if (!result.error) {
      const destinations = this.state.rememberPrDestinations ? pairs.map(row => row.target.trim()) : [];
      if (this.state.rememberPrDestinations) this.storePrDestinations(this.id, destinations);
      this.prSourcesVersion++;
      this.set({ jiraIssue: '', prSource: '', prTarget: destinations[0] ?? '', prUrl: '', prRows: emptyPrRows(destinations) });
    }
    this.set({ error: result.error ?? '', notice: `${result.prs.filter(pr => pr.created).length} PR(s) criado(s), ${result.prs.filter(pr => !pr.created).length} já existente(s).${result.error ? ' Os resultados concluídos foram preservados; tente novamente para continuar.' : ' Descrições preenchidas com as mensagens dos commits. Mensagem para revisão pronta para copiar.'}` });
    this.set({ reviewMessages: await this.api.reviewHistory() });
  }, false, 'Criando PRs com as mensagens dos commits…');
  runPman = () => this.action(async () => { await this.api.runPman(this.id); this.set({ notice: 'Dependências instaladas.' }); }, true);
  loadHistory = (ref: string, more = false) => this.action(async () => {
    this.set({ historyRef: ref });
    const commits = await this.api.log(this.id, ref, more ? this.state.history.length : 0);
    this.set({ history: more ? [...this.state.history, ...commits] : commits });
  });
  setSource = (source: string) => { this.set({ source, sourceCommits: [], selectedCommits: [], review: false }); };
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
  cancelOperation = () => this.action(async () => { await this.api.cancelOperation(this.id); this.set({ notice: 'Operação Git cancelada.' }); }, true, 'Cancelando operação…');
  // Abre o TortoiseGit sem travar a tela e bloqueia novos cliques por 4 s, para não abrir várias janelas.
  openTortoise = async (command: 'commit' | 'log', options?: TortoiseOptions) => {
    if (this.state.tortoiseLocked || !this.repository) return;
    this.set({ tortoiseLocked: true, tortoiseOpened: false, error: '' });
    setTimeout(() => this.set({ tortoiseLocked: false, tortoiseOpened: false }), 4000);
    try { await this.api.openTortoise(this.id, command, options); this.set({ tortoiseOpened: true }); }
    catch (error) { this.set({ error: (error as Error).message, tortoiseLocked: false, tortoiseOpened: false }); }
  };
  copyBranchName = () => this.action(async () => {
    const branch = this.state.status?.branch; if (!branch) return;
    await this.api.copyText(branch); this.set({ notice: `Nome do ramo copiado: ${branch}` });
  });
  push = () => this.action(async () => { await this.api.push(this.id); this.set({ notice: 'Push concluído.' }); }, true);
}
