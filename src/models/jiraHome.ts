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
export interface HomeCard { key: string; summary: string; type: string; status: string; category: string; priority: string; sprint: string; sprintStart: number; mine: boolean; flagged: boolean; flagNote: string; delivery: string; children: HomeCard[] }
// id identifica a coluna (a do quadro do Jira ou, para status fora dela, "extra:<status>"); status é o nome mostrado.
export interface HomeColumn { id: string; status: string; category: string; cards: HomeCard[]; fixed?: boolean }

// Colunas do quadro do Jira da equipe, nesta ordem. Ficam sempre visíveis (mesmo vazias), para dar para arrastar um cartão até elas.
export const BOARD_COLUMNS = [
  { id: 'a-fazer', label: 'A fazer', category: 'new' },
  { id: 'em-desenvolvimento', label: 'Em desenvolvimento', category: 'indeterminate' },
  { id: 'pronto-revisao', label: 'Pronto pra revisão', category: 'indeterminate' },
  { id: 'em-revisao', label: 'Em revisão', category: 'indeterminate' },
  { id: 'pronto-testar', label: 'Pronto pra testar', category: 'indeterminate' },
  { id: 'em-teste', label: 'Em teste de aceitação', category: 'indeterminate' },
  { id: 'teste-concluido', label: 'Teste concluído', category: 'indeterminate' },
  { id: 'finalizado', label: 'Finalizado', category: 'done' }
] as const;
// O nome do status decide a coluna (vários status podem cair na mesma, como "Open" e "A fazer"). Do mais específico para o mais genérico.
const boardMatchers: [string, RegExp][] = [
  ['pronto-revisao', /(pronto|pronta|ready|aguard\w*).*(revis|review)/i],
  ['pronto-testar', /(pronto|pronta|ready|aguard\w*).*(test|qa)/i],
  ['teste-concluido', /(test|qa|aceita).*(conclu|aprovad|passed|done)/i],
  ['em-revisao', /revis|review|aprova/i],
  ['em-teste', /test|aceita|(^|\s)qa(\s|$)|valida|homolog|verifica/i],
  ['em-desenvolvimento', /desenvolv|in progress|progress|andamento|doing|codifica|implement/i],
  ['a-fazer', /^(open|opened|aberto|aberta|backlog|to ?do|a fazer|comprometid[oa]|novo|nova|new|pendente|selected for development)(\s|$)/i],
  ['finalizado', /finaliz|conclu|done|pronto|resolvid|resolved|closed|fechad/i]
];
export const columnIdFor = (status: string): string | null => boardMatchers.find(([, pattern]) => pattern.test(status.trim()))?.[0] ?? null;
export const cardColumnId = (card: { status: string }): string => columnIdFor(card.status) ?? `extra:${card.status}`;
// Status que não casam com nenhuma coluna do quadro ganham uma coluna extra, posicionada pela categoria do Jira.
const columnRank = (column: HomeColumn): number => {
  const index = BOARD_COLUMNS.findIndex(item => item.id === column.id);
  return index >= 0 ? index : column.category === 'new' ? 0.5 : column.category === 'done' ? 7.5 : 4.5;
};
// Uma tarefa que passou por várias sprints (carregada de uma para outra) mostra a mais recente.
export function latestSprint(sprints: SprintRef[]): SprintRef | undefined {
  if (!sprints.some(item => item.start > 0)) return sprints[sprints.length - 1];
  return [...sprints].sort((a, b) => b.start - a.start)[0];
}
const toCard = (key: string, fields: HomeIssue['fields'] | NonNullable<HomeIssue['fields']['parent']>['fields'], mine: boolean, sprint?: SprintRef): HomeCard => ({
  key, summary: fields?.summary ?? '', type: fields?.issuetype?.name ?? '', status: fields?.status?.name ?? 'Sem status',
  category: fields?.status?.statusCategory?.key ?? '', priority: (fields as HomeIssue['fields'] | undefined)?.priority?.name ?? '',
  sprint: sprint?.name ?? '', sprintStart: sprint?.start ?? 0, mine, flagged: false, flagNote: '', delivery: '', children: []
});

// Impedimento (red flag): classificações do campo "Classificação do Impedimento" do Jira da equipe.
export const IMPEDIMENT_CLASSES = [
  { id: '303245', value: 'Nenhuma das Opções' }, { id: '303239', value: 'Retorno Cliente' }, { id: '303240', value: 'Retorno Suporte' },
  { id: '303242', value: 'Apoio/Pendência de Outro Time/Área' }, { id: '303241', value: 'Indisponibilidade/Ausência Time' },
  { id: '303238', value: 'Problemas com Ambiente' }, { id: '303244', value: 'Dependência de Fonte' }, { id: '303243', value: 'Problemas ou Dependência de Infra' }
] as const;
// flagOf devolve null (sem flag) ou a descrição do impedimento (pode ser vazia).
export function buildHomeBoard(issues: HomeIssue[], sprintsOf: (issue: HomeIssue) => SprintRef[] = () => [], flagOf: (issue: HomeIssue) => string | null = () => null, deliveryOf: (issue: HomeIssue) => string = () => ''): HomeColumn[] {
  const cards = new Map<string, HomeCard>();
  for (const issue of issues) if (!cards.has(issue.key)) {
    const card = toCard(issue.key, issue.fields, true, latestSprint(sprintsOf(issue)));
    const note = flagOf(issue);
    if (note !== null) { card.flagged = true; card.flagNote = note; }
    card.delivery = deliveryOf(issue);
    cards.set(issue.key, card);
  }
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
  const columns = new Map<string, HomeColumn>(BOARD_COLUMNS.map(item => [item.id, { id: item.id, status: item.label, category: item.category, cards: [], fixed: true }]));
  for (const root of roots) {
    const id = cardColumnId(root);
    const column = columns.get(id) ?? { id, status: root.status, category: root.category, cards: [] };
    column.cards.push(root); columns.set(id, column);
  }
  return [...columns.values()].sort((a, b) => columnRank(a) - columnRank(b) || a.status.localeCompare(b.status, 'pt-BR'));
}
export const hasCards = (columns: HomeColumn[]): boolean => columns.some(column => column.cards.length > 0);
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
  return columns.map(column => ({ ...column, cards: column.cards.map(prune).filter((card): card is HomeCard => !!card) })).filter(column => column.fixed || column.cards.length);
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
// A transição que leva à coluna: pelo mesmo nome de status ou por qualquer status que o quadro coloque naquela coluna.
export const findMove = (moves: JiraMove[], column: { id: string; status: string }): JiraMove | undefined =>
  moves.find(move => sameStatus(moveTarget(move), column.status)) ?? moves.find(move => (columnIdFor(moveTarget(move)) ?? `extra:${moveTarget(move)}`) === column.id);
export function findCard(columns: HomeColumn[], key: string): HomeCard | undefined {
  const search = (card: HomeCard): HomeCard | undefined => card.key === key ? card : card.children.map(search).find(Boolean);
  for (const column of columns) for (const card of column.cards) { const found = search(card); if (found) return found; }
  return undefined;
}

// Progresso da sprint inteira (todas as pessoas, só tarefas principais): quantas estão em cada coluna do quadro e o % finalizado.
export interface SprintProgress { total: number; percent: number; counts: { id: string; label: string; count: number }[]; others: { status: string; count: number }[] }
export const sprintJql = (sprint: string) => `sprint = "${sprint.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" AND issuetype in standardIssueTypes()`;
export function summarizeSprint(issues: { fields: { status?: { name?: string }; issuetype?: { name?: string; subtask?: boolean } } }[]): SprintProgress {
  // Só tarefas principais, e cards de Gestão (reuniões, apontamentos, autoconhecimento…) não contam na sprint.
  const parents = issues.filter(issue => !issue.fields.issuetype?.subtask && !/^gest[aã]o/i.test(issue.fields.issuetype?.name?.trim() ?? ''));
  const counts = BOARD_COLUMNS.map(item => ({ id: item.id as string, label: item.label as string, count: parents.filter(issue => columnIdFor(issue.fields.status?.name ?? '') === item.id).length }));
  const done = counts.find(item => item.id === 'finalizado')?.count ?? 0;
  // Status que não casam com nenhuma coluna do quadro (ex.: Cancelado, Impedido) ficam à parte, para a soma bater com o total.
  const others = new Map<string, number>();
  for (const issue of parents) { const name = issue.fields.status?.name?.trim() || 'Sem status'; if (!columnIdFor(name)) others.set(name, (others.get(name) ?? 0) + 1); }
  return { total: parents.length, percent: parents.length ? Math.round(done / parents.length * 100) : 0, counts, others: [...others].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count) };
}

// Data Acordo Entrega: o Jira devolve AAAA-MM-DD; mostra DD/MM/AAAA. Atrasada = já passou e a tarefa ainda não terminou.
export const formatDelivery = (iso: string): string => /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '';
export const deliveryLate = (iso: string, category: string, today = new Date()): boolean => !!category && category !== 'done' && /^\d{4}-\d{2}-\d{2}/.test(iso) && iso.slice(0, 10) < `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
