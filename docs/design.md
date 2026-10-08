# Decisões de implementação

Base: plano MVC e especificação de 05/10/2026 fornecidos em Downloads/plans e Downloads/specs.

Mantidos: Windows, Electron + React + TypeScript, Git CLI, MVC, múltiplas pastas, três opções de troca, automação do pman, histórico/diff, commit/push e quatro campos no cherry-pick.

Ajustes aprovados e implementados:

- Push automático depois de cada destino do cherry-pick.
- Fetch/prune explícito e criação local com upstream para ramos existentes no remoto.
- Validar todos os campos, inclusive equivalência entre nome local e remoto.
- Commits selecionados ordenados pela topologia da origem, sem aceitar merges automaticamente.
- Cancelamento nativo da sequência completa daquele destino, preservando os anteriores.
- Orquestração no processo principal, independente da interface React.
- Registro persistente por etapa, retomada de push sem reaplicação e adoção explícita de conclusão manual.
- Operações serializadas; repositório ativo e parâmetros validados no processo principal.
- Testes de integração com Git real em vez de testes vazios ou apenas mocks.

Regras adicionais:

- O stash é preservado até o usuário decidir reaplicá-lo manualmente.
- Falha de pman mantém o novo ramo e permite repetir a instalação.
- Destino atrasado pode avançar por fast-forward; commits locais pendentes ou divergência exigem revisão prévia.
- O pman é opcional: a configuração "Usa pman" (padrão desmarcado, gravada em settings.json) é aplicada no processo principal; desmarcada, nenhum fluxo executa o pman.
- Origem remota é lida sem checkout. O pman só roda na troca de ramo pela aba Trocar ramo; o cherry-pick não executa o pman.
- A sequência não retorna automaticamente ao ramo original; ao concluir, permanece no último destino. Em falha, permanece onde parou.
- Configurações e execuções ficam no userData do Electron, fora dos repositórios gerenciados.
- V1 não inclui editor de conflitos, integração direta com API Azure, assinatura de instalador ou seleção de trechos dentro de um commit.
