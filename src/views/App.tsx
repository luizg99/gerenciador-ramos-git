import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppController, type Tab, type ViewModel } from '../controllers/appController';
import type { CloneSource, Progress, RemoteRepository } from '../models/domain';
import { ref } from '../models/validation';
import { greeting, parseJiraIssue, prLabel, type ReviewMessage } from '../models/reviewMessage';
import { Gemini } from './Gemini';
import { Jira } from './Jira';
import { Home } from './Home';
import { MyTasksPicker } from './MyTasksPicker';
import { PR_DESCRIPTION_LIMIT, prBranchProblem, type PrBranchInfo } from '../models/prBranch';
import { JIRA_BASE } from '../models/jira';
import { JiraReport } from './JiraReport';
import packageJson from '../../package.json';
import { BranchPicker, CommitList } from './components';
import { technicalGuide, technicalIntro } from './technicalGuide';
const cherryIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="17" r="4"/><circle cx="17" cy="16" r="4"/><path d="M7 13C8 8 11 5 15 3M17 12c-1-4-2-7-2-9"/><path d="M15 3c2.5-.5 4.5.5 5 2.5-2.5.5-4-.5-5-2.5z"/></svg>;
const pullRequestIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4"/><path d="M13 3.5 10.5 6 13 8.5"/></svg>;
const navigation: { tab: Tab; icon: ReactNode; label: string }[] = [{ tab: 'home', icon: '⌂', label: 'Início' }, { tab: 'switch', icon: '⑂', label: 'Criar / Alterar ramo' }, { tab: 'history', icon: '◷', label: 'Histórico' }, { tab: 'commit', icon: '±', label: 'Alterações e commit' }, { tab: 'cherry', icon: cherryIcon, label: 'Cherry-pick' }, { tab: 'pr', icon: pullRequestIcon, label: 'Criar pull request' }, { tab: 'gemini', icon: '✦', label: 'Gemini' }, { tab: 'jira', icon: '▤', label: 'Jira' }, { tab: 'jiraReport', icon: '◔', label: 'Relatório jira' }];
type Props = { c: AppController; vm: ViewModel };
const statusLabels: Record<string, string> = { M: 'Modificado', A: 'Adicionado', D: 'Excluído', R: 'Renomeado', C: 'Copiado', U: 'Em conflito', N: 'Novo (não rastreado)', T: 'Tipo alterado' };
// Nunca abre sozinho: a última linha corre no resumo e o cliente clica para expandir.
// Fica fora do App e memoizado: o log (até 200 linhas) só é redesenhado quando chega um evento novo, e não a cada tecla digitada.
const ActivityLog = memo(function ActivityLog({ progress, busy }: { progress: Progress[]; busy: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; };
  useLayoutEffect(scrollToBottom, [progress, busy]);
  if (!progress.length) return null;
  return <details className="operation-log" onToggle={e => { if (e.currentTarget.open) scrollToBottom(); }}><summary>Atividade da sessão <em>{progress[progress.length - 1]?.message}</em><span>{progress.length} eventos</span></summary><div ref={logRef}>{progress.map((p, i) => <p key={i}><time>{new Date(p.time).toLocaleTimeString('pt-BR')}</time>{p.message}</p>)}</div></details>;
});
// "Ramo atual": troca de ramo direto na barra superior, com busca. Nome que não existe → aviso e atalho para criar o ramo.
function BranchSwitcher({ c, vm }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const status = vm.status;
  if (!status) return null;
  const current = status.branch;
  const typed = search.trim();
  const dirty = status.files.length > 0 || !!status.operation;
  const matches = vm.branches.filter(branch => branch.name.toLowerCase().includes(typed.toLowerCase()));
  const shown = matches.slice(0, 200);
  const exists = !typed || branchExists(vm.branches, typed);
  const valid = validBranchName(typed);
  const close = () => { setOpen(false); setSearch(''); };
  const choose = (name: string) => { close(); if (name === current) return; if (dirty) c.prepareSwitch(name); else void c.quickSwitch(name); };
  const create = () => { const name = typed; close(); c.startCreateBranch(name); };
  const toggle = () => setOpen(value => !value);
  return <div className="branch-switcher" ref={box}>
    <span className="branch-badge" title="Ramo atual">
      <span className="lead">Ramo atual</span>
      <span className="branch-name" aria-label={`Ramo atual ${current}`} onClick={() => { if (!window.getSelection()?.toString()) toggle(); }}>⑂ {current}</span>
      <button type="button" className="copy-branch" title="Copiar nome do ramo" aria-label="Copiar nome do ramo" disabled={vm.busy} onClick={c.copyBranchName}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button>
      <button type="button" className="branch-toggle" aria-haspopup="listbox" aria-expanded={open} aria-label="Trocar de ramo" title="Trocar de ramo" disabled={vm.busy} onClick={toggle}>▾</button>
    </span>
    {open && <div className="project-menu branch-menu">
      <input autoFocus className="project-search" placeholder="Buscar ou digitar o nome de um ramo…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar ramo" spellCheck={false} autoComplete="off"
        onKeyDown={e => { if (e.key !== 'Enter') return; if (matches.length === 1) choose(matches[0].name); else if (typed && !exists && valid) create(); }}/>
      {dirty && <p className="branch-hint">Há alterações locais: ao escolher um ramo você vai para a tela de troca e decide o que fazer com elas.</p>}
      <div className="project-list" role="listbox" aria-label="Ramos">{shown.map(branch => <button key={branch.ref} role="option" aria-selected={branch.current} className={`project ${branch.current ? 'selected' : ''}`} onClick={() => choose(branch.name)} title={branch.name}><span className="project-icon">⑂</span><span><strong>{branch.name}</strong><small>{branch.remote ? 'Remoto' : 'Local'}{branch.current ? ' · atual' : ''}</small></span>{branch.current && <i/>}</button>)}
        {matches.length > shown.length && <p className="sidebar-hint">Mostrando {shown.length} de {matches.length}. Refine a busca.</p>}
        {!matches.length && !typed && <p className="sidebar-hint">Nenhum ramo encontrado.</p>}</div>
      {typed && !exists && <div className="branch-missing" role="alert">{valid
        ? <><p>O ramo <strong>{typed}</strong> não existe.</p><button type="button" className="primary" onClick={create}>Criar o ramo “{typed}”</button></>
        : <p>“{typed}” não é um nome de ramo válido (sem espaços, <code>~ ^ : ? * [ \\</code> nem <code>..</code>).</p>}</div>}
    </div>}
  </div>;
}
// "Você está trabalhando na pasta": troca de projeto direto na barra superior, com busca e atalho para gerenciar as pastas.
function ProjectSwitcher({ c, vm }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const repo = c.repository;
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const close = () => { setOpen(false); setSearch(''); };
  const projects = vm.snapshot.repositories.filter(r => r.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="project-switcher" ref={box}>
    <button type="button" className="project-switcher-button" aria-haspopup="listbox" aria-expanded={open} disabled={vm.busy} onClick={() => setOpen(value => !value)} title={repo?.path ?? 'Escolher o projeto'}>
      <span className="folder" aria-hidden="true">▣</span><span className="lead">{repo ? 'Você está trabalhando na pasta' : 'Nenhum projeto selecionado'}</span>{repo && <strong>{repo.name}</strong>}<span className="chevron" aria-hidden="true">▾</span>
    </button>
    {open && <div className="project-menu">
      <input autoFocus className="project-search" placeholder="Buscar projeto…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar projeto"/>
      <div className="project-list" role="listbox" aria-label="Projetos">{projects.map(r => <button key={r.id} role="option" aria-selected={r.id === repo?.id} className={`project ${r.id === repo?.id ? 'selected' : ''}`} onClick={() => { close(); void c.selectRepository(r.id); }} title={r.path}><span className="project-icon">▣</span><span><strong>{r.name}</strong><small>{r.path}</small></span>{r.id === repo?.id && <i/>}</button>)}
        {!projects.length && <p className="sidebar-hint">{vm.snapshot.repositories.length ? 'Nenhum projeto com esse nome.' : vm.loadingRepository || vm.snapshot.scanning ? 'Carregando pastas…' : 'Adicione sua pasta de projetos para começar.'}</p>}</div>
      <div className="project-menu-footer"><span>{vm.snapshot.repositories.length} {vm.snapshot.repositories.length === 1 ? 'projeto' : 'projetos'}{vm.snapshot.scanning ? ' · atualizando…' : ''}</span><button type="button" className="quiet" onClick={() => { close(); c.selectTab('projects'); }}>Gerenciar pastas de projetos</button></div>
    </div>}
  </div>;
}
export function App({ controller: c }: { controller: AppController }) {
  const vm = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const [cloneOpen, setCloneOpen] = useState(false);
  useEffect(() => c.connect(), [c]);
  useLayoutEffect(() => { document.documentElement.dataset.theme = c.theme; }, [c, vm.snapshot.settings.theme]);
  const repo = c.repository;
  return <div className="app-shell">
    <aside className="sidebar">
      <nav>{navigation.filter(item => item.tab === 'home' ? c.useJira : item.tab === 'gemini' ? c.useGemini : (item.tab === 'jira' || item.tab === 'jiraReport') ? c.useJira : item.tab === 'pr' ? c.useAzure : true).map(item => <button key={item.tab} aria-label={item.label} disabled={(item.tab !== 'home' && item.tab !== 'gemini' && item.tab !== 'jira' && item.tab !== 'jiraReport' && !repo) || vm.busy} className={[vm.tab === item.tab ? 'selected' : '', item.tab === 'gemini' ? 'gemini-nav' : '', item.tab === 'jira' ? 'jira-nav' : '', item.tab === 'commit' && (vm.status?.ahead ?? 0) > 0 ? 'push-pending' : ''].join(' ')} title={item.tab === 'commit' && (vm.status?.ahead ?? 0) > 0 ? `Push pendente: ${vm.status?.ahead} ${vm.status?.ahead === 1 ? 'commit' : 'commits'} para enviar` : undefined} onClick={() => c.selectTab(item.tab)}><span aria-hidden="true">{item.icon}</span>{item.label}{item.tab === 'commit' && !!vm.status?.files.length && <b>{vm.status.files.length}</b>}</button>)}</nav>
      <button className={`settings-link ${vm.tab === 'settings' ? 'selected' : ''}`} onClick={() => c.selectTab('settings')} disabled={vm.busy}>⚙ Configurações</button><div className="sidebar-footer"><ThemePicker c={c} disabled={vm.busy}/><span>v{packageJson.version}</span></div>
    </aside>
    <main>{!['jira', 'gemini'].includes(vm.tab) && <header className="topbar"><div className="topbar-title"><BranchSwitcher c={c} vm={vm}/>{repo && vm.loadingRepository && <span className="loading-hint"><span className="spinner"/>Carregando projeto…</span>}</div><ProjectSwitcher c={c} vm={vm}/><div className="topbar-right"><button className="quiet" disabled={!repo || vm.busy} onClick={c.refresh} title="Relê o estado do repositório e busca os ramos novos do remoto (git fetch --all --prune)">↻ Atualizar</button>{repo && vm.tab !== 'projects' && <button className="quiet" disabled={vm.busy || !vm.status || vm.status.branch.startsWith('(')} onClick={c.fetch} title={`Busca apenas ${vm.status?.upstream ?? vm.status?.branch ?? 'o ramo atual'} no servidor (git fetch)`}>⇣ Buscar da {vm.status?.upstream?.split('/').slice(1).join('/') || vm.status?.branch || 'ramo atual'}</button>}</div></header>}
      <div className="page-scroll"><div className="page"><div className="page-heading"><div className="page-heading-top"><h1>{vm.tab === 'projects' ? 'Seus projetos' : vm.tab === 'settings' ? 'Configurações' : navigation.find(n => n.tab === vm.tab)?.label}</h1>{vm.tab === 'projects' && <button type="button" className="primary" disabled={vm.busy} onClick={() => setCloneOpen(true)}>＋ Clonar repositório</button>}</div><p>{({ home: 'Suas tarefas do Jira por status, com as sub-tarefas em cascata.', settings: 'Preferências lembradas neste computador.', projects: 'Escolha um projeto para começar ou gerencie as pastas onde eles ficam.', switch: `Pesquise um ramo para trocar ou digite um nome novo para criar.${c.usePman ? ' As dependências são instaladas em seguida, se a opção estiver marcada.' : ''}`, history: 'Navegue pelos commits e veja o que mudou em cada um.', commit: 'Acompanha as alterações pendentes e abre o commit no TortoiseGit.', cherry: 'Leve commits de um ramo para até três destinos, em sequência.', pr: 'Crie os pull requests no Azure com as mensagens dos commits na descrição.', gemini: 'Prepare a documentação da entrega com o Gem da equipe.', jira: 'Revise e execute o encerramento das tarefas no Jira.', jiraReport: 'Acompanhe o que cada pessoa da squad já concluiu no Jira.' })[vm.tab]}</p></div>
      {vm.error && <div className="alert error" role="alert"><strong>Não foi possível concluir</strong><p>{vm.error}</p><button onClick={() => c.set({ error: '' })}>Fechar</button></div>}
      {vm.notice && <div className="alert success" role="status">{vm.notice}</div>}
      <PushWarningDialog c={c} message={vm.pushWarning}/>
      {vm.busy && <div className="running" role="status"><span className="spinner"/> {vm.busyMessage || 'Carregando...'}</div>}
      {vm.status?.operation && <div className="alert error">Operação Git em andamento: {vm.status.operation}. Resolva ou cancele antes de continuar. <button onClick={c.cancelOperation} disabled={vm.busy}>Cancelar operação</button></div>}
      <div hidden={vm.tab !== 'jira'}><Jira active={vm.tab === 'jira'} openSettings={c.openJiraTokenSettings}/></div><fieldset className="page-content" disabled={vm.busy}>{vm.tab === 'projects' ? <Projects c={c} vm={vm}/> : vm.tab === 'settings' ? <Settings c={c} vm={vm}/> : vm.tab === 'gemini' ? <Gemini/> : vm.tab === 'home' ? <Home c={c}/> : vm.tab === 'jira' ? null : vm.tab === 'jiraReport' ? <JiraReport initialSquad={vm.snapshot.settings.ui?.jiraSquad} initialIgnored={vm.snapshot.settings.ui?.jiraIgnored} save={c.saveJiraSquad} initialPeriod={vm.snapshot.settings.ui} savePeriod={c.saveJiraPeriod}/> : !repo ? vm.busy || vm.loadingRepository ? null : <div className="empty"><h2>Selecione um projeto</h2><button onClick={c.chooseRoot}>Adicionar pasta de projetos</button></div> : vm.tab === 'switch' ? <Switch c={c} vm={vm}/> : vm.tab === 'history' ? <History c={c} vm={vm}/> : vm.tab === 'commit' ? <Changes c={c} vm={vm}/> : vm.tab === 'cherry' ? <Cherry c={c} vm={vm}/> : <PullRequest c={c} vm={vm}/>}</fieldset>{vm.tab === 'projects' && cloneOpen && <CloneDialog c={c} vm={vm} onClose={() => setCloneOpen(false)}/>}
      </div></div>
      {vm.tortoiseLocked && <div className={`tortoise-toast ${vm.tortoiseOpened ? 'opened' : ''}`} role="status">{vm.tortoiseOpened ? <><span aria-hidden="true">✓</span>TortoiseGit aberto</> : <><span className="spinner"/>Abrindo o TortoiseGit, aguarde…</>}</div>}
      <ActivityLog progress={vm.progress} busy={vm.busy}/>
      <footer className="main-footer"><span>{repo?.path ?? 'Nenhum projeto selecionado'}</span><span>{vm.busy ? 'Operação em andamento' : 'Pronto'}</span></footer>
    </main>
  </div>;
}
function Projects({ c, vm }: Props) {
  const found = <section className="card" key="found"><div className="card-heading"><h2>Repositórios encontrados <span className="count">{vm.snapshot.repositories.length}</span></h2><button onClick={c.scan}>Procurar novamente</button></div><div className="repo-grid">{vm.snapshot.repositories.map(r => <button className="repo-card" key={r.id} onClick={() => c.selectRepository(r.id)}><span>▣</span><strong>{r.name}</strong><small>{r.path}</small><b>Abrir projeto →</b></button>)}</div></section>;
  const folders = <section className="card" key="folders"><div className="card-heading"><div><h2>Pastas de projetos</h2><p>Repositórios são encontrados até quatro níveis abaixo de cada pasta.</p></div><button className="primary" onClick={c.chooseRoot}>＋ Adicionar pasta</button></div>{vm.snapshot.settings.roots.length ? vm.snapshot.settings.roots.map(root => <div className="root-row" key={root}><code>{root}</code><button onClick={() => c.removeRoot(root)}>Remover da lista</button></div>) : <div className="empty"><span className="empty-symbol">▱</span><h3>Tudo começa com uma pasta</h3><p>Selecione, por exemplo, sua pasta Documents\GitHub.</p><button className="primary" onClick={c.chooseRoot}>Escolher pasta de projetos</button></div>}</section>;
  // Com projetos já encontrados, escolher um é o que importa; as pastas (configuração) ficam abaixo.
  return <>{vm.snapshot.repositories.length ? [found, folders] : [folders, found]}</>;
}

function splitClonePath(value: string) {
  if (/[\\/]$/.test(value.trim())) return null;
  const full = value.trim().replace(/[\\/]+$/, '');
  const separator = Math.max(full.lastIndexOf('\\'), full.lastIndexOf('/'));
  if (separator < 0 || !full.slice(separator + 1)) return null;
  const parent = separator === 2 && /^[a-z]:/i.test(full) ? full.slice(0, 3) : full.slice(0, separator) || full[0];
  return { parent, name: full.slice(separator + 1) };
}

function CloneDialog({ c, vm, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); return () => { if (dialog.current?.open) dialog.current.close(); }; }, []);
  const [source, setSource] = useState<CloneSource>('github');
  const [url, setUrl] = useState('');
  const [suggestedParent, setSuggestedParent] = useState(vm.snapshot.settings.roots[0] ?? '');
  const [suggestedName, setSuggestedName] = useState('');
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [organization, setOrganization] = useState(() => c.azureOrganizationUrl);
  const [enterpriseUrl, setEnterpriseUrl] = useState('');
  const [project, setProject] = useState('');
  const [filter, setFilter] = useState('');
  const [repositories, setRepositories] = useState<RemoteRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void c.defaultCloneFolder().then(value => { if (active) setSuggestedParent(current => current || value); }).catch(cause => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [c]);
  const localPath = customPath ?? (suggestedParent ? `${suggestedParent.replace(/[\\/]+$/, '')}\\${suggestedName}` : '');
  const destination = splitClonePath(localPath);
  const sources: { id: CloneSource; label: string }[] = [{ id: 'github', label: 'GitHub.com' }, { id: 'enterprise', label: 'GitHub Enterprise' }, { id: 'url', label: 'URL' }, ...(c.useAzure ? [{ id: 'azure' as const, label: 'Azure Repos' }] : [])];
  const chooseSource = (next: CloneSource) => { setSource(next); setUrl(''); setSuggestedName(''); setCustomPath(null); setRepositories([]); setFilter(''); setError(''); };
  const chooseFolder = async () => { try { const selected = await c.chooseCloneFolder(destination?.parent ?? suggestedParent); if (selected) { setSuggestedParent(selected); setCustomPath(customPath === null ? null : `${selected.replace(/[\\/]+$/, '')}\\${destination?.name ?? suggestedName}`); } } catch (cause) { setError((cause as Error).message); } };
  const lookup = async () => {
    setError(''); setLoading(true); setRepositories([]);
    try {
      const found = source === 'azure' ? await c.listAzureRepositories(organization, project) : await c.listGitHubRepositories(source as 'github' | 'enterprise', enterpriseUrl);
      setRepositories(found);
      if (source === 'azure') c.saveAzureOrganization(organization);
    }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const selectRemote = (repo: RemoteRepository) => { setUrl(repo.cloneUrl); setSuggestedName(source === 'azure' ? repo.name : repo.cloneUrl.replace(/\/$/, '').split('/').pop()?.replace(/\.git$/, '') ?? repo.name); setError(''); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!destination) { setError('Informe o caminho completo da nova pasta do repositório.'); return; }
    await c.cloneRepository(source, url, destination.parent, destination.name);
    const cloneError = c.getSnapshot().error;
    if (cloneError) { setError(cloneError); c.set({ error: '' }); }
    else onClose();
  };
  return <dialog ref={dialog} className="clone-dialog" aria-labelledby="clone-dialog-title" onCancel={event => { event.preventDefault(); if (!vm.busy) onClose(); }}>
    <div className="clone-dialog-heading"><div><h2 id="clone-dialog-title">Clonar repositório</h2><p>Escolha a origem e a pasta onde o projeto será salvo.</p></div><button type="button" className="clone-dialog-close" aria-label="Fechar" onClick={onClose} disabled={vm.busy}>×</button></div>
    <fieldset className="clone-dialog-content" disabled={vm.busy}><div className="clone-body"><div className="clone-sources" role="tablist" aria-label="Origem do repositório">{sources.map(item => <button key={item.id} type="button" role="tab" aria-selected={source === item.id} className={source === item.id ? 'selected' : ''} onClick={() => chooseSource(item.id)}>{item.label}</button>)}</div>
      {(source === 'github' || source === 'enterprise') && <div className="clone-azure">{source === 'enterprise' && <label className="field"><span>Servidor GitHub Enterprise</span><input value={enterpriseUrl} onChange={e => setEnterpriseUrl(e.target.value)} placeholder="https://github.empresa.com"/></label>}<button type="button" onClick={lookup} disabled={loading || source === 'enterprise' && !enterpriseUrl.trim()}>{loading ? 'Buscando…' : 'Listar meus repositórios'}</button>{!loading && !repositories.length && !error && <p className="hint">Use suas credenciais Git para listar repositórios, ou cole a URL abaixo.</p>}</div>}
      {source === 'azure' && <div className="clone-azure"><div className="clone-grid"><label className="field"><span>Organização Azure</span><input value={organization} onChange={e => setOrganization(e.target.value)} onBlur={() => c.saveAzureOrganization(organization)} placeholder="https://totvstfs.visualstudio.com/Linha-Winthor"/></label><label className="field"><span>Projeto (opcional)</span><input value={project} onChange={e => setProject(e.target.value)} placeholder="Filtrar por projeto"/></label></div><button type="button" onClick={lookup} disabled={loading || !organization.trim()}>{loading ? 'Buscando…' : 'Listar repositórios'}</button>{!!repositories.length && <><label className="field"><span>Filtrar repositórios</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome do repositório ou projeto"/></label><div className="clone-results">{repositories.filter(repo => `${repo.name} ${repo.project}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(repo => <button type="button" key={repo.cloneUrl} onClick={() => selectRemote(repo)} className={url === repo.cloneUrl ? 'selected' : ''}><strong>{repo.name}</strong><small>{repo.project}</small></button>)}</div></>}{!loading && organization && !repositories.length && !error && <p className="hint">Nenhum repositório listado. Confira a organização, o projeto e suas credenciais Git.</p>}</div>}
      {(source === 'github' || source === 'enterprise') && !!repositories.length && <div className="clone-azure"><label className="field"><span>Filtrar repositórios</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Nome ou proprietário"/></label><div className="clone-results">{repositories.filter(repo => `${repo.name} ${repo.project}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(repo => <button type="button" key={repo.cloneUrl} onClick={() => selectRemote(repo)} className={url === repo.cloneUrl ? 'selected' : ''}><strong>{repo.name}</strong></button>)}</div></div>}
      <form onSubmit={submit}>
        <label className="field"><span>URL do repositório</span><input type="text" value={url} onChange={e => { const value = e.target.value; setUrl(value); setSuggestedName(value.replace(/\/$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? ''); }} required placeholder={source === 'github' ? 'https://github.com/usuario/repositorio.git' : source === 'enterprise' ? 'https://github.empresa.com/equipe/repositorio.git' : source === 'azure' ? 'Selecione um repositório acima ou cole a URL' : 'https://servidor/equipe/repositorio.git'}/></label>
        <div className="field"><span id="clone-local-path-label">Caminho local</span><div className="clone-destination"><input type="text" aria-labelledby="clone-local-path-label" value={localPath} onChange={e => setCustomPath(e.target.value)} required placeholder="C:\Users\Nome\Documents\GitHub\repositorio"/><button type="button" onClick={chooseFolder}>Escolher pasta…</button></div><small className="hint">Edite o caminho completo ou escolha outra pasta.</small></div>
        {error && <p className="inline-warning" role="alert">{error}</p>}
        <div className="card-actions"><button type="button" onClick={onClose} disabled={vm.busy}>Cancelar</button><button className="primary" type="submit" disabled={vm.busy || !url.trim() || !destination}>Clonar repositório</button></div>
      </form>
    </div></fieldset></dialog>;
}
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
    const baseMissing = !!row.base.trim() && !branchExists(vm.branches, rowBase) && !vm.branches.some(b => b.ref === rowBase) && !earlier.includes(rowBase);
    const error = !name ? baseMissing ? `A base ${rowBase} não existe neste projeto.` : '' : !validBranchName(name) ? 'Nome inválido (sem espaços, ~ ^ : ? * [ \\ nem ..).' : branchExists(vm.branches, name) ? 'Esse ramo já existe.' : vm.branchRows.findIndex(r => r.name.trim() === name) !== index ? 'Nome repetido.'
      : !rowBase ? 'Informe a base.' : !branchExists(vm.branches, rowBase) && !vm.branches.some(b => b.ref === rowBase) && !earlier.includes(rowBase) ? `A base ${rowBase} não existe neste projeto.` : '';
    return { name, base: rowBase, error, earlier };
  });
  // Linhas sem nome são ignoradas; as preenchidas precisam estar corretas.
  const filledRows = rows.filter(r => r.name).length;
  const rowsReady = filledRows > 0 && rows.every(r => !r.error);
  const switchRow = vm.switchRow !== null && rows[vm.switchRow]?.name ? vm.switchRow : null;
  const switching = !vm.dynamicBranches || switchRow !== null;
  const switchLabel = vm.dynamicBranches ? switchRow !== null ? rows[switchRow].name : 'nenhum (os ramos serão apenas criados)' : target ? creating ? `${target} (novo, a partir de ${base || '—'})` : target : '—';
  return <section className="card switch-card">
    <dialog ref={noSwitchDialog} className="issue-dialog" aria-labelledby="no-switch-title">
      <h2 id="no-switch-title">Nenhum ramo marcado para trocar</h2>
      <p>Os ramos serão criados sem alterar o ramo atual. Deseja continuar?</p>
      <div className="card-actions"><button autoFocus onClick={() => noSwitchDialog.current?.close()}>Voltar</button><button className="primary" onClick={() => { noSwitchDialog.current?.close(); void c.createBranches(); }}>Criar sem trocar</button></div>
    </dialog>
    <div className="summary"><span>Atual <strong>⑂ {current || '—'}</strong></span><span className={dirty ? 'amber' : 'green'}>{dirty ? `${vm.status?.files.length} arquivos alterados` : 'Sem alterações locais'}</span><span>↑ {vm.status?.ahead ?? 0} para enviar · ↓ {vm.status?.behind ?? 0} para receber</span>
      <label className="manual-check dynamic-toggle"><input type="checkbox" checked={vm.dynamicBranches} onChange={e => c.setDynamicBranches(e.target.checked)}/>Criação dinâmica de ramos <small>(até 4 de uma vez)</small></label></div>
    {vm.dynamicBranches && <p className="dynamic-hint" role="note">Para apenas trocar de ramo ou criar um único ramo, desmarque “Criação dinâmica de ramos”. Com ela marcada, use as linhas abaixo para criar até 4 ramos de uma vez (linhas sem nome são ignoradas).</p>}
    {vm.dynamicBranches ? <div className="batch">
      <div className="pr-toolbar"><div className="pr-toggles"><label className="manual-check"><input type="checkbox" checked={vm.rememberBranchBases} onChange={e => c.setRememberBranchBases(e.target.checked)}/>Lembrar “A partir de”</label><label className="manual-check"><input type="checkbox" checked={vm.publishNew} onChange={e => c.set({ publishNew: e.target.checked })}/>Enviar os ramos novos para o remoto (push) depois de criar (recomendado: o cherry-pick exige o destino no remoto)</label></div><div className="pr-preferences"><button type="button" className="quiet" onClick={c.clearBranchBases}>Limpar “A partir de”</button></div></div>
      {vm.branchRows.map((row, index) => <div className="batch-row" key={index}>
        <span className="step-number">{index + 1}</span>
        <label className="field"><span>Nome</span><input aria-label={`Nome do ramo ${index + 1}`} value={row.name} onChange={e => c.setBranchRow(index, { name: e.target.value })} placeholder="feature/novo-ramo" spellCheck={false} autoComplete="off"/></label>
        <BranchPicker label={`A partir de (${index + 1})`} value={row.base} branches={[...rows[index].earlier.map(asBranch), ...vm.branches]} onChange={value => c.setBranchRow(index, { base: value })} placeholder={current || 'Ramo de base…'}/>
        <label className="switch-here"><input type="checkbox" checked={switchRow === index} onChange={() => c.toggleSwitchRow(index)}/>Trocar para esse?</label>
        <button className="icon danger visible" title="Remover linha" aria-label={`Remover ramo ${index + 1}`} onClick={() => c.removeBranchRow(index)}>×</button>
        {rows[index].error && <p className="row-error">{rows[index].error}</p>}
      </div>)}
      {vm.branchRows.length < 4 && <button className="quiet add-row" onClick={c.addBranchRow}>+ Adicionar ramo</button>}
    </div> : <>
      <BranchPicker label="Ramo" value={vm.switchTarget} branches={vm.branches} onChange={switchTarget => c.set({ switchTarget })} placeholder="Pesquise um ramo ou digite o nome de um ramo novo…"/>
      {creating && <div className="create-branch">
        <p>{validName ? <>O ramo <code>{target}</code> não existe. Ele será criado a partir de:</> : <>Nome inválido: não use espaços, <code>{'~ ^ : ? * [ \\'}</code>, <code>..</code> nem termine com <code>/</code>.</>}</p>
        {validName && <><BranchPicker label="A partir de" value={vm.createBase} branches={vm.branches} onChange={createBase => c.set({ createBase })} placeholder={current || 'Ramo de base…'}/>
        <label className="manual-check"><input type="checkbox" checked={vm.publishNew} onChange={e => c.set({ publishNew: e.target.checked })}/>Enviar o ramo novo para o remoto (push) depois de criar</label></>}
      </div>}
    </>}
    {switching && <><p className="section-label">Se houver alterações locais</p><div className={`mode-grid ${dirty ? '' : 'compact'}`}>{modes.map(mode => <label key={mode.value} className={`mode-card ${vm.switchMode === mode.value ? 'active' : ''}`}><input type="radio" name="mode" value={mode.value} checked={vm.switchMode === mode.value} onChange={() => c.set({ switchMode: mode.value })}/><div><strong>{mode.title}{'tag' in mode && <span>{mode.tag}</span>}</strong><p>{mode.text}</p></div></label>)}</div>
    {dirty && vm.switchMode === 'block' && <p className="inline-warning">Há arquivos sem commit. Faça o commit ou escolha outra opção acima.</p>}</>}
    <div className="switch-footer">
      <div className="switch-side">
        <p className="hint">{!switching ? 'Os ramos são criados sem trocar o ramo atual.' : c.installOnSwitch ? <>Depois da troca, exclui <code>source/lib</code> permanentemente e roda <code>pman install -f</code> em <code>source</code>.</> : null}</p>
        {c.usePman && <div className="switch-pman"><p className="branch-note clamp" title={current}>Ramo atual = <strong>{current || '—'}</strong></p><button onClick={c.runPman}>Executar pman no ramo atual</button></div>}
      </div>
      <div className="switch-main">
        <p className="branch-note clamp" title={switchLabel}>Trocar para ramo = <strong>{switchLabel}</strong></p>
        {vm.dynamicBranches ? <button className="primary wide" disabled={!rowsReady || switching && blocked || !!vm.status?.operation} onClick={() => switchRow === null ? noSwitchDialog.current?.showModal() : c.createBranches()}>{`Criar ${filledRows} ${filledRows === 1 ? 'ramo' : 'ramos'}${switchRow !== null ? ' e trocar' : ''} →`}</button>
          : creating ? <button className="primary wide" disabled={!validName || !base || blocked} onClick={c.createBranch}>Criar ramo e trocar →</button> : <button className="primary wide" disabled={!target || blocked} onClick={c.switchBranch}>{c.installOnSwitch ? 'Trocar ramo e instalar →' : 'Trocar ramo →'}</button>}
        {c.usePman && <label className="manual-check"><input type="checkbox" checked={vm.installOnSwitch} onChange={e => c.set({ installOnSwitch: e.target.checked })}/>Executar pman ao trocar ramo</label>}
      </div>
    </div></section>;
}
function PullRequest({ c, vm }: Props) {
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const jiraInput = useRef<HTMLInputElement>(null);
  // Verifica os ramos (existem? têm commits que o destino não tem?) sempre que origem/destino mudam ou os ramos do remoto são atualizados.
  const [branchInfos, setBranchInfos] = useState<Record<string, PrBranchInfo>>({});
  // Textos que o usuário editou (ou limpou) na descrição; o que não está aqui usa as mensagens dos commits.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Os textos editados pertencem ao projeto em que foram escritos.
  const projectId = (() => { try { return c.id; } catch { return ''; } })();
  useEffect(() => setDrafts({}), [projectId]);
  const remoteName = vm.prInfo?.remote;
  const shortName = (value: string) => remoteName && value.startsWith(remoteName + '/') ? value.slice(remoteName.length + 1) : value;
  const wantedPairs = JSON.stringify((vm.dynamicPr ? vm.prRows : [{ source: vm.prSource, target: vm.prTarget }]).map(row => [shortName(row.source.trim()), shortName(row.target.trim())]).filter(([source, target]) => source && target && source !== target).slice(0, 4));
  useEffect(() => {
    const pairs = (JSON.parse(wantedPairs) as string[][]).map(([source, target]) => ({ source, target }));
    if (!pairs.length || !vm.prInfo?.webUrl) { setBranchInfos({}); return; }
    let alive = true, timer: ReturnType<typeof setTimeout>;
    // Se outra operação (ex.: busca no remoto ao abrir o projeto) estiver em andamento, o servidor recusa a leitura; tenta de novo logo em seguida.
    const load = (delay: number, attempt: number) => {
      timer = setTimeout(() => {
        try {
          void window.gitManager.prBranchInfo(c.id, pairs).then(found => { if (alive) setBranchInfos(Object.fromEntries(found.map(item => [`${item.source}→${item.target}`, item]))); })
            .catch(() => { if (!alive) return; if (attempt < 60) load(1000, attempt + 1); else setBranchInfos({}); });
        } catch { /* sem projeto selecionado */ }
      }, delay);
    };
    load(350, 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [wantedPairs, vm.branches, vm.prInfo?.webUrl]);
  const create = () => {
    if (!vm.jiraIssue.trim() || vm.dynamicPr && skippedRows > 0) confirmationDialog.current?.showModal();
    else void submit();
  };
  const submit = async () => {
    // Envia exatamente o texto mostrado; sem texto lido (falha na leitura) o servidor gera na hora.
    const texts = Object.fromEntries(activeKeys.flatMap(key => { const text = textOf(key); return key in drafts || branchInfos[key]?.description !== undefined ? [[key, text]] : []; }));
    if (await c.createPullRequests(texts)) setDrafts({});
  };
  const info = vm.prInfo;
  if (!info) return <section className="card"><div className="empty small">Lendo o remoto do repositório…</div></section>;
  if (!info.webUrl) return <section className="card"><div className="empty"><span className="empty-symbol">⇄</span><h3>Remoto não é do Azure DevOps</h3><p>{info.remoteUrl ? <>O remoto <code>{info.remote}</code> aponta para <code>{info.remoteUrl}</code>. A criação de pull request funciona com repositórios do Azure Repos.</> : 'Este repositório não tem remoto configurado.'}</p></div></section>;
  const short = (value: string) => info.remote && value.startsWith(info.remote + '/') ? value.slice(info.remote.length + 1) : value;
  const remoteNames = new Set(vm.branches.filter(b => b.remote).map(b => b.name));
  const published = (name: string) => !!name && remoteNames.has(`${info.remote}/${name}`);
  const check = (rawSource: string, rawTarget: string) => {
    const [source, target] = [short(rawSource.trim()), short(rawTarget.trim())];
    const problem = prBranchProblem(branchInfos[`${source}→${target}`]);
    const error = !source || !target ? '' : source === target ? 'Origem e destino precisam ser diferentes.' : problem?.error ? problem.error : !published(source) ? `O ramo ${source} ainda não está no remoto${problem?.toPush ? ` (tem ${problem.toPush} ${problem.toPush === 1 ? 'commit' : 'commits'} para enviar)` : ''}.` : !published(target) ? `O destino ${target} não existe no remoto.` : '';
    return { source, target, error, canPush: !problem?.error, ready: !!source && !!target && !error };
  };
  const single = check(vm.prSource, vm.prTarget);
  const rows = vm.prRows.map(row => check(row.source, row.target));
  const readyRows = rows.filter(row => row.ready);
  const skippedRows = rows.filter(row => !row.source || !row.target).length;
  const activeCount = vm.dynamicPr ? readyRows.length : single.ready ? 1 : 0;
  const pairs = rows.map(r => `${r.source}→${r.target}`);
  const textOf = (key: string) => drafts[key] ?? branchInfos[key]?.description ?? '';
  const activeKeys = (vm.dynamicPr ? readyRows : single.ready ? [single] : []).map(row => `${row.source}→${row.target}`);
  const descriptionEditor = (row: { source: string; target: string }) => {
    const key = `${row.source}→${row.target}`, text = textOf(key), edited = key in drafts, unread = !edited && branchInfos[key]?.description === undefined, over = text.length > PR_DESCRIPTION_LIMIT;
    return <div className="pr-description">
      <div className="pr-description-head"><label htmlFor={`pr-desc-${key}`}>Descrição do PR <small>mensagens dos commits{vm.dynamicPr ? ` · ${row.source} → ${row.target}` : ''}</small></label><span className={`char-count ${over ? 'over' : ''}`} aria-live="polite">{text.length}/{PR_DESCRIPTION_LIMIT}</span></div>
      <textarea id={`pr-desc-${key}`} rows={5} value={text} onChange={e => setDrafts(current => ({ ...current, [key]: e.target.value }))} placeholder={unread ? 'Não foi possível ler as mensagens dos commits agora; elas serão usadas na hora de criar o PR.' : 'Sem texto: o PR será criado com a descrição vazia.'}/>
      <div className="pr-description-actions">
        <button type="button" className="quiet" disabled={!text} onClick={() => setDrafts(current => ({ ...current, [key]: '' }))}>Limpar texto</button>
        <button type="button" className="quiet" disabled={!edited} onClick={() => setDrafts(current => { const next = { ...current }; delete next[key]; return next; })}>Preencher com os commits</button>
      </div>
      {over && <p className="row-error">A descrição passa do limite de {PR_DESCRIPTION_LIMIT} caracteres do Azure ({text.length - PR_DESCRIPTION_LIMIT} a mais). Reduza o texto: o Azure recusa a criação de um PR novo acima disso (um PR ativo já existente é só reaproveitado).</p>}
    </div>;
  };
  const rowsReady = readyRows.length > 0 && rows.every((r, i) => !r.source || !r.target || r.ready && pairs.indexOf(pairs[i]) === i);
  return <><section className="card switch-card">
    <dialog ref={confirmationDialog} className="issue-dialog" aria-labelledby="pr-confirm-title">
      <h2 id="pr-confirm-title">Confirmar criação dos PRs</h2>
      {!vm.jiraIssue.trim() && <p>A Issue Jira está vazia; os PRs serão criados sem vinculá-la.</p>}
      {vm.dynamicPr && skippedRows > 0 && <p>{skippedRows} {skippedRows === 1 ? 'linha está incompleta' : 'linhas estão incompletas'} e não {skippedRows === 1 ? 'terá' : 'terão'} PR criado. Somente os {readyRows.length} {readyRows.length === 1 ? 'par preenchido será enviado' : 'pares preenchidos serão enviados'}.</p>}
      <div className="card-actions">
        <button autoFocus onClick={() => { confirmationDialog.current?.close(); if (!vm.jiraIssue.trim()) jiraInput.current?.focus(); }}>Voltar</button>
        <button className="primary" onClick={() => { confirmationDialog.current?.close(); void submit(); }}>Criar {activeCount} {activeCount === 1 ? 'PR' : 'PRs'}</button>
      </div>
    </dialog>
    <div className="summary"><span>Azure Repos <strong>{info.webUrl.replace(/^https?:\/\//, '')}</strong></span></div>
    <div className="pr-toolbar"><div className="pr-toggles"><label className="manual-check dynamic-toggle"><input type="checkbox" checked={vm.dynamicPr} onChange={e => c.set({ dynamicPr: e.target.checked })}/>PR dinâmico <small>(até 4 de uma vez)</small></label><label className="manual-check"><input type="checkbox" checked={vm.rememberPrDestinations} onChange={e => c.setRememberPrDestinations(e.target.checked)}/>Lembrar destino</label></div><div className="pr-preferences"><button type="button" className="quiet" onClick={c.clearPrSources}>Limpar origens</button><button type="button" className="quiet" onClick={c.clearPrTargets}>Limpar destinos</button></div></div>
    {vm.dynamicPr ? <div className="batch">
      {vm.prRows.map((row, index) => <div className="batch-row pr-row" key={index}>
        <span className="step-number">{index + 1}</span>
        <BranchPicker label={`Origem (${index + 1})`} value={row.source} branches={vm.branches} onChange={source => c.setPrRow(index, { source })}/>
        <span className="pr-arrow" aria-hidden="true">→</span>
        <BranchPicker label={`Destino (${index + 1})`} value={row.target} branches={vm.branches} onChange={target => c.setPrRow(index, { target })}/>
        <button className="icon danger visible" title="Remover linha" aria-label={`Remover pull request ${index + 1}`} onClick={() => c.removePrRow(index)}>×</button>
        {row.url && <p className="row-error">PR: <ReviewLink c={c} url={row.url}/></p>}
        {(rows[index].error || pairs.indexOf(pairs[index]) !== index && rows[index].ready) && <p className="row-error">{rows[index].error || 'Pull request repetido.'}</p>}
        {rows[index].ready && descriptionEditor(rows[index])}
      </div>)}
      {vm.prRows.length < 4 && <button className="quiet add-row" onClick={c.addPrRow}>+ Adicionar pull request</button>}
    </div> : <>
      <div className="pr-fields"><BranchPicker label="Origem (seu ramo)" value={vm.prSource} branches={vm.branches} onChange={prSource => c.setSinglePr({ prSource })}/><span className="pr-arrow" aria-hidden="true">→</span><BranchPicker label="Destino" value={vm.prTarget} branches={vm.branches} onChange={prTarget => c.setSinglePr({ prTarget })}/></div>
      {single.source && !published(single.source) && <div className="create-branch"><p>{single.error || <>O ramo <code>{single.source}</code> ainda não está no remoto. Envie-o antes de abrir o pull request.</>}</p>{!single.canPush ? null : single.source === vm.status?.branch ? <button onClick={c.push}>↑ Enviar {single.source} para o remoto</button> : <p className="hint">Troque para esse ramo e use “Enviar”, ou escolha um ramo já publicado.</p>}</div>}
      {single.source && single.target && single.source === single.target && <p className="inline-warning">Origem e destino precisam ser diferentes.</p>}
      {single.ready && descriptionEditor(single)}
    </>}
    <label className="field jira-issue">Issue Jira <small>opcional</small><input ref={jiraInput} value={vm.jiraIssue} onChange={e => c.set({ jiraIssue: e.target.value })} placeholder="DDVENDAS-61611 ou link completo do Jira"/></label>
    {c.useJira && <MyTasksPicker disabled={vm.busy} onPick={key => c.set({ jiraIssue: `${JIRA_BASE}/browse/${key}` })}/>}
    <div className="card-actions"><p className="hint">Cria os PRs diretamente no Azure. A descrição vem preenchida com as mensagens completas dos commits de cada origem que ainda não estão no destino (Add commit messages) e pode ser editada ou limpa antes de criar. O título usa origem → destino. PRs ativos já existentes são reutilizados.</p>
      {vm.dynamicPr ? <button className="primary" disabled={!rowsReady} onClick={create}>{`Criar ${readyRows.length} ${readyRows.length === 1 ? 'pull request' : 'pull requests'} no Azure`}</button>
        : <button className="primary" disabled={!single.ready} onClick={create}>Criar pull request no Azure</button>}</div>
  </section><PrConflicts c={c} vm={vm}/><ReviewComposer c={c} vm={vm}/><ReviewHistory c={c} vm={vm}/></>;
}
function ReviewComposer({ c, vm }: Props) {
  const preview = c.reviewPreview;
  let issueError = '';
  try { parseJiraIssue(vm.jiraIssue); } catch (error) { issueError = (error as Error).message; }
  const pairs = (vm.dynamicPr ? vm.prRows : [{ source: vm.prSource, target: vm.prTarget }]).filter(pair => pair.source.trim() && pair.target.trim());
  return <section className="card review-composer">
    <div className="card-heading"><div><h2>Mensagem para revisão</h2><p className="hint">Depois de criar os PRs no Azure, os links são consultados pela origem e pelo destino.</p></div><button disabled={!!issueError || !pairs.length} onClick={c.findPullRequests}>Buscar PRs e gerar mensagem</button></div>
    {issueError && <p className="inline-warning padded">{issueError}</p>}
    {preview ? <><div className="review-message" aria-label="Prévia da mensagem"><p>{greeting()}, tarefa finalizada, disponível para revisão.</p>{preview.issue && <p>Issue do Jira:<br/><ReviewLink c={c} url={preview.issue.url} label={preview.issue.key}/></p>}<p>PRs:</p>{preview.prs.map(pr => <p key={pr.url}>{pr.target}: <ReviewLink c={c} url={pr.url} label={prLabel(pr.url)}/></p>)}</div><div className="card-actions"><p className="hint">Cole com Ctrl+V para manter os códigos do Jira e dos PRs como links. A saudação usa o horário local no momento da cópia.</p><button className="primary" onClick={c.copyReview}>Copiar mensagem</button></div></> : <p className="hint padded">Os links finais e o texto aparecerão aqui. Sem Issue Jira, a mensagem terá a saudação e a lista de PRs.</p>}
  </section>;
}
// Conflitos dos PRs recém-criados: cartão próprio, acima da "Mensagem para revisão".
function PrConflicts({ c, vm }: Props) {
  if (!vm.prConflicts.length) return null;
  const label = (state: string) => state === 'conflicts' ? '⚠ Com conflito' : state === 'ok' ? '✓ Sem conflito' : state === 'checking' ? '… Verificando' : state === 'none' ? '– PR não está mais ativo' : '? Não foi possível verificar agora';
  const conflicts = vm.prConflicts.filter(item => item.state === 'conflicts').length;
  return <section className="card pr-conflicts-card" aria-label="Conflitos nos PRs">
    <div className="card-heading"><div><h2>Conflitos nos PRs</h2><p className="hint">{conflicts ? `${conflicts} ${conflicts === 1 ? 'PR tem' : 'PRs têm'} conflito — resolva antes de pedir a revisão.` : 'O Azure calcula o merge em segundo plano; a verificação se repete sozinha por alguns segundos.'}</p></div><button type="button" className="quiet" onClick={() => void c.checkConflicts(1)}>↻ Verificar de novo</button></div>
    <div className="pr-conflict-list">{vm.prConflicts.map(item => <p key={item.url} className={`pr-conflict ${item.state}`}><span className="pr-conflict-badge">{label(item.state)}</span><span className="pr-conflict-pair">{item.source} → {item.target}</span><ReviewLink c={c} url={item.url} label={prLabel(item.url)}/></p>)}</div>
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
      return <details key={issue} open={!!query}><summary>{issue}{jiraUrl && <a className="issue-history-link" href={jiraUrl} aria-label={`Abrir issue ${issue} no Jira`} title="Abrir no Jira" onClick={event => { event.preventDefault(); event.stopPropagation(); void c.openReviewLink(jiraUrl); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg></a>} <span className="pill">{messages.length} {messages.length === 1 ? 'mensagem' : 'mensagens'}</span></summary>{messages.map(message => <article key={message.id}><div className="history-message-heading"><strong>{message.repositoryName}</strong><small>{new Date(message.createdAt).toLocaleString('pt-BR')}</small><button onClick={() => { setEditing(message); setIssueValue(message.issue?.key ?? ""); setIssueError(""); }}>{message.issue ? "Alterar issue do jira" : "Adicionar issue"}</button><button onClick={() => c.copyPreviousReview(message.id)}>Copiar mensagem anterior</button></div>{message.prs.map(pr => <p key={pr.url}>{pr.target}: <ReviewLink c={c} url={pr.url} label={prLabel(pr.url)}/></p>)}</article>)}</details>;
    })}
  </section>;
}
function ThemePicker({ c, disabled }: { c: AppController; disabled?: boolean }) {
  return <div className="theme-picker" role="group" aria-label="Tema da aplicação">{(['light', 'dark'] as const).map(theme => <button key={theme} aria-pressed={c.theme === theme} disabled={disabled} onClick={() => void c.setTheme(theme)}><span aria-hidden="true">{theme === 'light' ? '☀' : '☾'}</span> {theme === 'light' ? 'Claro' : 'Escuro'}</button>)}</div>;
}
function Settings({ c, vm }: Props) {
  const guide = useRef<HTMLDialogElement>(null);
  return <>
    <section className="card switch-card">
      <div className="appearance-setting"><div><h2>Aparência</h2><p className="hint">Tema da aplicação, lembrado neste computador.</p></div><ThemePicker c={c} disabled={vm.busy}/></div>
    </section>
    <section className="card switch-card">
      <h2 className="settings-group">Recursos</h2>
      <label className="setting-row"><input type="checkbox" checked={c.usePman} onChange={e => c.setUsePman(e.target.checked)}/><div><strong>Usa pman</strong><p>Ao trocar ou criar ramo em <em>Criar / Alterar ramo</em>, exclui <code>source/lib</code> permanentemente e executa <code>pman install -f</code> em <code>source</code>. O botão manual segue a mesma ordem. Desligado, o pman nunca é executado.</p></div></label>
      <label className="setting-row"><input type="checkbox" checked={c.useAzure} onChange={e => c.setUseAzure(e.target.checked)}/><div><strong>Usa Azure</strong><p>Mostra o menu Criar pull request.</p></div></label>
      <label className="setting-row"><input type="checkbox" checked={c.useJira} onChange={e => c.setUseJira(e.target.checked)}/><div><strong>Usa Jira</strong><p>Mostra os menus Jira e Relatório jira.</p></div></label>
      {c.useJira && <JiraTokenSetting/>}
      <label className="setting-row"><input type="checkbox" checked={c.useGemini} onChange={e => c.setUseGemini(e.target.checked)}/><div><strong>Usa GEM DEV</strong><p>Mostra o menu Gemini.</p></div></label>
    </section>
    <section className="card switch-card">
      <div className="history-path-setting"><div><h2>Histórico dos PRs</h2><p className="hint">Escolha uma pasta sincronizada pelo Google Drive para salvar <code>review-messages.json</code>. O histórico atual será combinado com o arquivo dessa pasta.</p><code className="history-path-value">{vm.snapshot.settings.reviewHistoryPath ?? 'Pasta local do aplicativo'}</code></div><div className="history-path-actions"><button disabled={vm.busy} onClick={c.chooseReviewHistoryFolder}>{vm.snapshot.settings.reviewHistoryPath ? 'Alterar pasta' : 'Escolher pasta'}</button>{vm.snapshot.settings.reviewHistoryPath && <button className="quiet" disabled={vm.busy} onClick={() => c.setReviewHistoryPath(undefined)}>Usar pasta local</button>}</div></div>
    </section>
    <section className="card switch-card">
      <div className="tech-setting"><div><h2>Explicação técnica</h2><p className="hint">Como o aplicativo funciona por dentro, tela por tela.</p></div><button onClick={() => guide.current?.showModal()}>Explicação técnica</button></div>
    </section>
    <dialog ref={guide} className="tech-dialog" aria-labelledby="tech-title" onClick={event => { if (event.target === guide.current) guide.current?.close(); }}>
      <div className="tech-heading"><div><h2 id="tech-title">Explicação técnica</h2><p>Resumo de como cada tela funciona.</p></div><button type="button" className="clone-dialog-close" aria-label="Fechar" onClick={() => guide.current?.close()}>×</button></div>
      <div className="tech-body">
        <p className="tech-intro">{technicalIntro}</p>
        {technicalGuide.map(item => <section key={item.title}><h3>{item.title}</h3><p>{item.text}</p></section>)}
      </div>
    </dialog>
  </>;
}
function History({ c, vm }: Props) {
  const open = (rev: string) => c.openTortoise('log', { ref: vm.historyRef, rev });
  return <section className="card"><div className="toolbar"><BranchPicker label="Histórico do ramo" value={vm.historyRef} branches={vm.branches} onChange={historyRef => c.set({ historyRef })}/><button onClick={() => c.loadHistory(vm.historyRef)}>Carregar histórico</button><button disabled={vm.tortoiseLocked} onClick={() => c.openTortoise('log', { ref: vm.historyRef })} title="Abre o Show log do TortoiseGit no ramo escolhido">Abrir Show log (TortoiseGit)</button></div>
    <p className="hint padded">{vm.loadingHistory ? 'Carregando commits…' : 'Clique em um commit para ver o que mudou nele no TortoiseGit.'}</p>
    <CommitList commits={vm.history} onInspect={open} inspectTitle="Abrir este commit no TortoiseGit" inspectDisabled={vm.tortoiseLocked}/>{!!vm.history.length && <button className="load-more" disabled={vm.loadingHistory} onClick={() => c.loadHistory(vm.historyRef, true)}>Carregar mais commits</button>}</section>;
}
const statusCode = (f: { index: string; worktree: string }) => f.index === '?' ? 'N' : f.index !== ' ' ? f.index : f.worktree;
function Changes({ c, vm }: Props) {
  const files = vm.status?.files ?? [];
  const pending = files.length;
  return <section className="card pending-card">
    <div className="pending-summary">
      <span className={`pending-dot ${pending ? 'amber' : 'green'}`} aria-hidden="true"/>
      <div className="pending-text"><h2>{pending ? `${pending} ${pending === 1 ? 'arquivo com commit pendente' : 'arquivos com commit pendente'}` : 'Nenhum commit pendente'}</h2><p className="hint">{pending ? 'Clique em “Abrir commit” para revisar e confirmar no TortoiseGit. Esta tela se atualiza sozinha quando o commit terminar.' : 'Tudo limpo. Se houver novas alterações no projeto, elas aparecem aqui automaticamente.'}</p></div>
      <div className="pending-actions"><button className="primary" disabled={!pending || vm.busy || vm.tortoiseLocked} onClick={() => c.openTortoise('commit')}>Abrir commit (TortoiseGit)</button><button disabled={vm.busy} onClick={c.push} title="Envia os commits locais para o upstream do ramo (ou origin, se ainda não configurado)">↑ Enviar (push){vm.status?.ahead ? ` (${vm.status.ahead})` : ''}</button></div>
    </div>
    {!!pending && <div className="file-list pending-files" aria-label="Arquivos pendentes">{files.map(f => { const code = statusCode(f); const slash = f.path.lastIndexOf('/'); return <div className="file-row readonly" key={f.path}><span className={`file-status s-${code}`} title={statusLabels[code] ?? code}>{code}</span><span className="file-label" title={f.path}>{f.path.slice(slash + 1)}{slash > 0 && <small>{f.path.slice(0, slash)}</small>}</span></div>; })}</div>}
  </section>;
}

function Cherry({ c, vm }: Props) {
  const execution = c.execution;
  const reviewRef = useRef<HTMLElement>(null);
  // Ao revisar a sequência, a tela desce até o resumo.
  useEffect(() => { if (vm.review) reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [vm.review]);
  const executionRef = useRef<HTMLElement>(null);
  // Ao aplicar os commits, a atividade da sessão abre no rodapé; o foco vai para o andamento da sequência.
  useEffect(() => {
    if (!vm.busy || !execution) return;
    const frame = requestAnimationFrame(() => executionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [vm.busy, execution?.id]);
  const outcome = execution?.cancelledAt ? { title: 'Última sequência cancelada', label: 'Cancelada', tone: 'cancelled' }
    : execution?.targets.some(target => target.phase === 'failed' || target.phase === 'interrupted') ? { title: 'Sequência interrompida', label: 'Interrompida por erro', tone: 'error' }
    : execution?.finished && execution.targets.every(target => target.phase === 'done') ? { title: 'Última sequência concluída', label: 'Concluída com sucesso', tone: 'success' }
    : execution?.targets.some(target => target.phase !== 'pending') ? { title: 'Sequência em andamento', label: 'Em andamento', tone: 'active' }
    : { title: 'Sequência pendente', label: 'Aguardando início', tone: 'pending' };
  return <><div className="cherry-layout"><section className="card"><div className="card-heading"><div><span className="step-label">1 · Origem</span><h2>Escolha o que levar</h2></div><span className="pill">{vm.selectedCommits.length} selecionados</span></div><div className="toolbar"><BranchPicker label="Ramo de origem" value={vm.source} branches={vm.branches} onChange={c.setSource}/><button disabled={!vm.source} onClick={() => c.loadSource()}>Carregar commits</button></div><CommitList commits={vm.sourceCommits} selected={vm.selectedCommits} selectable onSelect={c.toggleCommit} onInspect={rev => c.openTortoise('log', { ref: vm.source, rev })} inspectTitle="Abrir este commit no TortoiseGit" inspectDisabled={vm.tortoiseLocked}/>{!!vm.sourceCommits.length && <button className="load-more" onClick={() => c.loadSource(true)}>Carregar mais commits</button>}<p className="hint padded">Os commits serão aplicados do mais antigo ao mais novo, respeitando o histórico da origem. Clique no texto de um commit para ver o que mudou nele no TortoiseGit.</p></section>
    <section className="card destinations"><div className="card-heading"><div><span className="step-label">2 · Destinos</span><h2>Defina a sequência</h2></div></div>{vm.targets.map((target, index) => <div className="destination" key={index}><span className="step-number">{index + 1}</span><BranchPicker label={`Destino ${index + 1}${index ? ' · opcional' : ' · obrigatório'}`} value={target} branches={vm.branches} onChange={value => c.setTarget(index, value)} disabled={!vm.source || index > 0 && !vm.targets[index - 1]}/></div>)}<p className="hint">Em cada destino: trocar ramo → cherry-pick → push. Uma falha interrompe os destinos seguintes.</p><button className="primary wide" disabled={!vm.source || !vm.selectedCommits.length || !vm.targets[0] || !!execution && !execution.finished} onClick={c.review}>Revisar sequência →</button></section></div>
    {vm.review && <section ref={reviewRef} className="card review"><h2>Pronto para aplicar e enviar</h2><p><strong>{vm.selectedCommits.length} commits</strong> de <code>{vm.source}</code> serão enviados para:</p><div className="route">{vm.targets.filter(Boolean).map((t, i) => <span key={i}>{i > 0 && '→ '}<code>{t}</code></span>)}</div><div className="review-commits">{vm.sourceCommits.filter(c => vm.selectedCommits.includes(c.hash)).map(c => <p key={c.hash}><code>{c.hash.slice(0, 8)}</code> {c.subject}</p>)}</div><p className="hint">A atualização remota ocorre antes de começar. Destinos com commits locais pendentes precisam ser revisados e enviados primeiro.</p><div className="card-actions"><button onClick={() => c.set({ review: false })}>Voltar</button><button className="primary" onClick={c.execute}>Aplicar commits e fazer push</button></div></section>}
    {execution && <section ref={executionRef} className="card"><div className="card-heading"><h2>{outcome.title}</h2><div className="execution-heading-meta"><span className={`pill outcome-${outcome.tone}`}>{outcome.label}</span><small>{new Date(execution.startedAt).toLocaleString('pt-BR')}</small></div></div><p className="hint padded">Origem: {execution.source} · {execution.commits.map(h => h.slice(0, 8)).join(', ')}</p>{execution.targets.map((t, i) => <div className="execution-target" key={i}><div><span className={`phase-dot ${t.phase}`}/><strong>{t.branch}</strong><span className={`pill phase-${t.phase}`}>{({ pending: 'Não iniciado', switching: 'Trocando ramo', pman: 'Executando pman', applying: 'Aplicando commits', pushing: 'Enviando', done: 'Push concluído', failed: 'Falhou', interrupted: 'Interrompido' })[t.phase]}</span></div>{t.error && <pre className="execution-error">{t.error}</pre>}</div>)}{!execution.finished && <div className="recovery"><button onClick={c.cancelCherryPick}>Cancelar sequência</button><p className="hint">Encerra esta sequência e libera uma nova tentativa. Commits e arquivos são preservados. Conflitos ou operações ainda abertas no Git precisam ser resolvidos separadamente.</p><button onClick={() => c.resume('retry')}>{execution.targets.find(t => t.phase !== 'done')?.failedAt === 'pushing' ? 'Tentar somente o push e continuar' : 'Tentar destino novamente'}</button><label className="manual-check"><input type="checkbox" checked={vm.manualConfirmed} onChange={e => c.set({ manualConfirmed: e.target.checked })}/>Concluí o cherry-pick manualmente no destino pendente e revisei todos os commits locais que serão enviados.</label><button disabled={!vm.manualConfirmed} onClick={() => c.resume('manual')}>Enviar resultado manual e continuar</button><p className="hint">Para a conclusão manual, deixe o destino pendente selecionado no Git e sem conflitos ou arquivos alterados. Destinos já enviados serão preservados.</p></div>}</section>}
  </>;
}

// Token pessoal do Jira (opcional): com ele preenchido o app consulta o Jira pelo token e não exige mais o login da aba Jira.
function JiraTokenSetting() {
  const [status, setStatus] = useState<'none' | 'ok' | 'refused'>('none');
  const configured = status !== 'none';
  const [token, setToken] = useState('');
  const [state, setState] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => { void window.gitManager.jiraTokenStatus().then(setStatus).catch(() => setStatus('none')); }, []);
  const save = async () => {
    setWorking(true); setState(null);
    try { const name = await window.gitManager.setJiraToken(token.trim()); setStatus('ok'); setToken(''); setState({ kind: 'ok', text: `Token aceito${name ? ` (${name})` : ''}. O app agora consulta o Jira pelo token.` }); }
    catch (error) { setState({ kind: 'error', text: (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); }
    finally { setWorking(false); }
  };
  const remove = async () => {
    setWorking(true); setState(null);
    try { await window.gitManager.clearJiraToken(); setStatus('none'); setState({ kind: 'ok', text: 'Token removido. O app volta a usar o login da aba Jira.' }); }
    catch (error) { setState({ kind: 'error', text: (error as Error).message }); }
    finally { setWorking(false); }
  };
  return <div className="setting-row jira-token"><div>
    <strong>Token do Jira <small>(opcional)</small></strong>
    {status === 'refused' && <p className="inline-warning" role="alert">O Jira recusou o token (ele pode ter vencido ou sido revogado). Enquanto isso, o app usa o login da aba Jira. Gere um novo token e cole abaixo.</p>}
    {status === 'ok' && <p className="jira-token-ok" role="status">✓ Token configurado nas Configurações: o app usa o token e não exige login no Jira.</p>}
    {status === 'none' && <p>Cole um token de acesso pessoal do Jira para não depender do login. Sem token, vale o login da aba Jira.</p>}
    <div className="jira-token-form">
      <input id="jira-token-input" type="password" autoComplete="off" spellCheck={false} aria-label="Token de acesso pessoal do Jira" placeholder={configured ? 'Novo token (substitui o atual)' : 'Cole o token aqui'} value={token} onChange={e => setToken(e.target.value)}/>
      <button className="primary" disabled={working || token.trim().length < 8} onClick={() => void save()}>{working ? 'Verificando…' : 'Salvar token'}</button>
      {configured && <button disabled={working} onClick={() => void remove()}>Remover</button>}
    </div>
    {state && <p className={state.kind === 'error' ? 'inline-warning' : 'hint'} role={state.kind === 'error' ? 'alert' : 'status'}>{state.text}</p>}
    <p className="hint">Guardado criptografado pelo Windows, só neste computador. Para gerar: Jira → seu perfil → Tokens de acesso pessoal.</p>
  </div></div>;
}

// Pop-up de push pendente: aparece quando o usuário sai de "Alterações e commit" com commits ainda sem push.
function PushWarningDialog({ c, message }: { c: AppController; message: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current; if (!element) return;
    if (message && !element.open) element.showModal();
    else if (!message && element.open) element.close();
  }, [message]);
  return <dialog ref={dialog} className="issue-dialog push-dialog" aria-labelledby="push-title" onCancel={event => { event.preventDefault(); c.set({ pushWarning: '' }); }}>
    <h2 id="push-title"><span aria-hidden="true">⚠</span> Push pendente</h2>
    <p>{message}</p>
    <div className="card-actions"><button onClick={() => c.set({ pushWarning: '' })}>Entendi</button><button className="primary" autoFocus onClick={() => c.selectTab('commit')}>Voltar para Alterações e commit</button></div>
  </dialog>;
}
