# STATUS_MIGRATION_TAURI_PR_011_AGENTS_STEPS

## 1. Objetivo da PR 011

Criar a **base real de agentes do FluxoraV1** em Rust/Tauri,
substituindo os `AgentStepOutput` sintéticos (derivados dos logs
pelo `buildSyntheticSteps` da PR 008) por steps reais
persistidos em
`<app_data_dir>/fluxora/agent_steps.json`. A missão agora
executa um pipeline sequencial de 4 agentes especializados
(Planner → Developer → QA → Finalizer), cada um com seu
próprio `AgentStepRecord` persistido, alimentando a UI atual
via adaptadores no `desktopBridge`.

Concretamente:

- **Agent Engine** próprio em Rust/Tauri (`agents.rs`) com
  persistência local em
  `<app_data_dir>/fluxora/agents.json` e
  `<app_data_dir>/fluxora/agent_steps.json` (versionados).
- **4 agentes padrão** criados sob demanda com system prompts
  internos seguros e IDs determinísticos:
  - `agent-planner` (Planner)
  - `agent-developer` (Developer)
  - `agent-qa` (QA)
  - `agent-finalizer` (Finalizer)
- **Pipeline sequencial** de 4 agentes em `missions_run` —
  substitui a antiga chamada única a
  `providers::execute_mission_chat` da PR 008 e a extração
  manual do `fluxora_patch` da PR 010.
- **Integração com Provider Engine** (PR 007) via
  `providers::execute_mission_chat` — cada agente pode ter
  seu próprio `providerId`/`model` ou herdar da missão.
- **Integração com Patch Engine** (PR 010) — o Developer gera
  `fluxora_patch`, que vira uma `PatchProposal` real via
  `patches::create_proposal_from_provider_text` reaproveitado
  da PR 010.
- **Integração com Permissions/Approvals** (PR 009) — as
  checagens de `read-files` / `network-provider` da PR 009 são
  feitas antes do pipeline iniciar (em `missions_run`).
- **Compatibilidade com `workflows.getStepOutputs(id)` /
  `listAgentOutputs(id)` / `agents.*` / `agentSteps.*` /
  `models.updateAgentModel` legados** via adaptadores no
  `desktopBridge` — a UI atual (`AgentStepOutputPanel`,
  `ExecutionDetailPage`, `useUsageStats`, `AgentsPage`)
  continua consumindo `window.fluxora.*` exatamente como
  antes, sem nenhuma alteração de componente obrigatória.
- **Eventos `agent/*`** no barramento `fluxora-event` (PR 005):
  `agent/defaults-created`, `agent/settings-updated`,
  `agent/step-started`, `agent/step-completed`,
  `agent/step-failed`, `agent/plan-created`,
  `agent/qa-completed`.

**Esta PR NÃO implementa streaming, tool calling, execução de
comandos de shell, Git write operations, commit/push, ou
OpenCode como motor.** Os agentes chamam o Provider Engine da
PR 007 (mesmo helper `execute_mission_chat`) e respeitam
permissões/approvals da PR 009 e patch/diff controlado da PR 010.

## 2. Estado herdado da PR 010

- Repositório Git local em
  `feature/pr-011-real-agents-steps` (criado a partir de
  `feature/pr-010-controlled-patch-diff`).
- `pnpm dev` na raiz abrindo o app desktop Tauri.
- `projects.*` / `git.*` / `filesystem.*` / `app.*` reais em
  Rust (PR 002, PR 003).
- Barramento real `fluxora-event` (PR 005) com ring buffer 200
  e canal único.
- `voice.*` / `whisper.*` real em Rust (PR 006).
- Provider Engine próprio (PR 007) com adapter
  OpenAI-compatible, persistência em `providers.json`,
  eventos `provider/*` e comandos `providers_*`.
- Mission Engine (PR 008) com persistência em `missions.json`,
  8 comandos `missions_*`, eventos `mission/*` e integração
  com Provider Engine via `providers::execute_mission_chat`.
- Piloto automático com permissões por projeto, Approvals
  Engine e scheduler mínimo (PR 009).
- Patch Engine (PR 010) com parser `fluxora_patch`, validação
  rigorosa de paths, 10 tipos de evento `patch/*` no
  barramento, e integração com `git.changedFiles(workflowRunId)`
  / `git.fileDiff(workflowRunId, filePath)`.
- `desktopBridge` (PR 010) com `workflows.approveFinal` /
  `rejectFinal` reais e namespace canônico `patches.*`.
- Steps de agentes sintéticos — `buildSyntheticSteps` em
  `desktopBridge.ts` derivava 3 `AgentStepOutput`
  (Planner / Provider Call / Final Report) a partir dos logs
  reais. Era a única fonte de `AgentStepOutput` em runtime
  Tauri.
- `Agent` legado (mock) e `agentSteps.list(workflowRunId)`
  legado (mock) — `AgentsPage` consumia `agents.list /
  create / update / remove`; `updateAgentModel` existia no
  contrato mas a UI não consumia.
- UI existente consumia `window.fluxora.workflows.*` e
  `window.fluxora.agents.*` sem alterações de componente.

## 3. Como agents/steps funcionavam antes

### 3.1 Steps sintéticos (PR 008)

`apps/desktop/src/services/desktopBridge.ts` linhas 753–849
expunham a função `buildSyntheticSteps(mission, logs)` que
derivava 3 `AgentStepOutput` dos logs reais de uma missão:

```ts
async getStepOutputs(workflowRunId) {
  const mission = await getMissionById(workflowRunId);
  const logs = await listMissionLogs(workflowRunId);
  return buildSyntheticSteps(mission, logs);  // 3 steps fictícios
}
```

Os 3 steps gerados eram:
- `step-planner` (role `planner`, agentName `Planner`) —
  derivado dos logs de `context` / `planning`.
- `step-provider` (role `developer`, agentName `Provider
  Call`) — derivado dos logs de `provider-call` / `response`.
- `step-finalization` (role `qa`, agentName `Final Report`) —
  derivado do `resultText` da missão ou dos logs de
  `final-report` / `failed`.

Esses steps não eram persistidos — eram recalculados a cada
chamada de `getStepOutputs` / `listAgentOutputs`. O
`AgentStepOutputPanel` e `useUsageStats` consumiam essa forma.

### 3.2 `agents.*` legado (mock)

`apps/desktop/src/api/mock-api.ts` linhas 846–886 expunha
`agents.list / create / update / remove` em arrays em
memória. O tipo `Agent` legado (`packages/shared/src/index.ts`
linhas 90–103) tinha:

```ts
{ id, name, role (AgentRole — orchestrator/planner/...),
  description, canEditFiles, canRunCommands,
  requiresApproval, modelProviderId, modelName, enabled,
  createdAt, updatedAt }
```

`AgentsPage` consumia esses métodos. O tipo
`AgentModelSettingInput` (legado) tinha
`{ modelProviderId?, modelName? }` e
`models.updateAgentModel(agentId, input)` existia no contrato
mas a UI atual não consumia (apenas
`agents.update(agentId, { modelProviderId, modelName })`).

### 3.3 `agentSteps.*` legado (mock)

`apps/desktop/src/api/mock-api.ts` linha 1235 expunha
`agentSteps.list(workflowRunId)` que devolvia
`agentStepsByWorkflow.get(workflowRunId) || []` —
alimentado pelos simuladores `simulateRealWorkflow` /
`simulateMultiAgentWorkflow` (3 steps por workflow).

### 3.4 Quem ouve os eventos hoje

A UI consumia `window.fluxora.events.subscribe(...)` /
`events.on("type", cb)` / `events.listRecent(...)` (PR 005).
Não havia `agent/*` no barramento.

## 4. Como o Agent Engine funciona agora

### 4.1 Em runtime Tauri

1. **Agent Engine** (`apps/desktop/src-tauri/src/agents.rs`):
   - Mantém `AgentsState`
     (`Mutex<Vec<AgentConfigRecord>>` +
     `Mutex<Vec<AgentStepRecord>>`) registrado via
     `tauri::Builder::manage`.
   - Carregado no `setup` do Tauri a partir de
     `<app_data_dir>/fluxora/agents.json` e
     `<app_data_dir>/fluxora/agent_steps.json` (silencioso em
     caso de I/O error). Logs:
     ```
     [fluxora agents] carregados N agente(s)
     [fluxora agent_steps] carregados N step(s) de agente
     ```
   - 10 comandos Tauri:
     `agents_ping` / `agents_list` / `agents_get` /
     `agents_create` / `agents_update` / `agents_remove` /
     `agents_reset_defaults` / `agent_steps_list` /
     `agent_steps_list_by_mission` / `agent_steps_get`.
   - 7 testes unitários (`truncates_long_output`,
     `truncates_long_input_summary`, `truncates_long_error`,
     `agent_status_roundtrip`, `step_status_roundtrip`,
     `summarize_short_text_returns_as_is`,
     `summarize_long_text_truncates`,
     `summarize_empty_text_returns_marker`).

2. **Pipeline de 4 agentes** em `agents::run_mission_agents`:
   - Carrega os agentes padrão (Planner / Developer / QA /
     Finalizer) via `ensure_default_agents` se ainda não
     existirem.
   - Filtra por `status == "enabled"`, ordena por `order`,
     trunca em `MAX_AGENTS_PER_MISSION` (4 nesta PR).
   - Para cada agente:
     1. Cria um `AgentStepRecord` com `status: "running"` e o
        persiste em `agent_steps.json`.
        Emite `agent/step-started` (info) com `stepId`,
        `role`, `agentName`, `order`.
     2. Monta o `input_summary` e as `messages` específicos
        do role via `build_agent_messages` — NUNCA expõe o
        `outputText` completo do provider anterior, apenas o
        `output_summary` curto. Persiste o `input_summary` no
        step.
     3. Resolve `providerId`/`model` para o agente:
        `agent.providerId`/`agent.model` (se definidos) ou
        fallback para `default_provider_id`/
        `default_model` da missão.
     4. Chama `providers::execute_mission_chat` (helper da
        PR 007) com `max_tokens: 2048` e timeout 90s.
     5. Em caso de sucesso:
        - Trunca o output em 256 KiB
          (`MAX_STEP_OUTPUT_BYTES`).
        - Gera `output_summary` (até 280 chars).
        - Marca o step como `completed` com `outputText`,
          `outputSummary`, `completedAt`, `metadata`
          (`model` / `providerId` / `durationMs`).
        - Persiste o step em `agent_steps.json`.
        - Emite `agent/step-completed` (info) com `stepId`,
          `role`, `agentName`, `outputLength`, `durationMs`.
        - Pipeline-specific:
          - **Planner**: armazena o output em
            `planner_output`/`planner_summary` e emite
            `agent/plan-created` (info).
          - **Developer**: armazena o output em
            `developer_output`/`developer_summary` e tenta
            extrair um bloco `fluxora_patch` via
            `missions::extract_fluxora_patch_block` (parser
            da PR 010). Se válido, chama
            `crate::patches::create_proposal_from_provider_text`
            (PR 010) para criar a `PatchProposal` real. Em
            caso de sucesso, atualiza o `metadata` do step
            com `proposalId`, `proposalStatus`, `filesCount`.
          - **QA**: armazena o output em
            `qa_output`/`qa_summary` e emite
            `agent/qa-completed` (info).
          - **Finalizer**: armazena o output em
            `finalizer_output` (usado como
            `MissionRun.resultText`).
          - **Custom**: apenas persiste o step.
     6. Em caso de falha:
        - Marca o step como `failed` com `error` truncado em
          500 chars e `completedAt`.
        - Persiste o step em `agent_steps.json`.
        - Emite `agent/step-failed` (error) com `stepId`,
          `role`, `agentName`, `errorMessage`.
        - Se o agente for o Finalizer, é tolerável: a missão
          pode completar com o output do último agente
          bem-sucedido (Developer / QA / Planner).
        - Caso contrário, devolve `Err` para que
          `missions_run` marque a missão como `failed`.

3. **Integração com Mission Engine** em `missions.rs`:
   - `missions_run` agora chama `agents::run_mission_agents`
     em vez da antiga `execute_mission_chat` + extração manual
     de `fluxora_patch`.
   - As checagens de permissão `read-files` (PR 009) e
     `network-provider` (PR 009) continuam sendo feitas em
     `missions_run` ANTES do pipeline de agentes.
   - O `MissionRun.resultText` é salvo a partir de
     `MissionAgentsResult.finalizer_output` (output do
     Finalizer).
   - Se o Developer gerou uma `PatchProposal` durante o
     pipeline, `missions_run` carrega o status final
     (draft / pending_approval / failed) e emite
     `mission/phase` com `phase: "patch-detected" /
     "patch-pending-approval" / "patch-failed" /
     "patch-applied"` para manter compatibilidade com a UI
     que consome o Diff Viewer via `git.changedFiles(id)` /
     `git.fileDiff(id, path)`.

4. **Integração com Provider Engine** (PR 007):
   - O `agents::run_mission_agents` resolve o
     `providerId`/`model` na ordem:
     1. `agent.providerId` / `agent.model` (configurados no
        `AgentConfig`).
     2. `default_provider_id` / `default_model` da missão
        (passados via `MissionAgentContext`).
   - Se nenhum `providerId`/`model` estiver disponível
     (nem no agente nem na missão), o provider call falha
     com erro claro e o step é marcado como `failed`.

5. **Integração com Patch Engine** (PR 010):
   - O Developer, ao responder, pode incluir um bloco
     `fluxora_patch` opcional (formato JSON definido na
     PR 010).
   - `agents::run_mission_agents` extrai o bloco via
     `missions::extract_fluxora_patch_block` e chama
     `crate::patches::create_proposal_from_provider_text` da
     PR 010.
   - A `PatchProposal` criada é persistida em `patches.json`
     e fica disponível para a UI via
     `patches.listByMission(missionId)` /
     `git.changedFiles(workflowRunId)` /
     `git.fileDiff(workflowRunId, filePath)`.

6. **Eventos `agent/*`** (7 tipos) no canal
   `fluxora-event`:
   - `agent/defaults-created` (info) — quando os 4 agentes
     padrão são criados pela primeira vez.
   - `agent/settings-updated` (info) — quando um agente é
     atualizado.
   - `agent/step-started` (info) — antes da chamada do
     provider.
   - `agent/step-completed` (info) — após a chamada do
     provider.
   - `agent/step-failed` (error) — quando o provider falha.
   - `agent/plan-created` (info) — quando o Planner termina.
   - `agent/qa-completed` (info) — quando o QA termina.

### 4.2 Fora do runtime Tauri (browser/Vite dev)

- `mock-api.ts` ganhou stubs no namespace `agents`:
  `listConfigs` / `getConfig` / `createConfig` /
  `updateConfig` / `resetDefaults` (todos devolvem `[]` ou
  stubs).
- `mock-api.ts` ganhou stubs no namespace `agentSteps`:
  `listByMission` (devolve `[]`) e `get` (devolve `null`).
- `mock-api.ts` ganhou `models.updateAgentConfigModel` como
  stub.
- `desktopBridge` chama esses stubs fora do runtime Tauri
  (delegando para `mock.agents.*` / `mock.agentSteps.*`).
- A UI continua funcionando no navegador (passo a passo
  via mock).

### 4.3 Quem ouve os eventos `agent/*`

- `desktopBridge` (PR 005) despacha para todos os
  subscribers locais.
- `window.fluxora.events.on("agent/step-completed", cb)` /
  `events.on("agent/plan-created", cb)` / etc. estão
  disponíveis para componentes novos.
- A UI atual não precisa assinar `agent/*` diretamente — o
  `workflows.getStepOutputs` / `listAgentOutputs` agora
  retorna os steps reais (em vez de sintéticos) sem
  alteração de componente.

## 5. Métodos `agents.*` (canônico novo)

| Método | Status na PR 011 |
|---|---|
| `agents.listConfigs()` | **real** (Tauri `agents_list`), mock devolve `[]` |
| `agents.getConfig(id)` | **real** (Tauri `agents_get`), mock devolve `null` |
| `agents.createConfig(input)` | **real** (Tauri `agents_create`), mock devolve stub |
| `agents.updateConfig(id, input)` | **real** (Tauri `agents_update`), mock devolve stub |
| `agents.resetDefaults()` | **real** (Tauri `agents_reset_defaults`), mock devolve `[]` |

## 6. Métodos `agentSteps.*` (canônico novo)

| Método | Status na PR 011 |
|---|---|
| `agentSteps.list(workflowRunId)` | **real** (Tauri `agent_steps_list_by_mission` + converte para `AgentStepOutput` legado), mock devolve `[]` |
| `agentSteps.listByMission(missionId)` | **real** (Tauri `agent_steps_list_by_mission`), mock devolve `[]` |
| `agentSteps.get(stepId)` | **real** (Tauri `agent_steps_get`), mock devolve `null` |

## 7. Métodos `models.*` (canônico novo)

| Método | Status na PR 011 |
|---|---|
| `models.updateAgentModel(agentId, input)` | **mock** legado preservado (sem alteração) |
| `models.updateAgentConfigModel(agentId, { providerId, model })` | **real** (Tauri `agents_update_config` com `providerId`/`model` derivados do input), mock devolve stub |

## 8. Métodos legados adaptados em runtime Tauri (PR 011)

| Método | Status na PR 011 |
|---|---|
| `workflows.getStepOutputs(id)` | **real** (delega para `agent_steps_list_by_mission` + converte `AgentStepRecord` → `AgentStepOutput`); cai no `buildSyntheticSteps` legado quando a missão não tem steps reais (missões antigas) ou o backend falha |
| `workflows.listAgentOutputs(id)` | idem `getStepOutputs` |
| `workflows.get(id)` | **real** com `steps` reais (idêntico a `getStepOutputs`) |

## 9. Métodos legados preservados / inalterados

| Método | Status |
|---|---|
| `agents.list` / `create` / `update` / `remove` (legado) | mock legado (sem alteração) — `AgentsPage` continua consumindo |
| `agents.listConfigs` etc. (canônico novo) | **real** (PR 011) |
| `agentSteps.list` (legado) | agora delega para `agentSteps.listByMission` + converte para `AgentStepOutput` |
| `missions.*` | **real** (PR 008) + integração com Agent Engine (PR 011) |
| `patches.*` | **real** (PR 010) — Developer agent reaproveita o parser e o helper |
| `approvals.*` | **real** (PR 009) — `approvals.approve` estendido da PR 010 continua disparando `patches_apply` |
| `permissions.*` | **real** (PR 009) — checagens de `read-files` / `network-provider` continuam em `missions_run` antes do pipeline |
| `providers.*` | **real** (PR 007) — `agents::run_mission_agents` chama `execute_mission_chat` |
| `events.subscribe/on/listRecent/...` | inalterados (PR 005) |
| `git.inspect` / `git.diff` | inalterados (PR 003) |
| `git.changedFiles(workflowRunId)` | **real** (PR 010) — diff viewer funciona com as `PatchProposal` criadas pelo Developer |
| `git.fileDiff(workflowRunId, filePath)` | idem |
| `voice.*` | inalterados (PR 006) |
| `projects.*` / `filesystem.*` | inalterados (PR 002, PR 003) |
| `commands.*` | mock legado |
| `opencode.*` | inalterado |
| `env.get/has` | mock legado |
| `models.updateAgentModel` (legado) | mock legado preservado |

A UI continua consumindo `window.fluxora.workflows.*` e
`window.fluxora.agents.*` exatamente como antes — o
`desktopBridge` faz a ponte para os steps reais do Agent
Engine.

## 10. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type FluxoraAgentRole =
  | "planner"
  | "developer"
  | "qa"
  | "finalizer"
  | "custom";

export type FluxoraAgentStatus = "enabled" | "disabled";

export type FluxoraAgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentConfig {
  id: string;
  name: string;
  role: FluxoraAgentRole;
  description?: string;
  providerId?: string;
  model?: string;
  status: FluxoraAgentStatus;
  systemPrompt?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentConfigInput {
  name: string;
  role: FluxoraAgentRole;
  description?: string;
  providerId?: string;
  model?: string;
  status?: FluxoraAgentStatus;
  systemPrompt?: string;
  order?: number;
}

export interface UpdateAgentConfigInput {
  name?: string;
  description?: string;
  providerId?: string;
  model?: string;
  status?: FluxoraAgentStatus;
  systemPrompt?: string;
  order?: number;
}

export interface AgentStepRecord {
  id: string;
  missionId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  role: FluxoraAgentRole;
  status: FluxoraAgentStepStatus;
  inputSummary?: string;
  outputSummary?: string;
  outputText?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}
```

Namespaces atualizados em `FluxoraAPI`:

```ts
agents: {
  // Legado (preservado)
  list(): Promise<Agent[]>;
  create(input: CreateAgentInput): Promise<Agent>;
  update(id: string, input: UpdateAgentInput): Promise<Agent>;
  remove(id: string): Promise<void>;
  // PR 011 — Canônico novo
  listConfigs(): Promise<AgentConfig[]>;
  getConfig(id: string): Promise<AgentConfig | null>;
  createConfig(input: CreateAgentConfigInput): Promise<AgentConfig>;
  updateConfig(id: string, input: UpdateAgentConfigInput): Promise<AgentConfig>;
  resetDefaults(): Promise<AgentConfig[]>;
};

agentSteps: {
  // Legado
  list(workflowRunId: string): Promise<AgentStepOutput[]>;
  // PR 011 — Canônico novo
  listByMission(missionId: string): Promise<AgentStepRecord[]>;
  get(stepId: string): Promise<AgentStepRecord | null>;
};

models: {
  // Legado
  updateAgentModel(agentId: string, input: AgentModelSettingInput): Promise<Agent>;
  // PR 011 — Canônico novo
  updateAgentConfigModel(
    agentId: string,
    input: { providerId?: string | null; model?: string | null }
  ): Promise<AgentConfig>;
};
```

Tipos legados `Agent` / `AgentStepOutput` /
`AgentStepStatus` / `MultiAgentRole` / `Agent` /
`CreateAgentInput` / `UpdateAgentInput` /
`AgentModelSettingInput` / `AgentRole` /
`BUILT_IN_AGENT_ROLES` preservados intactos — a UI que os
consome não muda.

## 11. Backend Rust criado/alterado

### 11.1 Criado

- `apps/desktop/src-tauri/src/agents.rs` — **novo**,
  ~1 100 linhas:
  - `AgentConfigRecord` / `AgentStepRecord` /
    `AgentStatus` / `StepStatus` (com `serde` camelCase).
  - `AgentsState` (Mutex de configs + mutex de steps)
    gerenciado via `tauri::Builder::manage`.
  - `AgentsFile` / `AgentStepsFile` (structs versionadas para
    JSON).
  - `agents_file_path` / `ensure_agents_dir` /
    `read_agents_file` / `write_agents_file` /
    `read_agent_steps_file` / `write_agent_steps_file`.
  - `load_agents_on_startup` (carrega `agents.json` +
    `agent_steps.json` no startup).
  - `persist_agents` / `persist_agent_steps` (gravam em
    disco após cada mudança).
  - Constantes de limites:
    `MAX_STEP_OUTPUT_BYTES=256 KiB`,
    `MAX_INPUT_SUMMARY_CHARS=1 000`,
    `MAX_ERROR_MESSAGE_CHARS=500`,
    `MAX_AGENTS_PER_MISSION=4`.
  - System prompts internos padrão (`PLANNER_PROMPT`,
    `DEVELOPER_PROMPT`, `QA_PROMPT`, `FINALIZER_PROMPT`).
  - `ensure_default_agents` (cria os 4 agentes padrão sob
    demanda, idempotente).
  - `emit_agent_event` (helper de evento `agent/*` no
    barramento `fluxora-event`).
  - 7 testes unitários.
  - 10 comandos Tauri.
  - Função `run_mission_agents` (pipeline de 4 agentes
    sequenciais com integração ao Provider Engine, Patch
    Engine, e persistência de steps).
  - `MissionAgentContext` (struct interna com os dados
    necessários para o pipeline).
  - `MissionAgentsResult` (struct interna com
    `finalizer_output` e `patch_proposal_id`).
  - `build_agent_messages` (constrói `input_summary` e
    `messages` específicos por role — NUNCA expõe
    `outputText` completo entre agentes).
  - `summarize_text` (gera resumo curto de um texto —
    primeiro parágrafo, ou primeiros N chars).

### 11.2 Alterado

- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod agents;` adicionado.
  - `use agents::{AgentConfigRecord, AgentStepRecord};` adicionado.
  - 2 payloads novos: `CreateAgentPayload`,
    `UpdateAgentPayload`.
  - 10 comandos Tauri adicionados ao `invoke_handler`:
    `agents_ping` / `agents_list` / `agents_get` /
    `agents_create` / `agents_update` / `agents_remove` /
    `agents_reset_defaults` / `agent_steps_list` /
    `agent_steps_list_by_mission` / `agent_steps_get`.
  - 1 novo `manage(...)` no `Builder`:
    `agents::AgentsState::new()`.
  - 1 nova chamada no `setup`:
    `agents::load_agents_on_startup(&handle)`.

- `apps/desktop/src-tauri/src/missions.rs`:
  - `use crate::agents;` adicionado.
  - `missions_run` foi estendido: substitui a chamada única
    a `providers::execute_mission_chat` e a extração manual
    do bloco `fluxora_patch` por uma chamada a
    `agents::run_mission_agents` com `MissionAgentContext`.
  - O `MissionRun.resultText` é salvo a partir de
    `MissionAgentsResult.finalizer_output`.
  - Se o Developer gerou uma `PatchProposal` durante o
    pipeline, o status final (`draft` / `pending_approval` /
    `applied` / `failed`) é carregado do `PatchesState` e
    `mission/phase` é emitido com `phase: "patch-detected" /
    "patch-pending-approval" / "patch-failed" /
    "patch-applied"` para manter compatibilidade com a UI.
  - 1 warning `#[allow(dead_code)]` adicionado em
    `FluxoraPatchExtract` (campos `cleaned_text` / `raw_json`
    não são mais usados pelo Mission Engine — a extração
    agora é feita pelo Agent Engine).

`Cargo.toml` não precisou de dependências novas (apenas
`serde`, `serde_json`, `time`, `tauri` que já estavam
presentes).

## 12. Arquivos frontend alterados

### 12.1 `packages/shared/src/index.ts`

- Adicionados: `FluxoraAgentRole`, `FluxoraAgentStatus`,
  `FluxoraAgentStepStatus`, `AgentConfig`,
  `CreateAgentConfigInput`, `UpdateAgentConfigInput`,
  `AgentStepRecord`.
- Adicionado namespace `agents.listConfigs/getConfig/
  createConfig/updateConfig/resetDefaults` (canônico novo).
- Adicionado `agentSteps.listByMission/get` (canônico novo).
- Adicionado `models.updateAgentConfigModel` (canônico novo).
- Removida a duplicata de `agentSteps` (mantido só o
  canônico novo com `list/listByMission/get`).

### 12.2 `apps/desktop/src/api/mock-api.ts`

- Imports dos tipos novos: `AgentConfig`,
  `CreateAgentConfigInput`, `UpdateAgentConfigInput`,
  `AgentStepRecord`.
- Adicionado namespace `agents` com 5 métodos stubs
  (`listConfigs` / `getConfig` / `createConfig` /
  `updateConfig` / `resetDefaults`) para fallback fora do
  runtime Tauri.
- Adicionado `models.updateAgentConfigModel` stub.
- Adicionado `agentSteps.listByMission` / `get` stubs.
- `agentSteps.list` legado preservado (compatibilidade).

### 12.3 `apps/desktop/src/services/desktopBridge.ts`

- Imports dos tipos novos: `Agent`, `AgentConfig`,
  `AgentStepRecord`, `CreateAgentConfigInput`,
  `UpdateAgentConfigInput`.
- 8 helpers de baixo nível adicionados: `listAgentConfigsTauri`
  / `getAgentConfigTauri` / `createAgentConfigTauri` /
  `updateAgentConfigTauri` / `removeAgentConfigTauri` /
  `resetAgentDefaultsTauri` /
  `listAgentStepsByMissionTauri` / `getAgentStepTauri`.
- Função `toLegacyAgentStepOutput(step)` (converte
  `AgentStepRecord` → `AgentStepOutput` legado).
- Função `loadRealAgentSteps(missionId)` (carrega os
  `AgentStepRecord` reais em runtime Tauri e converte para
  `AgentStepOutput`; retorna `null` em fallback).
- `workflows.get(id)` / `getStepOutputs(id)` /
  `listAgentOutputs(id)` agora usam `loadRealAgentSteps` e
  caem no `buildSyntheticSteps` legado quando a missão não
  tem steps reais.
- `agents` / `agentSteps` / `models` sobrescritos no
  `createDesktopBridge` com a nova superfície canônica +
  legados preservados.
- `agentSteps.list(workflowRunId)` (legado) agora delega
  para `listByMission` + `toLegacyAgentStepOutput`.

### 12.4 Não alterados (UI preservada)

- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/pages/ExecutionDetailPage.tsx`
- `apps/desktop/src/pages/ExecutionsPage.tsx`
- `apps/desktop/src/pages/AgentsPage.tsx` (continua
  consumindo `agents.list/create/update/remove` legados)
- `apps/desktop/src/pages/ApprovalsPage.tsx`
- `apps/desktop/src/components/events/EventLog.tsx`
- `apps/desktop/src/components/diff/DiffViewer.tsx`
- `apps/desktop/src/components/agents/AgentStepOutputPanel.tsx`
- `apps/desktop/src/components/settings/ControlledExecutionPanel.tsx`
- `apps/desktop/src/components/layout/*` (AppShell,
  StatusBar, RightPanel)
- `apps/desktop/src/components/overview/*`
- `apps/desktop/src/components/workflow/*`
- `apps/desktop/src/hooks/*` (useLiveExecutionEvents,
  useActiveRuns, usePendingApprovals, useUsageStats)
- Qualquer outro componente React

A UI atual continua consumindo `AgentStepOutput[]` via
`workflows.getStepOutputs(workflowRunId)` /
`listAgentOutputs(workflowRunId)` exatamente como antes — o
`desktopBridge` faz a ponte para os `AgentStepRecord` reais
do Agent Engine.

## 13. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente os namespaces `agents` (legado + canônico
novo), `agentSteps` (legado + canônico novo) e `models`
(legado + canônico novo), além dos namespaces `missions`
(PR 008), `workflows` (PR 008-010), `permissions` (PR 009),
`scheduler` (PR 009), `approvals` (PR 009-010), `patches`
(PR 010) e os demais legados.

### Namespace `agents` (PR 011 — estendido)

- `list` / `create` / `update` / `remove` (legado):
  delegam para `mock.agents.*` (sem alteração).
- `listConfigs()` → em runtime Tauri, chama
  `listAgentConfigsTauri` que delega para
  `agents_list`. Fora, devolve `[]`.
- `getConfig(id)` → `agents_get`.
- `createConfig(input)` → `agents_create`.
- `updateConfig(id, input)` → `agents_update`.
- `resetDefaults()` → `agents_reset_defaults`.

### Namespace `agentSteps` (PR 011 — estendido)

- `list(workflowRunId)` (legado) → em runtime Tauri, delega
  para `listByMission` + `toLegacyAgentStepOutput`. Fora,
  devolve `[]` (via mock).
- `listByMission(missionId)` → `agent_steps_list_by_mission`.
- `get(stepId)` → `agent_steps_get`.

### Namespace `models` (PR 011 — estendido)

- `updateAgentModel(agentId, input)` (legado) →
  `mock.models.updateAgentModel` (sem alteração).
- `updateAgentConfigModel(agentId, { providerId, model })` →
  em runtime Tauri, chama `updateAgentConfigTauri(id, {...})`
  com `providerId`/`model` derivados do input (null vira
  string vazia para limpar). Fora, devolve stub.

### Namespace `workflows.getStepOutputs` / `listAgentOutputs` (PR 011)

- `getStepOutputs(workflowRunId)` / `listAgentOutputs(id)`:
  em runtime Tauri, chama `loadRealAgentSteps(id)` que
  delega para `agent_steps_list_by_mission` e converte para
  `AgentStepOutput[]`. Se retornar `null` (missões antigas
  sem steps reais, ou falha de backend), cai no
  `buildSyntheticSteps` legado (PR 008). Fora, cai no mock
  legado.

### Resultado

A UI continua consumindo `window.fluxora.workflows.*` e
`window.fluxora.agents.*` exatamente como antes. Os steps
reais do Agent Engine (Planner / Developer / QA / Finalizer)
substituem os steps sintéticos em runtime Tauri sem
alteração de componente.

## 14. Como agentes são persistidos

### 14.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/agents.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada agente tem:
  - `id`, `name`, `role` (`planner` / `developer` / `qa` /
    `finalizer` / `custom`)
  - `description?`, `providerId?`, `model?`
  - `status` (`enabled` / `disabled`)
  - `systemPrompt?` (system prompt interno seguro)
  - `order` (0 = primeiro no pipeline)
  - `createdAt`, `updatedAt`
- `load_agents_on_startup` é chamado no `setup` do Tauri.
  Log: `[fluxora agents] carregados N agente(s)`.
- `agents_create` / `agents_update` / `agents_remove` /
  `agents_reset_defaults` persistem em `agents.json` no disco
  após cada mudança.

### 14.2 Em runtime Tauri (steps)

- Arquivo: `<app_data_dir>/fluxora/agent_steps.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada step tem:
  - `id`, `missionId`, `projectId`
  - `agentId`, `agentName`, `role`
  - `status` (`pending` / `running` / `completed` / `failed`
    / `skipped`)
  - `inputSummary?` (até 1 000 chars)
  - `outputSummary?` (até 280 chars)
  - `outputText?` (até 256 KiB)
  - `startedAt?`, `completedAt?`
  - `error?` (até 500 chars)
  - `createdAt`, `updatedAt`
  - `metadata?` (JSON arbitrário com `model`,
    `providerId`, `durationMs`, `proposalId`,
    `proposalStatus`, `filesCount` quando aplicável)
- `load_agents_on_startup` carrega
  `agent_steps.json` no startup. Log:
  `[fluxora agent_steps] carregados N step(s) de agente`.
- `run_mission_agents` persiste cada step em
  `agent_steps.json` após cada mudança de status
  (`pending` → `running` → `completed` / `failed`).

### 14.3 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência).

### 14.4 Storage seguro de secrets

- API key do provider **nunca** é registrada em
  `agents.json` ou `agent_steps.json` (os agentes referenciam
  apenas `providerId` e `model`, não chaves).
- API key **nunca** aparece em eventos `agent/*` nem
  `mission/*`. O payload dos eventos inclui apenas `agentId`,
  `role`, `agentName`, `outputLength`, `durationMs`,
  `proposalId` (quando aplicável), e `errorMessage` (truncado
  e sem chave).

## 15. Local do `agents.json` e `agent_steps.json`

`<app_data_dir>/fluxora/agents.json` e
`<app_data_dir>/fluxora/agent_steps.json`

Onde `app_data_dir` é resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora.v1`, a
localização esperada tende a ser equivalente a:

```
~/.local/share/com.fluxora.v1/fluxora/agents.json
~/.local/share/com.fluxora.v1/fluxora/agent_steps.json
```

## 16. Quais agentes padrão foram criados

| `id` | `name` | `role` | `order` | System prompt (resumo) |
|---|---|---|---|---|
| `agent-planner` | Planner | `planner` | 0 | Entender a missão, analisar contexto do projeto, criar plano de ação em etapas. Não alterar arquivos. Não gerar patch. |
| `agent-developer` | Developer | `developer` | 1 | Propor solução com base no plano. Pode incluir bloco `fluxora_patch` ao final. Não executar comandos. Não fazer commit. |
| `agent-qa` | QA | `qa` | 2 | Revisar a proposta do Developer. Verificar riscos, inconsistências, arquivos perigosos. Não executar testes reais. |
| `agent-finalizer` | Finalizer | `finalizer` | 3 | Consolidar o resultado final para o usuário. Resumir o que foi feito, proposto, o que precisa de aprovação, próximos passos. |

Os IDs são determinísticos (`agent-planner` etc.) para que
re-chamadas a `ensure_default_agents` não dupliquem agentes.

## 17. Como o Mission Engine executa agentes

1. `missions_run` resolve o `providerId` e `model` da missão
   (PR 008 + 009).
2. Verifica `read-files` (PR 009).
3. Coleta contexto do projeto (até 10 arquivos × 32 KiB ×
   128 KiB total — PR 008).
4. Constrói o `build_mission_prompt` (system + user) — ainda
   reusado para a missão, mas o prompt real enviado ao
   provider é o do `build_agent_messages` específico do role.
5. Verifica `network-provider` (PR 009).
6. Chama `agents::run_mission_agents(app, &ctx)` com
   `MissionAgentContext { mission, user_prompt, project_name,
   project_stack, context_text, default_provider_id,
   default_model }`.
7. `run_mission_agents`:
   - Chama `ensure_default_agents` (cria Planner / Developer
     / QA / Finalizer se não existirem).
   - Para cada agente (ordenado por `order`, filtrado por
     `enabled`, truncado em 4):
     1. Cria o `AgentStepRecord` (`status: "running"`).
     2. Constrói `input_summary` e `messages` via
        `build_agent_messages`.
     3. Resolve `providerId`/`model` (agente > missão).
     4. Chama `providers::execute_mission_chat` (PR 007).
     5. Persiste o step como `completed` (com `outputText`,
        `outputSummary`, `metadata`) ou `failed` (com
        `error`).
     6. Emite `agent/step-completed` ou `agent/step-failed`.
     7. Eventos específicos do role: `agent/plan-created`
        (Planner), `agent/qa-completed` (QA).
     8. Se Developer, extrai `fluxora_patch` e cria
        `PatchProposal` via `patches::create_proposal_from_provider_text`.
8. `missions_run` recebe `MissionAgentsResult { finalizer_output,
   patch_proposal_id }`.
9. Se `patch_proposal_id` foi gerada, carrega o status final
   da `PatchProposal` do `PatchesState` e emite
   `mission/phase` com `phase: "patch-detected" /
   "patch-pending-approval" / "patch-failed" /
   "patch-applied"`.
10. Salva `resultText = finalizer_output` na missão.
11. Marca a missão como `completed` e emite
    `mission/completed`.

## 18. Como Provider Engine é chamado por agente

Cada agente chama `providers::execute_mission_chat` (helper
público da PR 007) com:

- `providerId`: `agent.providerId` se definido, senão
  `default_provider_id` (resolvido pela missão).
- `model`: `agent.model` se definido, senão `default_model`.
- `messages`: `vec![system, user]` montados por
  `build_agent_messages` (system prompt interno + user
  message com contexto + plano do Planner + proposta do
  Developer, etc., dependendo do role).
- `max_tokens: Some(2048)`.

O helper `execute_mission_chat` (PR 007) cuida de:
- Validar provider existe / está `enabled` / kind suportado.
- Resolver API key (env var ou literal).
- Timeout 90s.
- HTTP ao adapter OpenAI-compatible.
- Truncar erros em 500 chars, sem chave.
- Mascarar chave no log de stderr em caso de erro.

A API key **nunca** é retornada ao `run_mission_agents` —
fica apenas no `providers.rs`.

## 19. Como Patch Engine é usado pelo Developer

1. O Developer responde com um texto que pode incluir um
   bloco `fluxora_patch` ao final:
   ```
   ```fluxora_patch
   {
     "title": "...",
     "summary": "...",
     "files": [
       { "path": "...", "operation": "modify", "afterContent": "..." }
     ]
   }
   ```
   ```
2. `agents::run_mission_agents` extrai o bloco via
   `missions::extract_fluxora_patch_block` (parser da PR 010,
   exposto como `pub(crate)`).
3. Se o bloco for válido e tiver pelo menos 1 arquivo, chama
   `crate::patches::create_proposal_from_provider_text(app,
   ctx.mission, title, summary, files)` (PR 010):
   - Valida paths (rejeita `..`, absolutos, drive letters,
     diretórios proibidos).
   - Lê `beforeContent` do projeto (para `modify` / `delete`).
   - Calcula `additions` / `deletions` via LCS.
   - Cria a `PatchProposal` (`status: "draft"`).
   - Verifica a política do projeto:
     - Se `deny` em qualquer ação → `status: "failed"`.
     - Se `ask` em qualquer ação → cria
       `ExecutionApproval` (action: `apply-patch`) e marca
       a proposta como `pending_approval`.
     - Se `allow` em todas → `status: "draft"`.
4. Em caso de sucesso, atualiza o `metadata` do step do
   Developer com `proposalId`, `proposalStatus`, `filesCount`.
5. Em caso de falha, loga warning (sem falhar o step — o
   Developer respondeu OK, mas a proposta não pôde ser
   criada).
6. O `mission_run` reflete o status final em
   `mission/phase` para a UI.

## 20. Como `workflows.getStepOutputs` e `listAgentOutputs` funcionam agora

### `getStepOutputs(workflowRunId)` em runtime Tauri

1. Chama `loadRealAgentSteps(workflowRunId)`.
2. `loadRealAgentSteps` invoca
   `agent_steps_list_by_mission(missionId)` no Tauri.
3. Se o backend devolver `AgentStepRecord[]` com pelo menos
   1 step, mapeia para `AgentStepOutput[]` via
   `toLegacyAgentStepOutput`:
   - `id = step.id`
   - `workflowRunId = step.missionId`
   - `projectId = step.projectId`
   - `stepId = step.agentId`
   - `agentRole = step.role` (`planner` / `developer` /
     `qa` / `finalizer` / `custom`)
   - `agentName = step.agentName`
   - `prompt = step.inputSummary`
   - `output = step.outputText ?? step.outputSummary`
   - `parsedOutput = JSON.stringify(step.metadata)` (se houver)
   - `status` mapping: `pending` / `running` → `running`,
     `completed` → `completed`, `failed` → `failed`,
     `skipped` → `cancelled`
   - `startedAt = step.startedAt ?? step.createdAt`
   - `completedAt = step.completedAt`
4. Se `loadRealAgentSteps` retornar `null` (missão sem steps
   reais, ou backend falhou), cai no `buildSyntheticSteps`
   legado da PR 008.
5. Fora do runtime Tauri, cai no mock legado.

### `listAgentOutputs(workflowRunId)` em runtime Tauri

Idem `getStepOutputs` (mesmo pipeline).

## 21. Como `models.updateAgentModel` funciona agora

**`models.updateAgentModel(agentId, input)` (legado)**:
- Mantido mock (sem alteração). A UI atual não consome.
- Atualiza `agent.modelProviderId` / `agent.modelName` no
  `Agent` legado (em memória).

**`models.updateAgentConfigModel(agentId, { providerId, model })` (canônico novo)**:
- Em runtime Tauri, chama `agents_update` com
  `UpdateAgentConfigInput { providerId, model }` derivado do
  input:
  - `null` → string vazia (limpa o campo).
  - `undefined` → mantém o campo como está (não enviado).
  - valor → enviado como está.
- Em runtime browser, devolve stub.

## 22. Como eventos `agent/*` são emitidos

Todos via `agents::emit_agent_event` em `agents.rs`, que
monta um `FluxoraEvent` com `source: "agent"`, `projectId`,
`missionId` (opcional), `agentId` (opcional) e chama
`events::emit_to_app` (PR 005).

| Tipo | Quando | `level` | Payload |
|---|---|---|---|
| `agent/defaults-created` | `ensure_default_agents` cria os 4 padrão pela primeira vez | `info` | `{ defaultRoles: ["planner", "developer", "qa", "finalizer"] }` |
| `agent/settings-updated` | `agents_update` | `info` | `{ agentName, role }` |
| `agent/step-started` | Início de cada step no `run_mission_agents` | `info` | `{ stepId, role, agentName, order }` |
| `agent/step-completed` | Após `providers::execute_mission_chat` retornar OK | `info` | `{ stepId, role, agentName, outputLength, durationMs }` |
| `agent/step-failed` | Quando `providers::execute_mission_chat` retorna Err | `error` | `{ stepId, role, agentName, errorMessage }` |
| `agent/plan-created` | Quando o Planner termina | `info` | `{ stepId, outputLength }` |
| `agent/qa-completed` | Quando o QA termina | `info` | `{ stepId, outputLength }` |

**Nunca inclui**:
- API key (mesmo mascarada).
- Conteúdo completo do output (`outputText` é salvo no step,
  não emitido no evento).
- Path absoluto do projeto (só `projectId`).
- Mensagens longas de erro — truncadas em 500 chars.

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "agent"`.

## 23. Limites de segurança implementados

1. **Output truncado em 256 KiB por step**:
   `MAX_STEP_OUTPUT_BYTES = 256 * 1024`. O `truncate_output`
   preserva o boundary UTF-8 (evita cortar no meio de um char).
2. **Input summary truncado em 1 000 chars**:
   `MAX_INPUT_SUMMARY_CHARS`.
3. **Erro truncado em 500 chars**: `MAX_ERROR_MESSAGE_CHARS`.
4. **Máximo de 4 agentes por missão**:
   `MAX_AGENTS_PER_MISSION = 4`. Agentes adicionais são
   ignorados na execução (mas listáveis).
5. **Path safety rigoroso** (herdado da PR 010 via
   `patches::create_proposal_from_provider_text`): rejeita
   `..`, absolutos, drive letters, 12 diretórios proibidos.
6. **Permissões por operação** (herdado da PR 010):
   `create` → exige `create-files` allow; `modify` → exige
   `apply-patch` + `write-files` allow; `delete` → exige
   `delete-files` allow.
7. **Falha fechada em `deny`** (PR 010): qualquer `deny` em
   ação relevante bloqueia a aplicação.
8. **Aprovação obrigatória em `ask`** (PR 010): se houver
   `ask` em alguma ação, a proposta requer `approvalId` com
   status `approved`.
9. **Snapshot de `beforeContent`** (PR 010): para `modify`, o
   `beforeContent` (informado pelo provider ou tirado do
   disco) é comparado com o arquivo atual antes de aplicar.
10. **Aplicação atômica por arquivo** (PR 010):
    `write_atomic` escreve em `<path>.fluxora-tmp-<pid>` e
    depois `rename` sobre o path final.
11. **Falhas do Finalizer são toleráveis**: a missão pode
    completar com o output do último agente bem-sucedido
    (Developer / QA / Planner).
12. **Falhas de Planner / Developer / QA são fatais**: a
    pipeline é interrompida e `missions_run` marca a missão
    como `failed`.
13. **Não salvar chain-of-thought entre agentes**: o
    `build_agent_messages` envia apenas o
    `output_summary` (até 280 chars) do agente anterior, nunca
    o `outputText` completo.
14. **Não expor chain-of-thought**: o `summarize_text` pega o
    primeiro parágrafo do output e trunca em 280 chars.
15. **API key nunca em agents/agent_steps**: os registros
    referenciam apenas `providerId` e `model`, não chaves.
16. **API key nunca em eventos `agent/*`**: o payload inclui
    apenas `agentId`, `role`, `agentName`, `outputLength`,
    `durationMs`, `proposalId` e `errorMessage` (truncado e
    sem chave).
17. **Sem shell commands**: `agents.rs` não chama
    `std::process::Command`. Não há `Command::new` em
    `agents.rs`.
18. **Sem Git write operations**: a PR 011 não chama
    `git commit` / `git push` / `git add` / `git checkout` /
    `git reset` / `git clean` / `git merge` / `git rebase` /
    `git pull`. Não há nenhuma chamada shell em `agents.rs`.
19. **Sem tool calling**: o provider não recebe permissão
    para executar tools. Só retorna texto.
20. **Sem streaming**: `execute_mission_chat` é uma chamada
    simples. `MissionChatResult` não tem chunks incrementais.
21. **Sem OpenCode como motor**: o Agent Engine usa
    exclusivamente o Provider Engine próprio da PR 007.
22. **Reusa limites de contexto da PR 008**: 10 arquivos ×
    32 KiB × 128 KiB total; ignora binários e UTF-8 inválido.
23. **Reusa validações do Patch Engine da PR 010**: paths,
    operações, limites, 12 diretórios proibidos.
24. **Não enviar projeto inteiro ao provider**: o contexto
    é conservador (10 arquivos × 32 KiB × 128 KiB).

## 24. O que ainda permanece mockado

- `agents.*` (legado) — `list` / `create` / `update` /
  `remove` sobre o tipo `Agent` legado (em memória).
  `AgentsPage` continua consumindo.
- `models.updateAgentModel(agentId, input)` (legado) — mock
  legado. A UI atual não consome.
- `agentSteps.list(workflowRunId)` (legado) — agora delega
  para `agentSteps.listByMission` + converte para
  `AgentStepOutput` legado (em runtime Tauri é real via
  Agent Engine).
- `events.onWorkflowEvent` / `onJobUpdated` /
  `onApprovalChange` / `onOpenCodeStdout/Stderr/JsonEvent`
  — alimentados pelos simuladores do mock. A UI atual faz
  polling de `events.list` a cada 2s, que delega para
  `missions_list_logs` (PR 008) e reflete logs reais do
  Mission Engine + Agent Engine.
- `opencode.controlledExecution.*` — stub.
- `whisper.*` / `whisperLocal.*` — mock (bundle e
  download).
- `voice.saveAudio*` / `getAudioPath` / `cleanupOldAudio`
  / `getAudioStorageStats` / `openAudioFolder` — mock
  (sem persistência de áudio em disco).
- `env.get/has` — mock.
- `commands.*` — mock legado.
- Streaming de provider — não implementado.
- Tool calling — não implementado.
- Execução de comandos de shell — não implementada.
- Git write operations — não implementadas.
- Marketplace de agents — não implementado.
- Agentes paralelos — não implementados (sequencial nesta
  PR).

## 25. Como validar manualmente

### 25.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.agents.listConfigs()` deve devolver `[]`
  (mock fallback).
- `window.fluxora.agentSteps.listByMission("qualquer")` deve
  devolver `[]` (mock fallback).
- `window.fluxora.workflows.getStepOutputs("qualquer")` deve
  continuar devolvendo os steps do mock legado — sem mudança
  de comportamento no navegador.

### 25.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Logs esperados no startup (além dos das PRs anteriores):

```
[fluxora agents] carregados 0 agente(s)
[fluxora agent_steps] carregados 0 step(s) de agente
```

A validação completa é pelo console do DevTools:

```js
// 1) Listar projects
const projects = await window.fluxora.projects.list();

// 2) Listar providers
const providers = await window.fluxora.providers.list();

// 3) Criar provider (se ainda não houver)
if (providers.length === 0) {
  await window.fluxora.providers.create({
    name: "Local LLM",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "lm-studio",
    defaultModel: "qwen2.5-7b-instruct",
    enabled: true,
  });
}

// 4) Listar agentes (cria os 4 padrão sob demanda)
const agents = await window.fluxora.agents.listConfigs();
// → [
//   { id: "agent-planner", name: "Planner", role: "planner", ... },
//   { id: "agent-developer", name: "Developer", role: "developer", ... },
//   { id: "agent-qa", name: "QA", role: "qa", ... },
//   { id: "agent-finalizer", name: "Finalizer", role: "finalizer", ... },
// ]

// 5) Atualizar provider/model do Planner (canônico novo)
await window.fluxora.models.updateAgentConfigModel(
  agents[0].id,
  { providerId: providers[0].id, model: providers[0].defaultModel }
);

// 6) Criar + executar missão (roda o pipeline de 4 agentes)
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "assistido",
  prompt: "Analise o README.md e proponha uma melhoria pequena e segura.",
});

// 7) Listar steps reais da missão
const steps = await window.fluxora.agentSteps.listByMission(run.id);
// → [Planner, Developer, QA, Finalizer]

// 8) Steps legados (forma consumida pelo AgentStepOutputPanel)
const legacySteps = await window.fluxora.workflows.getStepOutputs(run.id);
// → [AgentStepOutput (Planner), AgentStepOutput (Developer), ...]

// 9) WorkflowRunDetail com steps reais
const detail = await window.fluxora.workflows.get(run.id);
// → WorkflowRunDetail { id: run.id, status: "completed", steps: [...], events: [...], ... }

// 10) Verificar eventos
const recent = await window.fluxora.events.listRecent({ limit: 100 });
// → inclui agent/step-started, agent/step-completed,
//    agent/plan-created, agent/qa-completed,
//    mission/phase, mission/completed
```

### 25.3 Cenários de erro (validação manual)

1. **Provider sem `defaultModel`**: o Mission Engine falha
   com "Nenhum modelo informado e o provider 'X' não tem
   defaultModel configurado." (PR 008) — o pipeline de
   agentes não inicia.

2. **Política `deny` em `apply-patch`**: se o Developer
   gerar `fluxora_patch` e a política do projeto tiver
   `"apply-patch": "deny"`, a `PatchProposal` é criada com
   `status: "failed"`, e o Agent Engine loga warning
   (sem falhar o step do Developer).

3. **Path inválido no `fluxora_patch`**: o
   `patches::create_proposal_from_provider_text` rejeita
   paths com `..` / absolutos / diretórios proibidos (PR
   010), e o Agent Engine loga warning.

4. **Falha do provider no Planner**: o step do Planner é
   marcado como `failed`, o Agent Engine devolve `Err`, o
   `missions_run` marca a missão como `failed`, e o
   `mission/failed` é emitido com `errorMessage` truncado.

5. **Falha do provider no Finalizer**: o step do Finalizer é
   marcado como `failed`, MAS o Agent Engine devolve
   `Ok(MissionAgentsResult { finalizer_output: <output do
   Developer>, ... })` — a missão completa com o último
   output bem-sucedido.

### 25.4 Health-check do Agent Engine

Em runtime Tauri:

- `agents_ping` devolve o ISO 8601 atual.
- `agent_steps_list_by_mission("inexistente")` devolve `[]`.
- `agents_list` (com estado vazio) cria os 4 agentes padrão
  sob demanda e devolve a lista.

### 25.5 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 54 testes passando (5 voice + 11 providers + 8 permissions +
#  3 approvals + 8 missions + 12 patches + 7 agents)
```

## 26. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/assets/index-*.js` 830.83 KiB / 228.78 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 54/54 testes passando (7 novos do agents) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 90s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~1.7s (rebuild incremental) → binário `target/debug/fluxora_v1` inicia. Logs do Agent Engine: `[fluxora agents] carregados 0 agente(s)` e `[fluxora agent_steps] carregados 0 step(s) de agente`. Nenhum loop, nenhum erro de runtime. |

## 27. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004, 005, 006, 007, 008, 009 e 010.
**Nenhuma regressão** de teste. **7 novos testes Rust**
passando (54 totais). Build de produção sem warnings novos.

## 28. Erros conhecidos

### 28.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral.
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual.

### 28.2 Limitações desta PR

- **Steps sintéticos legados**: o `buildSyntheticSteps` da
  PR 008 ainda existe como fallback quando a missão não tem
  `AgentStepRecord` (missões antigas geradas antes da PR
  011, ou falha de backend). Pode ser removido em PR futura
  quando todas as missões migrarem.
- **`MissionJob` continua não persistido em disco** (PR
  009) — restart do app reinicia o estado de jobs. A
  `MissionRun` correspondente em `missions.json` carrega o
  estado durável; os `AgentStepRecord` em `agent_steps.json`
  carregam o histórico de steps.
- **Missões `running` não podem ser canceladas** (PR 009) —
  o `scheduler_cancel_job` marca o `MissionJob` como
  `cancelled`, mas a pipeline de agentes continua até o fim.
- **Aprovações `ask` não disparam retomada automática da
  missão** (PR 009) — a missão termina como `completed` ou
  `failed`. Em runtime Tauri, aprovar via
  `approvals.approve` dispara `patches_apply` automaticamente
  (PR 010), mas a pipeline já encerrou.
- **Pipeline sequencial**: agentes paralelos não são
  suportados nesta PR. O `MAX_AGENTS_PER_MISSION = 4` é um
  limite duro.
- **Sem streaming**: `execute_mission_chat` é uma chamada
  simples. `MissionChatResult` não tem chunks incrementais.
  Cada agente espera a resposta completa antes de passar
  para o próximo.
- **Sem tool calling**: só `messages` com `role` / `content`.
- **Sem retry automático**: falhas de rede/HTTP retornam
  erro imediatamente; o usuário precisa rerun a missão.
- **`updateConfig` não permite alterar `role`**: a role é
  fixa na criação (consistente com o tipo legado). Para
  trocar de role, crie um novo agente e remova o antigo.
- **Sem cap de steps em memória**: `AgentsState.steps` é um
  `Mutex<Vec>` sem limite. Em uso intenso pode crescer.
  PR futura pode adicionar rotação por idade/quantidade.
- **Sem cap de agents em memória**: `AgentsState.agents`
  também é um `Mutex<Vec>` sem limite.
- **Fallback `buildSyntheticSteps`** ainda é usado para
  missões antigas sem steps reais. Quando todas as missões
  migrarem, o fallback pode ser removido.
- **`create_config` com `role: "custom"`** sem `order`:
  fica com `order: 99` (depois dos 4 padrão). Não é
  executado no pipeline (passa do limite de 4 agentes).
- **Output de um agente não é exposto para o próximo como
  outputText completo**: apenas o `output_summary` (até 280
  chars) é enviado para o agente seguinte. Isso pode
  parecer limitante em missões muito longas, mas garante
  que chain-of-thought não vaze.
- **Storage seguro de API keys não implementado** (chave
  pode ficar em `providers.json` em claro se o usuário
  digitar a chave literal em vez de env var) — fora do
  escopo da PR 011.

### 28.3 Caveats

- O `loadRealAgentSteps` em `desktopBridge.ts` faz cast
  `as unknown as AgentStepOutput` na conversão de
  `AgentStepRecord` → `AgentStepOutput` legado. A
  correspondência de campos é feita em
  `toLegacyAgentStepOutput`.
- O `run_mission_agents` em Rust emite um warning `eprintln!`
  quando o `patches::create_proposal_from_provider_text`
  falha (paths inválidos, política `deny`, etc.). Esses
  warnings não interrompem o pipeline.
- O `metadata` do `AgentStepRecord` do Developer inclui
  `proposalId` / `proposalStatus` / `filesCount` quando o
  patch é criado com sucesso. O `parsedOutput` legado do
  `AgentStepOutput` derivado é o JSON.stringify desse
  metadata — a UI pode exibir como "Eventos JSON" no
  `AgentStepOutputPanel`.
- O `FluxoraPatchExtract.cleaned_text` e `raw_json` ainda
  são definidos em `missions.rs` (com `#[allow(dead_code)]`)
  para não quebrar a API pública do parser, mas o
  `cleaned_text` não é mais usado pelo `missions_run` (a
  extração limpa do bloco `fluxora_patch` é feita pelo
  Agent Engine, e o `finalizer_output` do Finalizer já é o
  texto final).
- O `agent_steps_file_path` (helper privado) é `#[allow(dead_code)]`
  — o path real é resolvido inline em `read_agent_steps_file`
  / `write_agent_steps_file` para evitar duplicação.
- O `StepStatus::from_str` é `#[allow(dead_code)]` — está
  disponível para uso futuro (ex.: parsing de `status`
  vindo do backend), mas o pipeline atual só usa `as_str()`.
- O `AgentStatus::from_str` é usado pelo
  `agents_create` / `agents_update` para normalizar o
  input.

## 29. Próximas PRs recomendadas

1. **PR 012 — Streaming de providers.** SSE / WebSocket
   sobre OpenAI-compatible streaming. Substitui
   `execute_mission_chat` por `execute_mission_chat_stream`
   com callback de chunks. O Agent Engine emite
   `agent/step-chunk` (incremental) e `mission/phase` com
   `payload.chunk` para a UI mostrar progresso em tempo
   real.
2. **PR 013 — Tool calling controlado.** Adiciona suporte a
   `tools` no `execute_mission_chat` e `listModels` para
   descobrir quais ferramentas cada modelo suporta. Cria
   uma camada de execução controlada de tools (ler arquivo
   específico, listar diretório, etc.) com aprovação do
   usuário via Permissions/Approvals (PR 009).
3. **PR 014 — Execução de comandos controlada.** Adiciona
   `CommandRun` real (parser de comandos permitidos via
   política `run-commands`, sem shell interativo). O
   Developer pode propor comandos seguros
   (`cargo check`, `pnpm test`, etc.) que o usuário
   aprova.
4. **PR futura — Git commit/push controlado.** Adiciona
   `git commit` / `git push` respeitando as permissões
   `commit` / `push` da política do projeto (já em
   `PermissionsState` mas sem uso real).
5. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers, voice, agents) para um
   storage encriptado (keychain do SO,
   `tauri-plugin-stronghold`).
6. **PR futura — UI dedicada de missões/agentes/permissões.**
   Tela dedicada para listar missões, ver resultado, rerun,
   e configurar policy por projeto, agent config, e
   provider/modelo por agente. Por enquanto, console do
   DevTools é a forma canônica.
7. **PR futura — Agentes paralelos.** Permite que
   Planner + QA rodem em paralelo enquanto Developer
   executa (compartimentalização do `MissionAgentContext`).
8. **PR futura — Cap de steps em memória.** Adiciona
   rotação por idade/quantidade em `AgentsState.steps` para
   evitar crescimento indefinido.
9. **PR futura — Cap de agents em memória.** Adiciona
   rotação por idade/quantidade em `AgentsState.agents`.
10. **PR futura — Remover `buildSyntheticSteps` legado.**
    Quando todas as missões migrarem para o Agent Engine, o
    fallback pode ser removido.
11. **PR futura — Cancelamento real de missões com
    agentes.** Adiciona suporte a cancelamento de missões
    `running` durante o pipeline de agentes (com cleanup
    de `AgentStepRecord` em status `running` para
    `cancelled`).
12. **PR futura — Agentes por stack.** Auto-sugestão de
    roles custom baseado no stack do projeto (ex.:
    `backend-dev` para projetos Go, `frontend-dev` para
    projetos React).

Esta PR não iniciou nenhuma delas.

## 30. Resumo executivo

- ✅ Agent Engine criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/agents.rs`) com 10 comandos
  Tauri, persistência em
  `<app_data_dir>/fluxora/agents.json` (4 agentes padrão)
  e `<app_data_dir>/fluxora/agent_steps.json` (steps reais).
- ✅ 7 testes unitários (54 totais, todos passando).
- ✅ Pipeline de 4 agentes sequenciais (Planner → Developer
  → QA → Finalizer) integrado ao Mission Engine da PR 008.
- ✅ Integração com Provider Engine (PR 007) via
  `providers::execute_mission_chat` — cada agente pode ter
  `providerId`/`model` próprios ou herdar da missão.
- ✅ Integração com Patch Engine (PR 010) — o Developer gera
  `fluxora_patch` que vira `PatchProposal` real via
  `patches::create_proposal_from_provider_text`.
- ✅ Integração com Permissions/Approvals (PR 009) —
  `read-files` e `network-provider` continuam sendo
  checadas antes do pipeline iniciar. Patch `ask` continua
  criando `ExecutionApproval` (PR 010).
- ✅ 7 tipos de eventos `agent/*` no barramento
  `fluxora-event` (PR 005).
- ✅ `workflows.getStepOutputs(id)` /
  `listAgentOutputs(id)` agora retornam os
  `AgentStepRecord` reais (convertidos para
  `AgentStepOutput` legado) em vez dos steps sintéticos
  da PR 008. Fallback `buildSyntheticSteps` para missões
  antigas.
- ✅ `workflows.get(id)` agora inclui `steps` reais no
  `WorkflowRunDetail`.
- ✅ `agentSteps.listByMission(missionId)` / `get(stepId)`
  canônicos novos em runtime Tauri.
- ✅ `models.updateAgentConfigModel(agentId, { providerId,
  model })` canônico novo em runtime Tauri.
- ✅ `agents.listConfigs/getConfig/createConfig/updateConfig/
  resetDefaults` canônicos novos em runtime Tauri.
- ✅ `desktopBridge` preserva toda a API legada de
  `agents.*` (legado) / `agentSteps.*` (legado) /
  `models.updateAgentModel` (legado) para a UI atual não
  quebrar.
- ✅ UI preservada — nenhum componente React alterado.
  `AgentStepOutputPanel`, `ExecutionDetailPage`,
  `useUsageStats`, `AgentsPage` continuam consumindo
  `window.fluxora.*` exatamente como antes.
- ✅ Limites de segurança: 256 KiB output, 1 000 chars
  input, 500 chars erro, máximo 4 agentes por missão,
  path safety rigoroso (PR 010), permissões por operação
  (PR 010), sem shell commands, sem Git write operations,
  sem tool calling, sem streaming, sem OpenCode.
- ✅ Nenhum commit, push, checkout, reset, merge, rebase,
  branch, tag ou operação Git de escrita.
- ✅ Nenhuma referência a Electron reintroduzida.
- ✅ Nenhuma chamada a OpenCode como motor.
- ✅ API keys nunca aparecem em eventos `agent/*` ou
  `mission/*`.
- ✅ `pnpm dev` continua abrindo o Tauri sem loop, com logs
  esperados dos seis engines (missions, permissions,
  approvals, patches, agents, agent_steps).
- ✅ Documentação organizada em
  `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_011_AGENTS_STEPS.md`
  (este documento).
- ✅ Commit local criado em
  `feature/pr-011-real-agents-steps` (sem push remoto).
- ✅ Nenhuma feature fora de escopo (sem commit/push real,
  sem tool calling, sem streaming, sem storage seguro de
  secrets, sem execução de comandos).
