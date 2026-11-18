// Texto da "Explicação técnica" (Configurações): como cada tela funciona por dentro, em poucas linhas.
export const technicalIntro =
  'Aplicativo Electron. A tela (React) roda isolada e só conversa com o processo principal por IPC, com os dados validados (zod). O processo principal executa o Git (lista fechada de comandos, tempo limite de 2 minutos), grava os dados na pasta do usuário (settings.json, repositories.json, executions.json) e faz as chamadas externas. Só uma operação que altera o repositório roda por vez; as demais esperam.';

export const technicalGuide: { title: string; text: string }[] = [
  { title: 'Início',
    text: 'Consulta o Jira (REST /rest/api/2/search, com o JQL assignee = currentUser() AND resolution = Unresolved) usando a sessão de login do navegador embutido do Jira: o app não guarda senha. As tarefas caem nas 8 colunas do quadro da equipe pelo nome do status, e as sub-tarefas ficam dentro da tarefa pai. A sprint vem do campo Sprint (achado em /rest/api/2/field ou pelo formato dos valores). Mover um cartão usa GET e POST em /issue/{chave}/transitions, só com os destinos que o fluxo do Jira permite.' },
  { title: 'Criar / Alterar ramo',
    text: 'Troca com git switch e cria com git switch -c a partir da base escolhida, seguido de git push -u se marcado; antes pode rodar git fetch --all --prune. Com alterações locais há três modos: bloquear, levar junto ou guardar com git stash push --include-untracked. A criação dinâmica cria até 4 ramos em sequência. Com "Usa pman", exclui source/lib e roda pman install -f em source.' },
  { title: 'Histórico',
    text: 'Lê git log --topo-order, 100 commits por página (--skip para paginar). Clicar em um commit abre o Show log do TortoiseGit (TortoiseGitProc /command:log) naquele commit.' },
  { title: 'Alterações e commit',
    text: 'Mostra git status --porcelain (inclui arquivos não rastreados) e se atualiza sozinha: a cada 2 s nesta tela, a cada 15 s nas demais e ao voltar o foco da janela. O commit é feito no TortoiseGit (/command:commit); o botão Enviar faz git push.' },
  { title: 'Cherry-pick',
    text: 'Atualiza o remoto e, em cada destino (até 3, em sequência), faz git switch, git cherry-pick dos commits do mais antigo ao mais novo e git push. Se falhar, desfaz a tentativa naquele destino (cherry-pick --abort) e interrompe os seguintes. O andamento fica em executions.json, o que permite retomar ou cancelar, e no fim o app volta ao ramo em que você estava.' },
  { title: 'Criar pull request',
    text: 'Chama a API REST do Azure DevOps (.../_apis/git/repositories/.../pullrequests, api-version 7.1). A autorização vem do mesmo login do Git (git credential fill). A descrição leva as mensagens dos commits da origem que ainda não estão no destino, e PRs ativos que já existem são reaproveitados. A mensagem de revisão fica em review-messages.json (a pasta pode ser trocada em Configurações).' },
  { title: 'Gemini',
    text: 'Abre o Gem da equipe em uma vista embutida com login próprio (persist:team-gemini). O app monta o texto do formulário, cola no campo de mensagem do Gem e aciona o botão Enviar; se não achar o botão, deixa o texto preenchido para envio manual. O rascunho vale só durante a sessão.' },
  { title: 'Jira',
    text: 'Usa a mesma sessão embutida e a REST do Jira: carrega a tarefa principal e as sub-tarefas, mostra LogTimes (worklog), estimativas e transições, e só grava (worklog, comentário, transição, criação de Code Review) depois das suas confirmações. Tarefa impedida (Flagged) bloqueia o fluxo. "Minhas tarefas" é a mesma consulta do Início.' },
  { title: 'Relatório jira',
    text: 'Consulta por JQL (assignee in (...), tipos de sub-tarefa e status concluídos, no período) em páginas de 100 e calcula tudo localmente: entregas por pessoa, horas estimadas e lançadas, comparação com o período anterior e por sprint. Nada é gravado no Jira.' },
  { title: 'Seletores do topo (pasta e ramo)',
    text: 'Pasta: a lista vem de uma varredura que procura o marcador .git até 4 níveis abaixo das pastas cadastradas (repositories.json); clonar usa git clone --progress. Ramo atual: com o diretório limpo troca direto (mesma operação do Criar / Alterar ramo); com alterações locais ou operação em andamento leva à tela de troca; um nome que não existe oferece criar o ramo, com o nome já preenchido. Ao abrir um projeto, roda git fetch --all --prune em segundo plano.' },
  { title: 'Configurações e atualização',
    text: 'As preferências ficam em settings.json; o tema também muda a cor da janela. Os recursos (pman, Azure, Jira, GEM) só mostram ou escondem menus. O app instalado confere atualizações nas Releases do GitHub ao abrir e a cada 6 horas; ao achar versão nova, exige atualizar (baixa o instalador completo e reinicia). O andamento fica em atualizacao.log, na pasta de dados do app.' }
];
