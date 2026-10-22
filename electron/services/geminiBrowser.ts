import { WebContentsView, type BrowserWindow } from 'electron';
import { GEM_URL, gemUrlForAccount, isGeminiHome, isGemStartUrl, type GeminiBounds, type GeminiState } from '../../src/models/gemini';

function navigationAborted(error: unknown) {
  return /ERR_ABORTED\s*\(-3\)/.test(error instanceof Error ? error.message : String(error));
}

// This runs in an isolated world in the remote page. No Node or app bridge is exposed.
export function focusGemComposer() {
  if (location.origin !== 'https://gemini.google.com' || !/^\/(?:u\/\d+\/)?gem\/3bf604e9d2f3\/?$/.test(location.pathname)) return 'waiting';
  if (document.querySelector('user-query, [data-message-author-role="user"]')) return 'conversation';
  const editors = [...document.querySelectorAll<HTMLElement>('rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"]')]
    .filter(element => element.getBoundingClientRect().height > 0 && element.getAttribute('aria-disabled') !== 'true');
  const editor = editors[0];
  if (!editor) return 'waiting';
  if (editor.innerText.trim()) return 'occupied';
  editor.focus();
  return document.activeElement === editor ? 'ready' : 'waiting';
}

// Only submits the prompt after the expected text and a unique, enabled send
// button are both confirmed in the still-open Gem Dev composer.
export function submitGemPrompt(expected: string) {
  if (location.origin !== 'https://gemini.google.com' || !/^\/(?:u\/\d+\/)?gem\/3bf604e9d2f3\/?$/.test(location.pathname)) return 'wrong-page';
  if (document.querySelector('user-query, [data-message-author-role="user"]')) return 'conversation';
  // Gemini renders pasted paragraphs with its own spacing. Compare the words in
  // order while allowing the editor to change whitespace between them.
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const editors = [...document.querySelectorAll<HTMLElement>('rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"]')]
    .filter(element => element.getBoundingClientRect().height > 0 && element.getAttribute('aria-disabled') !== 'true');
  if (editors.length !== 1 || normalize(editors[0].innerText) !== normalize(expected)) return 'text-mismatch';
  const labels = new Set(['send', 'send message', 'send prompt', 'submit', 'enviar', 'enviar mensagem', 'enviar prompt', 'enviar mensagem para gemini']);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
    .filter(button => labels.has((button.getAttribute('aria-label') ?? '').trim().toLocaleLowerCase())
      && button.getBoundingClientRect().height > 0 && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  if (buttons.length !== 1) return buttons.length ? 'ambiguous' : 'no-send-button';
  buttons[0].click();
  return 'sent';
}

export class GeminiBrowser {
  private view?: WebContentsView;
  private timer?: ReturnType<typeof setInterval>;
  private request = 0;
  private generating = false;
  private homeRecovery = false;
  private recovering?: number;
  private state: GeminiState = { phase: 'loading', message: 'Abrindo o Gem da equipe…' };
  constructor(private owner: BrowserWindow, private changed: (state: GeminiState) => void) {
    owner.on('closed', () => this.dispose());
  }
  getState() { return this.state; }
  private update(phase: GeminiState['phase'], message: string) {
    let url: string | undefined;
    try { const current = new URL(this.view?.webContents.getURL() ?? ''); url = current.origin + current.pathname; } catch { /* Loading. */ }
    this.state = { phase, message, url }; this.changed(this.state);
  }
  private cancel() { this.request++; this.generating = false; this.recovering = undefined; if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async recoverHome() {
    const contents = this.view?.webContents;
    if (!contents || this.recovering !== undefined) return;
    const request = this.request;
    this.recovering = request;
    try {
      // Login can briefly visit /app before the Gemini client restores its route.
      // Let that navigation settle instead of aborting it with another loadURL.
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (request !== this.request || contents.isDestroyed() || !isGeminiHome(contents.getURL())) return;
      this.homeRecovery = true;
      await contents.loadURL(gemUrlForAccount(contents.getURL()));
    } catch (error) {
      if (request === this.request && !navigationAborted(error)) {
        this.cancel(); this.update('error', 'Não foi possível abrir o Gem Dev. Clique em Reabrir Gem para tentar novamente.');
      }
    } finally {
      if (this.recovering === request) this.recovering = undefined;
    }
  }
  private ensureView() {
    if (this.view) return this.view;
    const view = new WebContentsView({ webPreferences: {
      partition: 'persist:team-gemini', nodeIntegration: false, contextIsolation: true, sandbox: true
    } });
    this.view = view;
    view.setVisible(false);
    this.owner.contentView.addChildView(view);
    const contents = view.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    const secure = (value: string) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
    contents.on('will-navigate', (event, url) => { if (!secure(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!secure(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => secure(url) ? {
      action: 'allow', overrideBrowserWindowOptions: {
        parent: this.owner, autoHideMenuBar: true, webPreferences: { partition: 'persist:team-gemini', nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined }
      }
    } : { action: 'deny' });
    const loaded = () => {
      if (this.generating) { this.update(this.state.phase, this.state.message); return; }
      const url = contents.getURL();
      if (isGeminiHome(url)) {
        if (this.recovering !== undefined) return;
        if (!this.homeRecovery) {
          this.update('loading', 'O Google abriu a página inicial. Abrindo o Gem Dev na conta selecionada…');
          const request = this.request;
          void this.recoverHome().then(() => { if (request === this.request && !this.generating && !contents.isDestroyed() && isGeminiHome(contents.getURL())) loaded(); });
        } else this.update('error', 'Não foi possível abrir diretamente o Gem Dev. Tente Reabrir Gem. Como alternativa, abra pelo menu do Gemini.');
      } else if (isGemStartUrl(url)) this.update('ready', 'Gem Dev aberto. Preencha o formulário e clique em Gerar Gem.');
      else this.update('ready', 'Conclua o login com a conta que tem acesso ao Gem Dev. Depois, clique em Reabrir Gem.');
    };
    contents.on('did-finish-load', loaded);
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) loaded(); });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { this.cancel(); this.update('error', 'Não foi possível carregar o Gemini. Tente novamente ou abra no navegador externo.'); }
    });
    contents.on('render-process-gone', () => {
      this.cancel(); this.update('error', 'O navegador do Gemini foi interrompido. Clique em Reabrir Gem.');
    });
    void contents.loadURL(GEM_URL).catch(() => {});
    return view;
  }
  setBounds(bounds: GeminiBounds | null) {
    if (!bounds) {
      this.view?.setVisible(false);
      if (this.generating) { this.cancel(); this.update('ready', 'Preenchimento cancelado ao sair da aba. Clique em Gerar Gem para tentar novamente.'); }
      return;
    }
    const view = this.ensureView();
    const [width, height] = this.owner.getContentSize();
    const x = Math.max(220, Math.min(width, Math.round(bounds.x)));
    const y = Math.max(0, Math.min(height, Math.round(bounds.y)));
    const w = Math.max(0, Math.min(width - x, Math.round(bounds.width)));
    const h = Math.max(0, Math.min(height - y, Math.round(bounds.height)));
    view.setBounds({ x, y, width: w, height: h });
    view.setVisible(w > 0 && h > 0);
  }
  async reopen() {
    this.homeRecovery = false;
    this.cancel(); this.update('loading', 'Abrindo uma nova conversa no Gem…');
    const contents = this.ensureView().webContents;
    try { await contents.loadURL(gemUrlForAccount(contents.getURL())); }
    catch (error) { if (!navigationAborted(error)) throw error; }
  }
  async generate(text: string) {
    if (this.generating) throw new Error('Aguarde o preenchimento atual ou reabra o Gem.');
    const contents = this.ensureView().webContents;
    this.cancel(); this.generating = true;
    this.homeRecovery = false;
    const request = this.request;
    this.update('filling', 'Abrindo nova conversa. Se necessário, entre com a conta da equipe para preencher o texto.');
    try { await contents.loadURL(gemUrlForAccount(contents.getURL())); }
    catch (error) {
      if (request !== this.request) return;
      if (!navigationAborted(error)) { this.cancel(); this.update('error', 'Não foi possível abrir o Gem. Use Reabrir Gem ou o navegador externo.'); return; }
    }
    if (request !== this.request) return;
    const deadline = Date.now() + 120000;
    let checking = false;
    const tick = async () => {
      if (checking || request !== this.request) return;
      if (Date.now() > deadline) {
        this.cancel(); this.update('error', 'O campo do Gem não ficou disponível. Conclua o login e tente novamente, ou use o navegador externo.');
        return;
      }
      if (contents.isLoadingMainFrame()) return;
      if (isGeminiHome(contents.getURL())) {
        if (this.homeRecovery) {
          this.cancel(); this.update('error', 'O link direto voltou ao Gemini comum. O texto não foi preenchido. Abra o Gem Dev pelo menu do Gemini e tente novamente.');
          return;
        }
        checking = true;
        this.update('filling', 'Abrindo o Gem Dev na conta selecionada após o redirecionamento do Google…');
        try { await this.recoverHome(); }
        finally { checking = false; }
        return;
      }
      if (!isGemStartUrl(contents.getURL())) return;
      checking = true;
      try {
        const result = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${focusGemComposer.toString()})()` }], true);
        if (request !== this.request) return;
        if (result === 'occupied' || result === 'conversation') {
          this.cancel(); this.update('error', 'Esta página já contém texto ou uma conversa. O conteúdo foi preservado. Reabra o Gem para tentar novamente.');
        } else if (result === 'ready' && isGemStartUrl(contents.getURL())) {
          await contents.insertText(text);
          if (request !== this.request) return;
          if (!isGemStartUrl(contents.getURL())) return;
          const submitted = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `(${submitGemPrompt.toString()})(${JSON.stringify(text)})` }], true);
          if (request !== this.request) return;
          this.cancel();
          if (submitted === 'sent') this.update('filled', 'Texto enviado ao Gem Dev. Aguarde a resposta no Gemini.');
          else if (submitted === 'no-send-button') this.update('error', 'O texto foi preenchido, mas o botão Enviar do Gem não foi identificado. Confira o texto e envie manualmente.');
          else if (submitted === 'text-mismatch') this.update('error', 'O texto foi preenchido, mas não conferiu integralmente. Revise e envie manualmente.');
          else if (submitted === 'ambiguous') this.update('error', 'Há mais de um botão Enviar disponível. O texto ficou no campo para envio manual.');
          else if (submitted === 'conversation') this.update('error', 'A conversa mudou antes do envio. O texto não foi enviado.');
          else this.update('error', 'A página mudou antes do envio. O texto não foi enviado.');
        }
      } catch { /* The page may be navigating during login; retry until the deadline. */ }
      finally { checking = false; }
    };
    this.timer = setInterval(() => { void tick(); }, 750);
    void tick();
  }
  dispose() {
    this.cancel();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = undefined;
  }
}
