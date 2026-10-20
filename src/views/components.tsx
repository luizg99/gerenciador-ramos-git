import { useId } from 'react';
import type { Branch, Commit, CommitDetail } from '../models/domain';
import { changeBlocks } from '../models/partialStage';
export function BranchPicker({ label, value, branches, onChange, disabled = false, placeholder = 'Pesquisar ramo local ou remoto…' }: { label: string; value: string; branches: Branch[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string }) {
  const id = useId();
  return <label className="field"><span>{label}</span><input aria-label={label} value={value} onChange={e => onChange(e.target.value)} list={id} disabled={disabled} placeholder={placeholder} autoComplete="off" spellCheck={false}/><datalist id={id}>{branches.map(b => <option key={b.ref} value={b.name}>{b.remote ? 'Remoto' : 'Local'}{b.current ? ' · atual' : ''}</option>)}</datalist></label>;
}
export function Diff({ value, onBlock, blockAction }: { value: string; onBlock?: (hunk: number, block: number) => void; blockAction?: string }) {
  const lines = value.split(/\r?\n/);
  const blockStarts = new Map(onBlock ? changeBlocks(value).map(b => [b.start, b]) : []);
  // Numeração antiga/nova a partir dos cabeçalhos "@@ -a,b +c,d @@".
  let header = false, inHunk = false, oldLine = 0, newLine = 0;
  const parse = (line: string): { kind: string; old?: number; new?: number } => {
    if (line.startsWith('diff ')) { header = true; inHunk = false; return { kind: 'meta' }; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { header = false; inHunk = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); return { kind: 'hunk' }; }
    if (header) return { kind: 'meta' };
    if (!inHunk || !line) return { kind: '' };
    if (line.startsWith('+')) return { kind: 'added', new: newLine++ };
    if (line.startsWith('-')) return { kind: 'removed', old: oldLine++ };
    if (line.startsWith(' ')) return { kind: '', old: oldLine++, new: newLine++ };
    return { kind: 'meta' };
  };
  return <div className="diff-wrap">{onBlock && blockStarts.size > 0 && <p className="diff-action-hint">{blockAction === 'Retirar do commit' ? 'Clique em − para retirar uma mudança do commit. O arquivo no disco permanece igual.' : 'Clique em + para incluir uma mudança no commit.'}</p>}{lines.length > 8000 && <p className="hint">Prévia limitada a 8.000 linhas. Revise o restante no editor.</p>}<pre className="diff"><code className="diff-lines">{lines.slice(0, 8000).map((line, i) => { const row = parse(line); const block = blockStarts.get(i); return <span key={i} className={`diff-line ${row.kind}`}><span className="ln" aria-hidden="true">{row.old ?? ''}</span><span className="ln" aria-hidden="true">{row.new ?? ''}</span>{onBlock && <span className="diff-action-slot">{block && <button type="button" className="diff-block-action" title={blockAction} aria-label={`${blockAction}: linha ${row.old ?? row.new}`} onClick={() => onBlock(block.hunk, block.block)}>{blockAction === 'Retirar do commit' ? '−' : '+'}</button>}</span>}<span className="code">{line || ' '}</span></span>; })}</code></pre></div>;
}
export function CommitList({ commits, selected = [], active, selectable, onSelect, onInspect }: { commits: Commit[]; selected?: string[]; active?: string; selectable?: boolean; onSelect?: (hash: string) => void; onInspect: (hash: string) => void }) {
  return <div className="commit-list">{commits.length === 0 ? <div className="empty small">Nenhum commit carregado.</div> : commits.map(commit => <div className={`commit-row ${active === commit.hash ? 'active' : ''}`} key={commit.hash}>
    {selectable && <input type="checkbox" aria-label={`Selecionar ${commit.subject}`} checked={selected.includes(commit.hash)} disabled={commit.parents.length > 1} onChange={() => onSelect?.(commit.hash)}/>}
    <button className="commit-content" onClick={() => onInspect(commit.hash)}><strong>{commit.subject}</strong><span><code>{commit.hash.slice(0, 8)}</code> · {commit.author} · {new Date(commit.date).toLocaleDateString('pt-BR')}{commit.parents.length > 1 ? ' · merge (manual)' : ''}</span></button>
  </div>)}</div>;
}
export function Detail({ detail, selectedFile, onSelectFile }: { detail?: CommitDetail; selectedFile?: string; onSelectFile?: (file: string) => void }) {
  if (!detail) return <div className="empty"><span className="empty-symbol">±</span><h3>Veja o que mudou</h3><p>Selecione um commit para revisar os arquivos e o diff.</p></div>;
  return <div className="detail"><div className="changed-files"><strong>{detail.files.length} {detail.files.length === 1 ? 'arquivo' : 'arquivos'}</strong>{detail.files.map((f, i) => onSelectFile ? <button className={`changed-file ${selectedFile === f ? 'selected' : ''}`} key={i} onClick={() => onSelectFile(f)}>{f}</button> : <code key={i}>{f}</code>)}</div><Diff value={detail.diff}/></div>;
}
