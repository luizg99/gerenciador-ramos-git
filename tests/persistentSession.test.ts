import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';
import { keepLoginsAcrossRestarts, persistentCookie } from '../electron/services/persistentSession';
const sessionCookie = { name: 'JSESSIONID', value: 'x', domain: 'jiraproducao.totvs.com.br', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const, session: true };
function fakeSession() {
  const cookies = Object.assign(new EventEmitter(), { set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) });
  return { session: { cookies } as unknown as Session, cookies };
}
describe('logins persistentes', () => {
  it('dá validade de 30 dias ao cookie de sessão, preservando host, caminho e flags', () => {
    const result = persistentCookie(sessionCookie, 1000);
    expect(result).toMatchObject({ url: 'https://jiraproducao.totvs.com.br/', name: 'JSESSIONID', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1000 + 30 * 86400 });
    expect(result).not.toHaveProperty('domain');
    expect(persistentCookie({ ...sessionCookie, hostOnly: false, domain: '.totvs.com.br' }, 0)).toMatchObject({ url: 'https://totvs.com.br/', domain: '.totvs.com.br' });
  });
  it('converte só cookies de sessão e grava o armazenamento após mudanças', () => {
    vi.useFakeTimers();
    try {
      const { session, cookies } = fakeSession();
      keepLoginsAcrossRestarts(session, () => 500); keepLoginsAcrossRestarts(session, () => 500);
      cookies.emit('changed', {}, sessionCookie, 'explicit', false);
      cookies.emit('changed', {}, { ...sessionCookie, session: false }, 'explicit', false);
      cookies.emit('changed', {}, sessionCookie, 'explicit', true);
      expect(cookies.set).toHaveBeenCalledTimes(1);
      expect(cookies.flushStore).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500);
      expect(cookies.flushStore).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
