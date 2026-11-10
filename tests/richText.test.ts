import { describe, expect, it } from 'vitest';
import { parsePrLinks } from '../src/models/jira';
import { textToHtml } from '../src/models/richText';

const pr = 'https://totvstfs.visualstudio.com/Linha-Winthor/_git/IA26-PCSIS2621/pullrequest/901108';
const issue = 'https://jiraproducao.totvs.com.br/browse/DDVENDAS-59384';
describe('texto colado com links', () => {
  it('transforma o formato do Google Chat em links clicáveis com o texto legível', () => {
    const html = textToHtml(`Issue do Jira:\n<${issue}|DDVENDAS-59384>\n\nPRs:\n\nmain: <${pr}|IA26-PCSIS2621/pullrequest/901108>`);
    expect(html).toBe(`Issue do Jira:<br><a href="${issue}">DDVENDAS-59384</a><br><br>PRs:<br><br>main: <a href="${pr}">IA26-PCSIS2621/pullrequest/901108</a>`);
  });
  it('deixa links soltos clicáveis, sem a pontuação final, e escapa HTML', () => {
    expect(textToHtml(`veja ${pr}.`)).toBe(`veja <a href="${pr}">IA26-PCSIS2621/pullrequest/901108</a>.`);
    expect(textToHtml('<script>alert(1)</script> & "x"')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(textToHtml('<javascript:alert(1)|clique>')).not.toContain('<a');
  });
  it('o texto guardado continua sendo entendido ao extrair os links dos PRs', () => {
    const stored = `Boa tarde, tarefa finalizada, disponível para revisão.\n\nIssue do Jira:\n<${issue}|DDVENDAS-59384>\n\nPRs:\n\nmain: <${pr}|IA26-PCSIS2621/pullrequest/901108>`;
    expect(parsePrLinks(stored)).toEqual([`main: ${pr}`]);
  });
});
