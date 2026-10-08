import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../electron/services/gitService';
import { scanRepositories } from '../electron/services/repositoryScanner';
import { ApplicationController } from '../electron/controllers/applicationController';
import { Storage } from '../electron/services/storage';
import type { Snapshot } from '../src/models/domain';
import { change, configure, fixture, git, tempDirectory } from './helpers';
describe('Git real: troca, arquivos, histórico e isolamento', () => {
  it('bloqueia pendências e leva alterações compatíveis no modo carry', async () => {
    const f = await fixture(); let count = 0; const service = new GitService(undefined, async () => { count++; });
    await writeFile(path.join(f.repo, 'README.md'), 'edição local');
    await expect(service.switchBranch(f.repo, 'main', 'block')).rejects.toThrow('alterações locais'); expect(count).toBe(0);
    await service.switchBranch(f.repo, 'main', 'carry'); expect(await git(f.repo, 'branch', '--show-current')).toBe('main');
    expect(await readFile(path.join(f.repo, 'README.md'), 'utf8')).toBe('edição local'); expect(count).toBe(1);
  });
  it('stash guarda alterações staged, unstaged e arquivos novos sem reaplicar', async () => {
    const f = await fixture(); const service = new GitService(undefined, async () => {});
    await writeFile(path.join(f.repo, 'README.md'), 'staged'); await git(f.repo, 'add', 'README.md');
    await writeFile(path.join(f.repo, 'shared.txt'), 'unstaged'); await writeFile(path.join(f.repo, 'novo.txt'), 'novo');
    const result = await service.switchBranch(f.repo, 'main', 'stash');
    expect(result.stash).toMatch(/^[a-f0-9]{40}$/); expect(await git(f.repo, 'status', '--porcelain')).toBe('');
    await git(f.repo, 'switch', f.source); await git(f.repo, 'stash', 'apply', '--index', result.stash!);
    expect(await readFile(path.join(f.repo, 'novo.txt'), 'utf8')).toBe('novo'); expect(await readFile(path.join(f.repo, 'shared.txt'), 'utf8')).toBe('unstaged');
    expect((await service.status(f.repo)).files.find(f => f.path === 'README.md')?.index).toBe('M');
  });
  it('falha no pman preserva o ramo trocado e permite repetir somente a instalação', async () => {
    const f = await fixture(); let fail = true; const service = new GitService(undefined, async () => { if (fail) throw new Error('pman indisponível'); });
    await expect(service.switchBranch(f.repo, 'main', 'block')).rejects.toThrow('Ramo atual: main'); expect(await git(f.repo, 'branch', '--show-current')).toBe('main');
    fail = false; await service.runPman(f.repo); expect(await git(f.repo, 'branch', '--show-current')).toBe('main');
  });
  it('lista e cria ramo remoto localmente acompanhando seu upstream', async () => {
    const f = await fixture(); const service = new GitService(undefined, async () => {});
    await git(f.repo, 'push', 'origin', `${f.base}:refs/heads/DDVENDAS-999-main`);
    const branches = await service.branches(f.repo, true); expect(branches.some(b => b.name === 'origin/DDVENDAS-999-main' && b.remote)).toBe(true);
    await service.switchBranch(f.repo, 'origin/DDVENDAS-999-main', 'block');
    expect((await service.status(f.repo)).upstream).toBe('origin/DDVENDAS-999-main');
  });
  it('status, staging literal, unstage, diff, commit e push preservam os demais arquivos', async () => {
    const f = await fixture(); const service = new GitService();
    await writeFile(path.join(f.repo, '[a].txt'), 'arquivo literal'); await writeFile(path.join(f.repo, 'a.txt'), 'outro arquivo');
    const initial = await service.status(f.repo); expect(initial.files.map(f => f.path)).toContain('[a].txt');
    await service.stage(f.repo, ['[a].txt'], false); let status = await service.status(f.repo);
    expect(status.files.find(f => f.path === '[a].txt')?.index).toBe('A'); expect(status.files.find(f => f.path === 'a.txt')?.index).toBe('?');
    expect(await service.workingDiff(f.repo, '[a].txt', true)).toContain('+arquivo literal');
    await service.stage(f.repo, ['[a].txt'], true); expect((await service.status(f.repo)).files.find(f => f.path === '[a].txt')?.index).toBe('?');
    await expect(service.commit(f.repo, '   ')).rejects.toThrow('mensagem');
    await service.stage(f.repo, ['[a].txt'], false); await service.commit(f.repo, 'Adiciona arquivo com colchetes'); await service.push(f.repo);
    expect(await git(f.remote, 'show', `${f.source}:[a].txt`)).toBe('arquivo literal');
    expect((await service.status(f.repo)).files.map(f => f.path)).toEqual(['a.txt']);
    await expect(service.stage(f.repo, ['../fora.txt'], false)).rejects.toThrow('lista de alterações');
  });
  it('detecta cherry-pick externo em andamento e impede a troca', async () => {
    const f = await fixture(); const service = new GitService(undefined, async () => {});
    await git(f.repo, 'switch', 'dev'); await change(f.repo, 'shared.txt', 'conflito', 'Conflito'); await expect(git(f.repo, 'cherry-pick', f.second)).rejects.toThrow();
    await expect(service.switchBranch(f.repo, 'main', 'stash')).rejects.toThrow('operação Git em andamento');
    expect(await git(f.repo, 'branch', '--show-current')).toBe('dev'); await git(f.repo, 'cherry-pick', '--abort');
  });
  it('scanner deduplica raízes, reconhece worktrees e ignora node_modules', async () => {
    const f = await fixture(); await git(f.repo, 'worktree', 'add', path.join(f.root, 'linked'), 'main');
    const ignored = path.join(f.root, 'node_modules', 'ignored'); await mkdir(ignored, { recursive: true }); await git(ignored, 'init');
    const repos = await scanRepositories([f.root, f.repo]); expect(repos.map(r => r.name).sort()).toEqual(['linked', 'work']);
  });
  it('controlador bloqueia concorrência e rejeita repositório não ativo', async () => {
    const directory = await tempDirectory('app-'); const app = new ApplicationController(new GitService(), new Storage(directory));
    let release!: () => void;
    const first = app.exclusive(() => new Promise<void>(resolve => { release = resolve; }));
    await expect(app.exclusive(async () => {})).rejects.toThrow('em andamento'); expect(() => app.repository('arbitrary')).toThrow('Selecione');
    release(); await first; expect(app.busy).toBe(false);
    await expect(app.exclusive(async () => { throw new Error('falha'); })).rejects.toThrow('falha'); expect(app.busy).toBe(false);
  });
  it('abre com a lista salva, atualiza em segundo plano e recusa projeto que deixou de existir', async () => {
    const f = await fixture(); const storage = new Storage(await tempDirectory('app-'));
    const [work] = await scanRepositories([f.root]);
    const gone = { id: 'f'.repeat(24), path: path.join(f.root, 'apagado'), name: 'apagado' };
    await storage.saveSettings({ roots: [f.root], activeRepository: gone.id }); await storage.saveRepositories([gone, work]);
    const changes: Snapshot[] = []; const app = new ApplicationController(new GitService(), storage, undefined, snapshot => changes.push(snapshot));
    const extra = path.join(f.root, 'extra'); await mkdir(extra); await git(extra, 'init');
    await app.initialize();
    expect(app.snapshot()).toMatchObject({ scanning: true, repositories: [work], settings: { activeRepository: undefined } });
    await vi.waitFor(() => expect(changes.at(-1)?.scanning).toBe(false));
    expect(app.repositories.map(r => r.name)).toEqual(['extra', 'work']); expect((await storage.repositories()).map(r => r.name)).toEqual(['extra', 'work']);
    const added = app.repositories.find(r => r.name === 'extra')!; await rm(extra, { recursive: true, force: true });
    await expect(app.select(added.id)).rejects.toThrow('não existe mais');
    expect(app.repositories.map(r => r.name)).toEqual(['work']); expect(changes.at(-1)?.repositories.map(r => r.name)).toEqual(['work']); expect(app.settings.activeRepository).toBeUndefined();
    await app.select(work.id); expect(app.settings.activeRepository).toBe(work.id);
  });
  it('histórico e diff incluem os arquivos e conteúdo corretos', async () => {
    const f = await fixture(); const service = new GitService(); const commits = await service.log(f.repo, f.source);
    expect(commits[0].hash).toBe(f.second); expect(commits[1].hash).toBe(f.first); expect(commits[0].author).toBe('Teste Ramos');
    const detail = await service.detail(f.repo, f.second); expect(detail.files).toContain('shared.txt'); expect(detail.diff).toContain('+origem'); expect(detail.diff).toContain('-base');
  });
  it('cria ramo a partir de uma base, troca para ele, publica e valida nomes', async () => {
    const f = await fixture(); let pman = 0; const service = new GitService(undefined, async () => { pman++; });
    await expect(service.createBranch(f.repo, 'dev', 'main', 'block', false)).rejects.toThrow('já existe');
    await expect(service.createBranch(f.repo, 'nome com espaço', 'main', 'block', false)).rejects.toThrow();
    await expect(service.createBranch(f.repo, 'feature/x', 'nao-existe', 'block', false)).rejects.toThrow('base não encontrado');
    const result = await service.createBranch(f.repo, 'feature/nova', 'origin/main', 'block', true);
    expect(result).toMatchObject({ branch: 'feature/nova', published: true }); expect(pman).toBe(1);
    expect(await git(f.repo, 'branch', '--show-current')).toBe('feature/nova');
    expect(await git(f.repo, 'rev-parse', 'HEAD')).toBe(f.base);
    expect(await git(f.remote, 'rev-parse', 'feature/nova')).toBe(f.base);
    expect(await git(f.repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature/nova');
    await writeFile(path.join(f.repo, 'README.md'), 'pendente');
    await expect(service.createBranch(f.repo, 'feature/bloqueada', 'main', 'block', false)).rejects.toThrow('alterações locais');
    expect((await git(f.repo, 'branch', '--list', 'feature/bloqueada'))).toBe('');
  });
  it('cria até 4 ramos em lote, encadeando bases, publicando e trocando para o escolhido', async () => {
    const f = await fixture(); let pman = 0; const service = new GitService(undefined, async () => { pman++; });
    const before = await git(f.repo, 'branch', '--list');
    await expect(service.createBranches(f.repo, [{ name: 'lote/a', base: 'main' }, { name: 'lote/a', base: 'main' }], null, 'block', false)).rejects.toThrow('mais de uma vez');
    await expect(service.createBranches(f.repo, [{ name: 'lote/a', base: 'main' }, { name: 'dev', base: 'main' }], null, 'block', false)).rejects.toThrow('já existe');
    await expect(service.createBranches(f.repo, [{ name: 'lote/a', base: 'lote/b' }, { name: 'lote/b', base: 'main' }], null, 'block', false)).rejects.toThrow('base não encontrado');
    expect(await git(f.repo, 'branch', '--list')).toBe(before);
    const solo = await service.createBranches(f.repo, [{ name: 'lote/solo', base: 'dev' }], null, 'block', false);
    expect(solo).toEqual({ created: ['lote/solo'], published: [], failures: [] }); expect(pman).toBe(0);
    expect(await git(f.repo, 'branch', '--show-current')).toBe(f.source);
    const result = await service.createBranches(f.repo, [{ name: 'lote/a', base: 'origin/main' }, { name: 'lote/b', base: 'lote/a' }, { name: 'lote/c', base: f.source }], 1, 'block', true);
    expect(result).toMatchObject({ created: ['lote/a', 'lote/b', 'lote/c'], published: ['lote/a', 'lote/b', 'lote/c'], failures: [], branch: 'lote/b' }); expect(pman).toBe(1);
    expect(await git(f.repo, 'branch', '--show-current')).toBe('lote/b');
    expect(await git(f.repo, 'rev-parse', 'lote/b')).toBe(f.base); expect(await git(f.repo, 'rev-parse', 'lote/c')).toBe(f.second);
    expect(await git(f.remote, 'rev-parse', 'lote/c')).toBe(f.second); expect(await git(f.repo, 'rev-parse', '--abbrev-ref', 'lote/a@{upstream}')).toBe('origin/lote/a');
  });
  it('com "Usa pman" desmarcado nenhum fluxo executa o pman; marcado, tudo continua igual', async () => {
    const f = await fixture(); let pman = 0; const service = new GitService(undefined, async () => { pman++; });
    service.usePman = false;
    expect(await service.switchBranch(f.repo, 'dev', 'block')).toMatchObject({ branch: 'dev' });
    expect(await service.createBranch(f.repo, 'sem-pman/um', 'dev', 'block', false)).toMatchObject({ branch: 'sem-pman/um' });
    expect(await service.createBranches(f.repo, [{ name: 'sem-pman/dois', base: 'dev' }], 0, 'block', false)).toMatchObject({ branch: 'sem-pman/dois' });
    await expect(service.runPman(f.repo)).rejects.toThrow('desativado');
    expect(pman).toBe(0);
    service.usePman = true;
    await service.switchBranch(f.repo, 'main', 'block'); await service.runPman(f.repo);
    expect(pman).toBe(2);
  });
  it('configuração "Usa pman" começa desmarcada, é gravada no settings.json e vale após reiniciar', async () => {
    const directory = await tempDirectory('app-'); const storage = new Storage(directory);
    const first = new ApplicationController(new GitService(), storage); await first.initialize();
    expect(first.snapshot().settings.usePman ?? false).toBe(false); expect(first.git.usePman).toBe(false);
    expect((await first.updateSettings({ usePman: true })).settings.usePman).toBe(true); expect(first.git.usePman).toBe(true);
    expect((await storage.settings()).usePman).toBe(true);
    const second = new ApplicationController(new GitService(), storage); await second.initialize();
    expect(second.snapshot().settings.usePman).toBe(true); expect(second.git.usePman).toBe(true);
    await second.updateSettings({ usePman: false }); expect((await storage.settings()).usePman).toBe(false);
  });
  it('monta o link de PR do Azure só para ramos que existem no remoto', async () => {
    const f = await fixture(); const service = new GitService();
    expect(await service.pullRequestInfo(f.repo)).toMatchObject({ remote: 'origin', webUrl: null });
    await git(f.repo, 'remote', 'set-url', 'origin', 'https://org@dev.azure.com/org/Vendas/_git/Portal');
    await git(f.repo, 'remote', 'set-url', '--push', 'origin', f.remote);
    expect((await service.pullRequestInfo(f.repo)).webUrl).toBe('https://dev.azure.com/org/Vendas/_git/Portal');
    expect(await service.pullRequestUrl(f.repo, f.source, 'origin/dev')).toBe(`https://dev.azure.com/org/Vendas/_git/Portal/pullrequestcreate?sourceRef=${encodeURIComponent(f.source)}&targetRef=dev`);
    await git(f.repo, 'switch', '-c', 'so-local');
    await expect(service.pullRequestUrl(f.repo, 'so-local', 'main')).rejects.toThrow('ainda não está no remoto');
    await expect(service.pullRequestUrl(f.repo, 'dev', 'dev')).rejects.toThrow('diferentes');
    expect(await service.pullRequestUrls(f.repo, [{ source: 'dev', target: 'main' }, { source: 'release', target: 'origin/main' }])).toEqual(['dev', 'release'].map(b => `https://dev.azure.com/org/Vendas/_git/Portal/pullrequestcreate?sourceRef=${b}&targetRef=main`));
    await expect(service.pullRequestUrls(f.repo, [{ source: 'dev', target: 'main' }, { source: 'so-local', target: 'main' }])).rejects.toThrow('ainda não está no remoto');
    await expect(service.pullRequestUrls(f.repo, [{ source: 'dev', target: 'main' }, { source: 'origin/dev', target: 'main' }])).rejects.toThrow('mais de uma vez');
  });
  it('descarta modificados, excluídos, renomeados e arquivos novos sem tocar nos demais', async () => {
    const f = await fixture(); const service = new GitService(); const file = (name: string) => readFile(path.join(f.repo, name), 'utf8');
    await writeFile(path.join(f.repo, 'shared.txt'), 'preparado\n'); await git(f.repo, 'add', 'shared.txt'); await writeFile(path.join(f.repo, 'shared.txt'), 'preparado\nmais\n');
    await rm(path.join(f.repo, 'README.md')); await git(f.repo, 'mv', 'first.txt', 'renomeado.txt');
    await writeFile(path.join(f.repo, 'novo.txt'), 'novo'); await git(f.repo, 'add', 'novo.txt'); await writeFile(path.join(f.repo, 'solto.txt'), 'linha 1\nlinha 2\n');
    await writeFile(path.join(f.repo, 'source', 'dependencies.txt'), 'manter');
    const untrackedDiff = await service.workingDiff(f.repo, 'solto.txt', false);
    expect(untrackedDiff).toContain('@@ -0,0 +1,2 @@'); expect(untrackedDiff).toContain('+linha 2');
    await expect(service.discard(f.repo, ['../fora.txt'])).rejects.toThrow('lista de alterações');
    await service.discard(f.repo, ['shared.txt', 'README.md', 'renomeado.txt', 'novo.txt', 'solto.txt']);
    expect((await service.status(f.repo)).files.map(v => v.path)).toEqual(['source/dependencies.txt']);
    expect(await file('shared.txt')).toBe('origem\n'); expect(await file('README.md')).toBe('Projeto\n'); expect(await file('first.txt')).toBe('primeiro\n');
    for (const gone of ['renomeado.txt', 'novo.txt', 'solto.txt']) await expect(file(gone)).rejects.toThrow();
    expect(await file('source/dependencies.txt')).toBe('manter');
    const unborn = await tempDirectory('unborn-'); await git(unborn, 'init', '-b', 'main');
    await writeFile(path.join(unborn, 'a.txt'), 'a'); await git(unborn, 'add', 'a.txt'); await writeFile(path.join(unborn, 'b.txt'), 'b');
    await service.discard(unborn, ['a.txt', 'b.txt']); expect((await service.status(unborn)).files).toEqual([]);
  });
  it('prepara e retira arquivos do primeiro commit sem remover o arquivo do disco', async () => {
    const repo = await tempDirectory('unborn-'); await git(repo, 'init', '-b', 'main'); await configure(repo); const service = new GitService();
    await writeFile(path.join(repo, 'primeiro.txt'), 'conteúdo'); await service.stage(repo, ['primeiro.txt'], false); await service.stage(repo, ['primeiro.txt'], true);
    expect(await readFile(path.join(repo, 'primeiro.txt'), 'utf8')).toBe('conteúdo'); expect((await service.status(repo)).files[0].index).toBe('?');
  });
  it('carry incompatível falha sem executar pman nem descartar alterações', async () => {
    const f = await fixture(); let pman = false; const service = new GitService(undefined, async () => { pman = true; });
    await writeFile(path.join(f.repo, 'shared.txt'), 'minha edição pendente');
    await expect(service.switchBranch(f.repo, 'main', 'carry')).rejects.toThrow(); expect(pman).toBe(false);
    expect(await git(f.repo, 'branch', '--show-current')).toBe(f.source); expect(await readFile(path.join(f.repo, 'shared.txt'), 'utf8')).toBe('minha edição pendente');
  });
});
