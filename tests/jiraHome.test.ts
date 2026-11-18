import { describe, expect, it } from 'vitest';
import { buildHomeBoard, countMine, type HomeIssue } from '../src/models/jiraHome';

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
});
