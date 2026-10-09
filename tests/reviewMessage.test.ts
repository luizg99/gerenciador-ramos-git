import { describe, expect, it, vi } from 'vitest';
import { formatReviewMessage, greeting, parseJiraIssue, reviewInputSchema } from '../src/models/reviewMessage';
import { ReviewMessageController } from '../electron/controllers/reviewMessageController';
import { Storage } from '../electron/services/storage';
import { GitService } from '../electron/services/gitService';
import { tempDirectory } from './helpers';

const webUrl = 'https://totvstfs.visualstudio.com/Linha-Winthor/_git/VA41-PCSIS4139';
const prs = [{ target: 'support/37', url: `${webUrl}/pullrequest/870183` }, { target: 'master', url: `${webUrl}/pullrequest/870188` }];
describe('Mensagem de revisão', () => {
  it.each([[5, 59, 'Boa noite'], [6, 0, 'Bom dia'], [12, 0, 'Bom dia'], [12, 1, 'Boa tarde'], [18, 0, 'Boa tarde'], [18, 1, 'Boa noite'], [0, 0, 'Boa noite']])('saudação às %i:%i', (hour, minute, expected) => {
    expect(greeting(new Date(2026, 9, 8, Number(hour), Number(minute), 59))).toBe(expected);
  });
  it('normaliza código ou link do Jira e recusa entradas inválidas', () => {
    const issue = { key: 'DDVENDAS-61611', url: 'https://jiraproducao.totvs.com.br/browse/DDVENDAS-61611' };
    expect(parseJiraIssue(' ddvendas-61611 ')).toEqual(issue);
    expect(parseJiraIssue(`${issue.url}?focusedCommentId=1`)).toEqual(issue);
    expect(parseJiraIssue(' ')).toBeUndefined();
    for (const value of ['DDVENDAS', 'javascript:alert(1)', 'https://other.invalid/browse/DDVENDAS-61611', 'https://jiraproducao.totvs.com.br/browse/<script>']) expect(() => parseJiraIssue(value)).toThrow();
  });
  it('gera texto completo e HTML com a issue clicável, sem expor marcação no texto simples', () => {
    const issue = parseJiraIssue('DDVENDAS-61611');
    const message = formatReviewMessage({ issue, prs }, new Date(2026, 9, 8, 12, 1));
    expect(message.text).toBe(`Boa tarde, tarefa finalizada, disponível para revisão.\n\nIssue do Jira:\n<${issue!.url}|DDVENDAS-61611>\n\nPRs:\n\nsupport/37: ${prs[0].url}\n\nmaster: ${prs[1].url}`);
    expect(message.text).not.toContain(`Issue do Jira:\n${issue!.url}`);
    expect(message.html).toContain(`<a href="${issue!.url}">DDVENDAS-61611</a>`);
    expect(message.text).not.toContain('<a');
    const without = formatReviewMessage({ prs }, new Date(2026, 9, 8, 6));
    expect(without.text).toBe(`Bom dia, tarefa finalizada, disponível para revisão.\n\nPRs:\n\nsupport/37: ${prs[0].url}\n\nmaster: ${prs[1].url}`);
    expect(without.html).not.toContain('Issue do Jira:');
    expect(formatReviewMessage({ prs: [{ target: '<img src=x>', url: prs[0].url }] }).html).toContain('&lt;img src=x&gt;');
  });
  it('não aceita URL de criação, protocolo inseguro ou destino ausente', () => {
    for (const url of ['', 'x', `${webUrl}/pullrequestcreate`, 'javascript:alert(1)', 'https://user:password@example.com/_git/r/pullrequest/1']) expect(reviewInputSchema.safeParse({ issue: '', prs: [{ target: 'main', url }] }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ issue: '', prs: [{ target: '', url: prs[0].url }] }).success).toBe(false);
  });
  it('persiste histórico entre reinícios, agrupa por issue e evita duplicar ao copiar', async () => {
    const root = await tempDirectory('review-'); const storage = new Storage(root); const git = new GitService();
    vi.spyOn(git, 'pullRequestInfo').mockResolvedValue({ webUrl, remote: 'origin', remoteUrl: webUrl, defaultTarget: 'master' });
    const controller = new ReviewMessageController(storage, git);
    const first = await controller.save('C:/repos/VA41-PCSIS4139', { issue: 'ddvendas-61611', prs });
    const restarted = new ReviewMessageController(new Storage(root), git);
    expect(await restarted.history()).toEqual([first]);
    expect((await restarted.save(first.repoPath, { issue: first.issue!.url, prs })).id).toBe(first.id);
    expect(await restarted.history()).toHaveLength(1);
    const second = await restarted.save(first.repoPath, { issue: 'DDVENDAS-61611', prs: [{ target: 'origin/dev', url: `${webUrl}/pullrequest/870201` }] });
    expect(second.prs[0].target).toBe('dev'); expect(await restarted.history()).toHaveLength(2);
    const without = await restarted.save(first.repoPath, { issue: '', prs });
    expect(without.issue).toBeUndefined();
    const copied = await restarted.copy(first.id);
    expect(copied.html).toContain('>DDVENDAS-61611</a>');
    expect(copied.text).toContain(`${greeting()}, tarefa finalizada, disponível para revisão.`);
    await expect(restarted.copy('missing')).rejects.toThrow('não encontrada');
    await expect(restarted.save(first.repoPath, { issue: '', prs: [{ target: 'main', url: 'https://other.invalid/_git/r/pullrequest/1' }] })).rejects.toThrow('repositório selecionado');
    await expect(restarted.save(first.repoPath, { issue: '', prs: [prs[0], prs[0]] })).rejects.toThrow('repetidos');
    expect(await restarted.history()).toHaveLength(3);
    const added = await restarted.updateIssue(without.id, 'ddvendas-70000');
    expect(added.issue?.key).toBe('DDVENDAS-70000');
    expect(added.prs).toEqual(without.prs); expect(added.createdAt).toBe(without.createdAt);
    const reloaded = new ReviewMessageController(new Storage(root), git);
    expect((await reloaded.copy(without.id)).html).toContain('>DDVENDAS-70000</a>');
    await reloaded.updateIssue(without.id, 'https://jiraproducao.totvs.com.br/browse/DDVENDAS-70001');
    expect((await reloaded.copy(without.id)).text).toContain('/browse/DDVENDAS-70001');
    await expect(reloaded.updateIssue(without.id, 'invalid')).rejects.toThrow('válida');
    expect((await reloaded.copy(without.id)).text).toContain('/browse/DDVENDAS-70001');
    await reloaded.updateIssue(without.id, '');
    expect((await reloaded.copy(without.id)).text).not.toContain('browse/');
    expect(await reloaded.history()).toHaveLength(3);
    await expect(reloaded.updateIssue('missing', 'DDVENDAS-1')).rejects.toThrow('não encontrada');
  });
});
