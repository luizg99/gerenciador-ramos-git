import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { tempDirectory } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

test('Jira: cabeçalho, status, responsável, cópia de PR e ações de LogTime', async ({}, testInfo) => {
  const data = await tempDirectory('jira-ui-');
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ roots: [], useJira: true, useGemini: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  app = await electron.launch({ args: [path.resolve('.')], env: { ...env, RAMOS_TEST_DATA: data } });
  await app.evaluate(async ({ session }) => {
    (globalThis as any).jiraFixture = { mainStatus: 'OPEN', codingStatus: 'OPEN', assignee: 'luiz.ramos', worklogs: true, deleted: false, edited: false, transitionPosts: [], writes: [] };
    await session.fromPartition('persist:team-jira').protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/rest/api/2/')) {
        const fixture = (globalThis as any).jiraFixture;
        const mainKey = 'DDVENDAS-70001'; const codingKey = 'DDVENDAS-70002';
        const user = { displayName: 'Luiz Ramos', name: 'luiz.ramos', key: 'luiz.ramos' };
        const coding = { id: '70002', key: codingKey, self: `${url.origin}/rest/api/2/issue/${codingKey}`, fields: { timeoriginalestimate: 7200, summary: 'Codificação de teste', description: 'Descrição inicial', status: { name: fixture.codingStatus }, issuetype: { id: '11', name: 'Codificação (Sub-tarefa)', subtask: true }, project: { id: '1', key: 'DDVENDAS', name: 'Vendas' }, assignee: fixture.assignee === 'luiz.ramos' ? user : { displayName: 'Outro usuário', name: 'other-user', key: 'other-user' } } };
        if (url.pathname.endsWith('/myself')) return Response.json(user);
        if (url.pathname.endsWith('/createmeta')) return Response.json({ projects: [{ key: 'DDVENDAS', issuetypes: [{ id: '22', name: 'Code Review', subtask: true, fields: {} }] }] });
        if (url.pathname === '/rest/api/2/search') return Response.json({ issues: [] });
        if (url.pathname === '/rest/api/2/issue' && request.method === 'POST') { fixture.reviewBody = await request.json(); fixture.writes.push('create-review'); return Response.json({ key: 'DDVENDAS-70003' }, { status: 201 }); }
        if (url.pathname.endsWith('/transitions') && request.method === 'POST') {
          const item = { key: url.pathname.match(/\/issue\/([^/]+)\/transitions/)?.[1], body: await request.json() };
          fixture.transitionPosts.push(item); fixture.writes.push(item);
          return Response.json({});
        }
        if (url.pathname.endsWith('/comment') && request.method === 'POST') { fixture.writes.push('comment'); return Response.json({ id: 'comment-1' }, { status: 201 }); }
        if (url.pathname.endsWith('/comment')) return Response.json({ comments: [] });
        if (url.pathname === `/rest/api/2/issue/${mainKey}`) return Response.json({ id: '70001', key: mainKey, self: `${url.origin}/rest/api/2/issue/${mainKey}`, fields: { timeoriginalestimate: fixture.support ? null : 14400, summary: 'Tarefa principal de teste', description: 'Principal', status: { name: fixture.mainStatus }, issuetype: { id: '1', name: fixture.support ? 'Apoio - Cliente' : 'Task' }, project: { id: '1', key: 'DDVENDAS', name: 'Vendas' }, assignee: user, subtasks: [{ id: coding.id, key: coding.key, fields: coding.fields }] } });
        if (url.pathname === `/rest/api/2/issue/${codingKey}` && request.method === 'PUT') { fixture.descriptionBody = await request.json(); fixture.writes.push('edit-description'); return Response.json({}); }
        if (url.pathname === `/rest/api/2/issue/${codingKey}`) return Response.json(coding);
        if (url.pathname.endsWith('/editmeta')) return Response.json({ fields: {} });
        if (url.pathname.endsWith('/transitions')) return Response.json({ transitions: [{ id: 'close', name: 'Close', to: { name: 'Closed' } }] });
        if (url.pathname.includes('/worklog')) {
          if (request.method === 'PUT') { fixture.edited = true; fixture.editedBody = await request.json(); return Response.json({}); }
          if (request.method === 'DELETE') { fixture.worklogs = false; fixture.deleted = true; return new Response(null, { status: 204 }); }
          return Response.json({ worklogs: fixture.worklogs ? [{ id: 'work-1', timeSpent: '1h', timeSpentSeconds: 3600, started: '2026-10-20T12:00:00.000+0000', comment: 'Implementação', author: user }] : [] });
        }
        return Response.json({});
      }
      return new Response('<!doctype html><html><body><h1>Jira de teste</h1></body></html>', { headers: { 'content-type': 'text/html' } });
    });
  });

  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await expect(page.locator('.topbar')).toBeHidden();
  await page.getByRole('button', { name: 'Jira', exact: true }).click();
  await expect(page.locator('.topbar')).toBeHidden();
  await page.getByLabel('Chave da tarefa principal').fill('DDVENDAS-70001');
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.locator('.card-heading').filter({ hasText: 'Tarefa principal de teste' }).getByText('Task · OPEN · Luiz Ramos', { exact: true })).toBeVisible();
  await expect(page.getByText(/somente quando a tarefa principal está com status EM DESENVOLVIMENTO/)).toBeVisible();
  await expect(page.getByLabel(/Notes do Gem Dev/)).toBeHidden();
  await app.evaluate(() => { (globalThis as any).jiraFixture.codingStatus = 'Cancelado'; (globalThis as any).jiraFixture.mainStatus = 'EM DESENVOLVIMENTO'; });
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.getByText('Incluída no fluxo')).toHaveCount(0);
  await expect(page.getByLabel('Pendências para revisar')).toContainText('Nenhuma subtarefa de codificação ativa encontrada.');

  await app.evaluate(() => { (globalThis as any).jiraFixture.codingStatus = 'OPEN'; });
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.locator('.jira-related-heading small').filter({ hasText: 'OPEN' })).toBeVisible();
  await expect(page.getByText(/Bloqueado: a tarefa precisa estar EM ANDAMENTO/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeDisabled();
  await expect(page.getByLabel('Pendências para revisar')).toContainText('Coloque DDVENDAS-70002 em EM ANDAMENTO.');

  await app.evaluate(() => { (globalThis as any).jiraFixture.codingStatus = 'EM ANDAMENTO'; (globalThis as any).jiraFixture.assignee = 'other-user'; });
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.getByText(/Bloqueado: a tarefa precisa estar EM ANDAMENTO/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeDisabled();

  await app.evaluate(() => { (globalThis as any).jiraFixture.assignee = 'luiz.ramos'; });
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.getByText(/Fechamento automático: Closed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeDisabled();
  await page.getByLabel(/Notes do Gem Dev/).fill('Notes da entrega de teste');
  await page.getByRole('button', { name: 'Gemini', exact: true }).click();
  await page.getByRole('button', { name: 'Jira', exact: true }).click();
  await expect(page.getByLabel(/Notes do Gem Dev/)).toHaveValue('Notes da entrega de teste');
  await expect(page.getByLabel('Estimativa de horas DDVENDAS-70001')).toBeDisabled();
  await expect(page.getByLabel('Estimativa de horas DDVENDAS-70002')).toHaveValue('2');
  for (const theme of ['Escuro', 'Claro']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'Claro' ? 'light' : 'dark');
    await expect(page.getByLabel(/Notes do Gem Dev/)).toHaveValue('Notes da entrega de teste');
    await page.locator('.jira-workflow-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`jira-${theme}.png`) });
    expect(await page.locator('.jira-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 700));
  await expect.poll(() => page.locator('.jira-layout').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const edit = await page.getByRole('button', { name: 'Alterar LogTime DDVENDAS-70002 work-1' }).boundingBox();
  const remove = await page.getByRole('button', { name: 'Excluir LogTime DDVENDAS-70002 work-1' }).boundingBox();
  expect(edit?.y).toBe(remove?.y);
  await page.screenshot({ path: testInfo.outputPath('jira-compacto.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
  await page.getByLabel(/Texto da IA sem Release Notes/).fill('Resumo para revisão');
  await page.getByLabel(/PRs DDVENDAS-70002/).fill('Boa tarde, tarefa finalizada, disponível para revisão.\n\nIssue do Jira:\n<https://jiraproducao.totvs.com.br/browse/DDVENDAS-70001|DDVENDAS-70001>\n\nPRs:\nmain: https://dev.azure.com/equipe/projeto/_git/repo/pullrequest/123');
  await expect(page.getByRole('button', { name: 'Alterar LogTime DDVENDAS-70002 work-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir LogTime DDVENDAS-70002 work-1' })).toBeVisible();
  await expect(page.getByLabel('Comentário LogTime DDVENDAS-70002 work-1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Alterar LogTime DDVENDAS-70002 work-1' }).click();
  expect(await app.evaluate(() => (globalThis as any).jiraFixture.edited)).toBe(false);
  await page.getByLabel('Duração DDVENDAS-70002 work-1', { exact: true }).fill('2h');
  await page.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await expect(page.getByLabel('Duração DDVENDAS-70002 work-1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Alterar LogTime DDVENDAS-70002 work-1' }).click();
  await expect(page.getByLabel('Duração DDVENDAS-70002 work-1', { exact: true })).toHaveValue('1h');
  await page.getByLabel('Data LogTime DDVENDAS-70002 work-1', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Salvar LogTime', exact: true })).toBeDisabled();
  await page.getByLabel('Data LogTime DDVENDAS-70002 work-1', { exact: true }).fill('2026-10-19');
  await page.getByRole('button', { name: 'Salvar LogTime', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('logtime-edicao.png') });
  await page.getByLabel('Duração DDVENDAS-70002 work-1', { exact: true }).fill('2h');
  await page.getByLabel('Comentário LogTime DDVENDAS-70002 work-1', { exact: true }).fill('Revisão do LogTime');
  await page.getByRole('button', { name: 'Salvar LogTime', exact: true }).click();
  await expect.poll(async () => app!.evaluate(() => (globalThis as any).jiraFixture.edited)).toBe(true);
  expect(await app.evaluate(() => (globalThis as any).jiraFixture.editedBody)).toMatchObject({ timeSpent: '2h', comment: 'Revisão do LogTime' });
  await expect(page.getByLabel('Comentário LogTime DDVENDAS-70002 work-1', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Duração (ex.: 1h 30m)')).toHaveCount(0);
  await expect(page.getByText('Parent (tarefa principal)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Revisar e encerrar fluxo' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Confirmar encerramento Jira' })).toBeVisible();
  await expect.poll(async () => app!.evaluate(({ clipboard }) => clipboard.readText())).toContain('https://dev.azure.com/equipe/projeto/_git/repo/pullrequest/123');
  await expect.poll(async () => app!.evaluate(({ clipboard }) => clipboard.readText())).toContain('DDVENDAS-70001');
  await page.getByRole('button', { name: 'Voltar para revisar' }).click();
  await page.getByRole('button', { name: 'Copiar texto dos PRs' }).click();
  await expect.poll(async () => app!.evaluate(({ clipboard }) => clipboard.readText())).toContain('pullrequest/123');
  await app.evaluate(() => { (globalThis as any).jiraFixture.assignee = 'other-user'; });
  await page.getByRole('button', { name: 'Revisar e encerrar fluxo' }).click();
  await page.getByRole('button', { name: 'Confirmar e executar' }).click();
  await expect(page.getByText(/Fechamento bloqueado/).first()).toBeVisible();
  expect(await app.evaluate(() => (globalThis as any).jiraFixture.writes)).toEqual([]);
  await app.evaluate(() => { (globalThis as any).jiraFixture.assignee = 'luiz.ramos'; });
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Revisar e encerrar fluxo' }).click();
  await page.evaluate(() => { window.confirm = () => true; });
  await page.getByRole('button', { name: 'Confirmar e executar' }).click();
  await expect(page.getByText(/Fluxo concluído/).first()).toBeVisible();
  expect(await app.evaluate(() => (globalThis as any).jiraFixture.descriptionBody.fields.description)).toBe('Notes da entrega de teste');
  expect(await app.evaluate(() => (globalThis as any).jiraFixture.reviewBody.fields.description)).toBe('Tarefa principal: DDVENDAS-70001\n\nPull requests das tarefas de codificação:\nmain: https://dev.azure.com/equipe/projeto/_git/repo/pullrequest/123');
  const transitions = await app.evaluate(() => (globalThis as any).jiraFixture.transitionPosts);
  expect(transitions).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'DDVENDAS-70002', body: { transition: { id: 'close' } } }),
    expect.objectContaining({ key: 'DDVENDAS-70001', body: { transition: { id: 'close' } } })
  ]));

  await page.getByRole('button', { name: 'Excluir LogTime DDVENDAS-70002 work-1' }).click();
  await expect.poll(async () => app!.evaluate(() => (globalThis as any).jiraFixture.deleted)).toBe(true);
  await expect(page.getByPlaceholder('Duração (ex.: 1h 30m)')).toBeVisible();
  await page.getByRole('button', { name: '+ Adicionar LogTime' }).click();
  await expect(page.getByPlaceholder('Duração (ex.: 1h 30m)')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remover LogTime novo DDVENDAS-70002 2' }).click();
  await expect(page.getByPlaceholder('Duração (ex.: 1h 30m)')).toHaveCount(1);
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('PRs:\n\nmain: https://dev.azure.com/equipe/projeto/_git/repo/pullrequest/123');
  await page.getByRole('button', { name: 'Limpar tarefa...' }).click();
  await expect(page.getByLabel('Chave da tarefa principal')).toHaveValue('');
  await expect(page.getByLabel(/Notes do Gem Dev/)).toHaveCount(0);
  await app.evaluate(() => { Object.assign((globalThis as any).jiraFixture, { support: true, mainStatus: 'EM ANDAMENTO', worklogs: true }); });
  await page.getByLabel('Chave da tarefa principal').fill('DDVENDAS-70001');
  await page.getByRole('button', { name: 'Carregar tarefa', exact: true }).click();
  await expect(page.getByLabel(/Texto da IA sem Release Notes/)).toBeVisible();
  await page.getByLabel(/Texto da IA sem Release Notes/).fill('Apoio concluído');
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeDisabled();
  await expect(page.getByLabel('Estimativa de horas DDVENDAS-70002')).toHaveCount(0);
  await page.getByLabel('Estimativa de horas DDVENDAS-70001').fill('1.5');
  await expect(page.getByRole('button', { name: 'Revisar e encerrar fluxo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Revisar e encerrar fluxo' }).click();
  await page.getByRole('button', { name: 'Confirmar e executar' }).click();
  await expect(page.getByText(/Fluxo de apoio concluído/).first()).toBeVisible();
  await expect(page.getByLabel('Estimativa de horas DDVENDAS-70001')).toBeDisabled();
  await expect(page.getByLabel('Estimativa de horas DDVENDAS-70001')).toHaveValue('1.5');

});
