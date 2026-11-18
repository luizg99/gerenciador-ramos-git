// Quadro da tela inicial: as tarefas atribuídas ao usuário logado, em colunas por status, com a tarefa principal e,
// em cascata, as sub-tarefas que também são dele. Se só a sub-tarefa for dele, a principal aparece como contexto.
import type { SprintRef } from './jiraReport';

export const HOME_JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
export const HOME_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'parent'];
export const HOME_PAGE_SIZE = 100;
export const HOME_MAX_ISSUES = 500;

interface HomeStatus { name?: string; statusCategory?: { key?: string } }
interface HomeType { name?: string }
export interface HomeIssue {
  key: string;
  fields: {
    summary?: string; status?: HomeStatus; issuetype?: HomeType; priority?: { name?: string } | null;
    parent?: { key: string; fields?: { summary?: string; status?: HomeStatus; issuetype?: HomeType } };
    [field: string]: unknown;
  };
}
export interface HomeCard { key: string; summary: string; type: string; status: string; category: string; priority: string; sprint: string; sprintStart: number; mine: boolean; children: HomeCard[] }
export interface HomeColumn { status: string; category: string; cards: HomeCard[] }

// O Jira não informa a ordem do fluxo; ela é deduzida pelo nome do status (aberto → desenvolvimento → revisão → teste → aguardando → concluído).
// Status que não casam com nenhum nome caem pela categoria do Jira (a fazer / em andamento / concluído) e, por fim, por ordem alfabética.
const flowOrder: RegExp[] = [
  /^(open|opened|aberto|aberta|backlog|to ?do|a fazer|novo|nova|new|pendente|selected for development)(\s|$)/i,
  /desenvolv|in progress|progress|andamento|doing|codifica|implement/i,
  /revis|review|aprova/i,
  /test|(^|\s)qa(\s|$)|valida|homolog|verifica/i,
  /imped|bloquead|blocked|pausad|on hold|hold|aguard|waiting|wait/i,
  /conclu|done|pronto|resolvid|resolved|closed|fechad|finaliz/i
];
export function statusRank(name: string, category: string): number {
  const index = flowOrder.findIndex(pattern => pattern.test(name.trim()));
  if (index >= 0) return index;
  return category === 'new' ? 0.5 : category === 'indeterminate' ? 1.5 : category === 'done' ? 5.5 : 3.5;
}
// Uma tarefa que passou por várias sprints (carregada de uma para outra) mostra a mais recente.
export function latestSprint(sprints: SprintRef[]): SprintRef | undefined {
  if (!sprints.some(item => item.start > 0)) return sprints[sprints.length - 1];
  return [...sprints].sort((a, b) => b.start - a.start)[0];
}
const toCard = (key: string, fields: HomeIssue['fields'] | NonNullable<HomeIssue['fields']['parent']>['fields'], mine: boolean, sprint?: SprintRef): HomeCard => ({
  key, summary: fields?.summary ?? '', type: fields?.issuetype?.name ?? '', status: fields?.status?.name ?? 'Sem status',
  category: fields?.status?.statusCategory?.key ?? '', priority: (fields as HomeIssue['fields'] | undefined)?.priority?.name ?? '',
  sprint: sprint?.name ?? '', sprintStart: sprint?.start ?? 0, mine, children: []
});

export function buildHomeBoard(issues: HomeIssue[], sprintsOf: (issue: HomeIssue) => SprintRef[] = () => []): HomeColumn[] {
  const cards = new Map<string, HomeCard>();
  for (const issue of issues) if (!cards.has(issue.key)) cards.set(issue.key, toCard(issue.key, issue.fields, true, latestSprint(sprintsOf(issue))));
  const roots: HomeCard[] = [];
  const seen = new Set<string>();
  const place = (key: string, card: HomeCard) => { if (!seen.has(key)) { seen.add(key); roots.push(card); } };
  for (const issue of issues) {
    const card = cards.get(issue.key)!;
    const parent = issue.fields.parent;
    if (!parent || parent.key === issue.key) { place(issue.key, card); continue; }
    let parentCard = cards.get(parent.key);
    if (!parentCard) { parentCard = toCard(parent.key, parent.fields, false); cards.set(parent.key, parentCard); }
    if (!parentCard.children.includes(card)) parentCard.children.push(card);
    // A principal entra na ordem do primeiro filho encontrado; só vira raiz se ela mesma não for filha de outra.
    if (!issues.some(other => other.key === parent.key && other.fields.parent)) place(parent.key, parentCard);
  }
  const columns = new Map<string, HomeColumn>();
  for (const root of roots) {
    const column = columns.get(root.status) ?? { status: root.status, category: root.category, cards: [] };
    column.cards.push(root); columns.set(root.status, column);
  }
  return [...columns.values()].sort((a, b) => statusRank(a.status, a.category) - statusRank(b.status, b.category) || a.status.localeCompare(b.status, 'pt-BR'));
}
export const countMine = (columns: HomeColumn[]): number => {
  const count = (card: HomeCard): number => (card.mine ? 1 : 0) + card.children.reduce((sum, child) => sum + count(child), 0);
  return columns.reduce((sum, column) => sum + column.cards.reduce((inner, card) => inner + count(card), 0), 0);
};

// Filtro por sprint: '' = todas; NO_SPRINT = sem sprint; senão o nome. Só ficam as tarefas do usuário que combinam;
// a principal que não combina (ou é de outra pessoa) permanece apenas como contexto das sub-tarefas que combinam.
export const NO_SPRINT = '__sem_sprint__';
export function filterBySprint(columns: HomeColumn[], sprint: string): HomeColumn[] {
  if (!sprint) return columns;
  const matches = (card: HomeCard) => card.mine && (sprint === NO_SPRINT ? !card.sprint : card.sprint === sprint);
  const prune = (card: HomeCard): HomeCard | null => {
    const children = card.children.map(prune).filter((child): child is HomeCard => !!child);
    return matches(card) || children.length ? { ...card, children } : null;
  };
  return columns.map(column => ({ ...column, cards: column.cards.map(prune).filter((card): card is HomeCard => !!card) })).filter(column => column.cards.length);
}
export function sprintOptions(columns: HomeColumn[]): { name: string; start: number }[] {
  const found = new Map<string, number>();
  const visit = (card: HomeCard) => { if (card.mine && card.sprint) found.set(card.sprint, Math.max(found.get(card.sprint) ?? 0, card.sprintStart)); card.children.forEach(visit); };
  columns.forEach(column => column.cards.forEach(visit));
  return [...found].map(([name, start]) => ({ name, start })).sort((a, b) => b.start - a.start || a.name.localeCompare(b.name, 'pt-BR'));
}
export const hasWithoutSprint = (columns: HomeColumn[]): boolean => {
  const visit = (card: HomeCard): boolean => (card.mine && !card.sprint) || card.children.some(visit);
  return columns.some(column => column.cards.some(visit));
};

// Mover status: a transição é escolhida pelo nome do status de destino (ou, sem destino informado, pelo nome da própria transição).
export interface JiraMove { id: string; name: string; to?: { name: string } }
export const moveTarget = (move: JiraMove) => move.to?.name ?? move.name;
export const sameStatus = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');
export const findMove = (moves: JiraMove[], status: string): JiraMove | undefined => moves.find(move => sameStatus(moveTarget(move), status));
export function findCard(columns: HomeColumn[], key: string): HomeCard | undefined {
  const search = (card: HomeCard): HomeCard | undefined => card.key === key ? card : card.children.map(search).find(Boolean);
  for (const column of columns) for (const card of column.cards) { const found = search(card); if (found) return found; }
  return undefined;
}
