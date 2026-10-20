export interface ChangeBlock { hunk: number; block: number; start: number; lines: number[] }

export function changeBlocks(diff: string): ChangeBlock[] {
  const lines = diff.split('\n');
  const result: ChangeBlock[] = [];
  let hunk = -1, block = 0, start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const removed: number[] = [], added: number[] = [];
    for (let i = start; i < end; i++) (lines[i][0] === '-' ? removed : added).push(i);
    const groups = removed.length === added.length && removed.length > 0
      ? removed.map((line, i) => [line, added[i]])
      : removed.length && added.length ? [[...removed, ...added]] : (removed.length ? removed : added).map(line => [line]);
    for (const group of groups) result.push({ hunk, block: block++, start: group[0], lines: group });
    start = -1;
  };
  lines.forEach((line, index) => {
    if (line.startsWith('@@ ')) { close(index); hunk++; block = 0; return; }
    if (hunk < 0 || line.startsWith('diff --git ')) return;
    if (line.startsWith('+') || line.startsWith('-')) { if (start < 0) start = index; }
    else close(index);
  });
  close(lines.length);
  return result;
}

// Keep the other changes as context from the side that currently exists in the index.
export function selectedBlockPatch(diff: string, hunkIndex: number, blockIndex: number, reverse: boolean): string {
  const lines = diff.split('\n');
  const header = lines.findIndex(line => line.startsWith('--- '));
  const starts = lines.flatMap((line, i) => line.startsWith('@@ ') ? [i] : []);
  const start = starts[hunkIndex], end = starts[hunkIndex + 1] ?? lines.length;
  const selected = changeBlocks(diff).find(b => b.hunk === hunkIndex && b.block === blockIndex);
  if (header < 0 || start === undefined || !selected || selected.lines.some(i => i >= end)) throw new Error('Trecho do diff inválido. Atualize a comparação.');
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[start]);
  if (!match) throw new Error('Cabeçalho do diff inválido.');
  const body: string[] = [], selectedLines = new Set(selected.lines);
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ') || line.startsWith('\\ No newline')) continue;
    if (line.startsWith(' ')) body.push(line);
    else if (line.startsWith('+') || line.startsWith('-')) {
      if (selectedLines.has(i)) body.push(line);
      else if (line[0] === (reverse ? '+' : '-')) body.push(' ' + line.slice(1));
    }
  }
  const oldCount = body.filter(line => line[0] !== '+').length;
  const newCount = body.filter(line => line[0] !== '-').length;
  return [...lines.slice(0, header + 2), `@@ -${match[1]},${oldCount} +${match[2]},${newCount} @@`, ...body, ''].join('\n');
}
