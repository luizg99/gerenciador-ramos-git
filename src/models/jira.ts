export const JIRA_BASE = 'https://jiraproducao.totvs.com.br';
export const JIRA_HOME_URL = `${JIRA_BASE}/secure/Dashboard.jspa`;
export interface JiraBounds { x: number; y: number; width: number; height: number }
export interface JiraBrowserState { phase: 'loading' | 'ready' | 'error'; message: string; url?: string }
export type JiraMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export interface JiraIssue {
  id: string; key: string; self: string;
  fields: {
    timeoriginalestimate?: number | null; aggregatetimeoriginalestimate?: number | null; timespent?: number | null; timetracking?: { originalEstimateSeconds?: number; originalEstimate?: string };
    summary: string; description?: unknown; status?: { name: string };
    issuetype?: { id: string; name: string; subtask?: boolean };
    project?: { id: string; key: string; name: string };
    assignee?: { displayName: string; name?: string; key?: string; accountId?: string } | null;
    parent?: { id: string; key: string; fields?: { summary?: string; issuetype?: { name: string } } };
    subtasks?: { id: string; key: string; fields: { summary: string; status?: { name: string }; issuetype?: { id: string; name: string } } }[];
    issuelinks?: { type?: { inward?: string; outward?: string }; inwardIssue?: { id: string; key: string; fields: { summary: string; status?: { name: string }; issuetype?: { id: string; name: string } } }; outwardIssue?: { id: string; key: string; fields: { summary: string; status?: { name: string }; issuetype?: { id: string; name: string } } } }[];
  };
}
export interface JiraCurrentUser { displayName?: string; name?: string; key?: string; accountId?: string }
export interface JiraWorklog { id: string; timeSpent: string; timeSpentSeconds: number; started: string; comment?: string; author?: { displayName: string } }
export interface JiraTransition { id: string; name: string; to?: { name: string } }
export interface JiraFieldMeta { id: string; name: string; required?: boolean; schema?: { type?: string; system?: string } }
export function parseJiraKey(value: string) {
  let candidate = value.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.origin !== JIRA_BASE) throw new Error();
      const issue = url.pathname.match(/^\/browse\/([^/]+)\/?$/i);
      if (!issue) throw new Error();
      candidate = decodeURIComponent(issue[1]);
    } catch { throw new Error('Informe uma chave ou link de tarefa do Jira de produção.'); }
  }
  const key = candidate.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Informe uma chave de tarefa válida, por exemplo DDVENDAS-61611.');
  return key;
}

export function parsePrLinks(value = ''): string[] {
  const links = new Map<string, string>();
  for (const line of value.split(/\r?\n/)) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>|\]\)]+/g)) {
      const url = match[0].replace(/[.,;]+$/, '');
      if (!/\/_git\/[^/]+\/pullrequest\/[1-9]\d*\/?(?:[?#].*)?$/i.test(url)) continue;
      const prefix = line.slice(0, match.index).trim().replace(/^[-*]\s*/, '');
      const target = /^([^:<>]+):\s*$/.exec(prefix)?.[1]?.trim();
      if (!links.has(url)) links.set(url, target ? `${target}: ${url}` : url);
    }
  }
  return [...links.values()];
}
export const originalEstimateSeconds = (issue: JiraIssue) => issue.fields.timeoriginalestimate ?? issue.fields.timetracking?.originalEstimateSeconds ?? issue.fields.aggregatetimeoriginalestimate ?? 0;
