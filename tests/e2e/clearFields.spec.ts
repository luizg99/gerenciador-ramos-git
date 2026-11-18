import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, git } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

// Todo campo de ramo precisa aceitar digitar e apagar tudo: o campo fica vazio e nenhum valor padrão volta sozinho.
async function clears(page: Page, label: string | RegExp, exact = true) {
  const field = page.getByLabel(label, { exact });
  await field.fill('main'); await expect(field).toHaveValue('main');
  await field.fill(''); await expect(field).toHaveValue('');
  await page.waitForTimeout(300); await expect(field).toHaveValue(''); // não é preenchido de novo depois
}

test('campos de ramo: apagar tudo esvazia o campo em todas as telas', async () => {
  const f = await fixture(); const data = path.join(f.root, 'clear-data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [f.root], useAzure: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: /work.*Abrir projeto/ }).click();
  await expect(page.locator('.branch-badge')).toContainText(f.source);

  // Criar / Alterar ramo: troca/criação simples, "a partir de" e criação dinâmica.
  await clears(page, 'Ramo');
  await page.getByLabel('Ramo', { exact: true }).fill('feature/nova-tela');
  await clears(page, 'A partir de');
  await page.getByLabel('Ramo', { exact: true }).fill('');
  await page.getByLabel('Criação dinâmica de ramos').check();
  for (const index of [1, 2, 3, 4]) { await clears(page, `Nome do ramo ${index}`); await clears(page, `A partir de (${index})`); }
  await page.getByLabel('Criação dinâmica de ramos').uncheck();

  // Histórico: campo vazio lê o ramo atual (sem erro) e continua vazio.
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await clears(page, 'Histórico do ramo');
  await page.getByRole('button', { name: 'Carregar histórico' }).click();
  await expect(page.getByRole('button', { name: /Segunda alteração/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Histórico do ramo')).toHaveValue('');

  // Cherry-pick: origem (vem preenchida com o ramo atual) e destinos.
  await page.getByRole('button', { name: 'Cherry-pick', exact: true }).click();
  await expect(page.getByLabel('Ramo de origem', { exact: true })).toHaveValue(f.source);
  await clears(page, 'Ramo de origem');
  await page.getByLabel('Ramo de origem', { exact: true }).fill('main');
  await clears(page, /Destino 1/, false);
  await page.getByLabel(/Destino 1/).fill('main');
  await clears(page, /Destino 2/, false);

  // Pull request (remoto do Azure): origem e destino, nos dois modos.
  await git(f.repo, 'remote', 'set-url', 'origin', 'https://totvstfs.visualstudio.com/Linha-Winthor/_git/VA41-PCSIS4139');
  await page.getByRole('button', { name: 'Criar pull request', exact: true }).click();
  await expect(page.getByLabel('Origem (1)')).toHaveValue(f.source);
  await clears(page, 'Origem (1)'); await clears(page, 'Destino (1)');
  await page.getByLabel('Origem (1)').fill('');
  await page.getByLabel(/PR dinâmico/).uncheck();
  await clears(page, 'Origem (seu ramo)'); await clears(page, 'Destino');
});
