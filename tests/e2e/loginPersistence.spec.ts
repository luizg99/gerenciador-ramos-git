import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close().catch(() => {}); app = undefined; });

const env = () => Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
const launch = (data: string) => electron.launch({ args: [path.resolve('.')], env: { ...env(), RAMOS_TEST_DATA: data } });

test('Jira: o cookie de sessão sobrevive ao fechar e reabrir o app', async () => {
  const data = await tempDirectory('login-persistence-');
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useJira: true }));
  app = await launch(data);
  const page = await app.firstWindow();
  // Abre a aba Jira para o navegador embutido existir; a rede não é necessária.
  await app.evaluate(({ session }) => session.fromPartition('persist:team-jira').protocol.handle('https', () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })));
  await page.getByRole('button', { name: 'Jira', exact: true }).click();
  await app.evaluate(({ session }) => session.fromPartition('persist:team-jira').cookies.set({ url: 'https://jiraproducao.totvs.com.br/', name: 'JSESSIONID', value: 'sessao-de-teste', httpOnly: true, secure: true }));
  await expect.poll(() => app!.evaluate(async ({ session }) => (await session.fromPartition('persist:team-jira').cookies.get({ name: 'JSESSIONID' })).map(cookie => cookie.session)), { timeout: 10000 }).toEqual([false]);
  await app.close();
  app = await launch(data);
  await app.firstWindow();
  const restored = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:team-jira').cookies.get({ name: 'JSESSIONID' })).map(cookie => cookie.value));
  expect(restored).toEqual(['sessao-de-teste']);
});
