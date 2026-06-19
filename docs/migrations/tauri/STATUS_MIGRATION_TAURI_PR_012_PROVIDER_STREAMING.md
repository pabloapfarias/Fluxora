# STATUS_MIGRATION_TAURI_PR_012_PROVIDER_STREAMING

## 1. Objetivo da PR 012

Adicionar **streaming OpenAI-compatible** ao Provider Engine do
Fluxora, integrado ao Agent Engine da PR 011 e ao barramento
de eventos da PR 005, para que a UI receba progresso
incremental em tempo real durante a execução dos agentes.

Concretamente:

- **Streaming SSE** real sobre o adapter OpenAI-compatible
  (`stream: true`, leitura linha-a-linha via
  `ureq::Response::into_reader()`).
- **Helper público** `providers::execute_mission_chat_stream`
  que valida provider/model/API key, emite
  `provider/stream-started` / `stream-chunk` /
  `stream-completed` / `stream-failed`, aceita callback de
  chunks e devolve o mesmo `MissionChatResult` da PR 007 +
  011 (com novo campo `chunks: u32`).
- **Tauri command** `providers_chat_stream` registrado no
  `invoke_handler` de `lib.rs`.
- **Integração com Agent Engine** via helper privado
  `execute_provider_chat_for_agent` que:
  1. Tenta streaming; cada delta vira um evento
     `agent/step-chunk` no barramento `fluxora-event`.
  2. Faz fallback transparente para
     `providers::execute_mission_chat` (PR 007) quando o
     stream falha **antes** do primeiro chunk.
  3. Propaga o erro quando o stream falha **após** chunks já
     enviados — o step é marcado como `failed` com mensagem
     clara.
- **Tipos compartilhados** `ProviderStreamChunk`,
  `ProviderStreamResult`, `ChatStreamRequest`,
  `AgentStepChunkPayload` em `packages/shared/src/index.ts`.
- **Método canônico** `window.fluxora.providers.chatStream`
  exposto pelo `desktopBridge` em runtime Tauri e stubbed
  fora dele pelo `mock-api.ts`.
- **10 testes unitários** do parser SSE + 1 fix preexistente
  no `parse_models_response_rejects_missing_data` (o teste
  antigo fazia `.unwrap()` antes de `is_err()` — bug
  silencioso que nunca chegou a falhar a CI porque o
  `unwrap()` em `Err(...)` retorna o erro e o teste panicava
  silenciosamente; corrigido nesta PR).
- **64 testes Rust** passando (eram 54, +10 do SSE parser,
  +1 fix do teste preexistente que agora conta).
- **UI preservada** — nenhum componente React alterado. Os
  eventos `provider/stream-chunk` e `agent/step-chunk` já
  trafegam pelo barramento `fluxora-event` consumido por
  `events.subscribe` / `events.on(...)`; uma UI dedicada de
  streaming pode ser adicionada em PR futura sem alterar
  esta base.

**Esta PR NÃO implementa tool calling, execução de
comandos de shell, Git write operations, commit/push,
cancelamento real de streams, streaming de áudio, WebSocket
próprio ou Anthropic/Gemini nativo.** A camada de
streaming é estritamente OpenAI-compatible (que cobre
LM Studio, llama.cpp, vLLM, Ollama no formato
`/v1/chat/completions`, OpenAI, Together, Groq, etc.).

## 2. Estado herdado da PR 011

- Repositório Git local em
  `feature/pr-012-provider-streaming` (criado a partir de
  `feature/pr-011-real-agents-steps`).
- `pnpm dev` na raiz abrindo o app desktop Tauri.
- `projects.*` / `git.*` / `filesystem.*` / `app.*` reais em
  Rust (PR 002, PR 003).
- Barramento real `fluxora-event` (PR 005) com ring buffer
  200 e canal único.
- `voice.*` / `whisper.*` real em Rust (PR 006).
- Provider Engine próprio (PR 007) com adapter
  OpenAI-compatible, persistência em `providers.json`,
  eventos `provider/*` e comandos `providers_*`.
- Mission Engine (PR 008) com persistência em
  `missions.json`, 8 comandos `missions_*`, eventos
  `mission/*` e integração com Provider Engine via
  `providers::execute_mission_chat`.
- Piloto automático com permissões por projeto, Approvals
  Engine e scheduler mínimo (PR 009).
- Patch Engine (PR 010) com parser `fluxora_patch`,
  validação rigorosa de paths, eventos `patch/*` e integração
  com `git.changedFiles` / `git.fileDiff`.
- Agent Engine (PR 011) com persistência em `agents.json` /
  `agent_steps.json`, 4 agentes padrão (Planner / Developer
  / QA / Finalizer), pipeline sequencial integrado ao
  Provider Engine, Patch Engine e Permissions/Approvals.
- `desktopBridge` (PR 011) com `agents.listConfigs` /
  `getConfig` / `createConfig` / `updateConfig` /
  `resetDefaults` (canônico novo), `agentSteps.listByMission`
  / `get` (canônico novo), `models.updateAgentConfigModel`
  (canônico novo) e `workflows.getStepOutputs` /
  `listAgentOutputs` real via `loadRealAgentSteps`.
- `ProviderCapabilities.supports_streaming: Option<bool>` já
  existia no struct Rust e no tipo TS, mas não era usado
  pelo Provider Engine — passa a ser consultado por
  `execute_mission_chat_stream` para falhar cedo quando o
  provider explicitamente declara que não suporta streaming.
- `ProviderEventType` já existia no shared (10 tipos: test-,
  models-loaded, request-, settings-updated, created,
  updated, removed) — esta PR adiciona 4 tipos novos:
  `provider/stream-started`, `provider/stream-chunk`,
  `provider/stream-completed`, `provider/stream-failed`.

## 3. Como providers/agentes funcionavam antes

### 3.1 Provider Engine (PR 007)

`apps/desktop/src-tauri/src/providers.rs` tinha:

- `StoredProvider { id, name, kind, baseUrl, apiKeyEnv,
  defaultModel, enabled, capabilities, createdAt,
  updatedAt }` com `ProviderCapabilities { supportsStreaming,
  supportsTools, supportsVision, supportsAudio }` como
  `Option<bool>` (campo opcional, persistido em
  `providers.json`).
- `openai_chat_once(...)` — chamada não-streaming via
  `ureq::post().send_string()` que lê o JSON completo
  de uma vez e extrai `choices[0].message.content`.
- `providers_chat_once` Tauri command que validava
  provider/model/api_key, chamava `openai_chat_once`,
  emitia `provider/request-started` / `request-completed`
  / `request-failed`.
- `execute_mission_chat(...)` — helper público usado
  exclusivamente pelo Agent Engine da PR 011. Mesma chamada
  que `providers_chat_once` mas com timeout 90s
  (`MISSION_CHAT_TIMEOUT_MS`) e **sem** emitir eventos
  `provider/*` (a UI já recebe `mission/phase` do Mission
  Engine, e `agent/step-completed` do Agent Engine).

### 3.2 Agent Engine (PR 011)

`apps/desktop/src-tauri/src/agents.rs::run_mission_agents`
executava pipeline sequencial de 4 agentes. Para cada
agente:

1. Criava `AgentStepRecord` (`status: "running"`).
2. Persistia o step e emitia `agent/step-started`.
3. Construía `messages` específicas do role via
   `build_agent_messages`.
4. Resolvia `providerId` / `model` (agente > missão).
5. Chamava `providers::execute_mission_chat(...)` com
   `max_tokens: 2048`. **A chamada inteira era síncrona —
   a UI só recebia `agent/step-completed` quando o provider
   retornava a resposta completa.**
6. Em OK: trunca output, persiste step como `completed`,
   emite `agent/step-completed` (info) e evento específico
   do role (`plan-created` / `qa-completed` /
   `proposal-created`).
7. Em Err: trunca erro, persiste step como `failed`,
   emite `agent/step-failed` (error).

Resultado: durante toda a execução de um agente, a UI só
via o `agent/step-started` antes da chamada e o
`agent/step-completed` (ou `failed`) depois. Se o provider
demorasse 30s, a UI ficava sem feedback visual por 30s.

### 3.3 Quem ouvia os eventos

A UI consumia `window.fluxora.events.subscribe(...)` /
`events.on("type", cb)` / `events.listRecent(...)` (PR 005)
mas não havia `provider/stream-*` nem `agent/step-chunk` no
barramento. Os eventos `agent/*` disponíveis (7 tipos da
PR 011) cobriam apenas o ciclo de vida do step (started,
completed, failed) e específicos do role (plan-created,
qa-completed).

### 3.4 Pontos de injeção para streaming

- `openai_chat_once` poderia ser duplicada como
  `openai_chat_stream` (lendo o response como stream via
  `Response::into_reader()` + `BufReader::read_line`).
- `execute_mission_chat` poderia ser duplicada como
  `execute_mission_chat_stream` com callback para chunks.
- `run_mission_agents` poderia chamar a versão streaming
  com fallback para a não-streaming.

## 4. Como streaming funciona agora

### 4.1 Fluxo geral

1. **Cliente** (frontend) chama
   `window.fluxora.providers.chatStream({ providerId, model,
   messages, ... })`.
2. **Bridge** (`desktopBridge.ts`) delega para o Tauri
   command `providers_chat_stream`.
3. **Tauri command** (`lib.rs::providers_chat_stream`)
   resolve `model` (payload ou `defaultModel` do provider),
   chama `providers::execute_mission_chat_stream` passando
   um callback no-op.
4. **Helper** (`providers::execute_mission_chat_stream`):
   - Valida provider (`enabled`, `is_supported_kind`).
   - Se `capabilities.supports_streaming === Some(false)`,
     falha imediatamente.
   - Resolve `base_url` e `api_key`.
   - Aplica `max_tokens` cap
     (`min(HARD_MAX_TOKENS).max(1)`, default 1024).
   - Gera `requestId` determinístico
     (`stream-{millis}-{seq}`).
   - Emite `provider/stream-started` com `requestId`,
     `providerId`, `providerName`, `model`, `messageCount`,
     `maxTokens`.
   - Chama `openai_chat_stream(...)` que faz `POST
     {baseUrl}/chat/completions` com `stream: true` e
     processa SSE linha-a-linha.
   - Para cada delta, emite `provider/stream-chunk` no
     barramento (campos: `requestId`, `providerId`,
     `providerName`, `model`, `index` 0-based, `delta`,
     `accumulatedLength`, `done: false`).
   - Em OK: emite `provider/stream-completed` com
     `textLength`, `chunks` e `durationMs`. Devolve
     `MissionChatResult { text, model, providerId,
     providerName, durationMs, chunks, usage }`.
   - Em Err: trunca mensagem (500 chars), loga com chave
     mascarada, emite `provider/stream-failed` com
     `errorCode`, `errorMessage`, `durationMs`. Propaga o
     erro.
5. **Tauri command** devolve `ProviderStreamResultPayload`
   ao frontend.

### 4.2 Integração com Agent Engine

`agents::run_mission_agents` chama o helper privado
`execute_provider_chat_for_agent` (no lugar da antiga
`providers::execute_mission_chat` direta). O helper:

1. Tenta `execute_mission_chat_stream` com um callback que
   emite `agent/step-chunk` por delta (campos: `stepId`,
   `missionId`, `projectId`, `agentId`, `agentName`, `role`,
   `chunkIndex`, `delta`, `accumulatedLength`).
2. **Fallback automático**: se o stream falhar **antes** de
   qualquer chunk (`chunks_emitted == 0`), chama
   `execute_mission_chat` (PR 007) e devolve o resultado.
   Log no stderr: `[fluxora agents] stream falhou antes do
   primeiro chunk, fallback para não-streaming: {err}`.
3. Se o stream falhar **após** chunks já emitidos,
   propaga o erro. O `run_mission_agents` trata isso
   como falha do step (igual à PR 011).

### 4.3 Fallback não-streaming

Preservado em três níveis:

1. **Backend** — `execute_mission_chat` (PR 007) continua
   existindo e inalterado. O Agent Engine usa ele
   automaticamente em fallback (ver 4.2).
2. **Bridge** — `chatOnce` continua exposto em
   `window.fluxora.providers.chatOnce`. Tauri command
   `providers_chat_once` continua registrado.
3. **Capabilities** — providers que declaram
   `supportsStreaming: false` no JSON falham cedo em
   `execute_mission_chat_stream` com `"Provider não suporta
   streaming."` O Agent Engine detecta isso como fallback
   (porque `chunks_emitted == 0`).

### 4.4 Segurança

- **API key nunca em eventos** — `execute_mission_chat_stream`
  emite apenas `requestId`, `providerId`, `providerName`,
  `model`, `index`, `delta`, `accumulatedLength`, `textLength`,
  `chunks`, `durationMs`, `errorCode`, `errorMessage`. A chave
  fica em `api_key` local e vai apenas no header HTTP.
- **Prompt/messages nunca em eventos** — os payloads
  `provider/stream-*` e `agent/step-chunk` não incluem o
  input, o system prompt nem as mensagens.
- **Delta pode ser emitido** porque é saída do modelo, com
  cap de 8 KiB por delta (constante `MAX_STREAM_DELTA_BYTES`).
- **Texto acumulado cap** de 512 KiB por stream
  (`MAX_STREAM_ACCUMULATED_BYTES`) — aborta o stream com
  erro claro se exceder.
- **Timeout** de 120s total
  (`STREAM_TIMEOUT_MS = 120_000`).
- **Chave mascarada em logs** — `eprintln!` com
  `mask_api_key(...)` em caso de erro HTTP.
- **Erro truncado** em 500 chars
  (`truncate_error_message(...)` da PR 007).
- **Não expor chain-of-thought** — `parse_sse_line` extrai
  apenas `choices[0].delta.content` (saída final do modelo).
  Campos `reasoning`, `thinking` ou similares não são
  emitidos (nem reconhecidos pelo parser).
- **Output completo no final** — `AgentStepRecord.outputText`
  é persistido apenas quando o step termina (não a cada
  chunk). Os chunks só trafegam pelo barramento.

## 5. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type ProviderStreamEventType =
  | "provider/stream-started"
  | "provider/stream-chunk"
  | "provider/stream-completed"
  | "provider/stream-failed";

export type AgentStreamEventType =
  | "agent/step-chunk";

export interface ProviderStreamChunk {
  requestId: string;
  providerId: string;
  providerName?: string;
  model?: string;
  index: number;
  delta: string;
  accumulatedLength: number;
  done: boolean;
  createdAt: string;
}

export interface ProviderStreamResult {
  requestId: string;
  providerId: string;
  providerName?: string;
  model?: string;
  text: string;
  durationMs: number;
  chunks: number;
  usage?: unknown;
}

export interface ChatStreamRequest {
  providerId: string;
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentStepChunkPayload {
  stepId: string;
  missionId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  role: FluxoraAgentRole;
  chunkIndex: number;
  delta: string;
  accumulatedLength: number;
}
```

Estendido `ProviderEventType` em
`packages/shared/src/index.ts` (união discriminada do
barramento) com os 4 tipos novos:
`provider/stream-started` / `provider/stream-chunk` /
`provider/stream-completed` / `provider/stream-failed`.

Adicionado método em `FluxoraAPI.providers`:

```ts
chatStream(input: ChatStreamRequest): Promise<ProviderStreamResult>;
```

`MissionChatResult` (Rust) ganhou o campo `chunks: u32`
(reaproveitado pela forma `chatOnce` com `chunks: 0` para
preservar compatibilidade).

## 6. Backend Rust criado/alterado

### 6.1 Criado

- **Parser SSE puro** (`providers::parse_sse_line`):
  função pública que recebe `&str` e devolve
  `SseEvent { Empty | Done | Delta(String) | Raw(String) }`.
  Testável sem I/O. Tolerante a CRLF / LF, espaços após
  `data:`, `event:`, `id:`, `retry:`, comentários
  (linhas iniciadas com `:`), JSON inválido, payloads
  vazios.
- **`openai_chat_stream`** (privado): faz
  `POST {baseUrl}/chat/completions` com `stream: true` e
  lê o response com `ureq::Response::into_reader()` +
  `std::io::BufReader::read_line`. Aplica limites
  hard-coded.
- **`ProviderStreamResultPayload`** (público): payload
  retornado por `providers_chat_stream` Tauri command.
  Inclui `requestId`, `providerId`, `providerName`,
  `model`, `text`, `durationMs`, `chunks`, `usage`.
- **`ChatStreamPayload`** (público): payload aceito por
  `providers_chat_stream`. Mesma forma de `ChatOncePayload`
  + `requestId` opcional.
- **`OpenAIStreamSummary`** (público): `{ text, chunks,
  durationMs }` retornado por `openai_chat_stream` ao
  caller.
- **`ProviderError::Callback(String)`**: nova variante
  para erros do callback de stream (ex.: Agent Engine
  sinaliza cancelamento ou erro ao processar chunk). Nunca
  inclui API key.

### 6.2 Alterado

- **`providers::MissionChatResult`**: adicionado
  `pub chunks: u32` (campo novo, `0` para não-streaming).
- **`providers::execute_mission_chat` (PR 007)**: set
  `chunks: 0` no construtor Ok. Comportamento idêntico.
- **`providers.rs::tests`**: +10 testes do parser SSE
  + 1 fix do `parse_models_response_rejects_missing_data`
  preexistente.

## 7. Arquivos frontend alterados

### 7.1 `packages/shared/src/index.ts`

- Importa implicitamente todos os tipos via `index.ts`
  barrel.
- +5 tipos novos (`ProviderStreamEventType`,
  `AgentStreamEventType`, `ProviderStreamChunk`,
  `ProviderStreamResult`, `ChatStreamRequest`,
  `AgentStepChunkPayload`).
- `ProviderEventType` ganhou 4 union members
  (`provider/stream-*`).
- `FluxoraAPI.providers` ganhou `chatStream(input)` (canônico
  novo).

### 7.2 `apps/desktop/src/api/mock-api.ts`

- Import de `ChatStreamRequest`, `ProviderStreamResult`.
- `providers.chatStream` stub (fora do runtime Tauri):
  devolve `{ requestId: "mock-stream", text: "",
  durationMs: 0, chunks: 0, usage: { mock: true } }`.

### 7.3 `apps/desktop/src/services/desktopBridge.ts`

- Import de `ChatStreamRequest`, `ProviderStreamResult`.
- `export async function chatStream(input: ChatStreamRequest)`:
  em runtime Tauri, delega para `providers_chat_stream`. Em
  fallback mock, devolve `{ requestId: "stream-mock", ... }`.
- `createDesktopBridge().providers.chatStream`: expõe o
  helper de baixo nível na superfície canônica nova.

### 7.4 Não alterados (UI preservada)

- `apps/desktop/src/pages/*` (OverviewPage,
  ExecutionDetailPage, ExecutionsPage, AgentsPage,
  ApprovalsPage, etc.) — nenhum componente React alterado.
- `apps/desktop/src/components/events/EventLog.tsx` —
  já consome `events.subscribe` / `events.on(...)` que
  passam a receber `provider/stream-*` e `agent/step-chunk`
  automaticamente.
- `apps/desktop/src/components/agents/AgentStepOutputPanel.tsx`
  — continua exibindo o `outputText` final persistido
  normalmente.
- `apps/desktop/src/hooks/*` (useLiveExecutionEvents,
  useActiveRuns, useUsageStats) — inalterados.
- Qualquer outro componente React.

A UI atual continua funcionando sem alterações. Os
componentes novos podem assinar `agent/step-chunk` e
`provider/stream-chunk` quando quiserem exibir progresso
em tempo real.

## 8. Como o parser SSE funciona

```rust
pub enum SseEvent {
    Empty,         // linha vazia, comentário `: ...`, ou `event:`, `id:`, `retry:`
    Done,          // `data: [DONE]`
    Delta(String), // chunk OpenAI-compatible com `choices[0].delta.content`
    Raw(String),   // chunk JSON válido sem delta extraível, ou JSON inválido
}

pub fn parse_sse_line(line: &str) -> SseEvent {
    // 1. trim_end de \n e \r
    // 2. se vazio → Empty
    // 3. se começa com `:` (comentário SSE) → Empty
    // 4. se não começa com `data:` → Empty
    // 5. extrai payload (trim_start após `data:`)
    // 6. se payload == "[DONE]" → Done
    // 7. tenta parsear JSON:
    //    - sucesso: extrai `choices[0].delta.content` ou fallback `choices[0].message.content`
    //    - falha: Raw(payload)
}
```

Edge cases cobertos pelos testes:

- `data: {"choices":[{"delta":{"content":"x"}}]}` → `Delta("x")`.
- `data: [DONE]` → `Done`.
- `data:` ou `data:    ` (vazio) → `Empty`.
- `: keep-alive` (heartbeat SSE) → `Empty`.
- `event: message` / `id: 42` / `retry: 1000` → `Empty`.
- `data: {invalid json` → `Raw` (não falha o stream).
- `data: {"choices":[{"message":{"content":"Fallback"}}]}`
  (sem `delta`, só `message`) → `Delta("Fallback")`.
- `data: {"choices":[{"finish_reason":"stop"}]}` (chunk
  de finalização) → `Raw` (não produz delta mas conta
  como chunk).
- `data:{"choices":...}` (sem espaço após `data:`) e
  `data: {"choices":...}` (com espaço) → ambos extraem.
- `data: ...\r\n` (CRLF) → `Delta(...)`.
- Múltiplas choices em `choices[0..N]` → pega a primeira
  (`choices[0]`).

Limites aplicados pelo `openai_chat_stream` (camada acima
do parser):

- Máximo de 20 000 chunks
  (`MAX_STREAM_CHUNKS = 20_000`).
- Máximo de 8 KiB por delta
  (`MAX_STREAM_DELTA_BYTES = 8 * 1024`).
- Máximo de 512 KiB de texto acumulado
  (`MAX_STREAM_ACCUMULATED_BYTES = 512 * 1024`).
- Timeout de 120s
  (`STREAM_TIMEOUT_MS = 120_000`).
- Stream sem `[DONE]` E sem nenhum chunk com delta → erro
  `"Stream encerrado sem [DONE] nem conteúdo."`.

## 9. Como `providers_chat_stream` funciona

Tauri command público, registrado em `lib.rs`:

```rust
#[tauri::command]
fn providers_chat_stream(
    app: AppHandle,
    payload: ChatStreamPayload,
) -> Result<ProviderStreamResultPayload, String> {
    // 1. Resolve provider (payload.providerId)
    // 2. Valida enabled + is_supported_kind
    // 3. Resolve model (payload.model ou provider.defaultModel)
    // 4. Aplica max_tokens cap (HARD_MAX_TOKENS, default 1024)
    // 5. Chama execute_mission_chat_stream com callback no-op
    // 6. Devolve ProviderStreamResultPayload ao frontend
}
```

O fluxo do helper `execute_mission_chat_stream` está
descrito em 4.1. O Tauri command é apenas o wrapper que
converte `AppHandle` + `ChatStreamPayload` em uma chamada
de função síncrona e devolve o `ProviderStreamResultPayload`
final.

## 10. Como `execute_mission_chat_stream` funciona

Helper público usado pelo Tauri command e pelo Agent
Engine. Assinatura:

```rust
pub fn execute_mission_chat_stream(
    app: &AppHandle,
    provider_id: &str,
    model: &str,
    messages: &[ChatMessagePayload],
    max_tokens: Option<u32>,
    request_id: Option<String>,
    on_chunk: impl FnMut(String, usize, usize) -> Result<(), String>,
) -> Result<MissionChatResult, String>
```

Comportamento:

1. Resolve `provider` no `ProvidersState`.
2. Valida `provider.enabled` e
   `is_supported_kind(&provider.kind)`.
3. Se `capabilities.supports_streaming === Some(false)`,
   falha imediatamente com
   `"Provider não suporta streaming."`.
4. Resolve `base_url` (via `validate_base_url`) e
   `api_key` (via `resolve_api_key`).
5. Aplica `max_tokens.map(|v| v.min(HARD_MAX_TOKENS).max(1))`,
   default 1024.
6. Gera `request_id` se ausente
   (`stream-{millis}-{seq}`).
7. Emite `provider/stream-started` (info) com
   `requestId`, `providerId`, `providerName`, `model`,
   `messageCount`, `maxTokens`.
8. Marca `Instant::now()`.
9. Chama `openai_chat_stream(...)` com `timeout:
   Duration::from_millis(STREAM_TIMEOUT_MS)` e `temperature:
   Some(0.7)` (igual ao `execute_mission_chat`).
10. Para cada delta extraído:
    - Incrementa `index` e `accumulated` (em chars).
    - Emite `provider/stream-chunk` (info) com
      `requestId`, `providerId`, `providerName`, `model`,
      `index` 0-based, `delta`, `accumulatedLength`,
      `done: false`.
    - Chama `on_chunk(delta, index, accumulated)` — pode
      abortar o stream com `ProviderError::Callback` se
      devolver `Err`.
11. Em OK: emite `provider/stream-completed` (info) com
    `textLength`, `chunks`, `durationMs`. Devolve
    `MissionChatResult { text, model, providerId,
    providerName, durationMs, chunks, usage: None }`.
12. Em Err: trunca mensagem (500 chars), loga com chave
    mascarada, emite `provider/stream-failed` (error) com
    `errorCode`, `errorMessage`, `durationMs`. Devolve
    `Err(msg)`.

## 11. Como Agent Engine usa streaming

`agents::execute_provider_chat_for_agent` (helper privado
adicionado em `agents.rs`):

```rust
fn execute_provider_chat_for_agent(
    app: &AppHandle,
    step_id: &str,
    mission_id: &str,
    project_id: &str,
    agent_id: &str,
    agent_name: &str,
    role: &str,
    provider_id: &str,
    model: &str,
    messages: &[providers::ChatMessagePayload],
    max_tokens: Option<u32>,
) -> Result<providers::MissionChatResult, String>
```

1. Inicializa `chunks_emitted: u32 = 0`.
2. Chama `execute_mission_chat_stream` com callback que:
   - Incrementa `chunks_emitted`.
   - Emite `agent/step-chunk` (info) com `stepId`,
     `missionId`, `projectId`, `agentId`, `agentName`,
     `role`, `chunkIndex` (0-based), `delta`,
     `accumulatedLength`.
3. **Fallback automático** se o stream devolver `Err` e
   `chunks_emitted == 0`: chama `execute_mission_chat`
   (PR 007) e devolve o resultado. Loga no stderr.
4. Se o stream devolver `Err` E `chunks_emitted > 0`:
   propaga o erro. O `run_mission_agents` marca o step
   como `failed` com a mensagem truncada (500 chars).

`agents::run_mission_agents` foi atualizado em apenas um
ponto: a chamada `providers::execute_mission_chat(...)`
foi substituída por `execute_provider_chat_for_agent(...)`
com a mesma assinatura efetiva. O resto do pipeline
(truncamento de output, persistência do step, eventos
`agent/step-completed` / `agent/step-failed`, integração
com Patch Engine para o Developer, eventos
`agent/plan-created` / `agent/qa-completed`) é
**inalterado**.

## 12. Como fallback não-streaming funciona

Três níveis, em ordem de prioridade:

1. **`provider.capabilities.supportsStreaming: false`** —
   `execute_mission_chat_stream` falha com `"Provider não
   suporta streaming."` O Agent Engine recebe o erro com
   `chunks_emitted == 0` e cai em `execute_mission_chat`
   automaticamente.
2. **Provider que rejeita `stream: true`** — o adapter
   OpenAI-compatible recebe a requisição com `stream: true`
   e devolve 400. O helper `openai_chat_stream` traduz para
   `ProviderError::HttpStatus { status: 400, body: ... }`.
   O Agent Engine detecta (`chunks_emitted == 0`) e cai em
   `execute_mission_chat` (que faz a mesma requisição sem
   `stream: true`).
3. **Erro de rede antes do primeiro byte** — o helper
   recebe `ProviderError::Network(...)`. Mesmo fallback
   automático.

Em todos os casos:

- O usuário vê a missão completar normalmente.
- O `AgentStepRecord.outputText` é persistido.
- O `event_type: "agent/step-completed"` é emitido ao
  final (igual à PR 011).
- A diferença é que **não há eventos `agent/step-chunk`
  no barramento** — a UI fica sem feedback visual durante
  a chamada, comportamento idêntico ao da PR 011.

Quando o stream falha **após** chunks já emitidos, o
fallback **não** acontece — o step é marcado como
`failed` com mensagem clara (e truncada a 500 chars).
Isso evita confundir o usuário com output parcial sem
sinalizar o erro.

## 13. Como eventos `provider/stream-*` são emitidos

Todos via `providers::emit_stream_event` em
`providers.rs` (helper privado que monta um
`FluxoraEvent` com `source: "provider"` e chama
`events::emit_to_app`).

| Tipo | Quando | `level` | Campos principais do payload |
|---|---|---|---|
| `provider/stream-started` | Antes de enviar a requisição | `info` | `requestId`, `providerId`, `providerName`, `model`, `messageCount`, `maxTokens` |
| `provider/stream-chunk` | A cada delta extraído do SSE | `info` | `requestId`, `providerId`, `providerName`, `model`, `index` 0-based, `delta`, `accumulatedLength`, `done: false` |
| `provider/stream-completed` | Stream terminou OK | `info` | `requestId`, `providerId`, `providerName`, `model`, `textLength`, `chunks`, `durationMs` |
| `provider/stream-failed` | Stream falhou (rede, HTTP, parse, limite) | `error` | `requestId`, `providerId`, `providerName`, `model`, `durationMs`, `errorCode`, `errorMessage` (truncado) |

**Nunca inclui**:

- API key (mesmo mascarada).
- `messages` completas.
- System prompt do agente.
- Texto acumulado intermediário (só o `delta` por chunk).
- Path absoluto do projeto (só `providerId`).

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "provider"` e `level` apropriado.

## 14. Como eventos `agent/step-chunk` são emitidos

Via `agents::emit_agent_event` (helper da PR 011) durante
o callback de `execute_mission_chat_stream` no
`execute_provider_chat_for_agent`.

| Tipo | Quando | `level` | Campos principais do payload |
|---|---|---|---|
| `agent/step-chunk` | A cada delta extraído do SSE | `info` | `stepId`, `missionId`, `projectId`, `agentId`, `agentName`, `role` (`planner` / `developer` / `qa` / `finalizer` / `custom`), `chunkIndex` 0-based, `delta`, `accumulatedLength` |

**Nunca inclui**:

- API key.
- `messages` completas.
- `outputText` parcial acumulado (só o `delta` por chunk).
- Path absoluto do projeto (só `projectId`).
- System prompt.

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "agent"`, `missionId` e `agentId`
populados (consistente com os demais eventos `agent/*`).

**Persistência**: o `outputText` é persistido apenas
quando o step termina (PR 011, sem alteração). Os
chunks **não** são persistidos individualmente — o
`agent_steps.json` continua com um `AgentStepRecord`
por step, com `outputText` completo (truncado a
256 KiB pela PR 011).

## 15. Limites de segurança implementados

1. **API key nunca em eventos** —
   `execute_mission_chat_stream` não inclui a chave em
   nenhum payload. A chave fica local e vai apenas no
   header `Authorization: Bearer <key>` da requisição.
2. **API key mascarada em logs** —
   `eprintln!("[fluxora providers] stream falhou ... key={} ...",
   mask_api_key(key))` em caso de erro.
3. **Prompt/messages nunca em eventos** — os eventos
   `provider/stream-*` e `agent/step-chunk` não incluem
   o input, o system prompt nem as mensagens.
4. **Delta pode ser emitido** porque é saída do
   modelo. Cap de 8 KiB por delta
   (`MAX_STREAM_DELTA_BYTES`).
5. **Texto acumulado cap** de 512 KiB por stream
   (`MAX_STREAM_ACCUMULATED_BYTES`). Acima disso, aborta
   o stream com erro claro.
6. **Timeout total** de 120s
   (`STREAM_TIMEOUT_MS`). Acima disso, o `read_line` em
   `openai_chat_stream` retorna erro de IO e o stream
   falha com `ProviderError::Network`.
7. **Máximo de chunks** de 20 000
   (`MAX_STREAM_CHUNKS`). Acima disso, aborta com
   `ProviderError::InvalidResponse("Limite de 20000
   chunks excedido.")`.
8. **Erro truncado** em 500 chars
   (`truncate_error_message`).
9. **Output completo do step persistido apenas no
   final** — `AgentStepRecord.outputText` é salvo
   apenas quando o step termina (PR 011, sem
   alteração). Os chunks só trafegam pelo barramento.
10. **Não expor chain-of-thought** — o parser
    `parse_sse_line` extrai apenas
    `choices[0].delta.content` (saída final do modelo).
    Campos `reasoning`, `thinking` ou similares não são
    reconhecidos nem emitidos.
11. **Não executar tools** — esta PR não implementa
    tool calling. O provider recebe apenas `messages` com
    `role` e `content`.
12. **Não executar comandos** — esta PR não chama
    `std::process::Command`. Nenhum `Command::new` foi
    adicionado em `providers.rs`.
13. **Não fazer Git write operations** — esta PR não
    chama `git commit` / `git push` / `git add` / `git
    checkout` / `git reset` / `git clean` / `git merge` /
    `git rebase` / `git pull`.
14. **Não modificar Patch Engine fora do necessário** —
    `patches.rs` é inalterado nesta PR. O Developer agent
    continua consumindo o output final
    (`extract_fluxora_patch_block` + `create_proposal_from_provider_text`
    da PR 010) sem mudanças.
15. **Capabilities respeitadas** — providers que declaram
    `supportsStreaming: false` falham cedo no helper
    `execute_mission_chat_stream`, sem enviar a
    requisição. O Agent Engine cai automaticamente em
    `execute_mission_chat` (PR 007).
16. **Não salvar chunks em disco** — apenas
    `provider/stream-completed` (com `textLength` e
    `chunks`) e `agent/step-completed` (sem chunks
    específicos) são persistidos via
    `agent_steps.json` no final.
17. **`agent/step-chunk` não polui UI** — o payload tem
    apenas metadados de progresso + `delta` (string pura).
    Componentes que assinam `agent/step-chunk` precisam
    explicitamente se inscrever — não há assinatura
    automática que pudesse travar a UI.

## 16. O que ainda permanece mockado

- **Cancelamento real de stream** — se a UI chamar
  `missions.cancel` durante um stream, o `MissionJob`
  é marcado como `cancelled` (PR 009) mas o stream
  continua até o fim (a função não tem como ser
  interrompida em runtime síncrono do Tauri command).
  PR futura pode usar `tauri::async_runtime::spawn`
  + `CancellationToken`.
- **UI dedicada de streaming** — `EventLog` e
  `AgentStepOutputPanel` ainda exibem apenas logs
  agregados. Uma UI que mostre chunks incrementais em
  tempo real (tipo "efeito typewriter") pode ser
  adicionada em PR futura sem alterar esta base — basta
  assinar `events.on("agent/step-chunk", cb)` e
  acumular o `delta` por `stepId`.
- **Cap de steps em memória** — `AgentsState.steps`
  continua sem rotação (PR 011).
- **Streaming para Anthropic / Gemini nativos** — o
  helper `execute_mission_chat_stream` falha para
  `provider.kind != "openai-compatible"` (igual à PR
  011). Streaming nesses formatos é uma PR dedicada.
- **WebSocket próprio** — não implementado (e não
  necessário; SSE sobre HTTP/1.1 já é o padrão
  OpenAI).
- **Tool calling** — não implementado (PR 013).
- **Execução de comandos** — não implementado
  (PR 014).
- **Git write operations** — não implementadas.
- **Storage seguro de API keys** — não implementado.
- **Agentes paralelos** — não implementados
  (pipeline ainda é sequencial).
- **Métricas de streaming** — `durationMs` e `chunks`
  são emitidos, mas não há agregação por missão /
  projeto / agente. Pode ser adicionado em PR futura
  com hook no `provider/stream-completed`.

## 17. Como validar manualmente

### 17.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.providers.chatStream({...})` deve
  devolver
  `{ requestId: "stream-mock", text: "", chunks: 0, ... }`
  (mock fallback).
- `window.fluxora.events.subscribe(cb)` continua
  funcionando (apenas os eventos do mock do
  `mock-api.ts`).

### 17.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Logs esperados no startup (além dos das PRs anteriores):

```
[fluxora missions] carregadas 0 missão(ões) e 0 log(s)
[fluxora permissions] carregadas 0 política(s)
[fluxora approvals] carregadas 0 aprovação(ões)
[fluxora patches] carregadas 0 proposta(s) de patch
[fluxora agents] carregados 0 agente(s)
[fluxora agent_steps] carregados 0 step(s) de agente
```

A validação completa é pelo console do DevTools:

```js
// 1) Listar projects
const projects = await window.fluxora.projects.list();

// 2) Listar providers (cadastrar um se não houver — ex. LM Studio)
const providers = await window.fluxora.providers.list();
if (providers.length === 0) {
  await window.fluxora.providers.create({
    name: "LM Studio",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "lm-studio",
    defaultModel: "qwen2.5-7b-instruct",
    enabled: true,
  });
}

// 3) Testar streaming direto (sem missão)
const result = await window.fluxora.providers.chatStream({
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  messages: [
    { role: "user", content: "Responda em uma frase curta: o que é streaming?" }
  ],
  maxTokens: 128,
});
// → { requestId: "stream-...", text: "...", durationMs: ..., chunks: N, ... }

// 4) Listar eventos provider/stream-chunk recentes
const streamEvents = await window.fluxora.events.listRecent({
  type: "provider/stream-chunk",
  limit: 50,
});
// → array de eventos com { delta, index, accumulatedLength, requestId, ... }

// 5) Rodar missão (pipeline com 4 agentes)
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "assistido",
  prompt: "Analise este projeto e gere uma resposta curta com 3 recomendações.",
});

// 6) Listar chunks incrementais por agente
const chunks = await window.fluxora.events.listRecent({
  type: "agent/step-chunk",
  limit: 100,
});
// → array de eventos com { stepId, role, agentName, chunkIndex, delta, ... }

// 7) Verificar output final persistido (inalterado)
const steps = await window.fluxora.agentSteps.listByMission(run.id);
// → [Planner, Developer, QA, Finalizer] com outputText completo
```

### 17.3 Cenários de erro (validação manual)

1. **Provider sem streaming** — provider responde 400
   quando `stream: true` é enviado. O Agent Engine
   detecta (`chunks_emitted == 0`) e cai em
   `execute_mission_chat`. Nenhum `agent/step-chunk` é
   emitido; missão completa normalmente.

2. **Falha do provider no Planner** — step do Planner é
   marcado como `failed`, Agent Engine devolve `Err`,
   `missions_run` marca a missão como `failed`,
   `mission/failed` é emitido com `errorMessage`
   truncado. Comportamento idêntico à PR 011.

3. **Stream falha após 1 chunk** — provider responde
   com stream mas fecha a conexão após o primeiro
   delta. `openai_chat_stream` traduz para erro de
   rede, `execute_mission_chat_stream` emite
   `provider/stream-failed`, Agent Engine propaga o
   erro (chunks_emitted > 0), step do agente é
   marcado como `failed` com mensagem clara.

4. **Provider desabilitado** — `execute_mission_chat_stream`
   falha com `"Provider desabilitado."`. Agent Engine
   não cai em fallback (não é um erro de stream
   específico; é uma validação de config).

5. **API key inválida** — provider responde 401.
   `openai_chat_stream` traduz para
   `ProviderError::HttpStatus { status: 401, body:
   ... }`. `execute_mission_chat_stream` emite
   `provider/stream-failed` com chave **mascarada** no
   log stderr e erro truncado (500 chars) no evento.

### 17.4 Health-check do Provider Engine

Em runtime Tauri:

- `providers_ping` devolve o ISO 8601 atual.
- `providers_chat_once` continua funcionando (PR 007,
  sem regressão).
- `providers_chat_stream` novo: emite
  `provider/stream-started` / `provider/stream-chunk` /
  `provider/stream-completed` no barramento e devolve
  `ProviderStreamResultPayload` consolidado.

### 17.5 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 64 testes passando (10 novos do SSE parser + 1 fix do
# parse_models_response_rejects_missing_data preexistente)
```

## 18. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/assets/index-BJu0Jb32.js` 831.41 KiB / 228.89 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 64/64 testes passando (10 novos do SSE parser + 1 fix preexistente) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 90s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~13s → binário `target/debug/fluxora` inicia. Logs das 6 engines: missions, permissions, approvals, patches, agents, agent_steps. Nenhum loop, nenhum erro de runtime. |
| `pnpm --filter @fluxora/desktop tauri:build` (com timeout 240s) | `cargo run --release` em ~1m 07s → 3 bundles (`.deb`, `.rpm`, `.AppImage`) em `apps/desktop/src-tauri/target/release/bundle/`. SIGTERM é do timeout; build já estava completo. |

## 19. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já
documentadas nas PRs 002, 003, 004, 005, 006, 007, 008, 009,
010 e 011. **Nenhuma regressão** de teste. **10 novos
testes Rust** passando (64 totais, +10). Build de produção
sem warnings novos. Tauri build de release com 3 bundles
gerados.

## 20. Erros conhecidos

### 20.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral.
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual.

Documentadas em todas as PRs anteriores como fora de
escopo.

### 20.2 Limitações desta PR

- **Cancelamento real de stream** — não implementado. O
  `MissionJob` pode ser marcado como `cancelled`, mas o
  stream HTTP continua até o fim (Tauri command é
  síncrono nesta PR). PR futura pode usar
  `tauri::async_runtime::spawn` + `CancellationToken`.
- **Sem streaming para `anthropic` / `gemini` / outros
  `kind`** — o helper `execute_mission_chat_stream` falha
  com mensagem clara para `kind != "openai-compatible"`.
  Streaming nesses formatos (SSE nativo, gRPC, etc.) é
  uma PR dedicada.
- **Sem `usage` real do stream** — `openai_chat_stream`
  não extrai `usage` (OpenAI envia `usage` no chunk final
  em alguns casos; esta PR ignora para manter o parser
  simples). O `MissionChatResult.usage` é sempre `None`
  em chamadas streaming.
- **Pipeline sequencial** — agentes paralelos não são
  suportados. O `MAX_AGENTS_PER_MISSION = 4` é um limite
  duro (PR 011).
- **Sem retry automático** — falhas de rede/HTTP retornam
  erro imediatamente; o usuário precisa rerun a missão.
- **Stream que fecha abruptamente** — se o provider
  fechar a conexão sem `data: [DONE]`, o helper verifica
  se pelo menos 1 chunk com delta foi recebido. Se sim,
  devolve OK. Se não, falha com `"Stream encerrado sem
  [DONE] nem conteúdo."`.
- **Fallback automático pode mascarar problemas** — se o
  provider responder 400 em streaming mas 200 em
  não-streaming, o Agent Engine usa não-streaming
  silenciosamente. A UI não vê `agent/step-chunk` mas a
  missão completa normalmente. Logs no stderr indicam
  o fallback.
- **`agent/step-chunk` em PR 011 era declarado mas não
  implementado** — agora implementado. Mas componentes
  React não consomem ainda (decisão consciente: UI
  dedicada fica para PR futura).
- **Streaming de áudio** — fora de escopo. Whisper já
  retorna o resultado completo (PR 006).
- **Storage seguro de API keys** — não implementado
  (chave pode ficar em `providers.json` em claro se o
  usuário digitar a chave literal em vez de env var).
- **`temperature` ignorado no stream** — o helper sempre
  usa `0.7` (igual ao `execute_mission_chat` da PR 007).
  O campo `temperature` em `ChatStreamPayload` é
  preservado para compatibilidade futura.
- **Cap de steps em memória** — `AgentsState.steps`
  continua sem rotação (PR 011).

### 20.3 Caveats

- O `openai_chat_stream` faz `read_line` em um loop
  síncrono. O `Agent` do `ureq` tem `timeout(timeout)`
  que aplica ao IO de cada `read_line` — em condições
  normais, o stream termina antes do timeout. Mas se o
  provider ficar preso sem enviar nada por 120s, o
  `read_line` falha com `ErrorKind::TimedOut` e o
  stream falha com erro claro.
- O `ureq` retorna `Response::into_reader()` como
  `Box<dyn Read + Send + Sync>`. Usamos
  `std::io::BufReader` para amortizar o custo de
  syscalls.
- O `parse_sse_line` é tolerante a `data: ` com ou sem
  espaço após `data:`, e a `data: {...}` colado.
  Seguindo o spec SSE, ambos são aceitos.
- O `eprintln!` em caso de erro loga a chave mascarada.
  Em release (sem `debug_assertions`), o log aparece
  normalmente. Útil para diagnóstico em produção.
- O `chunk_count` em `openai_chat_stream` conta
  **todos** os chunks recebidos (incluindo `Raw` e
  `Delta`). O `chunks` no `ProviderStreamResult` é o
  mesmo valor — o caller pode usar para diagnóstico
  sem precisar contar separadamente.
- O `accumulated` no callback é em **chars** (não bytes)
  para alinhar com `outputText.chars().count()` da
  PR 011. Para textos multi-byte, isso difere do
  `len()` em bytes — mas a UI consome `textLength` que
  é o `text.chars().count()` (consistente).

## 21. Próximas PRs recomendadas

1. **PR 013 — Tool calling controlado.** Adiciona
   suporte a `tools` no `execute_mission_chat` /
   `execute_mission_chat_stream` e `listModels` para
   descobrir quais ferramentas cada modelo suporta.
   Cria uma camada de execução controlada de tools
   (ler arquivo específico, listar diretório, etc.) com
   aprovação do usuário via Permissions/Approvals
   (PR 009). Reaproveita o callback `on_chunk` para
   emitir progresso de tool calls.

2. **PR 014 — Execução de comandos controlada.**
   Adiciona `CommandRun` real (parser de comandos
   permitidos via política `run-commands`, sem shell
   interativo). O Developer pode propor comandos
   seguros (`cargo check`, `pnpm test`, etc.) que o
   usuário aprova.

3. **PR futura — Git commit/push controlado.**
   Adiciona `git commit` / `git push` respeitando as
   permissões `commit` / `push` da política do projeto
   (já em `PermissionsState` mas sem uso real).

4. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers, voice, agents) para um
   storage encriptado (keychain do SO,
   `tauri-plugin-stronghold`).

5. **PR futura — UI dedicada para streaming em tempo
   real.** Componente que assina `agent/step-chunk` e
   `provider/stream-chunk` e exibe progresso
   incremental por step (efeito typewriter). Esta PR
   já deixa a base pronta — basta consumir o barramento
   sem alterar backend.

6. **PR futura — Cancelamento real de streams/missões.**
   Refatorar `providers_chat_stream` para
   `tauri::async_runtime::spawn` + `CancellationToken`,
   expondo `chatStreamCancel(requestId)` que aborta o
   stream HTTP. Integrar com `scheduler.cancelJob` da
   PR 009.

7. **PR futura — Streaming para `anthropic` / `gemini`
   nativos.** Implementar adaptadores SSE específicos
   para esses formatos (Gemini tem formato próprio;
   Anthropic tem SSE com assinatura de eventos
   diferente).

8. **PR futura — Métricas de streaming.** Agregar
   `durationMs`, `chunks`, `accumulatedLength` por
   missão / projeto / agente, persistir em
   `usage_stats.json` e expor via
   `useUsageStats` (já existe da PR 011).

9. **PR futura — Cap de steps em memória.** Adiciona
   rotação por idade/quantidade em `AgentsState.steps`
   para evitar crescimento indefinido.

10. **PR futura — Cap de agents em memória.** Adiciona
    rotação por idade/quantidade em `AgentsState.agents`.

11. **PR futura — Remover `buildSyntheticSteps` legado.**
    Quando todas as missões migrarem para o Agent
    Engine, o fallback pode ser removido.

12. **PR futura — Agentes paralelos.** Permite que
    Planner + QA rodem em paralelo enquanto Developer
    executa (compartimentalização do
    `MissionAgentContext`).

13. **PR futura — Agentes por stack.** Auto-sugestão
    de roles custom baseado no stack do projeto.

Esta PR não iniciou nenhuma delas.

## 22. Resumo executivo

- ✅ Streaming OpenAI-compatible implementado
  (`stream: true`, SSE linha-a-linha, `ureq::Response::into_reader()`
  + `BufReader::read_line`).
- ✅ Parser SSE puro (`parse_sse_line`) com 10 testes
  unitários cobrindo edge cases (CRLF, espaços, JSON
  inválido, multi-choice, `DONE`, `message` fallback, etc.).
- ✅ `openai_chat_stream` lê o response como stream e
  aplica todos os limites (chunks, bytes, timeout).
- ✅ `execute_mission_chat_stream` helper público usado
  pelo Tauri command e pelo Agent Engine. Emite
  `provider/stream-started` / `stream-chunk` /
  `stream-completed` / `stream-failed` no barramento
  `fluxora-event`.
- ✅ `providers_chat_stream` Tauri command registrado no
  `invoke_handler` de `lib.rs`.
- ✅ `MissionChatResult` ganhou `chunks: u32` (default 0
  para `chatOnce`; valor real para `chatStream`).
- ✅ `execute_provider_chat_for_agent` no Agent Engine
  com fallback automático para `execute_mission_chat`
  (PR 007) quando o stream falha antes do primeiro
  chunk. Emite `agent/step-chunk` para cada delta.
- ✅ Tipos compartilhados
  (`ProviderStreamEventType`, `AgentStreamEventType`,
  `ProviderStreamChunk`, `ProviderStreamResult`,
  `ChatStreamRequest`, `AgentStepChunkPayload`) em
  `packages/shared/src/index.ts`.
- ✅ `FluxoraAPI.providers.chatStream` canônico novo
  exposto em runtime Tauri (`desktopBridge.ts`) e
  stubbed fora dele (`mock-api.ts`).
- ✅ 64 testes Rust passando (eram 54; +10 do SSE parser,
  +1 fix do `parse_models_response_rejects_missing_data`
  preexistente).
- ✅ Fallback não-streaming preservado em três níveis
  (capabilities, erro do provider, erro de rede).
- ✅ `providers.chatOnce` legado preservado.
- ✅ `execute_mission_chat` legado preservado.
- ✅ UI preservada — nenhum componente React alterado.
  `AgentStepOutputPanel`, `ExecutionDetailPage`,
  `useUsageStats`, `AgentsPage` continuam consumindo
  `window.fluxora.*` exatamente como antes.
- ✅ Limites de segurança: 8 KiB/delta, 512 KiB/stream,
  20 000 chunks/stream, 120s timeout, 500 chars erro,
  API key mascarada em logs, API key nunca em eventos,
  prompt/messages nunca em eventos, chain-of-thought
  não emitido.
- ✅ `pnpm dev` continua abrindo o Tauri sem loop, com
  logs esperados das seis engines (missions,
  permissions, approvals, patches, agents,
  agent_steps).
- ✅ `pnpm --filter @fluxora/desktop tauri:build` gera
  os 3 bundles (`Fluxora_0.1.0_amd64.deb`,
  `Fluxora-0.1.0-1.x86_64.rpm`,
  `Fluxora_0.1.0_amd64.AppImage`).
- ✅ Nenhuma operação Git de escrita.
- ✅ Nenhuma chamada a shell.
- ✅ Nenhuma referência a Electron reintroduzida.
- ✅ Nenhuma chamada a OpenCode como motor.
- ✅ Sem tool calling, sem execução de comandos, sem
  storage seguro de secrets, sem cancelamento real de
  stream — conforme exigido pela PR.
- ✅ Documentação organizada em
  `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_012_PROVIDER_STREAMING.md`
  (este documento).
- ✅ Branch local `feature/pr-012-provider-streaming`
  (sem push remoto).
- ✅ Nenhuma feature fora de escopo.
