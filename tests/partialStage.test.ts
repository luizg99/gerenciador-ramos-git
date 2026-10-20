import { describe, expect, it } from 'vitest';
import { changeBlocks, selectedBlocksPatch } from '../src/models/partialStage';

describe('seleção de mudanças no diff', () => {
  it('mostra a seleção na linha verde de uma substituição e mantém o par completo no patch', () => {
    const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-antiga\n+nova\n contexto\n';
    const [block] = changeBlocks(diff);
    expect(diff.split('\n')[block.start]).toBe('+nova');
    expect(selectedBlocksPatch(diff, [{ hunk: 0, block: 0 }], true)).toContain('-antiga\n+nova');
  });

  it('mostra a seleção na linha vermelha quando só existe exclusão', () => {
    const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1 @@\n-removida\n contexto\n';
    expect(diff.split('\n')[changeBlocks(diff)[0].start]).toBe('-removida');
  });
});
