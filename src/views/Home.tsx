import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../controllers/appController';
import { JIRA_BASE } from '../models/jira';
import { NO_SPRINT, countMine, filterBySprint, findCard, findMove, hasWithoutSprint, moveTarget, sameStatus, sprintOptions, type HomeCard, type HomeColumn, type JiraMove } from '../models/jiraHome';
import { cachedBoard, fetchMoves, fetchMyBoard, moveIssue } from './jiraMine';

// A sprint escolhida no filtro fica guardada; a última lista (cache) aparece na hora ao voltar para o Início e é atualizada por trás.
// null = ainda não escolheu: abre filtrado pela sprint mais recente; "Todas as sprints" é uma escolha ('') e fica lembrada.
let chosenSprint: string | null = null;
const openIssue = (key: string) => { void window.gitManager.openReviewLink(`${JIRA_BASE}/browse/${encodeURIComponent(key)}`).catch(() => {}); };

type OpenMenu = (event: React.MouseEvent, key: string) => void;
interface CardActions { onMenu: OpenMenu; onDrag: (key: string | null) => void; dragging: string | null }
function Card({ card, depth = 0, actions }: { card: HomeCard; depth?: number; actions: CardActions }) {
  // Botão direito no cartão (principal ou sub-tarefa) abre o menu daquela tarefa; o clique e o arrastar não sobem para a principal.
  return <article className={`kanban-card${card.mine ? '' : ' context'}${depth ? ' child' : ''}${actions.dragging === card.key ? ' dragging' : ''}`} draggable
    onContextMenu={event => { event.stopPropagation(); actions.onMenu(event, card.key); }}
    onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('text/plain', card.key); event.dataTransfer.effectAllowed = 'move'; actions.onDrag(card.key); }}
    onDragEnd={() => actions.onDrag(null)}>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sprint, setSprint] = useState<string | null>(chosenSprint);
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [copied, setCopied] = useState('');
  // Mudar o status no Jira: pelo menu do botão direito ("Mover para") ou arrastando o cartão para outra coluna (com confirmação).
  const [moves, setMoves] = useState<{ key: string; items?: JiraMove[]; error?: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState('');
  const [pending, setPending] = useState<{ key: string; from: string; to: string; move: JiraMove } | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  const run = useRef(0);
  const failed = useRef(false);
  const openMenu: OpenMenu = (event, key) => {
    event.preventDefault();
    setMenu({ x: Math.min(event.clientX, innerWidth - 260), y: Math.min(event.clientY, innerHeight - 330), key });
    setMoves({ key });
    fetchMoves(key).then(items => setMoves(current => current?.key === key ? { key, items } : current)).catch(cause => setMoves(current => current?.key === key ? { key, error: (cause as Error).message } : current));
  };
  const flash = (message: string) => { setCopied(message); setTimeout(() => setCopied(current => current === message ? '' : current), 3500); };
  const perform = async (key: string, move: JiraMove, to: string) => {
    setMoving(true); setMoveError('');
    try { await moveIssue(key, move.id); flash(`${key} movida para ${to}`); await load(); }
    catch (cause) { setMoveError(`Não foi possível mover ${key} para “${to}”: ${(cause as Error).message}`); }
    finally { setMoving(false); }
  };
  const dropOn = async (status: string) => {
    const key = dragging; setDragging(null); setOver('');
    const card = key && columns ? findCard(columns, key) : undefined;
    if (!key || !card || sameStatus(card.status, status)) return;
    setMoving(true); setMoveError('');
    try {
      const items = await fetchMoves(key);
      const move = findMove(items, status);
      if (!move) setMoveError(`Não há transição de “${card.status}” para “${status}” em ${key} no fluxo do Jira.${items.length ? ` Destinos possíveis: ${items.map(moveTarget).join(', ')}.` : ''}`);
      else setPending({ key, from: card.status, to: status, move });
    } catch (cause) { setMoveError(`Não foi possível consultar as transições de ${key}: ${(cause as Error).message}`); }
    finally { setMoving(false); }
  };
  useEffect(() => { if (pending) confirmation.current?.showModal(); else if (confirmation.current?.open) confirmation.current.close(); }, [pending]);
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
      setColumns(board.columns); setUser(board.user);
    } catch (cause) { if (token === run.current) { failed.current = true; setError((cause as Error).message); } }
    finally { if (token === run.current) setLoading(false); }
  };
  useEffect(() => { if (enabled) void load(); return () => { run.current++; }; }, [enabled]);
  // Se a sessão do Jira ainda estava abrindo (ou o login acabou de ser feito), tenta de novo quando ela ficar pronta.
  useEffect(() => window.gitManager.onJiraState(state => { if (state.phase === 'ready' && failed.current) void load(); }), []);

  if (!enabled) return <section className="card"><div className="empty"><span className="empty-symbol">▤</span><h3>Suas tarefas do Jira ficam aqui</h3><p>Ative “Usa Jira” nas configurações para ver as tarefas atribuídas a você em formato de quadro.</p><button className="primary" onClick={() => c.selectTab('settings')}>Abrir configurações</button></div></section>;
  const options = columns ? sprintOptions(columns) : [];
  const withoutSprint = columns ? hasWithoutSprint(columns) : false;
  // Sem escolha: a sprint mais recente. Se a sprint escolhida deixou de existir depois de atualizar, volta para "todas".
  const effective = sprint === null ? options[0]?.name ?? '' : sprint && sprint !== NO_SPRINT && !options.some(option => option.name === sprint) ? '' : sprint;
  const shown = columns ? filterBySprint(columns, effective) : null;
  const total = shown ? countMine(shown) : 0;
  const choose = (value: string) => { chosenSprint = value; setSprint(value); };
  return <div className="kanban-board">
    <div className="kanban-bar">
      <p>{shown ? <><strong>{total}</strong> {total === 1 ? 'tarefa atribuída' : 'tarefas atribuídas'}{user ? <> a <strong>{user}</strong></> : ' a você'}</> : loading ? 'Carregando suas tarefas…' : ''}</p>
      <div className="kanban-tools">
        {copied && <span className="kanban-copied" role="status">✓ {copied}</span>}
        {columns && (options.length > 0 || withoutSprint) && <label className="kanban-filter"><span>Sprint</span><select aria-label="Filtrar por sprint" value={effective} onChange={e => choose(e.target.value)}><option value="">Todas as sprints</option>{options.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}{withoutSprint && <option value={NO_SPRINT}>Sem sprint</option>}</select></label>}
        <button className="quiet" disabled={loading} onClick={() => void load()}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>
    </div>
    {moveError && <div className="alert error" role="alert"><strong>Status não alterado</strong><p>{moveError}</p><button onClick={() => setMoveError('')}>Fechar</button></div>}
    {error && <div className="alert error" role="alert"><strong>Não foi possível carregar suas tarefas</strong><p>{error}</p><div className="kanban-error-actions"><button onClick={() => void load()}>Tentar de novo</button><button onClick={() => c.selectTab('jira')}>Abrir o Jira para fazer login</button></div></div>}
    {shown && !shown.length && !error && <section className="card"><div className="empty small">{effective ? 'Nenhuma tarefa sua nessa sprint.' : 'Nenhuma tarefa em aberto atribuída a você.'}</div></section>}
    {!!shown?.length && <div className="kanban-columns">{shown.map(column => <section className={`kanban-column${over === column.status ? ' drop' : ''}`} key={column.status} aria-label={`Coluna ${column.status}`}
      onDragOver={event => { if (dragging && !moving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (over !== column.status) setOver(column.status); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(current => current === column.status ? '' : current); }}
      onDrop={event => { event.preventDefault(); void dropOn(column.status); }}>
      <header><span className={`kanban-dot cat-${column.category}`} aria-hidden="true"/><h2>{column.status}</h2><span className="count">{column.cards.length}</span></header>
      <div className="kanban-cards">{column.cards.map(card => <Card key={card.key} card={card} actions={{ onMenu: openMenu, onDrag: setDragging, dragging }}/>)}</div>
    </section>)}</div>}
    {menu && <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={event => event.stopPropagation()}>
      <button role="menuitem" onClick={() => copyKey(menu.key)}>Copiar número da issue ({menu.key})</button>
      <button role="menuitem" onClick={() => { setMenu(null); openIssue(menu.key); }}>Abrir no Jira</button>
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
