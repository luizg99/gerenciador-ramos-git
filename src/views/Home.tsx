import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../controllers/appController';
import { JIRA_BASE } from '../models/jira';
import { HOME_FIELDS, HOME_JQL, HOME_MAX_ISSUES, HOME_PAGE_SIZE, buildHomeBoard, countMine, type HomeCard, type HomeColumn, type HomeIssue } from '../models/jiraHome';

// A última lista fica guardada: ao voltar para o Início ela aparece na hora e é atualizada por trás.
let cache: { columns: HomeColumn[]; user: string; at: number } | null = null;
const openIssue = (key: string) => { void window.gitManager.openReviewLink(`${JIRA_BASE}/browse/${encodeURIComponent(key)}`).catch(() => {}); };

function Card({ card, depth = 0 }: { card: HomeCard; depth?: number }) {
  return <article className={`kanban-card${card.mine ? '' : ' context'}${depth ? ' child' : ''}`}>
    <div className="kanban-card-top">
      <button type="button" className="kanban-key" title="Abrir no Jira" onClick={() => openIssue(card.key)}>{card.key}</button>
      {card.type && <span className="kanban-type">{card.type}</span>}
      {depth > 0 && <span className={`kanban-status cat-${card.category}`}>{card.status}</span>}
    </div>
    <p className="kanban-summary">{card.summary || 'Sem resumo'}</p>
    {!card.mine && <small className="kanban-note">Tarefa principal · atribuída a outra pessoa</small>}
    {card.priority && depth === 0 && card.mine && <small className="kanban-note">Prioridade {card.priority}</small>}
    {card.children.length > 0 && <div className="kanban-children">{card.children.map(child => <Card key={child.key} card={child} depth={depth + 1}/>)}</div>}
  </article>;
}

export function Home({ c }: { c: AppController }) {
  const enabled = c.useJira;
  const [columns, setColumns] = useState<HomeColumn[] | null>(cache?.columns ?? null);
  const [user, setUser] = useState(cache?.user ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(0);
  const failed = useRef(false);
  const load = async () => {
    const token = ++run.current;
    setLoading(true); setError(''); failed.current = false;
    try {
      const me = window.gitManager.jiraRequest('/rest/api/2/myself').then(value => (value as { displayName?: string }).displayName ?? '').catch(() => '');
      const issues: HomeIssue[] = [];
      for (let startAt = 0; startAt < HOME_MAX_ISSUES; startAt += HOME_PAGE_SIZE) {
        const page = await window.gitManager.jiraRequest('/rest/api/2/search', 'POST', { jql: HOME_JQL, startAt, maxResults: HOME_PAGE_SIZE, fields: HOME_FIELDS }) as { issues?: HomeIssue[]; total?: number };
        issues.push(...(page.issues ?? []));
        if (!page.issues?.length || issues.length >= (page.total ?? 0)) break;
      }
      const board = buildHomeBoard(issues); const name = await me;
      if (token !== run.current) return;
      cache = { columns: board, user: name, at: Date.now() };
      setColumns(board); setUser(name);
    } catch (cause) { if (token === run.current) { failed.current = true; setError((cause as Error).message); } }
    finally { if (token === run.current) setLoading(false); }
  };
  useEffect(() => { if (enabled) void load(); return () => { run.current++; }; }, [enabled]);
  // Se a sessão do Jira ainda estava abrindo (ou o login acabou de ser feito), tenta de novo quando ela ficar pronta.
  useEffect(() => window.gitManager.onJiraState(state => { if (state.phase === 'ready' && failed.current) void load(); }), []);

  if (!enabled) return <section className="card"><div className="empty"><span className="empty-symbol">▤</span><h3>Suas tarefas do Jira ficam aqui</h3><p>Ative “Usa Jira” nas configurações para ver as tarefas atribuídas a você em formato de quadro.</p><button className="primary" onClick={() => c.selectTab('settings')}>Abrir configurações</button></div></section>;
  const total = columns ? countMine(columns) : 0;
  return <div className="kanban-board">
    <div className="kanban-bar">
      <p>{columns ? <><strong>{total}</strong> {total === 1 ? 'tarefa atribuída' : 'tarefas atribuídas'}{user ? <> a <strong>{user}</strong></> : ' a você'}</> : loading ? 'Carregando suas tarefas…' : ''}</p>
      <button className="quiet" disabled={loading} onClick={() => void load()}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
    </div>
    {error && <div className="alert error" role="alert"><strong>Não foi possível carregar suas tarefas</strong><p>{error}</p><div className="kanban-error-actions"><button onClick={() => void load()}>Tentar de novo</button><button onClick={() => c.selectTab('jira')}>Abrir o Jira para fazer login</button></div></div>}
    {columns && !columns.length && !error && <section className="card"><div className="empty small">Nenhuma tarefa em aberto atribuída a você.</div></section>}
    {!!columns?.length && <div className="kanban-columns">{columns.map(column => <section className="kanban-column" key={column.status} aria-label={`Coluna ${column.status}`}>
      <header><span className={`kanban-dot cat-${column.category}`} aria-hidden="true"/><h2>{column.status}</h2><span className="count">{column.cards.length}</span></header>
      <div className="kanban-cards">{column.cards.map(card => <Card key={card.key} card={card}/>)}</div>
    </section>)}</div>}
  </div>;
}
