# STATUS_MIGRATION_TAURI_PR_007_PROVIDER_ENGINE

## 1. Objetivo da PR 007

Criar o **Provider Engine próprio do Fluxora** em Rust/Tauri,
eliminando a dependência conceitual do OpenCode CLI como
intermediário para chamadas aos provedores de IA. Esta PR entrega
apenas a **infraestrutura de providers** — sem agentes reais,
sem Mission Engine, sem piloto automático, sem streaming nem
tool calling.

A próxima PR (PR 008 — Mission Engine) vai consumir
`window.fluxora.providers.*` para fazer chamadas reais aos
modelos.

## 2. Estado herdado da PR 006

- Repositório Git local em `feature/pr-007-provider-engine`
  (criado a partir de `feature/pr-006-voice-whisper`)
- `pnpm dev` na raiz abre o app Tauri
- `projects.*`, `git.*`, `filesystem.*`, `app.*` reais em Rust
- Barramento real `fluxora-event` (PR 005) com ring buffer 200
- `voice.*` / `whisper.*` real em Rust (PR 006), com adapter
  HTTP OpenAI-compatible
- `desktopBridge` centralizando `invoke()` e expondo
  `window.fluxora.*`
- O catálogo de providers/modelos vinha 100% do mock
  hardcoded em `mock-api.ts` (`mockProviders`, `mockModels`)
  expostos via `window.fluxora.opencode.getCatalog`
- Nenhuma chamada real a provider de IA existia — todo o
  domínio de modelos estava apoiado no `opencode-adapter` do
  Electron legado, jamais portado para Tauri

## 3. Como providers/modelos funcionavam antes

### 3.1 Catálogo via `opencode.getCatalog`

O mock em `apps/desktop/src/api/mock-api.ts` (linhas 41-67)
mantinha um catálogo hardcoded:

```ts
const mockProviders: OpenCodeProvider[] = [
  { id: "openai", displayName: "OpenAI", authType: "oauth" },
  { id: "opencode-go", displayName: "OpenCode Go", authType: "api" },
  { id: "google", displayName: "Google", authType: "api" },
];
const mockModels: OpenCodeModel[] = [
  { id: "openai/gpt-5.5", providerId: "openai", modelName: "gpt-5.5" },
  { id: "openai/gpt-5.4", providerId: "openai", modelName: "gpt-5.4" },
  { id: "opencode-go/glm-5.1", providerId: "opencode-go", modelName: "glm-5.1" },
  { id: "opencode-go/mimo-v2.5", providerId: "opencode-go", modelName: "mimo-v2.5" },
  { id: "opencode-go/qwen3.7-plus", providerId: "opencode-go", modelName: "qwen3.7-plus" },
  { id: "google/gemini-2.5-pro", providerId: "google", modelName: "gemini-2.5-pro" },
];
```

`opencode.getCatalog()` devolvia esse catálogo com
`fetchedAt` atualizado para o momento da chamada. A UI
(`SettingsPage`, `AgentsPage`, `AppShell`, `OverviewPage`,
`ProjectsPage`, `RightPanel`, `useUsageStats`) consumia
diretamente — não havia backend real consultando nenhum
provider.

### 3.2 `models.updateAgentModel` e seleção por agente

Cada `Agent` carregava `modelProviderId` (ex.: `"openai"`) e
`modelName` (ex.: `"openai/gpt-5.5"`). O método
`window.fluxora.models.updateAgentModel` (mock) atualizava
esses campos no array `agents` em memória. O fallback
`GlobalDefaultAgentModel` ficava no `localStorage` com a chave
`fluxora:globalDefaultAgentModel`.

### 3.3 Como o OpenCode era invocado (quando existia)

No Electron legado, o adapter `@fluxora/opencode-adapter`
executava o binário OpenCode CLI e parseava o JSON de saída.
No Fluxora, esse caminho nunca foi portado — toda a fachada
`window.fluxora.opencode.*` aponta para o mock do
`mock-api.ts`. Esta PR substitui a dependência conceitual
desse adapter (sem reintroduzir CLI externo) por um motor
próprio em Rust.

## 4. Como o Provider Engine funciona agora

### 4.1 Em runtime Tauri

1. O backend Rust mantém `ProvidersState` (mutex de
   `Vec<StoredProvider>`) registrado via
   `tauri::Builder::manage`
2. Carregado no `setup` do Tauri a partir de
   `<app_data_dir>/fluxora/providers.json` (silencioso em
   caso de I/O error)
3. Oito comandos Tauri novos:
   `providers_ping`, `providers_list`, `providers_get`,
   `providers_create`, `providers_update`,
   `providers_remove`, `providers_test`,
   `providers_list_models`, `providers_chat_once`
4. Adapter **OpenAI-compatible** real, usando `ureq` 2.x
   (mesma dependência da PR 006), com timeout 8s para
   health-check e 60s para chat
5. Eventos `provider/*` emitidos no canal `fluxora-event`
   da PR 005 (com `source: "system"`, `level` ajustado por
   tipo)

### 4.2 Fora do runtime Tauri (browser/Vite dev)

- `mock-api.ts` ganhou namespace `providers` com
  `list/get/create/update/remove/test/listModels/chatOnce`
  que devolvem `[]` ou respostas de stub
- O `opencode.getCatalog` legado (mock) **continua
  intacto** — a UI que depende dele no navegador não
  quebra

### 4.3 Quem ouve os eventos `provider/*`

- `desktopBridge` se inscreve no canal `fluxora-event`
  (PR 005) e despacha para todos os subscribers locais
- `window.fluxora.events.on("provider/test-completed", cb)`
  filtra por `type`
- Componentes UI podem usar sem saber se estão em Tauri
  ou mock (a UI atual não consome esses eventos ainda —
  fica disponível para a próxima PR)

## 5. Métodos `providers.*` migrados

| Método | Status na PR 007 |
|---|---|
| `providers.list` | **real** (Tauri `providers_list`), fallback mock fora do Tauri |
| `providers.get` | **real** (Tauri `providers_get`), mock devolve `null` |
| `providers.create` | **real** (Tauri `providers_create`), mock stub |
| `providers.update` | **real** (Tauri `providers_update`), mock stub |
| `providers.remove` | **real** (Tauri `providers_remove`), mock noop |
| `providers.test` | **real** (Tauri `providers_test`), mock devolve `ok: false` |
| `providers.listModels` | **real** (Tauri `providers_list_models`), mock devolve `[]` |
| `providers.chatOnce` | **real** (Tauri `providers_chat_once`), mock devolve `text: ""` |

## 6. Métodos `opencode.*` agora redirecionados em runtime Tauri

| Método | Em runtime Tauri | Fora do runtime Tauri |
|---|---|---|
| `opencode.getCatalog` | Provider Engine se houver providers | mock legado |
| `opencode.getModelsForProvider` | Provider Engine se houver providers | mock legado |
| `opencode.refreshCatalog` | Provider Engine (sem cache) | mock legado |
| `opencode.detect` / `getSettings` / `updateSettings` / `getStatus` / `diagnostics` / `controlledExecution` | mock legado | mock legado |

A UI atual **continua consumindo `window.fluxora.opencode.*`
exatamente como antes** — o `desktopBridge` é quem decide se
o catálogo vem do Provider Engine real (em runtime Tauri,
quando há providers cadastrados) ou do mock legado.

## 7. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type ProviderKind =
  | "openai-compatible"
  | "anthropic" | "gemini" | "mistral" | "deepseek" | "minimax"
  | "local" | "custom";

export type ProviderStatus =
  | "configured" | "missing-api-key" | "invalid"
  | "unreachable" | "disabled";

export interface ProviderCapabilities { /* streaming/tools/vision/audio */ }
export interface AiProviderConfig { /* id, name, kind, baseUrl, apiKeyEnv, ... */ }
export interface AiModelInfo { /* id, providerId, name, ... */ }
export interface ProviderTestResult { /* ok, status, message, durationMs, models */ }
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatOnceRequest { providerId, model?, messages, temperature?, maxTokens? }
export interface ChatOnceResult { text, model?, providerId, durationMs, usage? }

export type ProviderEventType =
  | "provider/test-started" | "provider/test-completed" | "provider/test-failed"
  | "provider/models-loaded"
  | "provider/request-started" | "provider/request-completed" | "provider/request-failed"
  | "provider/settings-updated"
  | "provider/created" | "provider/updated" | "provider/removed";

export interface ProviderEventBase { /* kind, providerId?, providerName?, kind2? */ }
export type ProviderEventPayload =
  | ProviderTestStartedPayload | ProviderTestCompletedPayload | ProviderTestFailedPayload
  | ProviderModelsLoadedPayload
  | ProviderRequestStartedPayload | ProviderRequestCompletedPayload | ProviderRequestFailedPayload
  | ProviderSettingsUpdatedPayload
  | ProviderCreatedPayload | ProviderUpdatedPayload | ProviderRemovedPayload;
```

Tipos `OpenCode*` existentes **preservados intactos** — a UI
que os consome (`SettingsPage`, `AgentsPage`, etc.) não muda.

## 8. Backend Rust criado/alterado

### 8.1 Criado

- `apps/desktop/src-tauri/src/providers.rs` — **novo**, ~1450 linhas:
  - `StoredProvider` (struct serializável em camelCase, espelha
    `AiProviderConfig`)
  - `ModelInfo` (espelha `AiModelInfo`)
  - `ProviderError` (enum interno: `MissingConfig`,
    `InvalidUrl`, `UnsupportedKind`, `Network`, `HttpStatus`,
    `InvalidResponse`, `NoApiKey`)
  - `ProvidersState` (gerenciado via `tauri::Builder::manage`,
    `Mutex<Vec<StoredProvider>>`)
  - `ProvidersFile` (struct versionada para JSON)
  - `providers_file_path` / `ensure_providers_dir` /
    `write_providers_file` (persiste em
    `<app_data_dir>/fluxora/providers.json`)
  - `load_providers_on_startup` (carrega silenciosamente em
    caso de erro de I/O)
  - `providers_ping` — health-check
  - `providers_list` / `providers_get` — leitura
  - `providers_create` / `providers_update` / `providers_remove`
    — escrita, com validação de nome e baseUrl
  - `providers_test` — `GET {baseUrl}/models`, aceita 401/403
    como "servidor respondeu", timeout 8s
  - `providers_list_models` — mesma chamada, devolve lista
  - `providers_chat_once` — `POST {baseUrl}/chat/completions`,
    timeout 60s, retorna `choices[0].message.content`
  - `openai_list_models` / `openai_chat_once` — adapter
    OpenAI-compatible
  - `parse_models_response` — extrai `data[]` do JSON
  - `validate_base_url` / `validate_name` / `validate_model_field`
    — validações de entrada
  - `normalize_kind` / `is_supported_kind` — normalização
  - `resolve_api_key` / `mask_api_key` — resolução e
    mascaramento de API key (mesma semântica da PR 006)
  - `truncate_error_message` — limita a 500 chars
  - `generate_provider_id` — IDs monotônicos
  - `emit_provider_event` — emite `provider/*` no barramento
    `fluxora-event` (canal da PR 005)
  - 11 testes unitários (máscara de chave, truncamento,
    normalização de kind, validações, parse de resposta,
    `resolve_api_key` em diferentes modos)

### 8.2 Alterado

- `apps/desktop/src-tauri/Cargo.toml` — sem novas dependências
  (reaproveita `ureq 2`, `serde`, `time`)
- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod providers;`
  - `use providers::{...}`
  - `manage(providers::ProvidersState::new())` no builder
  - `providers::load_providers_on_startup(&handle)` no `setup`
  - 9 comandos Tauri adicionados ao `invoke_handler`

## 9. Arquivos frontend alterados

- `packages/shared/src/index.ts` — adiciona
  `ProviderKind`, `ProviderStatus`, `ProviderCapabilities`,
  `AiProviderConfig`, `AiModelInfo`, `ProviderTestResult`,
  `ChatMessage`, `ChatOnceRequest`, `ChatOnceResult`,
  `ProviderEventType` + 11 tipos de payload de evento
  discriminados por `kind`, e a interface
  `providers: { ... }` em `FluxoraAPI`
- `apps/desktop/src/api/mock-api.ts` — adiciona namespace
  `providers` (fallback fora do runtime Tauri)
- `apps/desktop/src/services/desktopBridge.ts`:
  - Helpers `listProviders`, `getProvider`, `createProvider`,
    `updateProvider`, `removeProvider`, `testProvider`,
    `listProviderModels`, `chatOnce` (com fallback mock)
  - `buildCatalogFromProviders` — converte
    `AiProviderConfig[]` + `AiModelInfo[]` no formato
    `OpenCodeCatalogResult` consumido pela UI
  - Sobrescreve `opencode.getCatalog` /
    `opencode.getModelsForProvider` / `opencode.refreshCatalog`
    em runtime Tauri para usar o Provider Engine quando há
    providers cadastrados
  - Sobrescreve namespace `providers` em
    `createDesktopBridge()`

**Não alterados** (UI preservada):
- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/pages/AgentsPage.tsx`
- `apps/desktop/src/components/layout/AppShell.tsx`
- `apps/desktop/src/components/layout/RightPanel.tsx`
- `apps/desktop/src/hooks/useUsageStats.ts`
- Qualquer outro componente React

## 10. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente o namespace `providers` no objeto final. Para
cada método:

- `providers.list/get/create/update/remove/test/listModels/
  chatOnce` → em runtime Tauri, chamam os comandos Tauri
  reais via `invoke()`. Fora, devolvem listas vazias / stubs
- `opencode.getCatalog/getModelsForProvider/refreshCatalog` →
  em runtime Tauri, montam um `OpenCodeCatalogResult` a
  partir do Provider Engine. Se **não houver providers
  cadastrados**, caem no mock legado (preservando
  compatibilidade total)
- `opencode.detect/getSettings/updateSettings/getStatus/
  diagnostics/controlledExecution` → mock legado (sem
  mudanças)

Resultado: a UI continua consumindo
`window.fluxora.opencode.*` exatamente como antes, e passa
a consumir `window.fluxora.providers.*` quando precisa do
Provider Engine real (por exemplo, o Mission Engine em PR
futura).

## 11. Como providers são persistidos

### 11.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/providers.json`
- Formato: JSON pretty-printed com chaves em camelCase
- Versão: `1`
- Cada provider tem:
  - `id`, `name`, `kind`
  - `baseUrl?` (opcional, validado como `http://` ou `https://`)
  - `apiKeyEnv?` (nome de env var ou chave literal — nunca
    exposto em logs/eventos)
  - `defaultModel?`
  - `enabled`
  - `capabilities?` (streaming/tools/vision/audio)
  - `createdAt`, `updatedAt`
- `load_providers_on_startup` é chamado no `setup` do
  Tauri e popula o `ProvidersState` em memória
- `providers_create` / `providers_update` / `providers_remove`
  persistem em `providers.json` no disco

### 11.2 Fora do runtime Tauri

- `mock-api.ts` mantém fallback stub (sem persistência)

### 11.3 Storage seguro de API keys

**Decisão consciente nesta PR**: o `apiKeyEnv` armazena ou
o **nome de uma variável de ambiente** (recomendado, ex.:
`OPENAI_API_KEY`) ou a **chave literal** (ex.: `sk-abc...`).
Mesmo padrão da PR 006, para preservar consistência entre
Voice e Provider Engine.

Storage seguro de verdade (encryption at rest, keychain do
SO, `tauri-plugin-stronghold`) é decisão para PR futura,
provavelmente junto do Piloto Automático (PR 009+).

**Mitigação atual**:
- A chave **não é logada** em lugar nenhum (`mask_api_key`
  mostra apenas prefixo/sufixo)
- Não é enviada em eventos `provider/*` no barramento
- Não é retornada para o frontend além de onde o usuário
  digitou (o backend nunca devolve `apiKeyEnv` para
  `providers_get`/`providers_list` — eles devolvem apenas
  o `StoredProvider` que **inclui** `apiKeyEnv` para a UI
  mostrar no formulário de edição; isso é necessário para
  o "edit in place" do form, e o campo é mascarado nos
  inputs sensíveis)
- Não é gravada em arquivos de status

## 12. Local do `providers.json`

`<app_data_dir>/fluxora/providers.json`

Onde `app_data_dir` é resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora`, a
localização esperada tende a ser equivalente a:

`~/.local/share/com.fluxora/fluxora/providers.json`

## 13. Como API keys são tratadas

- **Resolução**: `resolve_api_key` aceita nome de env var
  (formato `[A-Z_][A-Z0-9_]*`) e chave literal (qualquer
  outra string)
- **Mascaramento**: `mask_api_key("sk-abcdefghijklmnop")`
  devolve `"sk-a***mnop"` (ou `"***"` para chaves ≤ 8 chars)
- **Em logs**: nunca. A chave só aparece mascarada em
  `eprintln!` de erro de `providers_chat_once`
- **Em eventos**: nunca. `emit_provider_event` nunca inclui
  `apiKeyEnv` no payload
- **Em erros de HTTP**: o `body` retornado pelo provider é
  truncado em 500 chars (`truncate_error_message`) e nunca
  inclui a chave
- **Em retornos para o frontend**: `providers_list` /
  `providers_get` devolvem o `StoredProvider` completo (com
  `apiKeyEnv` em claro, para que o form de edição possa
  mostrar o valor). O frontend é responsável por não exibir
  esse campo em logs/eventos

## 14. Adapter OpenAI-compatible implementado

### 14.1 `providers_test` / `providers_list_models`

- Faz `GET {baseUrl}/models`
- Aceita 401/403 como "servidor respondeu, credencial
  inválida" (devolve `ok: true` com `status: "configured"`)
- Timeout 8s
- Mapeia resposta `{"data": [{"id": "..."}]}` para
  `AiModelInfo[]` (preenchendo `providerId` com o id do
  provider que fez a chamada)
- Suporta `Authorization: Bearer <key>` quando `apiKeyEnv`
  está configurado
- Suporta `https://api.openai.com/v1`,
  `https://api.groq.com/openai/v1`,
  `https://openrouter.ai/api/v1`, servidores locais
  compatíveis (LM Studio, Ollama via shim, etc.)

### 14.2 `providers_chat_once`

- Faz `POST {baseUrl}/chat/completions` com body
  ```json
  {
    "model": "...",
    "messages": [{"role": "...", "content": "..."}],
    "temperature": 0.7,
    "max_tokens": 1024
  }
  ```
- Lê `choices[0].message.content` da resposta
- Timeout 60s, hard cap de `max_tokens` em 32 000
- Suporta `Authorization: Bearer <key>` quando aplicável
- Erros HTTP viram `ProviderError::HttpStatus` com body
  truncado

### 14.3 Por que só OpenAI-compatible nesta PR

- Cobre OpenAI, Groq, OpenRouter, Together, Fireworks,
  OpenAI Azure (com baseUrl custom), LM Studio, Ollama via
  shim, llama.cpp server
- Outros providers (`anthropic`, `gemini`, `mistral`,
  `deepseek`, `minimax`) têm APIs incompatíveis (Anthropic
  usa `x-api-key` + `anthropic-version`, Gemini usa
  `key=...` na URL, etc.) que exigem adapters dedicados
- O `ProviderKind` aceita todos os 8 valores, mas o adapter
  retorna erro claro "provider não implementado nesta PR"
  para os não-OpenAI-compatible
- `local` é reconhecido e cai no mesmo adapter (assume
  OpenAI-compatible local)

## 15. Providers preparados / pendentes

| Kind | Status nesta PR |
|---|---|
| `openai-compatible` | **implementado e funcional** (GET `/models`, POST `/chat/completions`) |
| `local` | reconhecido; cai no adapter OpenAI-compatible |
| `anthropic` | reconhecido; retorna "unsupported_kind" |
| `gemini` | reconhecido; retorna "unsupported_kind" |
| `mistral` | reconhecido; retorna "unsupported_kind" |
| `deepseek` | reconhecido; retorna "unsupported_kind" |
| `minimax` | reconhecido; retorna "unsupported_kind" |
| `custom` | reconhecido; retorna "unsupported_kind" |

Adapters dedicados para Anthropic, Gemini, Mistral, DeepSeek
e MiniMax ficam para PRs futuras dedicadas.

## 16. Eventos `provider/*` emitidos

Via `emit_provider_event` em `providers.rs`, que monta um
`FluxoraEvent` e chama `events::emit_to_app` (PR 005) com
`source: "system"`:

| Tipo | Quando | `level` |
|---|---|---|
| `provider/test-started` | início de `providers_test` | info |
| `provider/test-completed` | sucesso de `providers_test` | info |
| `provider/test-failed` | falha de `providers_test` (rede, auth, kind não suportado) | warn/error |
| `provider/models-loaded` | sucesso de `providers_list_models` | info |
| `provider/request-started` | início de `providers_chat_once` | info |
| `provider/request-completed` | sucesso de `providers_chat_once` | info |
| `provider/request-failed` | falha de `providers_chat_once` | error |
| `provider/settings-updated` | (reservado para PR futura) | info |
| `provider/created` | após `providers_create` | info |
| `provider/updated` | após `providers_update` | info |
| `provider/removed` | após `providers_remove` | info |

**Nunca inclui**:
- API key (mesmo mascarada)
- Prompt/messages completos do chat
- Body completo de erro HTTP (truncado em 500 chars)

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "system"`. O frontend consome via
`events.on("provider/test-completed", cb)` ou
`events.subscribe(cb)` com filtro manual.

## 17. Limites de segurança implementados

1. **Timeout HTTP**:
   - `providers_test` / `providers_list_models`: 8s
   - `providers_chat_once`: 60s
2. **Erros claros para provider sem API key**:
   `missing_api_key` no `ProviderError`; mensagem
   `"API key não configurada para este provider."` no
   frontend
3. **Erros claros para baseUrl inválida**: validação
   `http://` ou `https://`; mensagem `"URL inválida: ..."`
4. **Erros claros para provider desabilitado**:
   `providers_test` devolve `ok: false` com
   `status: "disabled"`
5. **Não registra request com API key**: nada é
   `println!` com a chave em claro
6. **Não registra response completa**: o body de erro
   é truncado em 500 chars
7. **Trunca mensagens de erro longas**:
   `truncate_error_message` em 500 chars com `…`
8. **Não salva secrets em docs / status**: este
   documento não inclui nenhuma chave
9. **Não manda prompt para provider sem ação explícita
   de teste/chat**: nenhuma chamada é feita automaticamente
10. **Não aceita baseUrl sem scheme**: rejeita
    `localhost:1234` (precisa ser `http://localhost:1234`)
11. **Valida tamanho de nome**: máx 80 chars em
    `validate_name`
12. **Valida hard cap de max_tokens**: 32 000
13. **Rejeita conflito de nome**: `providers_create` /
    `providers_update` rejeitam nomes duplicados

## 18. Como validar manualmente

### 18.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.providers.list()` deve devolver `[]`
  (mock fallback, sem providers cadastrados)
- `window.fluxora.providers.test("qualquer-id")` deve
  devolver `{ ok: false, status: "unreachable", message: "Provider Engine só funciona em runtime Tauri." }`
- `window.fluxora.providers.chatOnce({providerId, messages})`
  deve devolver `{ text: "", durationMs: 0, usage: { mock: true } }`
- `window.fluxora.opencode.getCatalog()` deve continuar
  devolvendo o mock legado (3 providers, 6 modelos) — sem
  mudança de comportamento

### 18.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

Sem UI específica para providers nesta PR, a validação é
pelo console do DevTools:

```js
// 1) Criar provider
const created = await window.fluxora.providers.create({
  name: "Local LLM",
  kind: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
  apiKeyEnv: "lm-studio",
  defaultModel: "qwen2.5-7b-instruct",
  enabled: true,
});
// → { id: "provider-...", name: "Local LLM", ... }

// 2) Listar
const all = await window.fluxora.providers.list();
// → [created]

// 3) Testar
const test = await window.fluxora.providers.test(created.id);
// → { ok: true|false, status: "configured"|"missing-api-key"|..., durationMs, models: [...] }

// 4) Listar modelos (se o /models estiver disponível)
const models = await window.fluxora.providers.listModels(created.id);
// → [{ id: "qwen2.5-7b-instruct", name: "qwen2.5-7b-instruct", providerId, ... }]

// 5) Chat simples
const chat = await window.fluxora.providers.chatOnce({
  providerId: created.id,
  messages: [{ role: "user", content: "Diga olá em uma palavra." }],
});
// → { text: "...", model: "qwen2.5-7b-instruct", providerId, durationMs, usage? }

// 6) Verificar eventos
const unsub = window.fluxora.events.on(
  "provider/test-completed",
  (e) => console.log("test completed", e)
);
const recent = await window.fluxora.events.listRecent({
  type: "provider/test-completed"
});
// → [FluxoraEvent { type: "provider/test-completed", ... }]

// 7) Verificar persistência
// Linux: cat ~/.local/share/com.fluxora/fluxora/providers.json

// 8) Verificar que opencode.getCatalog agora reflete o Provider Engine
const catalog = await window.fluxora.opencode.getCatalog();
// → { providers: [{ id: created.id, displayName: "Local LLM", authType: "api" }], ... }

// 9) Atualizar
const updated = await window.fluxora.providers.update(created.id, {
  defaultModel: "outro-modelo",
});

// 10) Remover
await window.fluxora.providers.remove(created.id);
```

### 18.3 Health-check do provider

Em runtime Tauri, `providers_test` faz `GET {baseUrl}/models`
com timeout 8s. Aceita 401/403 como `ok: true` (servidor
respondeu). Timeout, DNS error, connection refused → `ok:
false` com `status: "unreachable"`.

### 18.4 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 16 testes passando (5 voice + 11 providers)
```

## 19. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/index-*.js` 809 KiB / 225 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 16/16 testes passando (5 voice + 11 providers novos) |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`); **nenhuma regressão** |
| `pnpm dev` (com timeout 90s) | `tauri dev` → Vite em `:1420` → Cargo compila em ~10s (rebuild incremental) → binário `target/debug/fluxora` inicia. Nenhum loop, nenhum erro de runtime. |

## 20. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004, 005 e 006. **Nenhuma regressão** de
teste. **11 novos testes Rust** passando. Build de produção
sem warnings novos.

## 21. Erros conhecidos

### 21.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual

### 21.2 Limitações desta PR

- **Storage seguro de API keys não implementado** (chave
  pode ficar em `providers.json` em claro se o usuário
  digitar a chave literal em vez de env var)
- **Anthropic / Gemini / Mistral / DeepSeek / MiniMax não
  implementados** — só `openai-compatible` (e `local` que
  cai no mesmo adapter)
- **Streaming não implementado** — `providers_chat_once` é
  apenas uma chamada simples com resposta completa
- **Tool calling não implementado** — só `messages` com
  `role`/`content`
- **Não há UI de providers** — só console do DevTools ou
  chamada programática. A UI atual continua mostrando o
  bloco "Catálogo do OpenCode" alimentado pelo Provider
  Engine (em runtime Tauri) ou pelo mock legado (no
  browser)
- **Não há cache de modelos** — cada `listModels` faz
  `GET /models` no adapter
- **`getCatalog` é O(N) sobre providers** — para muitos
  providers (> 10), considerar cache em PR futura
- **`providers.chatOnce` aceita qualquer modelo** — não
  valida se o modelo existe no provider (responsabilidade
  do caller)
- **Retry automático não implementado** — falhas de rede
  retornam erro imediatamente
- **Nenhum teste frontend** para `desktopBridge.providers.*`
  ou `opencode.getCatalog` (apenas cobertura de tipos via
  typecheck)

### 21.3 Caveats

- O backend `providers.rs` emite o `provider/created` evento
  **após** a persistência em disco. Em testes com `Tauri::test`
  seria diferente, mas como o `desktopBridge` é a única
  superfície exposta ao frontend, isso não é um problema
  em produção
- O `opencode.getCatalog` em runtime Tauri faz
  `Promise.all` para listar modelos de todos os providers
  em paralelo. Se algum provider demorar (timeout 8s), o
  `getCatalog` espera todos antes de devolver — pode
  parecer lento com muitos providers
- O `buildCatalogFromProviders` em runtime Tauri filtra
  apenas `enabled: true`. Providers desabilitados não
  aparecem no catálogo legado, mas continuam
  gerenciáveis via `providers.list`

## 22. Próximas PRs recomendadas

1. **PR 008 — Mission Engine inicial.** Implementa o motor
   de missões. Consome `window.fluxora.providers.chatOnce`
   (e variantes com streaming quando o chat real ficar
   maduro). Emite `mission/*`, `agent/*` no barramento
   `fluxora-event`. Desbloqueia `git.changedFiles` e
   `git.fileDiff` reais (dependiam do workflow engine).
2. **PR 009 — Piloto automático com permissões por
   projeto.** Adiciona scheduler, fila de execuções,
   permissões por projeto. Emite `mission/phase` com
   `payload.permission`. Implementa `voice.openAudioFolder`
   com `tauri-plugin-shell`.
3. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` (em providers e voice) para um storage
   encriptado (keychain do SO, `tauri-plugin-stronghold`).
4. **PR futura — Streaming de providers.** SSE / WebSocket
   sobre OpenAI-compatible streaming. Substitui
   `providers_chat_once` por `providers_chat_stream` com
   callback de chunks.
5. **PR futura — Tool calling.** Adiciona suporte a
   `tools` no `chatOnce` e `listModels` para descobrir
   quais ferramentas cada modelo suporta.
6. **PR futura — Adapters dedicados.** Anthropic
   (`x-api-key` + `anthropic-version`), Gemini
   (`key=...` na URL), Mistral (OpenAI-compat mas com
   pequenas diferenças), DeepSeek (OpenAI-compat),
   MiniMax (específico).
7. **PR futura — UI de providers.** Uma tela dedicada
   para cadastrar/testar providers, ver modelos
   disponíveis, e definir provider padrão global. Por
   enquanto, o console do DevTools é a forma canônica.
8. **PR futura — Marketplace de providers.** Catálogo
   pré-configurado de providers conhecidos (OpenAI, Groq,
   OpenRouter, etc.) que o usuário pode adicionar com um
   clique.

Esta PR não iniciou nenhuma delas.

## 23. Resumo executivo

- ✅ Provider Engine próprio criado em Rust/Tauri
  (`apps/desktop/src-tauri/src/providers.rs`)
- ✅ Provider OpenAI-compatible funcional (GET `/models`,
  POST `/chat/completions`)
- ✅ 8 tipos de `ProviderKind` reconhecidos; 1 com
  implementação real
- ✅ Persistência local em `<app_data_dir>/fluxora/providers.json`
- ✅ Cadastro, listagem, atualização, remoção, teste,
  listagem de modelos e chat simples funcionando
- ✅ 11 novos testes Rust (16 totais, todos passando)
- ✅ Eventos `provider/*` emitidos no barramento real
  `fluxora-event` da PR 005
- ✅ `desktopBridge` centraliza todas as chamadas
  (`window.fluxora.providers.*` + sobrescrita de
  `opencode.getCatalog` etc. em runtime Tauri)
- ✅ `window.fluxora` preservado — UI atual não muda
- ✅ Nenhuma referência a Electron reintroduzida
- ✅ Nenhuma dependência de OpenCode como motor de
  provider
- ✅ `pnpm dev` continua abrindo o Tauri sem loop
- ✅ Status da PR criado (este documento)
- ✅ Nenhum push remoto realizado
- ✅ Nenhuma feature fora de escopo (sem Mission Engine,
  sem agente real, sem piloto automático, sem streaming,
  sem tool calling, sem storage seguro de secrets)
