import { memo, useMemo, useRef, useState } from 'react';
import type { JiraCurrentUser } from '../models/jira';
import { JIRA_BASE } from '../models/jira';
import { REPORT_FIELDS, REPORT_MAX_ISSUES, REPORT_PAGE_SIZE, REPORT_PARENT_CHUNK, SPRINT_WINDOW_DAYS, buildReportJql, issueRoutines, issueSprints, matchesRoutine, normalizeText, previousRange, summarizeByPerson, summarizeBySprint, summarizeOverTime, taskKind, TASK_KIND_LABELS, toReportRows, totalsOf, variation, weekdayLabel, type PersonSummary, type ReportIssue, type ReportRow, type ReportTotals, type IssueExtras, type TaskKind, type SprintMetric, type SprintSummary, type TimeSeries } from '../models/jiraReport';

const SQUAD_KEY = 'jira-report-squad';
const IGNORED_KEY = 'jira-report-ignored';
const loadSquad = (key = SQUAD_KEY) => { try { const value = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };
const periods = [{ days: 1, label: '1 dia' }, { days: 3, label: '3 dias' }, { days: 7, label: '7 dias' }, { days: 30, label: '30 dias' }, { days: 90, label: '90 dias' }, { days: 180, label: '6 meses' }, { days: 365, label: '1 ano' }];
const hoursLabel = (hours: number) => `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

function Bars({ rows, max }: { rows: { label: string; parts: { value: number; className: string; title: string }[] }[]; max: number }) {
  return <div className="report-bars">{rows.map(row => <div key={row.label} className="report-bar-row"><span title={row.label}>{row.label}</span><div className="report-bar-track">{row.parts.filter(part => part.value > 0).map(part => <i key={part.className} className={part.className} title={part.title} style={{ width: `${part.value / max * 100}%` }}/>)}</div><b>{row.parts.reduce((sum, part) => sum + part.value, 0)}</b></div>)}</div>;
}

const lineColors = ['#7f9cff', '#6fc59f', '#e3b46c', '#ea8c9c', '#b48cf0', '#5fc8d8', '#f0996a', '#a3c45c'];
const dayLabel = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;
function LineChart({ rows, grain, data, format = dayLabel, decimals = false }: { rows: ReportRow[]; grain: 'day' | 'week'; data?: TimeSeries; format?: (bucket: string) => string; decimals?: boolean }) {
  const computed = useMemo(() => summarizeOverTime(rows, grain), [rows, grain]);
  const { buckets, series } = data ?? computed;
  if (buckets.length === 0) return <p className="hint">Sem dados no período.</p>;
  const width = 640, height = 220, left = 30, right = 10, top = 12, bottom = 26;
  const max = Math.max(1, ...series.flatMap(item => item.values));
  const x = (i: number) => left + (buckets.length === 1 ? (width - left - right) / 2 : i / (buckets.length - 1) * (width - left - right));
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const labelEvery = Math.ceil(buckets.length / 10);
  return <>
    <svg className="report-lines" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={grain === 'week' ? 'Entregas por semana, por pessoa' : 'Entregas por dia, por pessoa'}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1={left} x2={width - right} y1={y(max * f)} y2={y(max * f)} className="report-grid-line"/><text x={left - 5} y={y(max * f) + 3} textAnchor="end">{decimals ? (max * f).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(max * f)}</text></g>)}
      {buckets.map((bucket, i) => i % labelEvery === 0 && <text key={bucket} x={x(i)} y={height - 8} textAnchor="middle">{format(bucket)}</text>)}
      {series.map((item, s) => { const color = lineColors[s % lineColors.length]; return <g key={item.person}>
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={item.values.map((value, i) => `${x(i)},${y(value)}`).join(' ')}/>
        {item.values.map((value, i) => <circle key={i} cx={x(i)} cy={y(value)} r="3" fill={color}><title>{`${item.person} — ${grain === 'week' && !data ? 'semana de ' : ''}${data ? buckets[i] : format(buckets[i])}: ${value}`}</title></circle>)}
      </g>; })}
    </svg>
    <p className="report-legend">{series.map((item, s) => <span key={item.person}><i style={{ background: lineColors[s % lineColors.length] }}/>{item.person}</span>)}</p>
  </>;
}

function EstimateChart({ people }: { people: PersonSummary[] }) {
  const rows = people.filter(p => p.estimatedHours > 0);
  if (rows.length === 0) return <p className="hint">Nenhuma tarefa do período tem estimativa original.</p>;
  const max = Math.max(1, ...rows.flatMap(p => [p.estimatedHours, p.spentOnEstimatedHours]));
  return <>
    <div className="report-bars">{rows.map(p => { const diff = variation(p.spentOnEstimatedHours, p.estimatedHours); return <div key={p.person} className="report-pair"><span title={p.person}>{p.person}</span>
      <div><div className="report-bar-track" title={`Estimado: ${hoursLabel(p.estimatedHours)}`}><i className="bar-estimate" style={{ width: `${p.estimatedHours / max * 100}%` }}/></div>
      <div className="report-bar-track" title={`Lançado: ${hoursLabel(p.spentOnEstimatedHours)}`}><i className={p.spentOnEstimatedHours > p.estimatedHours ? 'bar-over' : 'bar-hours'} style={{ width: `${p.spentOnEstimatedHours / max * 100}%` }}/></div></div>
      <b className={p.spentOnEstimatedHours > p.estimatedHours ? 'delta-down' : 'delta-up'}>{diff === null ? '' : `${diff > 0 ? '+' : ''}${diff}%`}<small>{hoursLabel(p.spentOnEstimatedHours)} / {hoursLabel(p.estimatedHours)}</small></b></div>; })}</div>
    <p className="report-legend"><span><i className="bar-estimate"/>Estimado</span><span><i className="bar-hours"/>Lançado</span><span><i className="bar-over"/>Acima do estimado</span></p>
    <p className="hint">Considera só as tarefas que têm estimativa original.</p>
  </>;
}

const shortSprint = (name: string) => name.split(' - ').pop() ?? name;
function SprintCompare({ rows }: { rows: ReportRow[] }) {
  const [metric, setMetric] = useState<SprintMetric>('count');
  const byHours = metric === 'hours';
  const { sprints, time } = useMemo(() => summarizeBySprint(rows, 8, metric), [rows, metric]);
  if (sprints.length === 0) return <p className="hint">Nenhuma sprint encontrada nas tarefas.</p>;
  const doneOf = (item: SprintSummary) => byHours ? item.doneHours : item.done;
  const cancelledOf = (item: SprintSummary) => byHours ? item.cancelledHours : item.cancelled;
  const totalOf = (item: SprintSummary) => doneOf(item) + cancelledOf(item);
  const format = (value: number) => byHours ? hoursLabel(value) : String(value);
  const max = Math.max(1, ...sprints.map(totalOf));
  return <>
    <div className="report-chips" role="group" aria-label="Métrica da comparação">
      <button type="button" className={!byHours ? 'selected' : ''} onClick={() => setMetric('count')}>Quantidade</button>
      <button type="button" className={byHours ? 'selected' : ''} onClick={() => setMetric('hours')}>Horas lançadas</button>
    </div>
    <div className="report-bars">{sprints.map((item, i) => {
      const total = totalOf(item), change = i > 0 ? variation(total, totalOf(sprints[i - 1])) : null;
      return <div key={item.name} className="report-bar-row report-sprint-row"><span title={item.name}>{shortSprint(item.name)}</span><div className="report-bar-track"><i className="bar-done" style={{ width: `${doneOf(item) / max * 100}%` }} title={`Concluídas: ${format(doneOf(item))}`}/><i className="bar-cancel" style={{ width: `${cancelledOf(item) / max * 100}%` }} title={`Canceladas: ${format(cancelledOf(item))}`}/></div><b>{format(total)}<small className={change === null || change === 0 ? '' : change > 0 ? 'delta-up' : 'delta-down'}>{change === null ? (byHours ? `${item.done + item.cancelled} tarefas` : hoursLabel(item.hours)) : `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}% · ${byHours ? `${item.done + item.cancelled} tarefas` : hoursLabel(item.hours)}`}</small></b></div>;
    })}</div>
    <p className="report-legend"><span><i className="bar-done"/>Concluídas</span><span><i className="bar-cancel"/>Canceladas</span><span>▲▼ variação contra a sprint anterior</span></p>
    <LineChart rows={[]} grain="day" data={time} format={shortSprint} decimals={byHours}/>
  </>;
}
// Mostra a variação contra o período anterior; "invert" vale para métricas em que subir é ruim (canceladas).
function Kpi({ label, value, previous, current, invert = false, hasPrevious }: { label: string; value: string; current: number; previous: number; invert?: boolean; hasPrevious: boolean }) {
  const change = hasPrevious ? variation(current, previous) : null;
  const good = change === null || change === 0 ? '' : (change > 0) !== invert ? 'delta-up' : 'delta-down';
  return <div><b>{value}</b><span>{label}</span>{hasPrevious && <small className={good} title="Comparação com o período anterior, de mesma duração">{change === null ? (current > 0 ? 'novo' : '—') : `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}%`} <em>vs {previous.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</em></small>}</div>;
}
interface JiraReportProps { initialSquad?: string[]; initialIgnored?: string[]; save: (squad: string[], ignored: string[]) => void; initialPeriod?: { jiraPeriod?: number; jiraFrom?: string; jiraTo?: string }; savePeriod: (period: number, from: string, to: string) => void }
// A lista fica no settings.json do app; o localStorage só serve para migrar o que já havia sido salvo.
export const JiraReport = memo(function JiraReport({ initialSquad, initialIgnored, save, initialPeriod, savePeriod }: JiraReportProps) {
  const [squad, setSquad] = useState<string[]>(() => initialSquad ?? loadSquad());
  const [ignored, setIgnored] = useState<string[]>(() => initialSquad ? initialIgnored ?? [] : loadSquad(IGNORED_KEY));
  const [draft, setDraft] = useState('');
  const [days, setDays] = useState(initialPeriod?.jiraPeriod ?? 30);
  const localIso = (offsetDays = 0) => { const now = new Date(); now.setDate(now.getDate() + offsetDays); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
  const [from, setFrom] = useState(() => initialPeriod?.jiraFrom ?? localIso(-30));
  const [to, setTo] = useState(() => initialPeriod?.jiraTo ?? localIso());
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [previousRows, setPreviousRows] = useState<ReportRow[] | null>(null);
  const [grain, setGrain] = useState<'day' | 'week'>('week');
  const [selected, setSelected] = useState<string[]>([]);
  const [kinds, setKinds] = useState<TaskKind[]>([]);
  const [routine, setRoutine] = useState('');
  const [sprint, setSprint] = useState('');
  const [sprintMode, setSprintMode] = useState(false);
  const customFields = useRef<{ routine: string[]; sprint: string[] } | null>(null);
  const parentExtras = useRef(new Map<string, IssueExtras>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const persist = (nextSquad: string[], nextIgnored: string[]) => { setSquad(nextSquad); setIgnored(nextIgnored); save(nextSquad, nextIgnored); };
  const saveSquad = (next: string[]) => persist(next, ignored.filter(name => next.includes(name)));
  const saveIgnored = (next: string[]) => persist(squad, next);
  const active = squad.filter(name => !ignored.includes(name));
  const ordered = [...active, ...squad.filter(name => ignored.includes(name))];
  const addUsers = (value: string) => {
    const names = value.split(/[\s,;]+/).map(name => name.trim()).filter(Boolean);
    if (names.length) saveSquad([...new Set([...squad, ...names])]);
    setDraft('');
  };
  const addMe = async () => {
    try { const me = await window.gitManager.jiraRequest('/rest/api/2/myself') as JiraCurrentUser; if (me.name) saveSquad([...new Set([...squad, me.name])]); }
    catch (e) { setError((e as Error).message); }
  };
  // Os campos "Rotina" e "Sprint" têm ids diferentes em cada Jira; descobre pelo nome uma vez e guarda.
  const discoverFields = async () => {
    if (customFields.current) return customFields.current;
    try {
      const fields = await window.gitManager.jiraRequest('/rest/api/2/field') as { id: string; name: string; schema?: { custom?: string } }[];
      const list = Array.isArray(fields) ? fields : [];
      customFields.current = {
        routine: list.filter(field => /rotina/i.test(field.name)).map(field => field.id),
        sprint: list.filter(field => /^sprint$/i.test(field.name.trim()) || /gh-sprint/i.test(field.schema?.custom ?? '')).map(field => field.id)
      };
    } catch { return { routine: [], sprint: [] }; }
    return customFields.current;
  };
  const search = async (jql: string, fields: string[], startAt: number, maxResults: number) =>
    await window.gitManager.jiraRequest('/rest/api/2/search', 'POST', { jql, startAt, maxResults, fields }) as { issues?: ReportIssue[]; total?: number };
  const fetchRows = async (jql: string, onTruncated?: () => void) => {
    const found = await discoverFields();
    const ids = [...found.routine, ...found.sprint];
    const extrasOf = (issue: ReportIssue): IssueExtras => ({ routines: issueRoutines(issue.fields, found.routine), sprints: issueSprints(issue.fields, found.sprint) });
    const issues: ReportIssue[] = [];
    for (let startAt = 0; startAt < REPORT_MAX_ISSUES; startAt += REPORT_PAGE_SIZE) {
      const page = await search(jql, [...REPORT_FIELDS, ...ids], startAt, REPORT_PAGE_SIZE);
      issues.push(...(page.issues ?? []));
      if (!page.issues?.length || issues.length >= (page.total ?? 0)) break;
      if (startAt + REPORT_PAGE_SIZE >= REPORT_MAX_ISSUES) onTruncated?.();
    }
    // Rotina e sprint ficam na tarefa principal: sub-tarefas sem valor próprio herdam do pai.
    const missing = [...new Set(issues.filter(issue => { const own = extrasOf(issue); return (!own.routines.length || !own.sprints.length) && issue.fields.parent?.key && !parentExtras.current.has(issue.fields.parent.key); }).map(issue => issue.fields.parent!.key))];
    for (let i = 0; i < missing.length; i += REPORT_PARENT_CHUNK) {
      const chunk = missing.slice(i, i + REPORT_PARENT_CHUNK);
      try {
        const page = await search(`key in (${chunk.map(key => `"${key}"`).join(', ')})`, [...ids, 'components'], 0, chunk.length);
        for (const key of chunk) parentExtras.current.set(key, { routines: [], sprints: [] });
        for (const parent of page.issues ?? []) parentExtras.current.set(parent.key, extrasOf(parent));
      } catch { /* sem a tarefa principal, rotina e sprint ficam em branco */ }
    }
    return toReportRows(issues, issue => {
      const own = extrasOf(issue), parent = parentExtras.current.get(issue.fields.parent?.key ?? '');
      return { routines: own.routines.length ? own.routines : parent?.routines ?? [], sprints: own.sprints.length ? own.sprints : parent?.sprints ?? [] };
    });
  };  const load = async () => {
    setBusy(true); setError(''); setTruncated(false);
    savePeriod(days, from, to);
    try {
      const bySprint = days === -1;
      const period = bySprint ? SPRINT_WINDOW_DAYS : days === 0 ? { from, to } : days;
      const current = await fetchRows(buildReportJql(active, period), () => setTruncated(true));
      const span = days === 0 ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : days;
      setGrain(span <= 31 ? 'day' : 'week');
      setSprintMode(bySprint); setRows(current); setSelected([]); setLoaded(true);
      if (bySprint) {
        // Começa pela sprint mais recente; o relatório do período anterior não se aplica a sprints.
        const latest = current.flatMap(row => row.sprints).sort((a, b) => b.start - a.start || b.name.localeCompare(a.name, 'pt-BR'))[0];
        setSprint(previous => current.some(row => row.sprints.some(item => item.name === previous)) ? previous : latest?.name ?? '');
        setPreviousRows(null);
        return;
      }
      // A comparação é um extra: se falhar, o relatório principal continua válido.
      setPreviousRows(await fetchRows(buildReportJql(active, period, true)).catch(() => null));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const sprintOptions = useMemo(() => {
    const map = new Map<string, { name: string; start: number; count: number }>();
    for (const row of rows) if ((!kinds.length || kinds.includes(taskKind(row.type))) && (!selected.length || selected.includes(row.person))) for (const item of row.sprints) map.set(item.name, { ...item, count: (map.get(item.name)?.count ?? 0) + 1 });
    return [...map.values()].sort((a, b) => b.start - a.start || b.name.localeCompare(a.name, 'pt-BR'));
  }, [rows, kinds, selected]);
  // Nome escolhido na lista vale exato; texto parcial digitado filtra por trecho.
  const matchesSprint = (sprints: { name: string }[]) => {
    const query = sprint.trim();
    if (!sprintMode || !query) return true;
    return sprintOptions.some(option => option.name === query) ? sprints.some(item => item.name === query) : sprints.some(item => normalizeText(item.name).includes(normalizeText(query)));
  };
  const byKind = useMemo(() => rows.filter(row => (!kinds.length || kinds.includes(taskKind(row.type))) && matchesRoutine(row.routines, routine) && matchesSprint(row.sprints)), [rows, kinds, routine, sprint, sprintMode, sprintOptions]);
  // Rotinas disponíveis respeitam os filtros de tipo e pessoa, mas não o da própria rotina.
  const routineOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) if ((!kinds.length || kinds.includes(taskKind(row.type))) && (!selected.length || selected.includes(row.person)) && matchesSprint(row.sprints)) for (const name of row.routines) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
  }, [rows, kinds, selected, sprint, sprintMode, sprintOptions]);
  const everyone = useMemo(() => summarizeByPerson(byKind), [byKind]);
  const visible = useMemo(() => selected.length ? byKind.filter(row => selected.includes(row.person)) : byKind, [byKind, selected]);
  const people = useMemo(() => summarizeByPerson(visible), [visible]);
  const totals = useMemo(() => totalsOf(people), [people]);
  const previousTotals = useMemo<ReportTotals>(() => totalsOf(summarizeByPerson((previousRows ?? []).filter(row => (!selected.length || selected.includes(row.person)) && (!kinds.length || kinds.includes(taskKind(row.type))) && matchesRoutine(row.routines, routine)))), [previousRows, selected, kinds, routine]);
  const hasPrevious = previousRows !== null && !sprintMode;
  const chartGrain = sprintMode ? (sprint.trim() ? 'day' : 'week') : grain;
  const peopleMax = Math.max(1, ...people.map(p => p.done + p.cancelled));
  const typeMax = Math.max(1, ...people.map(p => p.coding + p.support + p.ti));
  const hoursMax = Math.max(1, ...people.map(p => p.hours));

  return <div className="report">
    <section className="card report-filters">
      <h2>Squad <small title="Colaboradores ativos no filtro de um total de colaboradores na lista">{active.length} de {squad.length} {squad.length === 1 ? 'colaborador' : 'colaboradores'}</small></h2>
      <div className="report-chips">{ordered.map(name => <span key={name} className={ignored.includes(name) ? 'pill report-ignored' : 'pill'}>{name}<button type="button" aria-label={ignored.includes(name) ? `Desbloquear ${name}` : `Ignorar ${name}` } title={ignored.includes(name) ? 'Desbloquear: volta a entrar no relatório' : 'Ignorar no relatório sem remover da lista'} aria-pressed={ignored.includes(name)} onClick={() => saveIgnored(ignored.includes(name) ? ignored.filter(item => item !== name) : [...ignored, name])}>⛔</button><button type="button" aria-label={`Remover ${name}`} onClick={() => saveSquad(squad.filter(item => item !== name))}>×</button></span>)}{squad.length === 0 && <small>Adicione os usuários do Jira (login) das pessoas da squad.</small>}{squad.length > 0 && active.length === 0 && <small>Todos os usuários estão ignorados.</small>}</div>
      <form className="report-add" onSubmit={event => { event.preventDefault(); addUsers(draft); }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="usuário.jira (separe vários por vírgula)" aria-label="Usuários do Jira"/>
        <button type="submit" disabled={!draft.trim()}>Adicionar</button><button type="button" onClick={() => void addMe()}>Adicionar eu</button><button type="button" disabled={squad.length === 0} onClick={() => saveIgnored(active.length ? [...squad] : [])}>{active.length ? '⛔ Bloquear todos' : 'Desbloquear todos'}</button>
        <select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Período">{periods.map(p => <option key={p.days} value={p.days}>Últimos {p.label}</option>)}<option value={0}>Período personalizado</option><option value={-1}>Por sprint</option></select>
        {days === 0 && <><label className="report-date">De <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)}/></label><label className="report-date">Até <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)}/></label></>}
        <button type="button" className="primary" disabled={busy || active.length === 0} onClick={() => void load()}>{busy ? 'Carregando…' : loaded ? '↻ Atualizar' : 'Gerar relatório'}</button>
      </form>
      <p className="hint">Conta as tarefas “Codificação (Sub-tarefa)”, “Apoio - Cliente” e “Execução de TI (Sub-tarefa)” resolvidas no período, pelo responsável atual. Em “Por sprint”, carrega o último ano da squad e você escolhe a sprint depois de gerar o relatório. Faça login pelo menu Jira se aparecer erro de sessão.</p>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {truncated && <p className="hint">Mostrando as {REPORT_MAX_ISSUES} tarefas mais recentes; reduza o período para ver tudo.</p>}
    {loaded && !error && <>
      <div className="report-chips" aria-label="Filtrar por tipo de tarefa">
        <strong className="report-chips-label">Tipo</strong>
        <button type="button" className={kinds.length === 0 ? 'selected' : ''} onClick={() => setKinds([])}>Todos</button>
        {(Object.keys(TASK_KIND_LABELS) as TaskKind[]).map(kind => <button type="button" key={kind} className={kinds.includes(kind) ? 'selected' : ''} onClick={() => setKinds(current => current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind])}>{TASK_KIND_LABELS[kind]} <small>{rows.filter(row => taskKind(row.type) === kind).length}</small></button>)}
      </div>
      {sprintMode && <div className="report-chips" aria-label="Filtrar por sprint">
        <strong className="report-chips-label">Sprint</strong>
        <input list="report-sprints" className="report-routine-input" value={sprint} onChange={event => setSprint(event.target.value)} placeholder={sprintOptions.length ? `Digite ou escolha entre ${sprintOptions.length} sprints` : 'Nenhuma sprint encontrada nas tarefas'} aria-label="Filtrar por sprint"/>
        <datalist id="report-sprints">{sprintOptions.map(option => <option key={option.name} value={option.name} label={`${option.count} ${option.count === 1 ? 'tarefa' : 'tarefas'}`}/>)}</datalist>
        {sprint && <button type="button" onClick={() => setSprint('')}>Todas as sprints</button>}
      </div>}
      <div className="report-chips" aria-label="Filtrar por rotina">
        <strong className="report-chips-label">Rotina</strong>
        <input list="report-routines" className="report-routine-input" value={routine} onChange={event => setRoutine(event.target.value)} placeholder={routineOptions.length ? `Digite ou escolha entre ${routineOptions.length} rotinas` : 'Nenhuma rotina encontrada no período'} aria-label="Filtrar por rotina"/>
        <datalist id="report-routines">{routineOptions.map(option => <option key={option.name} value={option.name} label={`${option.count} ${option.count === 1 ? 'tarefa' : 'tarefas'}`}/>)}</datalist>
        {routine && <button type="button" onClick={() => setRoutine('')}>Limpar</button>}
      </div>
      <div className="report-chips" aria-label="Filtrar por pessoa">
        <strong className="report-chips-label">Pessoa</strong>
        <button type="button" className={selected.length === 0 ? 'selected' : ''} onClick={() => setSelected([])}>Todos</button>
        {everyone.map(p => <button type="button" key={p.person} className={selected.includes(p.person) ? 'selected' : ''} onClick={() => setSelected(current => current.includes(p.person) ? current.filter(item => item !== p.person) : [...current, p.person])}>{p.person} <small>{p.done + p.cancelled}</small></button>)}
      </div>
      <div className="report-kpis">
        <Kpi label="Concluídas" value={String(totals.done)} current={totals.done} previous={previousTotals.done} hasPrevious={hasPrevious}/>
        <Kpi label="Canceladas" value={String(totals.cancelled)} current={totals.cancelled} previous={previousTotals.cancelled} invert hasPrevious={hasPrevious}/>
        <Kpi label="Codificação" value={String(totals.coding)} current={totals.coding} previous={previousTotals.coding} hasPrevious={hasPrevious}/>
        <Kpi label="Apoio" value={String(totals.support)} current={totals.support} previous={previousTotals.support} hasPrevious={hasPrevious}/>
        <Kpi label="Execução de TI" value={String(totals.ti)} current={totals.ti} previous={previousTotals.ti} hasPrevious={hasPrevious}/>
        <Kpi label="Horas lançadas" value={hoursLabel(totals.hours)} current={totals.hours} previous={previousTotals.hours} hasPrevious={hasPrevious}/>
      </div>
      {sprintMode && <section className="card"><h2>Comparação entre sprints <small>últimas 8, respeitando os filtros de pessoa, tipo e rotina</small></h2><SprintCompare rows={rows.filter(row => (!kinds.length || kinds.includes(taskKind(row.type))) && (!selected.length || selected.includes(row.person)) && matchesRoutine(row.routines, routine))}/></section>}
      <div className="report-grid">
        <section className="card"><h2>Entregas por pessoa</h2><Bars max={peopleMax} rows={people.map(p => ({ label: p.person, parts: [{ value: p.done, className: 'bar-done', title: `Concluídas: ${p.done}` }, { value: p.cancelled, className: 'bar-cancel', title: `Canceladas: ${p.cancelled}` }] }))}/><p className="report-legend"><i className="bar-done"/>Concluídas <i className="bar-cancel"/>Canceladas</p></section>
        <section className="card"><h2>Tipo de tarefa</h2><Bars max={typeMax} rows={people.map(p => ({ label: p.person, parts: [{ value: p.coding, className: 'bar-coding', title: `Codificação: ${p.coding}` }, { value: p.support, className: 'bar-support', title: `Apoio: ${p.support}` }, { value: p.ti, className: 'bar-ti', title: `Execução de TI: ${p.ti}` }] }))}/><p className="report-legend"><span><i className="bar-coding"/>Codificação</span><span><i className="bar-support"/>Apoio</span><span><i className="bar-ti"/>Execução de TI</span></p></section>
        <section className="card"><h2>Horas lançadas</h2><div className="report-bars">{people.map(p => <div key={p.person} className="report-bar-row"><span title={p.person}>{p.person}</span><div className="report-bar-track"><i className="bar-hours" style={{ width: `${p.hours / hoursMax * 100}%` }}/></div><b>{hoursLabel(p.hours)}</b></div>)}</div></section>
        <section className="card"><h2>Entregas por {chartGrain === 'week' ? 'semana' : 'dia'}</h2><LineChart rows={visible} grain={chartGrain}/></section>
        <section className="card"><h2>Rotinas desenvolvidas <small>{routineOptions.length}</small></h2>
          {routineOptions.length === 0 ? <p className="hint">Nenhuma rotina encontrada nas tarefas do período.</p> : <div className="report-bars">{routineOptions.slice(0, 12).map(option => <button type="button" key={option.name} className={`report-bar-row report-routine-row${routine === option.name ? ' selected' : ''}`} title={`Filtrar por ${option.name}`} onClick={() => setRoutine(current => current === option.name ? '' : option.name)}><span>{option.name}</span><div className="report-bar-track"><i className="bar-coding" style={{ width: `${option.count / routineOptions[0].count * 100}%` }}/></div><b>{option.count}</b></button>)}</div>}
          {routineOptions.length > 12 && <p className="hint">Mostrando as 12 mais frequentes; use o filtro Rotina para as demais.</p>}
        </section>
        <section className="card"><h2>Estimado × lançado</h2><EstimateChart people={people}/></section>
      </div>
      <section className="card"><h2>Tarefas ({visible.length})</h2>
        {visible.length === 0 ? <p className="hint">Nenhuma tarefa encontrada.</p> : <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Tarefa</th>{sprintMode && <th>Sprint</th>}<th>Rotina</th><th>Pessoa</th><th>Tipo</th><th>Status</th><th>Dia</th><th>Resolvida</th><th>Horas</th></tr></thead><tbody>{visible.slice(0, 300).map(row => <tr key={row.key}><td><a href={`${JIRA_BASE}/browse/${row.key}`} onClick={event => { event.preventDefault(); void window.gitManager.openReviewLink(`${JIRA_BASE}/browse/${row.key}`); }}>{row.key}</a> {row.summary}</td>{sprintMode && <td>{row.sprints.map(item => item.name).join(', ') || '—'}</td>}<td>{row.routines.join(', ') || '—'}</td><td>{row.person}</td><td>{row.type}</td><td>{row.status}</td><td>{weekdayLabel(row.resolved)}</td><td>{row.resolved.toLocaleDateString('pt-BR')}</td><td>{hoursLabel(row.spentSeconds / 3600)}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
});
