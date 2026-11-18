import { describe, expect, it } from 'vitest';
import { NO_SPRINT, buildHomeBoard, countMine, filterBySprint, hasWithoutSprint, sprintOptions, type HomeIssue } from '../src/models/jiraHome';
import type { SprintRef } from '../src/models/jiraReport';

const status = (name: string, category: string) => ({ name, statusCategory: { key: category } });
const issue = (key: string, state: ReturnType<typeof status>, extra: Partial<HomeIssue['fields']> = {}): HomeIssue => ({ key, fields: { summary: `Resumo ${key}`, issuetype: { name: 'Task' }, status: state, ...extra } });

describe('quadro da tela inicial', () => {
  it('agrupa por status, de "a fazer" até "em andamento", e ordena os nomes dentro da categoria', () => {
    const board = buildHomeBoard([
      issue('A-1', status('Em revisão', 'indeterminate')), issue('A-2', status('Aberto', 'new')), issue('A-3', status('Em desenvolvimento', 'indeterminate')), issue('A-4', status('Aberto', 'new'))
    ]);
    expect(board.map(column => column.status)).toEqual(['Aberto', 'Em desenvolvimento', 'Em revisão']);
    expect(board[0].cards.map(card => card.key)).toEqual(['A-2', 'A-4']);
  });

  it('mostra a sub-tarefa dentro da principal, mesmo quando as duas são do usuário, sem repetir a principal', () => {
    const parent = issue('P-1', status('Em desenvolvimento', 'indeterminate'));
    const child = issue('P-2', status('Aberto', 'new'), { parent: { key: 'P-1', fields: { summary: 'Resumo P-1', status: status('Em desenvolvimento', 'indeterminate') } } });
    for (const issues of [[parent, child], [child, parent]]) {
      const board = buildHomeBoard(issues);
      expect(board).toHaveLength(1);
      expect(board[0].status).toBe('Em desenvolvimento');
      expect(board[0].cards).toHaveLength(1);
      expect(board[0].cards[0]).toMatchObject({ key: 'P-1', mine: true });
      expect(board[0].cards[0].children.map(card => card.key)).toEqual(['P-2']);
      expect(countMine(board)).toBe(2);
    }
  });

  it('quando só a sub-tarefa é do usuário, a principal aparece como contexto (não é dele)', () => {
    const board = buildHomeBoard([issue('S-2', status('Aberto', 'new'), { parent: { key: 'S-1', fields: { summary: 'Principal de outra pessoa', status: status('Em teste', 'indeterminate'), issuetype: { name: 'Story' } } } })]);
    expect(board).toHaveLength(1);
    expect(board[0].status).toBe('Em teste');
    expect(board[0].cards[0]).toMatchObject({ key: 'S-1', mine: false, summary: 'Principal de outra pessoa', type: 'Story' });
    expect(board[0].cards[0].children[0]).toMatchObject({ key: 'S-2', mine: true });
    expect(countMine(board)).toBe(1);
  });

  it('junta várias sub-tarefas sob a mesma principal e preserva a ordem da consulta', () => {
    const parent = { key: 'M-1', fields: { summary: 'Principal', status: status('Aberto', 'new') } };
    const board = buildHomeBoard([issue('M-3', status('Aberto', 'new'), { parent }), issue('Z-9', status('Aberto', 'new')), issue('M-2', status('Em teste', 'indeterminate'), { parent })]);
    expect(board).toHaveLength(1);
    expect(board[0].cards.map(card => card.key)).toEqual(['M-1', 'Z-9']);
    expect(board[0].cards[0].children.map(card => card.key)).toEqual(['M-3', 'M-2']);
  });

  it('não quebra sem status, sem resumo e com lista vazia', () => {
    expect(buildHomeBoard([])).toEqual([]);
    const board = buildHomeBoard([{ key: 'X-1', fields: {} }]);
    expect(board[0].status).toBe('Sem status');
    expect(board[0].cards[0]).toMatchObject({ key: 'X-1', summary: '', mine: true });
  });

  it('mostra a sprint mais recente de cada tarefa e filtra por sprint, mantendo a principal como contexto', () => {
    const sprints: Record<string, SprintRef[]> = {
      'P-1': [{ name: 'Sprint 11', start: 100, end: 200 }, { name: 'Sprint 12', start: 300, end: 400 }], // passou por duas: vale a mais recente
      'P-2': [{ name: 'Sprint 13', start: 500, end: 600 }], 'P-3': []
    };
    const parent = { key: 'P-1', fields: { summary: 'Principal', status: status('Em desenvolvimento', 'indeterminate') } };
    const board = buildHomeBoard([
      issue('P-1', status('Em desenvolvimento', 'indeterminate')), issue('P-2', status('Aberto', 'new'), { parent }), issue('P-3', status('Aberto', 'new'))
    ], found => sprints[found.key]);
    expect(board.flatMap(column => column.cards).find(card => card.key === 'P-1')?.sprint).toBe('Sprint 12');
    expect(sprintOptions(board).map(option => option.name)).toEqual(['Sprint 13', 'Sprint 12']);
    expect(hasWithoutSprint(board)).toBe(true);

    const only13 = filterBySprint(board, 'Sprint 13');
    expect(only13).toHaveLength(1);
    expect(only13[0].cards[0]).toMatchObject({ key: 'P-1' });
    expect(only13[0].cards[0].children.map(card => card.key)).toEqual(['P-2']);
    expect(countMine(only13)).toBe(2); // a principal também é do usuário (sprint 12) e continua como contexto da sub-tarefa

    const only12 = filterBySprint(board, 'Sprint 12');
    expect(only12[0].cards[0].children).toEqual([]);
    expect(only12.flatMap(column => column.cards.map(card => card.key))).toEqual(['P-1']);

    expect(filterBySprint(board, NO_SPRINT).flatMap(column => column.cards.map(card => card.key))).toEqual(['P-3']);
    expect(filterBySprint(board, '')).toBe(board);
    expect(filterBySprint(board, 'Sprint 99')).toEqual([]);
  });
});
