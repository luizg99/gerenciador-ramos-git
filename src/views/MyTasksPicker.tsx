import { useState } from 'react';
import type { HomeCard } from '../models/jiraHome';
import { normalizeText } from '../models/jiraReport';
import { cachedBoard, fetchMyBoard, type MyBoard } from './jiraMine';

// Lista "Minhas tarefas" (tarefas principais atribuídas ao usuário, ou principais das sub-tarefas dele) para escolher uma e preencher um campo.
// Usa os mesmos dados do Início e da aba Jira; o resultado fica em cache por 1 minuto.
export function MyTasksPicker({ onPick, disabled = false }: { onPick: (key: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<MyBoard | null>(cachedBoard());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const refresh = async (force: boolean) => {
    const cached = cachedBoard();
    if (!force && cached && Date.now() - cached.at < 60_000) { setMine(cached); return; }
    setLoading(true); setError('');
    try { setMine(await fetchMyBoard()); } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  const toggle = () => { const next = !open; setOpen(next); if (next) void refresh(false); };
  const cards = (mine?.columns ?? []).flatMap(column => column.cards);
  const text = (card: HomeCard): string => [card.key, card.summary, card.status, card.sprint, ...card.children.map(text)].join(' ');
  const query = normalizeText(filter.trim());
  const shown = query ? cards.filter(card => normalizeText(text(card)).includes(query)) : cards;
  return <div className="my-tasks-picker">
    <button type="button" className="quiet" aria-expanded={open} onClick={toggle}>{open ? '▾' : '▸'} Escolher entre minhas tarefas{mine ? ` (${cards.length})` : ''}</button>
    {open && <div className="jira-mine-panel">
      <div className="jira-toolbar"><input aria-label="Filtrar minhas tarefas" placeholder="Filtrar por código, resumo, status ou sprint…" value={filter} onChange={event => setFilter(event.target.value)} autoFocus/><button type="button" className="quiet" disabled={loading} onClick={() => void refresh(true)} title="Buscar de novo no Jira">{loading ? 'Buscando…' : '↻'}</button></div>
      {error && <p className="inline-warning" role="alert">{error}</p>}
      {!mine ? (loading ? <p className="hint">Buscando suas tarefas…</p> : null)
        : !shown.length ? <p className="hint">{cards.length ? 'Nenhuma tarefa com esse filtro.' : 'Nenhuma tarefa em aberto atribuída a você.'}</p>
        : <div className="jira-mine-list" role="list">{shown.map(card => <button key={card.key} type="button" role="listitem" className="jira-mine-row" disabled={disabled} onClick={() => { setOpen(false); onPick(card.key); }}>
          <span><strong>{card.key}</strong>{card.type && <small> · {card.type}</small>}</span>
          <span className="jira-mine-summary">{card.summary || 'Sem resumo'}</span>
          <span className="jira-mine-meta"><em>{card.status}</em>{card.sprint && <em>{card.sprint}</em>}{!card.mine && <em>sua sub-tarefa: {card.children.map(child => child.key).join(', ')}</em>}</span>
        </button>)}</div>}
    </div>}
  </div>;
}
