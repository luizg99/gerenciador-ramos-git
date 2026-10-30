import { expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '../electron/services/storage';
import { tempDirectory } from './helpers';
it('persiste configurações e recusa JSON danificado sem sobrescrevê-lo', async () => {
  const root = await tempDirectory('settings-'); const storage = new Storage(root);
  expect(await storage.settings()).toEqual({ roots: [] });
  await storage.saveSettings({ roots: ['C:\\Projetos'], activeRepository: 'example' });
  expect(await new Storage(root).settings()).toEqual({ roots: ['C:\\Projetos'], activeRepository: 'example' });
  await writeFile(path.join(root, 'settings.json'), '{truncated');
  await expect(storage.settings()).rejects.toThrow('Preserve o arquivo');
});

it('migra e combina o histórico de PR ao trocar a pasta de armazenamento', async () => {
  const root = await tempDirectory('review-local-'); const cloud = await tempDirectory('review-cloud-'); const storage = new Storage(root);
  const old = { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' } as any;
  const shared = { id: 'shared', createdAt: '2026-01-02T00:00:00.000Z' } as any;
  const newest = { id: 'newest', createdAt: '2026-01-03T00:00:00.000Z' } as any;
  await storage.saveReviewMessages([shared, old]);
  await writeFile(path.join(cloud, 'review-messages.json'), JSON.stringify([newest, shared]));

  await storage.configureReviewHistoryDirectory(cloud);
  expect((await storage.reviewMessages()).map(message => message.id)).toEqual(['newest', 'shared', 'old']);
  expect(JSON.parse(await readFile(path.join(cloud, 'review-messages.json'), 'utf8')).map((message: any) => message.id)).toEqual(['newest', 'shared', 'old']);

  await storage.configureReviewHistoryDirectory();
  expect((await storage.reviewMessages()).map(message => message.id)).toEqual(['newest', 'shared', 'old']);
});
