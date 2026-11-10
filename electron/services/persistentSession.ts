import type { Cookie, Session } from 'electron';
const DAY = 24 * 60 * 60;
const SESSION_COOKIE_DAYS = 30;
const watched = new WeakSet<object>();
// Cookies "de sessão" (sem validade) são descartados pelo Chromium ao fechar o app; é por isso que o login do Jira
// (JSESSIONID e similares) se perdia a cada abertura. Aqui eles ganham validade, como um navegador comum com "manter conectado".
// Cookies que já têm validade (ex.: os do Google) não são alterados.
export function persistentCookie(cookie: Pick<Cookie, 'name' | 'value' | 'domain' | 'hostOnly' | 'path' | 'secure' | 'httpOnly' | 'sameSite'>, nowSeconds: number) {
  const host = (cookie.domain ?? '').replace(/^\./, '');
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
    name: cookie.name, value: cookie.value, path: cookie.path || '/', secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    expirationDate: nowSeconds + SESSION_COOKIE_DAYS * DAY
  };
}
// Mantém os logins entre aberturas: cookies de sessão viram persistentes e o armazenamento é gravado em disco logo após cada mudança
// (o Chromium só gravaria em intervalos, e um fechamento brusco perderia os cookies renovados pelo Google/Atlassian).
export function keepLoginsAcrossRestarts(session: Session, now: () => number = () => Date.now() / 1000) {
  if (watched.has(session)) return;
  watched.add(session);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void session.cookies.flushStore().catch(() => {}); }, 1500); };
  session.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (!removed && cookie.session) void session.cookies.set(persistentCookie(cookie, now())).catch(() => {});
    flush();
  });
}
