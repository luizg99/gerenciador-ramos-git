import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';
let app: ElectronApplication;
test.afterEach(async () => { await app?.close(); });

test('Gemini: aguarda a rota do Gem após passagem temporária pela página inicial', async () => {
  const data = await tempDirectory('gemini-route-');
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useGemini: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  await app.evaluate(async ({ session }) => {
    (globalThis as any).gemLoads = 0;
    await session.fromPartition('persist:team-gemini').protocol.handle('https', () => {
      (globalThis as any).gemLoads++;
      return new Response(`<html><body>
        <script>
          history.replaceState(null, '', '/app');
          setTimeout(() => {
            history.replaceState(null, '', '/gem/3bf604e9d2f3');
            document.querySelector('[role=textbox]').contentEditable = 'true';
          }, 400);
        </script>
        <rich-textarea><div role="textbox" contenteditable="false" style="min-height:120px"></div></rich-textarea>
        <button aria-label="Enviar" onclick="document.body.dataset.sent='yes'">Enviar</button>
      </body></html>`, { headers: { 'content-type': 'text/html' } });
    });
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByText('Gem Dev aberto.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir Gem', exact: true }).click();
  await expect(page.getByText('Gem Dev aberto.', { exact: false })).toBeVisible();
  await page.getByLabel('Código e Nome').fill('Teste de navegação');
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await app.evaluate(() => (globalThis as any).gemLoads)).toBe(3);
});

test('Gemini: formulário, nova conversa, preenchimento e isolamento do navegador', async ({}, testInfo) => {
  const data = await tempDirectory('gemini-ui-');
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useGemini: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  // A controlled HTTPS page exercises the real WebContentsView without a Google account.
  await app.evaluate(async ({ session }) => {
    (globalThis as any).geminiTestOccupied = false;
    await session.fromPartition('persist:team-gemini').protocol.handle('https', request => {
      if (request.url.includes('/gem/') && ((globalThis as any).geminiRedirectOnce || (globalThis as any).geminiRedirectAlways)) {
        (globalThis as any).geminiRedirectOnce = false;
        return new Response(null, { status: 302, headers: { location: 'https://gemini.google.com/u/2/app' } });
      }
      return new Response(`<!doctype html>
      <html lang="pt-BR"><body style="background:#131314;color:#ddd;font:16px sans-serif;padding:30px">
      <h1>Gem da equipe — página de teste</h1>
      <rich-textarea><div class="ql-editor" role="textbox" contenteditable="${(globalThis as any).geminiTestWaiting ? 'false' : 'true'}" style="white-space:pre-wrap;border:1px solid #777;padding:16px;min-height:160px">${(globalThis as any).geminiTestOccupied ? 'Rascunho existente' : ''}</div><div class="ql-clipboard" contenteditable="true" tabindex="-1" style="position:absolute;left:-100000px;width:0;height:1px;overflow:hidden"></div></rich-textarea>
      <button aria-label="Enviar" onclick="document.body.dataset.sent='yes'">Enviar</button>
      ${(globalThis as any).geminiTestSpacing ? '<script>document.querySelector("[contenteditable]").addEventListener("input", e => { e.target.innerText = e.target.innerText.replace(/\\n/g, "\\n\\n"); }, { once: true });</script>' : ''}
      ${(globalThis as any).geminiTestTamper ? '<script>document.querySelector("[contenteditable]").addEventListener("input", e => { e.target.textContent += "CONTEUDO DIFERENTE"; }, { once: true });</script>' : ''}
      </body></html>`, { headers: { 'content-type': 'text/html' } });
    });
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gemini', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar Gem', exact: true })).toBeDisabled();
  await page.getByLabel('Código e Nome').fill('Rotina 4204');
  await page.getByLabel('Número da Issue').fill('<issue>ABC-123</issue>');
  await page.getByRole('button', { name: '2 Dados técnicos', exact: true }).click();
  await expect(page.getByLabel('Versão Gerada')).toBeFocused();
  await page.getByLabel('Alterações Efetuadas').fill('Corrigida a busca.\nPreservar acentuação e <xml>.');
  await expect(page.getByRole('progressbar', { name: 'Campos preenchidos' })).toHaveAttribute('value', '3');
  for (const theme of ['Claro', 'Escuro']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'Claro' ? 'light' : 'dark');
    await page.getByRole('button', { name: '1 Identificação', exact: true }).click();
    await expect(page.getByLabel('Código e Nome')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`gemini-${theme}.png`) });
    expect(await page.locator('.gemini-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 700));
  await expect.poll(() => page.locator('.gemini-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gemini-compacto.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
  await page.getByRole('button', { name: 'Ver texto completo' }).click();
  await expect(page.locator('.gemini-preview')).toContainText('<issue>ABC-123</issue>');
  await expect(page.locator('.gemini-preview')).not.toContainText('PCCLIENT');
  await page.getByRole('button', { name: 'Copiar texto', exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Corrigida a busca.');
  const remote = async (code: string) => app.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://gemini.google.com/'))!;
    return contents.executeJavaScript(script);
  }, code);
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  const text = await remote('document.querySelector("[contenteditable]").innerText');
  expect(text).toContain('<issue>ABC-123</issue>');
  expect(text).toContain('Preservar acentuação e <xml>.');
  expect(await remote('document.body.dataset.sent')).toBe('yes');
  expect(await remote('document.querySelector(".ql-clipboard").textContent')).toBe('');
  expect(await remote('typeof window.gitManager')).toBe('undefined');
  expect(await remote('typeof require')).toBe('undefined');
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('document.querySelector("[contenteditable]").innerText')).toBe(text);
  await page.getByRole('button', { name: 'Ampliar navegador', exact: true }).click();
  await expect(page.locator('.gemini-document')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar formulário', exact: true }).click();
  await page.getByRole('button', { name: 'Editar campos', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('gemini-form.png'), fullPage: true });
  await page.getByRole('button', { name: /Configurações/ }).click();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible())).toBe(false);
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByLabel('Número da Issue')).toHaveValue('<issue>ABC-123</issue>');
  await app.evaluate(() => { (globalThis as any).geminiTestOccupied = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Esta página já contém texto', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('document.querySelector("[contenteditable]").innerText')).toBe('Rascunho existente');
  await app.evaluate(() => { (globalThis as any).geminiTestOccupied = false; (globalThis as any).geminiTestWaiting = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gerar Gem', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByText('Preenchimento cancelado ao sair da aba.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar Gem', exact: true })).toBeEnabled();
  await app.evaluate(() => { (globalThis as any).geminiTestWaiting = false; (globalThis as any).geminiRedirectOnce = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('location.href')).toBe('https://gemini.google.com/u/2/gem/3bf604e9d2f3');
  expect(await remote('document.querySelector("[contenteditable]").innerText')).toBe(text);
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('location.href')).toBe('https://gemini.google.com/u/2/gem/3bf604e9d2f3');
  await app.evaluate(() => { (globalThis as any).geminiTestSpacing = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('document.body.dataset.sent')).toBe('yes');
  await app.evaluate(() => { (globalThis as any).geminiTestSpacing = false; });
  await app.evaluate(() => { (globalThis as any).geminiTestTamper = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('não conferiu integralmente', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('document.body.dataset.sent')).toBeUndefined();
  await app.evaluate(() => { (globalThis as any).geminiTestTamper = false; });
  await app.evaluate(() => { (globalThis as any).geminiRedirectAlways = true; });
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('O texto não foi preenchido.', { exact: false })).toBeVisible({ timeout: 15000 });
  expect(await remote('document.querySelector("[contenteditable]").innerText')).toBe('');
  await page.evaluate(() => { window.confirm = () => false; });
  await page.getByRole('button', { name: 'Limpar todos os campos' }).click();
  await expect(page.getByLabel('Número da Issue')).toHaveValue('<issue>ABC-123</issue>');
  await page.evaluate(() => { window.confirm = () => true; });
  await page.getByRole('button', { name: 'Limpar todos os campos' }).click();
  await expect(page.getByLabel('Número da Issue')).toHaveValue('');
  await expect(page.getByRole('progressbar', { name: 'Campos preenchidos' })).toHaveAttribute('value', '0');
  await expect(page.getByRole('button', { name: 'Gerar Gem', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByLabel('Código e Nome')).toHaveValue('');
});

test('Gemini: navegação cancelada não aparece como falha de acesso', async () => {
  const data = await tempDirectory('gemini-aborted-');
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useGemini: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  await app.evaluate(async ({ session }) => {
    await session.fromPartition('persist:team-gemini').protocol.handle('https', () => new Response('<rich-textarea><div role="textbox" contenteditable="true" style="min-height:120px"></div></rich-textarea><button aria-label="Enviar" onclick="document.body.dataset.sent=\'yes\'">Enviar</button>', { headers: { 'content-type': 'text/html' } }));
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.getByText('Gem Dev aberto.', { exact: false })).toBeVisible();
  const abortNextNavigation = async () => app.evaluate(({ webContents }) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://gemini.google.com/'))!;
    const load = contents.loadURL.bind(contents);
    (contents as any).loadURL = async (url: string) => { (contents as any).loadURL = load; throw new Error(`ERR_ABORTED (-3) loading '${url}'`); };
  });
  await abortNextNavigation();
  await page.getByRole('button', { name: 'Reabrir Gem' }).click();
  await expect(page.getByText('ERR_ABORTED')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reabrir Gem' }).click();
  await expect(page.getByText('Gem Dev aberto.', { exact: false })).toBeVisible();
  await page.getByLabel('Código e Nome').fill('Rotina 4204');
  await abortNextNavigation();
  await page.getByRole('button', { name: 'Gerar Gem', exact: true }).click();
  await expect(page.getByText('Texto enviado ao Gem Dev.', { exact: false })).toBeVisible({ timeout: 15000 });
});
