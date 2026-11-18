import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

const env = () => Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;

test('Início: só aparece com "Usa Jira" e mostra as tarefas do usuário em colunas, com as sub-tarefas em cascata', async () => {
  // Sem Jira: o menu Início não existe e o app abre na tela de projetos.
  const without = await tempDirectory('home-off-');
  await mkdir(without, { recursive: true }); await writeFile(path.join(without, 'settings.json'), JSON.stringify({ roots: [] }));
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env(), RAMOS_TEST_DATA: without } });
  let page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Seus projetos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Início', exact: true })).toHaveCount(0);
  await app.close();

  // Com Jira: abre no Início.
  const data = await tempDirectory('home-on-');
  await mkdir(data, { recursive: true }); await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useJira: true }));
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env(), RAMOS_TEST_DATA: data } });
  await app.evaluate(async ({ session }) => {
    const status = (name: string, key: string) => ({ name, statusCategory: { key } });
    const issues = [
      { key: 'DDV-101', fields: { summary: 'Entrega principal da rotina 4204', issuetype: { name: 'Task' }, status: status('Em desenvolvimento', 'indeterminate'), priority: { name: 'Alta' } } },
      { key: 'DDV-102', fields: { summary: 'Codificação da rotina 4204', issuetype: { name: 'Codificação (Sub-tarefa)' }, status: status('Aberto', 'new'), parent: { key: 'DDV-101', fields: { summary: 'Entrega principal da rotina 4204', status: status('Em desenvolvimento', 'indeterminate') } } } },
      { key: 'DDV-200', fields: { summary: 'Apoio ao cliente Alfa', issuetype: { name: 'Apoio - Cliente' }, status: status('Aberto', 'new'), parent: { key: 'DDV-199', fields: { summary: 'Tarefa de outra pessoa', status: status('Em teste', 'indeterminate'), issuetype: { name: 'Story' } } } } },
      { key: 'DDV-300', fields: { summary: 'Corrigir validação do pedido', issuetype: { name: 'Bug' }, status: status('Aberto', 'new') } }
    ];
    await session.fromPartition('persist:team-jira').protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/myself')) return Response.json({ displayName: 'Luiz Ramos', name: 'luiz.ramos' });
      if (url.pathname === '/rest/api/2/search') { (globalThis as any).homeJql = (await request.json()).jql; return Response.json({ issues, total: issues.length }); }
      if (url.pathname.startsWith('/rest/api/2/')) return Response.json({});
      return new Response('<!doctype html><html><body><h1>Jira de teste</h1></body></html>', { headers: { 'content-type': 'text/html' } });
    });
  });
  page = await app.firstWindow();
  // O Início carregou antes do Jira de teste existir; sair e voltar recarrega com a sessão de teste.
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Jira', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir Jira' }).click();
  await expect(page.getByText('Jira de teste')).toHaveCount(0); // o conteúdo está na tela nativa; só espera a sessão abrir
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Início', exact: true }).click();

  await expect(page.getByText('tarefas atribuídas')).toContainText('4');
  await expect(page.getByText('Luiz Ramos')).toBeVisible();
  expect(await app.evaluate(() => (globalThis as any).homeJql)).toContain('assignee = currentUser()');
  // Colunas por status: "Aberto" (a fazer) vem antes dos "em andamento".
  const columns = await page.locator('.kanban-column h2').allTextContents();
  expect(columns).toEqual(['Aberto', 'Em desenvolvimento', 'Em teste']);
  // Cascata: a sub-tarefa fica dentro do cartão da principal, que não se repete.
  const parent = page.locator('.kanban-card', { hasText: 'DDV-101' }).first();
  await expect(parent.locator('.kanban-children')).toContainText('DDV-102');
  await expect(page.locator('.kanban-card').filter({ hasText: 'DDV-101' })).toHaveCount(1);
  // Sub-tarefa do usuário com principal de outra pessoa: a principal aparece como contexto.
  const context = page.locator('.kanban-card.context');
  await expect(context).toContainText('DDV-199'); await expect(context).toContainText('atribuída a outra pessoa'); await expect(context.locator('.kanban-children')).toContainText('DDV-200');
  if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'home.png') });
});
