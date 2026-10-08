import { expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
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
