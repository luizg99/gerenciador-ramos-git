import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JiraBounds, JiraBrowserState, JiraCurrentUser, JiraFieldMeta, JiraIssue, JiraMethod, JiraTransition, JiraWorklog } from '../models/jira';
import { greeting } from '../models/reviewMessage';
import { JIRA_BASE, parseJiraKey, parsePrLinks, originalEstimateSeconds } from '../models/jira';

type Role = '' | 'coding' | 'support';
type Meta = { fields?: Record<string, JiraFieldMeta> };
type CreateMeta = { projects?: { key: string; issuetypes?: { id: string; name: string; subtask?: boolean; fields?: Record<string, JiraFieldMeta> }[] }[] };
type WorklogDraft = { id: string; timeSpent: string; started: string; comment: string };
const createWorklogDraft = (): WorklogDraft => ({ id: crypto.randomUUID(), timeSpent: '', started: new Date().toISOString(), comment: '' });
const toArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const issuePath = (key: string, suffix = '') => `/rest/api/2/issue/${encodeURIComponent(key)}${suffix}`;
const asText = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
const normalizeIssueType = (issue: JiraIssue) => (issue.fields.issuetype?.name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const isCodingSubtask = (issue: JiraIssue) => normalizeIssueType(issue) === 'codificacao (sub-tarefa)';
const isCancelled = (issue: JiraIssue) => /cancel/i.test(normalizeStatus(issue.fields.status?.name));
const isSupportMain = (issue: JiraIssue) => normalizeIssueType(issue) === 'apoio - cliente';
const isCancelTransition = (transition: JiraTransition) => /cancel|cancelad/i.test(`${transition.name} ${transition.to?.name ?? ''}`);
const normalizeStatus = (status?: string) => (status ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase();
const asDateTime = (value: string) => new Date(value).toISOString().replace(/\.\d{3}Z$/, '.000+0000');
const toDateTimeLocal = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const withDate = (dateValue: string, dateTimeValue: string) => {
  const current = new Date(dateTimeValue);
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day, current.getHours(), current.getMinutes(), current.getSeconds()).toISOString();
};
const formatDate = (value?: string) => value ? new Date(value).toLocaleString('pt-BR') : '';

export function Jira({ active = true }: { active?: boolean }) {
  const [generation, setGeneration] = useState(0);
  return <JiraForm key={generation} active={active} clear={() => setGeneration(value => value + 1)}/>;
}
function JiraForm({ active, clear }: { active: boolean; clear: () => void }) {
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [key, setKey] = useState('');
  const [main, setMain] = useState<JiraIssue>();
  const [currentUser, setCurrentUser] = useState<JiraCurrentUser>();
  const [related, setRelated] = useState<JiraIssue[]>([]);
  const [ignoredRelatedCount, setIgnoredRelatedCount] = useState(0);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [expandedCoding, setExpandedCoding] = useState<Record<string, boolean>>({});
  const [codingSummaries, setCodingSummaries] = useState<Record<string, string>>({});
  const [worklogs, setWorklogs] = useState<Record<string, JiraWorklog[]>>({});
  const [transitions, setTransitions] = useState<Record<string, JiraTransition[]>>({});
  const [editMeta, setEditMeta] = useState<Record<string, Meta>>({});
  const [createMeta, setCreateMeta] = useState<CreateMeta>();
  const [drafts, setDrafts] = useState<Record<string, { timeSpent: string; started: string; comment: string }>>({});
  const [editingWorklog, setEditingWorklog] = useState<string | null>(null);
  const [newWorklogs, setNewWorklogs] = useState<Record<string, WorklogDraft[]>>({});
  const [notes, setNotes] = useState('');
  const [aiText, setAiText] = useState('');
  const [cause, setCause] = useState('');
  const [causeField, setCauseField] = useState('');
  const [closeTargets, setCloseTargets] = useState<Record<string, string>>({});
  const [cancelTargets, setCancelTargets] = useState<Record<string, string>>({});
  const [prs, setPrs] = useState<Record<string, string>>({});
  const [reviewExtra, setReviewExtra] = useState<Record<string, unknown>>({});
  const [codeReviewType, setCodeReviewType] = useState('');
  const [reviewSummary, setReviewSummary] = useState('Code Review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [browserState, setBrowserState] = useState<JiraBrowserState>({ phase: 'loading', message: 'Abrindo Jira…' });
  const [expanded, setExpanded] = useState(false);
  const browser = useRef<HTMLDivElement>(null);
  const reposition = useRef<() => void>(() => {});
  const assigned = related.filter(issue => roles[issue.key]);
  const coding = assigned.filter(issue => roles[issue.key] === 'coding');
  const support = assigned.filter(issue => roles[issue.key] === 'support');
  const reviewType = createMeta?.projects?.find(project => project.key === main?.fields.project?.key)?.issuetypes?.find(type => type.id === codeReviewType);
  const createFieldsForReview = Object.entries(reviewType?.fields ?? {}).filter(([id]) => !['project', 'issuetype', 'summary', 'description', 'assignee', 'reporter', 'parent'].includes(id));
  const reviewNeedsParent = !!reviewType && (reviewType.subtask === true || !!reviewType.fields?.parent);
  useLayoutEffect(() => { reposition.current(); });
  useEffect(() => {
    const unsubscribe = window.gitManager.onJiraState(setBrowserState);
    void window.gitManager.jiraState().then(setBrowserState).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!active) return;
    let frame = 0, last = '';
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = browser.current; if (!el) return;
        const r = el.getBoundingClientRect();
        const bounds = { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(0, r.top)) };
        const value = JSON.stringify(bounds);
        if (value !== last) { last = value; void window.gitManager.jiraView(bounds as JiraBounds).catch(e => setError(e.message)); }
      });
    };
    const observer = new ResizeObserver(resize); reposition.current = resize;
    if (browser.current) observer.observe(browser.current);
    observer.observe(document.body); addEventListener('resize', resize); addEventListener('scroll', resize, true); resize();
    return () => { reposition.current = () => {}; cancelAnimationFrame(frame); observer.disconnect(); removeEventListener('resize', resize); removeEventListener('scroll', resize, true); void window.gitManager.jiraView(null).catch(() => {}); };
  }, [active]);
  const request = async <T,>(path: string, method: JiraMethod = 'GET', body?: unknown) => await window.gitManager.jiraRequest(path, method, body) as T;
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const updateLog = (entry: string) => setLog(current => [...current, entry]);
  const loadIssue = () => action(async () => {
    const issueKey = parseJiraKey(key);
    const loaded = await request<JiraIssue>(`${issuePath(issueKey)}?fields=summary,description,status,issuetype,project,assignee,parent,subtasks,issuelinks,timeoriginalestimate,timetracking`);
    setMain(loaded); setKey(loaded.key); setError(''); setNotice(''); setEditingWorklog(null); setDrafts({});
    setCurrentUser(await request<JiraCurrentUser>('/rest/api/2/myself').catch(() => undefined));
    const subtaskLinks = toArray<any>(loaded.fields.subtasks);
    const subtaskKeys = new Set(subtaskLinks.map((issue: any) => issue.key));
    const links = [...subtaskLinks];
    for (const link of toArray<any>(loaded.fields.issuelinks)) { if (link.inwardIssue) links.push(link.inwardIssue); if (link.outwardIssue) links.push(link.outwardIssue); }
    const unique = [...new Map(links.filter((issue: any) => issue.key !== loaded.key).map((issue: any) => [issue.key, issue])).values()].slice(0, 40);
    const details = await Promise.all(unique.map(async issue => {
      try { return await request<JiraIssue>(`${issuePath(issue.key)}?fields=summary,description,status,issuetype,project,assignee,parent,subtasks,issuelinks,timeoriginalestimate,timetracking`); }
      catch { return issue as JiraIssue; }
    }));
    const supportMain = isSupportMain(loaded);
    setNotice(supportMain ? `Apoio - Cliente ${loaded.key} carregada. As subtarefas são apenas informativas.` : `Tarefa ${loaded.key} carregada. Só as subtarefas do tipo Codificação entram no fluxo.`);
    const codingTasks = details.filter(issue => isCodingSubtask(issue) && !isCancelled(issue));
    const supportSubtasks = supportMain ? details.filter(issue => subtaskKeys.has(issue.key)) : [];
    setRelated(supportMain ? supportSubtasks : codingTasks); setIgnoredRelatedCount(supportMain ? 0 : details.length - codingTasks.length);
    setCodingSummaries(Object.fromEntries(codingTasks.map(issue => [issue.key, issue.fields.summary])));
    const nextRoles: Record<string, Role> = Object.fromEntries(codingTasks.map(issue => [issue.key, 'coding']));
    setExpandedCoding(Object.fromEntries(codingTasks.map(issue => [issue.key, true])));
    setRoles(supportMain ? {} : nextRoles); setNewWorklogs({}); setWorklogs({}); setTransitions({}); setEditMeta({}); setCloseTargets({}); setCancelTargets({}); setLog([]); setConfirm(false);
    const workflowIssues = supportMain ? supportSubtasks : codingTasks;
    const editable = await Promise.all([loaded, ...workflowIssues].map(async issue => {
      const [meta, transitionResult, worklogResult] = await Promise.allSettled([
        request<Meta>(`${issuePath(issue.key)}/editmeta`),
        request<{ transitions?: JiraTransition[] }>(`${issuePath(issue.key)}/transitions`),
        request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`)
      ]);
      const fields = meta.status === 'fulfilled' ? meta.value : { fields: {} };
      const flow = transitionResult.status === 'fulfilled' ? toArray<JiraTransition>(transitionResult.value.transitions) : [];
      const entries = worklogResult.status === 'fulfilled' ? toArray<JiraWorklog>(worklogResult.value.worklogs) : [];
      setEditMeta(current => ({ ...current, [issue.key]: fields }));
      setTransitions(current => ({ ...current, [issue.key]: flow }));
      setWorklogs(current => ({ ...current, [issue.key]: entries }));
      if (!entries.length) setNewWorklogs(current => ({ ...current, [issue.key]: current[issue.key]?.length ? current[issue.key] : [createWorklogDraft()] }));
      const close = flow.find(t => /conclu|finaliz|fech|close|done|resolve/i.test(`${t.name} ${t.to?.name ?? ''}`));
      if (close) setCloseTargets(current => ({ ...current, [issue.key]: close.id }));
      if (supportMain && issue.key !== loaded.key) {
        const cancelOptions = flow.filter(isCancelTransition);
        if (cancelOptions.length === 1) setCancelTargets(current => ({ ...current, [issue.key]: cancelOptions[0].id }));
      }
      return fields;
    }));
    const causeFields = editable.flatMap(meta => Object.entries(meta.fields ?? {}).map(([id, field]) => ({ id, name: field.name })))
      .filter((field, index, all) => /causa|ocorr[eê]ncia/i.test(field.name) && all.findIndex(item => item.id === field.id) === index);
    if (!causeField && causeFields[0]) setCauseField(causeFields[0].id);
    if (loaded.fields.project?.key) {
      const meta = await request<CreateMeta>(`/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(loaded.fields.project.key)}&expand=projects.issuetypes.fields`).catch(() => undefined);
      setCreateMeta(meta);
      const review = meta?.projects?.flatMap(project => project.issuetypes ?? []).find(type => /code review|revis[aã]o de c[oó]digo/i.test(type.name));
      if (review) setCodeReviewType(review.id);
    }
  });
  const pickedTransitions = (issue: JiraIssue) => transitions[issue.key] ?? [];
  const closedTransition = (issue: JiraIssue) => pickedTransitions(issue).find(item => normalizeStatus(item.to?.name) === 'CLOSED' || normalizeStatus(item.name) === 'CLOSED');
  const assigneeIsCurrentUser = (issue: JiraIssue, user = currentUser) => !!user && !!issue.fields.assignee && [user.name, user.key, user.accountId].some(value => !!value && [issue.fields.assignee?.name, issue.fields.assignee?.key, issue.fields.assignee?.accountId].includes(value));
  const codingCanClose = (issue: JiraIssue, user = currentUser) => normalizeStatus(issue.fields.status?.name) === 'EM ANDAMENTO' && assigneeIsCurrentUser(issue, user) && !!closedTransition(issue);
  const cancelOptionsFor = (issue: JiraIssue) => pickedTransitions(issue).filter(isCancelTransition);
  const addWorklog = (issue: JiraIssue, draft: WorklogDraft) => action(async () => {
    if (!draft?.timeSpent.trim()) throw new Error('Informe a duração do LogTime.');
    const body = { timeSpent: draft.timeSpent.trim(), started: asDateTime(draft.started || new Date().toISOString()), comment: draft.comment.trim() };
    const latest = await request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`);
    const currentWorklogs = toArray<JiraWorklog>(latest.worklogs);
    const duplicate = currentWorklogs.some(entry => entry.timeSpent.trim().toLowerCase() === body.timeSpent.toLowerCase()
      && new Date(entry.started).getTime() === new Date(body.started).getTime() && (entry.comment ?? '').trim() === body.comment);
    if (duplicate) {
      setWorklogs(current => ({ ...current, [issue.key]: currentWorklogs }));
      setNewWorklogs(current => ({ ...current, [issue.key]: (current[issue.key] ?? []).filter(item => item.id !== draft.id) }));
      updateLog(`LogTime idêntico já existia em ${issue.key}; não foi duplicado.`);
      return;
    }
    await request(issuePath(issue.key, '/worklog'), 'POST', body);
    const result = await request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`);
    setWorklogs(current => ({ ...current, [issue.key]: toArray<JiraWorklog>(result.worklogs) }));
    setNewWorklogs(current => ({ ...current, [issue.key]: (current[issue.key] ?? []).filter(item => item.id !== draft.id) }));
    updateLog(`LogTime lançado em ${issue.key}.`);
  });
  const editWorklog = (issue: JiraIssue, entry: JiraWorklog) => action(async () => {
    const draft = drafts[`${issue.key}:${entry.id}`] ?? { timeSpent: entry.timeSpent, started: entry.started, comment: entry.comment ?? '' };
    if (!draft.timeSpent.trim() || !draft.started) throw new Error('Informe a duração e a data do LogTime.');
    await request(issuePath(issue.key, `/worklog/${encodeURIComponent(entry.id)}`), 'PUT', { timeSpent: draft.timeSpent, started: asDateTime(draft.started), comment: draft.comment });
    const result = await request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`);
    setWorklogs(current => ({ ...current, [issue.key]: toArray<JiraWorklog>(result.worklogs) }));
    updateLog(`LogTime ${entry.id} atualizado em ${issue.key}.`);
    setEditingWorklog(null);
  });
  const deleteWorklog = (issue: JiraIssue, entry: JiraWorklog) => action(async () => {
    if (!window.confirm(`Excluir o LogTime ${entry.timeSpent} de ${formatDate(entry.started)} da tarefa ${issue.key}?`)) return;
    const latest = await request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`);
    const currentWorklogs = toArray<JiraWorklog>(latest.worklogs);
    if (!currentWorklogs.some(item => item.id === entry.id)) {
      setWorklogs(current => ({ ...current, [issue.key]: currentWorklogs }));
      updateLog(`LogTime ${entry.id} já havia sido removido de ${issue.key}.`);
      return;
    }
    await request(issuePath(issue.key, `/worklog/${encodeURIComponent(entry.id)}`), 'DELETE');
    const result = await request<{ worklogs?: JiraWorklog[] }>(`${issuePath(issue.key)}/worklog?maxResults=1000`);
    const remaining = toArray<JiraWorklog>(result.worklogs);
    setWorklogs(current => ({ ...current, [issue.key]: remaining }));
    setNewWorklogs(current => ({ ...current, [issue.key]: remaining.length || current[issue.key]?.length ? current[issue.key] ?? [] : [createWorklogDraft()] }));
    setDrafts(current => { const next = { ...current }; delete next[`${issue.key}:${entry.id}`]; return next; });
    updateLog(`LogTime ${entry.id} excluído de ${issue.key}.`);
  });
  const supportMain = !!main && isSupportMain(main);
  const expectedStatus = supportMain ? 'EM ANDAMENTO' : 'EM DESENVOLVIMENTO';
  const isInDevelopment = !!main && normalizeStatus(main.fields.status?.name) === expectedStatus;
  const estimatedIssues = main ? [main, ...coding] : [];
  const blockers = main ? [
    ...(!isInDevelopment ? [`A tarefa principal deve estar ${expectedStatus}.`] : []),
    ...(!supportMain && !assigned.length ? ['Nenhuma subtarefa de codificação ativa encontrada.'] : []),
    ...estimatedIssues.filter(issue => originalEstimateSeconds(issue) <= 0 && !(Number.isFinite(Number(estimates[issue.key])) && Number(estimates[issue.key]) > 0)).map(issue => `Informe a estimativa de horas de ${issue.key}.`),
    ...(!aiText.trim() ? ['Preencha o texto da IA para o comentário.'] : []),
    ...(coding.length && !notes.trim() ? ['Preencha as Notes do Gem Dev para a descrição.'] : []),
    ...coding.flatMap(issue => [
      ...(!worklogs[issue.key]?.length ? [`Lance um LogTime em ${issue.key}.`] : []),
      ...(!parsePrLinks(prs[issue.key]).length ? [`Informe os links dos PRs de ${issue.key}.`] : []),
      ...(normalizeStatus(issue.fields.status?.name) !== 'EM ANDAMENTO' ? [`Coloque ${issue.key} em EM ANDAMENTO.`] : []),
      ...(!assigneeIsCurrentUser(issue) ? [`Atribua ${issue.key} ao usuário Jira logado.`] : []),
      ...(!closedTransition(issue) ? [`Verifique a transição para Closed de ${issue.key}.`] : [])
    ]),
    ...support.filter(issue => !worklogs[issue.key]?.length).map(issue => `Lance um LogTime em ${issue.key}.`),
    ...(supportMain && !worklogs[main.key]?.length ? [`Lance um LogTime em ${main.key}.`] : []),
    ...(!closeTargets[main.key] ? ['Escolha a transição de fechamento da tarefa principal.'] : []),
    ...(coding.length && !codeReviewType ? ['Escolha o tipo de tarefa Code Review.'] : []),
    ...(coding.length ? createFieldsForReview.filter(([id, field]) => field.required && !reviewExtra[id]).map(([, field]) => `Preencha ${field.name} na tarefa Code Review.`) : [])
  ] : [];
  const finalReady = !!main && blockers.length === 0;
  const transition = async (issue: JiraIssue) => {
    const selected = roles[issue.key] === 'coding'
      ? closedTransition(issue)
      : pickedTransitions(issue).find(item => item.id === closeTargets[issue.key]);
    if (!selected) throw new Error(`Atualize as transições da tarefa ${issue.key}.`);
    await request(issuePath(issue.key, '/transitions'), 'POST', { transition: { id: selected.id } });
    updateLog(`${issue.key}: ${selected.name}${selected.to ? ` → ${selected.to.name}` : ''}.`);
  };
  const cancelSubtask = (issue: JiraIssue) => action(async () => {
    const selected = pickedTransitions(issue).find(item => item.id === cancelTargets[issue.key] && isCancelTransition(item));
    if (!selected) throw new Error(`Escolha uma transição de cancelamento para ${issue.key}.`);
    if (!window.confirm(`Confirma cancelar a subtarefa ${issue.key} — ${issue.fields.summary}?`)) return;
    await request(issuePath(issue.key, '/transitions'), 'POST', { transition: { id: selected.id } });
    setRelated(current => current.map(item => item.key === issue.key ? { ...item, fields: { ...item.fields, status: { name: selected.to?.name ?? selected.name } } } : item));
    updateLog(`${issue.key}: ${selected.name}${selected.to ? ` → ${selected.to.name}` : ''}.`);
  });
  const addCommentOnce = async (issueKey: string, body: string) => {
    const result = await request<{ comments?: { body?: unknown }[] }>(issuePath(issueKey, '/comment?maxResults=1000'));
    if (toArray<{ body?: unknown }>(result.comments).some(comment => asText(comment.body).trim() === body.trim())) {
      updateLog(`${issueKey}: comentário idêntico já existia; não foi duplicado.`);
      return;
    }
    await request(issuePath(issueKey, '/comment'), 'POST', { body });
    updateLog(`${issueKey}: comentário incluído.`);
  };
  const execute = () => action(async () => {
    if (!main || normalizeStatus(main.fields.status?.name) !== expectedStatus) throw new Error(`O fluxo só pode ser executado quando a tarefa principal estiver ${expectedStatus}.`);
    if (coding.length) {
      const [freshUser, ...freshIssues] = await Promise.all([
        request<JiraCurrentUser>('/rest/api/2/myself'),
        ...coding.map(issue => request<JiraIssue>(`${issuePath(issue.key)}?fields=status,assignee`))
      ]);
      setCurrentUser(freshUser);
      setRelated(current => current.map(issue => {
        const fresh = freshIssues.find(item => item.key === issue.key);
        return fresh ? { ...issue, fields: { ...issue.fields, status: fresh.fields.status, assignee: fresh.fields.assignee } } : issue;
      }));
      const invalid = freshIssues.filter(issue => normalizeStatus(issue.fields.status?.name) !== 'EM ANDAMENTO' || !assigneeIsCurrentUser(issue, freshUser));
      if (invalid.length) throw new Error(`Fechamento bloqueado. Cada tarefa de codificação precisa estar EM ANDAMENTO e atribuída ao usuário Jira logado (${freshUser.displayName ?? freshUser.name ?? freshUser.key ?? 'usuário atual'}): ${invalid.map(issue => `${issue.key} [${issue.fields.status?.name ?? 'sem status'}; ${issue.fields.assignee?.displayName ?? 'sem responsável'}]`).join(', ')}.`);
      const withoutClosedTransition = coding.filter(issue => !closedTransition(issue));
      if (withoutClosedTransition.length) throw new Error(`Não foi encontrada uma transição para Closed em: ${withoutClosedTransition.map(issue => issue.key).join(', ')}.`);
    }
    if (!finalReady) throw new Error('Preencha as informações obrigatórias, confira LogTime, responsável pelos PRs e transições.');
    if (!window.confirm(`Executar o encerramento das tarefas Jira?\n\nCodificação: ${coding.map(i => i.key).join(', ') || 'nenhuma'}\nApoio: ${support.map(i => i.key).join(', ') || 'nenhum'}\nPrincipal: ${main!.key}\n\nO fluxo pode gravar comentários, editar descrições e causa da ocorrência, criar a tarefa Code Review e fechar as tarefas.`)) return;
    setLog([]);
    const freshEstimates = await Promise.all(estimatedIssues.map(issue => request<JiraIssue>(`${issuePath(issue.key)}?fields=timeoriginalestimate,timetracking`)));
    for (const issue of freshEstimates) {
      if (originalEstimateSeconds(issue) > 0) continue;
      const hours = Number(estimates[issue.key]);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error(`Informe a estimativa de horas de ${issue.key}.`);
    }
    for (const issue of freshEstimates) {
      let seconds = originalEstimateSeconds(issue);
      if (seconds <= 0) {
        seconds = Math.max(60, Math.round(Number(estimates[issue.key]) * 60) * 60);
        await request(issuePath(issue.key), 'PUT', { fields: { timetracking: { originalEstimate: `${seconds / 60}m` } } });
        updateLog(`${issue.key}: estimativa original preenchida.`);
      }
      const update = (item: JiraIssue) => item.key === issue.key ? { ...item, fields: { ...item.fields, timeoriginalestimate: seconds } } : item;
      setMain(current => current && update(current)); setRelated(current => current.map(update));
    }
    for (const issue of coding) {
      const description = notes.trim();
      await request(issuePath(issue.key), 'PUT', { fields: { summary: codingSummaries[issue.key]?.trim() || issue.fields.summary, description } });
      updateLog(`${issue.key}: resumo e descrição atualizados.`);
      await addCommentOnce(issue.key, aiText.trim());
    }
    await addCommentOnce(main!.key, aiText.trim());
    if (cause.trim() && causeField) {
      const field = editMeta[main!.key]?.fields?.[causeField];
      if (!field) throw new Error(`O campo de causa selecionado não está disponível em ${main!.key}.`);
      await request(issuePath(main!.key), 'PUT', { fields: { [causeField]: cause.trim() } });
      updateLog(`${main!.key}: campo “${field.name}” atualizado com a causa revisada.`);
    } else updateLog(`${main!.key}: causa opcional não informada; campo não alterado.`);
    for (const issue of coding) await transition(issue);
    let createdKey = '';
    if (coding.length) {
      const projects = createMeta?.projects ?? [];
      const project = projects.find(item => item.key === main!.fields.project?.key);
      const issueType = project?.issuetypes?.find(item => item.id === codeReviewType);
      if (!project || !issueType) throw new Error('O Jira não disponibilizou o tipo de tarefa Code Review no projeto principal.');
      const reviewLabel = `ramos-flow-${main!.key.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const query = `project = ${project.key} AND labels = "${reviewLabel}"`;
      const previous = await request<{ issues?: { key: string }[] }>(`/rest/api/2/search?jql=${encodeURIComponent(query)}&fields=key&maxResults=1`);
      const existingReview = toArray<{ key: string }>(previous.issues)[0];
      if (existingReview) {
        createdKey = existingReview.key;
        updateLog(`Code Review ${createdKey} já existia para ${main!.key}; não foi criada outra.`);
      } else {
        const prLinks = [...new Set(coding.flatMap(issue => parsePrLinks(prs[issue.key])))];
        const created = await request<{ key: string }>('/rest/api/2/issue', 'POST', { fields: {
          project: { key: project.key }, issuetype: { id: issueType.id }, summary: reviewSummary.trim() || `Code Review — ${main!.key}`,
          ...(reviewNeedsParent ? { parent: { key: main!.key } } : {}),
          description: [`Tarefa principal: ${main!.key}`, '', 'Pull requests das tarefas de codificação:', ...prLinks].join('\n'),
          labels: [reviewLabel],
          ...Object.fromEntries(createFieldsForReview.map(([id]) => [id, reviewExtra[id]]).filter(([, value]) => value !== undefined && value !== ''))
        } });
        createdKey = created.key;
        updateLog(`Tarefa de Code Review criada: ${created.key}.`);
      }
    }
    await transition(main!);
    setNotice(createdKey ? `Fluxo concluído. Tarefa de Code Review: ${createdKey}.` : 'Fluxo de apoio concluído; a tarefa principal foi encerrada.');
  });
  const preview = main ? [
    `Tarefa principal: ${main.key} — ${main.fields.summary}`,
    ...(supportMain ? [`Apoio - Cliente: ${worklogs[main.key]?.length ?? 0} LogTime(s) na tarefa principal.`] : []),
    ...coding.flatMap(issue => [`Codificação ${issue.key}: cabeçalho “${codingSummaries[issue.key] ?? issue.fields.summary}”; atualizar descrição com Notes; comentar o texto da IA; ${worklogs[issue.key]?.length ?? 0} LogTime(s); fechar com ${pickedTransitions(issue).find(t => t.id === closeTargets[issue.key])?.name ?? 'transição pendente'}; ${parsePrLinks(prs[issue.key]).length || 'nenhum'} PR(s).`]),
    ...support.flatMap(issue => [`Apoio ${issue.key}: sem etapa de codificação; ${worklogs[issue.key]?.length ?? 0} LogTime(s).`]),
    `Comentário de IA na principal: ${aiText.trim() ? 'sim' : 'pendente'}.`,
    `Causa ${editMeta[main.key]?.fields?.[causeField]?.name ?? '[campo opcional]'}: ${cause.trim() && causeField ? 'será atualizada' : 'não informada; nenhuma alteração será feita'}.`,
    ...(coding.length ? [`Criar tarefa ${codeReviewType ? issueTypeLabel(createMeta, codeReviewType) : 'Code Review'} com os links de PR.`] : []),
    `Fechar principal com ${pickedTransitions(main).find(t => t.id === closeTargets[main.key])?.name ?? 'transição pendente'}.`
  ] : [];
  const copyPrMessage = () => action(async () => {
    if (!main) throw new Error('Carregue a tarefa Jira antes de copiar os PRs.');
    const links = coding.flatMap(issue => parsePrLinks(prs[issue.key]));
    if (!links.length) throw new Error('Não há links de PR informados para copiar.');
    const message = [`${greeting()}, tarefa finalizada, disponível para revisão.`, `Issue do Jira:\n<${JIRA_BASE}/browse/${main.key}|${main.key}>`, 'PRs:', ...new Set(links)].join('\n\n');
    await window.gitManager.copyText(message);
    setNotice('Texto dos PRs copiado. Já pode colar no chat.');
  });
  const causeOptions = main ? Object.entries(editMeta[main.key]?.fields ?? {}).filter(([, field]) => /causa|ocorr[eê]ncia/i.test(field.name)) : [];
  const browserAction = (fn: () => Promise<void>) => action(fn);
  const renderWorklog = (issue: JiraIssue, entry: JiraWorklog) => {
    const id = `${issue.key}:${entry.id}`;
    const editing = editingWorklog === id;
    const draft = drafts[id] ?? { timeSpent: entry.timeSpent, started: entry.started, comment: entry.comment ?? '' };
    const change = (patch: Partial<typeof draft>) => setDrafts(current => ({ ...current, [id]: { ...draft, ...patch } }));
    return <div className="jira-worklog" key={entry.id}>
      <div className="jira-worklog-heading">
        <div><p><strong>{entry.timeSpent}</strong> · {formatDate(entry.started)} · {entry.author?.displayName ?? 'Usuário'}</p>{entry.comment && <p>{entry.comment}</p>}</div>
        <div className="jira-worklog-actions">
          <button className="jira-icon-button" aria-label={`Alterar LogTime ${issue.key} ${entry.id}`} aria-expanded={editing} title="Editar LogTime" disabled={busy} onClick={() => {
            setDrafts(current => ({ ...current, [id]: { timeSpent: entry.timeSpent, started: entry.started, comment: entry.comment ?? '' } }));
            setEditingWorklog(editing ? null : id);
          }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>
          <button className="jira-icon-button danger" aria-label={`Excluir LogTime ${issue.key} ${entry.id}`} title="Excluir LogTime" disabled={busy} onClick={() => void deleteWorklog(issue, entry)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5L4 6m5 4v6m6-6v6"/></svg></button>
        </div>
      </div>
      {editing && <div className="jira-worklog-editor">
        <label className="field"><span>Duração</span><input autoFocus aria-label={`Duração ${issue.key} ${entry.id}`} value={draft.timeSpent} onChange={e => change({ timeSpent: e.target.value })}/></label>
        <label className="field"><span>Data</span><input type="date" aria-label={`Data LogTime ${issue.key} ${entry.id}`} value={toDateTimeLocal(draft.started).slice(0, 10)} onChange={e => change({ started: e.target.value ? withDate(e.target.value, draft.started || entry.started) : '' })}/></label>
        <label className="field jira-worklog-comment"><span>Comentário (opcional)</span><textarea rows={2} aria-label={`Comentário LogTime ${issue.key} ${entry.id}`} value={draft.comment} onChange={e => change({ comment: e.target.value })}/></label>
        <div className="jira-worklog-save"><button className="quiet" disabled={busy} onClick={() => setEditingWorklog(null)}>Cancelar edição</button><button className="primary" disabled={busy || !draft.timeSpent.trim() || !draft.started} onClick={() => void editWorklog(issue, entry)}>Salvar LogTime</button></div>
      </div>}
    </div>;
  };
  return <section className={`jira-layout ${expanded ? 'expanded' : ''}`}>
    {!expanded && <section className="card jira-workflow">
      <div className="card-heading"><div><span className="step-label">ENTREGA · JIRA</span><h2>Encerramento de desenvolvimento</h2><p>Prepare a documentação, confira os tempos e revise a entrega.</p></div><button className="quiet" onClick={() => setExpanded(true)}>Ampliar Jira</button></div>
      <div className="jira-workflow-scroll">
        <label className="jira-search-label" htmlFor="jira-issue-key">Tarefa principal</label>
        <div className="jira-toolbar jira-search"><input id="jira-issue-key" aria-label="Chave da tarefa principal" placeholder="Cole o link ou informe DDVENDAS-61611" value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void loadIssue(); }}/><button className="primary" disabled={busy || !key.trim()} onClick={() => void loadIssue()}>{busy ? 'Aguarde…' : 'Carregar tarefa'}</button><button className="quiet" disabled={busy} onClick={clear}>Limpar tarefa...</button></div>
        <p className="hint">A sessão é independente da autenticação Git. Faça login no painel Jira ao lado antes de carregar uma tarefa.</p>
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        {!main && !busy && <div className="jira-empty"><span aria-hidden="true">☷</span><h3>Comece pela tarefa principal</h3><p>Carregue a tarefa para consultar as subtarefas, registrar LogTimes e preparar o encerramento.</p><small>Você poderá revisar as alterações antes de confirmar o fluxo.</small></div>}
        {main && <>
          <section className="card"><div className="card-heading"><div><h2>{main.key} — {main.fields.summary}</h2><p>{main.fields.issuetype?.name} · {main.fields.status?.name} · {main.fields.assignee?.displayName ?? 'Sem responsável'}</p></div><a href={`${JIRA_BASE}/browse/${encodeURIComponent(main.key)}`} target="_blank" rel="noreferrer">Abrir tarefa ↗</a></div>
            <section aria-label="Estimativas de horas"><h3>Estimativas de horas</h3>{estimatedIssues.map(issue => <label className="jira-field" key={issue.key}><span>Estimativa original — {issue.key} (horas)</span><input type="number" min="0.01" step="any" required aria-label={`Estimativa de horas ${issue.key}`} disabled={busy || originalEstimateSeconds(issue) > 0} value={originalEstimateSeconds(issue) > 0 ? originalEstimateSeconds(issue) / 3600 : estimates[issue.key] ?? ''} onChange={e => setEstimates(current => ({ ...current, [issue.key]: e.target.value }))}/><small>{originalEstimateSeconds(issue) > 0 ? 'Já informada no Jira; não pode ser editada.' : 'Obrigatória. Será salva ao confirmar o fluxo.'}</small></label>)}</section>
            <div className="jira-flow-body" hidden={!isInDevelopment}>
            <div className="jira-flow-summary" aria-label="Resumo da entrega"><span><strong>{supportMain ? 'Apoio ao cliente' : `${coding.length} ${coding.length === 1 ? 'codificação' : 'codificações'}`}</strong>Tipo de entrega</span><span><strong>{Object.values(worklogs).reduce((total, entries) => total + entries.length, 0)}</strong>LogTimes carregados</span><span><strong>{finalReady ? 'Pronta para revisar' : 'Em preparação'}</strong>Situação da entrega</span></div>
            {supportMain && <>
              <h3 className="jira-section">Subtarefas da tarefa de apoio (informativo)</h3>
              <p className="hint">Apoio - Cliente é a tarefa principal. As subtarefas abaixo são exibidas para conferência; cancele as que não deveriam existir.</p>
              {!related.length && <p className="hint">Esta tarefa principal não possui subtarefas.</p>}
              <div className="jira-issue-list">{related.map(issue => {
                const cancelOptions = cancelOptionsFor(issue);
                const alreadyCancelled = /cancel|cancelad/i.test(issue.fields.status?.name ?? '');
                return <div className="jira-related jira-support-subtask" key={issue.key}>
                  <div className="jira-related-heading"><div><strong>{issue.key} — {issue.fields.summary}</strong><small>{issue.fields.issuetype?.name} · {issue.fields.status?.name} · {issue.fields.assignee?.displayName ?? 'Sem responsável'}</small></div><a href={`${JIRA_BASE}/browse/${encodeURIComponent(issue.key)}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${issue.key}`}>↗</a></div>
                  {alreadyCancelled ? <p className="jira-subtask-status">Tarefa já cancelada.</p> : cancelOptions.length ? <div className="jira-cancel-controls"><select aria-label={`Transição de cancelamento ${issue.key}`} value={cancelTargets[issue.key] ?? ''} onChange={e => setCancelTargets(current => ({ ...current, [issue.key]: e.target.value }))}><option value="">Escolha como cancelar</option>{cancelOptions.map(item => <option key={item.id} value={item.id}>{item.name}{item.to ? ` → ${item.to.name}` : ''}</option>)}</select><button className="quiet" disabled={busy || !cancelTargets[issue.key]} onClick={() => void cancelSubtask(issue)}>Cancelar tarefa</button></div> : <p className="jira-subtask-status">O Jira não disponibilizou uma transição de cancelamento para esta tarefa.</p>}
                </div>;
              })}</div>
            </>}
            {!supportMain && <>
            <h3 className="jira-section">Subtarefas de Codificação</h3>
            {!related.length && <p className="hint">Nenhuma tarefa do tipo “Codificação (Sub-tarefa)” encontrada. Os outros tipos são ignorados automaticamente.</p>}
            {!!ignoredRelatedCount && <p className="hint jira-ignored-count">{ignoredRelatedCount} tarefa(s) vinculada(s) de outros tipos ignorada(s) automaticamente.</p>}
            <div className="jira-issue-list">{related.map(issue => <div className="jira-related" key={issue.key}><div className="jira-related-heading"><button className="jira-disclosure" aria-label={`${expandedCoding[issue.key] ? 'Recolher' : 'Expandir'} ${issue.key}`} aria-expanded={!!expandedCoding[issue.key]} onClick={() => setExpandedCoding(current => ({ ...current, [issue.key]: !current[issue.key] }))}>{expandedCoding[issue.key] ? '⌄' : '›'}</button><div><strong>{issue.key} — {issue.fields.summary}</strong><small>{issue.fields.issuetype?.name} · {issue.fields.status?.name} · {issue.fields.assignee?.displayName ?? 'Sem responsável'}<span className="jira-auto-ignore-label">Incluída no fluxo</span></small></div><a href={`${JIRA_BASE}/browse/${encodeURIComponent(issue.key)}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${issue.key}`}>↗</a></div>
                {!!expandedCoding[issue.key] && <div><h4 className="jira-section">LogTime obrigatório — {issue.key}</h4>{worklogs[issue.key]?.map(entry => renderWorklog(issue, entry))}
                  {!worklogs[issue.key]?.length && <p className="inline-warning">Não há LogTime lançado. Lance antes de continuar o encerramento.</p>}
                  <div className="jira-new-worklogs" aria-label={`Novos LogTimes ${issue.key}`}>
                    {(newWorklogs[issue.key] ?? []).map((draft, index) => <div className="jira-toolbar" key={draft.id}>
                      <input aria-label={`Duração novo LogTime ${issue.key} ${index + 1}`} placeholder="Duração (ex.: 1h 30m)" value={draft.timeSpent} onChange={e => setNewWorklogs(current => ({ ...current, [issue.key]: (current[issue.key] ?? []).map(item => item.id === draft.id ? { ...item, timeSpent: e.target.value } : item) }))}/>
                      <input type="date" aria-label={`Data novo LogTime ${issue.key} ${index + 1}`} value={toDateTimeLocal(draft.started).slice(0, 10)} onChange={e => setNewWorklogs(current => ({ ...current, [issue.key]: (current[issue.key] ?? []).map(item => item.id === draft.id ? { ...item, started: withDate(e.target.value, item.started) } : item) }))}/>
                      <input aria-label={`Comentário novo LogTime ${issue.key} ${index + 1}`} placeholder="Descrição do LogTime" value={draft.comment} onChange={e => setNewWorklogs(current => ({ ...current, [issue.key]: (current[issue.key] ?? []).map(item => item.id === draft.id ? { ...item, comment: e.target.value } : item) }))}/>
                      <button disabled={busy || !draft.timeSpent.trim()} onClick={() => void addWorklog(issue, draft)}>Lançar LogTime</button>
                      <button className="quiet" aria-label={`Remover LogTime novo ${issue.key} ${index + 1}`} disabled={busy} onClick={() => setNewWorklogs(current => ({ ...current, [issue.key]: current[issue.key].filter(item => item.id !== draft.id) }))}>Remover</button>
                    </div>)}
                    <button className="quiet" disabled={busy} onClick={() => setNewWorklogs(current => ({ ...current, [issue.key]: [...(current[issue.key] ?? []), createWorklogDraft()] }))}>+ Adicionar LogTime</button>
                  </div>
                  {roles[issue.key] === 'coding' ? <div className="jira-field"><span>Fechamento automático: Closed</span>{!codingCanClose(issue) && <small className="inline-warning">Bloqueado: a tarefa precisa estar EM ANDAMENTO, atribuída ao usuário Jira logado e ter uma transição disponível para Closed.</small>}</div> : <label className="jira-field"><span>Fechar tarefa de apoio</span><select aria-label={`Fechamento ${issue.key}`} value={closeTargets[issue.key] ?? ''} onChange={e => setCloseTargets(current => ({ ...current, [issue.key]: e.target.value }))}><option value="">Escolha a transição</option>{pickedTransitions(issue).map(item => <option key={item.id} value={item.id}>{item.name}{item.to ? ` → ${item.to.name}` : ''}</option>)}</select></label>}
                </div>}
              </div>)}</div>
            </>}
          {!!coding.length && <section className="card"><h3 className="jira-section">Etapas para encerrar as tarefas de codificação</h3>{coding.map(issue => <label className="jira-field" key={`summary-${issue.key}`}><span>1. Cabeçalho da tarefa de codificação — {issue.key}</span><input aria-label={`Cabeçalho da tarefa de codificação ${issue.key}`} value={codingSummaries[issue.key] ?? ''} onChange={e => setCodingSummaries(current => ({ ...current, [issue.key]: e.target.value }))}/><small>Será atualizado no campo Resumo do Jira.</small></label>)}<label className="jira-field"><span>2. Notes do Gem Dev — serão usadas como descrição de cada tarefa de codificação ao confirmar</span><textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)}/></label><label className="jira-field"><span>3. Texto da IA sem Release Notes — será publicado como comentário</span><textarea rows={5} value={aiText} onChange={e => setAiText(e.target.value)}/></label>
            <label className="jira-field"><span>Causa da ocorrência (opcional) — revise antes de salvar</span><select aria-label="Campo causa da ocorrência (opcional)" value={causeField} onChange={e => setCauseField(e.target.value)}><option value="">Não informar causa</option>{causeOptions.map(([id, field]) => <option key={id} value={id}>{field.name}</option>)}</select><textarea aria-label="Texto opcional da causa da ocorrência" rows={4} value={cause} onChange={e => setCause(e.target.value)} placeholder="Opcional. Se não informar, a tarefa não será alterada nesse campo."/></label>
            <label className="jira-field"><span>Tipo de tarefa para code review</span><select value={codeReviewType} onChange={e => setCodeReviewType(e.target.value)}><option value="">Selecione o tipo de tarefa</option>{createMeta?.projects?.find(project => project.key === main.fields.project?.key)?.issuetypes?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label className="jira-field"><span>Resumo da tarefa de code review</span><input value={reviewSummary} onChange={e => setReviewSummary(e.target.value)}/></label>{createFieldsForReview.filter(([, field]) => field.required).map(([id, field]) => <label className="jira-field" key={id}><span>{field.name} (obrigatório)</span><input value={String(reviewExtra[id] ?? '')} onChange={e => setReviewExtra(current => ({ ...current, [id]: e.target.value }))}/></label>)}
            {coding.map(issue => <label className="jira-field" key={`prs-${issue.key}`}><span>Último passo — links dos PRs de {issue.key} (um ou vários)</span><textarea className="jira-pr-links" aria-label={`PRs ${issue.key}`} rows={3} placeholder={'https://.../_git/.../pullrequest/123\nhttps://.../_git/.../pullrequest/456'} value={prs[issue.key] ?? ''} onChange={e => setPrs(current => ({ ...current, [issue.key]: e.target.value }))}/><small>Informe um link por linha. Todos serão incluídos na descrição da tarefa Code Review.</small></label>)}
          </section>}
          {supportMain && <section className="card"><h3 className="jira-section">LogTime da tarefa de apoio — {main.key}</h3>{worklogs[main.key]?.map(entry => renderWorklog(main, entry))}{!worklogs[main.key]?.length && <p className="inline-warning">A tarefa principal ainda não possui LogTime. Lance pelo menos um antes de continuar.</p>}<div className="jira-new-worklogs" aria-label={`Novos LogTimes ${main.key}`}>{(newWorklogs[main.key] ?? []).map((draft, index) => <div className="jira-toolbar" key={draft.id}><input aria-label={`Duração novo LogTime ${main.key} ${index + 1}`} placeholder="Duração (ex.: 1h 30m)" value={draft.timeSpent} onChange={e => setNewWorklogs(current => ({ ...current, [main.key]: (current[main.key] ?? []).map(item => item.id === draft.id ? { ...item, timeSpent: e.target.value } : item) }))}/><input type="date" aria-label={`Data novo LogTime ${main.key} ${index + 1}`} value={toDateTimeLocal(draft.started).slice(0, 10)} onChange={e => setNewWorklogs(current => ({ ...current, [main.key]: (current[main.key] ?? []).map(item => item.id === draft.id ? { ...item, started: withDate(e.target.value, item.started) } : item) }))}/><input aria-label={`Comentário novo LogTime ${main.key} ${index + 1}`} placeholder="Descrição do LogTime" value={draft.comment} onChange={e => setNewWorklogs(current => ({ ...current, [main.key]: (current[main.key] ?? []).map(item => item.id === draft.id ? { ...item, comment: e.target.value } : item) }))}/><button disabled={busy || !draft.timeSpent.trim()} onClick={() => void addWorklog(main, draft)}>Lançar LogTime</button><button className="quiet" aria-label={`Remover LogTime novo ${main.key} ${index + 1}`} disabled={busy} onClick={() => setNewWorklogs(current => ({ ...current, [main.key]: (current[main.key] ?? []).filter(item => item.id !== draft.id) }))}>Remover</button></div>)}<button className="quiet" disabled={busy} onClick={() => setNewWorklogs(current => ({ ...current, [main.key]: [...(current[main.key] ?? []), createWorklogDraft()] }))}>+ Adicionar LogTime</button></div></section>}
          {!coding.length && <section className="card"><h3 className="jira-section">Comentário e causa da tarefa principal</h3><label className="jira-field"><span>Texto da IA sem Release Notes — comentário na tarefa principal</span><textarea rows={5} value={aiText} onChange={e => setAiText(e.target.value)}/></label><label className="jira-field"><span>Causa da ocorrência (opcional) — revise antes de salvar</span><select aria-label="Campo causa da ocorrência (opcional)" value={causeField} onChange={e => setCauseField(e.target.value)}><option value="">Não informar causa</option>{causeOptions.map(([id, field]) => <option key={id} value={id}>{field.name}</option>)}</select><textarea aria-label="Texto opcional da causa da ocorrência" rows={4} value={cause} onChange={e => setCause(e.target.value)} placeholder="Opcional. Se não informar, a tarefa não será alterada nesse campo."/></label></section>}
          <section className="card"><h3 className="jira-section">Transição da tarefa principal</h3><label className="jira-field"><span>Encerrar principal — desenvolvimento concluído</span><select aria-label="Fechamento principal" value={closeTargets[main.key] ?? ''} onChange={e => setCloseTargets(current => ({ ...current, [main.key]: e.target.value }))}><option value="">Escolha a transição</option>{pickedTransitions(main).map(item => <option key={item.id} value={item.id}>{item.name}{item.to ? ` → ${item.to.name}` : ''}</option>)}</select></label></section>
          {coding.length > 0 && <><h3 className="jira-section">Prévia das alterações</h3><ul className="jira-checklist">{preview.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          {log.length > 0 && <section className="card"><h3 className="jira-section">Histórico desta execução</h3><ol className="jira-checklist">{log.map((item, i) => <li key={i}>{item}</li>)}</ol></section>}
          {!!blockers.length && <section className="jira-pending" aria-label="Pendências para revisar"><strong>Para liberar a revisão:</strong><ul>{blockers.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></section>}
          <div className="card-actions"><button className="primary" disabled={busy || !finalReady} onClick={() => { setConfirm(true); if (coding.some(issue => parsePrLinks(prs[issue.key]).length)) void copyPrMessage(); }}>Revisar e encerrar fluxo</button><button className="quiet" disabled={busy || !coding.some(issue => parsePrLinks(prs[issue.key]).length)} onClick={() => void copyPrMessage()}>Copiar texto dos PRs</button></div>
          {confirm && <div className="confirm-discard" role="alertdialog" aria-label="Confirmar encerramento Jira"><p>Revise a prévia acima. O fluxo gravará comentários, atualizará descrições e causas, fechará tarefas e criará a tarefa de Code Review. As alterações já concluídas não são revertidas se uma etapa posterior falhar.</p><div><button onClick={() => setConfirm(false)}>Voltar para revisar</button><button className="primary" disabled={busy} onClick={() => { setConfirm(false); void execute(); }}>Confirmar e executar</button></div></div>}
            </div>
            {!isInDevelopment && <p className="inline-warning">Os campos e ações do fluxo aparecem somente quando a tarefa principal está com status {expectedStatus}.</p>}
          </section>
        </>}
      </div>
    </section>}
    <section className="card jira-browser"><div className="card-heading"><div><h2>Jira da equipe</h2><p>{browserState.message}</p></div><div><button className="quiet" disabled={busy} onClick={() => void browserAction(() => window.gitManager.jiraOpen())}>Abrir Jira</button>{expanded && <button className="quiet" onClick={() => setExpanded(false)}>Mostrar fluxo</button>}</div></div><p className="jira-browser-address" title={browserState.url}>{browserState.url ?? JIRA_BASE}</p><div ref={browser} className="jira-browser-surface" aria-label="Sessão do Jira"/></section>
  </section>;
}

function issueTypeLabel(meta: CreateMeta | undefined, typeId: string) {
  return meta?.projects?.flatMap(project => project.issuetypes ?? []).find(type => type.id === typeId)?.name ?? 'Code Review';
}
