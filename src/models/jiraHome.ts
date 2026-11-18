// Quadro da tela inicial: as tarefas atribuídas ao usuário logado, em colunas por status, com a tarefa principal e,
// em cascata, as sub-tarefas que também são dele. Se só a sub-tarefa for dele, a principal aparece como contexto.
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
  };
}
export interface HomeCard { key: string; summary: string; type: string; status: string; category: string; priority: string; mine: boolean; children: HomeCard[] }
export interface HomeColumn { status: string; category: string; cards: HomeCard[] }

const categoryRank = (category: string) => category === 'new' ? 0 : category === 'indeterminate' ? 1 : category === 'done' ? 3 : 2;
const toCard = (key: string, fields: HomeIssue['fields'] | NonNullable<HomeIssue['fields']['parent']>['fields'], mine: boolean): HomeCard => ({
  key, summary: fields?.summary ?? '', type: fields?.issuetype?.name ?? '', status: fields?.status?.name ?? 'Sem status',
  category: fields?.status?.statusCategory?.key ?? '', priority: (fields as HomeIssue['fields'] | undefined)?.priority?.name ?? '', mine, children: []
});

export function buildHomeBoard(issues: HomeIssue[]): HomeColumn[] {
  const cards = new Map<string, HomeCard>();
  for (const issue of issues) if (!cards.has(issue.key)) cards.set(issue.key, toCard(issue.key, issue.fields, true));
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
  return [...columns.values()].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.status.localeCompare(b.status, 'pt-BR'));
}
export const countMine = (columns: HomeColumn[]): number => {
  const count = (card: HomeCard): number => (card.mine ? 1 : 0) + card.children.reduce((sum, child) => sum + count(child), 0);
  return columns.reduce((sum, column) => sum + column.cards.reduce((inner, card) => inner + count(card), 0), 0);
};
