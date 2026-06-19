# STATUS_MIGRATION_TAURI_PR_005_EVENTS

## 1. Objetivo da PR 005

Criar a **base real do barramento de eventos do Fluxora** usando o
sistema de eventos do Tauri 2, preservando a superfície
`window.fluxora.events.*` consumida pela UI React/TypeScript e
preparando o terreno para o Mission Engine, Voice/Whisper, Provider
Engine e piloto automático nas próximas PRs.

Esta PR é estritamente fundacional. **Nenhum workflow, agente, voz
ou provider real é introduzido** — apenas a infraestrutura que vai
tornar possível esses dominios emitirem eventos reais para a UI.

## 2. Estado herdado da PR 004

No início desta PR o `~/projects/Fluxora` já tinha:

- Repositório Git local em `main` (PR 004)
- `pnpm dev` na raiz abrindo o app desktop Tauri (sem loop)
- Base Tauri em `apps/desktop/src-tauri/`
- `projects.*` real em Rust (PR 002)
- `git.inspect` / `git.diff` / `app.getGitInfo` reais (PR 003)
- `desktopBridge` centralizando `invoke()` (PR 001)
- `window.fluxora` preservado (PR 001)
- `mock-api.ts` como fallback fora do runtime Tauri
- Documentação organizada em `docs/migrations/tauri/`

O domínio `events.*` ainda era 100% mock. Os componentes consumiam
listeners que disparavam de arrays em memória do
`apps/desktop/src/api/mock-api.ts`, sem qualquer ligação com o
backend Rust.

## 3. Como eventos funcionavam antes

### 3.1 Superfície `events.*` no mock

`apps/desktop/src/api/mock-api.ts` (linhas 874-885) expunha:

```ts
events: {
  list(workflowRunId?): Promise<WorkflowEvent[]>,
  onWorkflowEvent(cb): () => void,
  onJobUpdated(cb): () => void,
  onApprovalChange(cb): () => void,
  onOpenCodeStdout(cb): () => void,
  onOpenCodeStderr(cb): () => void,
  onOpenCodeJsonEvent(cb): () => void,
}
```

Cada listener era um `Set<Listener>` interno do mock, alimentado
pelos simuladores `simulateRealWorkflow` / `simulateMultiAgentWorkflow`
e por `emitApprovalChange` / `updateJob`. Nenhum dado cruzava a
fronteira Rust ↔ frontend.

### 3.2 `desktopBridge` e o Tauri runtime

`apps/desktop/src/services/desktopBridge.ts` fazia
`{...mock, projects, app, git}` em `createDesktopBridge()`. O
namespace `events` era herdado direto do mock, **inclusive no
runtime Tauri**. Os `events.onWorkflowEvent` etc. só funcionavam
porque os simuladores do Electron antigo foram preservados no
mock — não havia backend real emitindo nada.

### 3.3 Consumidores na UI

- `apps/desktop/src/hooks/useLiveExecutionEvents.ts` (todos os 6
  listeners + `events.list`)
- `apps/desktop/src/hooks/useActiveRuns.ts` (`onApprovalChange`)
- `apps/desktop/src/hooks/usePendingApprovals.ts`
  (`onApprovalChange`)
- `apps/desktop/src/pages/ExecutionDetailPage.tsx` (6 listeners)
- `apps/desktop/src/pages/ApprovalsPage.tsx`
- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/components/layout/RightPanel.tsx`
- `apps/desktop/src/components/layout/StatusBar.tsx`
- `apps/desktop/src/components/settings/ControlledExecutionPanel.tsx`

Todos consumiam `window.fluxora.events.*` e não sabiam se o evento
vinha do mock ou do Tauri.

## 4. Como eventos funcionam agora

### 4.1 Em runtime Tauri

1. O backend Rust mantém um `AppEventsState` (ring buffer de 200
   eventos em memória, registrado via `tauri::Builder::manage`)
2. Um único canal Tauri — `fluxora-event` — transporta todos os
   eventos do barramento do frontend
3. Dentro do payload de cada evento, o campo `type` diferencia o
   significado (ex.: `"app/ready"`, `"project/updated"`,
   `"app/diagnostic"`)
4. O frontend chama `listen<FluxoraEvent>("fluxora-event", ...)`
   em `desktopBridge.ts`; um único listener global despacha para
   todos os subscribers registrados
5. `createDesktopBridge()` continua devolvendo
   `window.fluxora.events` com a mesma forma — o componente React
   não sabe se o evento veio do canal Tauri ou do mock

### 4.2 Fora do runtime Tauri (browser / Vite dev)

- O `subscribe`/`emitDiagnostic`/`listRecent`/`clearRecent` caem
  no fallback do `mock-api.ts`, que mantém um ring buffer local
  com a mesma forma de `FluxoraEvent`
- Os métodos legados (`onWorkflowEvent`, `onJobUpdated`,
  `onApprovalChange`, `onOpenCodeStdout/Stderr/JsonEvent`,
  `events.list`) permanecem idênticos, alimentados pelos
  simuladores do mock

### 4.3 Quem emite o quê hoje

| Origem | Tipo | Quando |
|---|---|---|
| `lib.rs` `setup` | `app/ready` | Shell Tauri pronto |
| `lib.rs` `projects_create` | `project/updated` | Após criar projeto |
| `lib.rs` `projects_update` | `project/updated` | Após atualizar projeto |
| `lib.rs` `projects_remove` | `project/updated` | Após remover projeto |
| `events_emit_diagnostic` | `app/diagnostic` | Quando a UI chama o comando |

`app/ready` é o primeiro evento real que a UI pode observar via
`events.subscribe({ type: "app/ready", ... })` ou
`events.on("app/ready", ...)`.

## 5. Contrato de evento adotado

Definido em `packages/shared/src/index.ts`:

```ts
export type FluxoraEventSource =
  | "app" | "project" | "mission"
  | "agent" | "voice" | "system";

export type FluxoraEventLevel =
  | "debug" | "info" | "warn" | "error";

export type FluxoraEventType =
  | "app/ready"
  | "app/diagnostic"
  | "project/opened"
  | "project/updated"
  | "project/removed"
  | "mission/event"
  | "mission/log"
  | "mission/phase"
  | "agent/event"
  | "voice/event"
  | "system/error";

export interface FluxoraEvent {
  id: string;
  type: string;          // tipo semântico
  timestamp: string;     // ISO 8601
  source: FluxoraEventSource;
  level: FluxoraEventLevel;
  projectId?: string;
  missionId?: string;
  agentId?: string;
  message?: string;
  payload?: unknown;
}
```

Observações:

- O conjunto de `type` é **aberto**. Backend e frontend podem
  adicionar novos valores sem alterar o tipo base. Os valores
  acima são os canônicos recomendados; as próximas PRs
  (Mission Engine, Voice, Provider, Piloto Automático) já
  podem assumir esse vocabulário.
- `payload` é `unknown` e o consumidor decide como tipar.
- Validação leve no backend: `level` e `source` caem para
  defaults (`"info"` / `"system"`) quando recebem valores
  desconhecidos.

## 6. Eventos criados ou padronizados nesta PR

Novos no contrato:

- `app/ready` — emitido uma vez no startup
- `app/diagnostic` — emitido pelo comando
  `events_emit_diagnostic`
- `project/updated` — emitido por `projects_create`,
  `projects_update` e `projects_remove`

Padronizados (definição do tipo, ainda sem emissor real):

- `project/opened`
- `project/removed` (usa-se `project/updated` com `payload.action =
  "removed"` por enquanto; `project/removed` fica reservado para
  uma separação semântica futura se necessário)
- `mission/event`, `mission/log`, `mission/phase`
- `agent/event`
- `voice/event`
- `system/error`

O `Mission Engine` (PR 008) e o Voice/Whisper (PR 006) vão emitir
os tipos `mission/*`, `agent/*`, `voice/*` usando o mesmo canal
`fluxora-event` já criado aqui.

## 7. Comandos Rust/Tauri criados

Em `apps/desktop/src-tauri/src/events.rs`:

- `events_ping()` — health-check, retorna ISO 8601 atual
- `events_emit_diagnostic(input: EmitDiagnosticInput) ->
  FluxoraEvent` — emite `app/diagnostic` e devolve o evento criado
- `events_list_recent(input: Option<ListRecentInput>) ->
  Vec<FluxoraEvent>` — lê do ring buffer, com `limit` opcional e
  filtro por `type`
- `events_clear_recent()` — limpa o ring buffer

As implementações são funções `pub fn` em `events.rs`. Os wrappers
`#[tauri::command]` vivem em `apps/desktop/src-tauri/src/lib.rs`
para evitar o conflito de macros do Tauri (vários módulos
gerando `__cmd__*` no mesmo escopo).

`EmitDiagnosticInput`:

```rust
struct EmitDiagnosticInput {
  message: String,
  level: Option<String>,        // "debug"|"info"|"warn"|"error"
  source: Option<String>,       // "app"|"project"|"mission"|"agent"|"voice"|"system"
  project_id: Option<String>,
  mission_id: Option<String>,
  agent_id: Option<String>,
  payload: Option<serde_json::Value>,
}
```

`ListRecentInput`:

```rust
struct ListRecentInput {
  limit: Option<usize>,   // default 50, hard cap 200
  r#type: Option<String>,
}
```

## 8. Arquivos Rust alterados

- `apps/desktop/src-tauri/src/events.rs` — **novo**. Struct
  `FluxoraEvent`, estado `AppEventsState`, helper `emit_to_app`,
  comandos públicos.
- `apps/desktop/src-tauri/src/lib.rs` — registra o módulo
  `events`, gerencia `AppEventsState`, adiciona `setup` que emite
  `app/ready`, registra os 4 comandos no `invoke_handler`, e
  modifica `projects_create`/`projects_update`/`projects_remove`
  para emitir `project/updated` via `events::emit_to_app`.
- `apps/desktop/src-tauri/src/projects.rs` — campos de
  `ProjectResponse` passaram de privados para `pub` (eram
  lidos pelos novos emit de eventos em `lib.rs`).

Nenhuma dependência nova em `Cargo.toml`: o ring buffer usa
`std::collections::VecDeque` e `std::sync::Mutex` da stdlib, o
timestamp usa o crate `time` que já estava presente desde a PR
002, e o canal Tauri usa `tauri::Emitter` (já disponível via
`tauri = "2.8.5"`).

## 9. Arquivos frontend alterados

- `packages/shared/src/index.ts` — adiciona `FluxoraEvent`,
  `FluxoraEventSource`, `FluxoraEventLevel`, `FluxoraEventType`
  e estende `FluxoraAPI.events` com `subscribe`,
  `unsubscribe`, `on`, `off`, `listRecent`, `emitDiagnostic`,
  `clearRecent`. Mantém todos os métodos legados intactos.
- `apps/desktop/src/services/desktopBridge.ts` — adiciona o
  estado `fluxoraEventListeners` (Set módulo-level), a função
  `ensureTauriEventBridge` que chama `listen("fluxora-event")`
  do `@tauri-apps/api/event`, e exporta
  `subscribeFluxoraEvent`, `unsubscribeFluxoraEvent`,
  `onFluxoraEvent`, `listRecentFluxoraEvents`,
  `emitDiagnosticFluxoraEvent`, `clearRecentFluxoraEvents`.
  `createDesktopBridge()` agora sobrescreve o namespace
  `events`, preservando os métodos legados via mock e
  roteando os novos para o Tauri (com fallback mock).
- `apps/desktop/src/api/mock-api.ts` — adiciona o ring buffer
  `mockRecentEvents`, o Set `fluxoraEventListeners`, o helper
  `buildMockEvent` / `pushMockEvent`, e estende o objeto
  `events` do mock com `subscribe`, `unsubscribe`, `on`,
  `off`, `listRecent`, `emitDiagnostic`, `clearRecent`. Os
  métodos legados (`list`, `onWorkflowEvent`, etc.) ficam
  exatamente como estavam.

Nenhum componente React foi modificado. `window.fluxora.events`
continua sendo o único ponto de entrada da UI.

## 10. Como `desktopBridge` preserva `window.fluxora.events`

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente o namespace `events` no objeto final. Para cada
método:

- **Legado** (`list`, `onWorkflowEvent`, `onJobUpdated`,
  `onApprovalChange`, `onOpenCodeStdout/Stderr/JsonEvent`):
  apontado direto para `mock.events.X.bind(mock.events)`.
  Em runtime Tauri, esses listeners continuam alimentados
  pelos simuladores do mock (Mission Engine não existe), o
  que é o comportamento documentado e preservado.
- **Novo** (`subscribe`, `on`, `listRecent`, `emitDiagnostic`,
  `clearRecent`, `unsubscribe`, `off`): roteado via as
  funções `subscribeFluxoraEventSync` / `unsubscribeFluxoraEvent`
  / `onFluxoraEvent` / `listRecentFluxoraEvents` /
  `emitDiagnosticFluxoraEvent` / `clearRecentFluxoraEvents`.
  Essas funções decidem em tempo de chamada se estão em
  runtime Tauri (via `isTauriRuntime()`) e, em caso afirmativo,
  usam `invoke()` e `listen()` do `@tauri-apps/api/event`.
  Caso contrário, delegam para o mock.

Resultado: a UI continua consumindo `window.fluxora.events.*`
exatamente como antes. Componentes novos podem usar a API nova
(`events.subscribe`, `events.on`, `events.emitDiagnostic` etc.)
sem saber se estão em Tauri ou em browser.

## 11. Como o fallback mock funciona fora do runtime Tauri

`isTauriRuntime()` em `desktopBridge.ts` checa
`"__TAURI_INTERNALS__" in window`. Quando essa condição é falsa:

- `subscribe`/`on` registram o callback direto no Set
  `fluxoraEventListeners` do `mock-api.ts`; nada de Tauri é
  envolvido
- `listRecent` chama `mock.events.listRecent` direto
- `emitDiagnostic` chama `mock.events.emitDiagnostic`, que
  cria um `FluxoraEvent` local com `buildMockEvent` e o
  distribui via `pushMockEvent` (que atualiza o ring buffer
  e dispara os listeners locais)
- `clearRecent` chama `mock.events.clearRecent`

A forma do `FluxoraEvent` (id, type, timestamp, source, level,
projectId, missionId, agentId, message, payload) é idêntica
nos dois caminhos. O `id` no mock usa um contador local
(`mock-evt-{n}`) e no Tauri usa
`fluxora-evt-{unix_millis}-{atomic_seq}`.

## 12. Como validar eventos reais

### 12.1 Pelo console do Tauri (DevTools)

Em uma futura janela do app, abrir DevTools e:

```js
const unsub = window.fluxora.events.on("app/ready", (e) =>
  console.log("app/ready", e)
);
window.fluxora.events.emitDiagnostic({ message: "olá PR 005" })
  .then((e) => console.log("emitido", e));
await window.fluxora.events.listRecent();
// → [FluxoraEvent { type: "app/ready", ... }, FluxoraEvent { type: "app/diagnostic", ... }]
```

### 12.2 Pelo `events_ping` (smoke-test mínimo)

```bash
# Em runtime Tauri, via console:
await window.fluxora.__test_invoke?.("events_ping", {});
// → "2026-06-18T17:25:00.123Z" (ou timestamp atual)
```

A função não é exposta por `window.fluxora` por design, mas está
disponível via `invoke("events_ping", {})` se o integrador quiser
adicionar um atalho de debug numa PR futura.

### 12.3 Pelo ring buffer do backend

```js
const recent = await window.fluxora.events.listRecent({ limit: 10 });
// Mostra os últimos 10 eventos emitidos pelo backend
const filtered = await window.fluxora.events.listRecent({
  limit: 50,
  type: "project/updated",
});
// Filtra por tipo
```

### 12.4 Verificação manual durante o `pnpm dev`

Quando `pnpm dev` sobe o app Tauri, o `setup` no `lib.rs` já
emite o evento `app/ready`. Qualquer código que chame
`events.subscribe(callback)` no startup da UI recebe esse
evento.

## 13. Integrações feitas com projetos/Git/filesystem

### 13.1 `projects.create` / `projects.update` / `projects.remove`

Em `lib.rs`, depois de cada operação bem-sucedida:

```rust
let event = events::build_event(
  "project/updated",
  "project",
  "info",
  Some(format!("Projeto criado/atualizado/removido: ...")),
  Some(response.id.clone() /* ou id, no remove */),
  None,
  None,
  Some(serde_json::json!({
    "action": "created" | "updated" | "removed",
    "project": &response, // exceto no remove, onde é null
  })),
);
events::emit_to_app(&app, event);
```

Para `remove`, `payload` traz só `{ action: "removed" }` (a
store em si não devolve o record removido; seria necessário
buscar antes para incluir o nome).

### 13.2 `git.inspect`, `fs.*`, `commands.*`

Nenhuma integração nesta PR. A ideia é deixar essas integrações
para as PRs específicas (Mission Engine, Provider Engine, Voice)
quando fizer sentido emitir `system/error` ou `app/diagnostic`
em condições reais de erro.

A diretriz é deliberadamente conservadora: nenhum acoplamento
desnecessário entre o barramento e features que ainda não existem
ou estão parcialmente migradas.

## 14. Limitações atuais

- O ring buffer é **apenas em memória**. Eventos são perdidos
  quando o app fecha. Persistência (SQLite ou arquivo JSON) é
  decisão para PR futura, provavelmente junto do Mission
  Engine.
- O canal é global (sem segmentação por janela). O Tauri
  suporta `emit_to(target, ...)` se for preciso limitar a
  entrega a uma janela específica no futuro.
- Não há deduplicação de eventos no backend. O frontend já
  faz dedup por `id` em `useLiveExecutionEvents` (helper
  `appendEvent`), mas a deduplicação é responsabilidade de
  quem consome.
- `app/ready` é emitido uma vez no `setup`, mas não há
  mecanismo de "replay" para subscribers que se inscreverem
  depois. Subscribers tardios precisam usar `listRecent()` se
  quiserem o histórico.
- O Tauri event system é fire-and-forget: o backend não
  espera acknowledgement do frontend. Para fluxos críticos
  com garantia de entrega, o caminho continua sendo
  `invoke()` + `Promise`.

## 15. O que ainda permanece mockado

Tudo que depende do Mission Engine, do workflow engine, da
execução real de agentes e da integração OpenCode/Whisper:

- `events.list(workflowRunId)` — `WorkflowEvent[]` legada do
  mock do Electron
- `events.onWorkflowEvent`, `events.onJobUpdated`,
  `events.onApprovalChange` — alimentados pelos simuladores
  `simulateRealWorkflow`, `simulateMultiAgentWorkflow`,
  `emitApprovalChange` e `updateJob` no `mock-api.ts`
- `events.onOpenCodeStdout`, `events.onOpenCodeStderr`,
  `events.onOpenCodeJsonEvent` — mesmo motivo
- `workflows.*`, `agents.*`, `approvals.*`, `commands.*`,
  `agentSteps.*`, `opencode.*`, `whisper.*`, `whisperLocal.*`,
  `voice.*` (transcrição e providers), `models.*`,
  `settings.*` — todos ainda mockados
- `git.changedFiles` e `git.fileDiff` (workflow) — dependem
  do workflow engine

O barramento de eventos do PR 005 **não** emite nada para esses
eventos legados; ele apenas abre o canal `fluxora-event` para
que o Mission Engine, Voice, Provider e Piloto Automático
possam emitir quando migrados.

## 16. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite 8 produziu `dist/` (801 KiB / 223 KiB gzip) |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes das PRs 002..004) |
| `pnpm dev` | `tauri dev` → Vite em `:1420` → Cargo compila → binário `target/debug/fluxora` inicia. Nenhum loop, nenhum erro de runtime. |

### Falhas preexistentes em `pnpm test`

As mesmas 6 falhas já documentadas nas PRs 002, 003 e 004,
nenhuma agravada ou causada pela PR 005:

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual

## 17. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes listadas acima.
Nenhum warning novo. Nenhuma regressão de teste.

## 18. Próximas PRs recomendadas

1. **PR 006 — Voice/Whisper no Tauri.** Migra o domínio
   `voice.*` e `whisper.*` para o backend, emite
   `voice/event` no barramento quando transcrição começa,
   termina ou falha. Usa `events.subscribe` no `VoiceCommandModal`
   e afins.
2. **PR 007 — Provider Engine próprio.** Substitui a
   dependência residual de `opencode-adapter`. Emite
   `agent/event` e `system/error` no barramento.
3. **PR 008 — Mission Engine inicial.** Implementa o motor
   real. Emite `mission/event`, `mission/log`,
   `mission/phase`, `agent/event`. A partir daqui,
   `events.onWorkflowEvent`, `events.onJobUpdated`,
   `events.onApprovalChange` e os 3 listeners de OpenCode
   deixam de ser mock e passam a ser alimentados pelo
   barramento real (`fluxora-event` filtrado por tipo).
4. **PR 009 — Piloto automático com permissões por projeto.**
   Adiciona scheduler, fila de execuções e permissões por
   projeto. Emite `mission/phase` com `payload.permission`.
5. **PR futura — Persistência de eventos.** Mover o ring
   buffer para SQLite/JSON, com `events.list` paginado e
   rotação por idade.

Esta PR não iniciou nenhuma delas.
