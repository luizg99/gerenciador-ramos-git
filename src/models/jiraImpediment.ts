// Janela "Classificar Impedimento" do Jira da equipe: é uma página do plugin da TOTVS que recebe um formulário (POST) e grava o flag,
// a classificação e o comentário numa operação só. O app lê a página (para pegar os campos ocultos de segurança) e devolve o formulário preenchido.
import { IMPEDIMENT_PAGE } from './jira';

const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Campos <input type="hidden"> da página (nome → valor), na ordem em que aparecem.
export function hiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']?hidden\b/i.test(tag)) continue;
    const name = /\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i.exec(tag);
    if (!name) continue;
    const value = /\bvalue\s*=\s*"([^"]*)"|\bvalue\s*=\s*'([^']*)'/i.exec(tag);
    result[decode(name[1] ?? name[2] ?? '')] = decode(value?.[1] ?? value?.[2] ?? '');
  }
  return result;
}

// Corpo do POST: os campos ocultos da página + a classificação e o comentário escolhidos.
export function impedimentFormBody(html: string, issueKey: string, classification: string, comment: string, jiraBase: string): string {
  const params = new URLSearchParams(hiddenInputs(html));
  if (!params.get('issue-key')) params.set('issue-key', issueKey);
  if (!params.get('previous-url')) params.set('previous-url', `${jiraBase}/browse/${issueKey}`);
  params.set('classification', classification);
  params.set('impediment-comment', comment);
  return params.toString();
}
export { IMPEDIMENT_PAGE };

// Redirecionamento do POST: ok se voltou para o próprio Jira; login/SSO = sessão ou token não valeu.
export const isLoginRedirect = (location: string | null): boolean => !!location && /login|fluigidentity|samlrequest|sso/i.test(location);
