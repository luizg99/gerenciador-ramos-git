import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from '../helpers';

test('o controle de seleção não cobre o início das linhas do diff', async () => {
  const f = await fixture();
  const data = path.join(f.root, 'diff-data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [f.root] }));
  const longLine = `begin${'x'.repeat(400)}`;
  await writeFile(path.join(f.repo, 'README.md'), `${longLine}\nvar\nend;\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /work.*Abrir projeto/ }).click();
    await page.getByRole('button', { name: 'Alterações e commit', exact: true }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    const row = page.locator('.diff-line.added').filter({ hasText: 'begin' }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('.code')).toHaveText(`+${longLine}`);
    const diff = page.locator('.diff');
    expect(await diff.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    for (const zoom of [1, 1.25, 1.5]) {
      await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      for (const scroll of [0, 120, 300]) {
        await diff.evaluate((element, value) => { element.scrollLeft = value; }, scroll);
        const bounds = await row.evaluate(element => {
          const slot = element.querySelector('.diff-action-slot')!.getBoundingClientRect();
          const code = element.querySelector('.code')!.getBoundingClientRect();
          return { slotRight: slot.right, codeLeft: code.left };
        });
        expect(bounds.slotRight).toBeLessThanOrEqual(bounds.codeLeft + 0.5);
      }
    }
  } finally { await app.close(); }
});

test('exibe linhas do diff após a linha 8.000', async () => {
  test.setTimeout(120000);
  const f = await fixture();
  const data = path.join(f.root, 'diff-large-data'); await mkdir(data);
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [f.root] }));
  await writeFile(path.join(f.repo, 'README.md'), `${Array.from({ length: 8005 }, (_, index) => `linha ${index + 1}`).join('\n')}\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /work.*Abrir projeto/ }).click();
    await page.getByRole('button', { name: 'Alterações e commit', exact: true }).click();
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    const lastLine = page.locator('.diff-line.added .code').filter({ hasText: '+linha 8005' });
    await expect(lastLine).toHaveText('+linha 8005');
    await lastLine.scrollIntoViewIfNeeded();
    await expect(lastLine).toBeVisible();
  } finally { await app.close(); }
});
