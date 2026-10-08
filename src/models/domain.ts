import type { ReviewInput, ReviewMessage } from './reviewMessage';
export type SwitchMode = 'block' | 'carry' | 'stash';
export interface Repository { id: string; path: string; name: string }
export interface FileChange { path: string; originalPath?: string; index: string; worktree: string }
export interface Status { branch: string; files: FileChange[]; operation: string | null; ahead: number; behind: number; upstream: string | null }
export interface Branch { ref: string; name: string; remote: boolean; current: boolean; upstream: string }
export interface Commit { hash: string; subject: string; author: string; date: string; parents: string[] }
export interface CommitDetail { files: string[]; diff: string }
export interface Settings { roots: string[]; activeRepository?: string; usePman?: boolean }
export interface CherryPlan { source: string; commits: string[]; targets: string[] }
export type Phase = 'pending' | 'switching' | 'pman' | 'applying' | 'pushing' | 'done' | 'failed' | 'interrupted';
export interface TargetRun {
  branch: string; phase: Phase; failedAt?: Phase; beforeHead?: string; appliedHead?: string;
  remote?: string; remoteBranch?: string; error?: string; aborted?: boolean;
}
export interface Execution { id: string; repoPath: string; source: string; commits: string[]; targets: TargetRun[]; startedAt: string; finished: boolean; cancelledAt?: string; initialBranch?: string }
export interface Progress { repoPath: string; message: string; time: string }
export interface Snapshot { settings: Settings; repositories: Repository[]; executions: Execution[]; scanning?: boolean }
export interface SwitchResult { branch: string; stash?: string }
export interface BatchResult { created: string[]; published: string[]; failures: string[]; branch?: string; stash?: string }
export interface PullRequestInfo { remote: string | null; remoteUrl: string | null; webUrl: string | null; defaultTarget: string | null }
export interface Api {
  snapshot(): Promise<Snapshot>;
  chooseRoot(): Promise<Snapshot>;
  removeRoot(root: string): Promise<Snapshot>;
  scan(): Promise<Snapshot>;
  updateSettings(patch: { usePman: boolean }): Promise<Snapshot>;
  selectRepository(id: string): Promise<void>;
  status(id: string): Promise<Status>;
  branches(id: string, fetch: boolean): Promise<Branch[]>;
  switchBranch(id: string, branch: string, mode: SwitchMode, install: boolean): Promise<SwitchResult>;
  runPman(id: string): Promise<void>;
  log(id: string, ref: string, skip: number): Promise<Commit[]>;
  detail(id: string, hash: string): Promise<CommitDetail>;
  commitFileDiff(id: string, hash: string, file: string): Promise<string>;
  workingDiff(id: string, file: string, staged: boolean): Promise<string>;
  stage(id: string, files: string[], unstage: boolean): Promise<void>;
  discard(id: string, files: string[]): Promise<void>;
  cancelOperation(id: string): Promise<void>;
  createBranch(id: string, name: string, base: string, mode: SwitchMode, publish: boolean, install: boolean): Promise<SwitchResult & { published: boolean }>;
  createBranches(id: string, items: { name: string; base: string }[], switchTo: number | null, mode: SwitchMode, publish: boolean, install: boolean): Promise<BatchResult>;
  pullRequestInfo(id: string): Promise<PullRequestInfo>;
  reviewHistory(): Promise<ReviewMessage[]>;
  createPullRequests(id: string, pairs: { source: string; target: string }[], issue: string): Promise<{ prs: { source: string; target: string; url: string; created: boolean }[]; error?: string; message?: ReviewMessage }>;
  updateReviewIssue(messageId: string, issue: string): Promise<ReviewMessage>;
  openReviewLink(url: string): Promise<void>;
  findPullRequests(id: string, pairs: { source: string; target: string }[]): Promise<{ source: string; target: string; url: string }[]>;
  saveReviewMessage(id: string, input: ReviewInput): Promise<ReviewMessage>;
  copyReviewMessage(messageId: string): Promise<void>;
  commit(id: string, message: string): Promise<void>;
  push(id: string): Promise<void>;
  cherryPick(id: string, plan: CherryPlan): Promise<Execution>;
  cancelCherryPick(id: string, executionId: string): Promise<Execution>;
  resume(id: string, executionId: string, action: 'retry' | 'manual'): Promise<Execution>;
  onProgress(callback: (progress: Progress) => void): () => void;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { gitManager: Api } }
