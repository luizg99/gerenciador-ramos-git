import { app, BrowserWindow, Notification, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppUpdater } from 'electron-updater';

// Atualização obrigatória, iniciada pelo cliente: o app abre normalmente e, havendo versão nova nas Releases do GitHub, mostra um aviso
// que bloqueia a janela até clicar em "Atualizar agora". Só então baixa (com barra de progresso), instala e reabre sozinho.
// Só vale para o app instalado: em desenvolvimento e nos testes não faz nada. Sem internet, a checagem falha em silêncio e o app segue normal.
// O electron-updater é pesado de carregar (até ~1 s na primeira abertura do dia); por isso só é carregado depois que a janela já está pronta.
let autoUpdater: AppUpdater | undefined;
const loadUpdater = async () => (autoUpdater ??= (require('electron-updater') as typeof import('electron-updater')).autoUpdater);
const enabled = () => app.isPackaged && !process.env.RAMOS_TEST_DATA;
const CHECK_TIMEOUT_MS = 10_000;
const marker = () => path.join(app.getPath('userData'), 'atualizacao-pendente.json');
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const notify = (title: string, body: string) => { if (Notification.isSupported()) new Notification({ title, body }).show(); };
const page = (title: string, detail: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<body style="margin:0;font-family:Segoe UI,sans-serif;background:#0f1115;color:#e8eaf0;display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 28px;box-sizing:border-box">` +
  `<div style="font-size:16px;font-weight:600">${title}</div><div id="d" style="margin-top:6px;font-size:13px;color:#9aa3b5">${detail}</div>` +
  `<div style="margin-top:16px;height:6px;background:#262b36;border-radius:3px;overflow:hidden"><div id="b" style="height:100%;width:0;background:#5b8def;transition:width .2s"></div></div></body>`);

// A instalação roda em segundo plano, sem janelas: avisa que começou e deixa um marcador para avisar, na próxima abertura, que terminou.
function installAndRestart(version: string) {
  try { fs.writeFileSync(marker(), JSON.stringify({ version })); } catch { /* sem marcador, só não haverá o aviso final */ }
  notify('Instalando a atualização', `Versão ${version}. O aplicativo vai reabrir sozinho em instantes.`);
  autoUpdater!.quitAndInstall(true, true);
}
function announceInstalledUpdate() {
  try {
    const { version } = JSON.parse(fs.readFileSync(marker(), 'utf8')) as { version?: string };
    fs.rmSync(marker(), { force: true });
    if (version === app.getVersion()) notify('Aplicativo atualizado', `Agora você está na versão ${version}.`);
  } catch { /* sem marcador: nada a avisar */ }
}

// Baixa e instala a versão nova mostrando o progresso por cima da janela principal.
async function downloadAndInstall(parent: BrowserWindow | null, version: string) {
  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const progress = new BrowserWindow({ width: 420, height: 130, parent: owner, modal: !!owner, frame: false, resizable: false, minimizable: false, maximizable: false, show: false, backgroundColor: '#0f1115', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  progress.on('closed', () => app.quit());
  await progress.loadURL(page(`Atualizando para a versão ${version}`, 'Baixando a atualização…'));
  progress.show();
  const show = (percent: number, text: string) => { if (!progress.isDestroyed()) void progress.webContents.executeJavaScript(`document.getElementById('b').style.width='${percent}%';document.getElementById('d').textContent=${JSON.stringify(text)}`).catch(() => {}); };
  autoUpdater!.on('download-progress', p => show(Math.round(p.percent), `Baixando a atualização… ${Math.round(p.percent)}%`));
  for (;;) {
    try { await autoUpdater!.downloadUpdate(); break; }
    catch (error) {
      const choice = await dialog.showMessageBox(progress, { type: 'error', buttons: ['Tentar novamente', 'Sair'], defaultId: 0, cancelId: 1, message: 'Não foi possível baixar a atualização.', detail: `É preciso atualizar para continuar usando o aplicativo.\n${(error as Error).message.slice(0, 200)}` });
      if (choice.response === 1) { progress.removeAllListeners('closed'); app.quit(); return; }
    }
  }
  show(100, 'Instalando… o aplicativo vai reiniciar sozinho em instantes.');
  await wait(3000);
  progress.removeAllListeners('closed');
  installAndRestart(version);
}

// Confere ao abrir e a cada 6 horas. Achando versão nova, espera qualquer operação Git terminar (para não interrompê-la)
// e mostra o aviso obrigatório, que só tem o botão "Atualizar agora".
export function watchForUpdates(getWindow: () => BrowserWindow | null, isBusy: () => boolean) {
  if (!enabled()) return;
  announceInstalledUpdate();
  let prompting = false;
  const check = async () => {
    if (prompting) return;
    let version = '';
    try {
      const fresh = !autoUpdater;
      const updater = await loadUpdater();
      if (fresh) { updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.on('error', () => {}); }
      const result = await Promise.race([updater.checkForUpdates(), wait(CHECK_TIMEOUT_MS).then(() => null)]);
      if (!result?.isUpdateAvailable) return;
      version = result.updateInfo.version;
    } catch { return; }
    prompting = true;
    while (isBusy()) await wait(2000);
    const window = getWindow();
    const options = { type: 'info' as const, buttons: ['Atualizar agora'], defaultId: 0, cancelId: 0, noLink: true, message: `Nova versão disponível: ${version}.`, detail: 'É obrigatório atualizar para continuar usando o aplicativo. O download e a instalação são automáticos e o aplicativo reabre sozinho.' };
    if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options); else await dialog.showMessageBox(options);
    await downloadAndInstall(getWindow(), version);
  };
  setTimeout(() => void check(), 5000);
  setInterval(() => void check(), 6 * 60 * 60 * 1000);
}
