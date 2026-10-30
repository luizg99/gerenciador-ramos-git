import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './processRunner';
import { gitAuthorization } from './azurePullRequests';

export type CloneSource = 'github' | 'enterprise' | 'url' | 'azure';
export interface RemoteRepository { name: string; cloneUrl: string; project: string }

export function validateCloneUrl(source: CloneSource, value: string) {
  const remote = value.trim();
  if (!remote || /[\x00-\x20]/.test(remote) || remote.startsWith('-')) throw new Error('Informe uma URL de repositório válida.');
  const scp = /^git@([a-z\d.-]+):([\w./-]+)$/i.exec(remote);
  let host: string;
  if (scp) host = scp[1];
  else {
    let url: URL;
    try { url = new URL(remote); } catch { throw new Error('Use uma URL HTTPS ou SSH do repositório.'); }
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname || url.password || source !== 'azure' && url.username || url.search || url.hash) throw new Error('Use uma URL HTTPS ou SSH sem credenciais embutidas.');
    host = url.hostname;
  }
  if (source === 'github' && host.toLowerCase() !== 'github.com') throw new Error('Selecione uma URL de github.com.');
  if (source === 'enterprise' && host.toLowerCase() === 'github.com') throw new Error('Informe a URL do GitHub Enterprise da sua empresa.');
  if (source === 'azure' && !/^(?:(?:ssh\.)?dev\.azure\.com|(?:[a-z\d-]+\.)+visualstudio\.com)$/i.test(host)) throw new Error('Selecione um repositório do Azure DevOps.');
  return remote;
}

export async function cloneRepository(source: CloneSource, remote: string, parent: string, name: string) {
  const url = validateCloneUrl(source, remote);
  const folder = name.trim();
  if (!folder || folder === '.' || folder === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(folder) || folder.endsWith('.') || folder.endsWith(' ')) throw new Error('Informe um nome de pasta válido para o clone.');
  await mkdir(parent, { recursive: true });
  const directory = await realpath(parent);
  if (!(await stat(directory)).isDirectory()) throw new Error('Selecione uma pasta de destino.');
  const destination = path.join(directory, folder);
  if (await stat(destination).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Já existe uma pasta com esse nome no destino.');
  await runProcess('git', ['clone', '--progress', '--', url, destination], directory, undefined, 10 * 60_000);
  return { parent: directory, destination };
}

export async function listAzureRepositories(organizationUrl: string, project: string): Promise<RemoteRepository[]> {
  let base: URL;
  try { base = new URL(organizationUrl.trim()); } catch { throw new Error('Informe a URL da organização no Azure DevOps.'); }
  if (base.protocol !== 'https:' || base.hostname !== 'dev.azure.com' || !/^\/[\w.-]+\/?$/.test(base.pathname) || base.username || base.password || base.search || base.hash) throw new Error('Use uma URL como https://dev.azure.com/sua-organizacao.');
  const projectName = project.trim();
  if (projectName.length > 100 || /[\x00-\x1f/?#]/.test(projectName)) throw new Error('Informe um projeto Azure válido.');
  const endpoint = new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}/${projectName ? `${encodeURIComponent(projectName)}/` : ''}_apis/git/repositories?api-version=7.1`);
  const authorization = await gitAuthorization(process.cwd(), base.href).catch(() => { throw new Error('Não foi possível autenticar no Azure. Configure o acesso HTTPS pelo Git Credential Manager.'); });
  const response = await fetch(endpoint, { headers: { Authorization: authorization, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Não foi possível listar os repositórios do Azure (HTTP ${response.status}).`);
  const body = await response.json() as { value?: { name?: string; remoteUrl?: string; project?: { name?: string } }[] };
  if (!Array.isArray(body.value)) throw new Error('O Azure retornou uma lista de repositórios inválida.');
  return body.value.filter(item => item.name && item.remoteUrl).map(item => ({ name: item.name!, cloneUrl: item.remoteUrl!, project: item.project?.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listGitHubRepositories(source: 'github' | 'enterprise', enterpriseUrl = ''): Promise<RemoteRepository[]> {
  let base: URL;
  try { base = new URL(source === 'github' ? 'https://github.com' : enterpriseUrl.trim()); }
  catch { throw new Error('Informe a URL do GitHub Enterprise.'); }
  if (base.protocol !== 'https:' || !base.hostname || base.pathname !== '/' || base.username || base.password || base.search || base.hash || source === 'github' && base.hostname !== 'github.com' || source === 'enterprise' && base.hostname === 'github.com') throw new Error('Informe apenas o endereço HTTPS do servidor GitHub Enterprise.');
  const endpoint = source === 'github' ? 'https://api.github.com/user/repos' : base.hostname.endsWith('.ghe.com') ? `https://api.${base.hostname}/user/repos` : `${base.origin}/api/v3/user/repos`;
  const authorization = await gitAuthorization(process.cwd(), base.href).catch(() => { throw new Error('Não foi possível autenticar no GitHub. Configure o acesso HTTPS pelo Git Credential Manager.'); });
  const repositories: RemoteRepository[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('per_page', '100'); url.searchParams.set('page', String(page));
    const response = await fetch(url, { headers: { Authorization: authorization, Accept: 'application/vnd.github+json', 'User-Agent': 'gerenciador-de-ramos' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Não foi possível listar os repositórios do GitHub (HTTP ${response.status}).`);
    const body = await response.json() as { full_name?: string; clone_url?: string; name?: string; owner?: { login?: string } }[];
    if (!Array.isArray(body)) throw new Error('O GitHub retornou uma lista de repositórios inválida.');
    repositories.push(...body.filter(item => item.clone_url && item.name).map(item => ({ name: item.full_name ?? item.name!, cloneUrl: item.clone_url!, project: item.owner?.login ?? '' })));
    if (body.length < 100) break;
  }
  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
