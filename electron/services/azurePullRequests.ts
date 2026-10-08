import { execFile } from 'node:child_process';
import type { PullRequestInfo } from '../../src/models/domain';
import { z } from 'zod';
import { ref } from '../../src/models/validation';

export const prPairsSchema = z.array(z.object({ source: ref, target: ref })).min(1).max(4);
export interface LocatedPullRequest { source: string; target: string; url: string }
export interface CreatedPullRequests { prs: (LocatedPullRequest & { created: boolean })[]; error?: string }
const authError = 'Não foi possível autenticar a consulta de PRs. Autentique este remoto HTTPS pelo Git Credential Manager e tente novamente. A sessão do navegador ou uma chave SSH, sozinhas, não autenticam a API.';

// Credential output stays only in the main process: never send it to progress, errors or storage.
export function gitAuthorization(repo: string, webUrl: string): Promise<string> {
  const url = new URL(webUrl);
  if (url.protocol !== 'https:') return Promise.reject(new Error('A consulta automática de PRs exige um remoto HTTPS.'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_TRACE|GCM_TRACE)/i.test(key)));
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['credential', 'fill'], { cwd: repo, windowsHide: true, timeout: 30000, maxBuffer: 128 * 1024, env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (error, stdout) => {
      if (error) { reject(new Error(authError)); return; }
      const fields = Object.fromEntries(stdout.split(/\r?\n/).filter(line => line.includes('=')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
      if (fields.authtype?.toLowerCase() === 'bearer' && fields.credential && !/[\r\n]/.test(fields.credential)) { resolve(`Bearer ${fields.credential}`); return; }
      if (!fields.password) { reject(new Error(authError)); return; }
      const token = fields.password;
      resolve(/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? `Bearer ${token}` : `Basic ${Buffer.from(`${fields.username ?? ''}:${token}`).toString('base64')}`);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(`protocol=https\nhost=${url.host}\npath=${url.pathname.slice(1)}\n\n`);
  });
}

const responseSchema = z.object({ value: z.array(z.object({ pullRequestId: z.number().int().positive(), sourceRefName: z.string(), targetRefName: z.string(), status: z.string() })) });
export class AzurePullRequests {
  constructor(private authorization = gitAuthorization, private request: typeof fetch = fetch) {}
  async create(repo: string, info: PullRequestInfo, input: { source: string; target: string }[], describe: (source: string, target: string) => Promise<string>): Promise<CreatedPullRequests> {
    const pairs = prPairsSchema.parse(input);
    if (!info.webUrl || !info.remote) throw new Error('O remoto deste repositório não é do Azure DevOps.');
    const web = new URL(info.webUrl);
    if (web.protocol !== 'https:') throw new Error('A criação automática exige um remoto HTTPS.');
    const marker = web.pathname.indexOf('/_git/');
    const endpoint = `${web.origin}${web.pathname.slice(0, marker)}/_apis/git/repositories/${web.pathname.slice(marker + 6)}/pullrequests`;
    const short = (value: string) => value.startsWith(`${info.remote}/`) ? value.slice(info.remote!.length + 1) : value;
    const normalized = pairs.map(pair => ({ source: short(pair.source), target: short(pair.target) }));
    if (normalized.some(pair => pair.source === pair.target) || new Set(normalized.map(pair => JSON.stringify(pair))).size !== normalized.length) throw new Error('Escolha pares de origem e destino diferentes, sem repetições.');
    const authorization = await this.authorization(repo, info.webUrl);
    const call = async (url: URL, body?: unknown) => {
      let response: Response;
      try { response = await this.request(url, { method: body ? 'POST' : 'GET', headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
      catch { throw new Error('Falha de conexão com o Azure. Tente novamente: PRs já criados serão reutilizados.'); }
      if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) throw new Error('O Azure recusou a autenticação ou a permissão para criar PRs. Verifique o acesso de leitura e escrita pelo Git Credential Manager.');
      if (!response.ok) throw new Error(`O Azure retornou HTTP ${response.status}. Tente novamente para recuperar PRs já criados.`);
      return response.json().catch(() => { throw new Error('Resposta inválida do Azure. Tente novamente para recuperar PRs já criados.'); });
    };
    // Prepare all descriptions before the first write; each range uses the fetched remote branches.
    const prepared = [];
    for (const pair of normalized) {
      const query = new URL(endpoint);
      query.search = new URLSearchParams({ 'api-version': '7.1', 'searchCriteria.sourceRefName': `refs/heads/${pair.source}`, 'searchCriteria.targetRefName': `refs/heads/${pair.target}`, 'searchCriteria.status': 'active', '$top': '2' }).toString();
      const parsed = responseSchema.safeParse(await call(query));
      if (!parsed.success) throw new Error('Resposta inválida ao verificar PRs existentes.');
      const matches = parsed.data.value.filter(pr => pr.sourceRefName === `refs/heads/${pair.source}` && pr.targetRefName === `refs/heads/${pair.target}` && pr.status === 'active');
      if (matches.length > 1) throw new Error(`Há mais de um PR ativo para ${pair.source} → ${pair.target}. Revise no Azure.`);
      const existing = matches[0];
      const description = existing ? '' : await describe(pair.source, pair.target);
      if (!existing && !description.trim()) throw new Error(`Não há commits para criar o PR ${pair.source} → ${pair.target}.`);
      if (description.length > 4000) throw new Error(`As mensagens dos commits de ${pair.source} → ${pair.target} excedem o limite de 4.000 caracteres da descrição do Azure.`);
      prepared.push({ ...pair, existing, description });
    }
    const result: CreatedPullRequests = { prs: [] };
    for (const item of prepared) {
      try {
        let id = item.existing?.pullRequestId;
        if (!id) {
          const url = new URL(endpoint); url.searchParams.set('api-version', '7.1');
          const created = z.object({ pullRequestId: z.number().int().positive(), sourceRefName: z.string(), targetRefName: z.string() }).safeParse(await call(url, { sourceRefName: `refs/heads/${item.source}`, targetRefName: `refs/heads/${item.target}`, title: `${item.source} → ${item.target}`.slice(0, 400), description: item.description, isDraft: false }));
          if (!created.success || created.data.sourceRefName !== `refs/heads/${item.source}` || created.data.targetRefName !== `refs/heads/${item.target}`) throw new Error('Resposta inesperada ao criar PR. Tente novamente para recuperar o resultado.');
          id = created.data.pullRequestId;
        }
        result.prs.push({ source: item.source, target: item.target, url: `${info.webUrl}/pullrequest/${id}`, created: !item.existing });
      } catch (error) { result.error = `${item.source} → ${item.target}: ${(error as Error).message}`; break; }
    }
    return result;
  }
  async find(repo: string, info: PullRequestInfo, input: { source: string; target: string }[]): Promise<LocatedPullRequest[]> {
    const pairs = prPairsSchema.parse(input);
    if (!info.webUrl || !info.remote) throw new Error('O remoto deste repositório não é do Azure DevOps.');
    const web = new URL(info.webUrl);
    if (web.protocol !== 'https:') throw new Error('A consulta automática de PRs exige um remoto HTTPS.');
    const marker = web.pathname.indexOf('/_git/');
    const repository = web.pathname.slice(marker + 6);
    const endpoint = `${web.origin}${web.pathname.slice(0, marker)}/_apis/git/repositories/${repository}/pullrequests`;
    const short = (value: string) => value.startsWith(`${info.remote}/`) ? value.slice(info.remote!.length + 1) : value;
    const normalized = pairs.map(pair => ({ source: short(pair.source), target: short(pair.target) }));
    if (normalized.some(pair => pair.source === pair.target) || new Set(normalized.map(pair => JSON.stringify(pair))).size !== normalized.length) throw new Error('Escolha pares de origem e destino diferentes, sem repetições.');
    const authorization = await this.authorization(repo, info.webUrl);
    const results: LocatedPullRequest[] = [];
    for (const { source, target } of normalized) {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ 'api-version': '7.1', 'searchCriteria.sourceRefName': `refs/heads/${source}`, 'searchCriteria.targetRefName': `refs/heads/${target}`, 'searchCriteria.status': 'active', '$top': '2' }).toString();
      let response: Response;
      try { response = await this.request(url, { headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
      catch { throw new Error('Não foi possível consultar o Azure DevOps. Verifique a conexão e tente novamente.'); }
      if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) throw new Error(authError);
      if (!response.ok) throw new Error(`A consulta de PRs no Azure falhou (HTTP ${response.status}).`);
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new Error('O Azure não retornou uma lista de PRs válida. Verifique a autenticação.');
      const matching = parsed.data.value.filter(pr => pr.sourceRefName === `refs/heads/${source}` && pr.targetRefName === `refs/heads/${target}` && pr.status === 'active');
      if (!matching.length) throw new Error(`PR ainda não encontrado: ${source} → ${target}. Conclua a criação no Azure e clique em “Buscar PRs e gerar mensagem”.`);
      if (matching.length > 1) throw new Error(`Há mais de um PR ativo de ${source} para ${target}. Revise os PRs no Azure antes de gerar a mensagem.`);
      results.push({ source, target, url: `${info.webUrl}/pullrequest/${matching[0].pullRequestId}` });
    }
    return results;
  }
}
