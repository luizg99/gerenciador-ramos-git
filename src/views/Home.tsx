import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../controllers/appController';
import { JIRA_BASE } from '../models/jira';
import { NO_SPRINT, countMine, filterBySprint, hasWithoutSprint, sprintOptions, type HomeCard, type HomeColumn } from '../models/jiraHome';
import { cachedBoard, fetchMyBoard } from './jiraMine';

// A sprint escolhida no filtro fica guardada; a última lista (cache) aparece na hora ao voltar para o Início e é atualizada por trás.
let chosenSprint = '';
const openIssue = (key: string) => { void window.gitManager.openReviewLink(`${JIRA_BASE}/browse/${encodeURIComponent(key)}`).catch(() => {}); };

function Card({ card, depth = 0 }: { card: HomeCard; depth?: number }) {
  return <article className={`kanban-card${card.mine ? '' : ' context'}${depth ? ' child' : ''}`}>
    <div className="kanban-card-top">
      <button type="button" className="kanban-key" title="Abrir no Jira" onClick={() => openIssue(card.key)}>{card.key}</button>
      {card.type && <span className="kanban-type">{card.type}</span>}
      {depth > 0 && <span className={`kanban-status cat-${card.category}`}>{card.status}</span>}
    </div>
    {card.mine && <span className={`kanban-sprint${card.sprint ? '' : ' none'}`} title="Sprint">◷ {card.sprint || 'Sem sprint'}</span>}
    <p className="kanban-summary">{card.summary || 'Sem resumo'}</p>
    {!card.mine && <small className="kanban-note">Tarefa principal · atribuída a outra pessoa</small>}
    {card.priority && depth === 0 && card.mine && <small className="kanban-note">Prioridade {card.priority}</small>}
    {card.children.length > 0 && <div className="kanban-children">{card.children.map(child => <Card key={child.key} card={child} depth={depth + 1}/>)}</div>}
  </article>;
}

export function Home({ c }: { c: AppController }) {
  const enabled = c.useJira;
  const [columns, setColumns] = useState<HomeColumn[] | null>(cachedBoard()?.columns ?? null);
  const [user, setUser] = useState(cachedBoard()?.user ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sprint, setSprint] = useState(chosenSprint);
  const run = useRef(0);
  const failed = useRef(false);
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
  // Se a sprint escolhida deixou de existir depois de atualizar, volta para "todas".
  const effective = sprint && sprint !== NO_SPRINT && !options.some(option => option.name === sprint) ? '' : sprint;
  const shown = columns ? filterBySprint(columns, effective) : null;
  const total = shown ? countMine(shown) : 0;
  const choose = (value: string) => { chosenSprint = value; setSprint(value); };
  return <div className="kanban-board">
    <div className="kanban-bar">
      <p>{shown ? <><strong>{total}</strong> {total === 1 ? 'tarefa atribuída' : 'tarefas atribuídas'}{user ? <> a <strong>{user}</strong></> : ' a você'}</> : loading ? 'Carregando suas tarefas…' : ''}</p>
      <div className="kanban-tools">
        {columns && (options.length > 0 || withoutSprint) && <label className="kanban-filter"><span>Sprint</span><select aria-label="Filtrar por sprint" value={effective} onChange={e => choose(e.target.value)}><option value="">Todas as sprints</option>{options.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}{withoutSprint && <option value={NO_SPRINT}>Sem sprint</option>}</select></label>}
        <button className="quiet" disabled={loading} onClick={() => void load()}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>
    </div>
    {error && <div className="alert error" role="alert"><strong>Não foi possível carregar suas tarefas</strong><p>{error}</p><div className="kanban-error-actions"><button onClick={() => void load()}>Tentar de novo</button><button onClick={() => c.selectTab('jira')}>Abrir o Jira para fazer login</button></div></div>}
    {shown && !shown.length && !error && <section className="card"><div className="empty small">{effective ? 'Nenhuma tarefa sua nessa sprint.' : 'Nenhuma tarefa em aberto atribuída a você.'}</div></section>}
    {!!shown?.length && <div className="kanban-columns">{shown.map(column => <section className="kanban-column" key={column.status} aria-label={`Coluna ${column.status}`}>
      <header><span className={`kanban-dot cat-${column.category}`} aria-hidden="true"/><h2>{column.status}</h2><span className="count">{column.cards.length}</span></header>
      <div className="kanban-cards">{column.cards.map(card => <Card key={card.key} card={card}/>)}</div>
    </section>)}</div>}
  </div>;
}
