import { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ApplicationController } from './controllers/applicationController';
import { GitService } from './services/gitService';
import { Storage } from './services/storage';
import { hash, planSchema, ref, text } from '../src/models/validation';
import { parseJiraIssue, reviewInputSchema } from '../src/models/reviewMessage';
import { AzurePullRequests, prPairsSchema } from './services/azurePullRequests';
import { redact } from './services/processRunner';
import type { Snapshot } from '../src/models/domain';
let window: BrowserWindow | null = null;
let controller: ApplicationController;
let ready: Promise<void>;
const developmentUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
const productionUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
if (process.env.RAMOS_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.RAMOS_TEST_DATA);
function registerIpc() {
  const id = z.string().regex(/^[a-f0-9]{24}$/);
  function handle(channel: string, schema: z.ZodTuple<any, any>, action: (...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== (developmentUrl ? developmentUrl + '/' : productionUrl)) throw new Error('Origem IPC não autorizada.');
        await ready;
        return { ok: true, value: await action(...schema.parse(args)) };
      } catch (error) { return { ok: false, error: redact(error instanceof z.ZodError ? error.issues.map(i => i.message).join('\n') : (error as Error).message) }; }
    });
  }
  handle('app:snapshot', z.tuple([]), () => controller.snapshot());
  handle('app:updateSettings', z.tuple([z.object({ usePman: z.boolean() })]), patch => controller.exclusive(() => controller.updateSettings(patch)));
  handle('app:scan', z.tuple([]), () => controller.exclusive(() => controller.scan()));
  handle('app:chooseRoot', z.tuple([]), () => controller.exclusive(async () => {
    const chosen = await dialog.showOpenDialog(window!, { title: 'Selecione a pasta de projetos', properties: ['openDirectory'] });
    return chosen.canceled ? controller.snapshot() : controller.addRoot(chosen.filePaths[0]);
  }));
  handle('app:removeRoot', z.tuple([text]), root => controller.exclusive(() => controller.removeRoot(root)));
  handle('app:select', z.tuple([id]), id => controller.exclusive(() => controller.select(id)));
  handle('git:status', z.tuple([id]), id => controller.git.status(controller.repository(id)));
  handle('git:branches', z.tuple([id, z.boolean()]), (id, fetch) => fetch ? controller.mutate(id, repo => controller.git.branches(repo, true)) : controller.git.branches(controller.repository(id)));
  handle('git:switch', z.tuple([id, ref, z.enum(['block', 'carry', 'stash']), z.boolean()]), (id, branch, mode, install) => controller.mutate(id, repo => controller.git.switchBranch(repo, branch, mode, install)));
  handle('git:createBranch', z.tuple([id, ref, ref, z.enum(['block', 'carry', 'stash']), z.boolean(), z.boolean()]), (id, name, base, mode, publish, install) => controller.mutate(id, repo => controller.git.createBranch(repo, name, base, mode, publish, install)));
  handle('git:createBranches', z.tuple([id, z.array(z.object({ name: ref, base: ref })).min(1).max(4), z.number().int().min(0).max(3).nullable(), z.enum(['block', 'carry', 'stash']), z.boolean(), z.boolean()]), (id, items, switchTo, mode, publish, install) => controller.mutate(id, repo => controller.git.createBranches(repo, items, switchTo, mode, publish, install)));
  handle('git:pullRequestInfo', z.tuple([id]), id => controller.git.pullRequestInfo(controller.repository(id)));
  handle('reviews:history', z.tuple([]), () => controller.reviews.history());
  handle('reviews:updateIssue', z.tuple([z.string().uuid(), z.string().max(4096)]), (messageId, issue) => controller.exclusive(() => controller.reviews.updateIssue(messageId, issue)));
  handle('reviews:openLink', z.tuple([z.string().max(8192).url().refine(value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } })]), url => shell.openExternal(url));
  handle('git:createPullRequests', z.tuple([id, prPairsSchema, z.string().max(4096)]), (id, pairs, issue) => controller.mutate(id, async repo => {
    parseJiraIssue(issue);
    await controller.git.branches(repo, true);
    await controller.git.pullRequestUrls(repo, pairs);
    const info = await controller.git.pullRequestInfo(repo);
    const result = await new AzurePullRequests().create(repo, info, pairs, (source, target) => controller.git.pullRequestCommitMessages(repo, info.remote!, source, target));
    let message;
    if (result.prs.length) try { message = await controller.reviews.save(repo, { issue, prs: result.prs }); }
    catch { result.error = [result.error, 'Os PRs foram obtidos, mas não foi possível salvar o histórico. Os links continuam disponíveis nesta tela.'].filter(Boolean).join('\n'); }
    return { ...result, message };
  }));
  handle('git:findPullRequests', z.tuple([id, prPairsSchema]), (id, pairs) => controller.exclusive(async () => {
    const repo = controller.repository(id);
    return new AzurePullRequests().find(repo, await controller.git.pullRequestInfo(repo), pairs);
  }));
  handle('reviews:save', z.tuple([id, reviewInputSchema]), (id, input) => controller.exclusive(() => controller.reviews.save(controller.repository(id), input)));
  handle('reviews:copy', z.tuple([z.string().uuid()]), async messageId => { clipboard.write(await controller.reviews.copy(messageId)); });
  handle('git:pman', z.tuple([id]), id => controller.mutate(id, async repo => { await controller.git.ensureIdle(repo, false); await controller.git.runPman(repo); }));
  handle('git:log', z.tuple([id, ref, z.number().int().min(0).max(1000000)]), (id, branch, skip) => controller.git.log(controller.repository(id), branch, skip));
  handle('git:detail', z.tuple([id, hash]), (id, value) => controller.git.detail(controller.repository(id), value));
  handle('git:commitFileDiff', z.tuple([id, hash, text]), (id, value, file) => controller.git.commitFileDiff(controller.repository(id), value, file));
  handle('git:workingDiff', z.tuple([id, text, z.boolean()]), (id, file, staged) => controller.git.workingDiff(controller.repository(id), file, staged));
  handle('git:stage', z.tuple([id, z.array(text).min(1).max(10000), z.boolean()]), (id, files, unstage) => controller.exclusive(() => controller.git.stage(controller.repository(id), files, unstage)));
  handle('git:discard', z.tuple([id, z.array(text).min(1).max(10000)]), (id, files) => controller.mutate(id, repo => controller.git.discard(repo, files)));
  handle('git:commit', z.tuple([id, z.string().min(1).max(20000)]), (id, message) => controller.mutate(id, repo => controller.git.commit(repo, message)));
  handle('git:push', z.tuple([id]), id => controller.mutate(id, repo => controller.git.push(repo)));
  handle('git:cherryPick', z.tuple([id, planSchema]), (id, plan) => controller.mutate(id, repo => controller.cherry.start(repo, plan)));
  handle('git:cancelCherryPick', z.tuple([id, z.string().uuid()]), (id, executionId) => controller.mutate(id, repo => controller.cherry.cancel(repo, executionId)));
  handle('git:resume', z.tuple([id, z.string().uuid(), z.enum(['retry', 'manual'])]), (id, executionId, action) => controller.mutate(id, repo => controller.cherry.resume(repo, executionId, action)));
}
async function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1050, minHeight: 700, backgroundColor: '#0e1118', title: 'Gerenciador de Ramos', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.on('focus', () => window?.flashFrame(false));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => { if (controller.busy) { event.preventDefault(); void dialog.showMessageBox(window!, { type: 'info', message: 'Aguarde a operação terminar antes de fechar.', detail: 'O progresso está sendo salvo. Fechar agora pode interromper um comando Git.' }); } });
  if (developmentUrl) await window.loadURL(developmentUrl); else await window.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    const report = (repoPath: string, message: string) => { if (window && !window.isDestroyed()) window.webContents.send('operation:progress', { repoPath, message: redact(message), time: new Date().toISOString() }); };
    const changed = (snapshot: Snapshot) => { if (window && !window.isDestroyed()) window.webContents.send('app:changed', snapshot); };
    const git = new GitService(report);
    git.onPmanFinished = (repoPath, error) => {
      if (!window || window.isDestroyed()) return;
      const name = path.basename(repoPath);
      if (!window.isFocused()) window.flashFrame(true);
      if (Notification.isSupported()) {
        const notification = new Notification({ title: error ? 'Instalação falhou' : 'Instalação concluída', body: error ? `pman install em ${name}: ${redact(error.message).slice(0, 160)}` : `pman install -f terminou em ${name}.` });
        notification.on('click', () => { if (window && !window.isDestroyed()) { window.restore(); window.show(); window.focus(); } });
        notification.show();
      }
    };
    controller = new ApplicationController(git, new Storage(app.getPath('userData')), report, changed);
    // A janela abre já; as chamadas IPC aguardam só a leitura das configurações e da lista salva.
    ready = controller.initialize(); registerIpc(); await createWindow(); await ready;
  }).catch(error => { dialog.showErrorBox('Falha ao iniciar', (error as Error).message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
