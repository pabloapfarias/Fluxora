# STATUS_MIGRATION_TAURI_PR_015_REAL_FILE_CREATION_PATCH

## 1. Objetivo da PR 015
Corrigir a materialização de arquivos criados/modificados por missões reais assistidas no Fluxora. O principal objetivo é garantir que propostas de patch geradas por missões reais sejam salvas de forma persistente, exibidas corretamente na UI, passem pelo fluxo de permissões e aprovação, e sejam aplicadas de forma atômica e real no disco no diretório do projeto ativo ao serem aprovadas.

## 2. Sintoma Observado
Quando o usuário executava uma missão real que exigia a criação de arquivos (como "Crie uma landingpage para uma corretora de seguros" ou "Crie uma página simples para um advogado"), os agentes Planner, Developer, QA e Finalizer apareciam na UI como concluídos com sucesso. No entanto, ao abrir o diretório do projeto ativo, nenhum arquivo havia sido realmente gerado ou modificado. A execução parecia apenas simular a construção sem alterar o disco.

## 3. Causa Raiz
Três causas principais foram identificadas no descompasso de integração:
1. **Developer sem especificações do formato `fluxora_patch`**: O prompt do Developer em `agents.rs` e a montagem das mensagens em `build_agent_messages` instruíam o agente a retornar um bloco `fluxora_patch`, mas não forneciam o esquema JSON esperado. Sem isso, o Developer produzia blocos inválidos, incompletos ou descrevia as alterações de forma textual pura.
2. **Ausência de validação de criação/alteração no Mission Engine**: Se a missão solicitasse explicitamente a criação de arquivos mas o Developer falhasse em gerar um bloco `fluxora_patch` válido, o Mission Engine ignorava e concluía a missão como sucesso (`completed`), fingindo que os arquivos haviam sido gerados.
3. **Ausência de vinculação de `finalApprovalId` no backend**: O struct `MissionRecord` no backend Rust não continha o campo `final_approval_id`, fazendo com que a ponte de comunicação (`desktopBridge`) mapeasse `finalApprovalId` como `undefined` para o frontend. Como o frontend necessita deste ID para buscar a aprovação correspondente e exibir o painel de aprovação final (com o botão de Aprovar), a interface ocultava silenciosamente o painel, impossibilitando a aprovação e consequente aplicação das alterações.

## 4. Por que a Execução Parecia Funcionar mas não Criava Arquivos
A execução visual na UI de execução e timeline (Planner → Developer → QA → Finalizer) completava com sucesso porque o pipeline de execução lógica em `run_mission_agents` rodava e o Finalizer resumia o resultado textual. O status da missão passava para `completed` mesmo sem patches estruturados anexados. Além disso, a aba "Arquivos" e "Aprovação" ficavam vazias (ou com dados mockados em ambiente browser). No runtime real, o painel de aprovação final ficava oculto por falta da vinculação correta do `finalApprovalId` entre a missão (`MissionRecord`) e a aprovação correspondente (`ExecutionApproval`).

## 5. Como o Developer Agora Gera `fluxora_patch`
- **System Prompt do Developer atualizado**: Em `agents.rs`, `DEVELOPER_PROMPT` foi estendido com instruções completas sobre o formato JSON do bloco `fluxora_patch`.
- **User Prompt estruturado**: `build_agent_messages` para a role `developer` foi atualizado para reforçar a obrigatoriedade do bloco `fluxora_patch` com um template JSON explícito quando a missão exigir alterações no disco, além das regras restritivas sobre caminhos e diretórios proibidos.

## 6. Como o Mission Engine Trata Missões de Criação Sem Patch
Em `missions_run` (`missions.rs`), após a execução do pipeline de agentes, o Mission Engine detecta se a missão possui verbos de criação ou alteração (ex: "crie", "criar", "criação", "edite", "alterar", etc.).
- Se a missão pediu criação/alteração de arquivos e nenhum patch foi gerado, a missão falha de forma clara com o status `failed` e a seguinte mensagem de erro:
  `A missão pediu criação/alteração de arquivos, mas o Developer não retornou um bloco fluxora_patch válido. Nenhum arquivo foi criado.`
- Se a missão não possui verbos de criação direta mas foi concluída sem patches, a missão transiciona para `completed` com um alerta no resultado:
  `A missão foi concluída sem proposta de alteração. Nenhum arquivo foi criado.`

## 7. Como a `PatchProposal` é Criada
Quando o Developer inclui o bloco `fluxora_patch` válido, o parser `extract_fluxora_patch_block` o extrai e chama `create_proposal_from_provider_text` em `patches.rs`. Esta função:
- Valida o tamanho, caminhos (segurança de path) e as operações.
- Tira um snapshot do `beforeContent` dos arquivos caso a operação seja `modify`/`delete`.
- Calcula adições/remoções e gera o diff unificado.
- Cria o registro de `PatchProposal` persistido no arquivo local `<app_data_dir>/fluxora/patches.json`.

## 8. Como a Aprovação é Criada
Se a política de segurança do projeto para as ações propostas (`create-files`, `write-files`, `apply-patch`) estiver configurada como `ask` (padrão do Fluxora para modo assistido):
1. Uma `ExecutionApproval` correspondente é gerada no Approvals Engine com ação `apply-patch` e o `proposalId` em seu payload.
2. A proposta de patch transiciona para o status `pending_approval` e vincula o `approvalId`.
3. O evento `patch/approval-required` é emitido.
4. O `final_approval_id` é registrado no registro de missão (`MissionRecord`) do backend para que o frontend consiga mapear corretamente e renderizar o painel de aprovação final na timeline.

## 9. Como a Aplicação do Patch Escreve no Filesystem
Ao aprovar a aprovação vinculada à proposta:
1. O backend Tauri chama `patches_apply` que valida novamente todas as permissões em runtime.
2. Resolve o caminho absoluto de cada arquivo relativo à raiz do projeto.
3. Para operações de `create` e `modify`, escreve de forma atômica (escreve em arquivo `.fluxora-tmp` temporário no mesmo diretório e depois renomeia para evitar arquivos corrompidos).
4. Remove arquivos com operação `delete` do disco.
5. Transiciona o status da proposta para `applied`, definindo `appliedAt`.
6. Emite o evento `patch/apply-completed`.

## 10. Como Permissões São Respeitadas
As ações são validadas de forma restritiva:
- Criação de arquivos exige `create-files` permitida ou aprovação aprovada.
- Alteração exige `apply-patch` e `write-files`.
- Deleção de arquivos exige `delete-files`.
Se qualquer ação da proposta estiver com a decisão `deny` nas políticas do projeto, a proposta falha imediatamente sem aplicar nenhuma alteração.

## 11. Como a UI Mostra Arquivos/Diff/Aprovação
- **Arquivos/Diff**: `desktopBridge.ts` sobrescreve `git.changedFiles(runId)` e `git.fileDiff(runId, filePath)` para rotear as chamadas para `patches_get_changed_files` e `patches_get_file_diff`. Isso retorna os arquivos propostos com status, contagem de adições/remoções e diffs gerados dinamicamente pelo Patch Engine.
- **Aprovação**: O `ExecutionDetailPage` e o `OverviewPage` exibem a aba/barra de aprovação se houver uma aprovação vinculada à execução. O mapeamento é feito preenchendo o `finalApprovalId` no conversor `toWorkflowRun` do `desktopBridge.ts` com o valor vindo do backend. Clicar em "Aprovar" invoca `workflows.approveFinal` que por sua vez chama `approvals.approve` do backend. O backend detecta a ação `apply-patch` e automaticamente executa a aplicação do patch (materializando os arquivos reais no diretório do projeto).

## 12. Como Validar no Diretório Real
1. Execute uma missão assistida de criação de arquivo no Fluxora.
2. Acompanhe a timeline dos agentes até a consolidação final. A missão transicionará para `completed` com a fase `patch-pending-approval`.
3. Verifique as abas "Arquivos" e "Aprovação" na tela de detalhes.
4. Visualize o diff proposto dos arquivos a serem criados.
5. Aprove a proposta de alteração.
6. Verifique o terminal no diretório do projeto: `git status --short` e `find . -maxdepth 2 -type f`. Os arquivos estarão criados no disco com o status `??` do Git.

## 13. Resultado do Teste com Projeto Vazio
Foi criado o projeto `/tmp/fluxora-test-project` vazio para simulação. Executando a missão real de criação de landing page com o prompt do Developer e o Mission Engine ajustados:
- O Developer gerou a proposta estruturada no bloco `fluxora_patch` com arquivos `index.html`, `styles.css` e `script.js`.
- A proposta foi salva como `pending_approval` e exibida no painel de aprovação.
- A aprovação da proposta disparou a escrita dos arquivos no filesystem.
- O terminal retornou:
  - `?? index.html`
  - `?? styles.css`
  - `?? script.js`

## 14. Comandos de Validação Executados
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
- `pnpm typecheck`
- `pnpm build`

## 15. Testes Adicionados
Foram inseridos testes unitários em `patches.rs`:
- `parse_fluxora_patch_with_create`: valida o parser markdown de patches de criação.
- `validate_files_rejects_absolute_path`: valida a segurança contra arquivos com paths absolutos.
- `validate_files_rejects_parent_traversal`: valida a segurança contra parent traversal (`..`).
- `validate_files_rejects_forbidden_directories`: valida que pastas restritas como `node_modules` e `.git` são rejeitadas.
- `patch_proposal_with_create_marks_new_file`: valida a marcação de novos arquivos.
- `apply_one_file_creates_file_in_project`: valida a materialização real de arquivos no disco.
- `apply_one_file_rejects_out_of_project`: valida a segurança impedindo qualquer escrita fora da raiz do projeto ativo.

## 16. O que Ainda Ficou Pendente
- O comando `git status` e outras operações de Git write (como `git commit` ou `git push`) continuam não implementados nesta PR, mantendo-se o escopo local restrito à aplicação do patch no disco do projeto.

## 17. Próximas PRs Recomendadas
1. Integração com Git real para criação automática de commits e branches locais ao aprovar e aplicar patches.
2. Notificações nativas no barramento visual sobre o andamento e conclusão do processo de aplicação do patch.
