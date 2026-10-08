# Gerenciador de Ramos

Aplicativo desktop Windows em Electron, React e TypeScript para trabalhar com repositórios Git, incluindo os hospedados no Azure DevOps. Interface em português, execução via Git CLI e arquitetura MVC.

## Executar

Requisitos: **Node.js 22.12 ou superior**, npm, Git for Windows e `pman` disponível no PATH. As dependências JavaScript já estão instaladas nesta cópia do projeto. Em uma instalação nova:

```powershell
npm install
npm run dev
```

Também é possível abrir `Iniciar Ramos.cmd`. O aplicativo usa a autenticação Git já configurada na máquina. Configure o acesso ao remoto por Git Credential Manager ou SSH antes do uso; não é necessário token da API Azure dentro do aplicativo. Os comandos não solicitam senha em um terminal invisível.

O modo de desenvolvimento recompila o processo principal ao iniciar e atualiza a interface React automaticamente. Reinicie `npm run dev` após modificar arquivos de `electron/`.

## Fluxos implementados

- **Projetos:** múltiplas pastas raiz, busca até quatro níveis em paralelo, lista da última sessão exibida na abertura e atualizada em segundo plano, suporte a worktrees e persistência do projeto ativo. Pastas ocultas e `node_modules`, `vendor`, `dist`, `build`, `out`, `release`, `bin`, `obj`, `target`, `coverage` são ignoradas.
- **Ramos:** consulta local/remota, atualização com fetch/prune, criação local com tracking para ramos remotos e três modos de troca: bloquear pendências, levar alterações compatíveis ou guardar em stash incluindo arquivos novos. O stash não é reaplicado automaticamente. Na aba **Criar / Alterar ramo**, digitar um nome que não existe oferece criar o ramo a partir de uma base (padrão: ramo atual), com push opcional.
- **Pman (opcional):** em **Configurações** há o check **Usa pman**, desmarcado por padrão e gravado em `settings.json`. Desmarcado, o pman não roda em nenhum momento e o botão manual some. Marcado, toda troca ou criação de ramo bem-sucedida pela aba Criar / Alterar ramo executa `pman install -f` em `source`. Se falhar, o ramo permanece selecionado; há uma ação para repetir a instalação. Saída e progresso aparecem na interface. No Windows, o comando fixo roda via `cmd.exe`, permitindo `pman.cmd`/`pman.bat` no PATH.
- **Histórico:** paginação de 100 commits, consulta de outros ramos, arquivos alterados e diff com cores e numeração de linhas. Commits de merge são visíveis, mas seu cherry-pick exige operação manual.
- **Commit/push:** lista única com checkbox (marcado = vai no commit, aplicado na hora e sincronizado com o Git em segundo plano), descarte de alterações por arquivo ou de todas com confirmação, mensagem de commit e push separado.
- **Cherry-pick:** origem + até três destinos, seleção de commits completos, dependência entre campos, validação de ramos distintos inclusive aliases locais/remotos, revisão e push automático após cada destino.
- **Pull request (Azure):** monta o link de criação de PR a partir do remoto (HTTPS/SSH do Azure DevOps ou Azure DevOps Server) e abre no navegador com origem e destino preenchidos. Não usa token: o PR é concluído no site do Azure.

## Cherry-pick e recuperação

O aplicativo atualiza os ramos remotos, valida os commits e aplica os selecionados na ordem topológica original. Cada destino segue:

1. Verificar se o repositório está limpo e sem operações Git em andamento.
2. Trocar o ramo, definir o remoto/upstream e atualizar o destino apenas por fast-forward quando necessário.
3. Executar **uma única chamada** `git cherry-pick <commit1> <commit2> ...` para toda a seleção.
4. Fazer push explícito para o remoto/ramo registrado, sem force.
5. Marcar esse destino como concluído e iniciar o próximo.

O cherry-pick não executa o `pman`: ele só roda na troca de ramo feita pela aba **Trocar ramo**.

Destinos com commits locais ainda não enviados, divergência ou sem ramo remoto são interrompidos para revisão. Isso impede que o push automático inclua commits preexistentes inesperados. Na aba de commit, o push manual pode criar o ramo remoto inicial.

Se houver conflito ou cherry-pick vazio, `git cherry-pick --abort` cancela a tentativa inteira naquele destino. Destinos concluídos são preservados. Não há `reset --hard`, descarte silencioso nem resolução automática de conflitos. Se o próprio abort falhar, o aplicativo preserva o estado e exige intervenção manual.

Se o push falhar, os commits locais ficam preservados. A retomada confere ramo e HEAD antes de tentar **somente o push**, sem repetir a aplicação. Se o resultado do push for incerto após uma interrupção, repetir o envio do mesmo HEAD é permitido.

O estado da sequência é salvo antes de cada etapa em `executions.json`, no diretório `userData` do Electron. Interrupções durante aplicação exigem revisão manual. Para retomar após cherry-pick manual, o usuário confirma que revisou todos os commits locais, deixa o destino pendente selecionado e sem conflitos/alterações e usa **Enviar resultado manual e continuar**. Essa confirmação autoriza enviar o HEAD atual, inclusive resoluções que modifiquem o patch original.

O aplicativo serializa operações e impede seu fechamento normal enquanto executa comandos. Ele não bloqueia editores, terminais ou outros clientes Git externos; evite usá-los simultaneamente durante uma automação. Se precisar resolver um conflito manualmente, aguarde a sequência parar primeiro.

## MVC e segurança da interface

```text
src/models/              Tipos de domínio e validação compartilhada
src/controllers/         Estado da interface e chamadas à API tipada
src/views/               Telas React e componentes de apresentação
electron/controllers/    Casos de uso, exclusão mútua, sequência e recuperação
electron/services/       Git, pman, descoberta e persistência
electron/preload.ts      Ponte restrita de ações tipadas
electron/main.ts         Janela, ciclo de vida e validação IPC
```

Toda a sequência roda no processo principal. O renderer não recebe uma API de terminal nem acesso ao Node. IPC valida a janela/frame de origem, parâmetros e repositório ativo. Git recebe argumentos separados, sem interpolação de shell. O shell do pman recebe somente o comando constante. O projeto segue as recomendações de [segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security) e a semântica de cancelamento documentada em [git cherry-pick](https://git-scm.com/docs/git-cherry-pick).

## Testar e empacotar

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run dist:win
npm run dist:installer
```

`npm test` usa repositórios Git reais e remotos bare descartáveis, incluindo hooks que rejeitam push. Também compila o aplicativo e abre o Electron para testar o fluxo de cherry-pick e push pela interface. Os arquivos ficam em `.local/test-repositories` para inspeção. Nenhum repositório de trabalho do usuário é modificado nos testes. O pman é substituído por uma função nos testes de serviço e por um executável de teste no teste desktop, que exercita a chamada real via CMD.

Os testes Playwright abrem o Electron real com configuração isolada, verificam navegação, histórico/diff de Git real, dependência dos campos e isolamento da API. Geram screenshots em `.local/screenshots`. Não executam o pman real.

`dist:win` gera `release/win-unpacked/Gerenciador de Ramos.exe`; `dist:installer` gera o instalador NSIS sem assinatura. O empacotamento requer acesso aos downloads do Electron/electron-builder. O Git e o pman continuam sendo dependências da máquina, não são incorporados ao instalador.

### Validação nesta sessão de implementação

A checagem TypeScript, os 29 testes de serviços/validação/persistência e o teste desktop completo passaram. O teste desktop gerou os bundles em `dist/` e `dist-electron/` e screenshots em `.local/screenshots/`. Consulte `docs/validation.md` para o resultado final.

Os comandos isolados de build encontraram restrições de filesystem do sandbox (`EPERM`), mas a compilação e a abertura do Electron foram verificadas pela suíte integrada. O instalador ainda não foi gerado nem validado. A instalação real do pman e a autenticação Azure precisam ser verificadas no ambiente de trabalho; os testes usam remotos locais.

Com os bundles já gerados, `npm start` abre a aplicação compilada. `npm run dev` recompila antes de abrir.
