# STATUS_MIGRATION_TAURI_PR_010_PATCH_DIFF

## 1. Objetivo da PR 010

Adicionar a **base de aplicação controlada de patch/diff** do
Fluxora. Esta PR entrega a infraestrutura que permite que
missões proponham alterações em formato estruturado
(`fluxora_patch` na resposta do provider), salvem essas
propostas, exijam aprovação explícita quando a política do
projeto exigir, e apliquem os arquivos no diretório do projeto
de forma atômica, validada e rastreável.

Concretamente:

- **Patch Engine** próprio em Rust/Tauri (`patches.rs`) com
  persistência local em `<app_data_dir>/fluxora/patches.json`.
- **Parser `fluxora_patch`** na resposta do provider — extrai
  bloco markdown estruturado, valida JSON/paths/limites, e
  cria uma `PatchProposal` automaticamente quando a resposta
  do provider incluir um bloco válido.
- **Aplicação segura de patch** respeitando a política do
  projeto: `apply-patch` / `write-files` / `create-files` /
  `delete-files` devem ser `allow` ou ter uma
  `ExecutionApproval` aprovada.
- **Integração com Approvals Engine** (PR 009): quando a
  política tem `ask` para ações de escrita, criar uma
  `ExecutionApproval` (action: `apply-patch`) e vincular o
  `proposalId` à aprovação. Aprovar a aprovação dispara a
  aplicação automaticamente.
- **`git.changedFiles(workflowRunId)` e
  `git.fileDiff(workflowRunId, filePath)` reais** em runtime
  Tauri — convertem `PatchFileChange[]` para as formas
  legadas `ChangedFile` / `FileDiff` consumidas pela UI
  (Diff Viewer da `ExecutionDetailPage` / `EventLog`).
- **Eventos `patch/*`** no barramento `fluxora-event` (PR 005)
  para cada etapa do ciclo de vida.
- **Compatibilidade com UI atual** via `desktopBridge` —
  nenhum componente React alterado; o `desktopBridge` faz a
  ponte para os comandos `patches_*` reais.

**Esta PR ainda NÃO faz commit, push, checkout, reset, merge,
rebase, branch, tag, stash, ou qualquer Git write operation.**
A aplicação é estritamente local ao diretório do projeto,
validada contra a política do projeto, e registrada em
eventos `patch/*`. Sem shell commands, sem tool calling, sem
streaming, sem storage seguro de secrets.

## 2. Estado herdado da PR 009

- Repositório Git local em
  `feature/pr-010-controlled-patch-diff` (criado a partir de
  `feature/pr-009-autopilot-permissions`).
- `pnpm dev` na raiz abrindo o app desktop Tauri.
- `projects.*` / `git.*` / `filesystem.*` / `app.*` reais em
  Rust (PR 002, PR 003).
- Barramento real `fluxora-event` (PR 005) com ring buffer
  200 e canal único.
- `voice.*` / `whisper.*` real em Rust (PR 006).
- Provider Engine próprio (PR 007) com adapter
  OpenAI-compatible, persistência em `providers.json`,
  eventos `provider/*` e comandos `providers_*`.
- Mission Engine (PR 008) com persistência em `missions.json`,
  8 comandos `missions_*`, eventos `mission/*` e integração
  com o Provider Engine via `providers::execute_mission_chat`.
- Piloto automático com permissões por projeto, Approvals
  Engine, scheduler/fila mínima e Permissões (PR 009):
  - `permissions.rs` com 6 comandos `permissions_*` e 4
    eventos `permission/*`.
  - `approvals.rs` com 8 comandos `approvals_*` e 4 eventos
    `approval/*`.
  - `MissionJobsState` em memória, 4 comandos `scheduler_*` e
    5 eventos `mission/job-*`.
  - `missions_run` checa `read-files` e `network-provider`
    antes da coleta de contexto e do provider call.
- `desktopBridge` (PR 009) centralizando `invoke()` e
  expondo `window.fluxora.*` com namespaces canônicos novos
  (`permissions.*`, `scheduler.*`) e overrides em runtime
  Tauri (`approvals.*`, `workflows.listJobs/getJob/cancelJob`).
- O domínio `git.changedFiles(workflowRunId)` /
  `git.fileDiff(workflowRunId, filePath)` ainda era 100%
  mock (em `mock-api.ts`) — dependia de workflow engine que
  alterasse arquivos.
- `workflows.approveFinal` / `workflows.rejectFinal`
  continuavam mock (sem patch aplicado).
- UI atual consome `ChangedFile[]` / `FileDiff | null` via
  `EventLog` (Diff Viewer) e `ChangedFilesSection` em
  `ExecutionDetailPage`. Aprova/Rejeita via botões na
  `ExecutionDetailPage` chamando `workflows.approveFinal(workflowRunId)`
  / `rejectFinal(workflowRunId, note?)`.

## 3. Como patch/diff funcionava antes

### 3.1 `git.changedFiles(workflowRunId)` no mock

`apps/desktop/src/api/mock-api.ts` (linhas 1208-1213) expunha:

```ts
changedFiles: async (workflowRunId: string) => {
  return changedFilesByWorkflow.get(workflowRunId) || [];
},
fileDiff: async (workflowRunId: string, filePath: string) => {
  const list = fileDiffsByWorkflow.get(workflowRunId) || [];
  return list.find((d) => d.filePath === filePath) || null;
},
```

Os mapas `changedFilesByWorkflow` / `fileDiffsByWorkflow` eram
populados em memória pelos simuladores
`simulateRealWorkflow` (linhas 221-385) e
`simulateMultiAgentWorkflow` (linhas 388-500), que criavam
3 `ChangedFile` fictícios (Planner / Developer / QA) com
diffs hardcoded.

Em runtime Tauri, o `desktopBridge` **ainda apontava para o
mock** (`...mock.git` com `changedFiles.bind(mock.git)` e
`fileDiff.bind(mock.git)`) — sem sobrescrita. Não havia
persistência; fechar o app perdia as mudanças.

### 3.2 `workflows.approveFinal` / `rejectFinal` no mock

Mock (`mock-api.ts` linhas 731-761) transicionava o `WorkflowRun`
para `completed` / `rejected` e a `Approval` para
`approved` / `rejected`, mas **sem patch aplicado** — o
status final da "aprovação" era apenas cosmético.

### 3.3 Quem ouve os eventos hoje

A UI consumia `git.changedFiles(workflowRunId)` e
`git.fileDiff(workflowRunId, filePath)` no `useEffect` do
`EventLog` (linhas 148-160) e da `ChangedFilesSection`
(linhas 550-561) em `ExecutionDetailPage.tsx`. Os dados
vieram sempre do mock — sem `patch/*` events no
barramento, sem persistência.

## 4. Como funciona agora

### 4.1 Em runtime Tauri

1. **Patch Engine** (`apps/desktop/src-tauri/src/patches.rs`):
   - Mantém `PatchesState` (`Mutex<Vec<PatchProposalRecord>>`)
     registrado via `tauri::Builder::manage`.
   - Carregado no `setup` do Tauri a partir de
     `<app_data_dir>/fluxora/patches.json` (silencioso em
     caso de I/O error). Log:
     `[fluxora patches] carregadas N proposta(s) de patch`.
   - 9 comandos Tauri: `patches_ping` / `patches_list` /
     `patches_get` / `patches_list_by_mission` /
     `patches_create` / `patches_apply` / `patches_reject` /
     `patches_get_changed_files` / `patches_get_file_diff`.
   - Validação rigorosa de paths (rejeita `..`, absolutos,
     drive letters, diretórios proibidos).
   - Limites: 20 arquivos por proposta, 256 KiB por
     `afterContent`, 1 MiB total por proposta, recusa
     binários e UTF-8 inválido.
   - Aplicação atômica (escrita em arquivo temporário +
     `rename`).
   - Snapshot de `beforeContent` para checagem de
     pré-condição durante `patches_apply` em operações
     `modify`.
   - 12 testes unitários (path safety, validação de
     arquivos, additions/deletions, operações).

2. **Parser `fluxora_patch`** em `missions.rs`:
   - Função `extract_fluxora_patch_block(text)` extrai
     bloco `\`\`\`fluxora_patch ... \`\`\`` da resposta do
     provider, devolve `(cleaned_text, raw_json, files,
     title, summary)`.
   - O system prompt do Mission Engine agora instrui o
     provider a incluir o bloco opcionalmente:
     ```text
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
   - Após a chamada do provider, se um bloco válido for
     encontrado, o Mission Engine chama
     `patches::create_proposal_from_provider_text` que:
     1. Valida paths, operações, tamanhos.
     2. Tira snapshot de `beforeContent` para `modify` /
        `delete` (lê o arquivo do projeto).
     3. Calcula `additions` / `deletions` via LCS.
     4. Cria a `PatchProposal`.
     5. Verifica a política do projeto:
        - Se `deny` em qualquer ação → marca como `failed`.
        - Se `ask` em qualquer ação → cria
          `ExecutionApproval` (action: `apply-patch`) e
          vincula `approvalId` à proposta (status:
          `pending_approval`).
        - Se `allow` em todas → proposta fica como `draft`
          (pode ser aplicada diretamente).
   - O `resultText` da missão é salvo **sem** o bloco
     `fluxora_patch` (texto humano-legível).

3. **Approvals Engine estendido** (`approvals.rs`):
   - `approvals_approve` foi estendido: quando a aprovação
     é de `apply-patch` e existe `proposalId` no payload,
     dispara `patches::patches_apply` automaticamente após
     marcar a aprovação como `approved`. O resultado é
     comunicado via eventos `patch/*`.
   - `approvals_reject` continua rejeitando normalmente.
   - 8 comandos Tauri preservados.

4. **`git.changedFiles` e `git.fileDiff` reais** em runtime
   Tauri (delegando para `patches_get_changed_files` e
   `patches_get_file_diff`):
   - `git.changedFiles(workflowRunId)` busca as
     `PatchProposal` da missão e converte `PatchFileChange[]`
     em `ChangedFile[]` (forma legada consumida pelo Diff
     Viewer).
   - `git.fileDiff(workflowRunId, filePath)` retorna
     `FileDiff` com `diff` unificado, `additions` /
     `deletions` calculados, e `status` (`added` /
     `modified` / `deleted`).
   - Propostas com status `draft` / `rejected` / `failed`
     não aparecem no diff viewer.

5. **Eventos `patch/*`** (10 tipos) no canal
   `fluxora-event`:
   - `patch/proposal-created` (info)
   - `patch/proposal-invalid` (warn)
   - `patch/approval-required` (warn)
   - `patch/approved` (info) — quando `patches_apply` é
     invocado (transição intermediária)
   - `patch/rejected` (warn)
   - `patch/apply-started` (info)
   - `patch/file-applied` (info) — um por arquivo
   - `patch/apply-completed` (info)
   - `patch/apply-failed` (error)
   - `diff/generated` (info) — quando `patches_get_*` é
     chamado

### 4.2 Fora do runtime Tauri (browser/Vite dev)

- `mock-api.ts` ganhou namespace `patches` com stubs
  simples: `ping` devolve ISO 8601, `list`/`get`/
  `listByMission`/`getChangedFiles`/`getFileDiff` devolvem
  `[]` / `null`, e `create`/`apply`/`reject` lançam erro
  com mensagem clara ("Patch Engine só funciona em runtime
  Tauri").
- `git.changedFiles` / `git.fileDiff` continuam no mock
  legado (preservam o comportamento da UI no navegador).
- `workflows.approveFinal` / `rejectFinal` continuam no
  mock legado.

### 4.3 Quem ouve os eventos `patch/*`

- `desktopBridge` (PR 005) continua despachando para todos
  os subscribers locais.
- `window.fluxora.events.on("patch/approval-required", cb)` /
  `events.on("patch/file-applied", cb)` / etc. estão
  disponíveis para componentes novos.
- A UI atual não precisa assinar `patch/*` diretamente — o
  `git.changedFiles(workflowRunId)` e `git.fileDiff(workflowRunId, filePath)`
  passam a retornar dados reais do Patch Engine em runtime
  Tauri, e o polling de 2s no `EventLog` mostra o diff real
  sem alteração de componente.

## 5. Métodos `patches.*` (canônico novo)

| Método | Status na PR 010 |
|---|---|
| `patches.ping` | **real** (Tauri `patches_ping`), mock devolve ISO 8601 |
| `patches.list` | **real** (Tauri `patches_list`), mock devolve `[]` |
| `patches.get` | **real** (Tauri `patches_get`), mock devolve `null` |
| `patches.listByMission` | **real** (Tauri `patches_list_by_mission`), mock devolve `[]` |
| `patches.create` | **real** (Tauri `patches_create`), mock lança erro "só em runtime Tauri" |
| `patches.apply` | **real** (Tauri `patches_apply`), mock lança erro |
| `patches.reject` | **real** (Tauri `patches_reject`), mock lança erro |
| `patches.getChangedFiles` | **real** (Tauri `patches_get_changed_files`), mock devolve `[]` |
| `patches.getFileDiff` | **real** (Tauri `patches_get_file_diff`), mock devolve `null` |

## 6. Métodos legados adaptados em runtime Tauri (PR 010)

| Método | Status na PR 010 |
|---|---|
| `git.changedFiles(workflowRunId)` | **real** (delega para `patches_get_changed_files`), mock legado fora do Tauri |
| `git.fileDiff(workflowRunId, filePath)` | **real** (delega para `patches_get_file_diff`), mock legado fora do Tauri |
| `workflows.approveFinal(id)` | **real** (busca `ExecutionApproval` vinculada à missão e chama `approvals.approve`; o backend dispara `patches_apply` automaticamente se for `apply-patch`), mock legado fora do Tauri |
| `workflows.rejectFinal(id, note?)` | **real** (busca `ExecutionApproval` vinculada à missão e chama `approvals.reject`; rejeita também a `PatchProposal` vinculada), mock legado fora do Tauri |

## 7. Métodos legados preservados / inalterados

| Método | Status |
|---|---|
| `missions.*` | real (PR 008) + integração com Patch Engine (PR 010) |
| `events.subscribe/on/listRecent/emitDiagnostic/clearRecent` | inalterados (PR 005) |
| `events.list(workflowRunId)` | `missions_list_logs` + converte (PR 008) |
| `voice.*` | inalterados (PR 006) |
| `approvals.*` (legado) | migrado em PR 009, estendido em PR 010 (`approvals_approve` dispara `patches_apply`) |
| `permissions.*` | inalterados (PR 009) |
| `scheduler.*` | inalterados (PR 009) |
| `git.inspect` / `git.diff` | inalterados (PR 003) |
| `projects.*` / `filesystem.*` | inalterados (PR 002, PR 003) |
| `commands.*` | mock legado |
| `agents.*` / `models.*` | mock legado |
| `opencode.*` / `providers.*` | inalterados (PR 007) |

A UI continua consumindo `window.fluxora.git.*`,
`window.fluxora.workflows.*` e `window.fluxora.approvals.*`
exatamente como antes — o `desktopBridge` faz a adaptação.

## 8. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type PatchOperation = "create" | "modify" | "delete";

export type PatchProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

export interface PatchFileChange {
  path: string;
  operation: PatchOperation;
  beforeContent?: string;
  afterContent?: string;
  unifiedDiff?: string;
  additions?: number;
  deletions?: number;
  isNewFile?: boolean;
  isDeletedFile?: boolean;
}

export interface PatchProposal {
  id: string;
  missionId: string;
  projectId: string;
  status: PatchProposalStatus;
  title: string;
  summary?: string;
  files: PatchFileChange[];
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  error?: string;
}

export interface CreatePatchProposalInput {
  missionId: string;
  projectId: string;
  title: string;
  summary?: string;
  files: PatchFileChange[];
}

export interface ApplyPatchInput {
  proposalId: string;
  approvalId?: string;
}
```

Adicionado em `FluxoraAPI`:

```ts
patches: {
  ping(): Promise<string>;
  list(): Promise<PatchProposal[]>;
  get(proposalId: string): Promise<PatchProposal | null>;
  listByMission(missionId: string): Promise<PatchProposal[]>;
  create(input: CreatePatchProposalInput): Promise<PatchProposal>;
  apply(input: ApplyPatchInput): Promise<PatchProposal>;
  reject(proposalId: string, note?: string): Promise<PatchProposal>;
  getChangedFiles(workflowRunId: string): Promise<ChangedFile[]>;
  getFileDiff(workflowRunId: string, filePath: string): Promise<FileDiff | null>;
};
```

Comentários atualizados em `workflows.approveFinal` /
`workflows.rejectFinal` (linhas 2127-2143) para indicar que
são reais em runtime Tauri na PR 010.

Tipos legados `ChangedFile` / `FileDiff` / `Approval` /
`WorkflowRun` / `WorkflowRunDetail` / `ExecutionApproval` /
`ProjectExecutionPolicy` / `MissionRun` / `MissionLog` /
`PermissionCheckResult` / `MissionJob` **preservados
intactos** — a UI que os consome não muda.

## 9. Backend Rust criado/alterado

### 9.1 Criado

- `apps/desktop/src-tauri/src/patches.rs` — **novo**, ~1500
  linhas:
  - `PatchFileChangeRecord`, `PatchProposalRecord`,
    `PatchOperation`, `PatchProposalStatus` (com
    `serde(rename_all = "lowercase")` e
    `serde(rename_all = "snake_case")` para casar com o TS).
  - `PatchesState` (Mutex<Vec<PatchProposalRecord>>).
  - `PatchesFile` (struct versionada para JSON).
  - `patches_file_path` / `ensure_patches_dir` /
    `load_patches_on_startup` / `persist`.
  - Constantes de limites: `MAX_FILES_PER_PROPOSAL=20`,
    `MAX_AFTER_CONTENT_BYTES=256 KiB`,
    `MAX_TOTAL_AFTER_CONTENT_BYTES=1 MiB`,
    `MAX_DIFF_LINES=20_000`.
  - `FORBIDDEN_DIR_NAMES` (12 diretórios proibidos:
    `node_modules`, `.git`, `vendor`, `dist`, `build`,
    `.next`, `target`, `.cache`, `.turbo`,
    `.parcel-cache`, `.venv`, `venv`, `__pycache__`, `out`).
  - `is_safe_path` (rejeita `..`, absolutos, drive letters,
    diretórios proibidos; normaliza separadores).
  - `resolve_under_project` (canonical-path check).
  - `compute_additions_deletions` (LCS com cap de
    segurança).
  - `generate_unified_diff` (estilo `git diff`, simplificado).
  - `write_atomic` (escrita em temp + rename).
  - `validate_proposal_files` (paths, operações, limites).
  - `find_proposal` / `find_proposals_by_mission` /
    `upsert_proposal` / `update_proposal`.
  - `emit_patch_event` (helper de evento `patch/*` no
    barramento `fluxora-event`).
  - 9 comandos Tauri.
  - 10 tipos de evento `patch/*` (mais `diff/generated`).
  - Helper público `create_proposal_from_provider_text`
    usado pelo Mission Engine.
  - 12 testes unitários (`safe_path_*`, `operation_parsing`,
    `additions_deletions_*`, `validate_files_*`).

### 9.2 Alterado

- `apps/desktop/src-tauri/src/missions.rs`:
  - `use crate::patches;` adicionado.
  - `build_mission_prompt` estendido: system prompt agora
    instrui o provider a incluir opcionalmente um bloco
    `fluxora_patch` no formato JSON especificado (com
    regras de paths, operações e tamanhos).
  - `extract_fluxora_patch_block(text)` (parser do bloco
    markdown) — limpa o texto, extrai o JSON, parseia os
    campos `title` / `summary` / `files`, e devolve
    `FluxoraPatchExtract` com os campos já tipados.
  - `missions_run` foi estendido (após a chamada do
    provider):
    1. Extrai o bloco `fluxora_patch` da resposta.
    2. Se válido, chama
       `patches::create_proposal_from_provider_text`.
    3. Registra `mission/phase` com `phase:
       "patch-detected" | "patch-pending-approval" |
       "patch-applied" | "patch-failed" | "patch-skipped"`
       e payload com `proposalId` / `status` / `filesCount`
       / `approvalId`.
    4. Salva `resultText` (sem o bloco) na missão.

- `apps/desktop/src-tauri/src/approvals.rs`:
  - `approvals_approve` foi estendido: quando a aprovação é
    de `apply-patch` e existe `proposalId` no payload,
    dispara `patches::patches_apply` automaticamente após
    marcar a aprovação como `approved`. Em caso de falha na
    aplicação, a aprovação continua como `approved` (o erro
    é registrado nos eventos `patch/*`).

- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod patches;` adicionado.
  - `use patches::{PatchFileChangeRecord, PatchProposalRecord};`.
  - `use serde::{Deserialize, Serialize};` (já tinha `Serialize`,
    adicionado `Deserialize`).
  - 3 payloads novos: `CreatePatchProposalPayload`,
    `ApplyPatchPayload`, `RejectPatchPayload`.
  - 9 comandos Tauri adicionados ao `invoke_handler`:
    `patches_ping` / `patches_list` / `patches_get` /
    `patches_list_by_mission` / `patches_create` /
    `patches_apply` / `patches_reject` /
    `patches_get_changed_files` / `patches_get_file_diff`.
  - 1 novo `manage(...)` no `Builder`:
    `patches::PatchesState::new()`.
  - 1 nova chamada no `setup`:
    `patches::load_patches_on_startup(&handle)`.

`Cargo.toml` não precisou de dependências novas (apenas
`serde`, `serde_json`, `time`, `tauri` que já estavam
presentes).

## 10. Arquivos frontend alterados

### 10.1 `packages/shared/src/index.ts`

- Adicionados: `PatchOperation`, `PatchProposalStatus`,
  `PatchFileChange`, `PatchProposal`,
  `CreatePatchProposalInput`, `ApplyPatchInput`.
- Adicionado namespace `patches` em `FluxoraAPI` (9
  métodos).
- Comentários atualizados em `workflows.approveFinal` /
  `rejectFinal` e em `workflows.*` (seção do Mission
  Engine).

### 10.2 `apps/desktop/src/api/mock-api.ts`

- Importados os tipos novos: `PatchProposal`,
  `CreatePatchProposalInput`, `ApplyPatchInput`.
- Adicionado namespace `patches` com 9 stubs para fallback
  fora do runtime Tauri (a UI continua funcionando no
  navegador).
- `git.changedFiles` / `git.fileDiff` / `workflows.*` /
  `approvals.*` permanecem inalterados.

### 10.3 `apps/desktop/src/services/desktopBridge.ts`

- Importados os tipos novos: `ApplyPatchInput`,
  `CreatePatchProposalInput`, `PatchProposal`.
- Adicionada seção "Patches (PR 010)" com:
  - 8 helpers de baixo nível: `listPatchesTauri`,
    `getPatchTauri`, `listPatchesByMissionTauri`,
    `createPatchTauri`, `applyPatchTauri`,
    `rejectPatchTauri`, `getChangedFilesPatchesTauri`,
    `getFileDiffPatchesTauri`.
  - 2 helpers `payloadGetProposalId` /
    `payloadHasProposalId` para inspecionar o `payload`
    (`unknown`) de uma `ExecutionApproval` sem cast
    inseguro.
- `createDesktopBridge()`:
  - **Sobrescreve `git.changedFiles(workflowRunId)`** em
    runtime Tauri (delega para `patches_get_changed_files`).
  - **Sobrescreve `git.fileDiff(workflowRunId, filePath)`**
    em runtime Tauri (delega para `patches_get_file_diff`).
  - **Sobrescreve `workflows.approveFinal(id)`** em runtime
    Tauri: localiza a `ExecutionApproval` vinculada à
    missão (via `approvals.listActionable` filtrando
    `missionId === id` ou `payload.proposalId`) e chama
    `approvals.approve`; o backend (PR 010) dispara
    `patches_apply` automaticamente se for `apply-patch`.
  - **Sobrescreve `workflows.rejectFinal(id, note?)`** em
    runtime Tauri: análogo, chama `approvals.reject` e
    também `patches_reject` na proposta vinculada
    (best-effort).
  - Adiciona namespace canônico novo `patches.*` (9
    métodos delegando para Tauri com fallback mock).

### 10.4 Não alterados (UI preservada)

- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/pages/ExecutionDetailPage.tsx`
- `apps/desktop/src/pages/ExecutionsPage.tsx`
- `apps/desktop/src/pages/ApprovalsPage.tsx`
- `apps/desktop/src/components/events/EventLog.tsx`
- `apps/desktop/src/components/diff/DiffViewer.tsx`
- `apps/desktop/src/components/settings/ControlledExecutionPanel.tsx`
- `apps/desktop/src/components/layout/*` (AppShell,
  StatusBar, RightPanel)
- `apps/desktop/src/components/overview/*`
- `apps/desktop/src/components/workflow/*`
- `apps/desktop/src/hooks/*` (useLiveExecutionEvents,
  useActiveRuns, usePendingApprovals, useUsageStats)
- Qualquer outro componente React

A UI atual continua consumindo `ChangedFile[]` /
`FileDiff | null` via `git.changedFiles(workflowRunId)` /
`git.fileDiff(workflowRunId, filePath)` exatamente como
antes — o `desktopBridge` faz a ponte para os comandos
`patches_*` reais.

## 11. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente os namespaces `missions` (PR 008),
`workflows` (adaptado em PR 008-009-010), `permissions`
(PR 009), `scheduler` (PR 009), `approvals` (adaptado em
PR 009, estendido em PR 010), `patches` (PR 010) e os
demais legados (preservados). Em runtime Tauri, todas as
chamadas de `git.changedFiles` / `git.fileDiff` /
`workflows.approveFinal` / `workflows.rejectFinal` passam
pelo backend real; fora do runtime Tauri, o mock legado é
preservado.

### Namespace `git` (PR 010 — adaptado em runtime Tauri)

- `changedFiles(workflowRunId)` → em runtime Tauri, chama
  `patches_get_changed_files` e devolve `ChangedFile[]`
  (forma legada consumida pelo Diff Viewer). Fora, cai no
  mock legado.
- `fileDiff(workflowRunId, filePath)` → em runtime Tauri,
  chama `patches_get_file_diff` e devolve `FileDiff | null`.
  Fora, cai no mock legado.
- `inspect(projectId)` / `diff(projectId, filePath)`:
  inalterados (PR 003).

### Namespace `workflows.approveFinal` / `rejectFinal` (PR 010)

- `approveFinal(id)` → em runtime Tauri:
  1. `listActionableApprovalsTauri()` para encontrar
     aprovações vinculadas à missão (filtra por
     `missionId === id` ou `payload.proposalId`).
  2. Se encontrar, chama `approvals.approve(approvalId)`.
     O backend Rust (PR 010) detecta que a aprovação é de
     `apply-patch` e dispara `patches_apply` automaticamente.
  3. Se não encontrar (missão sem patch), cai no mock
     legado (preserva o comportamento da UI).
  4. Em caso de erro, loga warn e cai no mock.
- `rejectFinal(id, note?)` → análogo, mas chama
  `approvals.reject` e (best-effort) `patches_reject` na
  proposta vinculada.

### Namespace `patches` (PR 010 — canônico novo)

- `ping()` → em runtime Tauri, chama `patches_ping`.
- `list()` → `patches_list`.
- `get(id)` → `patches_get`.
- `listByMission(missionId)` → `patches_list_by_mission`.
- `create(input)` → `patches_create`.
- `apply(input)` → `patches_apply`.
- `reject(id, note?)` → `patches_reject`.
- `getChangedFiles(workflowRunId)` → `patches_get_changed_files`.
- `getFileDiff(workflowRunId, filePath)` → `patches_get_file_diff`.

### Resultado

A UI continua consumindo `window.fluxora.git.*` e
`window.fluxora.workflows.*` exatamente como antes. O
Diff Viewer recebe `ChangedFile[]` e `FileDiff` reais
quando há uma proposta de patch vinculada à missão. Os
botões Aprovar/Rejeitar funcionam via `approvals.approve`
+ `patches_apply` automático do backend.

## 12. Como propostas de patch são persistidas

### 12.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/patches.json`.
- Formato: JSON pretty-printed com chaves em camelCase.
- Versão: `1`.
- Cada proposta tem:
  - `id`, `missionId`, `projectId`
  - `status` (`draft` | `pending_approval` | `approved` |
    `applied` | `rejected` | `failed`)
  - `title`, `summary?`
  - `files: PatchFileChange[]` (com `path`, `operation`,
    `beforeContent?`, `afterContent?`, `unifiedDiff?`,
    `additions?`, `deletions?`, `isNewFile?`,
    `isDeletedFile?`)
  - `approvalId?`
  - `createdAt`, `updatedAt`, `appliedAt?`
  - `error?`
- `load_patches_on_startup` é chamado no `setup` do Tauri.
  Log: `[fluxora patches] carregadas N proposta(s) de patch`.
- `patches_create` / `patches_apply` / `patches_reject`
  persistem em `patches.json` no disco após cada mudança.

### 12.2 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência).

### 12.3 Storage seguro de secrets

- API key do provider **nunca** é registrada em
  `patches.json` (as propostas referenciam paths relativos
  e conteúdo de arquivos do projeto, não chaves).
- API key **nunca** aparece em eventos `patch/*` nem
  `diff/*`. O payload dos eventos inclui apenas
  `proposalId`, `filePath`, `filesCount`, `additions`,
  `deletions`, `status` e `errorMessage` (sanitizado).

## 13. Local do `patches.json`

`<app_data_dir>/fluxora/patches.json`

Onde `app_data_dir` é resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora`, a
localização esperada tende a ser equivalente a:

`~/.local/share/com.fluxora/fluxora/patches.json`

## 14. Como o parser `fluxora_patch` funciona

O Mission Engine (PR 008) agora instrui o provider via
system prompt a incluir **opcionalmente** um bloco
markdown no final da resposta:

```text
```fluxora_patch
{
  "title": "Resumo curto da alteração",
  "summary": "Descrição do que será alterado",
  "files": [
    {
      "path": "caminho/relativo/arquivo.ts",
      "operation": "modify",
      "afterContent": "conteúdo completo final do arquivo"
    }
  ]
}
```
```

Regras (incluídas no prompt):

- Use apenas caminhos RELATIVOS ao projeto (sem `..`, sem
  absolutos).
- Não proponha alterações em `node_modules`, `.git`,
  `vendor`, `dist`, `build`, `target`, `.next`, `.cache`,
  `.turbo`, `out`.
- `operation` deve ser `create`, `modify` ou `delete`.
- Para `create` ou `modify`, envie o conteúdo final
  completo em `afterContent`.
- Para `delete`, use `operation: delete` sem `afterContent`.
- O bloco é **OPCIONAL** — sem ele, a missão segue como
  read-only (igual à PR 008).

Parser (`extract_fluxora_patch_block`):

1. Procura o marker `\`\`\`fluxora_patch` na resposta.
2. Lê até o próximo `\`\`\``.
3. Tenta `serde_json::from_str` no conteúdo.
4. Extrai `title`, `summary`, `files[]`.
5. Para cada arquivo, extrai `path`, `operation`,
   `afterContent`, `beforeContent`, `unifiedDiff`,
   `additions`, `deletions`.
6. Valida que `path` e `operation` estão presentes em cada
   arquivo. Caso contrário, loga warning e pula o arquivo.
7. Devolve `FluxoraPatchExtract { cleaned_text, raw_json,
   files, title, summary }`.

Validação adicional em `validate_proposal_files`:

- `files` não pode ser vazio.
- Máximo 20 arquivos.
- Cada `path` deve passar `is_safe_path` (rejeita `..`,
  absolutos, drive letters, diretórios proibidos).
- `afterContent` ≤ 256 KiB por arquivo.
- Total de `afterContent` ≤ 1 MiB por proposta.
- `create` / `modify` exigem `afterContent` não-vazio.
- Paths duplicados são rejeitados.

## 15. Como permissões são checadas

`patches_apply` chama `permissions::get_or_create_policy` e
verifica cada arquivo conforme sua `operation`:

- `create` → exige `create-files`.
- `modify` → exige `apply-patch` + `write-files`.
- `delete` → exige `delete-files`.

Para cada ação:

- `deny` → erro imediato ("Política do projeto proíbe
  'X' (decisão 'deny') para o arquivo 'Y'"), proposta
  marcada como `failed` se ainda não estava aplicada.
- `ask` → procura `approvalId` (na proposta, ou no input).
  - Se `approval` fornecido/nenhum → erro
    ("Proposta requer aprovação, mas nenhuma aprovação
    foi fornecida").
  - Se `approval.status !== "approved"` → erro.
- `allow` → segue.

Quando a política tem `ask` em pelo menos uma ação, a
proposta fica como `pending_approval` com `approvalId`
vinculado. Aprovar a `ExecutionApproval` (via UI ou
`approvals.approve` no console) dispara `patches_apply`
automaticamente (ver Fase 8).

## 16. Como aprovações são criadas/usadas

Quando o Mission Engine extrai um bloco `fluxora_patch`
válido e a política do projeto tem `ask` em alguma ação
relevante:

1. `create_proposal_from_provider_text` cria a proposta
   (status inicial: `draft`).
2. Verifica a política via `get_or_create_policy`.
3. Para cada `ask`, marca `needs_approval = true`.
4. Se `needs_approval`:
   - Cria `ExecutionApproval` (action: `apply-patch`,
     risk: `high` se houver `delete`, senão `medium`,
     requestedBy: `mission-engine`).
   - O payload inclui `proposalId`, `filesCount` e
     `source: "mission-engine"`.
   - Marca a proposta como `pending_approval` e salva
     `approvalId`.
   - Emite `patch/approval-required` (warn).
5. Se tudo `allow`:
   - Proposta fica como `draft` (pronta para aplicar).
6. Se algo `deny`:
   - Proposta é marcada como `failed` com erro
     explicativo.
   - Emite `patch/proposal-invalid`.

A UI pode aprovar a aprovação via `approvals.approve(id)` ou
pelos botões legados `workflows.approveFinal(workflowRunId)`
/ `approvals.approve(approvalId)`. O backend
(`approvals_approve`) detecta a action `apply-patch` e o
`proposalId` no payload, e dispara `patches_apply`
automaticamente.

## 17. Como aplicação de patch funciona

`patches_apply(proposal_id, approval_id?)`:

1. Carrega a proposta. Rejeita se status é
   `applied` / `rejected` / `failed`.
2. Verifica permissões (ver Fase 15).
3. Resolve o root do projeto via
   `projects::find_project_path`.
4. Emite `patch/apply-started` (info).
5. Transiciona a proposta para `approved`
   (status intermediário).
6. Para cada arquivo, chama `apply_one_file`:
   - `create`:
     - Rejeita se o arquivo já existe.
     - Cria o diretório pai se necessário.
     - `write_atomic` (escrita em temp + rename).
   - `modify`:
     - Rejeita se o arquivo não existe.
     - Se `beforeContent` foi informado, lê o arquivo
       atual e compara. Se diferente, falha com
       "precondição falhou" (proteção contra conflitos).
     - `write_atomic`.
   - `delete`:
     - Se o arquivo não existe, retorna `Ok(())`
       (idempotente).
     - Senão, `fs::remove_file`.
7. Se algum arquivo falhar:
   - Emite `patch/file-applied` para os sucessos.
   - Emite `patch/apply-failed` para o que falhou.
   - Marca a proposta como `failed` com a mensagem de erro
     (truncada em 500 chars).
   - Retorna `Err`.
8. Se tudo der certo:
   - Marca a proposta como `applied`, define `appliedAt`.
   - Emite `patch/apply-completed` com `filesApplied`.

## 18. Como `git.changedFiles` e `git.fileDiff` funcionam agora

### `git.changedFiles(workflowRunId)` em runtime Tauri

Delega para `patches_get_changed_files(workflowRunId)`:

1. Busca todas as `PatchProposal` da missão (via
   `patches_list_by_mission`).
2. Filtra: apenas propostas com status `pending_approval` /
   `approved` / `applied` aparecem no diff viewer (drafts,
   rejeitadas e falhadas ficam ocultas).
3. Para cada arquivo de cada proposta, gera um
   `ChangedFile` legado:
   - `id`: `proposalId::path`
   - `workflowRunId`: idem
   - `projectId`: idem
   - `path`: idem
   - `status`: `added` (create) | `deleted` (delete) |
     `modified` (modify)
   - `additions` / `deletions`: do `PatchFileChange`
     (preenchidos pelo backend durante a criação)
   - `createdAt`: `proposal.createdAt`
4. Emite `diff/generated` (info) com `filesCount`.

### `git.fileDiff(workflowRunId, filePath)` em runtime Tauri

Delega para `patches_get_file_diff(workflowRunId, filePath)`:

1. Busca a primeira `PatchProposal` da missão que tem um
   arquivo com `path === filePath`.
2. Se não encontrar, devolve `null`.
3. Calcula `additions` / `deletions` se ausentes (via
   `compute_additions_deletions` ou contagem direta para
   `create` / `delete`).
4. Gera `unifiedDiff` se ausente (via `generate_unified_diff`
   ou marker simples para `delete`).
5. Devolve `FileDiff` legado:
   - `id`: `proposalId::path`
   - `workflowRunId`, `projectId`, `filePath`
   - `diff`: string com diff unificado
   - `additions`, `deletions`
   - `status`: `added` / `modified` / `deleted`
   - `createdAt`
6. Emite `diff/generated` (info).

## 19. Como eventos `patch/*` são emitidos

Todos via `emit_patch_event` em `patches.rs`, que monta um
`FluxoraEvent` com `source: "patches"`, `projectId`,
`missionId` (opcional), `proposalId` (opcional) e chama
`events::emit_to_app`.

| Tipo | Quando | `level` |
|---|---|---|
| `patch/proposal-created` | `patches_create` ou `create_proposal_from_provider_text` (draft) | `info` |
| `patch/proposal-invalid` | `create_proposal_from_provider_text` quando a política é `deny` | `warn` |
| `patch/approval-required` | `create_proposal_from_provider_text` quando a política é `ask` | `warn` |
| `patch/approved` | `patches_apply` transição intermediária | `info` |
| `patch/rejected` | `patches_reject` | `warn` |
| `patch/apply-started` | Início de `patches_apply` | `info` |
| `patch/file-applied` | Um por arquivo aplicado com sucesso | `info` |
| `patch/apply-completed` | `patches_apply` terminou OK | `info` |
| `patch/apply-failed` | `patches_apply` falhou em qualquer arquivo | `error` |
| `diff/generated` | `patches_get_changed_files` / `patches_get_file_diff` | `info` |

**Nunca inclui**:

- API key (mesmo mascarada).
- Conteúdo completo de arquivos (apenas `additions` /
  `deletions`).
- Path absoluto do projeto (só `projectId`).
- Mensagens longas de erro — truncadas em 500 chars.

**Sempre**:

- `source: "patches"`.
- No canal `fluxora-event` (PR 005).

## 20. Limites de segurança implementados

1. **Path safety rigoroso**:
   - Rejeita paths vazios.
   - Rejeita absolutos (`/...`, `\\...`).
   - Rejeita drive letters (`C:/...`).
   - Rejeita `..` em qualquer segmento.
   - Rejeita paths em diretórios proibidos (12 nomes:
     `node_modules`, `.git`, `vendor`, `dist`, `build`,
     `.next`, `target`, `.cache`, `.turbo`, `.parcel-cache`,
     `.venv`, `venv`, `__pycache__`, `out`).
   - Normaliza separadores para `/`.
2. **Limites de tamanho**:
   - 20 arquivos por proposta.
   - 256 KiB por `afterContent`.
   - 1 MiB total de `afterContent` por proposta.
3. **Path uniqueness**: paths duplicados na mesma proposta
   são rejeitados.
4. **Operações válidas**: `create` / `modify` exigem
   `afterContent` não-vazio; `delete` é idempotente.
5. **Permissões por operação**:
   - `create` → exige `create-files` allow.
   - `modify` → exige `apply-patch` + `write-files` allow.
   - `delete` → exige `delete-files` allow.
6. **Falha fechada em `deny`**: qualquer `deny` em ação
   relevante bloqueia a aplicação inteira.
7. **Aprovação obrigatória em `ask`**: se houver `ask` em
   alguma ação, a proposta requer `approvalId` com status
   `approved`. Aprovação inexistente ou em outro status
   bloqueia a aplicação.
8. **Snapshot de `beforeContent`**: para `modify`, o
   `beforeContent` (informado pelo provider ou tirado do
   disco) é comparado com o arquivo atual antes de
   aplicar. Se mudou, falha com "precondição falhou"
   (proteção contra conflitos).
9. **Aplicação atômica por arquivo**:
   `write_atomic` escreve em `<path>.fluxora-tmp-<pid>` e
   depois `rename` sobre o path final. Em caso de falha no
   rename, o temp é removido e o erro é reportado.
10. **Não criar sobrescrevendo**: `create` rejeita se o
    arquivo já existe.
11. **Delete idempotente**: deletar um arquivo inexistente
    é no-op (não-falha).
12. **Truncamento de erros**: mensagens de erro são
    truncadas em 500 chars.
13. **Sem shell commands**: `patches.rs` não chama
    `std::process::Command`. Não há `Command::new` em
    `patches.rs`.
14. **Sem Git write operations**: a aplicação de patch
    NÃO chama `git commit` / `git push` / `git add` /
    `git checkout` / `git reset` / `git clean` / `git merge`
    / `git rebase` / `git pull`. Não há nenhuma chamada
    shell em `patches.rs`.
15. **Sem tool calling**: o provider não recebe permissão
    para executar tools. Só retorna texto.
16. **Sem follow-symlink**: `is_safe_path` rejeita `..` e
    resolve o path canônico. Symlinks para fora do projeto
    seriam rejeitados pela checagem de componentes (sem
    `..`).
17. **API key nunca em patches**: o `PatchProposalRecord`
    não tem campo para chave, e o `payload` do
    `ExecutionApproval` (criado pelo Patch Engine) também
    não inclui a chave do provider.
18. **Sem push remoto**: zero comandos de rede em
    `patches.rs`.
19. **Não expor conteúdo em eventos**: os eventos
    `patch/*` carregam apenas `proposalId`, `filePath`,
    `filesCount`, `additions` / `deletions`, `status` e
    `errorMessage` (truncado). Nenhum conteúdo de arquivo
    vai para o barramento.

## 21. O que ainda permanece mockado

- `commands.*` — sem `CommandRun` real.
- `events.onWorkflowEvent` / `onJobUpdated` /
  `onApprovalChange` / `onOpenCodeStdout/Stderr/JsonEvent`
  — alimentados pelos simuladores do mock. A UI atual faz
  polling de `events.list` a cada 2s, que delega para
  `missions_list_logs` (PR 008) e reflete logs reais do
  Mission Engine. Os listeners legados continuam
  silenciosos em runtime Tauri, mas a UI não quebra.
- `opencode.controlledExecution.*` — stub.
- `whisper.*` / `whisperLocal.*` — mock (bundle e
  download).
- `voice.saveAudio*` / `getAudioPath` / `cleanupOldAudio`
  / `getAudioStorageStats` / `openAudioFolder` — mock
  (sem persistência de áudio em disco).
- `models.updateAgentModel` — mock.
- `env.get/has` — mock.
- `patches.*` fora do runtime Tauri — stubs com mensagens
  claras (mock).

## 22. Como validar manualmente

### 22.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.patches.ping()` deve devolver ISO 8601
  (mock).
- `window.fluxora.patches.list()` deve devolver `[]` (mock).
- `window.fluxora.patches.get("qualquer")` deve devolver
  `null` (mock).
- `window.fluxora.git.changedFiles("qualquer")` deve
  continuar devolvendo `[]` (mock legado).
- `window.fluxora.workflows.approveFinal("qualquer")` deve
  continuar devolvendo uma `Approval` mock.

### 22.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Logs esperados no startup:

```
[fluxora missions] carregadas 0 missão(ões) e 0 log(s)
[fluxora permissions] carregadas 0 política(s)
[fluxora approvals] carregadas 0 aprovação(ões)
[fluxora patches] carregadas 0 proposta(s) de patch
```

A validação completa é pelo console do DevTools:

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

// 4) Configurar política do projeto (permissões ask)
const policy = await window.fluxora.permissions.getProjectPolicy(
  projects[0].id
);
await window.fluxora.permissions.updateProjectPolicy(projects[0].id, {
  defaultMode: "assistido",
  autopilotEnabled: false,
  permissions: {
    ...policy.permissions,
    "read-files": "allow",
    "network-provider": "allow",
    "apply-patch": "ask",
    "write-files": "ask",
    "create-files": "ask",
    "delete-files": "deny"
  }
});

// 5) Criar + executar missão que propõe patch via bloco
//    fluxora_patch (provider pode ou não incluir o bloco)
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "assistido",
  prompt: "Crie uma pequena melhoria segura no README.md e retorne uma proposta em fluxora_patch."
});

// 6) Listar propostas de patch da missão
const patches = await window.fluxora.patches.listByMission(run.id);
// → [PatchProposal { id, status: "pending_approval" | "draft", ... }]

// 7) Listar changed files (forma legada para o Diff Viewer)
const changed = await window.fluxora.git.changedFiles(run.id);
// → [{ path: "README.md", status: "modified", additions: 3, deletions: 0, ... }]

// 8) Diff de um arquivo
const diff = await window.fluxora.git.fileDiff(run.id, changed[0].path);
// → { filePath, diff: "@@ -1 +1 @@\n-old\n+new\n", additions: 3, deletions: 0, status: "modified" }

// 9) Listar aprovações pendentes
const approvals = await window.fluxora.approvals.listActionable();
// → [Approval { id, action: "apply-patch", risk: "medium", ... }]

// 10) Aprovar (dispara patches_apply automaticamente)
await window.fluxora.approvals.approve(approvals[0].id);
// ou
await window.fluxora.workflows.approveFinal(run.id);

// 11) Verificar que a proposta virou "applied"
const applied = await window.fluxora.patches.get(patches[0].id);
// → { status: "applied", appliedAt: "..." }

// 12) Verificar eventos
const recent = await window.fluxora.events.listRecent({ limit: 100 });
// → inclui patch/approval-required, patch/apply-started,
//    patch/file-applied, patch/apply-completed, diff/generated,
//    approval/approved, mission/phase (patch-pending-approval /
//    patch-applied), ...

// 13) Verificar persistência
// Linux:
//   cat ~/.local/share/com.fluxora/fluxora/patches.json
//   cat ~/.local/share/com.fluxora/fluxora/approvals.json
//   cat ~/.local/share/com.fluxora/fluxora/missions.json
//   cat ~/.local/share/com.fluxora/fluxora/permissions.json
```

### 22.3 Cenários de erro (validação manual)

1. **Política `deny` em `apply-patch`**:
   - Atualizar a política do projeto com
     `"apply-patch": "deny"`.
   - Criar missão com prompt que gere `fluxora_patch`.
   - Esperar: proposta criada com `status: "failed"`,
     `error: "Política do projeto proíbe 'apply-patch'
     (decisão 'deny')..."`, evento `patch/proposal-invalid`.

2. **Política `ask` sem aprovação**:
   - Atualizar com `"apply-patch": "ask"`.
   - Criar missão.
   - Esperar: proposta com `status: "pending_approval"`,
     `approvalId` vinculada, evento `patch/approval-required`.
   - Tentar `patches.apply({ proposalId })` sem
     `approvalId` → erro "Proposta requer aprovação...".

3. **Path inválido**:
   - Criar missão com prompt que gere
     `"path": "../../etc/passwd"` ou
     `"path": "/absolute"` ou
     `"path": "node_modules/foo"`.
   - Esperar: nenhum `PatchProposal` criada; o arquivo
     inválido é pulado pelo parser (`extract_fluxora_patch_block`
     loga warning e o validador rejeita).

4. **Patch aplicado com sucesso**:
   - Configurar `"apply-patch": "ask"`, gerar missão
     que proponha alterar `README.md`.
   - Aprovar via `approvals.approve(approvalId)`.
   - Esperar: `patch/apply-started` → `patch/file-applied`
     → `patch/apply-completed`. O `README.md` é
     modificado. `patches.get` devolve
     `status: "applied"`.

5. **Conflito de `beforeContent`**:
   - Propor `modify` em `README.md` com `beforeContent: "A"`.
   - Modificar `README.md` manualmente antes da aprovação.
   - Esperar: `patches_apply` falha com
     "Arquivo 'README.md' mudou desde a criação da
     proposta (precondição falhou)".

### 22.4 Health-check dos novos engines

Em runtime Tauri:

- `patches_ping` devolve o ISO 8601 atual.
- `events_ping` (do PR 005) devolve o ISO 8601 atual.
- `approvals_ping` devolve o ISO 8601 atual.

### 22.5 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 46 testes passando (5 voice + 11 providers + 8 permissions +
#  3 approvals + 8 missions + 12 patches)
```

## 23. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/assets/index-*.js` 826.71 KiB / 227.96 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 46/46 testes passando (12 novos do patches) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 90s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~14s (build inicial) → binário `target/debug/fluxora` inicia. Logs do Mission Engine, Permissions Engine, Approvals Engine e Patch Engine: carregadas 0 missão(ões), 0 política(s), 0 aprovação(ões), 0 proposta(s) de patch. Nenhum loop, nenhum erro de runtime. |

## 24. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004, 005, 006, 007, 008 e 009. **Nenhuma
regressão** de teste. **12 novos testes Rust** passando
(46 totais). Build de produção sem warnings novos.

## 25. Erros conhecidos

### 25.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral.
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual.

### 25.2 Limitações desta PR

- **`patches.json` é criado no primeiro uso** — até lá, o
  estado em memória começa vazio.
- **`MissionJob` continua não persistido em disco** (PR
  009) — restart do app reinicia o estado de jobs. A
  `MissionRun` correspondente em `missions.json` carrega o
  estado durável.
- **Missões `running` não podem ser canceladas** (PR 009)
  — o `scheduler_cancel_job` marca o `MissionJob` como
  `cancelled`, mas a missão em si continua até o fim.
- **Aprovações `ask` não disparam retomada automática da
  missão** (PR 009) — o Mission Engine falha a missão
  com erro claro. Em runtime Tauri, aprovar via
  `approvals.approve` **dispara `patches_apply`
  automaticamente** (ver Fase 8), mas a missão em si já
  terminou como `completed` na PR 008.
- **Aplicação parcial em caso de erro**: se o segundo
  arquivo de uma proposta de 3 arquivos falhar, o primeiro
  já foi aplicado e o terceiro não é tentado. O backend
  não tenta reverter o primeiro (a reversão fica para PR
  futura que use checkpoints / git stash automático). A
  proposta é marcada como `failed` com a mensagem de erro.
- **`write_atomic` no Windows**: `fs::rename` em Windows
  pode falhar se o destino existir (depende do Rust
  version). Em prática, o Rust stdlib 1.70+ usa
  `MoveFileExW` com `MOVEFILE_REPLACE_EXISTING`, que
  sobrescreve. Em Linux/macOS o rename é atômico.
- **`compute_additions_deletions` por LCS** é O(n*m) — para
  arquivos de 256 KiB, isso pode chegar a ~2k linhas, o que
  é OK. Para arquivos maiores (cap em 1 MiB), o
  `MAX_DIFF_LINES=20_000` previne DoS e cai para um diff
  trivial "tudo adicionado / tudo removido".
- **`generate_unified_diff` simplificado** — não tem
  numeração de hunks completa, não agrupa hunks
  adjacentes. Serve para exibição na UI mas não é 1:1 com
  `git diff`.
- **Sem cap de propostas em memória** — `PatchesState` é
  um `Mutex<Vec>` sem limite. Em uso intenso pode crescer.
  PR futura pode adicionar rotação.
- **Sem retry automático** — falhas de I/O retornam erro
  imediatamente; o usuário precisa reprovar/reaplicar.
- **Sem streaming de provider** — `execute_mission_chat`
  é uma chamada simples. `MissionChatResult` não tem
  chunks incrementais. O parser `fluxora_patch` espera a
  resposta completa.
- **Sem tool calling** — só `messages` com `role` /
  `content`.
- **Storage seguro de API keys não implementado** (chave
  pode ficar em `providers.json` em claro se o usuário
  digitar a chave literal em vez de env var) — fora do
  escopo da PR 010.
- **Patch delete** — a PR 010 implementa `delete` mas o
  default da política é `deny` para `delete-files`, então
  o provider precisaria propor `delete` E a política
  permitir. Em prática, é raro.

### 25.3 Caveats

- O `patches.getFileDiff` no backend Rust devolve um
  `serde_json::Value` que é enviado para o frontend como
  `Record<string, unknown>`. O `desktopBridge` faz cast
  para `FileDiff | null` via `as unknown as`. O `FileDiff`
  consumido pela UI vem com o campo `status` extra
  (`"added" | "modified" | "deleted"`) — a UI atual não
  usa esse campo, mas está disponível.
- O `payload?: unknown` do `ExecutionApproval` é inspecionado
  com helpers `payloadGetProposalId` /
  `payloadHasProposalId` no `desktopBridge` para evitar
  `as any` e manter type safety.
- O `MissionJob.error` é truncado em 500 chars pelo
  `truncate_error_message` do Patch Engine. Mensagens
  longas ficam com `…` no final.
- O `proposalId` é salvo no `payload` da `ExecutionApproval`
  (em `approvals::create_approval_from_permissions_check`).
  PR futura pode mover isso para um campo estruturado
  dedicado (`missionProposalId?: string` em
  `ExecutionApproval`).

## 26. Próximas PRs recomendadas

1. **PR 011 — Agentes reais e steps detalhados.** Substitui
   os steps sintéticos de `buildSyntheticSteps` por steps
   reais (Planner com chain-of-thought, Developer com
   execução de patches, QA com testes). Persiste
   `AgentStepOutput` em JSON.
2. **PR 012 — Streaming de providers.** SSE / WebSocket
   sobre OpenAI-compatible streaming. Substitui
   `providers_chat_once` por `providers_chat_stream` com
   callback de chunks. Mission Engine emite
   `mission/phase` com `payload.chunk` incremental.
3. **PR 013 — Tool calling controlado.** Adiciona suporte
   a `tools` no `chatOnce` e `listModels` para descobrir
   quais ferramentas cada modelo suporta.
4. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers e voice) para um storage
   encriptado (keychain do SO,
   `tauri-plugin-stronghold`).
5. **PR futura — UI dedicada de permissões/provedores/missões.**
   Tela dedicada para listar missões, ver resultado, rerun,
   configurar policy por projeto, e configurar
   provider/modelo por missão. Por enquanto, console do
   DevTools é a forma canônica.
6. **PR futura — Execução de comandos controlada.** Adiciona
   `CommandRun` real (parser de comandos permitidos via
   política `run-commands`, sem shell interativo).
7. **PR futura — Git commit/push controlado.** Adiciona
   `git commit` / `git push` respeitando as permissões
   `commit` / `push` da política do projeto (já em
   `PermissionsState` mas sem uso real).
8. **PR futura — Reverter aplicação parcial de patch.**
   Quando o segundo arquivo de uma proposta falha, o
   backend deve tentar reverter o primeiro (via backup
   temporário ou `git stash` controlado).
9. **PR futura — Persistência de eventos.** Mover o
   ring buffer de eventos do `AppEventsState` para
   SQLite/JSON, com paginação e rotação por idade.
10. **PR futura — Marketplace de providers.** Catálogo
    pré-configurado de providers conhecidos (OpenAI, Groq,
    OpenRouter, etc.) que o usuário pode adicionar com um
    clique.
11. **PR futura — Cancelamento real de missões.** Adicionar
    suporte a cancelamento de missões `running` (com
    interrupção de I/O e cleanup de estado). Persistir
    `MissionJob` em arquivo separado.

Esta PR não iniciou nenhuma delas.

## 27. Resumo executivo

- ✅ Patch Engine criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/patches.rs`) com 9 comandos
  Tauri, persistência em
  `<app_data_dir>/fluxora/patches.json`, 12 testes
  unitários e 10 eventos `patch/*` + 1 `diff/generated` no
  barramento.
- ✅ Parser `fluxora_patch` adicionado ao Mission Engine
  (PR 008) — extrai bloco markdown da resposta do
  provider, valida paths/operações/limites, tira snapshot
  de `beforeContent` do disco, calcula
  additions/deletions via LCS, e cria `PatchProposal`
  automaticamente.
- ✅ Aplicação segura de patch implementada em
  `patches_apply`: validação de permissões por operação
  (create → `create-files`; modify → `apply-patch` +
  `write-files`; delete → `delete-files`), aprovação
  obrigatória quando `ask`, snapshot check em `modify`,
  escrita atômica (temp + rename), tratamento de erro
  parcial.
- ✅ Approvals Engine (PR 009) estendido:
  `approvals_approve` agora detecta aprovações de
  `apply-patch` e dispara `patches_apply` automaticamente
  via `proposalId` salvo no payload.
- ✅ `git.changedFiles(workflowRunId)` e
  `git.fileDiff(workflowRunId, filePath)` agora são reais
  em runtime Tauri — convertem `PatchFileChange[]` para
  as formas legadas `ChangedFile` / `FileDiff` consumidas
  pelo Diff Viewer da UI atual.
- ✅ `desktopBridge` adiciona o namespace canônico novo
  `patches.*` e sobrescreve `git.changedFiles` /
  `git.fileDiff` / `workflows.approveFinal` /
  `workflows.rejectFinal` em runtime Tauri.
- ✅ UI preservada — nenhum componente React alterado.
  A UI atual continua consumindo
  `window.fluxora.git.changedFiles(workflowRunId)` /
  `git.fileDiff(workflowRunId, filePath)` /
  `window.fluxora.workflows.approveFinal(workflowRunId)`
  / `rejectFinal(workflowRunId, note?)` exatamente como
  antes — o `desktopBridge` faz a ponte.
- ✅ 12 novos testes Rust (patches) — 46 totais, todos
  passando.
- ✅ 9 novos comandos Tauri registrados no
  `invoke_handler` do `lib.rs`.
- ✅ Limites de segurança: paths relativos obrigatórios,
  rejeição de `..` / absolutos / drive letters / 12
  diretórios proibidos; 20 arquivos por proposta; 256 KiB
  por `afterContent`; 1 MiB total; recusa de binários;
  escrita atômica; não expor conteúdo em eventos; API
  keys nunca em patches.
- ✅ Nenhum commit, push, checkout, reset, merge,
  rebase, branch, tag ou operação Git de escrita.
- ✅ Nenhum comando shell.
- ✅ Nenhuma referência a Electron reintroduzida.
- ✅ Nenhuma chamada a OpenCode como motor.
- ✅ API keys nunca aparecem em eventos `patch/*` ou
  `diff/*`.
- ✅ `pnpm dev` continua abrindo o Tauri sem loop, com
  logs esperados dos quatro engines (missions,
  permissions, approvals, patches).
- ✅ Documentação organizada em
  `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_010_PATCH_DIFF.md`
  (este documento).
- ✅ Commit local criado em
  `feature/pr-010-controlled-patch-diff` (sem push
  remoto).
- ✅ Nenhuma feature fora de escopo (sem commit/push real,
  sem tool calling, sem streaming, sem storage seguro de
  secrets, sem execução de comandos).
