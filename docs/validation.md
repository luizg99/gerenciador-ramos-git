# Validação — 05/10/2026

## Resultado final

- `npm run typecheck`: aprovado.
- `npm test`: **30 testes aprovados, 5 arquivos**, execução consolidada em 124,78 segundos.
- Build de produção do renderer e bundle do Electron: aprovados pelo teste desktop integrado.
- Abertura do Electron, navegação, consulta de histórico/diff e execução de cherry-pick pela interface: aprovados.
- Capturas da interface em `docs/screenshots/` e `.local/screenshots/`.

## O que foi verificado

1. Aplicação de vários commits em três destinos, com ordem topológica e push por destino.
2. Conflito no segundo commit: cancelamento da sequência inteira nesse destino, mantendo os destinos anteriores e impedindo os seguintes.
3. Rejeição real de push por hook no remoto bare; retomada após reiniciar o controlador sem duplicar commits.
4. Commits locais preexistentes no destino e garantia de que o cherry-pick não executa o pman.
5. Duplicidade de ramos por alias, commits fora da origem, commits de merge e cherry-pick vazio.
6. Interrupção durante aplicação e após envio, conferência de HEAD na retomada e conclusão manual explícita.
7. Falha no próprio abort: estado preservado e retomada automática bloqueada.
8. Destino atrasado atualizado somente por fast-forward.
9. Três modos de troca: bloqueio, carry compatível/incompatível e stash de staged/unstaged/untracked.
10. Consulta remota, criação local com tracking, staging de nomes literais, unstage antes do primeiro commit, diff, commit e push.
11. Detecção de operação Git externa, repositório ativo, serialização, worktrees e deduplicação de pastas.
12. Persistência de configurações e recusa de JSON corrompido.
13. Pela interface real: escolher projeto, consultar diff, selecionar commit, preencher destinos, revisar e confirmar o conteúdo enviado em dois ramos remotos locais.
14. Renderer sem `require` do Node e sem API genérica de execução de comandos.

## Ambiente e limites

### Mensagens e histórico de PRs (08/10/2026)

- Testes de formatação cobrem 05:59, 06:00, 12:00, 12:01, 18:00, 18:01 e meia-noite, Jira opcional, normalização e escape de HTML.
- Histórico verificado após reinstanciar o armazenamento, com deduplicação, destinos normalizados e recusa de URLs de outro repositório.
- Consulta REST testada com respostas simuladas: pares exatos, PR ausente, ambíguo, concluído, falhas de autenticação, rede e resposta inválida. Credenciais não aparecem no resultado nem nas mensagens de erro.
- Teste Electron compila o aplicativo, consulta PRs simulados via um credential helper de teste, gera a prévia, copia texto/HTML, verifica o link curto do Jira e copia uma mensagem anterior pelo filtro de issue.
- Criação direta: testes da API verificam três POSTs com mensagens dos commits, reaproveitamento de PRs ativos e preservação de resultados parciais após falha. O teste Electron cria três PRs simulados pelo botão e confere descrições com assunto e corpo completo de commits remotos.
- Ajustes de interface: teste Electron verifica limpeza dos campos após criação, prévia preservada, abertura de link encaminhada ao navegador (substituído no teste), modal de issue com validação, remoção/adição de issue e atualização do texto copiado. Testes de persistência verificam edição do registro existente e recarga do histórico.
- A autenticação do Azure real da TOTVS e a colagem dentro do Google Chat não foram exercitadas. O teste valida os formatos texto/HTML da área de transferência; não envia mensagens.

- Windows; Node 20.20.0 usado na verificação; Electron 41.7.1; Git for Windows 2.55.0.
- Node 22.12+ recomendado para o desenvolvimento/empacotamento, conforme requisitos das ferramentas de empacotamento instaladas.
- O pman proprietário não foi executado. O teste desktop usa um `pman.cmd` temporário que confere os argumentos e termina com sucesso. Os demais testes injetam o comportamento de instalação.
- Os remotos são repositórios bare locais. Autenticação, permissões e políticas da Azure DevOps real não foram exercitadas.
- O instalador NSIS e a distribuição `win-unpacked` não foram gerados/validados; os scripts estão disponíveis.
- `npm run test:e2e` separado ficou bloqueado na etapa de build pelo sandbox. O cenário desktop incluído em `npm test` compilou e executou a aplicação com sucesso.
- A instalação inicial de dependências informou quatro avisos de vulnerabilidade (dois moderados e dois altos). A auditoria online posterior foi bloqueada pelo acesso à rede desta sessão; uma auditoria offline sem resultados não comprova ausência de vulnerabilidades. Revise `npm audit` antes de distribuir um instalador.
- Uma execução anterior do teste com recarga de página deixou processos Electron de teste. A tentativa de encerrá-los nesta sessão recebeu acesso negado. Eventuais janelas vazias dessa execução podem ser fechadas manualmente; usam dados temporários separados da aplicação normal. O teste final fecha sua própria janela em `afterEach`.
