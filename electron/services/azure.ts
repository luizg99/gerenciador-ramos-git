// Converte a URL do remoto (HTTPS ou SSH) no endereço web do repositório no Azure DevOps.
export function azureRepoWebUrl(remote: string): string | null {
  const ssh = /^(?:ssh:\/\/)?[^@\s/]+@(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)(?::22)?[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/.exec(remote.trim());
  if (ssh) return `https://dev.azure.com/${ssh[2]}/${ssh[3]}/_git/${ssh[4]}`;
  let url: URL;
  try { url = new URL(remote.trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const marker = url.pathname.indexOf('/_git/');
  if (marker < 0) return null;
  const name = url.pathname.slice(marker + '/_git/'.length).split('/')[0];
  if (!name) return null;
  // new URL descarta usuário/senha; só sobra o endereço público.
  return `${url.protocol}//${url.host}${url.pathname.slice(0, marker)}/_git/${name}`;
}
export function pullRequestCreateUrl(webUrl: string, source: string, target: string) {
  return `${webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(source)}&targetRef=${encodeURIComponent(target)}`;
}
