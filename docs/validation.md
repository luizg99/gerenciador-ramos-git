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

- Windows; Node 20.20.0 usado na verificação; Electron 41.7.1; Git for Windows 2.55.0.
- Node 22.12+ recomendado para o desenvolvimento/empacotamento, conforme requisitos das ferramentas de empacotamento instaladas.
- O pman proprietário não foi executado. O teste desktop usa um `pman.cmd` temporário que confere os argumentos e termina com sucesso. Os demais testes injetam o comportamento de instalação.
- Os remotos são repositórios bare locais. Autenticação, permissões e políticas da Azure DevOps real não foram exercitadas.
- O instalador NSIS e a distribuição `win-unpacked` não foram gerados/validados; os scripts estão disponíveis.
- `npm run test:e2e` separado ficou bloqueado na etapa de build pelo sandbox. O cenário desktop incluído em `npm test` compilou e executou a aplicação com sucesso.
- A instalação inicial de dependências informou quatro avisos de vulnerabilidade (dois moderados e dois altos). A auditoria online posterior foi bloqueada pelo acesso à rede desta sessão; uma auditoria offline sem resultados não comprova ausência de vulnerabilidades. Revise `npm audit` antes de distribuir um instalador.
- Uma execução anterior do teste com recarga de página deixou processos Electron de teste. A tentativa de encerrá-los nesta sessão recebeu acesso negado. Eventuais janelas vazias dessa execução podem ser fechadas manualmente; usam dados temporários separados da aplicação normal. O teste final fecha sua própria janela em `afterEach`.
