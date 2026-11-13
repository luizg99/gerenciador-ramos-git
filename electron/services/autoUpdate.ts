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
// Vale para todo app instalado. Não depende de variável de ambiente nem de arquivo editável: nos testes e em desenvolvimento o app não é empacotado.
const enabled = () => app.isPackaged;
const CHECK_TIMEOUT_MS = 10_000;
const logFile = () => path.join(app.getPath('userData'), 'atualizacao.log');
const log = (level: string, message: unknown) => { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${level} ${message instanceof Error ? message.stack ?? message.message : String(message)}
`); } catch { /* sem log, o app segue */ } };
const STALL_MS = 60_000;
const marker = () => path.join(app.getPath('userData'), 'atualizacao-pendente.json');
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const notify = (title: string, body: string) => { if (Notification.isSupported()) new Notification({ title, body }).show(); };
const shell = (body: string) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<body style="margin:0;font-family:Segoe UI,sans-serif;background:#0f1115;color:#e8eaf0;display:flex;flex-direction:column;justify-content:center;height:100vh;padding:0 28px;box-sizing:border-box;user-select:none">${body}</body>`);
const progressPage = (title: string, detail: string) => shell(
  `<div style="font-size:16px;font-weight:600">${title}</div><div id="d" style="margin-top:6px;font-size:13px;color:#9aa3b5">${detail}</div>` +
  `<div style="margin-top:16px;height:6px;background:#262b36;border-radius:3px;overflow:hidden"><div id="b" style="height:100%;width:0;background:#5b8def;transition:width .2s"></div></div>`);
// Aviso obrigatório: sem barra de título e sem X; o único caminho é o botão, que sinaliza ao app navegando para o endereço GO_URL.
const GO_URL = 'ramos-update://atualizar';
const promptPage = (version: string) => shell(
  `<div style="font-size:16px;font-weight:600">Atualização obrigatória</div>` +
  `<div style="margin-top:6px;font-size:13px;color:#9aa3b5">A versão ${version} está disponível. Clique em Atualizar para continuar usando o aplicativo.</div>` +
  `<button onclick="location.href='${GO_URL}'" autofocus style="margin-top:18px;align-self:flex-start;padding:8px 22px;font-size:13px;border:0;border-radius:6px;background:#5b8def;color:#fff;cursor:pointer">Atualizar</button>`);

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

// Mostra o aviso obrigatório e, ao clicar em Atualizar, baixa e instala a versão nova com o progresso na mesma janela (modal sobre a principal).
async function updateFlow(parent: BrowserWindow | null, version: string) {
  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const progress = new BrowserWindow({ width: 440, height: 170, parent: owner, modal: !!owner, frame: false, closable: false, resizable: false, minimizable: false, maximizable: false, show: false, backgroundColor: '#0f1115', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  // Não fecha por Alt+F4 nem por nenhum outro meio, a não ser que o app esteja encerrando.
  let leaving = false;
  app.once('before-quit', () => { leaving = true; });
  owner?.once('closed', () => { leaving = true; if (!progress.isDestroyed()) progress.destroy(); });
  progress.on('close', event => { if (!leaving) event.preventDefault(); });
  await progress.loadURL(promptPage(version));
  progress.show();
  await new Promise<void>(resolve => progress.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (url === GO_URL) resolve(); }));
  await progress.loadURL(progressPage(`Atualizando para a versão ${version}`, 'Baixando a atualização…'));
  const show = (percent: number, text: string) => { if (!progress.isDestroyed()) void progress.webContents.executeJavaScript(`document.getElementById('b').style.width='${percent}%';document.getElementById('d').textContent=${JSON.stringify(text)}`).catch(() => {}); };
  let lastProgress = Date.now();
  autoUpdater!.on('download-progress', p => { lastProgress = Date.now(); show(Math.round(p.percent), `Baixando a atualização… ${Math.round(p.percent)}%`); });
  const { CancellationToken } = require('electron-updater') as typeof import('electron-updater');
  for (;;) {
    // Sem nenhum progresso por 60 s o download é cancelado, e o cliente escolhe entre tentar de novo ou sair (antes ficava parado para sempre).
    const token = new CancellationToken(); lastProgress = Date.now(); let stalled = false;
    const watchdog = setInterval(() => { if (Date.now() - lastProgress > STALL_MS) { stalled = true; token.cancel(); } }, 5000);
    try { log('INFO', `baixando a versão ${version}`); await autoUpdater!.downloadUpdate(token); log('INFO', 'download concluído'); break; }
    catch (error) {
      log('ERROR', error);
      const reason = stalled ? 'O download ficou parado por mais de 1 minuto. Verifique a internet, o proxy ou o antivírus.' : (error as Error).message.slice(0, 200);
      const choice = await dialog.showMessageBox(progress, { type: 'error', buttons: ['Tentar novamente', 'Sair'], defaultId: 0, cancelId: 1, message: 'Não foi possível baixar a atualização.', detail: `É preciso atualizar para continuar usando o aplicativo.
${reason}
Detalhes em: ${logFile()}` });
      if (choice.response === 1) { leaving = true; app.quit(); return; }
      show(0, 'Baixando a atualização…');
    }
    finally { clearInterval(watchdog); }
  }
  show(100, 'Instalando… o aplicativo vai reiniciar sozinho em instantes.');
  await wait(3000);
  leaving = true;
  installAndRestart(version);
}

// Confere ao abrir e a cada 6 horas. Achando versão nova, espera qualquer operação Git terminar (para não interrompê-la)
// e mostra o aviso obrigatório, que só tem o botão "Atualizar".
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
      if (fresh) {
        // O endereço das Releases fica no código, e não só no app-update.yml da pasta de instalação (que o usuário poderia apagar ou editar).
        updater.setFeedURL({ provider: 'github', owner: 'luizg99', repo: 'gerenciador-ramos-git' });
        updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.on('error', error => log('ERROR', error));
        // Instalador inteiro de uma vez: o download diferencial (blockmap) às vezes não reporta progresso nem termina.
        updater.disableDifferentialDownload = true;
        updater.logger = { info: m => log('INFO', m), warn: m => log('WARN', m), error: m => log('ERROR', m) };
      }
      const result = await Promise.race([updater.checkForUpdates(), wait(CHECK_TIMEOUT_MS).then(() => null)]);
      if (!result?.isUpdateAvailable) return;
      version = result.updateInfo.version;
    } catch { return; }
    prompting = true;
    while (isBusy()) await wait(2000);
    await updateFlow(getWindow(), version);
  };
  setTimeout(() => void check(), 5000);
  setInterval(() => void check(), 6 * 60 * 60 * 1000);
}
