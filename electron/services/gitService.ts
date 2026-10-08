import { access, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BatchResult, Branch, Commit, CommitDetail, FileChange, PullRequestInfo, Status, SwitchMode, SwitchResult } from '../../src/models/domain';
import { azureRepoWebUrl, pullRequestCreateUrl } from './azure';
import { hash, ref } from '../../src/models/validation';
import { redact, runGit, runProcess } from './processRunner';
export type Reporter = (repo: string, message: string) => void;
export class GitService {
  // Desligado pela configuração "Usa pman" do aplicativo; o serviço sozinho mantém o comportamento original.
  usePman = true;
  constructor(private report: Reporter = () => {}, private pmanOverride?: (repo: string) => Promise<void>) {}
  git = runGit;
  async head(repo: string) { return (await this.git(repo, ['rev-parse', '--verify', 'HEAD'])).trim(); }
  async operation(repo: string): Promise<string | null> {
    const directory = (await this.git(repo, ['rev-parse', '--absolute-git-dir'])).trim();
    const markers = ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START'];
    const existing = await Promise.all(markers.map(name => access(path.join(directory, name)).then(() => name).catch(() => null)));
    return existing.find(Boolean) ?? null;
  }
  async changes(repo: string): Promise<FileChange[]> {
    const raw = await this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const tokens = raw.split('\0'); const files: FileChange[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]; if (!token) continue;
      const file: FileChange = { index: token[0], worktree: token[1], path: token.slice(3) };
      if (/[RC]/.test(file.index + file.worktree)) file.originalPath = tokens[++i];
      files.push(file);
    }
    return files;
  }
  // Os comandos são independentes; rodar em paralelo reduz bastante o tempo no Windows.
  async status(repo: string): Promise<Status> {
    const [files, branch, upstream, counts, operation] = await Promise.all([
      this.changes(repo),
      this.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(s => s.trim()).catch(() => '(HEAD destacado)'),
      this.git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(s => s.trim()).catch(() => null),
      this.git(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).then(s => s.trim().split(/\s+/).map(Number)).catch(() => [0, 0]),
      this.operation(repo)
    ]);
    const [ahead, behind] = upstream ? counts : [0, 0];
    return { branch, files, upstream, ahead, behind, operation };
  }
  async ensureIdle(repo: string, clean = true) {
    const status = await this.status(repo);
    if (status.operation) throw new Error(`Existe uma operação Git em andamento (${status.operation}). Conclua ou cancele manualmente.`);
    if (clean && status.files.length) throw new Error('Há alterações locais. Faça commit ou guarde as alterações antes de continuar.');
    return status;
  }
  async branches(repo: string, fetch = false): Promise<Branch[]> {
    if (fetch) { this.report(repo, 'Atualizando ramos remotos…'); await this.git(repo, ['fetch', '--all', '--prune']); }
    const rows = await this.git(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(HEAD)%09%(upstream:short)%09%(symref)', 'refs/heads', 'refs/remotes']);
    return rows.trim().split('\n').filter(Boolean).flatMap(row => {
      const [fullRef, current, upstream, symref] = row.trimEnd().split('\t');
      if (symref) return [];
      const remote = fullRef.startsWith('refs/remotes/');
      return [{ ref: fullRef, name: fullRef.replace(/^refs\/(heads|remotes)\//, ''), remote, current: current === '*', upstream: upstream ?? '' }];
    });
  }
  async resolveBranch(repo: string, value: string): Promise<{ name: string; remote?: string; remoteBranch?: string }> {
    ref.parse(value);
    const branch = (await this.branches(repo)).find(b => b.ref === value || b.name === value);
    if (!branch) throw new Error(`Ramo não encontrado: ${value}. Atualize os ramos remotos.`);
    if (!branch.remote) return { name: branch.name };
    const remotes = (await this.git(repo, ['remote'])).trim().split('\n').sort((a, b) => b.length - a.length);
    const remote = remotes.find(r => branch.name.startsWith(r + '/'));
    if (!remote) throw new Error('Remoto não encontrado.');
    return { name: branch.name.slice(remote.length + 1), remote, remoteBranch: branch.name.slice(remote.length + 1) };
  }
  async checkout(repo: string, value: string) {
    const target = await this.resolveBranch(repo, value);
    const exists = (await this.branches(repo)).some(b => !b.remote && b.name === target.name);
    if (exists && target.remote) {
      const upstream = (await this.git(repo, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${target.name}`])).trim();
      if (upstream !== `${target.remote}/${target.remoteBranch}`) throw new Error(`O ramo local ${target.name} não acompanha ${target.remote}/${target.remoteBranch}. Selecione o ramo local ou ajuste seu upstream.`);
    }
    if (!exists && target.remote) await this.git(repo, ['switch', '--track', '-c', target.name, `refs/remotes/${target.remote}/${target.remoteBranch}`]);
    else await this.git(repo, ['switch', '--', target.name]);
    return target.name;
  }
  // Avisa o aplicativo quando o pman termina (o usuário costuma estar com a janela minimizada).
  onPmanFinished?: (repo: string, error?: Error) => void;
  async runPman(repo: string) {
    try { await this.runPmanInner(repo); this.onPmanFinished?.(repo); }
    catch (error) { this.onPmanFinished?.(repo, error as Error); throw error; }
  }
  private async runPmanInner(repo: string) {
    if (!this.usePman) throw new Error('O pman está desativado em Configurações.');
    this.report(repo, 'Executando pman install -f em source…');
    if (this.pmanOverride) return this.pmanOverride(repo);
    const cwd = path.join(repo, 'source');
    if (!await stat(cwd).then(s => s.isDirectory()).catch(() => false)) throw new Error('O ramo foi alterado, mas a pasta source não existe. Corrija e tente a instalação novamente.');
    // The shell receives only this constant command; no repository path or user text is interpolated.
    if (process.platform === 'win32') await runProcess('cmd.exe', ['/d', '/s', '/c', 'pman install -f'], cwd, s => this.report(repo, s), 15 * 60_000);
    else await runProcess('pman', ['install', '-f'], cwd, s => this.report(repo, s), 15 * 60_000);
  }
  async switchBranch(repo: string, value: string, mode: SwitchMode, install = true): Promise<SwitchResult> {
    const status = await this.ensureIdle(repo, mode === 'block');
    await this.resolveBranch(repo, value);
    let stash: string | undefined;
    if (mode === 'stash' && status.files.length) {
      await this.git(repo, ['stash', 'push', '--include-untracked', '-m', `Gerenciador de Ramos ${new Date().toISOString()}`]);
      stash = (await this.git(repo, ['rev-parse', 'refs/stash'])).trim();
      this.report(repo, `Alterações guardadas no stash ${stash}. O stash não será reaplicado automaticamente.`);
    }
    this.report(repo, 'Trocando ramo…');
    const branch = await this.checkout(repo, value);
    if (this.usePman && install) try { await this.runPman(repo); } catch (error) { throw new Error(`Ramo atual: ${branch}. Instalação falhou: ${(error as Error).message}${stash ? ` Stash preservado: ${stash}.` : ''}`); }
    return { branch, stash };
  }
  // Cria o ramo a partir da base e troca para ele pelo mesmo fluxo da troca (modo de alterações + pman).
  async createBranch(repo: string, name: string, base: string, mode: SwitchMode, publish: boolean, install = true): Promise<SwitchResult & { published: boolean }> {
    ref.parse(name); ref.parse(base);
    if (!(await this.git(repo, ['check-ref-format', '--branch', name]).then(() => true).catch(() => false))) throw new Error(`Nome de ramo inválido: ${name}.`);
    const branches = await this.branches(repo);
    if (branches.some(b => b.name === name || b.remote && b.name.slice(b.name.indexOf('/') + 1) === name)) throw new Error(`O ramo ${name} já existe. Selecione-o na lista para trocar.`);
    const start = branches.find(b => b.name === base || b.ref === base);
    if (!start) throw new Error(`Ramo de base não encontrado: ${base}.`);
    await this.ensureIdle(repo, mode === 'block');
    this.report(repo, `Criando ramo ${name} a partir de ${start.name}…`);
    await this.git(repo, ['branch', '--no-track', name, start.ref]);
    let result: SwitchResult;
    try { result = await this.switchBranch(repo, name, mode, install); }
    catch (error) {
      // Se nem chegou a trocar, o ramo recém-criado não tem nada próprio: remove para não deixar lixo.
      const current = await this.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(s => s.trim()).catch(() => '');
      if (current !== name) await this.git(repo, ['branch', '-D', name]).catch(() => {});
      throw error;
    }
    if (!publish) return { ...result, published: false };
    try { await this.push(repo); } catch (error) { throw new Error(`Ramo ${name} criado e selecionado, mas o envio para o remoto falhou: ${(error as Error).message}`); }
    return { ...result, published: true };
  }
  // Criação em lote: valida tudo antes, cria sem trocar (desfazendo se algo falhar), publica e, se pedido, troca para um deles.
  async createBranches(repo: string, items: { name: string; base: string }[], switchTo: number | null, mode: SwitchMode, publish: boolean, install = true): Promise<BatchResult> {
    if (!items.length || items.length > 4) throw new Error('Informe de 1 a 4 ramos.');
    if (switchTo !== null && !items[switchTo]) throw new Error('Ramo para trocar inválido.');
    const branches = await this.branches(repo);
    const exists = (name: string) => branches.some(b => b.name === name || b.remote && b.name.slice(b.name.indexOf('/') + 1) === name);
    const starts: string[] = [];
    for (const [index, { name, base }] of items.entries()) {
      ref.parse(name); ref.parse(base);
      if (!(await this.git(repo, ['check-ref-format', '--branch', name]).then(() => true).catch(() => false))) throw new Error(`Nome de ramo inválido: ${name}.`);
      if (exists(name)) throw new Error(`O ramo ${name} já existe.`);
      if (items.findIndex(i => i.name === name) !== index) throw new Error(`O nome ${name} foi informado mais de uma vez.`);
      const earlier = items.slice(0, index).some(i => i.name === base);
      const start = earlier ? `refs/heads/${base}` : branches.find(b => b.name === base || b.ref === base)?.ref;
      if (!start) throw new Error(`Ramo de base não encontrado para ${name}: ${base}.`);
      starts.push(start);
    }
    await this.ensureIdle(repo, switchTo !== null && mode === 'block');
    const created: string[] = [];
    try {
      for (const [index, { name, base }] of items.entries()) {
        this.report(repo, `Criando ramo ${name} a partir de ${base}…`);
        await this.git(repo, ['branch', '--no-track', name, starts[index]]); created.push(name);
      }
    } catch (error) {
      for (const name of created.reverse()) await this.git(repo, ['branch', '-D', name]).catch(() => {});
      throw new Error(`Nenhum ramo foi criado: ${(error as Error).message}`);
    }
    const published: string[] = [], failures: string[] = [];
    if (publish) {
      const remotes = (await this.git(repo, ['remote'])).trim().split('\n').filter(Boolean);
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];
      if (!remote) failures.push('nenhum remoto configurado');
      else for (const name of created) {
        this.report(repo, `Enviando ${name} para ${remote}…`);
        try { await this.git(repo, ['push', '--set-upstream', '--', remote, `refs/heads/${name}:refs/heads/${name}`]); published.push(name); }
        catch (error) { failures.push(`${name}: ${(error as Error).message}`); }
      }
    }
    const result: BatchResult = { created, published, failures };
    if (switchTo === null) return result;
    try { return { ...result, ...await this.switchBranch(repo, items[switchTo].name, mode, install) }; }
    catch (error) { throw new Error(`Ramos criados: ${created.join(', ')}. A troca para ${items[switchTo].name} falhou: ${(error as Error).message}`); }
  }
  async pullRequestInfo(repo: string): Promise<PullRequestInfo> {
    const remotes = (await this.git(repo, ['remote'])).trim().split('\n').filter(Boolean);
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    if (!remote) return { remote: null, remoteUrl: null, webUrl: null, defaultTarget: null };
    const remoteUrl = (await this.git(repo, ['config', '--get', `remote.${remote}.url`]).catch(() => '')).trim();
    const head = (await this.git(repo, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]).catch(() => '')).trim();
    return { remote, remoteUrl: redact(remoteUrl), webUrl: azureRepoWebUrl(remoteUrl), defaultTarget: head.startsWith(remote + '/') ? head.slice(remote.length + 1) : null };
  }
  async pullRequestUrl(repo: string, source: string, target: string) { return (await this.pullRequestUrls(repo, [{ source, target }]))[0]; }
  async pullRequestCommitMessages(repo: string, remote: string, source: string, target: string) {
    ref.parse(source); ref.parse(target);
    const from = `refs/remotes/${remote}/${source}`, to = `refs/remotes/${remote}/${target}`;
    const messages = await this.git(repo, ['log', '--reverse', '--format=%B%x00', `${to}..${from}`, '--']);
    return messages.split('\0').map(message => message.trim()).filter(Boolean).map(message => `- ${message.replace(/\n/g, '\n  ')}`).join('\n\n');
  }
  // Valida todos os pares antes de devolver qualquer link: ou abre todos, ou nenhum.
  async pullRequestUrls(repo: string, pairs: { source: string; target: string }[]) {
    if (!pairs.length || pairs.length > 4) throw new Error('Informe de 1 a 4 pull requests.');
    const info = await this.pullRequestInfo(repo);
    if (!info.webUrl || !info.remote) throw new Error('O remoto deste repositório não é do Azure DevOps.');
    const short = (value: string) => value.startsWith(info.remote + '/') ? value.slice(info.remote!.length + 1) : value;
    const remoteBranches = new Set((await this.branches(repo)).filter(b => b.remote).map(b => b.name));
    const seen = new Set<string>();
    return pairs.map(({ source, target }) => {
      ref.parse(source); ref.parse(target);
      const [from, to] = [short(source), short(target)];
      if (from === to) throw new Error(`Origem e destino do pull request devem ser diferentes (${from}).`);
      if (seen.has(`${from}→${to}`)) throw new Error(`O pull request ${from} → ${to} foi informado mais de uma vez.`);
      seen.add(`${from}→${to}`);
      if (!remoteBranches.has(`${info.remote}/${from}`)) throw new Error(`O ramo ${from} ainda não está no remoto. Envie-o antes de abrir o pull request.`);
      if (!remoteBranches.has(`${info.remote}/${to}`)) throw new Error(`O ramo de destino ${to} não existe no remoto.`);
      return pullRequestCreateUrl(info.webUrl!, from, to);
    });
  }
  async log(repo: string, value: string, skip = 0): Promise<Commit[]> {
    ref.parse(value);
    const resolved = await this.git(repo, ['rev-parse', '--verify', `${value}^{commit}`]).then(s => s.trim()).catch(() => null);
    if (!resolved) return [];
    const raw = await this.git(repo, ['log', '--topo-order', '-100', `--skip=${skip}`, '--format=%H%x00%P%x00%an%x00%aI%x00%s', resolved, '--']);
    return raw.trimEnd().split('\n').filter(Boolean).map(line => {
      const [hash, parents, author, date, subject] = line.split('\0');
      return { hash, parents: parents ? parents.split(' ') : [], author, date, subject };
    });
  }
  async detail(repo: string, value: string): Promise<CommitDetail> {
    hash.parse(value);
    const [fileOutput, diff] = await Promise.all([
      this.git(repo, ['show', '--format=', '--name-only', '-z', value, '--']),
      this.git(repo, ['show', '--format=fuller', '--no-ext-diff', '--no-textconv', '--no-renames', value, '--'])
    ]);
    const files = fileOutput.split('\0').filter(Boolean);
    return { files, diff };
  }
  async commitFileDiff(repo: string, value: string, file: string): Promise<string> {
    hash.parse(value);
    if (!file || file.includes('\0')) throw new Error('Arquivo inválido.');
    return this.git(repo, ['show', '--format=fuller', '--no-ext-diff', '--no-textconv', '--no-renames', value, '--', `:(literal)${file}`]);
  }
  async workingDiff(repo: string, file: string, staged: boolean) {
    const status = await this.status(repo);
    const change = status.files.find(f => f.path === file);
    if (!change) throw new Error('Arquivo não está mais na lista de alterações.');
    if (change.index === '?') {
      const absolute = this.inside(repo, file);
      const info = await stat(absolute);
      if (info.size > 1_000_000) return 'Arquivo novo maior que 1 MB. Abra-o no editor para revisar.';
      const buffer = await readFile(absolute);
      if (buffer.includes(0)) return 'Arquivo binário novo.';
      // Monta um diff de arquivo novo para a tela mostrar como adição, com numeração.
      const lines = buffer.toString('utf8').split(/\r?\n/); if (lines[lines.length - 1] === '') lines.pop();
      return [`diff --git a/${file} b/${file}`, 'new file', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => '+' + line)].join('\n');
    }
    return this.git(repo, ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--', `:(literal)${file}`]);
  }
  async stage(repo: string, files: string[], unstage: boolean) {
    // Só o necessário: lista de arquivos e operação em andamento, em paralelo.
    const [changes, operation, hasHead] = await Promise.all([this.changes(repo), this.operation(repo), unstage ? this.head(repo).then(() => true).catch(() => false) : true]);
    if (operation) throw new Error(`Existe uma operação Git em andamento (${operation}). Conclua ou cancele manualmente.`);
    const allowed = new Set(changes.flatMap(f => [f.path, ...(f.originalPath ? [f.originalPath] : [])]));
    if (!files.length || files.some(f => !allowed.has(f))) throw new Error('Selecione arquivos presentes na lista de alterações.');
    const paths = [...new Set(files.flatMap(f => { const entry = changes.find(v => v.path === f); return [f, ...(entry?.originalPath ? [entry.originalPath] : [])]; }))];
    const literalPaths = paths.map(p => `:(literal)${p}`);
    await this.git(repo, unstage ? hasHead ? ['restore', '--staged', '--', ...literalPaths] : ['rm', '--cached', '--', ...literalPaths] : ['add', '--', ...literalPaths]);
  }
  private inside(repo: string, file: string) {
    const absolute = path.resolve(repo, file);
    if (!absolute.startsWith(path.resolve(repo) + path.sep)) throw new Error('Arquivo fora do repositório.');
    return absolute;
  }
  // Volta os arquivos ao estado do último commit (índice e disco). Arquivos novos são apagados.
  async discard(repo: string, files: string[]) {
    await this.ensureIdle(repo, false);
    const status = await this.status(repo);
    const entries = files.map(f => status.files.find(v => v.path === f));
    if (!files.length || entries.some(e => !e)) throw new Error('Selecione arquivos presentes na lista de alterações.');
    const changes = entries as FileChange[];
    const untracked = changes.filter(e => e.index === '?').map(e => this.inside(repo, e.path));
    const tracked = changes.filter(e => e.index !== '?');
    if (tracked.length) {
      const literalPaths = [...new Set(tracked.flatMap(e => [e.path, ...(e.originalPath ? [e.originalPath] : [])]))].map(p => `:(literal)${p}`);
      if (await this.head(repo).then(() => true).catch(() => false)) await this.git(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...literalPaths]);
      else {
        // Sem commits ainda: tudo que está no índice é arquivo novo.
        await this.git(repo, ['rm', '--cached', '-q', '-f', '--', ...literalPaths]);
        untracked.push(...tracked.map(e => this.inside(repo, e.path)));
      }
    }
    await Promise.all(untracked.map(file => rm(file, { force: true })));
  }
  async commit(repo: string, message: string) {
    const status = await this.ensureIdle(repo, false);
    if (!message.trim()) throw new Error('Informe uma mensagem para o commit.');
    if (!status.files.some(f => f.index !== ' ' && f.index !== '?')) throw new Error('Selecione arquivos para o commit primeiro.');
    await this.git(repo, ['commit', '-m', message]);
  }
  async pushInfo(repo: string): Promise<{ remote: string; remoteBranch: string }> {
    const name = (await this.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    const remote = await this.git(repo, ['config', '--get', `branch.${name}.remote`]).then(s => s.trim()).catch(() => 'origin');
    const merge = await this.git(repo, ['config', '--get', `branch.${name}.merge`]).then(s => s.trim()).catch(() => `refs/heads/${name}`);
    const remotes = (await this.git(repo, ['remote'])).trim().split('\n');
    if (remote === '.' || !remotes.includes(remote) || !merge.startsWith('refs/heads/')) throw new Error('Configure um remoto e o upstream do ramo antes de enviar.');
    return { remote, remoteBranch: merge.slice('refs/heads/'.length) };
  }
  async prepareTarget(repo: string) {
    const info = await this.pushInfo(repo);
    const remoteRef = `refs/remotes/${info.remote}/${info.remoteBranch}`;
    const exists = await this.git(repo, ['rev-parse', '--verify', remoteRef]).then(() => true).catch(() => false);
    if (!exists) throw new Error('O destino precisa existir no remoto. Crie/envie o ramo antes de iniciar a sequência.');
    const [ahead, behind] = (await this.git(repo, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])).trim().split(/\s+/).map(Number);
    if (ahead) throw new Error('O destino tem commits locais ainda não enviados ou divergiu do remoto. Revise e envie esses commits antes do cherry-pick automático.');
    if (behind) await this.git(repo, ['merge', '--ff-only', remoteRef]);
    return info;
  }
  async push(repo: string, info?: { remote: string; remoteBranch: string }) {
    await this.ensureIdle(repo, false);
    const destination = info ?? await this.pushInfo(repo);
    this.report(repo, `Enviando para ${destination.remote}/${destination.remoteBranch}…`);
    await this.git(repo, ['push', '--set-upstream', '--', destination.remote, `HEAD:refs/heads/${destination.remoteBranch}`]);
  }
}
