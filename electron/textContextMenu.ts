import { Menu, type BrowserWindow } from 'electron';

export function installTextContextMenu(window: BrowserWindow) {
  const contents = window.webContents;
  if (process.platform !== 'darwin') {
    const languages = ['pt-BR', 'en-US'].filter(language => contents.session.availableSpellCheckerLanguages.includes(language));
    if (languages.length) contents.session.setSpellCheckerLanguages(languages);
  }
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({ label: suggestion.replace(/&/g, '&&'), click: () => contents.replaceMisspelling(suggestion) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'Nenhuma sugestão disponível', enabled: false });
      items.push({
        label: 'Adicionar ao dicionário',
        click: () => { contents.session.addWordToSpellCheckerDictionary(params.misspelledWord); }
      }, { type: 'separator' });
    }
    items.push(
      { label: 'Desfazer', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Refazer', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Recortar', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Selecionar tudo', role: 'selectAll', enabled: params.editFlags.canSelectAll }
    );
    Menu.buildFromTemplate(items).popup({ window });
  });
}
