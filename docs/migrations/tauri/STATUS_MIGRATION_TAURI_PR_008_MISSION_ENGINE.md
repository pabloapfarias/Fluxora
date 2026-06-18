# STATUS_MIGRATION_TAURI_PR_008_MISSION_ENGINE

## 1. Objetivo da PR 008

Criar o **primeiro Mission Engine real do FluxoraV1** em
Rust/Tauri, conectando projetos reais, filesystem/Git reais,
Provider Engine próprio (PR 007) e o barramento de eventos real
(PR 005).

A PR entrega a fundação observável e controlada de missões:

- Persistência local de missões e logs (`<app_data_dir>/fluxora/missions.json`).
- Execução inicial **read-only / propositiva**: lê contexto
  do projeto, monta prompt, chama o provider configurado via
  `providers.chatOnce`, emite fases e logs, salva o resultado
  final, **sem alterar arquivos** do projeto.
- Eventos reais `mission/*` no canal `fluxora-event` da PR 005.
- Preservação completa da superfície legada
  `window.fluxora.workflows.*` (e `voice.createFromTranscript`,
  `events.list(workflowRunId)`) via adaptadores no `desktopBridge`.
- UI existente sem redesenho: as telas continuam consumindo
  `window.fluxora.workflows.*` exatamente como antes.

**Esta PR NÃO implementa piloto automático, NÃO aplica patches,
NÃO executa comandos de shell, NÃO faz Git write operations,
NÃO usa OpenCode como motor, NÃO toca em arquivos do projeto.**

A próxima PR (PR 009) vai adicionar piloto automático com
permissões por projeto, e a PR 010 vai trazer aplicação
controlada de patch/diff.

## 2. Estado herdado da PR 007

- Repositório Git local em `feature/pr-008-mission-engine`
  (criado a partir de `feature/pr-007-provider-engine`).
- `pnpm dev` na raiz abrindo o app desktop Tauri.
- `projects.*` / `git.*` / `filesystem.*` / `app.*` reais em
  Rust.
- Barramento real `fluxora-event` (PR 005) com ring buffer 200
  e canal único.
- `voice.*` / `whisper.*` real em Rust (PR 006) com
  transcrição real via Whisper HTTP.
- Provider Engine próprio (PR 007) com adapter OpenAI-compatible,
  persistência local em `providers.json`, eventos `provider/*`
  e comandos `providers_ping` / `providers_list` /
  `providers_get` / `providers_create` / `providers_update` /
  `providers_remove` / `providers_test` / `providers_list_models`
  / `providers_chat_once`.
- `desktopBridge` centralizando `invoke()` e expondo
  `window.fluxora.*`.
- O domínio `workflows.*` era 100% mock (em `mock-api.ts`):
  simuladores `simulateRealWorkflow` / `simulateMultiAgentWorkflow`
  alimentavam `onWorkflowEvent` / `onOpenCodeStdout` / `onJobUpdated`
  / `onApprovalChange` etc.
- `voice.createFromTranscript` retornava apenas `VoiceContextResult`
  (intent, title, summary, suggestedProjects, suggestedAgents,
  risk, requiresApproval) — **não criava nenhuma execução**.
- A UI (`OverviewPage`, `VoiceContextCard`, `ExecutionsPage`,
  `ExecutionDetailPage`, `useLiveExecutionEvents`, `useActiveRuns`,
  `usePendingApprovals`) consumia `window.fluxora.workflows.*` /
  `window.fluxora.voice.createFromTranscript` /
  `window.fluxora.events.*` diretamente.

## 3. Como workflows/missões funcionavam antes

### 3.1 `workflows.*` no mock

`apps/desktop/src/api/mock-api.ts` (linhas 533-759) expunha:

```ts
workflows: {
  list, create, get, simulate,
  runReal, runRealAsync, rerun,
  getJob, listJobs, cancelJob,
  approveFinal, rejectFinal,
  getStepOutputs, listAgentOutputs,
}
```

`create` inseria um `WorkflowRun` com `status: "pending_approval"`
no array em memória e já criava uma `Approval` pendente
associada. `get` retornava `WorkflowRunDetail` com `steps` (do
`workflowSteps: Map`) e `events` (do array `workflowEvents`
filtrado por `workflowRunId`).

`simulate` / `runReal` / `runRealAsync` chamavam os simuladores
`simulateWorkflow` / `simulateRealWorkflow` /
`simulateMultiAgentWorkflow`, que geravam uma sequência
determinística de `WorkflowEvent`s (ex.: "mission.received",
"planner.started", "developer.started", "qa.started",
"git.changed_files.detected", "approval.final.required") e
criavam `ChangedFile[]` fictícios para `git.changedFiles` e
`git.fileDiff`.

`rerun` clonava o `WorkflowRun` original com overrides e
disparava o simulador novamente.

`approveFinal` / `rejectFinal` transicionavam o status para
`completed` / `rejected` e emitiam `approval.final.approved` /
`approval.final.rejected`.

### 3.2 `voice.createFromTranscript` no mock

`mock-api.ts` (linha 941) chamava `buildVoiceContext` (do
`@fluxora/voice-context`), que é uma função **frontend-side**
pura: ela recebe `{ transcript, activeProject, availableProjects }`
e devolve `VoiceContextResult`. **Não criava nenhuma execução**
— a separação "contexto" vs "execução" era responsabilidade da
UI (`VoiceContextCard` chamava `workflows.create` num segundo
passo).

### 3.3 `events.list(workflowRunId)` no mock

`mock-api.ts` (linha 975):

```ts
list: async (workflowRunId?: string) => {
  if (workflowRunId) return workflowEvents.filter((e) => e.workflowRunId === workflowRunId);
  return [...workflowEvents].reverse().slice(0, 50);
},
```

Filtragem em memória por `workflowRunId`. Os eventos eram
alimentados pelos simuladores.

### 3.4 `agentSteps.*` / `commands.*` no mock

- `agentSteps.list(workflowRunId)` e
  `workflows.listAgentOutputs(workflowRunId)` devolviam
  `agentStepsByWorkflow.get(workflowRunId) || []` — array
  populado pelos simuladores multi-agente com Planner,
  Developer, QA (3 `AgentStepOutput` por workflow).
- `commands.list(workflowRunId)` e `commands.get(id)` não
  tinham emissor real — devolviam `[]` / `null`.

### 3.5 `git.changedFiles(workflowRunId)` / `git.fileDiff(...)`

Continuavam mockados desde a PR 003 porque dependiam do
workflow engine real. A PR 008 destrava essa dependência mas
**não os implementa** — `git.changedFiles` /
`git.fileDiff` continuam mockados nesta PR (serão migrados
quando o Mission Engine começar a realmente alterar arquivos
em PR futura, junto com `git.changedFiles` real).

### 3.6 Formato `WorkflowRun` (legado, preservado)

```ts
{
  id, projectId?, title, prompt, generatedContext?,
  status: "pending_approval" | "approved" | "running" |
          "completed" | "failed" | "rejected" | "cancelled",
  currentStepId?, executionMode?, realStrategy?,
  finalApprovalId?, createdAt, updatedAt, completedAt?,
}
```

### 3.7 Formato `WorkflowEvent` (legado, preservado)

```ts
{
  id, workflowRunId?, projectId?, type, message,
  metadata?, createdAt,
}
```

### 3.8 Consumidores na UI (não alterados)

- `apps/desktop/src/pages/OverviewPage.tsx` — gera contexto de
  voz e cria workflow a partir do comando principal.
- `apps/desktop/src/components/voice/VoiceContextCard.tsx` —
  mostra o `VoiceContextResult` e dispara `workflows.create`
  ao clicar "Iniciar Execução".
- `apps/desktop/src/pages/ExecutionDetailPage.tsx` —
  `workflows.get` / `listAgentOutputs` / `listJobs` /
  `rerun` / `approveFinal` / `rejectFinal`.
- `apps/desktop/src/pages/ExecutionsPage.tsx` — `workflows.list`.
- `apps/desktop/src/hooks/useLiveExecutionEvents.ts` —
  `events.list` + 5 listeners (`onWorkflowEvent`,
  `onJobUpdated`, `onOpenCodeStdout/Stderr/JsonEvent`).
- `apps/desktop/src/hooks/useActiveRuns.ts` —
  `workflows.list` filtrando por status ativos.
- `apps/desktop/src/hooks/usePendingApprovals.ts` —
  `approvals.listActionable`.
- `apps/desktop/src/components/layout/AppShell.tsx` —
  `workflows.list` para o badge de missões.
- `apps/desktop/src/components/layout/StatusBar.tsx` —
  `workflows.listJobs`.
- `apps/desktop/src/components/layout/RightPanel.tsx` —
  `workflows.listJobs`.
- `apps/desktop/src/components/overview/ExecutionFlowCard.tsx` —
  `workflows.get`.
- `apps/desktop/src/components/workflow/WorkflowTimeline.tsx` —
  `workflows.get`.
- `apps/desktop/src/components/settings/ControlledExecutionPanel.tsx` —
  `workflows.get` / `workflows.listJobs` / `workflows.create` /
  `approveFinal` / `rejectFinal`.
- `apps/desktop/src/hooks/useUsageStats.ts` —
  `workflows.list` / `workflows.listAgentOutputs`.

## 4. Como o Mission Engine funciona agora

### 4.1 Em runtime Tauri

1. O backend Rust mantém `MissionsState`
   (`Mutex<Vec<MissionRecord>>` + `Mutex<Vec<MissionLogRecord>>`)
   registrado via `tauri::Builder::manage`.
2. Carregado no `setup` do Tauri a partir de
   `<app_data_dir>/fluxora/missions.json` (silencioso em
   caso de I/O error). Mensagem no stderr:
   `[fluxora missions] carregadas N missão(ões) e M log(s)`.
3. Oito comandos Tauri novos:
   `missions_ping` / `missions_list` / `missions_get` /
   `missions_create` / `missions_run` / `missions_create_and_run` /
   `missions_list_logs` / `missions_clear`.
4. Pipeline de execução de `missions_run`:
   1. Carrega a missão e valida o status (não pode estar
      `running` / `completed` / `failed` / `cancelled`).
   2. Resolve o `providerId`:
      - Se `mission.providerId` foi informado, usa esse (e
        exige que esteja `enabled`).
      - Senão, tenta o primeiro provider `enabled` com
        `defaultModel` configurado.
      - Senão, qualquer provider `enabled`.
      - Se não houver nenhum, marca a missão como `failed`
        com erro "Nenhum provider configurado. Cadastre um
        provider antes de executar missões.".
   3. Resolve o `model`:
      - Se `mission.model` foi informado, usa esse.
      - Senão, `provider.defaultModel`.
      - Se não houver modelo, marca como `failed`.
   4. Atualiza o status para `running`, define
      `currentPhase: "context"` e emite `mission/started`.
   5. **Coleta contexto do projeto**:
      - Resolve o path do projeto via
        `projects::find_project_path`.
      - Lê metadados (nome, stack) do `ProjectRecord`.
      - Lista arquivos preferenciais que existem
        (`README.md`, `package.json`, `composer.json`,
        `pubspec.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
        `requirements.txt`, `tsconfig.json`, `vite.config.{ts,js}`).
      - Para cada um: rejeita binário (heurística de NUL nos
        primeiros 8 KiB), respeita `MAX_CONTEXT_FILE_BYTES` (32
        KiB por arquivo), `MAX_CONTEXT_FILES` (10 arquivos) e
        `MAX_CONTEXT_TOTAL_BYTES` (128 KiB total). Marca
        `truncated` quando ultrapassa o limite do arquivo.
      - Monta seções "```\\n<conteúdo>\\n```" para cada
        arquivo. Emite `mission/phase` com `phase: "context"`
        e a lista de arquivos incluídos.
   6. **Monta prompt** com system + user (`build_mission_prompt`).
      O system prompt declara explicitamente "modo propositivo
      / read-only" e instrui o modelo a:
      - Analisar o contexto do projeto.
      - Propor alterações sem aplicá-las.
      - Estruturar a resposta em "Entendimento / Plano de
        ação / Arquivos provavelmente envolvidos / Resultado
        ou proposta final / Próximos passos recomendados".
      Emite `mission/phase` com `phase: "planning"`.
   7. **Chama o provider** via
      `providers::execute_mission_chat` (helper público
      adicionado na PR 007 que faz o trabalho de
      `providers_chat_once` sem emitir `provider/*` events —
      evita duplicar ruído no barramento). Timeout 90s,
      `max_tokens=2048`. Emite `mission/phase` com
      `phase: "provider-call"`.
   8. **Recebe resposta** (`MissionChatResult { text, model,
      providerId, providerName, durationMs, usage }`).
      Emite `mission/phase` com `phase: "response"`.
   9. **Salva `resultText` na missão** e emite
      `mission/phase` com `phase: "final-report"`.
   10. **Marca como `completed`**, define `completedAt`,
       emite `mission/completed` com `resultLength`.
5. Eventos `mission/*` emitidos no canal `fluxora-event`
   da PR 005, com `source: "mission"`, `level` ajustado
   por tipo:
   - `mission/created` (info) — após `missions_create`.
   - `mission/started` (info) — início de `missions_run`.
   - `mission/phase` (info) — mudança de fase (inclui
     `phase` no payload).
   - `mission/log` (info/warn/error) — log de progresso.
   - `mission/completed` (info) — sucesso.
   - `mission/failed` (error) — falha (com `errorMessage`
     já sanitizado, sem chave, body truncado em 500 chars).
   - `mission/cancelled` (info) — reservado para PR futura.

### 4.2 Fora do runtime Tauri (browser/Vite dev)

- `mock-api.ts` ganhou namespace `missions` com
  `ping/list/get/create/run/createAndRun/listLogs/clear` que
  devolvem stubs (textos vazios, `resultText: "(Mission
  Engine só funciona em runtime Tauri.)"`, etc.). A UI
  continua funcionando no navegador.
- `workflows.*` no mock legado **permanece intacto**: a
  UI que depende dele no navegador não quebra (o polling de
  `events.list` ainda é alimentado pelo simulador).

### 4.3 Quem ouve os eventos `mission/*`

- `desktopBridge` (PR 005) se inscreve no canal
  `fluxora-event` e despacha para todos os subscribers
  locais.
- `window.fluxora.events.on("mission/phase", cb)` filtra
  por `type` — disponível para componentes novos (esta PR
  não altera componentes para consumir diretamente, mas a
  porta está aberta).
- `window.fluxora.events.list(workflowRunId)` agora delega
  para `missions_list_logs(workflowRunId)` em runtime Tauri
  e converte `MissionLog` → `WorkflowEvent`. Componentes
  existentes (que fazem polling de 2s em `events.list`)
  passam a receber logs reais sem alteração de UI.

## 5. Métodos `workflows.*` migrados (adaptados em runtime Tauri)

| Método | Status na PR 008 |
|---|---|
| `workflows.list` | **real** (Tauri `missions_list` + converte `MissionRun` → `WorkflowRun`), mock legado fora do Tauri |
| `workflows.create` | **real** (Tauri `missions_create_and_run`; extrai `projectId` / `prompt` / `title` do `CreateWorkflowInput`), mock legado fora do Tauri |
| `workflows.get` | **real** (Tauri `missions_get` + `missions_list_logs` + converte para `WorkflowRunDetail` com `steps` sintéticos e `events`), mock legado fora do Tauri |
| `workflows.simulate` | **real** (delega para `missions_run`), mock legado fora do Tauri |
| `workflows.runReal` | **real** (delega para `missions_run`), mock legado fora do Tauri |
| `workflows.runRealAsync` | **real** (devolve `jobId` sintético; missões são síncronas nesta PR), mock legado fora do Tauri |
| `workflows.rerun` | **real** (cria nova missão a partir do original com overrides), mock legado fora do Tauri |
| `workflows.getJob` | stub (devolve `null` — sem scheduler real nesta PR) |
| `workflows.listJobs` | stub (devolve `[]` — sem scheduler real) |
| `workflows.cancelJob` | stub (no-op — missões são síncronas) |
| `workflows.approveFinal` | **mock** (sem aprovação real nesta PR) |
| `workflows.rejectFinal` | **mock** (sem rejeição real nesta PR) |
| `workflows.getStepOutputs` | **real** (3 steps sintéticos: Planner / Provider Call / Final Report, derivados dos logs reais), mock legado fora do Tauri |
| `workflows.listAgentOutputs` | idem `getStepOutputs` |

## 6. Métodos `missions.*` (canônico novo)

| Método | Status na PR 008 |
|---|---|
| `missions.ping` | **real** (Tauri `missions_ping`), mock devolve ISO 8601 atual |
| `missions.list` | **real** (Tauri `missions_list`), mock devolve `[]` |
| `missions.get` | **real** (Tauri `missions_get`), mock devolve `null` |
| `missions.create` | **real** (Tauri `missions_create`), mock stub |
| `missions.run` | **real** (Tauri `missions_run`), mock stub |
| `missions.createAndRun` | **real** (Tauri `missions_create_and_run`), mock stub com `resultText: "(Mission Engine só funciona em runtime Tauri.)"` |
| `missions.listLogs` | **real** (Tauri `missions_list_logs`), mock devolve `[]` |
| `missions.clear` | **real** (Tauri `missions_clear`, dev/debug), mock noop |

## 7. Métodos legados preservados / adaptados

| Método | Em runtime Tauri | Fora do runtime Tauri |
|---|---|---|
| `events.list(workflowRunId)` | `missions_list_logs(workflowRunId)` + converte `MissionLog` → `WorkflowEvent` | mock legado |
| `events.onWorkflowEvent` | mock legado (alimentado por simuladores) | mock legado |
| `events.onJobUpdated` | mock legado (não há jobs reais nesta PR) | mock legado |
| `events.onApprovalChange` | mock legado (sem aprovação real) | mock legado |
| `events.onOpenCodeStdout/Stderr/JsonEvent` | mock legado | mock legado |
| `events.subscribe/on/listRecent/emitDiagnostic/clearRecent` | inalterados (PR 005) | inalterados (PR 005) |
| `voice.createFromTranscript` | inalterado (frontend-side, `buildVoiceContext`) | inalterado |
| `git.changedFiles` / `git.fileDiff` | mock legado (dependem de patch real) | mock legado |
| `approvals.*` | mock legado (sem aprovação real) | mock legado |
| `commands.*` | mock legado | mock legado |

A UI continua consumindo `window.fluxora.workflows.*`,
`window.fluxora.voice.createFromTranscript` e
`window.fluxora.events.*` exatamente como antes — o
`desktopBridge` é quem decide se a chamada vai para o
Mission Engine real ou para o mock.

## 8. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type MissionStatus =
  | "queued" | "running" | "completed" | "failed" | "cancelled";

export type MissionPhase =
  | "created" | "context" | "planning" | "provider-call"
  | "response" | "final-report" | "failed";

export type MissionMode = "assistido" | "propositivo" | "piloto-automatico";

export interface MissionRun {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: MissionStatus;
  mode: MissionMode;
  providerId?: string;
  model?: string;
  currentPhase?: MissionPhase;
  resultText?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MissionLog {
  id: string;
  missionId: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  phase?: MissionPhase;
  payload?: unknown;
}

export interface CreateMissionInput {
  projectId: string;
  prompt: string;
  title?: string;
  providerId?: string;
  model?: string;
  mode?: MissionMode;
}

export interface RunMissionInput {
  missionId: string;
}
```

Adicionado em `FluxoraAPI.missions`:

```ts
missions: {
  ping(): Promise<string>;
  list(): Promise<MissionRun[]>;
  get(missionId: string): Promise<MissionRun | null>;
  create(input: CreateMissionInput): Promise<MissionRun>;
  run(input: RunMissionInput): Promise<MissionRun>;
  createAndRun(input: CreateMissionInput): Promise<MissionRun>;
  listLogs(missionId: string): Promise<MissionLog[]>;
  clear(): Promise<void>;
};
```

Tipos legados `WorkflowRun` / `WorkflowEvent` /
`WorkflowRunDetail` / `CreateWorkflowInput` /
`WorkflowRerunInput` / `BackgroundWorkflowJob` /
`AgentStepOutput` / `Approval` / `ChangedFile` / `FileDiff` /
`CommandRun` **preservados intactos** — a UI que os consome
não muda.

## 9. Backend Rust criado/alterado

### 9.1 Criado

- `apps/desktop/src-tauri/src/missions.rs` — **novo**, ~1200
  linhas:
  - `MissionRecord` (struct serializável em camelCase, espelha
    `MissionRun`).
  - `MissionLogRecord` (espelha `MissionLog`).
  - `MissionsState` (gerenciado via `tauri::Builder::manage`,
    `Mutex<Vec<MissionRecord>>` + `Mutex<Vec<MissionLogRecord>>`).
  - `MissionsFile` (struct versionada para JSON).
  - `missions_file_path` / `ensure_missions_dir` /
    `load_missions_on_startup` (carrega de
    `<app_data_dir>/fluxora/missions.json`).
  - `read_missions_file` / `write_missions_file` /
    `persist` (persiste JSON pretty-printed).
  - `now_iso` / `generate_mission_id` / `generate_log_id`
    (IDs monotônicos).
  - `is_path_safe` (rejeita absolutos, `..`, vazio).
  - `truncate_error` (limita a 500 chars).
  - `find_mission` / `append_log` / `update_mission`
    (operações de estado).
  - `emit_mission_event` / `record_phase` / `record_log`
    (emissão de eventos `mission/*` no canal `fluxora-event`).
  - `collect_relevant_files` (lista preferenciais que existem).
  - `try_read_file` (lê arquivo respeitando limites +
    heurística de binário NUL).
  - `collect_project_context` (monta seções com cap de
    10 arquivos × 32 KiB × 128 KiB total).
  - `build_mission_prompt` (system + user com aviso
    "modo propositivo / read-only").
  - `resolve_provider` (input explícito → enabled+defaultModel
    → primeiro enabled).
  - `find_project_meta` (lê nome/stack do `ProjectRecord`).
  - `fail_mission` (marca como `failed` e emite
    `mission/failed`).
  - `ProjectMeta` (struct interna).
  - Constantes de limites: `MAX_PROMPT_LENGTH=4000`,
    `MAX_CONTEXT_FILES=10`, `MAX_CONTEXT_FILE_BYTES=32 KiB`,
    `MAX_CONTEXT_TOTAL_BYTES=128 KiB`,
    `MAX_ERROR_MESSAGE_LEN=500`.
  - `PREFERRED_CONTEXT_FILES` (11 arquivos preferenciais
    curados: `README.md`, `package.json`, `composer.json`,
    `pubspec.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
    `requirements.txt`, `tsconfig.json`,
    `vite.config.{ts,js}`).
  - `IGNORED_DIR_NAMES` (reservado, marcado com
    `#[allow(dead_code)]` para PR 009).
  - 8 comandos Tauri: `missions_ping` / `missions_list` /
    `missions_get` / `missions_create` / `missions_run` /
    `missions_create_and_run` / `missions_list_logs` /
    `missions_clear`.
  - 5 testes unitários: `truncates_long_error`,
    `rejects_path_traversal`, `preferred_files_are_listed_in_order`,
    `ignored_dirs_include_common_heavy_ones`,
    `validates_prompt_size`.

### 9.2 Alterado

- `apps/desktop/src-tauri/src/providers.rs` — pequenas
  refatorações para expor o necessário ao Mission Engine:
  - `pub const DEFAULT_CHAT_TIMEOUT_MS` (já era)
  - `pub const MISSION_CHAT_TIMEOUT_MS = 90_000` (novo)
  - `pub const HARD_MAX_TOKENS` (era privado, agora público)
  - `pub const SUPPORTED_KINDS` (era privado, agora público)
  - `pub(crate) fn resolve_api_key` (era privado, agora
    `pub(crate)`)
  - `pub fn provider_kind_is_supported` (novo, wrapper público
    de `is_supported_kind`)
  - `pub struct MissionChatResult` (novo, retornado por
    `execute_mission_chat`)
  - `pub fn execute_mission_chat` (novo, faz o trabalho de
    `providers_chat_once` sem emitir `provider/*` events;
    usado pelo Mission Engine)
- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod missions;`
  - `use missions::{CreateMissionPayload, MissionLogRecord,
    MissionRecord, RunMissionPayload};`
  - `manage(missions::MissionsState::new())` no builder
  - `missions::load_missions_on_startup(&handle)` no `setup`
  - 8 comandos Tauri adicionados ao `invoke_handler`
  - `use missions::MissionContextFile` (reservado para PR
    futura que queira expor o contexto coletado como evento
    dedicado)

`Cargo.toml` não precisou de dependências novas (apenas
`serde`, `serde_json`, `time`, `tauri` que já estavam
presentes).

## 10. Arquivos frontend alterados

### 10.1 `packages/shared/src/index.ts`

- Adiciona `MissionStatus`, `MissionPhase`, `MissionMode`,
  `MissionRun`, `MissionLog`, `CreateMissionInput`,
  `RunMissionInput`.
- Adiciona namespace `missions` em `FluxoraAPI`.

### 10.2 `apps/desktop/src/api/mock-api.ts`

- Adiciona namespace `missions` (fallback mock) com 8 métodos:
  `ping` (devolve ISO 8601), `list` (`[]`), `get` (`null`),
  `create` (stub), `run` (stub com `status: "completed"`),
  `createAndRun` (stub com `resultText: "(Mission Engine só
  funciona em runtime Tauri.)"`), `listLogs` (`[]`), `clear`
  (noop).
- `createFromTranscript` em `voice` **preservado** (continua
  chamando `buildVoiceContext`).

### 10.3 `apps/desktop/src/services/desktopBridge.ts`

- Adiciona imports dos tipos novos: `AgentStepOutput`,
  `MissionLog`, `MissionRun`, `MissionStatus`,
  `CreateMissionInput`, `RunMissionInput`, `WorkflowEvent`,
  `WorkflowRun`, `WorkflowRunDetail`, `WorkflowRunStatus`.
- Adiciona seção "Missions (PR 008)" com:
  - Constante `MISSION_STATUS_TO_WORKFLOW` (mapeamento
    `MissionStatus` → `WorkflowRunStatus`):
    `queued→approved`, `running→running`, `completed→completed`,
    `failed→failed`, `cancelled→cancelled`.
  - `toWorkflowRun(mission)` — converte `MissionRun` →
    `WorkflowRun` com `executionMode: "real"`, `realStrategy:
    "single"`, `currentStepId: "step-<currentPhase>"`,
    `generatedContext: JSON.stringify({ kind: "mission-run",
    mode, providerId, model, currentPhase, error })`.
  - `toWorkflowEvent(log, workflowRunId)` — converte
    `MissionLog` → `WorkflowEvent` com `type: log.phase ??
    "log"`, `metadata: JSON.stringify(log.payload)`.
  - `buildSyntheticSteps(mission, logs)` — monta 3
    `AgentStepOutput` sintéticos (Planner / Provider Call /
    Final Report) com status e timing baseados nos logs
    reais da missão.
  - Helpers de baixo nível: `listMissions`,
    `getMissionById`, `listMissionLogs`,
    `runMissionInternal`, `createAndRunMissionInternal`.
- `createDesktopBridge()`:
  - **Sobrescreve `missions`** com a superfície canônica
    nova: `ping` / `list` / `get` / `create` / `run` /
    `createAndRun` / `listLogs` / `clear` (em runtime Tauri
    delega para os comandos `missions_*`; fora, cai no
    mock).
  - **Sobrescreve `workflows`** para preservar a API legada
    em runtime Tauri (delega para `missions.*` e converte):
    `list`, `create`, `get`, `simulate`, `runReal`,
    `runRealAsync`, `rerun`, `getJob` (stub), `listJobs`
    (stub), `cancelJob` (stub), `approveFinal` (mock),
    `rejectFinal` (mock), `getStepOutputs`, `listAgentOutputs`.
  - **Sobrescreve `events.list(workflowRunId)`** para usar
    `missions_list_logs` + converter para `WorkflowEvent[]`
    em runtime Tauri.

### 10.4 Não alterados (UI preservada)

- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/components/voice/VoiceContextCard.tsx`
- `apps/desktop/src/pages/ExecutionDetailPage.tsx`
- `apps/desktop/src/pages/ExecutionsPage.tsx`
- `apps/desktop/src/hooks/useLiveExecutionEvents.ts`
- `apps/desktop/src/hooks/useActiveRuns.ts`
- `apps/desktop/src/hooks/usePendingApprovals.ts`
- `apps/desktop/src/hooks/useUsageStats.ts`
- `apps/desktop/src/components/layout/AppShell.tsx`
- `apps/desktop/src/components/layout/StatusBar.tsx`
- `apps/desktop/src/components/layout/RightPanel.tsx`
- `apps/desktop/src/components/overview/ExecutionFlowCard.tsx`
- `apps/desktop/src/components/workflow/WorkflowTimeline.tsx`
- `apps/desktop/src/components/settings/ControlledExecutionPanel.tsx`
- Qualquer outro componente React

## 11. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente os namespaces `missions` (novo) e `workflows`
(adaptado) e sobrescreve `events.list(workflowRunId)` no
objeto final.

### Namespace `workflows` (PR 008 — adaptado em runtime Tauri)

- `list()` → em runtime Tauri, chama `missions_list` e
  converte `MissionRun[]` → `WorkflowRun[]`. Fora, cai no mock
  legado.
- `create(input)` → em runtime Tauri, extrai `projectId` /
  `prompt` / `title` do `CreateWorkflowInput` legado
  (ignora `executionMode` / `realStrategy` / `steps` porque
  o Mission Engine é sempre `executionMode: "real"`,
  `realStrategy: "single"`, sem steps explícitos — a pipeline
  interna gera 3 steps sintéticos a partir dos logs).
  Valida prompt não-vazio e projeto não-vazio. Chama
  `missions_create_and_run` e converte o resultado.
  Fora do runtime Tauri, cai no mock legado.
- `get(id)` → em runtime Tauri, chama `missions_get` +
  `missions_list_logs` e monta um `WorkflowRunDetail` com
  `steps` sintéticos (Planner / Provider Call / Final
  Report) e `events` derivados dos `MissionLog`s. Fora, cai
  no mock legado.
- `simulate(id)` / `runReal(id)` → `missions_run`.
- `runRealAsync(id)` → dispara `missions_run` em background
  e devolve `{ jobId: "job-<id>-<ts>", workflowRunId: id }`.
  A UI atual faz polling de jobs; quando o job "desaparece"
  (porque `getJob` devolve `null`), ela refaz a busca via
  `workflows.list` + `events.list` — comportamento aceitável
  para missões síncronas.
- `rerun(id, overrides)` → carrega a missão original via
  `missions_get`, monta `CreateMissionInput` com overrides
  (`overrides.prompt` ou o prompt original) e chama
  `missions_create_and_run`. Devolve `{ jobId, workflowRunId }`
  apontando para a nova missão.
- `getJob(id)` → `null` (sem scheduler real nesta PR).
- `listJobs()` → `[]`.
- `cancelJob(id)` → noop (missões são síncronas).
- `approveFinal(id)` / `rejectFinal(id, note)` → mock legado
  (sem aprovação real).
- `getStepOutputs(id)` / `listAgentOutputs(id)` → 3
  `AgentStepOutput` sintéticos com status e timing baseados
  nos logs reais.

### Namespace `events` (PR 008 — adaptação pontual)

- `list(workflowRunId?)` → em runtime Tauri com
  `workflowRunId` informado, chama `missions_list_logs` e
  converte `MissionLog` → `WorkflowEvent`. Sem `workflowRunId`
  ou fora do runtime Tauri, cai no mock legado.
- Demais métodos do namespace `events` inalterados
  (`onWorkflowEvent`, `onJobUpdated`, `onApprovalChange`,
  `onOpenCodeStdout/Stderr/JsonEvent`, `subscribe`,
  `unsubscribe`, `on`, `off`, `listRecent`, `emitDiagnostic`,
  `clearRecent`).

### Namespace `voice`

- `createFromTranscript` permanece mock (frontend-side,
  `buildVoiceContext`). A UI continua consumindo
  exatamente como antes — não há quebra de contrato.
- `transcribe` permanece real (PR 006).

### Resultado

A UI continua consumindo `window.fluxora.workflows.*` e
`window.fluxora.events.*` exatamente como antes. Componentes
novos podem consumir `window.fluxora.missions.*`
diretamente para evitar a camada de adaptação.

## 12. Como missões são persistidas

### 12.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/missions.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada missão tem:
  - `id`, `projectId`, `title`, `prompt`
  - `status`, `mode`
  - `providerId?`, `model?`
  - `currentPhase?`, `resultText?`, `error?`
  - `createdAt`, `updatedAt`
  - `startedAt?`, `completedAt?`
- Cada log tem:
  - `id`, `missionId`
  - `timestamp`, `level` (debug|info|warn|error)
  - `message`, `phase?`
  - `payload?` (JSON arbitrário)
- `load_missions_on_startup` é chamado no `setup` do Tauri
  e popula o `MissionsState` em memória.
- `missions_create` / `missions_run` persistem em
  `missions.json` no disco após cada mudança de status.

### 12.2 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência).

### 12.3 Storage seguro de secrets

**Decisão consciente nesta PR**: o `MissionRun.resultText`
contém a resposta do provider, que pode incluir trechos de
código ou texto plano do modelo. **Não inclui a API key**
(ela é resolvida em `providers::execute_mission_chat` e
nunca aparece em eventos nem no resultado retornado).

- API key **não é logada** em lugar nenhum
  (`mask_api_key` mostra apenas prefixo/sufixo).
- API key **não é enviada em eventos `mission/*`**.
- API key **não é retornada** para o frontend em nenhum
  cenário desta PR.

## 13. Local do `missions.json`

`<app_data_dir>/fluxora/missions.json`

Onde `app_data_dir` é resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora.v1`, a
localização esperada tende a ser equivalente a:

`~/.local/share/com.fluxora.v1/fluxora/missions.json`

## 14. Como contexto do projeto é coletado

### 14.1 Arquivos preferenciais (curados)

Tenta ler (em ordem) os seguintes arquivos se existirem e
forem menores que `MAX_CONTEXT_FILE_BYTES` (32 KiB):

1. `README.md`
2. `package.json`
3. `composer.json`
4. `pubspec.yaml`
5. `Cargo.toml`
6. `go.mod`
7. `pyproject.toml`
8. `requirements.txt`
9. `tsconfig.json`
10. `vite.config.ts`
11. `vite.config.js`

### 14.2 Heurísticas

- **Binário**: se os primeiros 8 KiB contiverem NUL, o
  arquivo é ignorado (`isBinary: true`).
- **Tamanho por arquivo**: máximo 32 KiB; se maior, marca
  `truncated: true` e lê só os primeiros 32 KiB.
- **Quantidade**: máximo 10 arquivos.
- **Total**: máximo 128 KiB acumulados.
- **Path safety**: rejeita caminhos absolutos, `..`, vazios.
- **Encoding**: só aceita UTF-8 válido.

### 14.3 Formato enviado ao provider

```text
### README.md
```
<conteúdo>
```

### package.json
```
<conteúdo>
```
```

Quando o contexto está vazio, devolve a string
`"(nenhum arquivo de contexto coletado)"`.

### 14.4 Por que não enviar o projeto inteiro

Limites rígidos (10 arquivos × 32 KiB × 128 KiB) impedem
que prompts gigantes sejam montados acidentalmente. O
Mission Engine é propositivo — o objetivo é dar ao modelo
**contexto suficiente** para entender o projeto, não
derrubar o provider com tokens desnecessários.

## 15. Como Provider Engine é chamado

Via `providers::execute_mission_chat` (helper público
adicionado na PR 008 em `providers.rs`):

```rust
let result = providers::execute_mission_chat(
    &app,
    &provider.id,           // providerId
    &model,                 // model
    &messages,              // Vec<ChatMessagePayload>
    Some(2048),             // max_tokens
);
// → Ok(MissionChatResult { text, model, providerId, providerName, durationMs, usage })
// → Err(String)  // mensagem sanitizada
```

Semelhante a `providers_chat_once`, mas:

- Timeout 90s (`MISSION_CHAT_TIMEOUT_MS`) em vez de 60s.
- **NÃO emite `provider/*` events** — quem emite
  `mission/phase` é o Mission Engine. Isso evita ruído
  duplicado no barramento.
- Retorna `MissionChatResult` em vez de `ChatOnceResultPayload`
  (campos equivalentes, mas com `providerName` adicional).

A função valida:

- Provider existe e está `enabled`.
- `kind` é suportado (`openai-compatible` ou `local`).
- `baseUrl` é válido (`http://` ou `https://`).
- API key resolvida com sucesso (env var ou literal).
- Model não está vazio.

Em caso de erro, loga com chave mascarada no stderr
(`mask_api_key`) e devolve a mensagem truncada em 500 chars.

## 16. Como eventos `mission/*` são emitidos

Via `emit_mission_event` em `missions.rs`, que monta um
`FluxoraEvent` e chama `events::emit_to_app` (PR 005):

```rust
let event = events::build_event(
    "mission/phase",       // type
    "mission",             // source
    "info",                // level
    Some("Coletando contexto do projeto".to_string()),
    Some(mission.project_id.clone()),
    Some(mission.id.clone()),
    None,                  // agentId
    Some(serde_json::json!({
        "phase": "context",
        "contextFiles": [{ "path": "README.md", "bytes": 1234, "truncated": false }],
        "contextFilesCount": 1,
    })),
);
events::emit_to_app(&app, event);
```

Tipos de evento emitidos:

| Tipo | Quando | `level` |
|---|---|---|
| `mission/created` | após `missions_create` | info |
| `mission/started` | início de `missions_run` (após validar provider/model) | info |
| `mission/phase` | mudança de fase (`created` / `context` / `planning` / `provider-call` / `response` / `final-report` / `failed`) | info |
| `mission/log` | log de progresso (reservado para extensões) | info / warn / error |
| `mission/completed` | sucesso | info |
| `mission/failed` | falha (provider ausente, modelo ausente, kind não suportado, HTTP error, etc.) | error |
| `mission/cancelled` | reservado para PR futura | info |

**Nunca inclui**:

- API key (mesmo mascarada) — chave nunca passa por aqui.
- Áudio bruto (a transcrição de voz tem seu próprio canal).
- Path absoluto do projeto (só `projectId`).
- Mensagens longas de erro — truncadas em 500 chars.

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "mission"`. O frontend consome via
`events.on("mission/phase", cb)` ou
`events.subscribe(cb)` com filtro manual.

**Limitação consciente**: o resultado completo do provider
**não é incluído no evento** (pode ser grande). Apenas
`resultLength` é emitido. O `resultText` completo fica
salvo na missão e pode ser recuperado via `missions.get`.

## 17. Limites de segurança implementados

1. **Tamanho máximo de prompt**: 4 000 chars
   (`MAX_PROMPT_LENGTH`). Acima disso, `missions_create`
   retorna erro.
2. **Prompt obrigatório**: `missions_create` rejeita
   prompt vazio ou só com whitespace.
3. **Projeto obrigatório**: `missions_create` rejeita
   `projectId` vazio e exige que o projeto exista no
   `projects.json` (via `projects::find_project_path`).
4. **Provider obrigatório para executar**:
   `missions_run` falha a missão com "Nenhum provider
   configurado. Cadastre um provider antes de executar
   missões." se não houver provider `enabled`.
5. **Modelo obrigatório**: `missions_run` falha se nem
   o input nem `provider.defaultModel` fornecerem um
   modelo.
6. **Contexto limitado**:
   - 10 arquivos (`MAX_CONTEXT_FILES`)
   - 32 KiB por arquivo (`MAX_CONTEXT_FILE_BYTES`)
   - 128 KiB total (`MAX_CONTEXT_TOTAL_BYTES`)
   - Binários ignorados (heurística NUL)
   - UTF-8 inválido ignorado
7. **Path safety**: `is_path_safe` rejeita absolutos,
   `..`, vazios. `try_read_file` sempre faz `join` com o
   root do projeto cadastrado.
8. **API key nunca em logs/eventos**: chave resolvida em
   `resolve_api_key`, mascarada em `mask_api_key` quando
   logada em stderr, nunca emitida em eventos.
9. **Erro sanitizado**: `truncate_error` limita a 500
   chars para evitar exposição exagerada.
10. **Sem alteração de arquivos do projeto**: o Mission
    Engine **NUNCA** escreve no diretório do projeto. Não
    há chamada `fs::write` / `fs::create` em nenhum
    arquivo fora de `<app_data_dir>/fluxora/`.
11. **Sem execução de comandos**: o Mission Engine
    **NUNCA** executa `std::process::Command`. Não há
    `Command::new` em `missions.rs`.
12. **Sem Git write operations**: o Mission Engine
    **NUNCA** chama `git commit`, `git push`, `git add`,
    `git checkout`, `git reset`, `git clean`, `git merge`,
    `git rebase`, `git pull`. Não há chamada de shell em
    `missions.rs`.
13. **Sem patch aplicado**: `git.changedFiles` /
    `git.fileDiff` continuam mockados (dependem de
    workflow engine que altere arquivos). O Mission
    Engine nesta PR é estritamente read-only/propositivo.
14. **Sem cancelamento destrutivo**: `missions_clear` é o
    único comando destrutivo exposto, e está documentado
    como apenas dev/debug. `cancelJob` é noop (missões
    são síncronas).
15. **Sem push remoto**: zero comandos de rede fora do
    Provider Engine. O Mission Engine não faz
    `reqwest::get` / `ureq::get` / etc. por conta própria.
16. **Erro claro para projeto inexistente**:
    `missions_run` chama `projects::find_project_path`
    antes de prosseguir e marca a missão como `failed` se
    o projeto não existir mais (foi removido do
    `projects.json`).
17. **Validação de status pré-execução**: `missions_run`
    rejeita missões `running` (evita concorrência),
    `completed` / `failed` / `cancelled` (imutáveis).

## 18. O que ainda permanece mockado

- `approvals.*` — sem aprovação real nesta PR (sem patch).
- `workflows.approveFinal` / `workflows.rejectFinal` — sem
  aprovação real.
- `git.changedFiles(workflowRunId)` / `git.fileDiff(...)` —
  dependem de workflow engine que altere arquivos.
- `commands.*` — sem CommandRun real.
- `agentSteps.*` (legado) — `workflows.getStepOutputs` /
  `listAgentOutputs` são adaptados em runtime Tauri via
  `buildSyntheticSteps` (3 steps derivados dos logs),
  mas o namespace `agentSteps.*` legado no mock
  permanece para a UI.
- `events.onWorkflowEvent` / `onJobUpdated` /
  `onApprovalChange` / `onOpenCodeStdout/Stderr/JsonEvent`
  — alimentados pelos simuladores do mock. A UI atual
  faz polling de `events.list` a cada 2s, que agora
  reflete logs reais do Mission Engine, então o
  comportamento é aceitável nesta PR.
- `opencode.controlledExecution.*` — stub.
- `whisper.*` / `whisperLocal.*` — mock (bundle e
  download).
- `voice.saveAudio*` / `getAudioPath` / `cleanupOldAudio`
  / `getAudioStorageStats` / `openAudioFolder` — mock
  (sem persistência de áudio em disco).
- `models.updateAgentModel` — mock.
- `env.get/has` — mock.

A próxima PR (PR 009) vai começar a atacar esses mocks
quando o piloto automático precisar de aprovações reais,
scheduler, fila e permissões por projeto.

## 19. Como validar manualmente

### 19.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.missions.list()` deve devolver `[]` (mock
  fallback, sem missões criadas).
- `window.fluxora.missions.createAndRun({ projectId:
  "qualquer", prompt: "teste" })` deve devolver um stub com
  `resultText: "(Mission Engine só funciona em runtime Tauri.)"`.
- `window.fluxora.workflows.list()` deve continuar
  devolvendo os workflows do mock legado — sem mudança de
  comportamento.
- `window.fluxora.voice.createFromTranscript("olá")` deve
  continuar devolvendo `VoiceContextResult` normal.

### 19.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Sem UI específica para missões nesta PR, a validação é pelo
console do DevTools:

```js
// 1) Listar providers
const providers = await window.fluxora.providers.list();
// → [{ id: "provider-...", name: "...", ... }] (vazio se
//    nenhum foi cadastrado)

// 2) Listar projetos
const projects = await window.fluxora.projects.list();
// → [{ id: "proj-...", name: "...", path: "..." }, ...]

// 3) Criar provider (se ainda não houver)
if (providers.length === 0) {
  const created = await window.fluxora.providers.create({
    name: "Local LLM",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "lm-studio",
    defaultModel: "qwen2.5-7b-instruct",
    enabled: true,
  });
  // → { id: "provider-...", name: "Local LLM", ... }
}

// 4) Criar + executar missão real
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  prompt: "Analise este projeto e diga quais próximos passos você recomenda.",
  title: "Reconhecimento inicial",
});
// → { id: "mission-...", status: "completed", resultText: "...", ... }

// 5) Listar missões
const missions = await window.fluxora.missions.list();
// → [run, ...]

// 6) Ver logs
const logs = await window.fluxora.missions.listLogs(run.id);
// → [{ id: "...", missionId: run.id, phase: "context", message: "Coletando contexto do projeto.", timestamp: "..." }, ...]

// 7) Verificar eventos
const unsub = window.fluxora.events.on(
  "mission/phase",
  (e) => console.log("mission/phase", e)
);
const recent = await window.fluxora.events.listRecent({
  type: "mission/phase"
});
// → [FluxoraEvent { type: "mission/phase", ... }, ...]

// 8) Compatibilidade com API legada
const legacy = await window.fluxora.workflows.get(run.id);
// → WorkflowRunDetail { id: run.id, status: "completed", steps: [...], events: [...], ... }

const events = await window.fluxora.events.list(run.id);
// → WorkflowEvent[] (convertido de MissionLog)

// 9) Verificar persistência
// Linux: cat ~/.local/share/com.fluxora.v1/fluxora/missions.json

// 10) Cleanup (apenas dev/debug)
await window.fluxora.missions.clear();
```

### 19.3 Health-check do Mission Engine

Em runtime Tauri, `missions_ping` devolve o ISO 8601 atual.
`missions_clear` apaga `missions.json` e zera o estado em
memória.

### 19.4 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 21 testes passando (5 voice + 11 providers + 5 missions)
```

## 20. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/assets/index-*.js` 815.95 KiB / 226.31 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 21/21 testes passando (5 voice + 11 providers + 5 missions novos) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 60s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~0.4s (rebuild incremental) → binário `target/debug/fluxora_v1` inicia. Log do Mission Engine: `[fluxora missions] carregadas 0 missão(ões) e 0 log(s)`. Nenhum loop, nenhum erro de runtime. |

## 21. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004, 005, 006 e 007. **Nenhuma regressão**
de teste. **5 novos testes Rust** passando (21 totais).
Build de produção sem warnings novos.

## 22. Erros conhecidos

### 22.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral.
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual.

### 22.2 Limitações desta PR

- **Storage seguro de API keys não implementado** (chave
  pode ficar em `providers.json` em claro se o usuário
  digitar a chave literal em vez de env var).
- **`workflows.runRealAsync` devolve `jobId` sintético** —
  missões são síncronas nesta PR, sem scheduler real.
  `getJob` devolve `null` (a UI trata como "job já
  concluído" e refaz a busca via `workflows.list` +
  `events.list`).
- **`workflows.approveFinal` / `rejectFinal` continuam
  mock** — sem aprovação real (sem patch aplicado).
- **`git.changedFiles(workflowRunId)` / `git.fileDiff(...)`
  continuam mock** — dependem de workflow engine que
  altere arquivos.
- **Steps sintéticos de `agentSteps.*` / `workflows.
  getStepOutputs`** — 3 steps derivados dos logs reais
  (Planner / Provider Call / Final Report). Não há
  `AgentStepOutput` real persistido; é uma adaptação para
  a UI não quebrar.
- **Sem streaming** — `chatOnce` é uma chamada simples
  com resposta completa. `MissionChatResult` não tem
  chunks incrementais.
- **Sem tool calling** — só `messages` com `role` /
  `content`.
- **Sem retry automático** — falhas de rede retornam erro
  imediatamente; o usuário precisa rerun.
- **Sem cancelamento real** — `cancelJob` é noop (missões
  são síncronas e já concluem rapidamente).
- **`commands.*` continua mock** — não há `CommandRun`
  real nesta PR.
- **Sem UI dedicada para missões** — só console do
  DevTools ou chamada programática. A UI atual continua
  mostrando a lista de execuções (legado) alimentada
  pelo `desktopBridge` que agora reflete missões reais.
- **Sem persistência de `contextFiles` na missão** — o
  contexto coletado é por-execução e não é salvo. Apenas
  o `resultText` final é persistido.
- **Sem cap de missões simultâneas** — o `MissionsState`
  é um `Mutex<Vec>` sem limite de tamanho. Em uso intenso
  pode crescer. PR futura pode adicionar rotação.
- **Sem cap de logs por missão** — `MissionLog` é
  append-only. PR futura pode adicionar truncamento por
  idade/quantidade.

### 22.3 Caveats

- O `workflows.get(id)` em runtime Tauri monta o
  `WorkflowRunDetail` (com `steps` e `events`) **na
  hora** — faz 2 chamadas ao backend (`missions_get` +
  `missions_list_logs`). Em PR futura com volume alto,
  considerar endpoint dedicado `missions_get_detail`.
- O `events.list(workflowRunId)` é usado pela UI com
  polling de 2s. Em runtime Tauri, cada tick faz
  `missions_list_logs(workflowRunId)`. Para volume alto,
  considerar cache.
- O `buildSyntheticSteps` infere `startedAt` /
  `completedAt` dos timestamps dos logs. Se um log
  estiver fora de ordem, o cálculo pode parecer
  inconsistente. Aceitável para o smoke-test; a UI
  normalmente só mostra contagens e status.
- O `Provider` Engine emite `provider/*` events
  independentemente. O Mission Engine **não** emite
  esses events durante `execute_mission_chat` (helper
  público sem `emit_provider_event`). Resultado: durante
  uma missão, o barramento recebe `mission/*` (do Mission
  Engine) mas não `provider/*` (a menos que o usuário
  faça um `providers_test` paralelo).
- O `MissionContextFile` struct público não é exposto
  pela `FluxoraAPI` (é interno ao Rust). Reservado para
  PR futura que queira expor contexto coletado como
  evento dedicado.

## 23. Próximas PRs recomendadas

1. **PR 009 — Piloto automático com permissões por
   projeto.** Adiciona scheduler, fila de execuções,
   permissões por projeto. Emite `mission/phase` com
   `payload.permission`. Implementa
   `workflows.approveFinal` / `rejectFinal` reais
   (criando `Approval` persistida quando o Mission Engine
   precisar alterar arquivos).
2. **PR 010 — Apply patch/diff controlado.** Permite que
   missões proponham alterações e a UI mostre diff real
   antes de aplicar. Implementa `git.changedFiles(
   workflowRunId)` / `git.fileDiff(...)` reais (parser
   `git diff --numstat` para `additions` /
   `deletions`).
3. **PR futura — Agentes reais e steps detalhados.**
   Substitui os steps sintéticos de `buildSyntheticSteps`
   por steps reais (Planner com chain-of-thought, Developer
   com execução de patches, QA com testes). Persiste
   `AgentStepOutput` em JSON (talvez um arquivo
   separado `agent_steps.json`).
4. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers e voice) para um storage
   encriptado (keychain do SO, `tauri-plugin-stronghold`).
5. **PR futura — Streaming de providers.** SSE / WebSocket
   sobre OpenAI-compatible streaming. Substitui
   `providers_chat_once` por `providers_chat_stream` com
   callback de chunks. Mission Engine emite
   `mission/phase` com `payload.chunk` incremental.
6. **PR futura — Tool calling.** Adiciona suporte a
   `tools` no `chatOnce` e `listModels` para descobrir
   quais ferramentas cada modelo suporta.
7. **PR futura — Adapters dedicados.** Anthropic
   (`x-api-key` + `anthropic-version`), Gemini
   (`key=...` na URL), Mistral / DeepSeek / MiniMax
   (variações OpenAI-compat).
8. **PR futura — UI de missões.** Tela dedicada para
   listar missões, ver resultado, rerun, e configurar
   provider/modelo por missão. Por enquanto, console do
   DevTools é a forma canônica.
9. **PR futura — Persistência de eventos.** Mover o
   ring buffer de eventos do `AppEventsState` para
   SQLite/JSON, com paginação e rotação por idade.
10. **PR futura — Marketplace de providers.** Catálogo
    pré-configurado de providers conhecidos (OpenAI, Groq,
    OpenRouter, etc.) que o usuário pode adicionar com um
    clique.

Esta PR não iniciou nenhuma delas.

## 24. Resumo executivo

- ✅ Mission Engine inicial criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/missions.rs`).
- ✅ Persistência local em
  `<app_data_dir>/fluxora/missions.json` (versionada).
- ✅ 8 comandos Tauri: `missions_ping` / `missions_list` /
  `missions_get` / `missions_create` / `missions_run` /
  `missions_create_and_run` / `missions_list_logs` /
  `missions_clear`.
- ✅ Integração com Provider Engine da PR 007 via
  `providers::execute_mission_chat` (helper público
  adicionado em `providers.rs` para chamar o adapter
  OpenAI-compatible sem duplicar HTTP client nem emitir
  `provider/*` events).
- ✅ Coleta de contexto do projeto (10 arquivos × 32 KiB
  × 128 KiB, ignora binários, UTF-8, path safe).
- ✅ Prompt interno seguro (modo propositivo / read-only,
  resposta estruturada, sem aplicação de alterações).
- ✅ Resolução automática de provider/model (input
  explícito → enabled+defaultModel → primeiro enabled).
- ✅ 6 tipos de evento `mission/*` no barramento real
  `fluxora-event` da PR 005: `mission/created`,
  `mission/started`, `mission/phase`, `mission/log`,
  `mission/completed`, `mission/failed` (mais
  `mission/cancelled` reservado).
- ✅ 5 novos testes Rust (21 totais, todos passando).
- ✅ `desktopBridge` adiciona namespace `missions` (canônico
  novo) e sobrescreve `workflows.*` em runtime Tauri
  (preservando a API legada da UI sem redesenho).
- ✅ `events.list(workflowRunId)` agora delega para
  `missions_list_logs` em runtime Tauri + converte
  `MissionLog` → `WorkflowEvent`.
- ✅ `window.fluxora.workflows.*` preservado/adaptado
  (14 métodos cobertos).
- ✅ `voice.createFromTranscript` continua mock
  (frontend-side, `buildVoiceContext`).
- ✅ Nenhum arquivo do projeto é alterado (read-only
  estrito).
- ✅ Nenhum comando shell é executado em `missions.rs`.
- ✅ Nenhuma referência a Electron reintroduzida.
- ✅ Nenhuma chamada a OpenCode como motor.
- ✅ `pnpm dev` continua abrindo o Tauri sem loop, com log
  esperado do Mission Engine.
- ✅ Documentação organizada em
  `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_008_MISSION_ENGINE.md`
  (este documento).
- ✅ Commit local criado em `feature/pr-008-mission-engine`
  (sem push remoto).
- ✅ Nenhuma feature fora de escopo (sem piloto
  automático, sem patch real, sem agente real, sem
  streaming, sem tool calling, sem storage seguro de
  secrets).
