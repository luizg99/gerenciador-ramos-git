import { describe, expect, it } from 'vitest';
import { NO_SPRINT, buildHomeBoard, columnIdFor, countMine, filterBySprint, findMove, hasWithoutSprint, sprintJql, sprintOptions, summarizeSprint, type HomeColumn, type HomeIssue } from '../src/models/jiraHome';
import type { SprintRef } from '../src/models/jiraReport';

const status = (name: string, category: string) => ({ name, statusCategory: { key: category } });
const issue = (key: string, state: ReturnType<typeof status>, extra: Partial<HomeIssue['fields']> = {}): HomeIssue => ({ key, fields: { summary: `Resumo ${key}`, issuetype: { name: 'Task' }, status: state, ...extra } });
const used = (board: HomeColumn[]) => board.filter(column => column.cards.length).map(column => column.status);
const column = (board: HomeColumn[], label: string) => board.find(item => item.status === label)!;

describe('quadro da tela inicial', () => {
  it('sempre tem as 8 colunas do quadro do Jira, na ordem, mesmo vazias', () => {
    expect(buildHomeBoard([]).map(item => item.status)).toEqual(['A fazer', 'Em desenvolvimento', 'Pronto pra revisão', 'Em revisão', 'Pronto pra testar', 'Em teste de aceitação', 'Teste concluído', 'Finalizado']);
  });

  it('coloca cada tarefa na coluna certa, juntando status diferentes que o quadro trata como a mesma coluna', () => {
    const cases: [string, string][] = [
      ['Open', 'A fazer'], ['Aberto', 'A fazer'], ['To Do', 'A fazer'], ['A fazer', 'A fazer'],
      ['Em Desenvolvimento', 'Em desenvolvimento'], ['Em Andamento', 'Em desenvolvimento'], ['In Progress', 'Em desenvolvimento'],
      ['Pronto pra revisão', 'Pronto pra revisão'], ['Pronto para Revisão', 'Pronto pra revisão'], ['Em Revisão', 'Em revisão'], ['Code Review', 'Em revisão'],
      ['Pronto pra testar', 'Pronto pra testar'], ['Em Teste de Aceitação', 'Em teste de aceitação'], ['Em teste', 'Em teste de aceitação'],
      ['Teste Concluído', 'Teste concluído'], ['Finalizado', 'Finalizado'], ['Concluído', 'Finalizado'], ['Done', 'Finalizado']
    ];
    for (const [name, label] of cases) {
      const board = buildHomeBoard([issue('A-1', status(name, 'indeterminate'))]);
      expect(used(board), name).toEqual([label]);
    }
    expect(columnIdFor('Aguardando cliente')).toBeNull();
  });

  it('status fora do quadro ganha uma coluna extra, posicionada pela categoria do Jira', () => {
    const board = buildHomeBoard([issue('X-1', status('Aguardando cliente', 'indeterminate')), issue('X-2', status('Open', 'new')), issue('X-3', status('Cancelado', 'done'))]);
    expect(used(board)).toEqual(['A fazer', 'Aguardando cliente', 'Cancelado']);
    expect(board.at(-1)!.status).toBe('Cancelado'); // categoria "concluído" vai para o fim
  });

  it('mostra a sub-tarefa dentro da principal, mesmo quando as duas são do usuário, sem repetir a principal', () => {
    const parent = issue('P-1', status('Em desenvolvimento', 'indeterminate'));
    const child = issue('P-2', status('Aberto', 'new'), { parent: { key: 'P-1', fields: { summary: 'Resumo P-1', status: status('Em desenvolvimento', 'indeterminate') } } });
    for (const issues of [[parent, child], [child, parent]]) {
      const board = buildHomeBoard(issues);
      expect(used(board)).toEqual(['Em desenvolvimento']);
      const cards = column(board, 'Em desenvolvimento').cards;
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ key: 'P-1', mine: true });
      expect(cards[0].children.map(card => card.key)).toEqual(['P-2']);
      expect(countMine(board)).toBe(2);
    }
  });

  it('quando só a sub-tarefa é do usuário, a principal aparece como contexto (não é dele)', () => {
    const board = buildHomeBoard([issue('S-2', status('Aberto', 'new'), { parent: { key: 'S-1', fields: { summary: 'Principal de outra pessoa', status: status('Em teste', 'indeterminate'), issuetype: { name: 'Story' } } } })]);
    expect(used(board)).toEqual(['Em teste de aceitação']);
    const card = column(board, 'Em teste de aceitação').cards[0];
    expect(card).toMatchObject({ key: 'S-1', mine: false, summary: 'Principal de outra pessoa', type: 'Story' });
    expect(card.children[0]).toMatchObject({ key: 'S-2', mine: true });
    expect(countMine(board)).toBe(1);
  });

  it('junta várias sub-tarefas sob a mesma principal e preserva a ordem da consulta', () => {
    const parent = { key: 'M-1', fields: { summary: 'Principal', status: status('Aberto', 'new') } };
    const board = buildHomeBoard([issue('M-3', status('Aberto', 'new'), { parent }), issue('Z-9', status('Aberto', 'new')), issue('M-2', status('Em teste', 'indeterminate'), { parent })]);
    expect(used(board)).toEqual(['A fazer']);
    const cards = column(board, 'A fazer').cards;
    expect(cards.map(card => card.key)).toEqual(['M-1', 'Z-9']);
    expect(cards[0].children.map(card => card.key)).toEqual(['M-3', 'M-2']);
  });

  it('não quebra sem status, sem resumo e com lista vazia', () => {
    expect(used(buildHomeBoard([]))).toEqual([]);
    const board = buildHomeBoard([{ key: 'X-1', fields: {} }]);
    expect(used(board)).toEqual(['Sem status']);
    expect(column(board, 'Sem status').cards[0]).toMatchObject({ key: 'X-1', summary: '', mine: true });
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
    expect(board.flatMap(item => item.cards).find(card => card.key === 'P-1')?.sprint).toBe('Sprint 12');
    expect(sprintOptions(board).map(option => option.name)).toEqual(['Sprint 13', 'Sprint 12']);
    expect(hasWithoutSprint(board)).toBe(true);

    const only13 = filterBySprint(board, 'Sprint 13');
    expect(only13).toHaveLength(board.length); // as colunas do quadro continuam todas visíveis
    expect(only13.flatMap(item => item.cards)[0]).toMatchObject({ key: 'P-1' });
    expect(only13.flatMap(item => item.cards)[0].children.map(card => card.key)).toEqual(['P-2']);
    expect(countMine(only13)).toBe(2); // a principal também é do usuário (sprint 12) e continua como contexto da sub-tarefa

    const only12 = filterBySprint(board, 'Sprint 12');
    expect(only12.flatMap(item => item.cards).map(card => card.key)).toEqual(['P-1']);
    expect(only12.flatMap(item => item.cards)[0].children).toEqual([]);

    expect(filterBySprint(board, NO_SPRINT).flatMap(item => item.cards.map(card => card.key))).toEqual(['P-3']);
    expect(filterBySprint(board, '')).toBe(board);
    expect(used(filterBySprint(board, 'Sprint 99'))).toEqual([]);
  });

  it('acha a transição que leva à coluna, pelo nome do status ou por outro status da mesma coluna', () => {
    const moves = [{ id: '1', name: 'Iniciar', to: { name: 'Em Andamento' } }, { id: '2', name: 'Testar', to: { name: 'Em teste' } }, { id: '3', name: 'Fechar', to: { name: 'Concluído' } }];
    const board = buildHomeBoard([]);
    expect(findMove(moves, column(board, 'Em desenvolvimento'))?.id).toBe('1');
    expect(findMove(moves, column(board, 'Em teste de aceitação'))?.id).toBe('2');
    expect(findMove(moves, column(board, 'Finalizado'))?.id).toBe('3');
    expect(findMove(moves, column(board, 'Em revisão'))).toBeUndefined();
  });
});

describe('progresso da sprint', () => {
  const it2 = (name: string, subtask = false) => ({ fields: { status: { name }, issuetype: { name: 'Task', subtask } } });
  it('conta só tarefas principais por coluna e calcula o % finalizado', () => {
    const result = summarizeSprint([it2('Finalizado'), it2('A fazer'), it2('Em teste de aceitação'), it2('Finalizado'), it2('Finalizado', true)]);
    expect(result.total).toBe(4);
    expect(result.percent).toBe(50);
    expect(result.counts.map(item => item.count)).toEqual([1, 0, 0, 0, 0, 1, 0, 2]);
  });
  it('status fora das colunas aparecem à parte e a soma fecha com o total', () => {
    const result = summarizeSprint([it2('Finalizado'), it2('Cancelado'), it2('Cancelado'), it2('Impedido')]);
    expect(result.others).toEqual([{ status: 'Cancelado', count: 2 }, { status: 'Impedido', count: 1 }]);
    expect(result.counts.reduce((sum, item) => sum + item.count, 0) + result.others.reduce((sum, item) => sum + item.count, 0)).toBe(result.total);
  });
  it('"Comprometido" conta como A fazer', () => {
    expect(columnIdFor('Comprometido')).toBe('a-fazer');
    expect(summarizeSprint([it2('Comprometido'), it2('A fazer')]).counts[0].count).toBe(2);
  });
  it('sprint vazia dá 0% e o nome da sprint é escapado no JQL', () => {
    expect(summarizeSprint([]).percent).toBe(0);
    expect(sprintJql('Sprint "A"')).toContain('sprint = "Sprint \\"A\\""');
  });
});
