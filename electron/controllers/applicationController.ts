import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Repository, Settings, Snapshot } from '../../src/models/domain';
import { isRepository, scanRepositories } from '../services/repositoryScanner';
import { Storage } from '../services/storage';
import { GitService, type Reporter } from '../services/gitService';
import { CherryPickController } from './cherryPickController';
import { ReviewMessageController } from './reviewMessageController';
export class ApplicationController {
  repositories: Repository[] = [];
  settings: Settings = { roots: [] };
  busy = false;
  scanning = false;
  private scanGeneration = 0;
  readonly cherry: CherryPickController;
  readonly reviews: ReviewMessageController;
  constructor(readonly git: GitService, private storage: Storage, private report: Reporter = () => {}, private changed: (snapshot: Snapshot) => void = () => {}) { this.cherry = new CherryPickController(git, storage, report); this.reviews = new ReviewMessageController(storage, git); }
  // Abre com a lista da última sessão e atualiza em segundo plano.
  async initialize() {
    this.settings = await this.storage.settings(); await this.cherry.initialize();
    this.git.usePman = this.settings.usePman ?? false;
    this.repositories = await this.storage.repositories();
    const active = this.repositories.find(r => r.id === this.settings.activeRepository);
    if (active && !(await isRepository(active.path))) this.forget(active.id);
    this.scanning = true;
    void this.scan().catch(() => {}).finally(() => { this.scanning = false; this.changed(this.snapshot()); });
  }
  snapshot(): Snapshot { return structuredClone({ settings: this.settings, repositories: this.repositories, executions: this.cherry.executions, scanning: this.scanning }); }
  async scan() {
    const generation = ++this.scanGeneration;
    const repositories = await scanRepositories(this.settings.roots);
    // Uma varredura mais nova (ex.: pasta adicionada) já começou; este resultado está desatualizado.
    if (generation !== this.scanGeneration) return this.snapshot();
    this.repositories = repositories;
    await this.storage.saveRepositories(repositories).catch(() => {});
    return this.snapshot();
  }
  async addRoot(root: string) {
    const canonical = await realpath(root);
    if (!this.settings.roots.some(r => path.resolve(r).toLowerCase() === canonical.toLowerCase())) this.settings.roots.push(canonical);
    await this.storage.saveSettings(this.settings); return this.scan();
  }
  async removeRoot(root: string) { this.settings.roots = this.settings.roots.filter(r => r !== root); await this.storage.saveSettings(this.settings); return this.scan(); }
  async updateSettings(patch: { usePman: boolean }) {
    this.settings.usePman = patch.usePman; this.git.usePman = patch.usePman;
    await this.storage.saveSettings(this.settings); return this.snapshot();
  }
  async select(id: string) {
    const repo = this.repositories.find(r => r.id === id);
    if (!repo) throw new Error('Repositório não cadastrado.');
    if (!(await isRepository(repo.path))) {
      this.forget(id); await this.storage.saveRepositories(this.repositories).catch(() => {});
      this.changed(this.snapshot());
      throw new Error(`A pasta ${repo.path} não existe mais ou deixou de ser um repositório Git. Ela foi removida da lista.`);
    }
    this.settings.activeRepository = id; await this.storage.saveSettings(this.settings);
  }
  private forget(id: string) {
    this.repositories = this.repositories.filter(r => r.id !== id);
    if (this.settings.activeRepository === id) this.settings.activeRepository = undefined;
  }
  repository(id: string) {
    const repo = this.repositories.find(r => r.id === id);
    if (!repo || id !== this.settings.activeRepository) throw new Error('Selecione este repositório antes de executar a operação.');
    return repo.path;
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Uma operação está em andamento. Aguarde sua conclusão.');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  async mutate<T>(id: string, operation: (repo: string) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const repo = this.repository(id);
      this.report(repo, 'Iniciando operação…');
      try { const result = await operation(repo); this.report(repo, 'Operação encerrada.'); return result; }
      catch (error) { this.report(repo, (error as Error).message); throw error; }
    });
  }
}
