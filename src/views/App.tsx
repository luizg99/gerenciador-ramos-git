import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppController, type Tab, type ViewModel } from '../controllers/appController';
import type { FileChange } from '../models/domain';
import { ref } from '../models/validation';
import { greeting, parseJiraIssue, type ReviewMessage } from '../models/reviewMessage';
import { BranchPicker, CommitList, Detail, Diff } from './components';
const cherryIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="17" r="4"/><circle cx="17" cy="16" r="4"/><path d="M7 13C8 8 11 5 15 3M17 12c-1-4-2-7-2-9"/><path d="M15 3c2.5-.5 4.5.5 5 2.5-2.5.5-4-.5-5-2.5z"/></svg>;
const pullRequestIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4"/><path d="M13 3.5 10.5 6 13 8.5"/></svg>;
const navigation: { tab: Tab; icon: ReactNode; label: string }[] = [{ tab: 'switch', icon: '⑂', label: 'Criar / Alterar ramo' }, { tab: 'history', icon: '◷', label: 'Histórico' }, { tab: 'commit', icon: '±', label: 'Alterações e commit' }, { tab: 'cherry', icon: cherryIcon, label: 'Cherry-pick' }, { tab: 'pr', icon: pullRequestIcon, label: 'Criar pull request' }];
type Props = { c: AppController; vm: ViewModel };
// Pastas da raiz de projetos que contém o repositório até o próprio repositório.
function crumbs(repoPath: string, roots: string[]) {
  const split = (value: string) => value.split(/[\\/]+/).filter(Boolean);
  const parts = split(repoPath);
  const key = (value: string[]) => value.join('/').toLowerCase();
  const root = roots.map(split).filter(r => r.length <= parts.length && key(parts.slice(0, r.length)) === key(r)).sort((a, b) => b.length - a.length)[0];
  return root ? parts.slice(Math.max(root.length - 1, 0)) : parts.slice(-1);
}
const statusLabels: Record<string, string> = { M: 'Modificado', A: 'Adicionado', D: 'Excluído', R: 'Renomeado', C: 'Copiado', U: 'Em conflito', N: 'Novo (não rastreado)', T: 'Tipo alterado' };
export function App({ controller: c }: { controller: AppController }) {
  const vm = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const [search, setSearch] = useState('');
  const [projectsOpen, setProjectsOpen] = useState(() => { try { return localStorage.getItem('projectsOpen') !== 'false'; } catch { return true; } });
  const toggleProjects = () => { const open = !projectsOpen; setProjectsOpen(open); try { localStorage.setItem('projectsOpen', String(open)); } catch { /* preferência só desta máquina */ } };
  const activityLogRef = useRef<HTMLDivElement>(null);
  const scrollActivityToBottom = () => {
    const log = activityLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  };
  useLayoutEffect(scrollActivityToBottom, [vm.progress, vm.busy]);
  useEffect(() => c.connect(), [c]);
  const repo = c.repository;
  const visibleProjects = projectsOpen ? vm.snapshot.repositories.filter(r => r.name.toLowerCase().includes(search.toLowerCase())) : vm.snapshot.repositories.filter(r => r.id === repo?.id);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">⑂</div>Ramos</div>
      <div className="sidebar-label"><button className="collapse" aria-expanded={projectsOpen} title={projectsOpen ? 'Recolher lista de projetos' : 'Expandir lista de projetos'} onClick={toggleProjects}><span aria-hidden="true">{projectsOpen ? '▾' : '▸'}</span>Projetos <small>{vm.snapshot.repositories.length}</small>{vm.snapshot.scanning && <small className="scanning" title="Procurando projetos novos ou removidos nas pastas">atualizando…</small>}</button><button title="Gerenciar pastas" aria-label="Gerenciar pastas" onClick={() => c.selectTab('projects')} disabled={vm.busy}>＋</button></div>
      {projectsOpen && <input className="project-search" placeholder="Buscar projeto…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar projeto"/>}
      <div className="project-list">{visibleProjects.map(r => <button key={r.id} disabled={vm.busy} className={`project ${r.id === repo?.id ? 'selected' : ''}`} onClick={() => c.selectRepository(r.id)} title={r.path}><span className="project-icon">▣</span><span>{r.name}</span>{r.id === repo?.id && <i/>}</button>)}{projectsOpen && !vm.snapshot.repositories.length && <p className="sidebar-hint">{vm.loadingRepository || vm.snapshot.scanning ? 'Carregando pastas…' : 'Adicione sua pasta de projetos para começar.'}</p>}</div>
      <div className="sidebar-label">Repositório</div><nav>{navigation.map(item => <button key={item.tab} aria-label={item.label} disabled={!repo || vm.busy} className={vm.tab === item.tab ? 'selected' : ''} onClick={() => c.selectTab(item.tab)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.tab === 'commit' && !!vm.status?.files.length && <b>{vm.status.files.length}</b>}</button>)}</nav>
      <button className={`settings-link ${vm.tab === 'projects' ? 'selected' : ''}`} onClick={() => c.selectTab('projects')} disabled={vm.busy}>▣ Pastas de projetos</button><button className={`settings-link ${vm.tab === 'settings' ? 'selected' : ''}`} onClick={() => c.selectTab('settings')} disabled={vm.busy}>⚙ Configurações</button><div className="sidebar-footer">v0.1.0</div>
    </aside>
    <main><header className="topbar"><div className="topbar-title">{repo ? <nav className="crumbs" aria-label="Caminho do projeto" title={repo.path}>{crumbs(repo.path, vm.snapshot.settings.roots).map((part, i, all) => i === all.length - 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}<i>/</i></span>)}</nav> : <strong>Nenhum projeto selecionado</strong>}{vm.status && <span className="branch-badge" title="Ramo atual">⑂ {vm.status.branch}</span>}{repo && vm.loadingRepository && <span className="loading-hint"><span className="spinner"/>Carregando projeto…</span>}</div><div className="topbar-right"><button className="quiet" disabled={!repo || vm.busy} onClick={c.refresh} title="Relê o estado local do repositório">↻ Atualizar</button>{repo && vm.tab !== 'projects' && <button className="quiet" disabled={vm.busy} onClick={c.fetch} title="Busca ramos e commits novos do remoto (git fetch)">⇣ Buscar do remoto</button>}</div></header>
      <div className="page"><div className="page-heading"><h1>{vm.tab === 'projects' ? 'Seus projetos' : vm.tab === 'settings' ? 'Configurações' : navigation.find(n => n.tab === vm.tab)?.label}</h1><p>{({ settings: 'Preferências do aplicativo, lembradas neste computador.', projects: 'Escolha as pastas onde ficam seus repositórios.', switch: `Pesquise um ramo para trocar ou digite um nome novo para criar.${c.usePman ? ' As dependências são instaladas em seguida, se a opção estiver marcada.' : ''}`, history: 'Navegue pelos commits e veja o que mudou em cada um.', commit: 'Prepare os arquivos, crie o commit e envie.', cherry: 'Leve commits de um ramo para até três destinos, em sequência.', pr: 'Crie os pull requests no Azure com as mensagens dos commits na descrição.' })[vm.tab]}</p></div>
      {vm.error && <div className="alert error" role="alert"><strong>Não foi possível concluir</strong><p>{vm.error}</p><button onClick={() => c.set({ error: '' })}>Fechar</button></div>}
      {vm.notice && <div className="alert success" role="status">{vm.notice}</div>}
      {vm.busy && <div className="running" role="status"><span className="spinner"/> {vm.busyMessage || 'Carregando...'}</div>}
      {vm.status?.operation && <div className="alert error">Operação Git em andamento: {vm.status.operation}. Resolva ou cancele antes de continuar. <button onClick={c.cancelOperation} disabled={vm.busy}>Cancelar operação</button></div>}
      <fieldset className="page-content" disabled={vm.busy}>{vm.tab === 'projects' ? <Projects c={c} vm={vm}/> : vm.tab === 'settings' ? <Settings c={c} vm={vm}/> : !repo ? vm.busy || vm.loadingRepository ? null : <div className="empty"><h2>Selecione um projeto</h2><button onClick={c.chooseRoot}>Adicionar pasta de projetos</button></div> : vm.tab === 'switch' ? <Switch c={c} vm={vm}/> : vm.tab === 'history' ? <History c={c} vm={vm}/> : vm.tab === 'commit' ? <Changes c={c} vm={vm}/> : vm.tab === 'cherry' ? <Cherry c={c} vm={vm}/> : <PullRequest c={c} vm={vm}/>}</fieldset>
      {!!vm.progress.length && <details className="operation-log" open={vm.busy} onToggle={e => { if (e.currentTarget.open) scrollActivityToBottom(); }}><summary>Atividade da sessão <span>{vm.progress.length} eventos</span></summary><div ref={activityLogRef}>{vm.progress.map((p, i) => <p key={i}><time>{new Date(p.time).toLocaleTimeString('pt-BR')}</time>{p.message}</p>)}</div></details>}
      </div><footer className="main-footer"><span>{repo?.path ?? 'Nenhum projeto selecionado'}</span><span>{vm.busy ? 'Operação em andamento' : 'Pronto'}</span></footer>
    </main>
  </div>;
}
function Projects({ c, vm }: Props) { return <><section className="card"><div className="card-heading"><div><h2>Pastas de projetos</h2><p>Repositórios são encontrados até quatro níveis abaixo de cada pasta.</p></div><button className="primary" onClick={c.chooseRoot}>＋ Adicionar pasta</button></div>{vm.snapshot.settings.roots.length ? vm.snapshot.settings.roots.map(root => <div className="root-row" key={root}><code>{root}</code><button onClick={() => c.removeRoot(root)}>Remover da lista</button></div>) : <div className="empty"><span className="empty-symbol">▱</span><h3>Tudo começa com uma pasta</h3><p>Selecione, por exemplo, sua pasta Documents\GitHub.</p><button className="primary" onClick={c.chooseRoot}>Escolher pasta de projetos</button></div>}</section><section className="card"><div className="card-heading"><h2>Repositórios encontrados <span className="count">{vm.snapshot.repositories.length}</span></h2><button onClick={c.scan}>Procurar novamente</button></div><div className="repo-grid">{vm.snapshot.repositories.map(r => <button className="repo-card" key={r.id} onClick={() => c.selectRepository(r.id)}><span>▣</span><strong>{r.name}</strong><small>{r.path}</small><b>Abrir projeto →</b></button>)}</div></section></>; }
// Ramo existe se bater com um local ou com um remoto sem o prefixo (origin/x → x).
const branchExists = (branches: ViewModel['branches'], name: string) => branches.some(b => b.name === name || b.remote && b.name.slice(b.name.indexOf('/') + 1) === name);
const validBranchName = (name: string) => ref.safeParse(name).success && !name.endsWith('/') && !name.endsWith('.lock');
const asBranch = (name: string) => ({ ref: `refs/heads/${name}`, name, remote: false, current: false, upstream: '' });
const modes = [{ value: 'block', title: 'Bloquear a troca', text: 'Só troca quando não há arquivos pendentes.', tag: 'Padrão' }, { value: 'carry', title: 'Levar alterações', text: 'Mantém suas alterações no novo ramo, se o Git permitir.' }, { value: 'stash', title: 'Guardar no stash', text: 'Guarda tudo no stash. Não reaplica automaticamente.' }] as const;
function Switch({ c, vm }: Props) {
  const noSwitchDialog = useRef<HTMLDialogElement>(null);
  const dirty = !!vm.status?.files.length;
  const current = vm.status?.branch ?? '';
  const target = vm.switchTarget.trim();
  const creating = !!target && !branchExists(vm.branches, target);
  const validName = !creating || validBranchName(target);
  const base = vm.createBase || current;
  const blocked = dirty && vm.switchMode === 'block' || !!vm.status?.operation;
  // Criação dinâmica: cada linha valida nome e base; a base pode ser um ramo de uma linha anterior.
  const rows = vm.branchRows.map((row, index) => {
    const name = row.name.trim(); const rowBase = row.base.trim() || current;
    const earlier = vm.branchRows.slice(0, index).map(r => r.name.trim()).filter(Boolean);
    const error = !name ? '' : !validBranchName(name) ? 'Nome inválido (sem espaços, ~ ^ : ? * [ \\ nem ..).' : branchExists(vm.branches, name) ? 'Esse ramo já existe.' : vm.branchRows.findIndex(r => r.name.trim() === name) !== index ? 'Nome repetido.'
      : !rowBase ? 'Informe a base.' : !branchExists(vm.branches, rowBase) && !vm.branches.some(b => b.ref === rowBase) && !earlier.includes(rowBase) ? 'Base não encontrada.' : '';
    return { name, base: rowBase, error, earlier };
  });
  const rowsReady = rows.every(r => r.name && !r.error);
  const switching = !vm.dynamicBranches || vm.switchRow !== null;
  return <section className="card switch-card">
    <dialog ref={noSwitchDialog} className="issue-dialog" aria-labelledby="no-switch-title">
      <h2 id="no-switch-title">Nenhum ramo marcado para trocar</h2>
      <p>Os ramos serão criados sem alterar o ramo atual. Deseja continuar?</p>
      <div className="card-actions"><button autoFocus onClick={() => noSwitchDialog.current?.close()}>Voltar</button><button className="primary" onClick={() => { noSwitchDialog.current?.close(); void c.createBranches(); }}>Criar sem trocar</button></div>
    </dialog>
    <div className="summary"><span>Atual <strong>⑂ {current || '—'}</strong></span><span className={dirty ? 'amber' : 'green'}>{dirty ? `${vm.status?.files.length} arquivos alterados` : 'Sem alterações locais'}</span><span>↑ {vm.status?.ahead ?? 0} para enviar · ↓ {vm.status?.behind ?? 0} para receber</span></div>
    <label className="manual-check dynamic-toggle"><input type="checkbox" checked={vm.dynamicBranches} onChange={e => c.setDynamicBranches(e.target.checked)}/>Criação dinâmica de ramos <small>(até 4 de uma vez)</small></label>
    {vm.dynamicBranches ? <div className="batch">
      {vm.branchRows.map((row, index) => <div className="batch-row" key={index}>
        <span className="step-number">{index + 1}</span>
        <label className="field"><span>Nome</span><input aria-label={`Nome do ramo ${index + 1}`} value={row.name} onChange={e => c.setBranchRow(index, { name: e.target.value })} placeholder="feature/novo-ramo" spellCheck={false} autoComplete="off"/></label>
        <BranchPicker label={`A partir de (${index + 1})`} value={row.base || (index === 0 ? current : '')} branches={[...rows[index].earlier.map(asBranch), ...vm.branches]} onChange={value => c.setBranchRow(index, { base: value })} placeholder={current || 'Ramo de base…'}/>
        <label className="switch-here"><input type="checkbox" checked={vm.switchRow === index} onChange={() => c.toggleSwitchRow(index)}/>Trocar para esse?</label>
        <button className="icon danger visible" title="Remover linha" aria-label={`Remover ramo ${index + 1}`} onClick={() => c.removeBranchRow(index)}>×</button>
        {rows[index].error && <p className="row-error">{rows[index].error}</p>}
      </div>)}
      {vm.branchRows.length < 4 && <button className="quiet add-row" onClick={c.addBranchRow}>+ Adicionar ramo</button>}
      <label className="manual-check"><input type="checkbox" checked={vm.publishNew} onChange={e => c.set({ publishNew: e.target.checked })}/>Enviar os ramos novos para o remoto (push) depois de criar (recomendado: o cherry-pick exige o destino no remoto)</label>
    </div> : <>
      <BranchPicker label="Ramo" value={vm.switchTarget} branches={vm.branches} onChange={switchTarget => c.set({ switchTarget })} placeholder="Pesquise um ramo ou digite o nome de um ramo novo…"/>
      {creating && <div className="create-branch">
        <p>{validName ? <>O ramo <code>{target}</code> não existe. Ele será criado a partir de:</> : <>Nome inválido: não use espaços, <code>{'~ ^ : ? * [ \\'}</code>, <code>..</code> nem termine com <code>/</code>.</>}</p>
        {validName && <><BranchPicker label="A partir de" value={base} branches={vm.branches} onChange={createBase => c.set({ createBase })}/>
        <label className="manual-check"><input type="checkbox" checked={vm.publishNew} onChange={e => c.set({ publishNew: e.target.checked })}/>Enviar o ramo novo para o remoto (push) depois de criar</label></>}
      </div>}
    </>}
    {switching && <><p className="section-label">Se houver alterações locais</p><div className="mode-grid">{modes.map(mode => <label key={mode.value} className={`mode-card ${vm.switchMode === mode.value ? 'active' : ''}`}><input type="radio" name="mode" value={mode.value} checked={vm.switchMode === mode.value} onChange={() => c.set({ switchMode: mode.value })}/><div><strong>{mode.title}{'tag' in mode && <span>{mode.tag}</span>}</strong><p>{mode.text}</p></div></label>)}</div>
    {dirty && vm.switchMode === 'block' && <p className="inline-warning">Há arquivos sem commit. Faça o commit ou escolha outra opção acima.</p>}</>}
    <div className="card-actions"><p className="hint">{!switching ? 'Os ramos são criados sem trocar o ramo atual.' : c.installOnSwitch ? <>Depois da troca, roda <code>pman install -f</code> na pasta <code>source</code>.</> : null}</p>{c.usePman && <label className="manual-check"><input type="checkbox" checked={vm.installOnSwitch} onChange={e => c.set({ installOnSwitch: e.target.checked })}/>Executar pman ao trocar ramo</label>}{c.usePman && <button onClick={c.runPman}>Executar pman no ramo atual</button>}
      {vm.dynamicBranches ? <button className="primary" disabled={!rowsReady || switching && blocked || !!vm.status?.operation} onClick={() => vm.switchRow === null ? noSwitchDialog.current?.showModal() : c.createBranches()}>{`Criar ${vm.branchRows.length} ${vm.branchRows.length === 1 ? 'ramo' : 'ramos'}${vm.switchRow !== null ? ' e trocar' : ''} →`}</button>
        : creating ? <button className="primary" disabled={!validName || !base || blocked} onClick={c.createBranch}>Criar ramo e trocar →</button> : <button className="primary" disabled={!target || blocked} onClick={c.switchBranch}>{c.installOnSwitch ? 'Trocar ramo e instalar →' : 'Trocar ramo →'}</button>}</div></section>;
}
function PullRequest({ c, vm }: Props) {
  const missingIssueDialog = useRef<HTMLDialogElement>(null);
  const jiraInput = useRef<HTMLInputElement>(null);
  const create = () => {
    if (!vm.jiraIssue.trim()) missingIssueDialog.current?.showModal();
    else void c.createPullRequests();
  };
  const info = vm.prInfo;
  if (!info) return <section className="card"><div className="empty small">Lendo o remoto do repositório…</div></section>;
  if (!info.webUrl) return <section className="card"><div className="empty"><span className="empty-symbol">⇄</span><h3>Remoto não é do Azure DevOps</h3><p>{info.remoteUrl ? <>O remoto <code>{info.remote}</code> aponta para <code>{info.remoteUrl}</code>. A criação de pull request funciona com repositórios do Azure Repos.</> : 'Este repositório não tem remoto configurado.'}</p></div></section>;
  const short = (value: string) => info.remote && value.startsWith(info.remote + '/') ? value.slice(info.remote.length + 1) : value;
  const remoteNames = new Set(vm.branches.filter(b => b.remote).map(b => b.name));
  const published = (name: string) => !!name && remoteNames.has(`${info.remote}/${name}`);
  const check = (rawSource: string, rawTarget: string) => {
    const [source, target] = [short(rawSource.trim()), short(rawTarget.trim())];
    const error = !source || !target ? '' : source === target ? 'Origem e destino precisam ser diferentes.' : !published(source) ? `O ramo ${source} ainda não está no remoto.` : !published(target) ? `O destino ${target} não existe no remoto.` : '';
    return { source, target, error, ready: !!source && !!target && !error };
  };
  const single = check(vm.prSource, vm.prTarget);
  const rows = vm.prRows.map(row => check(row.source, row.target));
  const pairs = rows.map(r => `${r.source}→${r.target}`);
  const rowsReady = rows.every((r, i) => r.ready && pairs.indexOf(pairs[i]) === i);
  return <><section className="card switch-card">
    <dialog ref={missingIssueDialog} className="issue-dialog" aria-labelledby="missing-issue-title">
      <h2 id="missing-issue-title">Issue Jira não informada</h2>
      <p>O campo Issue Jira está vazio. Deseja prosseguir com a criação dos PRs sem vincular uma issue?</p>
      <div className="card-actions">
        <button autoFocus onClick={() => { missingIssueDialog.current?.close(); jiraInput.current?.focus(); }}>Voltar e preencher</button>
        <button className="primary" onClick={() => { missingIssueDialog.current?.close(); void c.createPullRequests(); }}>Prosseguir sem issue</button>
      </div>
    </dialog>
    <div className="summary"><span>Azure Repos <strong>{info.webUrl.replace(/^https?:\/\//, '')}</strong></span></div>
    <label className="field jira-issue">Issue Jira <small>opcional</small><input ref={jiraInput} value={vm.jiraIssue} onChange={e => c.set({ jiraIssue: e.target.value })} placeholder="DDVENDAS-61611 ou link completo do Jira"/></label>
    <label className="manual-check dynamic-toggle"><input type="checkbox" checked={vm.dynamicPr} onChange={e => c.set({ dynamicPr: e.target.checked })}/>PR dinâmico <small>(até 4 de uma vez)</small></label>
    {vm.dynamicPr ? <div className="batch">
      {vm.prRows.map((row, index) => <div className="batch-row pr-row" key={index}>
        <span className="step-number">{index + 1}</span>
        <BranchPicker label={`Origem (${index + 1})`} value={row.source} branches={vm.branches} onChange={source => c.setPrRow(index, { source })}/>
        <span className="pr-arrow" aria-hidden="true">→</span>
        <BranchPicker label={`Destino (${index + 1})`} value={row.target} branches={vm.branches} onChange={target => c.setPrRow(index, { target })}/>
        <button className="icon danger visible" title="Remover linha" aria-label={`Remover pull request ${index + 1}`} onClick={() => c.removePrRow(index)}>×</button>
        {row.url && <p className="row-error">PR: <ReviewLink c={c} url={row.url}/></p>}
        {(rows[index].error || pairs.indexOf(pairs[index]) !== index && rows[index].ready) && <p className="row-error">{rows[index].error || 'Pull request repetido.'}</p>}
      </div>)}
      {vm.prRows.length < 4 && <button className="quiet add-row" onClick={c.addPrRow}>+ Adicionar pull request</button>}
    </div> : <>
      <div className="pr-fields"><BranchPicker label="Origem (seu ramo)" value={vm.prSource} branches={vm.branches} onChange={prSource => c.setSinglePr({ prSource })}/><span className="pr-arrow" aria-hidden="true">→</span><BranchPicker label="Destino" value={vm.prTarget} branches={vm.branches} onChange={prTarget => c.setSinglePr({ prTarget })}/></div>
      {single.source && !published(single.source) && <div className="create-branch"><p>O ramo <code>{single.source}</code> ainda não está no remoto. Envie-o antes de abrir o pull request.</p>{single.source === vm.status?.branch ? <button onClick={c.push}>↑ Enviar {single.source} para o remoto</button> : <p className="hint">Troque para esse ramo e use “Enviar”, ou escolha um ramo já publicado.</p>}</div>}
      {single.source && single.target && single.source === single.target && <p className="inline-warning">Origem e destino precisam ser diferentes.</p>}
    </>}
    <div className="card-actions"><p className="hint">Cria os PRs diretamente no Azure. A descrição inclui as mensagens completas dos commits de cada origem que ainda não estão no destino (Add commit messages). O título usa origem → destino. PRs ativos já existentes são reutilizados.</p>
      {vm.dynamicPr ? <button className="primary" disabled={!rowsReady} onClick={create}>{`Criar ${vm.prRows.length} ${vm.prRows.length === 1 ? 'pull request' : 'pull requests'} no Azure`}</button>
        : <button className="primary" disabled={!single.ready} onClick={create}>Criar pull request no Azure</button>}</div>
  </section><ReviewComposer c={c} vm={vm}/><ReviewHistory c={c} vm={vm}/></>;
}
function ReviewComposer({ c, vm }: Props) {
  const preview = c.reviewPreview;
  let issueError = '';
  try { parseJiraIssue(vm.jiraIssue); } catch (error) { issueError = (error as Error).message; }
  const pairs = vm.dynamicPr ? vm.prRows : [{ source: vm.prSource, target: vm.prTarget }];
  return <section className="card review-composer">
    <div className="card-heading"><div><h2>Mensagem para revisão</h2><p className="hint">Depois de criar os PRs no Azure, os links são consultados pela origem e pelo destino.</p></div><button disabled={!!issueError || pairs.some(pair => !pair.source.trim() || !pair.target.trim())} onClick={c.findPullRequests}>Buscar PRs e gerar mensagem</button></div>
    {issueError && <p className="inline-warning padded">{issueError}</p>}
    {preview ? <><div className="review-message" aria-label="Prévia da mensagem"><p>{greeting()}, tarefa finalizada, disponível para revisão.</p>{preview.issue && <p>Issue do Jira:<br/><ReviewLink c={c} url={preview.issue.url} label={preview.issue.key}/></p>}<p>PRs:</p>{preview.prs.map(pr => <p key={pr.url}>{pr.target}: <ReviewLink c={c} url={pr.url}/></p>)}</div><div className="card-actions"><p className="hint">Cole com Ctrl+V para manter o código do Jira como link. A saudação usa o horário local no momento da cópia.</p><button className="primary" onClick={c.copyReview}>Copiar mensagem</button></div></> : <p className="hint padded">Os links finais e o texto aparecerão aqui. Sem Issue Jira, a mensagem terá a saudação e a lista de PRs.</p>}
  </section>;
}
function ReviewLink({ c, url, label }: { c: AppController; url: string; label?: string }) {
  return <a className="review-link" href={url} onClick={event => { event.preventDefault(); void c.openReviewLink(url); }}>{label ?? url}</a>;
}
function ReviewHistory({ c, vm }: Props) {
  const [editing, setEditing] = useState<ReviewMessage | null>(null);
  const [issueValue, setIssueValue] = useState('');
  const [issueError, setIssueError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editing) dialog.current?.showModal(); else dialog.current?.close(); }, [editing]);
  const saveIssue = async () => {
    try { parseJiraIssue(issueValue); } catch (error) { setIssueError((error as Error).message); return; }
    if (!editing) return;
    if (await c.updateReviewIssue(editing.id, issueValue)) setEditing(null);
    else setIssueError(c.getSnapshot().error || 'Não foi possível salvar a issue.');
  };
  const query = vm.reviewSearch.trim().toLowerCase();
  const groups = new Map<string, ReviewMessage[]>();
  for (const message of vm.reviewMessages) {
    const key = message.issue?.key ?? 'Sem issue';
    if (query && !`${key} ${message.repositoryName} ${message.prs.map(pr => pr.target).join(' ')}`.toLowerCase().includes(query)) continue;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return <section className="card review-history"><div className="card-heading"><h2>Histórico por issue</h2><label className="field">Buscar no histórico<input value={vm.reviewSearch} onChange={e => c.set({ reviewSearch: e.target.value })} placeholder="Issue, projeto ou destino"/></label></div>
    <dialog ref={dialog} className="issue-dialog" aria-labelledby="issue-dialog-title" onCancel={event => { if (vm.busy) event.preventDefault(); else setEditing(null); }}>
      {editing && <form onSubmit={event => { event.preventDefault(); void saveIssue(); }}>
        <h2 id="issue-dialog-title">{editing?.issue ? 'Alterar issue do jira' : 'Adicionar issue'}</h2>
        <label className="field">Issue Jira<input autoFocus value={issueValue} onChange={event => { setIssueValue(event.target.value); setIssueError(''); }} placeholder="DDVENDAS-61611 ou link completo do Jira"/></label>
        <p className="hint">Atualiza a mensagem salva. Deixe vazio para remover a issue.</p>
        {issueError && <p role="alert" className="inline-warning">{issueError}</p>}
        <div className="card-actions"><button type="button" disabled={vm.busy} onClick={() => setEditing(null)}>Cancelar</button><button className="primary" disabled={vm.busy} type="submit">Salvar issue</button></div>
      </form>}
    </dialog>
    {!groups.size && <p className="hint padded">{query ? 'Nenhuma mensagem encontrada.' : 'As mensagens geradas ficam salvas neste computador para copiar novamente.'}</p>}
    {[...groups].map(([issue, messages]) => {
      const jiraUrl = messages.find(message => message.issue)?.issue?.url;
      return <details key={issue} open={!!query}><summary>{issue}{jiraUrl && <a className="issue-history-link" href={jiraUrl} aria-label={`Abrir issue ${issue} no Jira`} title="Abrir no Jira" onClick={event => { event.preventDefault(); event.stopPropagation(); void c.openReviewLink(jiraUrl); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg></a>} <span className="pill">{messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}</span></summary>{messages.map(message => <article key={message.id}><div className="history-message-heading"><strong>{message.repositoryName}</strong><small>{new Date(message.createdAt).toLocaleString('pt-BR')}</small><button onClick={() => { setEditing(message); setIssueValue(message.issue?.key ?? ""); setIssueError(""); }}>{message.issue ? "Alterar issue do jira" : "Adicionar issue"}</button><button onClick={() => c.copyPreviousReview(message.id)}>Copiar mensagem anterior</button></div>{message.prs.map(pr => <p key={pr.url}>{pr.target}: <ReviewLink c={c} url={pr.url}/></p>)}</article>)}</details>;
    })}
  </section>;
}
function Settings({ c, vm }: Props) {
  return <section className="card switch-card">
    <label className="setting-row"><input type="checkbox" checked={c.usePman} onChange={e => c.setUsePman(e.target.checked)}/><div><strong>Usa pman</strong><p>Quando marcado, toda troca ou criação de ramo na aba <em>Criar / Alterar ramo</em> executa <code>pman install -f</code> na pasta <code>source</code>, e o botão para rodar o pman manualmente aparece. Desmarcado, o pman não é executado em nenhum momento.</p></div></label>
  </section>;
}
function History({ c, vm }: Props) { return <section className="card"><div className="toolbar"><BranchPicker label="Histórico do ramo" value={vm.historyRef} branches={vm.branches} onChange={historyRef => c.set({ historyRef })}/><button onClick={() => c.loadHistory(vm.historyRef)}>Carregar histórico</button></div><div className="split"><div><CommitList commits={vm.history} active={vm.selectedCommit} onInspect={c.showCommit}/>{!!vm.history.length && <button className="load-more" onClick={() => c.loadHistory(vm.historyRef, true)}>Carregar mais commits</button>}</div><Detail detail={vm.detail} selectedFile={vm.selectedCommitFile} onSelectFile={c.showCommitFile}/></div></section>; }
function Changes({ c, vm }: Props) {
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const files = vm.status?.files ?? [];
  const isStaged = (f: FileChange) => f.index !== ' ' && f.index !== '?';
  const staged = files.filter(isStaged);
  // Marcado = vai no commit (está no índice); parcial = parte preparada, parte não.
  const state = (f: FileChange) => !isStaged(f) ? 'off' : f.worktree === ' ' ? 'on' : 'partial';
  const allOn = files.length > 0 && files.every(f => state(f) === 'on');
  const toggle = (f: FileChange) => state(f) === 'on' ? c.stage([f.path], true) : c.stage([f.path]);
  const toggleAll = () => allOn ? c.stage(staged.map(f => f.path), true) : c.stage(files.filter(f => state(f) !== 'on').map(f => f.path));
  const discard = () => { if (confirm) void c.discard(confirm); setConfirm(null); };
  const row = (f: FileChange) => {
    const code = isStaged(f) ? f.index : f.worktree === '?' ? 'N' : f.worktree;
    const slash = f.path.lastIndexOf('/');
    const showStaged = f.worktree === ' ';
    return <div className={`file-row ${vm.workingFile === f.path ? 'selected' : ''}`} key={f.path}>
      <input type="checkbox" aria-label={`Incluir ${f.path} no commit`} title={state(f) === 'partial' ? 'Parte das alterações está preparada. Marque para incluir tudo.' : 'Incluir no commit'} checked={state(f) === 'on'} ref={el => { if (el) el.indeterminate = state(f) === 'partial'; }} onChange={() => toggle(f)}/>
      <span className={`file-status s-${code}`} title={statusLabels[code] ?? code}>{code}</span>
      <button className="file-name" title={f.path} onClick={() => c.showWorkingDiff(f.path, showStaged)}>{f.path.slice(slash + 1)}{slash > 0 && <small>{f.path.slice(0, slash)}</small>}</button>
      <button className="icon danger" title={f.index === '?' || f.index === 'A' ? 'Excluir arquivo novo' : 'Descartar alterações'} aria-label={`Descartar alterações de ${f.path}`} onClick={() => setConfirm([f.path])}>↺</button>
    </div>;
  };
  const confirmText = confirm && (confirm.length === 1 ? <>Descartar as alterações de <strong>{confirm[0]}</strong>?</> : <>Descartar as alterações de <strong>{confirm.length} arquivos</strong>?</>);
  return <div className="changes-grid"><section className="card">
    {!files.length ? <div className="empty small">Tudo limpo. Nenhuma alteração local.</div> : <div className="file-list">
      <div className="file-group"><label className="check-all"><input type="checkbox" aria-label="Incluir todos no commit" checked={allOn} ref={el => { if (el) el.indeterminate = !allOn && staged.length > 0; }} onChange={toggleAll}/>Alterações <span className="count">{files.length}</span></label><button className="quiet danger" onClick={() => setConfirm(files.map(f => f.path))}>Descartar todas</button></div>
      {confirm && <div className="confirm-discard" role="alertdialog" aria-label="Confirmar descarte"><p>{confirmText} {confirm.length === 1 ? 'O arquivo volta ao último commit (se for novo, é apagado).' : 'Os arquivos voltam ao último commit e os novos são apagados.'} <strong>Não dá para desfazer.</strong></p><div><button onClick={() => setConfirm(null)}>Cancelar</button><button className="danger-solid" onClick={discard}>Descartar</button></div></div>}
      {files.map(row)}
    </div>}
    <div className="commit-form"><textarea aria-label="Mensagem do commit" rows={3} placeholder="Mensagem do commit" value={vm.commitMessage} onChange={e => c.set({ commitMessage: e.target.value })}/>
      <div className="card-actions"><span className="hint">{staged.length ? `${staged.length} de ${files.length} ${files.length === 1 ? 'arquivo marcado' : 'arquivos marcados'}` : 'Marque os arquivos que vão no commit'}</span><button onClick={c.push} title="Envia os commits locais para o upstream do ramo (ou origin, se ainda não configurado)">↑ Enviar{vm.status?.ahead ? ` (${vm.status.ahead})` : ''}</button><button className="primary" disabled={!staged.length || !vm.commitMessage.trim()} onClick={c.commit}>Criar commit</button></div></div>
  </section>
  <section className="card diff-card">{vm.workingFile ? <><div className="card-heading"><h2>{vm.workingFile}</h2>{files.some(f => f.path === vm.workingFile && state(f) === 'partial') ? <div className="segmented"><button className={!vm.workingStaged ? 'active' : ''} onClick={() => c.showWorkingDiff(vm.workingFile, false)}>Não marcadas</button><button className={vm.workingStaged ? 'active' : ''} onClick={() => c.showWorkingDiff(vm.workingFile, true)}>Marcadas</button></div> : null}</div><Diff value={vm.workingDiff || 'Nenhuma alteração nesta comparação.'}/></> : <div className="empty"><span className="empty-symbol">±</span><p>Selecione um arquivo para ver as alterações.</p></div>}</section></div>;
}
function Cherry({ c, vm }: Props) {
  const execution = c.execution;
  return <><div className="cherry-layout"><section className="card"><div className="card-heading"><div><span className="step-label">1 · Origem</span><h2>Escolha o que levar</h2></div><span className="pill">{vm.selectedCommits.length} selecionados</span></div><div className="toolbar"><BranchPicker label="Ramo de origem" value={vm.source} branches={vm.branches} onChange={c.setSource}/><button disabled={!vm.source} onClick={() => c.loadSource()}>Carregar commits</button></div><CommitList commits={vm.sourceCommits} selected={vm.selectedCommits} active={vm.selectedCommit} selectable onSelect={c.toggleCommit} onInspect={c.showCommit}/>{!!vm.sourceCommits.length && <button className="load-more" onClick={() => c.loadSource(true)}>Carregar mais commits</button>}<p className="hint padded">Os commits serão aplicados do mais antigo ao mais novo, respeitando o histórico da origem.</p></section>
    <section className="card destinations"><div className="card-heading"><div><span className="step-label">2 · Destinos</span><h2>Defina a sequência</h2></div></div>{vm.targets.map((target, index) => <div className="destination" key={index}><span className="step-number">{index + 1}</span><BranchPicker label={`Destino ${index + 1}${index ? ' · opcional' : ' · obrigatório'}`} value={target} branches={vm.branches} onChange={value => c.setTarget(index, value)} disabled={!vm.source || index > 0 && !vm.targets[index - 1]}/></div>)}<p className="hint">Em cada destino: trocar ramo → cherry-pick → push. Uma falha interrompe os destinos seguintes.</p><button className="primary wide" disabled={!vm.source || !vm.selectedCommits.length || !vm.targets[0] || !!execution && !execution.finished} onClick={c.review}>Revisar sequência →</button></section></div>
    {vm.review && <section className="card review"><h2>Pronto para aplicar e enviar</h2><p><strong>{vm.selectedCommits.length} commits</strong> de <code>{vm.source}</code> serão enviados para:</p><div className="route">{vm.targets.filter(Boolean).map((t, i) => <span key={i}>{i > 0 && '→ '}<code>{t}</code></span>)}</div><div className="review-commits">{vm.sourceCommits.filter(c => vm.selectedCommits.includes(c.hash)).map(c => <p key={c.hash}><code>{c.hash.slice(0, 8)}</code> {c.subject}</p>)}</div><p className="hint">A atualização remota ocorre antes de começar. Destinos com commits locais pendentes precisam ser revisados e enviados primeiro.</p><div className="card-actions"><button onClick={() => c.set({ review: false })}>Voltar</button><button className="primary" onClick={c.execute}>Aplicar commits e fazer push</button></div></section>}
    {execution && <section className="card"><div className="card-heading"><h2>{execution.cancelledAt ? 'Última sequência cancelada' : execution.finished ? 'Última sequência concluída' : 'Sequência pendente'}</h2><small>{new Date(execution.startedAt).toLocaleString('pt-BR')}</small></div><p className="hint padded">Origem: {execution.source} · {execution.commits.map(h => h.slice(0, 8)).join(', ')}</p>{execution.targets.map((t, i) => <div className="execution-target" key={i}><div><span className={`phase-dot ${t.phase}`}/><strong>{t.branch}</strong><span className="pill">{({ pending: 'Não iniciado', switching: 'Trocando ramo', pman: 'Executando pman', applying: 'Aplicando commits', pushing: 'Enviando', done: 'Push concluído', failed: 'Falhou', interrupted: 'Interrompido' })[t.phase]}</span></div>{t.error && <pre className="execution-error">{t.error}</pre>}</div>)}{!execution.finished && <div className="recovery"><button onClick={c.cancelCherryPick}>Cancelar sequência</button><p className="hint">Encerra esta sequência e libera uma nova tentativa. Commits e arquivos são preservados. Conflitos ou operações ainda abertas no Git precisam ser resolvidos separadamente.</p><button onClick={() => c.resume('retry')}>{execution.targets.find(t => t.phase !== 'done')?.failedAt === 'pushing' ? 'Tentar somente o push e continuar' : 'Tentar destino novamente'}</button><label className="manual-check"><input type="checkbox" checked={vm.manualConfirmed} onChange={e => c.set({ manualConfirmed: e.target.checked })}/>Concluí o cherry-pick manualmente no destino pendente e revisei todos os commits locais que serão enviados.</label><button disabled={!vm.manualConfirmed} onClick={() => c.resume('manual')}>Enviar resultado manual e continuar</button><p className="hint">Para a conclusão manual, deixe o destino pendente selecionado no Git e sem conflitos ou arquivos alterados. Destinos já enviados serão preservados.</p></div>}</section>}
    {vm.detail && <section className="card"><div className="card-heading"><h2>Revisão do commit <code>{vm.selectedCommit.slice(0, 8)}</code></h2><button onClick={() => c.set({ detail: undefined })}>Fechar diff</button></div><Detail detail={vm.detail} selectedFile={vm.selectedCommitFile} onSelectFile={c.showCommitFile}/></section>}
  </>;
}
