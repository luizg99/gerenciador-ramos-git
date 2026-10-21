import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

test('tema global: alterna, salva, restaura ao reabrir e mantém integrações', async () => {
  const data = await tempDirectory('theme-ui-');
  const settingsPath = path.join(data, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ roots: [], useJira: true, useAzure: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  const launch = () => electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBackground = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.getByRole('button', { name: 'Claro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(darkBackground);
  await expect(page.getByRole('button', { name: 'Claro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
  expect(saved).toMatchObject({ theme: 'light', useJira: true, useAzure: true });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Configurações/ }).click();
  const appearance = page.locator('.appearance-setting');
  await expect(appearance.getByRole('button', { name: 'Claro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await appearance.getByRole('button', { name: 'Escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  await expect(page.locator('.sidebar-footer').getByRole('button', { name: 'Escuro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(await readFile(settingsPath, 'utf8')).theme).toBe('dark');
});
