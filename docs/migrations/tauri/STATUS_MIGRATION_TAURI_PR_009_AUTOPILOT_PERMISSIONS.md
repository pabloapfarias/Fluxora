# STATUS_MIGRATION_TAURI_PR_009_AUTOPILOT_PERMISSIONS

## 1. Objetivo da PR 009

Criar a **base do piloto automático com permissões por
projeto** do Fluxora. Esta PR entrega a infraestrutura que
permite configurar, por projeto, se uma missão roda em modo
`assistido`, `propositivo` ou `piloto-automatico`, com
permissões conservadoras e aprovações operacionais reais.

Concretamente:

- Sistema de **modos de execução por projeto** (`assistido`,
  `propositivo`, `piloto-automatico`).
- **Política de execução por projeto** persistida localmente,
  com decisões `allow` / `ask` / `deny` para 13 ações
  canônicas (read/write/create/delete/move files, run
  commands, install dependencies, git read/write, network
  provider, apply patch, commit, push).
- **Fila/scheduler mínima em memória** para missões
  (`MissionJob`), com proteção contra execuções simultâneas
  da mesma missão.
- **Aprovações operacionais reais** persistidas localmente,
  emitidas automaticamente pelo Permissions Engine quando a
  decisão de uma checagem for `ask`.
- **Integração do Mission Engine** (PR 008) com o sistema de
  permissões antes da coleta de contexto e antes da chamada
  do provider.
- **Eventos** `permission/*`, `approval/*` e `mission/job-*`
  no barramento `fluxora-event` (PR 005).
- Compatibilidade com `workflows.*`, `approvals.*` e
  `events.*` legados via `desktopBridge` (com conversão
  `ExecutionApproval` → `Approval` e `MissionJob` →
  `BackgroundWorkflowJob`).

**Esta PR ainda NÃO aplica patches reais em arquivos, NÃO
executa comandos de shell, NÃO faz Git write operations,
NÃO faz commit/push/checkout/reset.** A aplicação controlada
de patch/diff fica para a PR 010. O piloto automático, nesta
PR, significa: executar missões respeitando a política do
projeto, emitindo fases/eventos, criando aprovações
pendentes para ações `ask` e negando ações `deny`.

## 2. Estado herdado da PR 008

- Repositório Git local em
  `feature/pr-008-mission-engine` (a partir de
  `feature/pr-007-provider-engine`).
- `pnpm dev` na raiz abrindo o app desktop Tauri.
- `projects.*` / `git.*` / `filesystem.*` / `app.*` reais em
  Rust (PR 002, PR 003).
- Barramento real `fluxora-event` (PR 005) com ring buffer
  200 e canal único.
- `voice.*` / `whisper.*` real em Rust (PR 006).
- Provider Engine próprio (PR 007) com adapter
  OpenAI-compatible, persistência em `providers.json`,
  eventos `provider/*` e comandos `providers_*`.
- Mission Engine inicial (PR 008) com persistência em
  `missions.json`, 8 comandos `missions_*`, eventos
  `mission/*` (`mission/created`, `mission/started`,
  `mission/phase`, `mission/log`, `mission/completed`,
  `mission/failed`, `mission/cancelled`) e integração com o
  Provider Engine via `providers::execute_mission_chat`.
- `desktopBridge` centralizando `invoke()` e expondo
  `window.fluxora.*`.
- O domínio `approvals.*` era 100% mock (em `mock-api.ts`):
  `listActionable`, `listPending`, `list`, `approve`,
  `reject` consumidos por `ApprovalsPage`, `OverviewPage`,
  `AppShell`, `RightPanel`, `ExecutionDetailPage`,
  `ControlledExecutionPanel`, `usePendingApprovals`.
- `workflows.approveFinal` / `rejectFinal` consumidos por
  `OverviewPage`, `ExecutionDetailPage`,
  `ControlledExecutionPanel` — também 100% mock.
- `workflows.listJobs` / `getJob` / `cancelJob` consumidos
  por `StatusBar`, `RightPanel`, `ControlledExecutionPanel` —
  stubs que devolviam `[]` / `null` / noop nesta PR.
- `MissionMode = "assistido" | "propositivo" |
  "piloto-automatico"` já existia no contrato de tipos
  (introduzido na PR 008), mas sem infra de suporte.

## 3. Como permissões / aprovações / jobs funcionavam antes

### 3.1 `approvals.*` no mock

`apps/desktop/src/api/mock-api.ts` (linhas 760-836) expunha:

```ts
approvals: {
  listActionable,
  listPending,
  list,
  approve,
  reject,
}
```

Em runtime Tauri, o `desktopBridge` **ainda apontava para o
mock** (`...mock.approvals`), sem sobrescrita. O
`listActionable` reconciliava workflows órfãos em
`pending_approval` criando `Approval` legadas em memória
(array `approvals`). Aprovações eram vinculadas a um
`workflowRunId` e tinham `title`, `description`, `impact`
(`low` / `medium` / `high`), `status` (`pending` /
`approved` / `rejected`), `createdAt`, `resolvedAt`.

A UI consumia via `window.fluxora.approvals.*` e exibia em
painéis de aprovação. Não havia persistência — fechar o app
perdia as aprovações. Não havia relação com permissões do
projeto.

### 3.2 `workflows.listJobs` / `getJob` / `cancelJob`

No mock, `listJobs` devolvia o array `jobs` (em memória) e
`getJob(id)` buscava nele. No `desktopBridge` em runtime
Tauri (PR 008), os três métodos eram stubs:

- `getJob(id)` → `null`
- `listJobs()` → `[]`
- `cancelJob(id)` → noop

A UI consumia a forma legada `BackgroundWorkflowJob { id,
workflowRunId, projectId, strategy, status, startedAt?,
completedAt? }` e exibia contagens/badges baseados em
`workflows.list` + `events.list`.

### 3.3 Modo de execução hoje

A `MissionMode` existia no tipo `MissionRun` da PR 008, mas
era sempre `"propositivo"` (definido em `missions_create`
quando o `payload.mode` não vinha). A UI não diferenciava
`assistido` de `piloto-automatico`. A política de execução
era inexistente.

### 3.4 Quem ouve os eventos hoje

A UI consumia `window.fluxora.events.subscribe(...)` /
`events.on("type", cb)` / `events.listRecent(...)` /
`events.emitDiagnostic(...)` (PR 005). Não havia
`permission/*` nem `mission/job-*` no barramento.

## 4. Como funciona agora

### 4.1 Em runtime Tauri

1. **Permissions Engine** (`apps/desktop/src-tauri/src/permissions.rs`):
   - Mantém `PermissionsState` (`Mutex<Vec<ProjectExecutionPolicyRecord>>`)
     registrado via `tauri::Builder::manage`.
   - Carregado no `setup` do Tauri a partir de
     `<app_data_dir>/fluxora/permissions.json` (silencioso em
     caso de I/O error). Log:
     `[fluxora permissions] carregadas N política(s)`.
   - 6 comandos Tauri:
     `permissions_ping`,
     `permissions_get_project_policy(project_id)`,
     `permissions_update_project_policy(project_id, payload)`,
     `permissions_list_policies()`,
     `permissions_reset_project_policy(project_id)`,
     `permissions_check(project_id, action, mission_id?)`.
   - Política default conservadora (criada sob demanda):
     `read-files`/`git-read`/`network-provider` → `allow`;
     `write-files`/`create-files`/`move-files`/
     `run-commands`/`install-dependencies`/`apply-patch`
     → `ask`;
     `delete-files`/`git-write`/`commit`/`push` → `deny`.
   - Modo default: `propositivo`. `autopilotEnabled: false`
     por default. `requireApprovalForHighRisk: true` por
     default. `maxAutopilotSteps: 20` por default.
   - `permissions_check` valida a ação, resolve a decisão
     da política e emite um dos 4 eventos
     `permission/check` / `permission/allowed` /
     `permission/denied` / `permission/approval-required`.
     Quando a decisão for `ask`, cria automaticamente uma
     `ExecutionApproval` pendente via
     `approvals::approvals_create`.

2. **Approvals Engine** (`apps/desktop/src-tauri/src/approvals.rs`):
   - Mantém `ApprovalsState`
     (`Mutex<Vec<ExecutionApprovalRecord>>`) registrado via
     `tauri::Builder::manage`.
   - Carregado no `setup` do Tauri a partir de
     `<app_data_dir>/fluxora/approvals.json`. Log:
     `[fluxora approvals] carregadas N aprovação(ões)`.
   - 8 comandos Tauri:
     `approvals_ping`,
     `approvals_list()`,
     `approvals_get(id)`,
     `approvals_create(payload)`,
     `approvals_approve(id)`,
     `approvals_reject({ id, note? })`,
     `approvals_cancel({ id, reason? })`,
     `approvals_list_actionable()`.
   - 5 eventos `approval/*` no canal `fluxora-event`:
     `approval/created`, `approval/approved`,
     `approval/rejected`, `approval/cancelled`,
     `approval/expired` (reservado).
   - Status ampliado: `pending` | `approved` | `rejected` |
     `expired` | `cancelled`. O `desktopBridge` converte
     `expired` e `cancelled` para `rejected` ao expor a
     forma `Approval` legado.
   - `approvals_create` valida `action` não-vazia,
     `title` não-vazio, `description` não-vazia e
     `risk` ∈ {`low`, `medium`, `high`}.
   - `approvals_approve` / `approvals_reject` /
     `approvals_cancel` só operam em aprovações com status
     `pending`; retornam erro caso contrário.

3. **Scheduler/fila mínima** (em `missions.rs`):
   - Mantém `MissionJobsState`
     (`Mutex<Vec<MissionJobRecord>>`) registrado via
     `tauri::Builder::manage`.
   - **Não persistido em disco nesta PR** — reconstruído
     a partir das missões persistidas (a `MissionRun`
     correspondente em `missions.json` carrega o estado
     durável; o `MissionJob` é efêmero, em memória).
   - 4 comandos Tauri:
     `scheduler_ping`,
     `scheduler_list_jobs()`,
     `scheduler_get_job(job_id)`,
     `scheduler_cancel_job({ jobId, reason? })`.
   - 5 eventos `mission/job-*` no canal `fluxora-event`:
     `mission/job-created`, `mission/job-started`,
     `mission/job-completed`, `mission/job-failed`,
     `mission/job-cancelled`.
   - `create_mission_job` (chamado pelo `missions_run`)
     rejeita criação de um novo job se já houver um job
     ativo (`queued` ou `running`) para a mesma missão.

4. **Mission Engine integrado** (`missions.rs`):
   - `missions_run` agora:
     1. Cria um `MissionJob` (status inicial `queued`).
     2. Resolve o `policy` do projeto via
        `permissions::get_or_create_policy`.
     3. Aplica `resolve_effective_mode`: se o modo
        solicitado for `piloto-automatico` mas a política
        tem `autopilotEnabled: false`, dega
        para `propositivo` e emite `mission/phase` com
        payload `policy-fallback` (registrando a decisão).
     4. Antes da coleta de contexto, chama
        `permissions_check("read-files")`. Se `deny`,
        marca o job como `failed` e devolve erro. Se `ask`,
        cria `ExecutionApproval` pendente, marca o job como
        `failed` e devolve erro (a missão fica no estado
        `queued` aguardando o usuário aprovar via UI ou
        liberar via `desktopBridge` em PR futura).
     5. Antes da chamada do provider, chama
        `permissions_check("network-provider")` com a
        mesma lógica.
     6. Marca o job como `running` antes de
        `mission/started` e como `completed` após
        `mission/completed`.
   - `fail_mission` aceita um `job_id: Option<&str>` e
     chama `mark_job_failed` para que o `MissionJob`
     correspondente também transite para `failed`.
   - Cada `check_action_for_mission` registra um
     `mission/phase` com payload `permission: { action,
     decision, allowed, requiresApproval, approvalId }` e
     um log de progresso no `MissionsState`.

### 4.2 Fora do runtime Tauri (browser/Vite dev)

- `mock-api.ts` ganhou namespaces `permissions` e
  `scheduler` com stubs que devolvem a política default
  conservadora, listas vazias, e resultados `allow` para
  qualquer `permissions.check` (para não bloquear o
  smoke-test da UI).
- `approvals.*` no mock continua 100% legado (mesma forma
  da PR 008). A UI que depende dele no navegador não
  quebra.
- `workflows.listJobs` / `getJob` / `cancelJob` no mock
  continuam legados (consumidos pela UI sem quebrar).

### 4.3 Quem ouve os eventos

- `permission/check`, `permission/allowed`,
  `permission/denied`, `permission/approval-required` —
  disponíveis via
  `events.on("permission/check", cb)` etc. Emitidos pelo
  Permissions Engine em runtime Tauri.
- `approval/created`, `approval/approved`,
  `approval/rejected`, `approval/cancelled` — idem.
- `mission/job-created`, `mission/job-started`,
  `mission/job-completed`, `mission/job-failed`,
  `mission/job-cancelled` — idem.
- `mission/phase` continua sendo emitido pelo Mission
  Engine; nesta PR pode incluir `payload.permission` (com
  `action`, `decision`, `allowed`, `requiresApproval`,
  `approvalId`) e `payload.policy-fallback` (com
  `requestedMode`, `effectiveMode`, `defaultMode`,
  `autopilotEnabled`).

## 5. Métodos `permissions.*` (canônico novo)

| Método | Status na PR 009 |
|---|---|
| `permissions.ping` | **real** (Tauri `permissions_ping`), mock devolve ISO 8601 |
| `permissions.getProjectPolicy` | **real** (Tauri `permissions_get_project_policy`, cria a default se não existir), mock stub |
| `permissions.updateProjectPolicy` | **real** (Tauri `permissions_update_project_policy`), mock stub |
| `permissions.listPolicies` | **real** (Tauri `permissions_list_policies`), mock devolve `[]` |
| `permissions.resetProjectPolicy` | **real** (Tauri `permissions_reset_project_policy`), mock stub |
| `permissions.check` | **real** (Tauri `permissions_check`), mock devolve `allow` |

## 6. Métodos `approvals.*` migrados (convertendo `ExecutionApproval` → `Approval`)

| Método | Em runtime Tauri | Fora do runtime Tauri |
|---|---|---|
| `approvals.listActionable` | `approvals_list_actionable` (filtra `pending`) + `toLegacyApproval` | mock legado |
| `approvals.listPending` | `approvals_list` (filtra `pending`) + `toLegacyApproval` | mock legado |
| `approvals.list` | `approvals_list` + `toLegacyApproval` | mock legado |
| `approvals.approve` | `approvals_approve` + `toLegacyApproval` | mock legado |
| `approvals.reject` | `approvals_reject` + `toLegacyApproval` | mock legado |
| `approvals.cancel` | `approvals_cancel` + `toLegacyApproval` (novo nesta PR) | mock devolve `null` |

A UI (`ApprovalsPage`, `OverviewPage`, `AppShell`,
`RightPanel`, `ExecutionDetailPage`,
`ControlledExecutionPanel`, `usePendingApprovals`)
continua consumindo `window.fluxora.approvals.*`
exatamente como antes — o `desktopBridge` é quem decide se
a chamada vai para o Approvals Engine real (em runtime
Tauri) ou para o mock legado.

## 7. Métodos `workflows.*` adaptados em runtime Tauri (PR 009)

| Método | Status na PR 009 |
|---|---|
| `workflows.list` | **real** (Tauri `missions_list` + converte `MissionRun` → `WorkflowRun`), mock legado |
| `workflows.create` | **real** (Tauri `missions_create_and_run`), mock legado |
| `workflows.get` | **real** (Tauri `missions_get` + `missions_list_logs` + converte), mock legado |
| `workflows.simulate` / `workflows.runReal` | **real** (Tauri `missions_run`), mock legado |
| `workflows.runRealAsync` | **real** (dispara `missions_run` em background, devolve `jobId` sintético), mock legado |
| `workflows.rerun` | **real** (cria nova missão a partir do original), mock legado |
| `workflows.getJob` | **real** (Tauri `scheduler_get_job` + converte `MissionJob` → `BackgroundWorkflowJob`), mock stub |
| `workflows.listJobs` | **real** (Tauri `scheduler_list_jobs` + converte), mock stub |
| `workflows.cancelJob` | **real** (Tauri `scheduler_cancel_job`), mock stub |
| `workflows.approveFinal` | **mock** (sem aprovação final real nesta PR — patch não aplicado) |
| `workflows.rejectFinal` | **mock** (idem) |
| `workflows.getStepOutputs` / `workflows.listAgentOutputs` | **real** (3 steps sintéticos derivados dos logs reais) |

A UI (`StatusBar`, `RightPanel`, `ControlledExecutionPanel`)
que consome `workflows.listJobs` / `getJob` / `cancelJob`
agora passa a receber `BackgroundWorkflowJob[]` reais
(convertidos de `MissionJob`) em runtime Tauri. O campo
`strategy` é mapeado: `piloto-automatico` →
`controlled_execution`; `assistido` / `propositivo` →
`single`.

## 8. Métodos `scheduler.*` (canônico novo)

| Método | Status na PR 009 |
|---|---|
| `scheduler.ping` | **real** (Tauri `scheduler_ping`), mock devolve ISO 8601 |
| `scheduler.listJobs` | **real** (Tauri `scheduler_list_jobs`), mock devolve `[]` |
| `scheduler.getJob` | **real** (Tauri `scheduler_get_job`), mock devolve `null` |
| `scheduler.cancelJob` | **real** (Tauri `scheduler_cancel_job`), mock devolve `null` |

Componentes novos podem consumir
`window.fluxora.scheduler.*` diretamente para evitar a
camada de adaptação `workflows.*` → `MissionJob`.

## 9. Métodos legados preservados / adaptados

| Método | Em runtime Tauri | Fora do runtime Tauri |
|---|---|---|
| `missions.*` | `missions_*` reais (PR 008) + integração com permissões | mock stub |
| `events.subscribe/on/listRecent/emitDiagnostic/clearRecent` | inalterados (PR 005) | inalterados (PR 005) |
| `events.list(workflowRunId)` | `missions_list_logs` + converte | mock legado |
| `events.onWorkflowEvent` / `onJobUpdated` / `onApprovalChange` / `onOpenCodeStdout/Stderr/JsonEvent` | mock legado | mock legado |
| `voice.createFromTranscript` | inalterado (frontend-side, `buildVoiceContext`) | inalterado |
| `voice.transcribe` | inalterado (PR 006) | inalterado |
| `git.changedFiles` / `git.fileDiff` | mock legado (dependem de patch real) | mock legado |
| `commands.*` | mock legado | mock legado |
| `opencode.*` | inalterado (PR 007 — Provider Engine sobrescreve quando há providers) | inalterado |
| `providers.*` | inalterado (PR 007) | inalterado |

A UI continua consumindo `window.fluxora.approvals.*`,
`window.fluxora.workflows.*` e `window.fluxora.events.*`
exatamente como antes — o `desktopBridge` faz a adaptação.

## 10. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type ExecutionMode = MissionMode; // "assistido" | "propositivo" | "piloto-automatico"

export type PermissionDecision = "allow" | "ask" | "deny";

export type PermissionAction =
  | "read-files" | "write-files" | "create-files" | "delete-files"
  | "move-files" | "run-commands" | "install-dependencies"
  | "git-read" | "git-write" | "network-provider"
  | "apply-patch" | "commit" | "push";

export const PERMISSION_ACTIONS: PermissionAction[] = [...];

export const DEFAULT_PERMISSION_DECISIONS: Record<PermissionAction, PermissionDecision> = {
  "read-files": "allow", "git-read": "allow", "network-provider": "allow",
  "write-files": "ask", "create-files": "ask", "delete-files": "deny",
  "move-files": "ask", "run-commands": "ask", "install-dependencies": "ask",
  "git-write": "deny", "apply-patch": "ask", "commit": "deny", "push": "deny",
};

export interface ProjectExecutionPolicy {
  projectId: string;
  defaultMode: ExecutionMode;
  permissions: Record<PermissionAction, PermissionDecision>;
  autopilotEnabled: boolean;
  requireApprovalForHighRisk: boolean;
  maxAutopilotSteps?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionCheckResult {
  action: PermissionAction;
  decision: PermissionDecision;
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  reason?: string;
}

// `ApprovalStatus` (legado) agora inclui "expired" e "cancelled".
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type ApprovalRisk = "low" | "medium" | "high";

export interface ExecutionApproval {
  id: string;
  projectId?: string;
  missionId?: string;
  action: PermissionAction;
  title: string;
  description: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  requestedBy?: string;
  payload?: unknown;
}

export interface CreateApprovalInput {
  projectId?: string;
  missionId?: string;
  action: PermissionAction;
  title: string;
  description: string;
  risk: ApprovalRisk;
  requestedBy?: string;
  payload?: unknown;
}

export interface UpdateProjectPolicyInput {
  defaultMode?: ExecutionMode;
  permissions?: Partial<Record<PermissionAction, PermissionDecision>>;
  autopilotEnabled?: boolean;
  requireApprovalForHighRisk?: boolean;
  maxAutopilotSteps?: number;
}

export interface MissionJob {
  id: string;
  missionId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  mode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CancelMissionJobInput {
  jobId: string;
  reason?: string;
}
```

Adicionado em `FluxoraAPI`:

```ts
permissions: {
  ping(): Promise<string>;
  getProjectPolicy(projectId: string): Promise<ProjectExecutionPolicy>;
  updateProjectPolicy(
    projectId: string,
    input: UpdateProjectPolicyInput
  ): Promise<ProjectExecutionPolicy>;
  listPolicies(): Promise<ProjectExecutionPolicy[]>;
  resetProjectPolicy(projectId: string): Promise<ProjectExecutionPolicy>;
  check(input: {
    projectId: string;
    action: PermissionAction;
    missionId?: string;
  }): Promise<PermissionCheckResult>;
};

scheduler: {
  ping(): Promise<string>;
  listJobs(): Promise<MissionJob[]>;
  getJob(jobId: string): Promise<MissionJob | null>;
  cancelJob(input: CancelMissionJobInput): Promise<MissionJob | null>;
};

// `approvals.*` (legado) ganhou `cancel`:
approvals: {
  listActionable(): Promise<Approval[]>;
  listPending(): Promise<Approval[]>;
  list(): Promise<Approval[]>;
  approve(id: string): Promise<Approval>;
  reject(id: string): Promise<Approval>;
  cancel(id: string): Promise<Approval | null>;
};
```

Tipos legados `Approval` / `WorkflowRun` / `WorkflowEvent` /
`WorkflowRunDetail` / `BackgroundWorkflowJob` /
`CreateWorkflowInput` / `WorkflowRerunInput` /
`AgentStepOutput` / `ChangedFile` / `FileDiff` / `CommandRun`
**preservados intactos** — a UI que os consome não muda.

## 11. Backend Rust criado/alterado

### 11.1 Criado

- `apps/desktop/src-tauri/src/permissions.rs` — **novo**,
  ~840 linhas:
  - `ProjectExecutionPolicyRecord` (espelha
    `ProjectExecutionPolicy` em `@fluxora/shared`).
  - `PermissionsState` (Mutex<Vec<ProjectExecutionPolicyRecord>>).
  - `PermissionsFile` (struct versionada para JSON).
  - `permissions_file_path` / `ensure_permissions_dir` /
    `load_permissions_on_startup` / `persist` (carrega de
    `<app_data_dir>/fluxora/permissions.json`).
  - `default_permissions_map` (decisões default
    conservadoras).
  - `validate_action` / `validate_decision` / `validate_mode`.
  - `build_default_policy` / `get_or_create_policy` /
    `merge_policy` / `upsert_policy` / `find_policy`.
  - `humanize_action` (rótulo amigável em PT-BR para
    descrições de Approval).
  - `risk_for_action` (classifica risco: `low` /
    `medium` / `high`).
  - 6 comandos Tauri: `permissions_ping` /
    `permissions_get_project_policy` /
    `permissions_update_project_policy` /
    `permissions_list_policies` /
    `permissions_reset_project_policy` /
    `permissions_check`.
  - 4 eventos `permission/*` no canal `fluxora-event`:
    `permission/check`, `permission/allowed`,
    `permission/denied`, `permission/approval-required`.
  - 8 testes unitários: `default_permissions_are_conservative`,
    `default_policy_disables_autopilot`,
    `validation_rejects_unknown_action`,
    `validation_rejects_invalid_decision`,
    `validation_rejects_invalid_mode`,
    `humanize_action_known_values`,
    `risk_for_action_classifies_correctly`,
    `merge_policy_preserves_untouched_fields`,
    `merge_policy_rejects_invalid_action`.

- `apps/desktop/src-tauri/src/approvals.rs` — **novo**,
  ~600 linhas:
  - `ExecutionApprovalRecord` (espelha `ExecutionApproval`).
  - `ApprovalsState` (Mutex<Vec<ExecutionApprovalRecord>>).
  - `ApprovalsFile` (struct versionada para JSON).
  - `approvals_file_path` / `ensure_approvals_dir` /
    `load_approvals_on_startup` / `persist`.
  - `validate_inputs` / `validate_risk` /
    `generate_approval_id` / `find_approval` /
    `update_approval`.
  - 8 comandos Tauri: `approvals_ping` /
    `approvals_list` / `approvals_get` /
    `approvals_create` / `approvals_approve` /
    `approvals_reject` / `approvals_cancel` /
    `approvals_list_actionable`.
  - 4 eventos `approval/*` no canal `fluxora-event`:
    `approval/created`, `approval/approved`,
    `approval/rejected`, `approval/cancelled`.
  - 3 testes unitários: `validate_inputs_rejects_empty_fields`,
    `validate_risk_accepts_only_known_values`,
    `status_constants_include_all_values`.

### 11.2 Alterado

- `apps/desktop/src-tauri/src/missions.rs`:
  - Adicionado `MissionJobRecord` (espelha `MissionJob`).
  - Adicionado `MissionJobsState`
    (Mutex<Vec<MissionJobRecord>>).
  - Adicionado `CancelMissionJobPayload`.
  - Adicionados helpers de job:
    `generate_job_id`, `find_active_job_for_mission`,
    `find_job_by_id`, `insert_job`, `update_job`,
    `create_mission_job`, `mark_job_running`,
    `mark_job_completed`, `mark_job_failed`,
    `mark_job_cancelled`, `emit_job_event`.
  - Adicionados helpers de permissão:
    `check_action_for_mission` (chama
    `permissions_check` + emite `mission/phase` com
    payload `permission` + log), `resolve_effective_mode`
    (resolve o modo efetivo com fallback de
    `piloto-automatico` → `propositivo` quando
    `autopilotEnabled: false`).
  - Adicionados 4 comandos Tauri: `scheduler_ping`,
    `scheduler_list_jobs`, `scheduler_get_job`,
    `scheduler_cancel_job`.
  - `fail_mission` agora aceita
    `job_id: Option<&str>` e chama `mark_job_failed` ao
    final.
  - `missions_run` foi estendido para:
    1. Criar `MissionJob` no início.
    2. Resolver o modo efetivo via `resolve_effective_mode`.
    3. Checar `read-files` antes da coleta de contexto.
    4. Marcar job como `running` antes do
       `mission/started`.
    5. Checar `network-provider` antes do provider call.
    6. Marcar job como `completed` no sucesso.
  - As 5 chamadas de `fail_mission` foram atualizadas para
    passar `Some(&job_id)`.
  - 2 novos testes unitários foram adicionados na
    cobertura existente.

- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod permissions;` e `mod approvals;` adicionados.
  - `use` statements para
    `permissions::{PermissionCheckPayload, PermissionCheckResultRecord, ProjectExecutionPolicyRecord, UpdatePolicyPayload}`
    e `approvals::{CreateApprovalPayload, ExecutionApprovalRecord, RejectApprovalPayload, CancelApprovalPayload}`
    e `missions::{..., CancelMissionJobPayload, MissionJobRecord}`.
  - 18 novos comandos Tauri adicionados ao `invoke_handler`:
    - `permissions_ping`,
      `permissions_get_project_policy`,
      `permissions_update_project_policy`,
      `permissions_list_policies`,
      `permissions_reset_project_policy`,
      `permissions_check`
    - `approvals_ping`, `approvals_list`,
      `approvals_get`, `approvals_create`,
      `approvals_approve`, `approvals_reject`,
      `approvals_cancel`, `approvals_list_actionable`
    - `scheduler_ping`, `scheduler_list_jobs`,
      `scheduler_get_job`, `scheduler_cancel_job`
  - 3 novos `manage(...)` no `Builder`:
    `missions::MissionJobsState::new()`,
    `permissions::PermissionsState::new()`,
    `approvals::ApprovalsState::new()`.
  - 2 novas chamadas no `setup`:
    `permissions::load_permissions_on_startup(&handle)`,
    `approvals::load_approvals_on_startup(&handle)`.

`Cargo.toml` não precisou de dependências novas (apenas
`serde`, `serde_json`, `time`, `tauri` que já estavam
presentes).

## 12. Arquivos frontend alterados

### 12.1 `packages/shared/src/index.ts`

- Adicionados: `ExecutionMode`, `PermissionDecision`,
  `PermissionAction`, `PERMISSION_ACTIONS`,
  `DEFAULT_PERMISSION_DECISIONS`,
  `ProjectExecutionPolicy`, `PermissionCheckResult`,
  `ApprovalRisk`, `ExecutionApproval`,
  `CreateApprovalInput`, `UpdateProjectPolicyInput`,
  `MissionJob`, `CancelMissionJobInput`.
- `ApprovalStatus` foi estendido para incluir `expired` e
  `cancelled` (mantém os valores legados).
- Atualizada a `FluxoraAPI` com os namespaces
  `permissions.*` e `scheduler.*`.
- Atualizado `approvals.*` (legado) com o método `cancel`.

### 12.2 `apps/desktop/src/api/mock-api.ts`

- Importados os tipos novos da PR 009.
- Adicionado `approvals.cancel` (devolve `null` no mock).
- Adicionados os namespaces `permissions` e `scheduler` com
  stubs que devolvem a política default conservadora
  (`permissions.getProjectPolicy` / `updateProjectPolicy` /
  `resetProjectPolicy`), listas vazias
  (`listPolicies`, `scheduler.listJobs`) e `allow` para
  qualquer `permissions.check` (para não bloquear o
  smoke-test da UI fora do runtime Tauri).

### 12.3 `apps/desktop/src/services/desktopBridge.ts`

- Importados os tipos novos da PR 009:
  `Approval`, `ApprovalImpact`, `BackgroundWorkflowJob`,
  `CancelMissionJobInput`, `ExecutionApproval`, `MissionJob`,
  `PermissionAction`, `PermissionCheckResult`,
  `ProjectExecutionPolicy`, `UpdateProjectPolicyInput`.
- Adicionada seção "PR 009 — Permissions Engine" com:
  - `toLegacyApproval(input: ExecutionApproval): Approval`
    (converte `risk` → `impact`, `missionId` →
    `workflowRunId`, status `expired`/`cancelled` →
    `rejected`).
  - `toLegacyJob(job: MissionJob): BackgroundWorkflowJob`
    (mapeia `mode` → `strategy`).
  - Helpers de baixo nível: `listApprovalsTauri`,
    `getApprovalByIdTauri`, `listActionableApprovalsTauri`,
    `approveApprovalTauri`, `rejectApprovalTauri`,
    `cancelApprovalTauri`, `listPoliciesTauri`,
    `getProjectPolicyTauri`, `updateProjectPolicyTauri`,
    `resetProjectPolicyTauri`, `checkPermissionTauri`,
    `listJobsTauri`, `getJobByIdTauri`, `cancelJobTauri`.
- `createDesktopBridge()` agora retorna:
  - `permissions.*` — namespace canônico novo (8 métodos
    delegando para Tauri com fallback mock).
  - `scheduler.*` — namespace canônico novo (4 métodos
    delegando para Tauri com fallback mock).
  - `approvals.*` — sobrescreve o mock legado em runtime
    Tauri; `listActionable`, `listPending`, `list`,
    `approve`, `reject` delegam para os comandos
    `approvals_*` reais e convertem `ExecutionApproval` →
    `Approval`. `cancel` é novo nesta PR.
  - `workflows.listJobs`, `workflows.getJob`,
    `workflows.cancelJob` — sobrescrevem o stub da PR 008
    para delegar para `scheduler_*` e converter
    `MissionJob` → `BackgroundWorkflowJob`. A UI atual
    (`StatusBar`, `RightPanel`, `ControlledExecutionPanel`)
    passa a receber jobs reais sem alteração.

### 12.4 Não alterados (UI preservada)

- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/components/voice/VoiceContextCard.tsx`
- `apps/desktop/src/pages/ExecutionDetailPage.tsx`
- `apps/desktop/src/pages/ExecutionsPage.tsx`
- `apps/desktop/src/pages/ApprovalsPage.tsx`
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

## 13. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora
retorna explicitamente os namespaces `missions` (PR 008),
`workflows` (adaptado), `permissions` (PR 009),
`scheduler` (PR 009) e `approvals` (adaptado em runtime
Tauri). Em runtime Tauri, todas as chamadas de
`workflows.listJobs` / `getJob` / `cancelJob` e
`approvals.*` passam pelo backend real; fora do runtime
Tauri, o mock legado é preservado.

### Namespace `approvals` (PR 009 — adaptado em runtime Tauri)

- `listActionable()` → em runtime Tauri, chama
  `approvals_list_actionable` e mapeia
  `ExecutionApproval` → `Approval` (filtra status
  `pending`).
- `listPending()` → em runtime Tauri, chama
  `approvals_list` e filtra `pending`.
- `list()` → em runtime Tauri, chama `approvals_list`.
- `approve(id)` → em runtime Tauri, chama
  `approvals_approve`.
- `reject(id)` → em runtime Tauri, chama
  `approvals_reject` com payload `{ id }`.
- `cancel(id)` → **novo** em runtime Tauri, chama
  `approvals_cancel` com payload `{ id }`. Devolve
  `Approval | null`.

### Namespace `workflows.listJobs` / `getJob` / `cancelJob` (PR 009)

- `listJobs()` → em runtime Tauri, chama
  `scheduler_list_jobs` e mapeia `MissionJob` →
  `BackgroundWorkflowJob`. Mode `piloto-automatico` →
  `strategy: "controlled_execution"`; outros modos →
  `strategy: "single"`.
- `getJob(jobId)` → em runtime Tauri, chama
  `scheduler_get_job`. Devolve `null` se não existir.
- `cancelJob(jobId)` → em runtime Tauri, chama
  `scheduler_cancel_job` com payload `{ jobId }`. Jobs
  `running` continuam até o fim (síncronos nesta PR); o
  status do `MissionJob` reflete a intenção.

### Namespace `permissions` (PR 009 — canônico novo)

- `ping()` → em runtime Tauri, chama `permissions_ping`.
- `getProjectPolicy(projectId)` → em runtime Tauri, chama
  `permissions_get_project_policy` (cria a default se não
  existir).
- `updateProjectPolicy(projectId, input)` → em runtime
  Tauri, chama `permissions_update_project_policy`.
- `listPolicies()` → em runtime Tauri, chama
  `permissions_list_policies`.
- `resetProjectPolicy(projectId)` → em runtime Tauri,
  chama `permissions_reset_project_policy`.
- `check({ projectId, action, missionId? })` → em runtime
  Tauri, chama `permissions_check`. Se o backend falhar,
  devolve `deny` (fail-closed) com a mensagem de erro
  como `reason`.

### Namespace `scheduler` (PR 009 — canônico novo)

- `ping()` → em runtime Tauri, chama `scheduler_ping`.
- `listJobs()` → em runtime Tauri, chama
  `scheduler_list_jobs`.
- `getJob(jobId)` → em runtime Tauri, chama
  `scheduler_get_job`.
- `cancelJob({ jobId, reason? })` → em runtime Tauri,
  chama `scheduler_cancel_job`.

### Resultado

A UI continua consumindo `window.fluxora.approvals.*` e
`window.fluxora.workflows.*` exatamente como antes.
Componentes novos podem consumir
`window.fluxora.permissions.*` e `window.fluxora.scheduler.*`
diretamente para evitar a camada de adaptação.

## 14. Como políticas por projeto são persistidas

### 14.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/permissions.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada política tem:
  - `projectId`
  - `defaultMode` (`"assistido" | "propositivo" |
    "piloto-automatico"`)
  - `permissions` (mapa `PermissionAction` →
    `PermissionDecision`, com as 13 ações canônicas).
  - `autopilotEnabled` (bool)
  - `requireApprovalForHighRisk` (bool)
  - `maxAutopilotSteps?` (u32, opcional)
  - `createdAt` / `updatedAt` (ISO 8601)
- `load_permissions_on_startup` é chamado no `setup` do
  Tauri. Log:
  `[fluxora permissions] carregadas N política(s)`.
- `get_or_create_policy` cria a default (e persiste) se o
  projeto não tiver uma.
- `permissions_update_project_policy` faz merge (sobrescreve
  apenas os campos informados) e persiste.

### 14.2 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência). O
  stub de `permissions.getProjectPolicy` devolve a default
  conservadora; `permissions.check` devolve `allow` para
  qualquer ação.

## 15. Local do `permissions.json`

`<app_data_dir>/fluxora/permissions.json`

Onde `app_data_dir` é resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora`, a
localização esperada tende a ser equivalente a:

`~/.local/share/com.fluxora/fluxora/permissions.json`

## 16. Como aprovações são persistidas

### 16.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/approvals.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada `ExecutionApproval` tem:
  - `id`
  - `projectId?`, `missionId?`
  - `action` (uma das 13 `PermissionAction`)
  - `title`, `description`
  - `risk` (`"low" | "medium" | "high"`)
  - `status` (`"pending" | "approved" | "rejected" |
    "expired" | "cancelled"`)
  - `createdAt`, `updatedAt`, `resolvedAt?`
  - `requestedBy?`
  - `payload?` (JSON arbitrário)
- `load_approvals_on_startup` é chamado no `setup` do
  Tauri. Log:
  `[fluxora approvals] carregadas N aprovação(ões)`.
- `approvals_create` valida inputs e persiste em
  `approvals.json`.
- `approvals_approve` / `approvals_reject` /
  `approvals_cancel` só operam em aprovações com status
  `pending`; retornam erro caso contrário.

### 16.2 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência).

### 16.3 Storage seguro de secrets

- API key do provider **nunca** é registrada em
  `permissions.json` nem em `approvals.json` (a política
  referencia `PermissionAction` simbólica, não chaves).
- API key **nunca** aparece em eventos `permission/*` nem
  `approval/*`. O `risk_for_action` classifica apenas o
  risco da ação (`low` / `medium` / `high`), não a chave.

## 17. Local do `approvals.json`

`<app_data_dir>/fluxora/approvals.json`

No Linux: `~/.local/share/com.fluxora/fluxora/approvals.json`.

## 18. Como jobs/fila funcionam

### 18.1 Modelo de dados

`MissionJob` (em memória, **não persistido** nesta PR):

```ts
{
  id: "job-<millis>-<seq>",
  missionId: string,
  projectId: string,
  status: "queued" | "running" | "completed" | "failed" | "cancelled",
  mode: ExecutionMode,
  createdAt: string,
  updatedAt: string,
  startedAt?: string,
  completedAt?: string,
  error?: string,
}
```

### 18.2 Ciclo de vida

1. `create_mission_job(app, mission)` é chamado pelo
   `missions_run` no início. Cria o job com status
   `queued` e emite `mission/job-created`. Se já houver um
   job ativo (`queued` ou `running`) para a mesma missão,
   retorna erro.
2. `mark_job_running(app, job_id)` é chamado após a
   validação de status. Emite `mission/job-started`.
3. `mark_job_completed(app, job_id)` é chamado no
   `mission/completed`. Emite `mission/job-completed`.
4. `mark_job_failed(app, job_id, error)` é chamado pelo
   `fail_mission` (e por handlers de erro de permissão).
   Emite `mission/job-failed` com `errorMessage` (já
   sanitizado).
5. `mark_job_cancelled(app, job_id)` é chamado pelo
   `scheduler_cancel_job`. Emite `mission/job-cancelled`.

### 18.3 Persistência

- **Não persistido** nesta PR. O `MissionJob` é
  reconstruído a partir das missões persistidas em
  `missions.json` (a `MissionRun` carrega o estado
  durável; o `MissionJob` é efêmero).
- Limitação consciente: o status de jobs em memória
  reinicia com o app. PR futura pode adicionar
  persistência do `MissionJob` em arquivo separado ou
  embutido em `missions.json`.

## 19. Como Mission Engine consulta permissões

`missions_run` chama o helper
`check_action_for_mission(app, mission, action, phase)`
em dois pontos:

1. **Antes da coleta de contexto** (fase `"context"`),
   com `action = "read-files"`.
2. **Antes da chamada do provider** (fase
   `"provider-call"`), com `action = "network-provider"`.

Para cada chamada, o helper:

1. Chama `permissions_check(project_id, action,
   mission_id)`.
2. Registra um log de progresso no `MissionsState` (com
   payload `permission`).
3. Emite `mission/phase` com payload `permission`.
4. Se `allowed === true`, retorna `Ok(result)` e a missão
   prossegue.
5. Se `allowed === false && requiresApproval === true`
   (decisão `ask`), uma `ExecutionApproval` foi criada
   pelo `permissions_check`. O helper retorna `Err` com
   mensagem clara incluindo o `approvalId`. A missão é
   marcada como `queued` (com `error` explicativo), o
   `MissionJob` correspondente transita para `failed`, e
   o usuário pode aprovar via `approvals.approve` (em PR
   futura, o Mission Engine pode reagir automaticamente a
   aprovações resolvidas; nesta PR, a aprovação é
   apenas infraestrutura).
6. Se `allowed === false && requiresApproval === false`
   (decisão `deny`), o helper retorna `Err` com mensagem
   clara. A missão falha e o job transita para `failed`.

## 20. Como modos `assistido`, `propositivo` e `piloto-automatico` funcionam nesta PR

### 20.1 `propositivo`

- Comportamento da PR 008: lê contexto, monta prompt,
  chama o provider, salva `resultText`.
- Não cria aprovação para `read-files` nem
  `network-provider` se a política permitir (default:
  `allow`).
- É o modo default de toda missão (via
  `policy.defaultMode` ou `payload.mode = "propositivo"`).

### 20.2 `assistido`

- Pode se comportar igual ao `propositivo` nesta PR.
- Reservado para PR futura: pode criar uma aprovação
  antes de rodar o provider, se a política exigir.
- Documentado como mais conservador que `propositivo`
  (futuro). Comportamento atual: mesmo que `propositivo`.

### 20.3 `piloto-automatico`

- Roda sem intervenção para ações `allow`.
- Não executa ações `ask` sem criar aprovação
  (`ExecutionApproval` pendente).
- Nunca executa ações `deny` (a missão falha com erro
  claro).
- **Requer** `policy.autopilotEnabled === true` para
  funcionar. Quando o usuário pede
  `mode = "piloto-automatico"` mas a política tem
  `autopilotEnabled: false`, a missão é **degradada
  silenciosamente** para `propositivo` e o evento
  `mission/phase` registra o fallback
  (`payload.policy-fallback`). Log:
  "Piloto automático solicitado mas desativado na
  política do projeto. Degradando para 'propositivo'."
- Nesta PR, missões `piloto-automatico` ainda são
  read-only (não escreve arquivos, não roda comandos,
  não faz Git write operations).

## 21. Como eventos `permission/*`, `approval/*` e `mission/job-*` são emitidos

### 21.1 `permission/*` (4 tipos)

| Tipo | Quando | `level` |
|---|---|---|
| `permission/check` | sempre que `permissions_check` é chamado | `info` |
| `permission/allowed` | decisão `allow` | `info` |
| `permission/denied` | decisão `deny` | `warn` |
| `permission/approval-required` | decisão `ask` (criou `ExecutionApproval`) | `warn` |

Payload típico:

```json
{
  "action": "read-files",
  "decision": "ask",
  "policyDefaultMode": "propositivo",
  "autopilotEnabled": false,
  "approvalId": "appr-1234567890-0",
  "approvalRisk": "medium"
}
```

### 21.2 `approval/*` (4 tipos implementados)

| Tipo | Quando | `level` |
|---|---|---|
| `approval/created` | após `approvals_create` | `info` |
| `approval/approved` | após `approvals_approve` | `info` |
| `approval/rejected` | após `approvals_reject` | `warn` |
| `approval/cancelled` | após `approvals_cancel` | `info` |
| `approval/expired` | reservado (não emitido nesta PR) | `info` |

Payload típico:

```json
{
  "approvalId": "appr-1234567890-0",
  "action": "read-files",
  "risk": "medium",
  "status": "pending",
  "projectId": "proj-1234",
  "missionId": "mission-1234-0"
}
```

### 21.3 `mission/job-*` (5 tipos)

| Tipo | Quando | `level` |
|---|---|---|
| `mission/job-created` | após `create_mission_job` | `info` |
| `mission/job-started` | após `mark_job_running` | `info` |
| `mission/job-completed` | após `mark_job_completed` | `info` |
| `mission/job-failed` | após `mark_job_failed` | `error` |
| `mission/job-cancelled` | após `mark_job_cancelled` | `info` |

Payload típico:

```json
{
  "jobId": "job-1234567890-0",
  "missionId": "mission-1234-0",
  "projectId": "proj-1234",
  "status": "running",
  "mode": "propositivo"
}
```

### 21.4 Garantias de privacidade

**Nunca inclui**:

- API key (mesmo mascarada) — chave nunca passa por
  aqui.
- Path absoluto do projeto (só `projectId`).
- Mensagens longas de erro — truncadas em 500 chars pelo
  `truncate_error` do Mission Engine.
- O `payload` do provider — só o tamanho
  (`textLength` / `resultLength`).

**Sempre**:

- `source: "system"` (permission/* e approval/*) ou
  `source: "mission"` (mission/job-*).
- No canal `fluxora-event` (PR 005).

## 22. Limites de segurança implementados

1. **Defaults conservadores**: `allow` apenas para
   `read-files`, `git-read`, `network-provider`. Tudo o
   mais é `ask` ou `deny`.
2. **Piloto automático desativado por padrão**:
   `autopilotEnabled: false` em toda política nova.
3. **`delete-files`, `git-write`, `commit`, `push`** como
   `deny` por padrão.
4. **`write-files`, `create-files`, `move-files`,
   `run-commands`, `install-dependencies`, `apply-patch`**
   como `ask` por padrão.
5. **Nenhuma ação `ask` prossegue sem aprovação**:
   `check_action_for_mission` retorna `Err` se
   `requiresApproval === true`.
6. **Nenhuma ação `deny` prossegue**:
   `check_action_for_mission` retorna `Err` se
   `allowed === false && requiresApproval === false`.
7. **Nenhuma API key em permissões, aprovações, jobs ou
   eventos**: o `risk_for_action` classifica apenas o
   risco da ação, não a chave.
8. **Nenhum arquivo de projeto é alterado** nesta PR: o
   Mission Engine continua read-only/propositivo.
9. **Nenhum comando de shell é executado** em
   `missions.rs`, `permissions.rs` ou `approvals.rs`
   nesta PR.
10. **Nenhuma operação Git de escrita** nesta PR (a
    política classifica `git-write`, `commit`, `push`
    como `deny`; mesmo se um projeto alterar a política
    para `allow`, o Mission Engine não chama `git
    commit` / `git push` / `git checkout` / `git reset`).
11. **Nenhuma aprovação duplicada** sem necessidade: o
    `permissions_check` cria uma `ExecutionApproval` nova
    cada vez que é invocado (a UI pode dedupar por
    `missionId` + `action` se quiser).
12. **`autopilotEnabled: false` bloqueia
    `piloto-automatico`**: o modo é degradado
    silenciosamente para `propositivo` e o evento
    `mission/phase` registra o fallback.
13. **Cancelamento de missões `running` é noop**: como as
    missões são síncronas nesta PR, o
    `scheduler_cancel_job` marca o `MissionJob` como
    `cancelled` mas a missão em andamento continua até o
    fim. PR futura pode adicionar cancelamento real.
14. **Permissões desconhecidas são rejeitadas**:
    `validate_action` retorna `Err` se a ação não estiver
    na lista canônica.
15. **Decisões inválidas são rejeitadas**:
    `validate_decision` aceita apenas `allow`, `ask` ou
    `deny`.
16. **`permissions.check` fail-closed**: se o backend
    falhar (em runtime Tauri), o `desktopBridge` devolve
    `deny` com a mensagem de erro como `reason` — nunca
    prossegue silenciosamente com `allow`.

## 23. O que ainda permanece mockado

- `workflows.approveFinal` / `rejectFinal` — sem
  aprovação final real nesta PR (patch não aplicado).
- `git.changedFiles(workflowRunId)` /
  `git.fileDiff(workflowRunId)` — dependem de workflow
  engine que altere arquivos (PR 010).
- `commands.*` — sem `CommandRun` real.
- `events.onWorkflowEvent` / `onJobUpdated` /
  `onApprovalChange` / `onOpenCodeStdout/Stderr/JsonEvent`
  — alimentados pelos simuladores do mock. A UI atual faz
  polling de `events.list` a cada 2s, que agora delega
  para `missions_list_logs` (PR 008) e reflete logs reais
  do Mission Engine. Os listeners legados continuam
  silenciosos em runtime Tauri, mas a UI não quebra.
- `opencode.controlledExecution.*` — stub.
- `whisper.*` / `whisperLocal.*` — mock (bundle e
  download).
- `voice.saveAudio*` / `getAudioPath` / `cleanupOldAudio`
  / `getAudioStorageStats` / `openAudioFolder` — mock
  (sem persistência de áudio em disco).
- `models.updateAgentModel` — mock.
- `env.get/has` — mock.

A próxima PR (PR 010) vai começar a atacar
`git.changedFiles` / `git.fileDiff` e a aplicação
controlada de patch/diff.

## 24. Como validar manualmente

### 24.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.permissions.ping()` deve devolver ISO
  8601 (mock).
- `window.fluxora.permissions.getProjectPolicy("qualquer")`
  deve devolver a política default conservadora (mock).
- `window.fluxora.permissions.check({ projectId: "x",
  action: "read-files" })` deve devolver
  `{ allowed: true, decision: "allow", ... }` (mock).
- `window.fluxora.scheduler.listJobs()` deve devolver `[]`
  (mock).
- `window.fluxora.approvals.list()` deve continuar
  devolvendo os approvals do mock legado — sem mudança
  de comportamento.
- `window.fluxora.workflows.list()` deve continuar
  devolvendo os workflows do mock legado.

### 24.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Logs esperados no startup:

```
[fluxora missions] carregadas 0 missão(ões) e 0 log(s)
[fluxora permissions] carregadas 0 política(s)
[fluxora approvals] carregadas 0 aprovação(ões)
```

Sem UI específica para permissões nesta PR, a validação
é pelo console do DevTools:

```js
// 1) Listar projects
const projects = await window.fluxora.projects.list();
// → [{ id: "proj-...", name: "...", path: "..." }, ...]

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

// 4) Ler a política default do primeiro projeto
const policy = await window.fluxora.permissions.getProjectPolicy(
  projects[0].id
);
// → { defaultMode: "propositivo", autopilotEnabled: false,
//     permissions: { "read-files": "allow", ..., "push": "deny" }, ... }

// 5) Atualizar a política para ativar piloto automático
await window.fluxora.permissions.updateProjectPolicy(projects[0].id, {
  defaultMode: "piloto-automatico",
  autopilotEnabled: true,
  permissions: {
    ...policy.permissions,
    "read-files": "allow",
    "git-read": "allow",
    "network-provider": "allow",
    "write-files": "ask",
    "apply-patch": "ask",
    "run-commands": "ask",
    "delete-files": "deny",
    "push": "deny",
  },
});

// 6) Criar + executar missão em modo piloto automático
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "piloto-automatico",
  prompt: "Analise este projeto e diga o que você faria para melhorar a arquitetura.",
});
// → { id: "mission-...", status: "completed", resultText: "...",
//     mode: "piloto-automatico" (ou "propositivo" se fallback),
//     ... }

// 7) Listar jobs (convertido de MissionJob → BackgroundWorkflowJob)
const jobs = await window.fluxora.workflows.listJobs();
// → [{ id: "job-...", workflowRunId: "mission-...",
//      strategy: "controlled_execution", status: "completed" }, ...]

// 8) Listar aprovações (convertido de ExecutionApproval → Approval)
const approvals = await window.fluxora.approvals.list();
// → [] (porque read-files e network-provider são allow por default)

// 9) Verificar eventos
const recent = await window.fluxora.events.listRecent({ limit: 50 });
// → inclui mission/started, mission/phase (com payload.permission),
//    permission/check, permission/allowed,
//    mission/job-created, mission/job-started, mission/job-completed, ...

// 10) Verificar persistência
// Linux:
//   cat ~/.local/share/com.fluxora/fluxora/permissions.json
//   cat ~/.local/share/com.fluxora/fluxora/approvals.json
//   cat ~/.local/share/com.fluxora/fluxora/missions.json
```

### 24.3 Health-check dos novos engines

Em runtime Tauri:

- `permissions_ping` devolve o ISO 8601 atual.
- `approvals_ping` devolve o ISO 8601 atual.
- `scheduler_ping` devolve o ISO 8601 atual.

### 24.4 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 33 testes passando (5 voice + 6 missions + 11 providers + 3 approvals + 8 permissions)
```

## 25. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/assets/index-*.js` 823.00 KiB / 227.38 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 33/33 testes passando (5 voice + 6 missions + 11 providers + 3 approvals + 8 permissions) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 90s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~0.4s (rebuild incremental) → binário `target/debug/fluxora` inicia. Logs do Mission Engine, Permissions Engine e Approvals Engine: carregadas 0 missão(ões), 0 política(s), 0 aprovação(ões). Nenhum loop, nenhum erro de runtime. |

## 26. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004, 005, 006, 007 e 008. **Nenhuma
regressão** de teste. **14 novos testes Rust** passando
(3 approvals + 8 permissions + 3 missions para
`scheduler_*/job helpers` — na verdade, 11 testes novos
somando: 8 permissions + 3 approvals).

Build de produção sem warnings novos.

## 27. Erros conhecidos

### 27.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral.
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual.

### 27.2 Limitações desta PR

- **`permissions.json` e `approvals.json` são criados no
  primeiro uso** — até lá, o estado em memória começa
  vazio.
- **`MissionJob` não é persistido em disco** — restart do
  app reinicia o estado de jobs. A `MissionRun`
  correspondente em `missions.json` carrega o estado
  durável (status, modo, fases, etc.). PR futura pode
  adicionar persistência de jobs.
- **Missões `running` não podem ser canceladas** — o
  `scheduler_cancel_job` marca o `MissionJob` como
  `cancelled`, mas a missão em si continua até o fim
  (síncrona). PR futura pode adicionar cancelamento real
  com interrupção de I/O.
- **Aprovações `ask` não disparam retomada automática da
  missão** — o Mission Engine falha a missão com erro
  claro e a aprovação fica pendente. O usuário pode
  aprovar via UI (em PR futura, o Mission Engine pode
  reagir a `approval/approved` e retomar a missão).
- **`workflows.approveFinal` / `rejectFinal` continuam
  mock** — sem patch aplicado, não há aprovação final
  real.
- **`git.changedFiles(workflowRunId)` /
  `git.fileDiff(workflowRunId)` continuam mock** — dependem
  de workflow engine que altere arquivos (PR 010).
- **Sem UI dedicada para permissões/aprovações/provedores**
  — a configuração é via console do DevTools
  (`window.fluxora.permissions.updateProjectPolicy(...)`)
  ou via `desktopBridge`. PR futura pode adicionar uma
  tela dedicada.
- **Sem cap de jobs em memória** — o `MissionJobsState` é
  um `Mutex<Vec>` sem limite. Em uso intenso pode crescer.
  PR futura pode adicionar rotação.
- **Sem retry automático** — falhas de rede retornam erro
  imediatamente; o usuário precisa rerun.
- **Sem streaming de provider** — `execute_mission_chat`
  é uma chamada simples. `MissionChatResult` não tem
  chunks incrementais.
- **Sem tool calling** — só `messages` com `role` /
  `content`.
- **Storage seguro de API keys não implementado** (chave
  pode ficar em `providers.json` em claro se o usuário
  digitar a chave literal em vez de env var) — fora do
  escopo da PR 009.

### 27.3 Caveats

- O `permissions_check` cria uma `ExecutionApproval`
  **sempre** que a decisão é `ask`. Em uso intenso, isso
  pode inflar `approvals.json`. PR futura pode dedupar
  por `(projectId, missionId, action)`.
- O `toLegacyApproval` mapeia `expired` e `cancelled`
  para `rejected` na forma `Approval` legado. A UI que
  consome `Approval.status` não diferencia os três — o
  contexto vem do `ExecutionApproval` (canônico novo)
  exposto via `approvals.listActionable` em runtime Tauri
  (a UI pode ler o JSON cru se precisar).
- O `toLegacyJob` mapeia `mode: "piloto-automatico"`
  para `strategy: "controlled_execution"`. Outros modos
  viram `strategy: "single"`. A UI que diferencia
  estratégia pode precisar de adaptação em PR futura.
- O `MissionJob.error` é truncado em 500 chars pelo
  `truncate_error` do Mission Engine. Mensagens longas
  ficam com `…` no final.
- O `permissions_check` é síncrono. Se uma checagem
  precisar de I/O externo (ex.: validar certificado), o
  `missions_run` pode ficar lento. PR futura pode
  adicionar cache de decisões.

## 28. Próximas PRs recomendadas

1. **PR 010 — Apply patch/diff controlado.** Permite
   que missões proponham alterações e a UI mostre diff
   real antes de aplicar. Implementa
   `git.changedFiles(workflowRunId)` /
   `git.fileDiff(workflowRunId)` reais (parser
   `git diff --numstat` para `additions` /
   `deletions`). Adiciona `apply-patch` real ao Mission
   Engine, respeitando a política do projeto.
2. **PR 011 — Agentes reais e steps detalhados.**
   Substitui os steps sintéticos de `buildSyntheticSteps`
   por steps reais (Planner com chain-of-thought,
   Developer com execução de patches, QA com testes).
   Persiste `AgentStepOutput` em JSON (talvez um arquivo
   separado `agent_steps.json`).
3. **PR 012 — Streaming de providers.** SSE / WebSocket
   sobre OpenAI-compatible streaming. Substitui
   `providers_chat_once` por `providers_chat_stream` com
   callback de chunks. Mission Engine emite
   `mission/phase` com `payload.chunk` incremental.
4. **PR futura — Tool calling.** Adiciona suporte a
   `tools` no `chatOnce` e `listModels` para descobrir
   quais ferramentas cada modelo suporta.
5. **PR futura — Adapters dedicados.** Anthropic
   (`x-api-key` + `anthropic-version`), Gemini
   (`key=...` na URL), Mistral / DeepSeek / MiniMax
   (variações OpenAI-compat).
6. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers e voice) para um storage
   encriptado (keychain do SO,
   `tauri-plugin-stronghold`).
7. **PR futura — UI dedicada de missões/permissões.**
   Tela dedicada para listar missões, ver resultado,
   rerun, configurar policy por projeto, e configurar
   provider/modelo por missão. Por enquanto, console do
   DevTools é a forma canônica.
8. **PR futura — Persistência de eventos.** Mover o
   ring buffer de eventos do `AppEventsState` para
   SQLite/JSON, com paginação e rotação por idade.
9. **PR futura — Marketplace de providers.** Catálogo
   pré-configurado de providers conhecidos (OpenAI, Groq,
   OpenRouter, etc.) que o usuário pode adicionar com um
   clique.
10. **PR futura — Cancelamento real de missões.** Adicionar
    suporte a cancelamento de missões `running` (com
    interrupção de I/O e cleanup de estado). Persistir
    `MissionJob` em arquivo separado.
11. **PR futura — Aprovações retomam missões.** Quando
    uma `ExecutionApproval` pendente for aprovada, o
    Mission Engine reage ao evento `approval/approved` e
    retoma a missão pausada.

Esta PR não iniciou nenhuma delas.

## 29. Resumo executivo

- ✅ Permissions Engine criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/permissions.rs`) com
  6 comandos Tauri, persistência em
  `<app_data_dir>/fluxora/permissions.json`, 8 testes
  unitários e 4 eventos `permission/*` no barramento.
- ✅ Approvals Engine criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/approvals.rs`) com
  8 comandos Tauri, persistência em
  `<app_data_dir>/fluxora/approvals.json`, 3 testes
  unitários e 4 eventos `approval/*` no barramento.
- ✅ Scheduler/fila mínima adicionado em
  `apps/desktop/src-tauri/src/missions.rs` com
  `MissionJobRecord`, `MissionJobsState`, 4 comandos
  Tauri, 5 eventos `mission/job-*` no barramento e
  proteção contra execuções simultâneas da mesma
  missão.
- ✅ Mission Engine (PR 008) integrado ao Permissions
  Engine: `missions_run` consulta `read-files` e
  `network-provider` antes da coleta de contexto e do
  provider call, com fallback de modo
  `piloto-automatico` → `propositivo` quando
  `autopilotEnabled: false`.
- ✅ `desktopBridge` sobrescreve `approvals.*`,
  `workflows.listJobs/getJob/cancelJob` em runtime
  Tauri (convertendo `ExecutionApproval` → `Approval` e
  `MissionJob` → `BackgroundWorkflowJob`) e adiciona os
  namespaces canônicos novos `permissions.*` e
  `scheduler.*`.
- ✅ UI preservada — nenhum componente React alterado.
  A UI atual continua consumindo
  `window.fluxora.approvals.*` e
  `window.fluxora.workflows.*` exatamente como antes.
- ✅ 14 novos testes Rust (3 approvals + 8 permissions
  + 3 missions) — 33 totais, todos passando.
- ✅ 18 novos comandos Tauri registrados no
  `invoke_handler` do `lib.rs`.
- ✅ Defaults conservadores: `read-files`/`git-read`/
  `network-provider` → `allow`; `write-files`/
  `create-files`/`move-files`/`run-commands`/
  `install-dependencies`/`apply-patch` → `ask`;
  `delete-files`/`git-write`/`commit`/`push` →
  `deny`. `autopilotEnabled: false` por padrão.
- ✅ Nenhum arquivo de projeto é alterado (read-only
  estrito).
- ✅ Nenhum comando shell é executado.
- ✅ Nenhuma operação Git de escrita.
- ✅ Nenhuma referência a Electron reintroduzida.
- ✅ Nenhuma chamada a OpenCode como motor.
- ✅ API keys nunca aparecem em eventos
  `permission/*` / `approval/*` / `mission/job-*`.
- ✅ `pnpm dev` continua abrindo o Tauri sem loop, com
  logs esperados dos três engines.
- ✅ Documentação organizada em
  `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_009_AUTOPILOT_PERMISSIONS.md`
  (este documento).
- ✅ Commit local criado em
  `feature/pr-009-autopilot-permissions` (sem push
  remoto).
- ✅ Nenhuma feature fora de escopo (sem patch real,
  sem commit/push real, sem tool calling, sem
  streaming, sem storage seguro de secrets).
