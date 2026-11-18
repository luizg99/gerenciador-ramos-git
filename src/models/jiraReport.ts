export const REPORT_ISSUE_TYPES = ['Codificação (Sub-tarefa)', 'Apoio - Cliente', 'Execução de TI (Sub-tarefa)'];
export const REPORT_STATUSES = ['Concluído', 'Cancelado', 'Done', 'Closed'];
export const REPORT_FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'resolutiondate', 'timespent', 'timeoriginalestimate', 'parent', 'components'];
export const REPORT_PARENT_CHUNK = 50;
export const REPORT_PAGE_SIZE = 100;
export const REPORT_MAX_ISSUES = 1500;

export interface ReportIssue {
  key: string;
  fields: {
    summary?: string; issuetype?: { name: string }; status?: { name: string };
    assignee?: { displayName: string; name?: string; key?: string } | null;
    resolutiondate?: string | null; timespent?: number | null; timeoriginalestimate?: number | null;
    parent?: { key: string };
    components?: { name: string }[];
    [field: string]: unknown;
  };
}
export interface ReportRow { key: string; summary: string; person: string; type: string; status: string; resolved: Date; spentSeconds: number; estimatedSeconds: number; cancelled: boolean; routines: string[]; sprints: SprintRef[] }
export interface SprintRef { name: string; start: number; end: number }
export interface IssueExtras { routines: string[]; sprints: SprintRef[] }

const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

// Usa o responsável atual (assignee in) e a data de resolução em vez de "assignee was": é uma consulta
// bem mais leve no Jira, não depende do histórico e evita creditar uma tarefa a quem só passou por ela.
export interface ReportRange { from: string; to: string }
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const parseDay = (value: string) => { const [y, m, d] = value.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Período imediatamente anterior, com a mesma duração.
export function previousRange(range: ReportRange): ReportRange {
  const length = Math.round((parseDay(range.to) - parseDay(range.from)) / dayMs) + 1;
  const to = parseDay(range.from) - dayMs;
  return { from: formatDay(to - (length - 1) * dayMs), to: formatDay(to) };
}
// Em modo sprint carrega-se uma janela ampla e a sprint é escolhida depois, na própria tela.
export const SPRINT_WINDOW_DAYS = 365;
export function buildReportJql(users: string[], period: number | ReportRange, previous = false) {
  const names = [...new Set(users.map(user => user.trim()).filter(Boolean))];
  if (names.length === 0) throw new Error('Informe ao menos um usuário da squad.');
  const list = (values: string[]) => values.map(quote).join(', ');
  let range = '';
  if (typeof period === 'number') {
    if (Number.isInteger(period) && period > 0) range = previous ? ` AND resolved >= -${period * 2}d AND resolved < -${period}d` : ` AND resolved >= -${period}d`;
  } else {
    if (!isoDate.test(period.from) || !isoDate.test(period.to)) throw new Error('Informe a data inicial e a final.');
    if (period.from > period.to) throw new Error('A data inicial não pode ser maior que a final.');
    const { from, to } = previous ? previousRange(period) : period;
    range = ` AND resolved >= "${from}" AND resolved <= "${to} 23:59"`;
  }
  return `issuetype in (${list(REPORT_ISSUE_TYPES)}) AND assignee in (${list(names)}) AND status in (${list(REPORT_STATUSES)})${range} ORDER BY resolutiondate DESC`;
}

// Aceita texto, número, {value}/{name} ou listas disso; textos com vários itens separados por vírgula/ponto e vírgula viram vários.
export function routineValues(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const names = items.flatMap(item => {
    if (item == null) return [];
    if (typeof item === 'string') return item.split(/[;,\n]/);
    if (typeof item === 'number') return [String(item)];
    const named = item as { value?: unknown; name?: unknown };
    return typeof named.value === 'string' ? [named.value] : typeof named.name === 'string' ? [named.name] : [];
  });
  return [...new Set(names.map(name => name.trim()).filter(Boolean))];
}
// Rotina vem do(s) campo(s) 'Rotina' da issue; sem campo preenchido, usa os componentes.
export function issueRoutines(fields: ReportIssue['fields'], fieldIds: string[]): string[] {
  const fromFields = fieldIds.flatMap(id => routineValues(fields[id]));
  return fromFields.length ? [...new Set(fromFields)] : routineValues(fields.components);
}
// O campo Sprint vem como texto legado ("...Sprint@1[id=1,state=CLOSED,name=Vendas - 2026.11/2,startDate=...]") ou como objeto, dependendo da versão do Jira.
export function sprintValues(raw: unknown): SprintRef[] {
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const refs = items.flatMap((item): SprintRef[] => {
    if (typeof item === 'string') {
      const name = /(?:^|[,\[])name=([^,\]]+)/.exec(item)?.[1]?.trim();
      const time = (field: string) => { const value = Date.parse(new RegExp(`${field}=([^,\\]]+)`).exec(item)?.[1] ?? ''); return Number.isNaN(value) ? 0 : value; };
      return name ? [{ name, start: time('startDate'), end: time('endDate') }] : [];
    }
    const sprint = item as { name?: unknown; startDate?: unknown; endDate?: unknown };
    if (typeof sprint.name !== 'string' || !sprint.name.trim()) return [];
    const time = (value: unknown) => { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isNaN(parsed) ? 0 : parsed; };
    return [{ name: sprint.name.trim(), start: time(sprint.startDate), end: time(sprint.endDate) }];
  });
  return [...new Map(refs.map(ref => [ref.name, ref])).values()];
}
export const issueSprints = (fields: ReportIssue['fields'], fieldIds: string[]): SprintRef[] => [...new Map(fieldIds.flatMap(id => sprintValues(fields[id])).map(ref => [ref.name, ref])).values()];
export const normalizeText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
export const matchesRoutine = (routines: string[], query: string) => { const q = normalizeText(query.trim()); return !q || routines.some(routine => normalizeText(routine).includes(q)); };
// Uma tarefa que atravessou várias sprints (carregada de uma para outra) conta só na sprint em que foi resolvida.
export function sprintOfResolution(sprints: SprintRef[], resolved: Date): SprintRef[] {
  const time = resolved.getTime(), day = 86400000;
  const dated = sprints.filter(item => item.start > 0).sort((a, b) => b.start - a.start);
  const inside = dated.find(item => time >= item.start && (!item.end || time <= item.end + day));
  const latestBefore = dated.find(item => item.start <= time);
  const chosen = inside ?? latestBefore;
  return chosen ? [chosen] : sprints;
}
export function toReportRows(issues: ReportIssue[], extrasOf: (issue: ReportIssue) => IssueExtras = () => ({ routines: [], sprints: [] })): ReportRow[] {
  return issues.flatMap(issue => {
    const resolved = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
    if (!resolved || Number.isNaN(resolved.getTime())) return [];
    const status = issue.fields.status?.name ?? '';
    return [{
      key: issue.key, summary: issue.fields.summary ?? '', person: issue.fields.assignee?.displayName ?? 'Sem responsável',
      type: issue.fields.issuetype?.name ?? '', status, resolved, spentSeconds: issue.fields.timespent ?? 0, estimatedSeconds: issue.fields.timeoriginalestimate ?? 0, cancelled: /cancel/i.test(status), ...(extras => ({ ...extras, sprints: sprintOfResolution(extras.sprints, resolved) }))(extrasOf(issue))
    }];
  });
}

export interface PersonSummary { person: string; done: number; cancelled: number; coding: number; support: number; ti: number; hours: number; estimatedHours: number; spentOnEstimatedHours: number }
export type ReportTotals = Omit<PersonSummary, 'person'>;
export type TaskKind = 'coding' | 'support' | 'ti';
export const taskKind = (type: string): TaskKind => /apoio/i.test(type) ? 'support' : /^execu/i.test(type) ? 'ti' : 'coding';
export const TASK_KIND_LABELS: Record<TaskKind, string> = { coding: 'Codificação', support: 'Apoio', ti: 'Execução de TI' };
export function summarizeByPerson(rows: ReportRow[]): PersonSummary[] {
  const map = new Map<string, PersonSummary>();
  for (const row of rows) {
    const item = map.get(row.person) ?? { person: row.person, done: 0, cancelled: 0, coding: 0, support: 0, ti: 0, hours: 0, estimatedHours: 0, spentOnEstimatedHours: 0 };
    if (row.cancelled) item.cancelled++; else item.done++;
    item[taskKind(row.type)]++;
    item.hours += row.spentSeconds / 3600;
    // Só compara estimado x lançado nas tarefas que têm estimativa; sem ela a comparação ficaria distorcida.
    if (row.estimatedSeconds > 0) { item.estimatedHours += row.estimatedSeconds / 3600; item.spentOnEstimatedHours += row.spentSeconds / 3600; }
    map.set(row.person, item);
  }
  return [...map.values()].sort((a, b) => b.done + b.cancelled - (a.done + a.cancelled) || a.person.localeCompare(b.person, 'pt-BR'));
}
export const totalsOf = (people: PersonSummary[]): ReportTotals => people.reduce((sum, p) => ({
  done: sum.done + p.done, cancelled: sum.cancelled + p.cancelled, coding: sum.coding + p.coding, support: sum.support + p.support, ti: sum.ti + p.ti,
  hours: sum.hours + p.hours, estimatedHours: sum.estimatedHours + p.estimatedHours, spentOnEstimatedHours: sum.spentOnEstimatedHours + p.spentOnEstimatedHours
}), { done: 0, cancelled: 0, coding: 0, support: 0, ti: 0, hours: 0, estimatedHours: 0, spentOnEstimatedHours: 0 });
// Variação percentual contra o período anterior; null quando não há base de comparação.
export const variation = (current: number, previous: number) => previous > 0 ? Math.round((current - previous) / previous * 100) : null;

const pad = (value: number) => String(value).padStart(2, '0');
const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Segunda-feira da semana, em horário local, como YYYY-MM-DD.
export function weekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return localDay(start);
}
export interface TimeSeries { buckets: string[]; series: { person: string; values: number[] }[] }
// Entregas por pessoa em dias ou semanas, preenchendo com zero os intervalos sem entregas para a linha não "pular".
export function summarizeOverTime(rows: ReportRow[], granularity: 'day' | 'week'): TimeSeries {
  if (rows.length === 0) return { buckets: [], series: [] };
  const keyOf = (date: Date) => granularity === 'week' ? weekStart(date) : localDay(date);
  const keys = rows.map(row => keyOf(row.resolved)).sort();
  const step = granularity === 'week' ? 7 : 1;
  const buckets: string[] = [];
  for (let ms = parseDay(keys[0]); ms <= parseDay(keys[keys.length - 1]); ms += step * dayMs) buckets.push(formatDay(ms));
  const index = new Map(buckets.map((bucket, i) => [bucket, i]));
  const series = new Map<string, number[]>();
  for (const row of rows) {
    const values = series.get(row.person) ?? buckets.map(() => 0);
    values[index.get(keyOf(row.resolved))!]++;
    series.set(row.person, values);
  }
  return { buckets, series: [...series.entries()].map(([person, values]) => ({ person, values })).sort((a, b) => a.person.localeCompare(b.person, 'pt-BR')) };
}
export const weekdayLabel = (date: Date) => date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');

export interface SprintSummary { name: string; start: number; done: number; cancelled: number; hours: number; doneHours: number; cancelledHours: number }
export type SprintMetric = 'count' | 'hours';
// Totais por sprint, da mais antiga para a mais nova; tarefas que passaram por mais de uma sprint contam em todas.
export function summarizeBySprint(rows: ReportRow[], limit = 8, metric: SprintMetric = 'count'): { sprints: SprintSummary[]; time: TimeSeries } {
  const map = new Map<string, SprintSummary>();
  for (const row of rows) for (const ref of row.sprints) {
    const item = map.get(ref.name) ?? { name: ref.name, start: ref.start, done: 0, cancelled: 0, hours: 0, doneHours: 0, cancelledHours: 0 };
    const hours = row.spentSeconds / 3600;
    if (row.cancelled) { item.cancelled++; item.cancelledHours += hours; } else { item.done++; item.doneHours += hours; }
    item.hours += hours;
    map.set(ref.name, item);
  }
  const sprints = [...map.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name, 'pt-BR')).slice(-limit);
  const names = sprints.map(sprint => sprint.name);
  const perPerson = new Map<string, number[]>();
  for (const row of rows) for (const ref of row.sprints) {
    const index = names.indexOf(ref.name);
    if (index < 0) continue;
    const values = perPerson.get(row.person) ?? names.map(() => 0);
    values[index] += metric === 'hours' ? Math.round(row.spentSeconds / 360) / 10 : 1;
    perPerson.set(row.person, values);
  }
  return { sprints, time: { buckets: names, series: [...perPerson.entries()].map(([person, values]) => ({ person, values })).sort((a, b) => a.person.localeCompare(b.person, 'pt-BR')) } };
}
