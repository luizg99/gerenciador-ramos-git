import type { JiraMove } from '../models/jiraHome';
import { HOME_FIELDS, HOME_JQL, HOME_MAX_ISSUES, HOME_PAGE_SIZE, buildHomeBoard, type HomeColumn, type HomeIssue } from '../models/jiraHome';
import { issueSprints } from '../models/jiraReport';

// Tarefas atribuídas ao usuário logado no Jira (usado pelo Início e pelo filtro "Minhas tarefas" da aba Jira).
// O campo Sprint tem id diferente em cada Jira: só é guardado depois de achado de verdade (se a consulta falhar, tenta de novo na próxima).
let sprintFields: string[] | null = null;
export interface MyBoard { columns: HomeColumn[]; user: string; at: number }
let cache: MyBoard | null = null;
export const cachedBoard = () => cache;

export async function fetchMyBoard(): Promise<MyBoard> {
  const request = (path: string, method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown) => window.gitManager.jiraRequest(path, method, body);
  let ids = sprintFields ?? [];
  if (!sprintFields) {
    try {
      const fields = await request('/rest/api/2/field') as { id: string; name: string; schema?: { custom?: string } }[];
      if (Array.isArray(fields)) ids = sprintFields = fields.filter(field => /^sprint$/i.test(field.name.trim()) || /gh-sprint/i.test(field.schema?.custom ?? '')).map(field => field.id);
    } catch { /* a busca das tarefas abaixo mostra o erro de sessão, se for o caso */ }
  }
  const me = request('/rest/api/2/myself').then(value => (value as { displayName?: string }).displayName ?? '').catch(() => '');
  const issues: HomeIssue[] = [];
  for (let startAt = 0; startAt < HOME_MAX_ISSUES; startAt += HOME_PAGE_SIZE) {
    const page = await request('/rest/api/2/search', 'POST', { jql: HOME_JQL, startAt, maxResults: HOME_PAGE_SIZE, fields: [...HOME_FIELDS, ...ids] }) as { issues?: HomeIssue[]; total?: number };
    issues.push(...(page.issues ?? []));
    if (!page.issues?.length || issues.length >= (page.total ?? 0)) break;
  }
  cache = { columns: buildHomeBoard(issues, issue => issueSprints(issue.fields as Parameters<typeof issueSprints>[0], ids)), user: await me, at: Date.now() };
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
