# STATUS_MIGRATION_TAURI_PR_016_CONTROLLED_GIT_COMMIT

## 1. Objetivo da PR 016
Adicionar suporte a Git local controlado após a aplicação de patch por missões assistidas no Fluxora. Esta PR permite que o usuário crie opcionalmente uma branch local e um commit local contendo apenas os arquivos criados ou modificados pela PatchProposal aprovada da missão, gerando um snapshot Git seguro para recuperação de forma manual e explícita na UI, sem realizar push ou pull remoto, e sem checkouts ou resets destrutivos.

## 2. Estado Herdado da PR 015
A PR 015 corrigiu a materialização real e gravação segura de arquivos no filesystem pelo Patch Engine após a aprovação de uma PatchProposal. No entanto, após os arquivos serem criados ou alterados no disco, o Fluxora ainda não interagia com o controle de versão do projeto para registrar o snapshot Git da missão. Os arquivos eram simplesmente deixados como modificados/não rastreados (`git status --short` mostrando arquivos com `??` ou `M`), sem branch local ou commit local correspondentes.

## 3. Por que o Commit Local Controlado é Necessário
Sem commits locais automáticos ou guiados:
1. O usuário fica sem um ponto seguro de retorno (rollback/recovery) dentro do Git para a missão aplicada.
2. Não há registro associado do hash do commit gerado com a missão executada, impossibilitando a rastreabilidade direta entre a execução da inteligência artificial e o histórico de commits do código-fonte.
3. Se o usuário tiver modificações pré-existentes não salvas no repositório, commits automáticos cegos poderiam misturar as alterações da IA com o trabalho manual prévio do usuário.

## 4. O que foi Implementado no Git Engine
No backend Tauri/Rust (`apps/desktop/src-tauri/src/git.rs`):
- **Estruturas de Dados e Estado**:
  - `GitCommitResultRecord` e `GitWriteReadiness` para transferir informações de estado de forma estruturada.
  - `GitCommitsState` e persistência local no arquivo `<app_data_dir>/fluxora/git_commits.json` (gerenciando status do commit: `not_requested`, `pending_approval`, `committed`, `failed`, `skipped`).
- **Novos Comandos Tauri**:
  - `git_get_write_readiness`: detecta se o projeto possui Git, se existem alterações locais e se há modificações que não pertencem à PatchProposal ativa (exibe avisos pré-existentes).
  - `git_create_branch_for_mission`: cria ou alterna para uma branch local da missão de forma segura e não destrutiva.
  - `git_commit_patch`: realiza a adição (`git add -- <files>`) apenas dos arquivos vinculados à PatchProposal, e cria o commit local (`git commit`) utilizando cabeçalhos de autor locais controlados (`user.name=Fluxora Agent` e `user.email=agent@fluxora.ai`) para evitar falhas em ambientes sem configuração global de Git.
  - `git_get_commit_result` e `git_list_mission_commits`: facilitam a consulta do resultado do commit.

## 5. Como Permissões de `git-write` e `commit` são Respeitadas
O módulo de políticas de segurança (`permissions.rs`) regula a execução:
- Se `git-write` ou `commit` estiverem definidos como `deny`, a criação do commit é imediatamente rejeitada com um erro descritivo.
- Se qualquer uma estiver como `ask` (o padrão seguro), a execução de `git_commit_patch` não commita de imediato; em vez disso, ela cria uma `ExecutionApproval` com a ação `commit` contendo todos os dados necessários em seu payload, e transiciona o status do commit para `pending_approval`.
- Se as permissões estiverem como `allow`, o commit é executado diretamente quando acionado pelo usuário.

## 6. Como a Aprovação Funciona
Quando a ação `commit` requer aprovação:
1. Uma aprovação é criada e exibida na interface do usuário.
2. Uma vez aprovada pelo usuário na UI, a função `approvals_approve` em `apps/desktop/src-tauri/src/approvals.rs` intercepta a ação `commit`.
3. Ela extrai os parâmetros originais (arquivos, mensagem, branch, projectId) do payload e invoca `git_commit_patch` automaticamente para materializar o commit local no disco, emitindo os eventos Git correspondentes.

## 7. Como a Branch Local é Criada
- O modal de commit solicita se o usuário deseja criar uma branch local opcional.
- Se selecionado, tenta rodar `git checkout -b <branch_name>`. Se a branch já existir localmente, faz o fallback seguro `git checkout <branch_name>` sem causar erros ou abortar a operação.

## 8. Como o Commit Local é Criado
- O comando de commit é executado no diretório do projeto via:
  `git -c user.name="Fluxora Agent" -c user.email="agent@fluxora.ai" commit -m "<message>"`
- Apenas os arquivos explicitados da proposta (já adicionados com `git add -- <files>`) são adicionados ao commit index. Alterações fora da PatchProposal continuam intactas no working tree.
- O hash SHA-1 do commit gerado é capturado executando `git rev-parse HEAD`.

## 9. Como Arquivos são Limitados à PatchProposal
Antes de executar qualquer comando de escrita, `git_commit_patch` realiza validações rigorosas de segurança:
1. Todos os arquivos a serem commitados devem constar na lista de arquivos da `PatchProposal` correspondente. Arquivos não relacionados no diretório de trabalho são ignorados.
2. Cada caminho de arquivo é validado pelo helper `is_safe_commit_path` (rejeita caminhos absolutos, traversal `..`, diretório `.git`, segredos, `.env`, `node_modules`, `dist`, `target`, `vendor`).
3. O caminho resolvido de cada arquivo é canonicalizado e validado para garantir que está dentro do diretório raiz do projeto (`resolved_canon.starts_with(&root_canon)`).

## 10. Como a UI Mostra o Commit Local
- Na tela de detalhes da execução (`ExecutionDetailPage.tsx`), após a aplicação do patch, uma seção de controle do Git local é exibida na aba "Resumo".
- Se nenhum commit foi solicitado, mostra: `Commit local: não criado` com o botão `[ Criar commit local ]`.
- Ao clicar, abre o `CommitModal` que preenche automaticamente a branch sugerida (`fluxora/mission-<short_id>`) e a mensagem sugerida (`feat: apply Fluxora mission <title>`).
- Se houver alterações pré-existentes fora da missão no working tree, um aviso em amarelo é exibido:
  `"Existem alterações fora desta missão. O Fluxora commitará apenas arquivos da proposta aplicada."`
- Após o commit, a UI é atualizada para exibir o status de sucesso com a branch e o hash curto do commit (ex: `Commit local criado: abc1234`).

## 11. Como Validar em Projeto Temporário
1. Crie um diretório de teste:
   ```bash
   mkdir -p /tmp/fluxora-git-commit-test
   cd /tmp/fluxora-git-commit-test
   git init
   ```
2. Adicione o projeto no Fluxora apontando para `/tmp/fluxora-git-commit-test`.
3. Execute uma missão que aplique alterações.
4. Após aplicar o patch, clique em **Criar commit local**, escolha criar branch e clique em confirmar.
5. Verifique no terminal:
   - `git status --short` (working tree limpo)
   - `git log --oneline` (mostra o commit com autor `Fluxora Agent <agent@fluxora.ai>`)
   - `git branch --show-current` (mostra a branch criada)

## 12. Comandos de Validação Executados
Toda a suite de compilação e qualidade de código foi executada e passou com sucesso:
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` (0 warnings/erros)
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` (74 testes com sucesso)
- `pnpm typecheck` (Compilação do TypeScript completa e limpa)
- `pnpm build` (Build de produção da aplicação desktop bem-sucedida)

## 13. Testes Adicionados
No módulo `git.rs`, o teste unitário de integração `test_git_operations_in_temp_repo` e o teste unitário de segurança de caminhos `safe_commit_path_validations` garantem que:
- Caminhos proibidos como `.env`, `.git`, `node_modules` e parent traversal são devidamente barrados.
- Comandos Git em repositórios dinâmicos temporários executam corretamente do início ao fim (status, add, commit com autor customizado e captura de hash).

## 14. O que Ainda Ficou Pendente
- Integração de comandos de push remoto (intencionalmente proibido por escopo e segurança nesta PR).
- Exibição de histórico de commits locais gerados pelo Fluxora em uma página dedicada do app.

## 15. Próximas PRs Recomendadas
1. Implementação de página dedicada à visualização do histórico de snapshots/commits locais gerados por missões do Fluxora.
2. Integração com um sistema de Rollback Git automatizado seguro (usando `git revert` controlado) a partir da UI de histórico de missões.
