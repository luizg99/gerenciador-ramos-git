import type { JiraMove } from '../models/jiraHome';
import { HOME_FIELDS, HOME_JQL, HOME_MAX_ISSUES, HOME_PAGE_SIZE, buildHomeBoard, sprintJql, summarizeSprint, type HomeColumn, type HomeIssue, type SprintProgress } from '../models/jiraHome';
import { JIRA_FLAG_PATH, isImpeded } from '../models/jira';
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

// Progresso da sprint toda (qualquer responsável, só tarefas principais). Fica em cache por sprint; ↻ Atualizar refaz a consulta.
const sprintCache = new Map<string, SprintProgress>();
const SPRINT_MAX_ISSUES = 5000;
export const cachedSprintProgress = (sprint: string) => sprintCache.get(sprint);
export async function fetchSprintProgress(sprint: string): Promise<SprintProgress> {
  const issues: Parameters<typeof summarizeSprint>[0] = [];
  // Avança pelo que o Jira devolveu de fato (ele pode limitar a página abaixo do pedido) e não aceita resultado truncado.
  for (;;) {
    const page = await window.gitManager.jiraRequest('/rest/api/2/search', 'POST', { jql: sprintJql(sprint), startAt: issues.length, maxResults: HOME_PAGE_SIZE, fields: ['status', 'issuetype'] }) as { issues?: typeof issues; total?: number };
    issues.push(...(page.issues ?? []));
    if (!page.issues?.length || issues.length >= (page.total ?? 0)) break;
    if (issues.length >= SPRINT_MAX_ISSUES) throw new Error(`A sprint tem mais de ${SPRINT_MAX_ISSUES} tarefas; o progresso não seria confiável.`);
  }
  const progress = summarizeSprint(issues);
  sprintCache.set(sprint, progress);
  return progress;
}

// Red flag (impedimento) e XML da issue, usados pelo menu do botão direito/esquerdo no Início.
let flagField: string | null | undefined;
const flaggedFieldId = async (): Promise<string | null> => {
  if (flagField !== undefined) return flagField;
  const fields = await window.gitManager.jiraRequest('/rest/api/2/field') as { id: string; name: string }[];
  flagField = (Array.isArray(fields) ? fields : []).find(field => /^(flagged|sinalizad[oa])$/i.test(field.name.trim()))?.id ?? null;
  return flagField;
};
const issuePath = (key: string) => `/rest/api/2/issue/${encodeURIComponent(key)}`;
export async function fetchFlagged(key: string): Promise<boolean> {
  const id = await flaggedFieldId();
  if (!id) throw new Error('Campo Flagged não encontrado neste Jira.');
  return isImpeded(await window.gitManager.jiraRequest(`${issuePath(key)}?fields=${id}`) as { fields: Record<string, unknown> }, id);
}
export async function setFlagged(key: string, flag: boolean): Promise<void> {
  const id = await flaggedFieldId();
  if (!id) throw new Error('Campo Flagged não encontrado neste Jira.');
  try { await window.gitManager.jiraRequest(JIRA_FLAG_PATH, 'POST', { issueKeys: [key], flag }); }
  catch (cause) {
    // Só tenta o campo direto quando o endpoint do quadro não existe/aceita; erro de rede ou de sessão aparece como está.
    if (!/HTTP (400|404|405)/.test((cause as Error).message)) throw cause;
    const current = (await window.gitManager.jiraRequest(`${issuePath(key)}?fields=${id}`) as { fields: Record<string, unknown> }).fields[id];
    const values = (Array.isArray(current) ? current : []) as { value?: string }[];
    const kept = values.filter(item => !/imped/i.test(item?.value ?? ''));
    await window.gitManager.jiraRequest(issuePath(key), 'PUT', { fields: { [id]: flag ? [...kept, { value: values.find(item => /imped/i.test(item?.value ?? ''))?.value ?? 'Impediment' }] : kept.map(item => ({ value: item.value })) } });
  }
  // O Jira pode demorar um instante para refletir a mudança: confere algumas vezes antes de acusar falha.
  let now = await fetchFlagged(key);
  for (let attempt = 0; attempt < 3 && now !== flag; attempt++) { await new Promise(resolve => setTimeout(resolve, 800)); now = await fetchFlagged(key); }
  if (now !== flag) throw new Error(`O Jira não ${flag ? 'colocou' : 'removeu'} o red flag. Faça direto no Jira (menu da tarefa).`);
}
export const fetchIssueXml = (key: string): Promise<string> => window.gitManager.jiraRequestText(`/si/jira.issueviews:issue-xml/${key}/${key}.xml`);
