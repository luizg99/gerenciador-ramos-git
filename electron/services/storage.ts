import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Execution, Repository, Settings } from '../../src/models/domain';
export class Storage {
  constructor(private directory: string) {}
  private async read<T>(name: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error(`Não foi possível ler ${name}. Preserve o arquivo e corrija-o antes de continuar.`); }
  }
  private async write(name: string, value: unknown) {
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, name);
    await writeFile(target + '.tmp', JSON.stringify(value, null, 2), 'utf8');
    await rename(target + '.tmp', target);
  }
  settings() { return this.read<Settings>('settings.json', { roots: [] }); }
  saveSettings(settings: Settings) { return this.write('settings.json', settings); }
  executions() { return this.read<Execution[]>('executions.json', []); }
  saveExecutions(executions: Execution[]) { return this.write('executions.json', executions); }
  // Cache da última varredura: só acelera a abertura, então qualquer problema vira lista vazia.
  async repositories(): Promise<Repository[]> {
    const value = await this.read<unknown>('repositories.json', []).catch(() => []);
    return Array.isArray(value) ? value.filter((r): r is Repository => !!r && typeof r.id === 'string' && typeof r.path === 'string' && typeof r.name === 'string') : [];
  }
  saveRepositories(repositories: Repository[]) { return this.write('repositories.json', repositories); }
}
