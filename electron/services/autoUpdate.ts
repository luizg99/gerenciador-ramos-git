import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

// Atualização obrigatória: a versão nova é buscada nas Releases do GitHub e, havendo uma, o app não abre até instalá-la.
// Só vale para o app instalado: em desenvolvimento e nos testes não faz nada. Sem internet (ou se o GitHub não responder), o app abre normalmente.
const enabled = () => app.isPackaged && !process.env.RAMOS_TEST_DATA;
const CHECK_TIMEOUT_MS = 10_000;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const page = (title: string, detail: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<body style="margin:0;font-family:Segoe UI,sans-serif;background:#0f1115;color:#e8eaf0;display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 28px;box-sizing:border-box;-webkit-app-region:drag">` +
  `<div style="font-size:16px;font-weight:600">${title}</div><div id="d" style="margin-top:6px;font-size:13px;color:#9aa3b5">${detail}</div>` +
  `<div style="margin-top:16px;height:6px;background:#262b36;border-radius:3px;overflow:hidden"><div id="b" style="height:100%;width:0;background:#5b8def;transition:width .2s"></div></div></body>`);

// Chamado antes de abrir a janela principal. Se houver versão nova, baixa, instala e reabre o app (nesse caso nunca retorna).
export async function enforceUpdateOnStartup() {
  if (!enabled()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let available = false, version = '';
  try {
    const result = await Promise.race([autoUpdater.checkForUpdates(), wait(CHECK_TIMEOUT_MS).then(() => null)]);
    available = !!result?.isUpdateAvailable; version = result?.updateInfo.version ?? '';
  } catch { return; }
  if (!available) return;
  const progress = new BrowserWindow({ width: 420, height: 130, frame: false, resizable: false, minimizable: false, maximizable: false, show: false, backgroundColor: '#0f1115', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  progress.on('closed', () => app.quit());
  await progress.loadURL(page(`Atualizando para a versão ${version}`, 'Baixando a atualização obrigatória…'));
  progress.show();
  autoUpdater.on('download-progress', p => {
    if (progress.isDestroyed()) return;
    void progress.webContents.executeJavaScript(`document.getElementById('b').style.width='${Math.round(p.percent)}%';document.getElementById('d').textContent='Baixando a atualização obrigatória… ${Math.round(p.percent)}%'`).catch(() => {});
  });
  for (;;) {
    try { await autoUpdater.downloadUpdate(); break; }
    catch (error) {
      const choice = await dialog.showMessageBox(progress, { type: 'error', buttons: ['Tentar novamente', 'Sair'], defaultId: 0, cancelId: 1, message: 'Não foi possível baixar a atualização.', detail: `É preciso atualizar para continuar usando o aplicativo.\n${(error as Error).message.slice(0, 200)}` });
      if (choice.response === 1) { app.quit(); return new Promise<void>(() => {}); }
    }
  }
  if (!progress.isDestroyed()) void progress.webContents.executeJavaScript(`document.getElementById('d').textContent='Instalando e reiniciando…'`).catch(() => {});
  progress.removeAllListeners('closed');
  autoUpdater.quitAndInstall(true, true);
  return new Promise<void>(() => {});
}

// Com o app já aberto: confere a cada 6 horas. Achando versão nova, baixa e exige reiniciar para atualizar (o aviso bloqueia a janela).
// Espera terminar qualquer operação Git em andamento, para não interrompê-la.
export function watchForUpdates(getWindow: () => BrowserWindow | null, isBusy: () => boolean) {
  if (!enabled()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => {});
  autoUpdater.on('update-downloaded', async info => {
    while (isBusy()) await wait(2000);
    const window = getWindow();
    const options = { type: 'info' as const, buttons: ['Reiniciar e atualizar'], defaultId: 0, noLink: true, message: `Atualização obrigatória: versão ${info.version}.`, detail: 'O aplicativo será reiniciado para concluir a atualização.' };
    if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options); else await dialog.showMessageBox(options);
    autoUpdater.quitAndInstall(true, true);
  });
  const check = () => { void autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 60_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}
