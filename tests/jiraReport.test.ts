import { describe, expect, it } from 'vitest';
import { buildReportJql, previousRange, routineValues, sprintOfResolution, sprintValues, summarizeBySprint, matchesRoutine, summarizeByPerson, summarizeOverTime, toReportRows, variation, weekStart } from '../src/models/jiraReport';

const issue = (key: string, person: string, type: string, status: string, resolved: string, spent = 3600) =>
  ({ key, fields: { issuetype: { name: type }, status: { name: status }, assignee: { displayName: person }, resolutiondate: resolved, timespent: spent } });

describe('relatório do Jira', () => {
  it('monta o JQL com usuários escapados e período', () => {
    const jql = buildReportJql(['ana', ' ana ', 'b"x'], 30);
    expect(jql).toContain('assignee in ("ana", "b\\"x")');
    expect(jql).toContain('resolved >= -30d');
    expect(jql).toContain('"Codificação (Sub-tarefa)", "Apoio - Cliente"');
    expect(buildReportJql(['ana'], 0)).not.toContain('resolved');
    expect(() => buildReportJql([' '], 30)).toThrow();
  });
  it('resume por pessoa e por semana', () => {
    const rows = toReportRows([
      issue('A-1', 'Ana', 'Codificação (Sub-tarefa)', 'Concluído', '2026-11-10T10:00:00-03:00'),
      issue('A-2', 'Ana', 'Apoio - Cliente', 'Cancelado', '2026-11-12T10:00:00-03:00', 7200),
      issue('A-3', 'Bia', 'Codificação (Sub-tarefa)', 'Done', '2026-11-17T10:00:00-03:00'),
      { key: 'A-4', fields: { status: { name: 'Done' } } }
    ]);
    expect(rows).toHaveLength(3);
    expect(summarizeByPerson(rows)[0]).toMatchObject({ person: 'Ana', done: 1, cancelled: 1, coding: 1, support: 1, hours: 3 });
    expect(weekStart(new Date(2026, 10, 15))).toBe('2026-11-09');
    expect(summarizeOverTime(rows, 'week')).toEqual({ buckets: ['2026-11-09', '2026-11-16'], series: [{ person: 'Ana', values: [2, 0] }, { person: 'Bia', values: [0, 1] }] });
    expect(summarizeOverTime(rows, 'day').buckets).toHaveLength(8);
  });

  it('monta o período anterior e a variação', () => {
    expect(previousRange({ from: '2026-11-10', to: '2026-11-16' })).toEqual({ from: '2026-11-03', to: '2026-11-09' });
    const jql = buildReportJql(['ana'], 7, true);
    expect(jql).toContain('resolved >= -14d AND resolved < -7d');
    expect(buildReportJql(['ana'], { from: '2026-11-10', to: '2026-11-16' }, true)).toContain('resolved >= "2026-11-03" AND resolved <= "2026-11-09 23:59"');
    expect(variation(15, 10)).toBe(50);
    expect(variation(5, 0)).toBeNull();
  });

  it('lê rotinas e sprints nos formatos do Jira', () => {
    expect(routineValues([{ value: 'Rotina 4204' }, 'Rotina 530, Rotina 4204', null])).toEqual(['Rotina 4204', 'Rotina 530']);
    expect(matchesRoutine(['Gestão de Editais'], 'gestao')).toBe(true);
    expect(matchesRoutine(['Gestão de Editais'], 'xyz')).toBe(false);
    const legacy = 'com.atlassian.greenhopper.service.sprint.Sprint@1a[id=9,rapidViewId=2,state=CLOSED,name=Vendas - 2026.11/2,startDate=2026-11-02T10:00:00.000Z,endDate=2026-11-13T10:00:00.000Z]';
    expect(sprintValues([legacy, { name: 'Vendas - 2026.12/1', startDate: '2026-12-01T10:00:00.000Z' }]).map(item => item.name)).toEqual(['Vendas - 2026.11/2', 'Vendas - 2026.12/1']);
    expect(sprintValues(legacy)[0].start).toBeGreaterThan(0);
  });

  it('compara sprints em ordem cronológica', () => {
    const withSprints = (key: string, person: string, status: string, ...sprints: [string, string][]) => ({ ...toReportRows([issue(key, person, 'Codificação (Sub-tarefa)', status, '2026-11-10T10:00:00-03:00')])[0], sprints: sprints.map(([name, start]) => ({ name, start: Date.parse(start), end: 0 })) });
    const { sprints, time } = summarizeBySprint([
      withSprints('A-1', 'Ana', 'Done', ['S2', '2026-11-16']), withSprints('A-2', 'Ana', 'Cancelado', ['S1', '2026-11-02'], ['S2', '2026-11-16']), withSprints('A-3', 'Bia', 'Done', ['S1', '2026-11-02'])
    ]);
    expect(sprints.map(item => [item.name, item.done, item.cancelled])).toEqual([['S1', 1, 1], ['S2', 1, 1]]);
    expect(time.series).toEqual([{ person: 'Ana', values: [1, 2] }, { person: 'Bia', values: [1, 0] }]);
    expect(sprints[1]).toMatchObject({ doneHours: 1, cancelledHours: 1 });
    expect(summarizeBySprint([withSprints('A-1', 'Ana', 'Done', ['S1', '2026-11-02'])], 8, 'hours').time.series).toEqual([{ person: 'Ana', values: [1] }]);
  });

  it('atribui a tarefa à sprint em que foi resolvida', () => {
    const day = 86400000, s1 = { name: 'S1', start: Date.parse('2026-11-02'), end: Date.parse('2026-11-13') }, s2 = { name: 'S2', start: Date.parse('2026-11-16'), end: Date.parse('2026-11-27') };
    expect(sprintOfResolution([s1, s2], new Date(s1.start + 3 * day)).map(item => item.name)).toEqual(['S1']);
    expect(sprintOfResolution([s1, s2], new Date(s2.start + day)).map(item => item.name)).toEqual(['S2']);
    expect(sprintOfResolution([s1, s2], new Date(s2.end + 5 * day)).map(item => item.name)).toEqual(['S2']);
    expect(sprintOfResolution([{ name: 'X', start: 0, end: 0 }], new Date()).map(item => item.name)).toEqual(['X']);
  });
});