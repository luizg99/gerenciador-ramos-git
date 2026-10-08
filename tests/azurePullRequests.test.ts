import { describe, expect, it, vi } from 'vitest';
import { AzurePullRequests } from '../electron/services/azurePullRequests';
const webUrl = 'https://totvstfs.visualstudio.com/Linha-Winthor/_git/VA41-PCSIS4139';
const info = { webUrl, remote: 'origin', remoteUrl: webUrl, defaultTarget: 'master' };
const pull = (target: string, id: number) => ({ pullRequestId: id, sourceRefName: 'refs/heads/hotfix/DDVENDAS-61611', targetRefName: `refs/heads/${target}`, status: 'active' });
describe('Consulta automática de PRs Azure', () => {
  it('cria três PRs por POST com descrição dos commits e reutiliza os existentes ao repetir', async () => {
    const saved = new Map<string, any>(); const bodies: any[] = [];
    const request = vi.fn<typeof fetch>(async (input, options) => {
      const url = new URL(String(input));
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body)); bodies.push(body);
        const created = { ...body, pullRequestId: 870183 + saved.size, status: 'active' };
        saved.set(body.targetRefName, created); return Response.json(created, { status: 201 });
      }
      const existing = saved.get(url.searchParams.get('searchCriteria.targetRefName')!);
      return Response.json({ value: existing ? [existing] : [] });
    });
    const service = new AzurePullRequests(async () => 'token', request);
    const pairs = ['support/37', 'master', 'release'].map(target => ({ source: 'hotfix/DDVENDAS-61611', target }));
    const describe = vi.fn(async (_source: string, target: string) => `- Correção para ${target}\n  Corpo completo do commit`);
    const first = await service.create('repo', info, pairs, describe);
    expect(first.error).toBeUndefined(); expect(first.prs).toHaveLength(3);
    expect(first.prs.every(pr => pr.created && /\/pullrequest\/\d+$/.test(pr.url))).toBe(true);
    expect(bodies.map(body => body.description)).toEqual(pairs.map(pair => `- Correção para ${pair.target}\n  Corpo completo do commit`));
    expect(bodies.every(body => body.sourceRefName === 'refs/heads/hotfix/DDVENDAS-61611' && body.isDraft === false)).toBe(true);
    const again = await service.create('repo', info, pairs, describe);
    expect(again.prs.every(pr => !pr.created)).toBe(true); expect(bodies).toHaveLength(3);
    expect(describe).toHaveBeenCalledTimes(3);
  });
  it('preserva resultados parciais e interrompe o lote após falha', async () => {
    let writes = 0;
    const request = vi.fn<typeof fetch>(async (_input, options) => {
      if (options?.method !== 'POST') return Response.json({ value: [] });
      writes++;
      if (writes === 2) return new Response('private error', { status: 403 });
      return Response.json({ ...JSON.parse(String(options.body)), pullRequestId: 1 });
    });
    const result = await new AzurePullRequests(async () => 'secret', request).create('repo', info, ['main', 'dev', 'release'].map(target => ({ source: 'feature', target })), async () => '- Commit');
    expect(result.prs).toHaveLength(1); expect(result.prs[0].target).toBe('main');
    expect(result.error).toContain('feature → dev'); expect(result.error).not.toContain('private'); expect(writes).toBe(2);
  });
  it('valida todas as descrições antes de criar qualquer PR', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: [] }));
    // Each response is consumed once.
    request.mockImplementation(async () => Response.json({ value: [] }));
    await expect(new AzurePullRequests(async () => 'token', request).create('repo', info, [{ source: 'feature', target: 'main' }, { source: 'feature', target: 'dev' }], async (_source, target) => target === 'dev' ? '' : '- Commit')).rejects.toThrow('Não há commits');
    expect(request.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  });
  it('busca pelo par exato e usa o ID real na URL do PR, sem devolver credenciais', async () => {
    const authorize = vi.fn(async () => 'Bearer secret');
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ value: [pull('support/37', 870183)] })).mockResolvedValueOnce(Response.json({ value: [pull('master', 870188)] }));
    const result = await new AzurePullRequests(authorize, request).find('repo', info, [{ source: 'origin/hotfix/DDVENDAS-61611', target: 'origin/support/37' }, { source: 'hotfix/DDVENDAS-61611', target: 'master' }]);
    expect(result).toEqual([{ source: 'hotfix/DDVENDAS-61611', target: 'support/37', url: `${webUrl}/pullrequest/870183` }, { source: 'hotfix/DDVENDAS-61611', target: 'master', url: `${webUrl}/pullrequest/870188` }]);
    const [url, options] = request.mock.calls[0];
    expect(String(url).split('?')[0]).toBe('https://totvstfs.visualstudio.com/Linha-Winthor/_apis/git/repositories/VA41-PCSIS4139/pullrequests');
    expect(new URL(String(url)).searchParams.get('searchCriteria.sourceRefName')).toBe('refs/heads/hotfix/DDVENDAS-61611');
    expect(new URL(String(url)).searchParams.get('searchCriteria.targetRefName')).toBe('refs/heads/support/37');
    expect(options?.redirect).toBe('manual'); expect(options?.headers).toEqual({ Authorization: 'Bearer secret', Accept: 'application/json' });
    expect(authorize).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each([
    { value: [], error: 'ainda não encontrado' },
    { value: [pull('master', 1), pull('master', 2)], error: 'mais de um PR ativo' },
    { value: [{ ...pull('master', 1), status: 'completed' }], error: 'ainda não encontrado' },
    { value: [pull('outro', 1)], error: 'ainda não encontrado' }
  ])('não escolhe PR ausente, ambíguo ou de outro destino ($error)', async ({ value, error }) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value }));
    await expect(new AzurePullRequests(async () => 'token', request).find('repo', info, [{ source: 'hotfix/DDVENDAS-61611', target: 'master' }])).rejects.toThrow(error);
  });
  it.each([401, 403, 302, 500])('retorna falha HTTP %i sem expor o corpo ou credencial', async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-body', { status }));
    const promise = new AzurePullRequests(async () => 'secret-token', request).find('repo', info, [{ source: 'hotfix/DDVENDAS-61611', target: 'master' }]);
    await expect(promise).rejects.not.toThrow('secret');
  });
  it('trata falha de rede e respostas não JSON', async () => {
    for (const request of [vi.fn<typeof fetch>().mockRejectedValue(new Error('secret request')), vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Login</html>'))]) {
      await expect(new AzurePullRequests(async () => 'secret-token', request).find('repo', info, [{ source: 'hotfix/DDVENDAS-61611', target: 'master' }])).rejects.not.toThrow('secret');
    }
  });
});
