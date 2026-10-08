import { contextBridge, ipcRenderer } from 'electron';
import type { Api, Progress, Snapshot } from '../src/models/domain';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke(name, ...args).then((result: { ok: boolean; value?: unknown; error?: string }) => {
  if (!result.ok) throw new Error(result.error ?? 'Falha na operação.');
  return result.value;
});
const api: Api = {
  snapshot: () => call('app:snapshot') as ReturnType<Api['snapshot']>,
  chooseRoot: () => call('app:chooseRoot') as ReturnType<Api['chooseRoot']>,
  removeRoot: root => call('app:removeRoot', root) as ReturnType<Api['removeRoot']>,
  scan: () => call('app:scan') as ReturnType<Api['scan']>,
  updateSettings: patch => call('app:updateSettings', patch) as ReturnType<Api['updateSettings']>,
  selectRepository: id => call('app:select', id) as Promise<void>,
  status: id => call('git:status', id) as ReturnType<Api['status']>,
  branches: (id, fetch) => call('git:branches', id, fetch) as ReturnType<Api['branches']>,
  switchBranch: (id, branch, mode, install) => call('git:switch', id, branch, mode, install) as ReturnType<Api['switchBranch']>,
  runPman: id => call('git:pman', id) as Promise<void>,
  log: (id, ref, skip) => call('git:log', id, ref, skip) as ReturnType<Api['log']>,
  detail: (id, hash) => call('git:detail', id, hash) as ReturnType<Api['detail']>,
  commitFileDiff: (id, hash, file) => call('git:commitFileDiff', id, hash, file) as ReturnType<Api['commitFileDiff']>,
  workingDiff: (id, file, staged) => call('git:workingDiff', id, file, staged) as Promise<string>,
  stage: (id, files, unstage) => call('git:stage', id, files, unstage) as Promise<void>,
  discard: (id, files) => call('git:discard', id, files) as Promise<void>,
  createBranch: (id, name, base, mode, publish, install) => call('git:createBranch', id, name, base, mode, publish, install) as ReturnType<Api['createBranch']>,
  createBranches: (id, items, switchTo, mode, publish, install) => call('git:createBranches', id, items, switchTo, mode, publish, install) as ReturnType<Api['createBranches']>,
  reviewHistory: () => call('reviews:history') as ReturnType<Api['reviewHistory']>,
  updateReviewIssue: (messageId, issue) => call('reviews:updateIssue', messageId, issue) as ReturnType<Api['updateReviewIssue']>,
  openReviewLink: url => call('reviews:openLink', url) as Promise<void>,
  createPullRequests: (id, pairs, issue) => call('git:createPullRequests', id, pairs, issue) as ReturnType<Api['createPullRequests']>,
  findPullRequests: (id, pairs) => call('git:findPullRequests', id, pairs) as ReturnType<Api['findPullRequests']>,
  saveReviewMessage: (id, input) => call('reviews:save', id, input) as ReturnType<Api['saveReviewMessage']>,
  copyReviewMessage: messageId => call('reviews:copy', messageId) as Promise<void>,
  pullRequestInfo: id => call('git:pullRequestInfo', id) as ReturnType<Api['pullRequestInfo']>,
  commit: (id, message) => call('git:commit', id, message) as Promise<void>,
  push: id => call('git:push', id) as Promise<void>,
  cherryPick: (id, plan) => call('git:cherryPick', id, plan) as ReturnType<Api['cherryPick']>,
  cancelCherryPick: (id, executionId) => call('git:cancelCherryPick', id, executionId) as ReturnType<Api['cancelCherryPick']>,
  resume: (id, executionId, action) => call('git:resume', id, executionId, action) as ReturnType<Api['resume']>,
  onProgress: callback => { const listener = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress); ipcRenderer.on('operation:progress', listener); return () => ipcRenderer.removeListener('operation:progress', listener); },
  onSnapshot: callback => { const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot); ipcRenderer.on('app:changed', listener); return () => ipcRenderer.removeListener('app:changed', listener); }
};
contextBridge.exposeInMainWorld('gitManager', api);
