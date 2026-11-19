import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppController } from '../controllers/appController';
import { JIRA_BASE } from '../models/jira';
import { NO_SPRINT, cardColumnId, countMine, filterBySprint, findCard, findMove, hasCards, hasWithoutSprint, moveTarget, sameStatus, sprintOptions, type HomeCard, type HomeColumn, type JiraMove, type SprintProgress } from '../models/jiraHome';
import { cachedBoard, cachedSprintProgress, fetchFlagged, fetchIssueXml, fetchMoves, fetchSprintProgress, fetchMyBoard, moveIssue, setFlagged } from './jiraMine';

// A sprint escolhida no filtro fica guardada; a última lista (cache) aparece na hora ao voltar para o Início e é atualizada por trás.
// null = ainda não escolheu: abre filtrado pela sprint mais recente; "Todas as sprints" é uma escolha ('') e fica lembrada.
let chosenSprint: string | null = null;
const openIssue = (key: string) => { void window.gitManager.openReviewLink(`${JIRA_BASE}/browse/${encodeURIComponent(key)}`).catch(() => {}); };

let lastDragEnd = 0;
type OpenMenu = (event: React.MouseEvent, key: string, depth: number) => void;
interface CardActions { onMenu: OpenMenu; onDrag: (key: string | null) => void; dragging: string | null }
function Card({ card, depth = 0, actions }: { card: HomeCard; depth?: number; actions: CardActions }) {
  // Botão direito no cartão (principal ou sub-tarefa) abre o menu daquela tarefa; o clique e o arrastar não sobem para a principal.
  return <article className={`kanban-card${card.mine ? '' : ' context'}${depth ? ' child' : ''}${actions.dragging === card.key ? ' dragging' : ''}`} draggable title="Clique com o botão esquerdo para mais opções"
    onClick={event => { event.stopPropagation(); if ((event.target as HTMLElement).closest('button, a') || window.getSelection()?.toString() || Date.now() - lastDragEnd < 400) return; actions.onMenu(event, card.key, depth); }}
    onContextMenu={event => { event.stopPropagation(); actions.onMenu(event, card.key, depth); }}
    onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('text/plain', card.key); event.dataTransfer.effectAllowed = 'move'; actions.onDrag(card.key); }}
    onDragEnd={() => { lastDragEnd = Date.now(); actions.onDrag(null); }}>
    <div className="kanban-card-top">
      <button type="button" className="kanban-key" title="Abrir no Jira" onClick={() => openIssue(card.key)}>{card.key}</button>
      {card.type && <span className="kanban-type">{card.type}</span>}
      {depth > 0 && <span className={`kanban-status cat-${card.category}`}>{card.status}</span>}
    </div>
    {card.mine && <span className={`kanban-sprint${card.sprint ? '' : ' none'}`} title="Sprint">◷ {card.sprint || 'Sem sprint'}</span>}
    <p className="kanban-summary">{card.summary || 'Sem resumo'}</p>
    {!card.mine && <small className="kanban-note">Tarefa principal · atribuída a outra pessoa</small>}
    {card.priority && depth === 0 && card.mine && <small className="kanban-note">Prioridade {card.priority}</small>}
    {card.children.length > 0 && <div className="kanban-children">{card.children.map(child => <Card key={child.key} card={child} depth={depth + 1} actions={actions}/>)}</div>}
  </article>;
}

export function Home({ c }: { c: AppController }) {
  const enabled = c.useJira;
  const [columns, setColumns] = useState<HomeColumn[] | null>(cachedBoard()?.columns ?? null);
  const [user, setUser] = useState(cachedBoard()?.user ?? '');
  const [teamSprints, setTeamSprints] = useState(cachedBoard()?.teamSprints ?? []);
  const [noSprintField, setNoSprintField] = useState(cachedBoard() ? cachedBoard()!.sprintFields.length === 0 : false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sprint, setSprint] = useState<string | null>(chosenSprint);
  const [menu, setMenu] = useState<{ x: number; y: number; key: string; depth: number } | null>(null);
  const [progressTick, setProgressTick] = useState(0);
  const [flag, setFlag] = useState<{ key: string; flagged?: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState('');
  // Mudar o status no Jira: pelo menu do botão direito ("Mover para") ou arrastando o cartão para outra coluna (com confirmação).
  const [moves, setMoves] = useState<{ key: string; items?: JiraMove[]; error?: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState('');
  const [pending, setPending] = useState<{ key: string; from: string; to: string; move: JiraMove } | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  // O quadro ocupa só o que sobra da tela: a barra de rolagem horizontal fica sempre visível embaixo e cada coluna rola sozinha na vertical.
  const columnsRef = useRef<HTMLDivElement>(null);
  const fit = () => {
    const element = columnsRef.current; if (!element) return;
    const scroller = element.closest('.page-scroll') as HTMLElement | null;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : innerHeight;
    element.style.setProperty('--kanban-height', `${Math.max(260, Math.floor(bottom - element.getBoundingClientRect().top - 34))}px`);
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const scroller = columnsRef.current?.closest('.page-scroll');
    const observer = new ResizeObserver(fit);
    if (scroller) observer.observe(scroller);
    addEventListener('resize', fit);
    return () => { observer.disconnect(); removeEventListener('resize', fit); };
  }, [enabled]);
  const run = useRef(0);
  const [progress, setProgress] = useState<{ sprint: string; data?: SprintProgress; error?: string } | null>(null);
  const failed = useRef(false);
  const openMenu: OpenMenu = (event, key, depth) => {
    event.preventDefault();
    setMenu({ x: Math.min(event.clientX, innerWidth - 260), y: Math.min(event.clientY, innerHeight - 400), key, depth });
    setMoves({ key }); setFlag({ key });
    fetchFlagged(key).then(flagged => setFlag(current => current?.key === key ? { key, flagged } : current)).catch(cause => setFlag(current => current?.key === key ? { key, error: (cause as Error).message } : current));
    fetchMoves(key).then(items => setMoves(current => current?.key === key ? { key, items } : current)).catch(cause => setMoves(current => current?.key === key ? { key, error: (cause as Error).message } : current));
  };
  const flash = (message: string) => { setCopied(message); setTimeout(() => setCopied(current => current === message ? '' : current), 3500); };
  const perform = async (key: string, move: JiraMove, to: string) => {
    setMoving(true); setMoveError('');
    try { await moveIssue(key, move.id); flash(`${key} movida para ${to}`); await load(); }
    catch (cause) { setMoveError(`Não foi possível mover ${key} para “${to}”: ${(cause as Error).message}`); }
    finally { setMoving(false); }
  };
  const dropOn = async (column: HomeColumn) => {
    const key = dragging; setDragging(null); setOver('');
    const card = key && columns ? findCard(columns, key) : undefined;
    if (!key || !card || cardColumnId(card) === column.id) return;
    setMoving(true); setMoveError('');
    try {
      const items = await fetchMoves(key);
      const move = findMove(items, column);
      if (!move) setMoveError(`Não há transição de “${card.status}” para “${column.status}” em ${key} no fluxo do Jira.${items.length ? ` Destinos possíveis: ${items.map(moveTarget).join(', ')}.` : ''}`);
      else setPending({ key, from: card.status, to: moveTarget(move), move });
    } catch (cause) { setMoveError(`Não foi possível consultar as transições de ${key}: ${(cause as Error).message}`); }
    finally { setMoving(false); }
  };
  useEffect(() => { if (pending) confirmation.current?.showModal(); else if (confirmation.current?.open) confirmation.current.close(); }, [pending]);
  const copyText = (text: string, message: string) => {
    setMenu(null);
    void window.gitManager.copyText(text).then(() => flash(message)).catch(() => {});
  };
  const copyXml = async (key: string) => {
    setMenu(null);
    try { await window.gitManager.copyText(await fetchIssueXml(key)); flash(`XML de ${key} copiado`); }
    catch (cause) { setMoveError(`Não foi possível copiar o XML de ${key}: ${(cause as Error).message}`); }
  };
  const toggleFlag = async (key: string, flagged: boolean) => {
    setMenu(null); setMoving(true); setMoveError('');
    try { await setFlagged(key, flagged); flash(flagged ? `Red flag colocado em ${key}` : `Red flag removido de ${key}`); }
    catch (cause) { setMoveError(`Não foi possível ${flagged ? 'colocar' : 'remover'} o red flag de ${key}: ${(cause as Error).message}`); }
    finally { setMoving(false); }
  };
  const copyKey = (key: string) => {
    setMenu(null);
    void window.gitManager.copyText(key).then(() => flash(`${key} copiado`)).catch(() => {});
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    addEventListener('mousedown', close); addEventListener('blur', close); addEventListener('resize', close); addEventListener('scroll', close, true); addEventListener('keydown', escape);
    return () => { removeEventListener('mousedown', close); removeEventListener('blur', close); removeEventListener('resize', close); removeEventListener('scroll', close, true); removeEventListener('keydown', escape); };
  }, [menu]);
  const load = async () => {
    const token = ++run.current;
    setLoading(true); setError(''); failed.current = false;
    try {
      const board = await fetchMyBoard();
      if (token !== run.current) return;
      setColumns(board.columns); setUser(board.user); setTeamSprints(board.teamSprints); setNoSprintField(board.sprintFields.length === 0);
    } catch (cause) { if (token === run.current) { failed.current = true; setError((cause as Error).message); } }
    finally { if (token === run.current) setLoading(false); }
  };
  useEffect(() => { if (enabled) void load(); return () => { run.current++; }; }, [enabled]);
  // Se a sessão do Jira ainda estava abrindo (ou o login acabou de ser feito), tenta de novo quando ela ficar pronta.
  useEffect(() => window.gitManager.onJiraState(state => { if (state.phase === 'ready' && failed.current) void load(); }), []);

  if (!enabled) return <section className="card"><div className="empty"><span className="empty-symbol">▤</span><h3>Suas tarefas do Jira ficam aqui</h3><p>Ative “Usa Jira” nas configurações para ver as tarefas atribuídas a você em formato de quadro.</p><button className="primary" onClick={() => c.selectTab('settings')}>Abrir configurações</button></div></section>;
  // As sprints do time entram na lista mesmo sem tarefa sua: dá para ver o progresso da sprint atual com o quadro vazio.
  const options = columns ? [...new Map([...sprintOptions(columns), ...teamSprints].map(item => [item.name, item])).values()].sort((a, b) => b.start - a.start || a.name.localeCompare(b.name, 'pt-BR')) : [];
  const withoutSprint = columns ? hasWithoutSprint(columns) : false;
  // Sem escolha: a sprint mais recente. Se a sprint escolhida deixou de existir depois de atualizar, volta para "todas".
  const effective = sprint === null ? options[0]?.name ?? '' : sprint && sprint !== NO_SPRINT && !options.some(option => option.name === sprint) ? '' : sprint;
  const shown = columns ? filterBySprint(columns, effective) : null;
  const total = shown ? countMine(shown) : 0;
  const progressSprint = effective && effective !== NO_SPRINT ? effective : '';
  useEffect(() => {
    if (!progressSprint || !enabled) { setProgress(null); return; }
    const cached = cachedSprintProgress(progressSprint);
    setProgress({ sprint: progressSprint, data: cached });
    let alive = true;
    fetchSprintProgress(progressSprint).then(data => { if (alive) setProgress({ sprint: progressSprint, data }); })
      .catch(cause => { if (alive) setProgress(current => ({ sprint: progressSprint, data: current?.sprint === progressSprint ? current.data : undefined, error: (cause as Error).message })); });
    return () => { alive = false; };
  }, [progressSprint, enabled, progressTick]);
  const choose = (value: string) => { chosenSprint = value; setSprint(value); };
  return <div className="kanban-board">
    <div className="kanban-bar">
      <p>{shown ? <><strong>{total}</strong> {total === 1 ? 'tarefa atribuída' : 'tarefas atribuídas'}{user ? <> a <strong>{user}</strong></> : ' a você'}</> : loading ? 'Carregando suas tarefas…' : ''}</p>
      <div className="kanban-tools">
        {noSprintField && <span className="kanban-warning" title="O Jira desta conta não informou um campo Sprint (nem pelo nome, nem pelo formato dos valores). Se as tarefas têm sprint no Jira, use ↻ Atualizar ou avise quem mantém o app.">⚠ Campo Sprint não encontrado</span>}
        {copied && <span className="kanban-copied" role="status">✓ {copied}</span>}
        {columns && (options.length > 0 || withoutSprint) && <label className="kanban-filter"><span>Sprint</span><select aria-label="Filtrar por sprint" value={effective} onChange={e => choose(e.target.value)}><option value="">Todas as sprints</option>{options.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}{withoutSprint && <option value={NO_SPRINT}>Sem sprint</option>}</select></label>}
        <button className="quiet" disabled={loading} onClick={() => { setProgressTick(tick => tick + 1); void load(); }}>{loading ? 'Atualizando…' : '↻ Atualizar tarefas'}</button>
      </div>
    </div>
    {progressSprint && progress?.sprint === progressSprint && <section className="sprint-progress" aria-label="Progresso da sprint">
      {progress.data ? <>
        <h2>Essa sprint já está com <strong>{progress.data.percent}%</strong> concluída</h2>
        <div className="sprint-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.data.percent}><span style={{ width: `${progress.data.percent}%` }}/></div>
        <p className="sprint-note">{progress.data.counts.find(item => item.id === 'finalizado')?.count ?? 0} de {progress.data.total} tarefas principais finalizadas · sprint inteira, todas as pessoas</p>
        <ul className="sprint-counts">{progress.data.counts.map(item => <li key={item.id}><strong>{item.count}</strong><span>{item.label}</span></li>)}{progress.data.others.map(item => <li key={`outro:${item.status}`} title="Status que não é uma das colunas do quadro"><strong>{item.count}</strong><span>{item.status}</span></li>)}</ul>
      </> : progress.error ? <p className="sprint-note">Não foi possível calcular o progresso da sprint: {progress.error}</p> : <p className="sprint-note">Calculando o progresso da sprint…</p>}
    </section>}
    {moveError && <div className="alert error" role="alert"><strong>Status não alterado</strong><p>{moveError}</p><button onClick={() => setMoveError('')}>Fechar</button></div>}
    {error && <div className="alert error" role="alert"><strong>Não foi possível carregar suas tarefas</strong><p>{error}</p><div className="kanban-error-actions"><button onClick={() => void load()}>Tentar de novo</button><button onClick={() => c.selectTab('jira')}>Abrir o Jira para fazer login</button></div></div>}
    {shown && !hasCards(shown) && !error && <p className="kanban-empty-note">{effective ? 'Nenhuma tarefa sua nessa sprint.' : 'Nenhuma tarefa em aberto atribuída a você.'}</p>}
    {!!shown?.length && <div className="kanban-columns" ref={columnsRef} onDragOver={event => {
      // Arrastando um cartão perto da borda, a lista de colunas rola sozinha para dar para chegar às colunas fora da tela.
      if (!dragging) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left + 90) event.currentTarget.scrollLeft -= 28; else if (event.clientX > box.right - 90) event.currentTarget.scrollLeft += 28;
    }}>{shown.map(column => <section className={`kanban-column${over === column.id ? ' drop' : ''}`} key={column.id} aria-label={`Coluna ${column.status}`}
      onDragOver={event => { if (dragging && !moving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (over !== column.id) setOver(column.id); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(current => current === column.id ? '' : current); }}
      onDrop={event => { event.preventDefault(); void dropOn(column); }}>
      <header><span className={`kanban-dot cat-${column.category}`} aria-hidden="true"/><h2>{column.status}</h2><span className="count">{column.cards.length}</span></header>
      <div className="kanban-cards">{!column.cards.length && <p className="kanban-empty">{dragging ? 'Solte aqui' : 'Sem tarefas'}</p>}{column.cards.map(card => <Card key={card.key} card={card} actions={{ onMenu: openMenu, onDrag: setDragging, dragging }}/>)}</div>
    </section>)}</div>}
    {menu && <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={event => event.stopPropagation()}>
      <button role="menuitem" onClick={() => copyKey(menu.key)}>Copiar número da issue ({menu.key})</button>
      <button role="menuitem" onClick={() => copyText(`${JIRA_BASE}/browse/${encodeURIComponent(menu.key)}`, `Link de ${menu.key} copiado`)}>Copiar link da issue</button>
      {menu.depth === 0 && <button role="menuitem" onClick={() => void copyXml(menu.key)}>Copiar XML da issue</button>}
      <button role="menuitem" onClick={() => { setMenu(null); openIssue(menu.key); }}>Abrir no Jira</button>
      {flag?.key === menu.key && flag.flagged !== undefined ? <button role="menuitem" disabled={moving} onClick={() => void toggleFlag(menu.key, !flag.flagged)}>{flag.flagged ? '⚑ Retirar red flag' : '⚑ Colocar red flag'}</button> : <span className="menu-note">{flag?.key === menu.key && flag.error ? `Red flag indisponível: ${flag.error}` : 'Carregando red flag…'}</span>}
      <hr/>
      <span className="menu-label">Mover para</span>
      {(() => {
        const current = columns ? findCard(columns, menu.key)?.status ?? '' : '';
        const items = (moves?.key === menu.key ? moves.items : undefined)?.filter(move => !sameStatus(moveTarget(move), current));
        if (moves?.key === menu.key && moves.error) return <span className="menu-note">Não foi possível consultar: {moves.error}</span>;
        if (!items) return <span className="menu-note">Carregando transições…</span>;
        if (!items.length) return <span className="menu-note">Nenhuma transição disponível</span>;
        return items.map(move => <button key={move.id} role="menuitem" aria-label={`Mover para ${moveTarget(move)}`} disabled={moving} onClick={() => { setMenu(null); void perform(menu.key, move, moveTarget(move)); }}>{moveTarget(move)}{move.to && move.name !== move.to.name && <small> · {move.name}</small>}</button>);
      })()}
    </div>}
    <dialog ref={confirmation} className="issue-dialog" aria-labelledby="move-title" onCancel={event => { event.preventDefault(); setPending(null); }}>
      <h2 id="move-title">Mover {pending?.key}?</h2>
      <p>O status vai mudar de <strong>{pending?.from}</strong> para <strong>{pending?.to}</strong> no Jira.</p>
      <div className="card-actions"><button autoFocus onClick={() => setPending(null)}>Cancelar</button><button className="primary" disabled={moving} onClick={() => { const current = pending; setPending(null); if (current) void perform(current.key, current.move, current.to); }}>Mover</button></div>
    </dialog>
  </div>;
}
