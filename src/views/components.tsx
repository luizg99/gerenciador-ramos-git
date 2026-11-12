import { memo, useId, useRef } from 'react';
import type { Branch, Commit } from '../models/domain';
// Repositórios grandes têm milhares de ramos; a lista só é redesenhada quando os ramos mudam, e não a cada tecla digitada.
const BranchOptions = memo(function BranchOptions({ branches }: { branches: Branch[] }) {
  return <>{branches.map(b => <option key={b.ref} value={b.name}>{b.remote ? 'Remoto' : 'Local'}{b.current ? ' · atual' : ''}</option>)}</>;
});
export function BranchPicker({ label, value, branches, onChange, disabled = false, placeholder = 'Pesquisar ramo local ou remoto…' }: { label: string; value: string; branches: Branch[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string }) {
  const id = useId();
  return <label className="field"><span>{label}</span><input aria-label={label} value={value} onChange={e => onChange(e.target.value)} list={id} disabled={disabled} placeholder={placeholder} autoComplete="off" spellCheck={false}/><datalist id={id}><BranchOptions branches={branches}/></datalist></label>;
}
function CommitListView({ latest, ...props }: { latest: { current: CommitListProps } } & CommitListProps) {
  const { commits, selected = [], active, selectable, inspectTitle, inspectDisabled } = props;
  const onSelect = (hash: string) => latest.current.onSelect?.(hash);
  const onInspect = (hash: string) => latest.current.onInspect(hash);
  return <div className="commit-list">{commits.length === 0 ? <div className="empty small">Nenhum commit carregado.</div> : commits.map(commit => <div className={`commit-row ${active === commit.hash ? 'active' : ''}`} key={commit.hash}>
    {selectable && <input type="checkbox" aria-label={`Selecionar ${commit.subject}`} checked={selected.includes(commit.hash)} disabled={commit.parents.length > 1} onChange={() => onSelect?.(commit.hash)}/>}
    <button className="commit-content" title={inspectTitle} disabled={inspectDisabled} onClick={() => onInspect(commit.hash)}><strong>{commit.subject}</strong><span><code>{commit.hash.slice(0, 8)}</code> · {commit.author} · {new Date(commit.date).toLocaleDateString('pt-BR')}{commit.parents.length > 1 ? ' · merge (manual)' : ''}</span></button>
  </div>)}</div>;
}

// Os dados decidem o redesenho (digitar em outro campo não refaz centenas de commits); os callbacks vêm sempre da última renderização.
type CommitListProps = { commits: Commit[]; selected?: string[]; active?: string; selectable?: boolean; onSelect?: (hash: string) => void; onInspect: (hash: string) => void; inspectTitle?: string; inspectDisabled?: boolean };
const MemoCommitList = memo(CommitListView, (a, b) => a.commits === b.commits && a.selected === b.selected && a.active === b.active && a.selectable === b.selectable && a.inspectDisabled === b.inspectDisabled && a.inspectTitle === b.inspectTitle);
export function CommitList(props: CommitListProps) {
  const latest = useRef(props);
  latest.current = props;
  return <MemoCommitList latest={latest} {...props}/>;
}
