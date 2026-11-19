import { describe, expect, it } from 'vitest';
import { hiddenInputs, impedimentFormBody, isLoginRedirect } from '../src/models/jiraImpediment';

const page = `<form method="post" action="/plugins/servlet/plugintotvs/impediment-classification">
  <select name="classification"><option>Nenhuma das Opções</option></select>
  <textarea name="impediment-comment"></textarea>
  <input type="hidden" name="issue-key" value="DDVENDAS-63754"/>
  <input name='previous-url' type='hidden' value="https://jira.exemplo/browse/DDVENDAS-63754?a=1&amp;b=2">
  <input type="text" name="outro" value="x">
</form>`;

describe('janela Classificar Impedimento', () => {
  it('lê só os campos ocultos, decodificando o HTML', () => {
    expect(hiddenInputs(page)).toEqual({ 'issue-key': 'DDVENDAS-63754', 'previous-url': 'https://jira.exemplo/browse/DDVENDAS-63754?a=1&b=2' });
  });
  it('monta o formulário com a classificação e o comentário escolhidos', () => {
    const body = new URLSearchParams(impedimentFormBody(page, 'DDVENDAS-63754', 'Retorno Suporte', 'aguardando teste', 'https://jira.exemplo'));
    expect(body.get('classification')).toBe('Retorno Suporte');
    expect(body.get('impediment-comment')).toBe('aguardando teste');
    expect(body.get('issue-key')).toBe('DDVENDAS-63754');
  });
  it('completa issue-key e previous-url quando a página não traz', () => {
    const body = new URLSearchParams(impedimentFormBody('<form></form>', 'ABC-1', 'Retorno Cliente', '', 'https://jira.exemplo'));
    expect(body.get('issue-key')).toBe('ABC-1');
    expect(body.get('previous-url')).toBe('https://jira.exemplo/browse/ABC-1');
  });
  it('reconhece redirecionamento para o login', () => {
    expect(isLoginRedirect('https://totvs.fluigidentity.com/ui/login-saml?x=1')).toBe(true);
    expect(isLoginRedirect('https://jira.exemplo/browse/ABC-1')).toBe(false);
    expect(isLoginRedirect(null)).toBe(false);
  });
});
