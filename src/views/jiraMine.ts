import type { JiraMove } from '../models/jiraHome';
import { HOME_FIELDS, HOME_JQL, HOME_MAX_ISSUES, HOME_PAGE_SIZE, buildHomeBoard, type HomeColumn, type HomeIssue } from '../models/jiraHome';
import { detectSprintFieldIds, isSprintField, issueSprints } from '../models/jiraReport';

// Tarefas atribuídas ao usuário logado no Jira (usado pelo Início e pelo filtro "Minhas tarefas" da aba Jira).
// O campo Sprint tem id diferente em cada Jira. Primeiro é procurado pelo tipo/nome em /field; se isso não achar nada, ou se nenhuma
// tarefa vier com sprint, o campo é deduzido pelo formato dos valores. Só é guardado depois de achado de verdade (senão tenta de novo).
let sprintFields: string[] | null = null;
let shapeTried = false;
export interface MyBoard { columns: HomeColumn[]; user: string; at: number; sprintFields: string[] }
let cache: MyBoard | null = null;
export const cachedBoard = () => cache;

type Request = (path: string, method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<unknown>;
async function searchMine(request: Request, fields: string[]): Promise<HomeIssue[]> {
  const issues: HomeIssue[] = [];
  for (let startAt = 0; startAt < HOME_MAX_ISSUES; startAt += HOME_PAGE_SIZE) {
    const page = await request('/rest/api/2/search', 'POST', { jql: HOME_JQL, startAt, maxResults: HOME_PAGE_SIZE, fields }) as { issues?: HomeIssue[]; total?: number };
    issues.push(...(page.issues ?? []));
    if (!page.issues?.length || issues.length >= (page.total ?? 0)) break;
  }
  return issues;
}
const hasSprint = (issues: HomeIssue[], ids: string[]) => issues.some(issue => issueSprints(issue.fields as Parameters<typeof issueSprints>[0], ids).length > 0);

export async function fetchMyBoard(): Promise<MyBoard> {
  const request: Request = (path, method, body) => window.gitManager.jiraRequest(path, method, body);
  let ids = sprintFields ?? [];
  if (!sprintFields) {
    try {
      const fields = await request('/rest/api/2/field') as { id: string; name: string; schema?: { custom?: string } }[];
      const found = (Array.isArray(fields) ? fields : []).filter(isSprintField).map(field => field.id);
      if (found.length) ids = sprintFields = found;
    } catch { /* a busca das tarefas abaixo mostra o erro de sessão, se for o caso */ }
  }
  const me = request('/rest/api/2/myself').then(value => (value as { displayName?: string }).displayName ?? '').catch(() => '');
  let issues = await searchMine(request, [...HOME_FIELDS, ...ids]);
  // Plano B: sem campo conhecido, ou conhecido mas sem nenhum valor nas tarefas → procura pelo formato dos valores (uma vez por abertura).
  if (!shapeTried && (!ids.length || !hasSprint(issues, ids))) {
    shapeTried = true;
    try {
      const sample = await request('/rest/api/2/search', 'POST', { jql: HOME_JQL, startAt: 0, maxResults: 50, fields: ['*all'] }) as { issues?: HomeIssue[] };
      const detected = detectSprintFieldIds(sample.issues ?? []);
      if (detected.length) { ids = sprintFields = [...new Set([...ids, ...detected])]; issues = await searchMine(request, [...HOME_FIELDS, ...ids]); }
    } catch { /* sem o plano B, as tarefas ficam sem sprint */ }
  }
  cache = { columns: buildHomeBoard(issues, issue => issueSprints(issue.fields as Parameters<typeof issueSprints>[0], ids)), user: await me, at: Date.now(), sprintFields: ids };
  return cache;
}

// Mudança de status no Jira: lista as transições permitidas para a tarefa e executa a escolhida.
export async function fetchMoves(key: string): Promise<JiraMove[]> {
  const result = await window.gitManager.jiraRequest(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`) as { transitions?: JiraMove[] } | null;
  return Array.isArray(result?.transitions) ? result.transitions : [];
}
export async function moveIssue(key: string, transitionId: string): Promise<void> {
  await window.gitManager.jiraRequest(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, 'POST', { transition: { id: transitionId } });
}
