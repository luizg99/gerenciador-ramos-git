export const GEM_URL = 'https://gemini.google.com/gem/3bf604e9d2f3';
export const documentationFields = [
  { key: 'routine', section: '1. Identificação Geral', label: 'Código e Nome da(s) Rotina(s) / Artefatos', example: 'Rotina 4204 - Gestão de Editais' },
  { key: 'issue', section: '1. Identificação Geral', label: 'Número da Issue/Jira/Chamado', example: 'Cole aqui o XML da issue', large: true },
  { key: 'version', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Versão Gerada', example: 'Supp, Main, Develop' },
  { key: 'dependencies', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Dependências Físicas/Banco', example: 'BPLs, Packages, tabelas criadas/alteradas com versão, se houver. Ou N/A.' },
  { key: 'tables', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Tabelas Utilizadas', example: 'PCCLIENT, PCEDITAL. Ou N/A.' },
  { key: 'permissions', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Permissões e Parametrizações Requeridas', example: 'Liberar permissão X na rotina 530, ou parâmetro Y na 132. Se não houver, N/A.' },
  { key: 'changes', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Alterações Efetuadas (Descrição do comportamento alterado)', example: 'Adicionada validação para verificar a data de exclusão do cadastro do cliente antes de exibi-lo na pesquisa.', large: true },
  { key: 'happy', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Critérios de Aceitação para QA — Cenário Feliz', example: 'Ao pesquisar um cliente ativo na rotina 4204, o mesmo deve ser exibido normalmente.' },
  { key: 'exception', section: '2. Dados Técnicos (Para Encerramento de Desenvolvimento - QA)', label: 'Critérios de Aceitação para QA — Cenário de Exceção/Bloqueio', example: 'Ao pesquisar um cliente inativo/excluído (DTEXCLUSAO preenchida), o mesmo não deve ser retornado no resultado da busca.' },
  { key: 'business', section: '3. Visão de Negócio (Para Release Notes - Comercial)', label: 'O que foi corrigido ou melhorado sob o ponto de vista da operação?', example: 'A rotina não deve permitir adicionar clientes cancelados/excluídos nos editais.' },
  { key: 'impact', section: '3. Visão de Negócio (Para Release Notes - Comercial)', label: 'Existe algum impacto direto na usabilidade ou novo fluxo de trabalho?', example: 'Apenas filtragem automática na busca de cadastros.' }
] as const;
export type DocumentationDraft = Partial<Record<typeof documentationFields[number]['key'], string>>;
export function documentationPrompt(draft: DocumentationDraft) {
  const lines = ['Gerar Encerramento de Desenvolvimento & Release notes.', 'Sempre dar espaçamento entre os tópicos do texto', '', 'Questionário de Dados para Documentação (QA & Release Notes)'];
  let section = '';
  for (const field of documentationFields) {
    if (section !== field.section) { section = field.section; lines.push('', section); }
    lines.push('', `${field.label}:`, draft[field.key]?.trim() || '[Não informado]');
  }
  return lines.join('\n');
}
export interface GeminiState {
  phase: 'loading' | 'ready' | 'filling' | 'filled' | 'error';
  message: string;
  url?: string;
}
export function gemUrlForAccount(value: string) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://gemini.google.com') return GEM_URL;
    const account = url.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1] ?? url.searchParams.get('authuser');
    if (account && /^\d+$/.test(account)) return `https://gemini.google.com/u/${account}/gem/3bf604e9d2f3`;
  } catch { /* No Gemini account selected yet. */ }
  return GEM_URL;
}
export function isGeminiHome(value: string) {
  try {
    const url = new URL(value);
    return url.origin === 'https://gemini.google.com' && /^\/(?:u\/\d+\/)?(?:app\/?)?$/.test(url.pathname);
  } catch { return false; }
}
export interface GeminiBounds { x: number; y: number; width: number; height: number }
export function isGemStartUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === 'https://gemini.google.com' && /^\/(?:u\/\d+\/)?gem\/3bf604e9d2f3\/?$/.test(url.pathname);
  } catch { return false; }
}
