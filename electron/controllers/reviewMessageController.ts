import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatReviewMessage, parseJiraIssue, reviewInputSchema, type ReviewInput } from '../../src/models/reviewMessage';
import type { Storage } from '../services/storage';
import type { GitService } from '../services/gitService';

export class ReviewMessageController {
  constructor(private storage: Storage, private git: GitService) {}
  history() { return this.storage.reviewMessages(); }
  async save(repo: string, input: ReviewInput) {
    const parsed = reviewInputSchema.parse(input);
    const issue = parseJiraIssue(parsed.issue);
    const info = await this.git.pullRequestInfo(repo);
    if (!info.webUrl) throw new Error('Este repositório não tem remoto Azure DevOps.');
    const base = new URL(info.webUrl);
    const prs = parsed.prs.map(pr => {
      const url = new URL(pr.url);
      const prefix = `${base.pathname}/pullrequest/`;
      if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) throw new Error('Os links dos PRs devem pertencer ao repositório selecionado.');
      const target = info.remote && pr.target.startsWith(`${info.remote}/`) ? pr.target.slice(info.remote.length + 1) : pr.target;
      return { target, url: `${url.origin}${url.pathname.replace(/\/$/, '')}` };
    });
    if (new Set(prs.map(pr => pr.url)).size !== prs.length) throw new Error('Há links de PR repetidos.');
    const messages = await this.history();
    const existing = messages.find(item => item.repoPath === repo && item.issue?.key === issue?.key && JSON.stringify(item.prs) === JSON.stringify(prs));
    if (existing) return existing;
    const message = { id: randomUUID(), repoPath: repo, repositoryName: path.basename(repo), issue, prs, createdAt: new Date().toISOString() };
    await this.storage.saveReviewMessages([message, ...messages]);
    return message;
  }
  async copy(id: string) {
    const message = (await this.history()).find(item => item.id === id);
    if (!message) throw new Error('Mensagem não encontrada no histórico.');
    return formatReviewMessage(message);
  }
  async updateIssue(id: string, input: string) {
    const issue = parseJiraIssue(input);
    const messages = await this.history();
    const index = messages.findIndex(message => message.id === id);
    if (index < 0) throw new Error('Mensagem não encontrada no histórico.');
    const updated = { ...messages[index], issue };
    messages[index] = updated;
    await this.storage.saveReviewMessages(messages);
    return updated;
  }
}
