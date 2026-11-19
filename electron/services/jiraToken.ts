// Token de acesso pessoal do Jira (opcional). Fica criptografado pelo Windows (safeStorage) na pasta de dados do app, nunca em
// texto no settings.json, e nunca é enviado para a tela nem escrito em log. Com token, as consultas ao Jira não dependem do login.
import { app, net, safeStorage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JIRA_BASE, isAllowedJiraPath, isAllowedJiraXmlPath } from '../../src/models/jira';
import type { JiraMethod } from '../../src/models/jira';

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
      headers: { Authorization: `Bearer ${token}`, Accept: asText ? 'application/xml,text/xml,*/*' : 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
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
