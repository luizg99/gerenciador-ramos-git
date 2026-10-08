import { afterEach, expect, it } from 'vitest';
import { build as buildRenderer } from 'vite';
import { build as buildMain } from 'esbuild';
import { _electron as electron, expect as expectUI, type ElectronApplication } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, git } from './helpers';
let desktopApp: ElectronApplication | undefined;
afterEach(async () => { await desktopApp?.close(); desktopApp = undefined; });

it('compila o aplicativo e executa seleção → cherry-pick → push na interface real', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { await buildRenderer({ logLevel: 'warn', mode: 'production' }); }
  finally { process.env.NODE_ENV = previousEnvironment; }
  await buildMain({ entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, external: ['electron'] });
  expect(await readFile('dist/index.html', 'utf8')).toContain('./assets/');
  const f = await fixture(); const data = path.join(f.root, 'desktop-data'); const bin = path.join(f.root, 'bin');
  await mkdir(data); await mkdir(bin);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [f.root] }));
  // An actual executable on PATH exercises the Windows command invocation without installing proprietary dependencies.
  if (process.platform === 'win32') await writeFile(path.join(bin, 'pman.cmd'), '@echo off\r\nif not "%1 %2"=="install -f" exit /b 2\r\necho Dependencias de teste instaladas\r\nexit /b 0\r\n');
  else await writeFile(path.join(bin, 'pman'), '#!/bin/sh\n[ "$1 $2" = "install -f" ] || exit 2\necho dependencies-installed\n', { mode: 0o755 });
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'; env[pathKey] = bin + path.delimiter + (env[pathKey] ?? '');
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data }, timeout: 20000 });
    desktopApp = app;
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(10000);
    await expectUI(page.getByRole('heading', { name: 'Seus projetos', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /work.*Abrir projeto/ }).click();
    await expectUI(page.locator('.branch-badge')).toContainText(f.source);
    await expectUI(page.getByRole('radio')).toHaveCount(3);
    await page.screenshot({ path: '.local/screenshots/switch.png', fullPage: true });
    await page.getByRole('button', { name: 'Histórico', exact: true }).click();
    await page.getByRole('button', { name: /Segunda alteração/ }).click();
    await expectUI(page.locator('.diff')).toContainText('+origem');
    await page.getByRole('button', { name: 'Cherry-pick', exact: true }).click();
    await expectUI(page.getByLabel('Destino 2 · opcional')).toBeDisabled();
    await page.getByLabel('Ramo de origem', { exact: true }).fill(f.source);
    await page.getByRole('button', { name: 'Carregar commits', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Selecionar Primeira alteração' }).check();
    await page.getByLabel('Destino 1 · obrigatório').fill('main');
    await page.getByLabel('Destino 2 · opcional').fill('dev');
    await page.getByRole('button', { name: 'Revisar sequência' }).click();
    await expectUI(page.getByRole('heading', { name: 'Pronto para aplicar e enviar' })).toBeVisible();
    await page.screenshot({ path: '.local/screenshots/cherry-review.png', fullPage: true });
    await page.getByRole('button', { name: 'Aplicar commits e fazer push' }).click();
    await expectUI(page.getByRole('heading', { name: 'Última sequência concluída' })).toBeVisible({ timeout: 30000 });
    await expectUI(page.getByText('Push concluído', { exact: true })).toHaveCount(2);
    expect(await git(f.remote, 'show', 'main:first.txt')).toBe('primeiro');
    expect(await git(f.remote, 'show', 'dev:first.txt')).toBe('primeiro');
    expect(await git(f.remote, 'rev-parse', 'release')).toBe(f.base);
    const isolated = await page.evaluate(() => ({ require: typeof (window as any).require, methods: Object.keys(window.gitManager) }));
    expect(isolated.require).toBe('undefined'); expect(isolated.methods).not.toContain('runGitCommand');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '.local/screenshots/cherry-completed.png', fullPage: true });
    expect(errors).toEqual([]);
  } catch (error) {
    await app?.windows()[0]?.screenshot({ path: '.local/screenshots/desktop-failure.png', fullPage: true }).catch(() => {});
    throw error;
  } finally { await app?.close(); }
}, 90000);
