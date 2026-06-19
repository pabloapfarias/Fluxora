# Migração Electron → Tauri — Índice

Esta pasta concentra o histórico de PRs da migração da shell desktop do Fluxora
de Electron para Tauri, preservando a UI React/TypeScript existente e
trocando a camada Electron/preload/IPC por uma ponte de compatibilidade
(`desktopBridge`) com comandos Rust.

## PRs

- [PR 001 — Base Tauri](./STATUS_MIGRATION_TAURI_PR_001.md)
  Estabelece a base Tauri (`apps/desktop/src-tauri`), cria `desktopBridge`,
  preserva `window.fluxora` e mantém o restante da UI no fallback mock.
- [PR 002 — Projects reais](./STATUS_MIGRATION_TAURI_PR_002_PROJECTS.md)
  Migra o domínio `projects.*` para backend real em Tauri/Rust, com
  persistência local em JSON, validação real de caminho, seleção de
  diretório via `tauri-plugin-dialog` e detecção inicial de stack.
- [PR 003 — Git e filesystem reais](./STATUS_MIGRATION_TAURI_PR_003_GIT_FILESYSTEM.md)
  Adiciona módulos `git.rs` e `filesystem.rs` no backend, expõe
  `git.inspect`, `git.diff` e `app.getGitInfo` reais via `desktopBridge`,
  sem mexer em layout/tema/navegação. Avança também na organização
  da própria documentação, centralizando os status das PRs nesta pasta.
- [PR 004 — Git baseline, controle de versão e comando dev](./STATUS_MIGRATION_TAURI_PR_004_GIT_BASELINE.md)
  Inicializa o repositório Git local em `~/projects/FluxoraV1` com
  branch `main`, cria `.gitignore` adequado para Tauri/React/pnpm/Rust,
  ajusta `pnpm dev` na raiz para abrir o app desktop Tauri (substituindo
  o atalho antigo que abria só o Vite) e remove o risco de loop no
  `beforeDevCommand` do `tauri.conf.json`. PR estritamente
  organizacional — nenhuma feature nova, nenhuma alteração de UI.
- [PR 005 — Eventos reais via Tauri event system](./STATUS_MIGRATION_TAURI_PR_005_EVENTS.md)
  Cria a base real do barramento de eventos do FluxoraV1: módulo
  Rust `events.rs` com `FluxoraEvent` + ring buffer, canal único
  `fluxora-event` consumido pelo frontend via `@tauri-apps/api/event`,
  comandos `events_ping` / `events_emit_diagnostic` /
  `events_list_recent` / `events_clear_recent`, integração com
  `projects.create/update/remove` (`type: "project/updated"`) e
  emissão de `app/ready` no startup do Tauri. Preserva toda a
  superfície `window.fluxora.events.*` legada (que continua mock
  até o Mission Engine) e adiciona `subscribe` / `on` / `listRecent`
  / `emitDiagnostic` / `clearRecent` / `unsubscribe` / `off`
  roteados pelo Tauri com fallback mock fora do runtime Tauri.
- [PR 006 — Voice/Whisper no Tauri](./STATUS_MIGRATION_TAURI_PR_006_VOICE_WHISPER.md)
  Migra o domínio `voice.*` para transcrição real em Rust/Tauri:
  módulo `voice.rs` com `VoiceState` persistido em
  `<app_data_dir>/fluxora/voice.json`, adapter Whisper HTTP
  (OpenAI-compat) via `ureq` com multipart manual, suporte a
  `whisper_http` / `openai_whisper` / `whisper_local` /
  `whisper_local_managed`, comandos `voice_ping` /
  `voice_get_settings` / `voice_update_settings` /
  `voice_transcribe` / `voice_test_provider`, e eventos
  `voice/transcription-started` / `voice/transcription-completed` /
  `voice/transcription-failed` / `voice/provider-tested` /
  `voice/settings-updated` emitidos no barramento `fluxora-event`
  da PR 005. `desktopBridge` codifica áudio em base64 e
  preserva `window.fluxora.voice.*` / `window.fluxora.settings.getAudioProvider*`
  com fallback mock fora do runtime Tauri. Captura de áudio
  continua no renderer (`useMicCapture`); `whisper.*` (bundle),
  `whisperLocal.*` (download) e persistência de áudio em disco
  permanecem mock — PR estritamente incremental.
- [PR 007 — Provider Engine próprio](./STATUS_MIGRATION_TAURI_PR_007_PROVIDER_ENGINE.md)
  Cria o motor de providers do FluxoraV1 em Rust/Tauri,
  eliminando a dependência conceitual do OpenCode CLI como
  intermediário para chamadas aos modelos de IA. Módulo
  `providers.rs` com `ProvidersState` persistido em
  `<app_data_dir>/fluxora/providers.json`, adapter
  OpenAI-compatible via `ureq` (mesmo da PR 006), suporte a
  `openai-compatible` (real) e `anthropic` / `gemini` /
  `mistral` / `deepseek` / `minimax` / `local` / `custom`
  (reconhecidos, retornam erro "não implementado nesta PR"),
  comandos `providers_ping` / `providers_list` /
  `providers_get` / `providers_create` /
  `providers_update` / `providers_remove` /
  `providers_test` / `providers_list_models` /
  `providers_chat_once`, e eventos `provider/test-started` /
  `provider/test-completed` / `provider/test-failed` /
  `provider/models-loaded` / `provider/request-started` /
  `provider/request-completed` / `provider/request-failed` /
  `provider/created` / `provider/updated` / `provider/removed`
  no barramento `fluxora-event` da PR 005. `desktopBridge`
  adiciona `window.fluxora.providers.*` (canônico novo) e
  sobrescreve `opencode.getCatalog` / `getModelsForProvider` /
  `refreshCatalog` em runtime Tauri para que a UI atual
  (sem alteração) passe a refletir o Provider Engine quando
  há providers cadastrados. UI preservada; sem streaming,
  sem tool calling, sem Mission Engine, sem agente real,
  sem piloto automático, sem storage seguro de secrets.
- [PR 008 — Mission Engine inicial](./STATUS_MIGRATION_TAURI_PR_008_MISSION_ENGINE.md)
  Cria o primeiro Mission Engine real do FluxoraV1 em
  Rust/Tauri, conectando projetos reais, filesystem/Git
  reais, Provider Engine próprio (PR 007) e o barramento
  de eventos real (PR 005). Módulo `missions.rs` com
  `MissionsState` persistido em
  `<app_data_dir>/fluxora/missions.json`, 8 comandos Tauri
  (`missions_ping` / `missions_list` / `missions_get` /
  `missions_create` / `missions_run` /
  `missions_create_and_run` / `missions_list_logs` /
  `missions_clear`), coleta de contexto do projeto
  conservadora (10 arquivos × 32 KiB × 128 KiB total,
  ignora binários e UTF-8 inválido), prompt interno
  seguro (modo propositivo / read-only), resolução
  automática de provider/model, e 6 tipos de evento
  `mission/*` no barramento `fluxora-event`:
  `mission/created` / `mission/started` / `mission/phase`
  / `mission/log` / `mission/completed` / `mission/failed`.
  Integração com o Provider Engine via
  `providers::execute_mission_chat` (helper público
  adicionado em `providers.rs` que reaproveita o adapter
  OpenAI-compatible sem duplicar HTTP client nem emitir
  `provider/*` events). `desktopBridge` adiciona o
  namespace `missions` (canônico novo) e sobrescreve
  `window.fluxora.workflows.*` em runtime Tauri para
  preservar a API legada da UI (converte `MissionRun`
  ↔ `WorkflowRun` e `MissionLog` ↔ `WorkflowEvent`),
  além de adaptar `events.list(workflowRunId)` para usar
  `missions_list_logs`. `voice.createFromTranscript`
  continua mock (frontend-side, `buildVoiceContext`).
  Missão inicial é estritamente read-only/propositiva:
  não aplica patches, não executa comandos de shell,
  não faz Git write operations, não usa OpenCode como
  motor. UI preservada; sem piloto automático, sem
  scheduler, sem agente real, sem streaming, sem tool
  calling, sem storage seguro de secrets.
- [PR 009 — Piloto automático com permissões por projeto](./STATUS_MIGRATION_TAURI_PR_009_AUTOPILOT_PERMISSIONS.md)
  Cria a base real do piloto automático do FluxoraV1 em
  Rust/Tauri. Adiciona os módulos `permissions.rs` e
  `approvals.rs` no backend, integra o Mission Engine
  (PR 008) ao sistema de permissões por projeto,
  adiciona scheduler/fila mínima em memória, e emite
  13 tipos de evento novos no barramento `fluxora-event`
  (`permission/*`, `approval/*`, `mission/job-*`). Módulo
  `permissions.rs` com `PermissionsState` persistido em
  `<app_data_dir>/fluxora/permissions.json`, 6 comandos
  Tauri (`permissions_ping` /
  `permissions_get_project_policy` /
  `permissions_update_project_policy` /
  `permissions_list_policies` /
  `permissions_reset_project_policy` /
  `permissions_check`), política default conservadora
  (`read-files`/`git-read`/`network-provider` → `allow`;
  `delete-files`/`git-write`/`commit`/`push` → `deny`;
  demais → `ask`), `autopilotEnabled: false` por padrão
  e fallback automático de `piloto-automatico` →
  `propositivo` quando o piloto está desativado. Módulo
  `approvals.rs` com `ApprovalsState` persistido em
  `<app_data_dir>/fluxora/approvals.json`, 8 comandos
  Tauri (`approvals_ping` / `approvals_list` /
  `approvals_get` / `approvals_create` /
  `approvals_approve` / `approvals_reject` /
  `approvals_cancel` / `approvals_list_actionable`),
  integração automática com `permissions_check` (cria
  `ExecutionApproval` quando a decisão for `ask`).
  `missions_run` agora consulta `read-files` e
  `network-provider` antes de prosseguir, com fallback
  claro para ações `deny` ou `ask`. `desktopBridge`
  adiciona os namespaces canônicos novos
  `permissions.*` e `scheduler.*`, sobrescreve
  `approvals.*` em runtime Tauri (convertendo
  `ExecutionApproval` → `Approval` legado) e migra
  `workflows.listJobs` / `getJob` / `cancelJob` para o
  scheduler real (convertendo `MissionJob` →
  `BackgroundWorkflowJob`). UI preservada — nenhum
  componente React alterado. Missão continua
  estritamente read-only/propositiva: não aplica
  patches, não executa comandos de shell, não faz Git
  write operations. Sem patch real, sem cancelamento
  real de missões em `running`, sem tool calling, sem
  streaming, sem storage seguro de secrets.
- [PR 010 — Apply patch/diff controlado](./STATUS_MIGRATION_TAURI_PR_010_PATCH_DIFF.md)
  Adiciona o Patch Engine do FluxoraV1 em Rust/Tauri,
  permitindo que missões proponham alterações em formato
  estruturado (`fluxora_patch` na resposta do provider) e
  que essas alterações sejam aplicadas de forma
  controlada, respeitando a política do projeto e
  exigindo aprovação explícita quando a decisão for
  `ask`. Módulo `patches.rs` com `PatchesState`
  persistido em `<app_data_dir>/fluxora/patches.json`,
  9 comandos Tauri (`patches_ping` / `patches_list` /
  `patches_get` / `patches_list_by_mission` /
  `patches_create` / `patches_apply` / `patches_reject` /
  `patches_get_changed_files` / `patches_get_file_diff`),
  10 tipos de evento `patch/*` + 1 `diff/generated` no
  barramento `fluxora-event`, 12 testes unitários,
  validação rigorosa de paths (rejeita `..`, absolutos,
  drive letters, 12 diretórios proibidos) e limites
  (20 arquivos/proposta, 256 KiB/arquivo, 1 MiB total).
  Parser `fluxora_patch` adicionado ao `missions.rs`
  (extrai bloco markdown da resposta, valida JSON/paths,
  tira snapshot de `beforeContent` do disco, calcula
  additions/deletions via LCS, cria `PatchProposal`).
  Aplicação atômica via `write_atomic` (temp + rename).
  `approvals_approve` estendido: detecta aprovações de
  `apply-patch` e dispara `patches_apply` automaticamente
  via `proposalId` no payload. `git.changedFiles(
  workflowRunId)` e `git.fileDiff(workflowRunId, filePath)`
  agora são reais em runtime Tauri (convertem
  `PatchFileChange[]` para as formas legadas `ChangedFile`
  / `FileDiff` consumidas pelo Diff Viewer da UI). UI
  preservada — nenhum componente React alterado.
  `desktopBridge` adiciona o namespace canônico novo
  `patches.*` e sobrescreve `git.changedFiles` /
  `git.fileDiff` / `workflows.approveFinal` /
  `workflows.rejectFinal` em runtime Tauri. Sem commit,
  push, checkout, reset, merge, rebase, branch, tag,
  stash ou qualquer Git write operation. Sem shell
  commands, sem tool calling, sem streaming, sem storage
  seguro de secrets.
- [PR 011 — Agentes reais e steps detalhados](./STATUS_MIGRATION_TAURI_PR_011_AGENTS_STEPS.md)
  Cria a base real de agentes do FluxoraV1 em Rust/Tauri.
  Substitui os `AgentStepOutput` sintéticos (derivados
  dos logs pelo `buildSyntheticSteps` da PR 008) por
  steps reais persistidos em
  `<app_data_dir>/fluxora/agent_steps.json`. Módulo
  `agents.rs` com `AgentsState` (configs + steps) e 4
  agentes padrão criados sob demanda (Planner /
  Developer / QA / Finalizer) com system prompts internos
  seguros e IDs determinísticos. 10 comandos Tauri
  (`agents_ping` / `agents_list` / `agents_get` /
  `agents_create` / `agents_update` / `agents_remove` /
  `agents_reset_defaults` / `agent_steps_list` /
  `agent_steps_list_by_mission` / `agent_steps_get`),
  7 testes unitários, 7 tipos de evento `agent/*` no
  barramento `fluxora-event`
  (`agent/defaults-created`,
  `agent/settings-updated`, `agent/step-started`,
  `agent/step-completed`, `agent/step-failed`,
  `agent/plan-created`, `agent/qa-completed`).
  `missions_run` agora executa um pipeline sequencial de
  4 agentes via `agents::run_mission_agents`, com
  integração ao Provider Engine (PR 007) — cada agente
  pode ter `providerId`/`model` próprios ou herdar da
  missão — e ao Patch Engine (PR 010) — o Developer gera
  `fluxora_patch` que vira `PatchProposal` real via
  `patches::create_proposal_from_provider_text`.
  `workflows.getStepOutputs(missionId)` /
  `workflows.listAgentOutputs(missionId)` agora retornam os
  `AgentStepRecord` reais (convertidos para
  `AgentStepOutput` legado) em vez dos steps sintéticos
  da PR 008. `agents.listConfigs/getConfig/createConfig/
  updateConfig/resetDefaults` (canônico novo) e
  `agentSteps.listByMission/get` (canônico novo) e
  `models.updateAgentConfigModel` (canônico novo)
  adicionados ao `FluxoraAPI` e roteados pelo
  `desktopBridge` em runtime Tauri. Limites rígidos
  (256 KiB output, 1 000 chars input, 500 chars erro,
  máximo 4 agentes por missão). Sem streaming, sem
  tool calling, sem shell commands, sem Git write
  operations, sem OpenCode como motor. UI preservada —
  nenhum componente React alterado.
- [PR 012 — Streaming de providers](./STATUS_MIGRATION_TAURI_PR_012_PROVIDER_STREAMING.md)
  Adiciona streaming OpenAI-compatible ao Provider Engine
  e integra esse streaming ao Agent Engine, Mission Engine
  e barramento `fluxora-event`. Helper público
  `providers::execute_mission_chat_stream` com callback
  de chunks, parser SSE puro (`parse_sse_line`) com 10
  testes unitários, helper `openai_chat_stream` que lê o
  response como stream via `ureq::Response::into_reader()`,
  e Tauri command `providers_chat_stream` registrado no
  `invoke_handler` de `lib.rs`. 4 tipos de evento novos
  no barramento `fluxora-event` —
  `provider/stream-started` / `provider/stream-chunk` /
  `provider/stream-completed` / `provider/stream-failed` —
  mais `agent/step-chunk` emitido pelo Agent Engine para
  cada delta de cada agente do pipeline. `MissionChatResult`
  ganhou `chunks: u32` (default 0 para `chatOnce` da
  PR 007; valor real para `chatStream` desta PR). Agent
  Engine usa `execute_provider_chat_for_agent` que tenta
  streaming primeiro e cai automaticamente em
  `execute_mission_chat` quando o stream falha antes do
  primeiro chunk (preservando o comportamento da PR 011).
  Limites rígidos: 8 KiB/delta, 512 KiB/stream, 20 000
  chunks/stream, 120s timeout, 500 chars erro. Tipos
  compartilhados `ProviderStreamChunk`,
  `ProviderStreamResult`, `ChatStreamRequest` e
  `AgentStepChunkPayload` em `packages/shared/src/index.ts`.
  Método canônico novo `window.fluxora.providers.chatStream`
  exposto pelo `desktopBridge` em runtime Tauri e stubbed
  fora dele pelo `mock-api.ts`. 64 testes Rust passando
  (eram 54; +10 do SSE parser + 1 fix preexistente do
  `parse_models_response_rejects_missing_data`).
  `providers.chatOnce` legado preservado. Sem tool calling,
  sem execução de comandos, sem Git write operations,
  sem OpenCode como motor. UI preservada — nenhum
  componente React alterado.
- [PR 012.1 — Corrigir integração de providers reais na UI](./STATUS_MIGRATION_TAURI_PR_012_1_PROVIDER_UI_FIX.md)
  Corrige o descompasso entre a UI legada e o backend real:
  `SettingsPage` passa a listar/configurar/testar providers
  reais via `window.fluxora.providers.*`, `AgentsPage`
  passa a refletir os agentes reais do Agent Engine
  (`Planner`, `Developer`, `QA`, `Finalizer`), o fallback
  global exibido na UI passa a seguir a resolução real do
  Mission Engine, e o `desktopBridge` deixa de mascarar a
  ausência de provider real com o mock legado do OpenCode em
  runtime Tauri. Também melhora o erro de missão ausente com
  `provider/missing` + `mission/failed` seguro
  (`reason: "no-real-provider"`). Validações: `pnpm typecheck`,
  `pnpm build`, `cargo check`, `cargo test --lib` passando;
  `pnpm dev` bloqueado por porta 1420 em uso; 6 falhas
  preexistentes em `pnpm test` (tema/voz) mantidas sem
  correção nesta PR.
- [PR 013 — Limpeza OpenCode, providers reais e UX](./STATUS_MIGRATION_TAURI_PR_013_CLEAN_OPENCODE_PROVIDER_UX.md)
  Remove OpenCode da UI ativa do FluxoraV1, elimina a rota
  antiga de laboratório, troca o cadastro de providers para
  fluxo real persistido em `providers.json`, limpa textos de
  migração/legado/Electron/mock da experiência principal e
  consolida o Provider Engine próprio como fonte única de
  verdade para providers e modelos.
- [PR 014 — Unificar agentes, providers e diagnóstico](./STATUS_MIGRATION_TAURI_PR_014_UNIFY_AGENTS_PROVIDERS_DIAGNOSTICS.md)
  Introduz `execution_resolver.rs` (fonte única de resolução
  de execução) + comando Tauri `missions_get_readiness` +
  `resolveExecutionReadiness` no `shared`. Unifica AgentsPage,
  diagnóstico da missão e `missions_run` em torno dos 4
  agentes reais (Planner / Developer / QA / Finalizer) e do
  Provider Engine real, removendo Backend Dev / Frontend Dev /
  Mobile Dev / Orquestrador do pipeline ativo e rebaixando a
  recomendação por stack a papel decorativo.
- [PR 014.1 — Corrigir bloqueio do modo real e estabilizar readiness](./STATUS_MIGRATION_TAURI_PR_014_1_REAL_MODE_READINESS_FIX.md)
  Remove guards legados em `executeCommand` que bloqueavam o
  modo Real usando `isAgentConfiguredForRealExecution` em vez
  de `missions.getReadiness()`. Garante que provider/modelo
  herdado é aceito, padroniza mensagens de erro e atualiza
  command palette para usar `isAgentReadyWithFallback`.

## Convenções aplicadas em todas as PRs

- Toda a documentação de status fica nesta pasta, nunca mais na raiz.
- `desktopBridge` é o único ponto do frontend que conhece Tauri.
- Componentes React continuam consumindo `window.fluxora`.
- O mock `apps/desktop/src/api/mock-api.ts` continua existindo como
  fallback para o caso de a app rodar fora do runtime Tauri
  (modo navegador/Vite dev).
- O projeto original em `~/projects/Fluxora` é somente leitura
  durante a migração.
