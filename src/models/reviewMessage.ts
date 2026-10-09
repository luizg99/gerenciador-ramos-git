import { z } from 'zod';

const jiraBase = 'https://jiraproducao.totvs.com.br/browse/';
export function parseJiraIssue(input: string): { key: string; url: string } | undefined {
  const value = input.trim();
  if (!value) return undefined;
  let key = value;
  if (/^https?:/i.test(value)) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Informe o código ou o link da issue Jira.'); }
    if (url.origin !== 'https://jiraproducao.totvs.com.br' || url.username || url.password) throw new Error('Use o link do Jira de produção da TOTVS.');
    key = /^\/browse\/([a-z][a-z0-9_]*-\d+)\/?$/i.exec(url.pathname)?.[1] ?? '';
  }
  key = key.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Informe uma issue Jira válida, como DDVENDAS-61611, ou seu link completo.');
  return { key, url: jiraBase + key };
}
export const reviewInputSchema = z.object({
  issue: z.string().max(4096),
  prs: z.array(z.object({
    target: z.string().trim().min(1, 'Preencha o destino de cada PR.').max(4096).refine(value => !/[\r\n\0]/.test(value)),
    url: z.string().trim().url('Cole o link final do PR.').max(8192).refine(value => {
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && /\/_git\/[^/]+\/pullrequest\/[1-9]\d*\/?$/i.test(url.pathname);
      } catch { return false; }
    }, 'Use o link de um PR criado, terminado em /pullrequest/número.')
  })).min(1).max(4)
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export interface ReviewMessage {
  id: string; repoPath: string; repositoryName: string; issue?: { key: string; url: string };
  prs: ReviewInput['prs']; createdAt: string;
}
export function greeting(date = new Date()): string {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 360 && minutes <= 720 ? 'Bom dia' : minutes > 720 && minutes <= 1080 ? 'Boa tarde' : 'Boa noite';
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function formatReviewMessage(message: Pick<ReviewMessage, 'issue' | 'prs'>, date = new Date()) {
  const intro = `${greeting(date)}, tarefa finalizada, disponível para revisão.`;
  // Google Chat's plain-text custom-link syntax renders the Jira key while retaining its URL.
  const text = [intro, ...(message.issue ? [`Issue do Jira:\n<${message.issue.url}|${message.issue.key}>`] : []), 'PRs:', ...message.prs.map(pr => `${pr.target}: ${pr.url}`)].join('\n\n');
  const html = `<div>${escapeHtml(intro)}<br><br>${message.issue ? `Issue do Jira:<br><a href="${escapeHtml(message.issue.url)}">${escapeHtml(message.issue.key)}</a><br><br>` : ''}PRs:<br><br>${message.prs.map(pr => `${escapeHtml(pr.target)}: <a href="${escapeHtml(pr.url)}">${escapeHtml(pr.url)}</a>`).join('<br><br>')}</div>`;
  return { text, html };
}
