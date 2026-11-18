import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

test('Configurações: o botão "Explicação técnica" abre o resumo técnico de cada tela e fecha', async () => {
  const data = await tempDirectory('technical-guide-');
  await mkdir(data, { recursive: true }); await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await page.getByRole('button', { name: 'Explicação técnica', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Explicação técnica' });
  await expect(dialog).toBeVisible();
  const titles = await dialog.locator('h3').allTextContents();
  expect(titles).toEqual(['Início', 'Criar / Alterar ramo', 'Histórico', 'Alterações e commit', 'Cherry-pick', 'Criar pull request', 'Gemini', 'Jira', 'Relatório jira', 'Seletores do topo (pasta e ramo)', 'Configurações e atualização']);
  await expect(dialog).toContainText('git switch -c');
  await expect(dialog).toContainText('/rest/api/2/search');
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Explicação técnica', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
