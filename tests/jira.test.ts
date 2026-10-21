import { describe, expect, it } from 'vitest';
import { parsePrLinks } from '../src/models/jira';

describe('links dos PRs colados no Jira', () => {
  it('extrai ramos e links sem repetir saudação, issue e títulos', () => {
    const base = 'https://totvstfs.visualstudio.com/Linha-Winthor/_git/MD23-PCSIS2316/pullrequest/';
    const lines = ['support/37.0', 'main', 'release/39.0', 'develop'].map((branch, index) => `${branch}: ${base}${882867 + index}`);
    expect(parsePrLinks(['Boa tarde, tarefa finalizada, disponível para revisão.', 'Issue do Jira:', '<https://jiraproducao.totvs.com.br/browse/DDVENDAS-62915|DDVENDAS-62915>', 'PRs:', ...lines, lines[0]].join('\n\n'))).toEqual(lines);
  });
  it('ignora texto sem PR e aceita link avulso ou formatado', () => {
    const url = 'https://dev.azure.com/team/project/_git/repo/pullrequest/123';
    expect(parsePrLinks('PRs:\ntexto qualquer')).toEqual([]);
    expect(parsePrLinks(`${url}\nmain: <${url}|PR>`)).toEqual([url]);
  });
});
