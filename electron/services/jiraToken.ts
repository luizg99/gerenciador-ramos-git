// Token de acesso pessoal do Jira (opcional). Fica criptografado pelo Windows (safeStorage) na pasta de dados do app, nunca em
// texto no settings.json, e nunca é enviado para a tela nem escrito em log. Com token, as consultas ao Jira não dependem do login.
import { app, net, safeStorage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JIRA_BASE, isAllowedImpedimentPath, isAllowedJiraPath, isAllowedJiraXmlPath } from '../../src/models/jira';
import type { JiraMethod } from '../../src/models/jira';
import { IMPEDIMENT_PAGE, impedimentFormBody, isLoginRedirect } from '../../src/models/jiraImpediment';

const file = () => path.join(app.getPath('userData'), 'jira-token.bin');
let cached: string | null | undefined;

// Só guarda em cache o que é definitivo (token lido, ou arquivo inexistente). Falha de leitura/criptografia tenta de novo na próxima chamada.
export async function getJiraToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  let raw: Buffer;
  try { raw = await readFile(file()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') cached = null; return null; }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try { cached = safeStorage.decryptString(raw); } catch { return null; }
  return cached;
}
// O token guardado foi recusado pelo Jira (venceu ou foi revogado): a tela de Configurações avisa e as consultas caem para o login.
export class TokenRefusedError extends Error {}
let refused = false;
export const isJiraTokenRefused = () => refused;
export async function saveJiraToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O Windows não permitiu guardar o token com segurança neste computador.');
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), safeStorage.encryptString(token));
  cached = token; refused = false;
}
export async function clearJiraToken(): Promise<void> { await rm(file(), { force: true }); cached = null; refused = false; }

// Consulta com o token (Bearer). Mesmas regras de caminho da consulta pela sessão; redirecionamento = token recusado (o Jira manda para o login).
export async function jiraTokenRequest(token: string, requestPath: string, method: JiraMethod = 'GET', body?: unknown, asText = false): Promise<unknown> {
  if (!(asText ? isAllowedJiraXmlPath(requestPath) : isAllowedJiraPath(requestPath))) throw new Error('Caminho do Jira não permitido.');
  let response: Response;
  try {
    response = await net.fetch(`${JIRA_BASE}${requestPath}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${token}`, Accept: asText ? 'application/xml,text/xml,*/*' : 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check', Origin: JIRA_BASE }, // sem o Origin o anti-CSRF do Jira recusa os POST ("XSRF check failed")
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch { throw new Error('Não foi possível falar com o Jira pelo token. Verifique a conexão.'); }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status >= 300 && response.status < 400) { refused = true; throw new TokenRefusedError(`Jira respondeu HTTP ${response.status || 302}: o token foi recusado ou expirou. Gere outro no Jira e atualize em Configurações.`); }
  refused = false;
  const raw = await response.text();
  if (!response.ok) throw new Error(`Jira respondeu HTTP ${response.status}: ${raw.slice(0, 500)}`);
  if (asText) {
    if (!/^\s*<(\?xml|rss)/i.test(raw)) throw new Error('O Jira não devolveu o XML da issue.');
    if (raw.length > 5000000) throw new Error('O XML da issue é grande demais para copiar.');
    return raw;
  }
  try { return raw ? JSON.parse(raw) : null; } catch { throw new Error('O Jira retornou uma resposta inesperada.'); }
}

// Lê (GET) a página da janela de impedimento, com o token. Só esse caminho é aceito.
export async function jiraTokenPage(token: string, requestPath: string): Promise<string> {
  if (!isAllowedImpedimentPath(requestPath)) throw new Error('Caminho do Jira não permitido.');
  let response: Response;
  try { response = await net.fetch(`${JIRA_BASE}${requestPath}`, { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { Authorization: `Bearer ${token}`, Accept: 'text/html,*/*', Origin: JIRA_BASE } }); }
  catch { throw new Error('Não foi possível falar com o Jira pelo token. Verifique a conexão.'); }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status >= 300 && response.status < 400) { refused = true; throw new TokenRefusedError(`Jira respondeu HTTP ${response.status || 302}: o token foi recusado ou expirou.`); }
  const raw = await response.text();
  if (!response.ok) throw new Error(`Jira respondeu HTTP ${response.status}.`);
  if (raw.length > 2000000) throw new Error('A página do Jira é grande demais.');
  return raw;
}

// Coloca o flag pela mesma janela do Jira ("Classificar Impedimento"): lê a página (campos ocultos) e envia o formulário, como o navegador.
export async function jiraTokenAddImpediment(token: string, issueKey: string, classification: string, comment: string): Promise<void> {
  const page = await jiraTokenPage(token, `${IMPEDIMENT_PAGE}?issueKeys=${encodeURIComponent(issueKey)}`);
  const body = impedimentFormBody(page, issueKey, classification, comment, JIRA_BASE);
  let response: Response;
  try {
    response = await net.fetch(`${JIRA_BASE}${IMPEDIMENT_PAGE}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(45000), body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,*/*', 'X-Atlassian-Token': 'no-check', Origin: JIRA_BASE, Referer: `${JIRA_BASE}${IMPEDIMENT_PAGE}?issueKeys=${encodeURIComponent(issueKey)}` }
    });
  } catch { throw new Error('Não foi possível falar com o Jira pelo token. Verifique a conexão.'); }
  if (response.status === 401 || response.status === 403) throw new Error(`Jira respondeu HTTP ${response.status} ao enviar a classificação do impedimento.`);
  // O plugin responde com redirecionamento de volta para a tarefa; redirecionamento para o login = não valeu.
  if (response.type !== 'opaqueredirect' && response.status >= 300 && response.status < 400 && isLoginRedirect(response.headers.get('location'))) { refused = true; throw new TokenRefusedError('Jira respondeu com o login: o token foi recusado ou expirou.'); }
  if (response.type !== 'opaqueredirect' && !response.ok && !(response.status >= 300 && response.status < 400)) throw new Error(`Jira respondeu HTTP ${response.status} ao enviar a classificação do impedimento.`);
}
