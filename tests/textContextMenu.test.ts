import { expect, it, vi } from 'vitest';
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from 'electron';
const { buildFromTemplate, popup } = vi.hoisted(() => ({ buildFromTemplate: vi.fn(), popup: vi.fn() }));
vi.mock('electron', () => ({ Menu: { buildFromTemplate } }));
import { installTextContextMenu } from '../electron/textContextMenu';

function setup() {
  buildFromTemplate.mockReset().mockReturnValue({ popup });
  let listener: (_event: unknown, params: ContextMenuParams) => void;
  const contents = {
    on: vi.fn((_event, callback) => { listener = callback; }),
    replaceMisspelling: vi.fn(),
    session: {
      availableSpellCheckerLanguages: ['pt-BR', 'en-US'],
      setSpellCheckerLanguages: vi.fn(),
      addWordToSpellCheckerDictionary: vi.fn()
    }
  };
  const window = { webContents: contents } as unknown as BrowserWindow;
  installTextContextMenu(window);
  return {
    contents, window,
    open: (patch: Partial<ContextMenuParams> = {}) => listener({}, {
      isEditable: true, misspelledWord: 'coreção', dictionarySuggestions: ['correção'],
      editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canDelete: true, canEditRichly: false },
      ...patch
    } as ContextMenuParams),
    items: () => buildFromTemplate.mock.calls[0][0] as MenuItemConstructorOptions[]
  };
}

it('oferece correção e dicionário para a palavra clicada, preservando ações de edição', () => {
  const t = setup(); t.open();
  if (process.platform !== 'darwin') expect(t.contents.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['pt-BR', 'en-US']);
  const items = t.items();
  items.find(item => item.label === 'correção')!.click!(undefined as never, undefined as never, undefined as never);
  expect(t.contents.replaceMisspelling).toHaveBeenCalledWith('correção');
  items.find(item => item.label === 'Adicionar ao dicionário')!.click!(undefined as never, undefined as never, undefined as never);
  expect(t.contents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('coreção');
  expect(items.filter(item => item.role).map(item => item.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  expect(items.find(item => item.role === 'redo')!.enabled).toBe(false);
  expect(popup).toHaveBeenCalledWith({ window: t.window });
});

it('mantém o dicionário quando não há sugestão e não inventa correções', () => {
  const t = setup(); t.open({ dictionarySuggestions: [] });
  expect(t.items()).toContainEqual({ label: 'Nenhuma sugestão disponível', enabled: false });
  expect(t.items().some(item => item.label === 'Adicionar ao dicionário')).toBe(true);
});

it('mostra apenas edição para palavras corretas e ignora áreas não editáveis', () => {
  const t = setup(); t.open({ isEditable: false });
  expect(buildFromTemplate).not.toHaveBeenCalled();
  t.open({ misspelledWord: '', dictionarySuggestions: [] });
  expect(t.items().some(item => item.label === 'Adicionar ao dicionário')).toBe(false);
  expect(t.items().some(item => item.role === 'paste')).toBe(true);
});
