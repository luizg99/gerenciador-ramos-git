// Verificação dos ramos antes de abrir o pull request: o ramo existe? tem commits que o destino ainda não tem?
export type BranchPresence = 'remote' | 'local' | 'none';
export interface PrBranchInfo { source: string; target: string; sourceState: BranchPresence; targetState: BranchPresence; ahead: number | null; description?: string }

export const PR_DESCRIPTION_LIMIT = 4000;

// Devolve o problema que impede o PR (error) ou, para um ramo só local, quantos commits ele tem para enviar (toPush).
export function prBranchProblem(info: PrBranchInfo | undefined): { error: string; toPush: number } | null {
  if (!info) return null;
  if (info.sourceState === 'none') return { error: `O ramo ${info.source} não existe (nem na sua máquina, nem no remoto). Confira o nome.`, toPush: 0 };
  if (info.targetState !== 'none' && info.ahead === 0) return { error: `O ramo ${info.source} não tem nenhum commit que não esteja em ${info.target}. Não há o que abrir no pull request.`, toPush: 0 };
  if (info.sourceState === 'local' && info.ahead && info.ahead > 0) return { error: '', toPush: info.ahead };
  return null;
}
