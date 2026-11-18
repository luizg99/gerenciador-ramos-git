import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture, git } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

test('Ramo atual: troca de ramo pelo topo, avisa quando o ramo não existe e leva à criação com o nome preenchido', async () => {
  const f = await fixture(); const data = path.join(f.root, 'branch-data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [f.root], ui: { dynamicBranches: true } }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: /work.*Abrir projeto/ }).click();
  const badge = page.locator('.branch-badge');
  await expect(badge).toContainText('Ramo atual'); await expect(badge).toContainText(f.source);

  // Troca direta (diretório limpo): escolhe "dev" na lista.
  await page.getByRole('button', { name: 'Trocar de ramo' }).click();
  await expect(page.getByRole('option', { name: /main/ }).first()).toBeVisible();
  await page.getByLabel('Buscar ramo').fill('dev');
  await page.getByRole('option').filter({ has: page.locator('strong', { hasText: /^dev$/ }) }).first().click();
  await expect(badge).toContainText('dev', { timeout: 15000 });
  expect((await git(f.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('dev');

  // Ramo que não existe: avisa, oferece criar e leva à tela de criação (criação dinâmica desmarcada) com o nome digitado.
  await page.getByRole('button', { name: 'Criar / Alterar ramo', exact: true }).click();
  await expect(page.getByLabel(/Criação dinâmica de ramos/)).toBeChecked();
  await page.getByRole('button', { name: 'Trocar de ramo' }).click();
  await page.getByLabel('Buscar ramo').fill('feature/nova-coisa');
  await expect(page.getByRole('alert')).toContainText('O ramo feature/nova-coisa não existe.');
  await page.getByRole('button', { name: 'Criar o ramo “feature/nova-coisa”' }).click();
  await expect(page.getByRole('heading', { name: 'Criar / Alterar ramo', exact: true })).toBeVisible();
  await expect(page.getByLabel(/Criação dinâmica de ramos/)).not.toBeChecked();
  await expect(page.getByLabel('Ramo', { exact: true })).toHaveValue('feature/nova-coisa');
  await expect(page.getByRole('button', { name: 'Criar ramo e trocar →' })).toBeVisible();

  // Nome inválido: só avisa, sem oferecer criar.
  await page.getByRole('button', { name: 'Trocar de ramo' }).click();
  await page.getByLabel('Buscar ramo').fill('nome com espaço');
  await expect(page.getByRole('alert')).toContainText('não é um nome de ramo válido');
  await expect(page.getByRole('button', { name: /Criar o ramo/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Com alterações locais: não troca sozinho; leva à tela de troca com o ramo preenchido para o usuário decidir.
  await writeFile(path.join(f.repo, 'README.md'), 'alterado\n');
  await page.getByRole('button', { name: 'Atualizar', exact: false }).first().click();
  await page.getByRole('button', { name: 'Trocar de ramo' }).click();
  await expect(page.getByText('Há alterações locais')).toBeVisible();
  await page.getByLabel('Buscar ramo').fill('release');
  await page.getByRole('option').filter({ has: page.locator('strong', { hasText: /^release$/ }) }).first().click();
  await expect(page.getByLabel('Ramo', { exact: true })).toHaveValue('release');
  expect((await git(f.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('dev'); // continua no mesmo ramo
});
