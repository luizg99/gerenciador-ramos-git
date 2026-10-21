import { WebContentsView, type BrowserWindow } from 'electron';
import { JIRA_BASE, JIRA_HOME_URL, type JiraBounds, type JiraBrowserState, type JiraMethod } from '../../src/models/jira';

export class JiraBrowser {
  private view?: WebContentsView;
  private state: JiraBrowserState = { phase: 'loading', message: 'Abrindo o Jira da equipe…' };
  constructor(private owner: BrowserWindow, private changed: (state: JiraBrowserState) => void) {
    owner.on('closed', () => this.dispose());
  }
  getState() { return this.state; }
  private update(phase: JiraBrowserState['phase'], message: string) {
    let url: string | undefined;
    try { const current = new URL(this.view?.webContents.getURL() ?? ''); url = current.origin + current.pathname; } catch { /* Ainda carregando. */ }
    this.state = { phase, message, url }; this.changed(this.state);
  }
  private ensureView() {
    if (this.view) return this.view;
    const view = new WebContentsView({ webPreferences: {
      partition: 'persist:team-jira', nodeIntegration: false, contextIsolation: true, sandbox: true
    } });
    this.view = view; view.setVisible(false); this.owner.contentView.addChildView(view);
    const contents = view.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    const secure = (value: string) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
    contents.on('will-navigate', (event, url) => { if (!secure(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!secure(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => secure(url) ? {
      action: 'allow', overrideBrowserWindowOptions: {
        parent: this.owner, autoHideMenuBar: true,
        webPreferences: { partition: 'persist:team-jira', nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined }
      }
    } : { action: 'deny' });
    contents.on('did-finish-load', () => this.update('ready', 'Entre no Jira da equipe. Depois carregue a tarefa principal para revisar o fluxo.'));
    contents.on('did-finish-load', () => {
      // O portal mantém a sessão, mas pode exigir um clique explícito para iniciar
      // o SSO. O link pode aparecer após o carregamento inicial, então observamos
      // a página por alguns segundos e só o acionamos sem campo de senha.
      void contents.executeJavaScript(`(() => {
        if (location.hostname !== 'jiraproducao.totvs.com.br' || window.__jiraAutoLoginWatching) return;
        window.__jiraAutoLoginWatching = true;
        const tryLogin = () => {
          if (location.hostname !== 'jiraproducao.totvs.com.br' || document.querySelector('input[type="password"]')) return false;
          const candidates = [...document.querySelectorAll('button, input[type="submit"], a, [role="button"], [role="link"]')];
          const matches = candidates.filter((element) => {
            const label = (element.innerText || element.textContent || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLocaleLowerCase();
            return /^(login|log in|entrar|fazer login)$/.test(label) && element.getClientRects().length > 0 && !element.disabled;
          });
          if (matches.length === 0) return false;
          matches[0].click();
          observer.disconnect();
          clearTimeout(timeout);
          return true;
        };
        const observer = new MutationObserver(() => tryLogin());
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        const timeout = setTimeout(() => observer.disconnect(), 15000);
        tryLogin();
      })()`).catch(() => {});
    });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.update('error', 'Não foi possível abrir o Jira. Verifique a conexão ou tente reabrir a sessão.');
    });
    contents.on('render-process-gone', () => this.update('error', 'A sessão do Jira foi interrompida. Clique em Abrir Jira.'));
    void contents.loadURL(JIRA_HOME_URL).catch(() => {});
    return view;
  }
  setBounds(bounds: JiraBounds | null) {
    if (!bounds) { this.view?.setVisible(false); return; }
    const view = this.ensureView();
    const [width, height] = this.owner.getContentSize();
    const x = Math.max(220, Math.min(width, Math.round(bounds.x)));
    const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    const w = Math.max(0, Math.min(width - x, Math.round(bounds.width)));
    const h = Math.max(0, Math.min(height - y, Math.round(bounds.height)));
    view.setBounds({ x, y, width: w, height: h }); view.setVisible(w > 0 && h > 0);
  }
  async open() {
    this.update('loading', 'Abrindo o Jira da equipe…');
    await this.ensureView().webContents.loadURL(JIRA_HOME_URL);
  }
  async request(path: string, method: JiraMethod = 'GET', body?: unknown): Promise<unknown> {
    const contents = this.ensureView().webContents;
    let url: URL;
    try { url = new URL(contents.getURL()); } catch { throw new Error('A sessão do Jira ainda está carregando.'); }
    if (url.origin !== JIRA_BASE || !path.startsWith('/rest/api/2/') || path.includes('..')) {
      throw new Error('Conclua o login no Jira da equipe antes de carregar os dados.');
    }
    if (contents.isLoadingMainFrame()) throw new Error('Aguarde o Jira terminar de carregar.');
    const result = await contents.executeJavaScriptInIsolatedWorld(999, [{ code:
      `(async () => { if (location.origin !== ${JSON.stringify(JIRA_BASE)}) throw new Error('A sessão do Jira expirou.'); const response = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' }, ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`} }); const raw = await response.text(); if (!response.ok) throw new Error('Jira respondeu HTTP ' + response.status + ': ' + raw.slice(0, 500)); try { return raw ? JSON.parse(raw) : null; } catch { throw new Error('O Jira retornou uma resposta inesperada.'); } })()`
    }]);
    return result;
  }
  dispose() {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = undefined;
  }
}
