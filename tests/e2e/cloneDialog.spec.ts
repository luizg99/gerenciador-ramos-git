import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let application: ElectronApplication;
test.afterEach(async () => { if (application) await application.close(); });

test('clonagem abre em modal a partir de Seus projetos', async () => {
  const root = await tempDirectory('clone-dialog-');
  const data = path.join(root, 'data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [root], useAzure: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  const page = await application.firstWindow();
  await expect(page.getByRole('heading', { name: 'Seus projetos' })).toBeVisible();
  const open = page.locator('.page-heading-top').getByRole('button', { name: /Clonar repositório/ });
  await expect(open).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Clonar repositório' })).toHaveCount(0);
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Clonar repositório' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'GitHub.com' })).toHaveAttribute('aria-selected', 'true');
  const localPath = dialog.getByLabel('Caminho local');
  await expect(localPath).toHaveValue(`${root}${path.sep}`);
  await dialog.getByPlaceholder('https://github.com/usuario/repositorio.git').fill('https://github.com/equipe/exemplo.git');
  await expect(localPath).toHaveValue(path.join(root, 'exemplo'));
  await localPath.fill(path.join(root, 'nome-personalizado'));
  await expect(localPath).toHaveValue(path.join(root, 'nome-personalizado'));
  await expect(dialog.getByText('Pasta do clone', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Escolher pasta…' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Azure Repos' }).click();
  await expect(dialog.getByPlaceholder('https://dev.azure.com/minha-organizacao')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('sem pasta de projetos, sugere Documents\\GitHub', async () => {
  const root = await tempDirectory('clone-default-');
  const data = path.join(root, 'data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  const documents = await application.evaluate(({ app }) => app.getPath('documents'));
  const page = await application.firstWindow();
  await page.locator('.page-heading-top').getByRole('button', { name: /Clonar repositório/ }).click();
  await expect(page.getByRole('dialog', { name: 'Clonar repositório' }).getByLabel('Caminho local'))
    .toHaveValue(`${path.join(documents, 'GitHub')}${path.sep}`);
});
