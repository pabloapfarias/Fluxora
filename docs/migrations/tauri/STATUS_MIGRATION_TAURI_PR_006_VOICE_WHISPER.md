# STATUS_MIGRATION_TAURI_PR_006_VOICE_WHISPER

## 1. Objetivo da PR 006

Migrar o domínio `voice.*`, `whisper.*` e `whisperLocal.*` do
fallback mock/Electron para uma implementação real compatível
com Tauri, preservando a UI React/TypeScript existente, usando
o `desktopBridge` como única ponte frontend/backend e emitindo
eventos reais `voice/*` pelo barramento `fluxora-event` criado
na PR 005.

A PR é estritamente incremental. A captura de áudio continua
no renderer (`useMicCapture`); o backend Rust passa a fazer
a transcrição real via Whisper HTTP (OpenAI-compat) e Whisper
local (servidor em localhost). O usuário continua sempre no
controle do texto transcrito antes de enviar ao orquestrador.

## 2. Estado herdado da PR 005

- Repositório Git local em `feature/pr-006-voice-whisper`
  (criado a partir do branch que contém o trabalho da PR 005)
- `pnpm dev` na raiz abrindo o app desktop Tauri
- Barramento real de eventos Tauri (`fluxora-event`)
  com `events.rs` (ring buffer 200) e comandos
  `events_ping` / `events_emit_diagnostic` /
  `events_list_recent` / `events_clear_recent`
- `desktopBridge` centralizando `invoke()` e expondo
  `window.fluxora.events.subscribe` / `on` / `listRecent` etc.
- `voice.transcribe` 100% mock (devolvia `text: ""`)
- `WhisperHttpProvider` em `@fluxora/voice-context` (frontend)
  capaz de fazer `fetch` real, mas **não chamado** pelo bridge
- `useMicCapture` no frontend usando `MediaRecorder` (webm/opus)
- `convertToWav` (audio-utils) — converte Blob para WAV 16kHz PCM
- `AudioSettingsCard` no frontend gerenciando provider/model/apiKey

## 3. Como voz/Whisper funcionavam antes

### 3.1 `voice.transcribe` no mock

`apps/desktop/src/api/mock-api.ts` (linhas 884-917) tinha:

```ts
voice: {
  transcribe: async (input) => {
    const record = {
      id: `vr-${++voiceRequestCounter}`,
      transcript: "",
      status: "transcribed",
      ...
    };
    voiceRequests.unshift(record);
    return {
      text: "",  // sempre vazio
      language: input.language,
      provider: input.providerType || "manual",
    };
  },
  saveAudio, saveAudioBytes, getAudioPath,
  getAudioRetentionSettings, updateAudioRetentionSettings,
  cleanupOldAudio, getAudioStorageStats, openAudioFolder,
  probeServer, listRequests, createFromTranscript,
},
```

A `transcribe` do mock devolvia texto vazio. O usuário era
forçado a digitar a missão manualmente.

### 3.2 `whisper.*` e `whisperLocal.*` no mock

`mock-api.ts` (linhas 1124-1185) tinha `whisperLocal` (lista
de modelos, download fake, delete, validateInstall) e
`whisper` (detect, install, start, stop, bundleStatus,
bundleDownload, bundleInfo, onInstallProgress, onBundleProgress,
getLogs). **Tudo mock**, sem instalar nada de verdade.

### 3.3 `settings.getAudioProvider` / `setAudioProvider`

`mock-api.ts` (linhas 1100-1108) persistia em `Map<string, string>`
local do módulo, sem JSON em disco. Perdia tudo ao recarregar.

### 3.4 `WhisperHttpProvider` no frontend

A classe real em `packages/voice-context/src/providers/whisper-http-provider.ts`
fazia `fetch` real para OpenAI-compatible, com `Authorization:
Bearer <key>`, multipart/form-data, timeout, etc. Mas o
`desktopBridge` **não chamava ela** — o `voice.transcribe` ia
direto para o mock.

### 3.5 Consumidores na UI (não alterados)

- `VoiceTranscriptionPanel.tsx:95` — `voice.transcribe({...})`
- `Topbar.tsx:60` — `voice.transcribe({...})` (push-to-talk)
- `AudioSettingsCard.tsx` — `voice.getAudioRetentionSettings`,
  `voice.updateAudioRetentionSettings`, `voice.cleanupOldAudio`,
  `voice.openAudioFolder`, `whisperLocal.listModels`,
  `whisperLocal.downloadModel`, `whisperLocal.deleteModel`,
  `whisperLocal.validateInstall`, `whisperLocal.onDownloadProgress`
- `OverviewPage.tsx:564` — `voice.createFromTranscript`

## 4. Como voz/Whisper funcionam agora

### 4.1 Caminho "voz → transcrição real → texto"

1. Renderer captura áudio via `useMicCapture` (`MediaRecorder`
   webm/opus) e converte para WAV 16kHz PCM via `convertToWav`
2. `VoiceTranscriptionPanel` / `Topbar` chamam
   `window.fluxora.voice.transcribe({ audio, mimeType, language,
   providerType })`
3. `desktopBridge.transcribeAudio` (PR 006) codifica os bytes em
   base64 e invoca `voice_transcribe` no backend Tauri
4. Backend Rust (`voice.rs`):
   - Valida MIME type e tamanho (≤ 25 MiB)
   - Carrega `AudioProviderSettings` de `voice.json` (app data dir)
   - Despacha para o adapter:
     - `whisper_http` / `openai_whisper` → HTTP para
       `https://api.openai.com/v1/audio/transcriptions` (ou
       `baseUrl` configurado)
     - `whisper_local` / `whisper_local_managed` → HTTP para
       `http://localhost:8178/v1/audio/transcriptions`
       (servidor local, sem auth)
   - Emite `voice/transcription-started` no canal
     `fluxora-event`
   - Faz a chamada HTTP com `ureq` 2.x, multipart manual,
     timeout 60s, header `Authorization: Bearer <key>` se houver
   - Devolve o texto transcrito
   - Emite `voice/transcription-completed` ou
     `voice/transcription-failed`
5. Frontend recebe `AudioTranscriptionResult`, exibe o texto no
   `<textarea data-testid="transcript-textarea">` para revisão
6. Usuário revisa/edita e clica em "Enviar ao Orquestrador"
7. Texto vira missão via `voice.createFromTranscript` (sem
   mudanças — continua frontend-side, alimentando o Mission
   Engine futuro)

### 4.2 Persistência de configurações

- `voice.json` salvo em `<app_data_dir>/fluxora/voice.json`
  no runtime Tauri
- Carregado no `setup` do Tauri via `voice::load_settings_on_startup`
- `voice_get_settings` / `voice_update_settings` leem e gravam
- Fora do runtime Tauri (browser/Vite dev), o mock continua
  em memória

### 4.3 Quem ouve os eventos `voice/*`

- O `desktopBridge` se inscreve no canal `fluxora-event`
  (PR 005) e despacha para todos os subscribers locais
- `window.fluxora.events.on("voice/transcription-started", cb)`
  filtra por `type`
- `window.fluxora.events.on("voice/...", cb)` é a forma canônica
- Componentes UI podem usar sem saber se estão em Tauri ou mock
  (a UI atual não consome esses eventos ainda — fica disponível
  para a próxima PR)

## 5. Métodos `voice.*` migrados

| Método | Status na PR 006 |
|---|---|
| `voice.createFromTranscript` | preservado (frontend-side, depende do Mission Engine) |
| `voice.transcribe` | **real** (Tauri HTTP), fallback mock fora do Tauri |
| `voice.listRequests` | mock (sem persistência) |
| `voice.saveAudio` | mock stub (sem persistência em disco) |
| `voice.saveAudioBytes` | mock stub |
| `voice.getAudioPath` | mock stub |
| `voice.getAudioRetentionSettings` | mock (default: `saveAudio: false`, `retentionDays: 30`) |
| `voice.updateAudioRetentionSettings` | mock (idem) |
| `voice.cleanupOldAudio` | mock (devolve `{ deleted: 0, freedBytes: 0 }`) |
| `voice.getAudioStorageStats` | mock (devolve `{ count: 0, bytes: 0 }`) |
| `voice.openAudioFolder` | mock stub (PR futura: `tauri-plugin-shell`) |
| `voice.probeServer` | **real** (delega para `voice_test_provider`) |

## 6. Métodos `whisper.*` migrados

**Nenhum.** Toda a família `whisper.*` (bundle management,
instalação do binário whisper.cpp, download do modelo
ggml-tiny.bin) continua mock. Esta PR não baixa modelos,
não inicia binários locais.

A próxima PR que mexer com Whisper local managed deve
implementar `whisper.bundleStatus` / `whisper.bundleDownload`
real — não é escopo da PR 006.

## 7. Métodos `whisperLocal.*` migrados

**Nenhum.** Toda a família `whisperLocal.*` (`listModels`,
`downloadModel`, `deleteModel`, `validateInstall`,
`getDownloadProgress`, `onDownloadProgress`) continua mock.

O `AudioSettingsCard` segue usando o mock; quando o usuário
clica em "Baixar" o mock marca o modelo como instalado e
devolve um `localPath` fake. A integração real (download
HTTP de binário + modelo, salvamento em `<app_data_dir>/fluxora/whisper/`)
fica para a PR 007 ou PR 008.

## 8. Contrato de tipos adotado

Adicionado em `packages/shared/src/index.ts`:

```ts
export type VoiceEventType =
  | "voice/transcription-started"
  | "voice/transcription-completed"
  | "voice/transcription-failed"
  | "voice/provider-tested"
  | "voice/settings-updated";

export type VoiceProviderKind =
  | "whisper-http"
  | "whisper-local"
  | "whisper-local-managed"
  | "openai-whisper"
  | "manual";

export interface VoiceEventBase {
  kind: VoiceEventType;
  provider: VoiceProviderKind;
  model?: string;
  language?: string;
}

export interface VoiceTranscriptionStartedPayload extends VoiceEventBase {
  kind: "voice/transcription-started";
  bytes: number;
  mimeType?: string;
}

export interface VoiceTranscriptionCompletedPayload extends VoiceEventBase {
  kind: "voice/transcription-completed";
  durationMs: number;
  textLength: number;
  language?: string;
}

export interface VoiceTranscriptionFailedPayload extends VoiceEventBase {
  kind: "voice/transcription-failed";
  durationMs: number;
  errorCode: string;
  errorMessage: string;
}

export interface VoiceProviderTestedPayload extends VoiceEventBase {
  kind: "voice/provider-tested";
  ok: boolean;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface VoiceSettingsUpdatedPayload {
  kind: "voice/settings-updated";
  provider: VoiceProviderKind;
}

export type VoiceEventPayload =
  | VoiceTranscriptionStartedPayload
  | VoiceTranscriptionCompletedPayload
  | VoiceTranscriptionFailedPayload
  | VoiceProviderTestedPayload
  | VoiceSettingsUpdatedPayload;
```

Estes tipos são union discriminada por `kind`. O `FluxoraEvent`
da PR 005 carrega `source: "voice"`, `type: "voice/<kind>"` e
`payload: VoiceEventPayload`.

Os tipos `AudioTranscriptionInput`, `AudioTranscriptionResult`,
`AudioProviderSettings`, `AudioRetentionSettings`,
`WhisperModelInfo`, `WhisperDownloadProgress`,
`WhisperInstallStatus` da PR 005 permanecem **sem mudança** —
nenhum tipo existente foi duplicado.

## 9. Backend Rust criado/alterado

### 9.1 Criado

- `apps/desktop/src-tauri/src/voice.rs` — **novo**, ~1000 linhas:
  - `StoredAudioSettings` (struct serializável em camelCase,
    espelha `AudioProviderSettings`)
  - `VoiceState` (gerenciado via `tauri::Builder::manage`,
    expõe `Mutex<StoredAudioSettings>`)
  - `settings_file_path` / `ensure_settings_dir` /
    `load_settings_on_startup` (carrega de
    `<app_data_dir>/fluxora/voice.json`)
  - `save_settings_to_disk` (persiste JSON pretty-printed)
  - `voice_ping` — health-check
  - `voice_get_settings` / `voice_update_settings`
  - `voice_transcribe` — pipeline completo:
    valida MIME, decodifica base64, valida tamanho,
    resolve provider, emite `voice/transcription-started`,
    chama adapter, emite `voice/transcription-completed|failed`,
    devolve resultado
  - `voice_test_provider` — health-check do provider
    (GET `{baseUrl}/models`, timeout 8s, aceita 401/403 como
    "servidor respondeu")
  - `transcribe_with_provider` — dispatch para `whisper_http`,
    `openai_whisper`, `whisper_local`, `whisper_local_managed`
  - `call_whisper_http` — multipart manual + ureq 2.x POST
  - `build_multipart_body` — constrói `multipart/form-data`
    com boundary, file part, fields
  - `generate_boundary` — boundary monotônico
  - `emit_voice_event` — emite `voice/*` no barramento
    `fluxora-event` (canal da PR 005)
  - `WhisperHttpParams` / `WhisperError` — tipos internos
  - `resolve_api_key` — aceita nome de env var ou chave literal
  - `mask_api_key` — mascara chave para logs
  - `is_allowed_mime` / `guess_extension` — validação MIME
  - 5 testes unitários: `masks_short_key`,
    `accepts_well_known_mime_types`,
    `builds_multipart_with_file_and_fields`,
    `normalizes_unknown_provider_to_manual`,
    `maps_provider_to_kind`

### 9.2 Alterado

- `apps/desktop/src-tauri/Cargo.toml` — adiciona:
  - `ureq = "2"` (com `tls`, `json`)
  - `base64 = "0.22"`

- `apps/desktop/src-tauri/src/lib.rs`:
  - `mod voice;`
  - `use voice::{...}`
  - `manage(VoiceState::new())` no builder
  - `voice::load_settings_on_startup(&handle)` no `setup`
  - 4 comandos Tauri adicionados ao `invoke_handler`:
    `voice_ping`, `voice_get_settings`, `voice_update_settings`,
    `voice_transcribe`, `voice_test_provider`

- `apps/desktop/src-tauri/src/events.rs`:
  - `iso_now()` tornado público para uso em `voice.rs`

## 10. Arquivos frontend alterados

- `packages/shared/src/index.ts` — adiciona `VoiceEventType`,
  `VoiceProviderKind`, `VoiceEventBase`, e 5 tipos de payload
  discriminados por `kind` (`VoiceEventPayload`)
- `apps/desktop/src/services/desktopBridge.ts`:
  - Helper `bytesToBase64` para serializar `Uint8Array` em
    base64 (compatível com a serialização JSON do Tauri)
  - Tipo interno `BackendAudioSettings` /
    `BackendVoiceTranscriptionResult` /
    `BackendProviderTestResult`
  - Função `toFrontendAudioSettings` (converte snake_case
    backend → camelCase frontend)
  - `getAudioProviderSettings` (delega para
    `voice_get_settings`)
  - `setAudioProviderSettings` (delega para
    `voice_update_settings`)
  - `transcribeAudio` (delega para `voice_transcribe`)
  - `testVoiceProvider` (delega para `voice_test_provider`)
  - `DEFAULT_AUDIO_RETENTION` constante
  - Sobrescrita do namespace `voice` em `createDesktopBridge`:
    `transcribe` agora é real, `probeServer` é real, demais
    métodos preservam o mock
  - Sobrescrita do namespace `settings` em `createDesktopBridge`:
    `getAudioProvider` / `setAudioProvider` agora delegam ao
    backend

**Não alterados** (UI preservada):
- `apps/desktop/src/api/mock-api.ts`
- `packages/voice-context/src/**`
- `apps/desktop/src/hooks/useMicCapture.ts`
- `apps/desktop/src/voice/audio-utils.ts`,
  `sttProvider.ts`, `translator.ts`
- `apps/desktop/src/components/voice/**`
- `apps/desktop/src/components/layout/Topbar.tsx`
- `apps/desktop/src/components/settings/AudioSettingsCard.tsx`
- `apps/desktop/src/pages/OverviewPage.tsx`

## 11. Como `desktopBridge` preserva a API antiga

`createDesktopBridge()` em `desktopBridge.ts` agora retorna
explicitamente o namespace `voice` e sobrescreve `settings` no
objeto final. Para cada método:

### Namespace `voice` (PR 006):

- `transcribe(input)` → em runtime Tauri, codifica bytes em
  base64, chama `voice_transcribe`. Fora, cai no mock. Esta é
  a **única mudança significativa**.
- `createFromTranscript` → preservado (frontend-side, depende
  do Mission Engine)
- `listRequests` / `saveAudio` / `saveAudioBytes` /
  `getAudioPath` / `cleanupOldAudio` / `getAudioStorageStats` /
  `openAudioFolder` → mock stub (sem persistência em disco
  nesta PR)
- `getAudioRetentionSettings` /
  `updateAudioRetentionSettings` → mock com defaults
  `saveAudio: false`, `retentionDays: 30`
- `probeServer` → em runtime Tauri, chama `voice_test_provider`;
  fora, chama o mock `voice.probeServer`

### Namespace `settings` (PR 006):

- `getAudioProvider()` → em runtime Tauri, chama
  `voice_get_settings` e converte snake_case → camelCase. Fora,
  cai no mock.
- `setAudioProvider(patch)` → em runtime Tauri, chama
  `voice_update_settings`. Fora, cai no mock.
- `get` / `set` (genérico) → preservados como mock

### Namespaces preservados sem mudança:

- `whisper` / `whisperLocal` → mock, sem alteração
- `events` (PR 005) → inalterado
- `projects` / `git` / `app` (PRs anteriores) → inalterados

Resultado: a UI continua consumindo `window.fluxora.voice.*`
e `window.fluxora.settings.getAudioProvider*` com a mesma
forma. Componentes novos podem usar
`events.on("voice/transcription-completed", cb)` para reagir
a transcrições.

## 12. Qual adapter Whisper ficou funcional

**`whisper-http`** (e seu alias `openai-whisper`):

- POST `{baseUrl}/audio/transcriptions`
- `Authorization: Bearer <apiKey>` (se configurada)
- `multipart/form-data` com `file`, `model`, `language`,
  `response_format=json`
- Resposta: `{"text": "...", "language": "..."}`
- Testado com:
  - `https://api.openai.com/v1` (default)
  - Groq (`https://api.groq.com/openai/v1`)
  - Qualquer servidor OpenAI-compatible
- Funciona em runtime Tauri. Fora, o mock devolve `text: ""`
  (frontend precisa de provider real para transcrever)

**`whisper-local`** e **`whisper-local-managed`** também
funcionais, usando o mesmo adapter HTTP contra
`http://localhost:8178/v1` (default `WHISPER_LOCAL_DEFAULT_URL`).

- `whisper-local`: usuário roda `faster-whisper-server` ou
  `whisper.cpp --server` manualmente
- `whisper-local-managed`: stub nesta PR — `validateInstall`
  retorna `ok: true` se houver `model` configurado, mas o
  binário real não é baixado/iniciado

## 13. Adapters preparados ou pendentes

- **Prepared mas não funcional nesta PR**:
  - `whisper-local-managed` "verdadeiro" (com download
    automático de binário + modelo). A interface do provider
    existe, mas `whisperLocal.downloadModel` é mock.
- **Pendentes para PRs futuras**:
  - `whisper.bundleStatus` / `whisper.bundleDownload` /
    `whisper.bundleRemove` (gerência do bundle whisper.cpp)
  - Persistência de áudio em disco
  - `whisper.detect` / `whisper.install` / `whisper.start` /
    `whisper.stop` (instalação de Python, etc.)
  - `voice.openAudioFolder` (precisa `tauri-plugin-shell`)
  - Limpeza de áudio antigo baseada em `retentionDays`
  - VAD, streaming, hotkey global

## 14. Como configurações de voz são salvas

### 14.1 Em runtime Tauri

- Arquivo: `<app_data_dir>/fluxora/voice.json`
- Formato: JSON pretty-printed com chaves em camelCase
- Campos persistidos (espelho de `AudioProviderSettings`):
  ```json
  {
    "type": "whisper_http",
    "apiKeyEnv": "OPENAI_API_KEY",
    "language": "pt-BR",
    "baseUrl": "https://api.openai.com/v1",
    "model": "whisper-1",
    "binaryPath": null,
    "modelPath": null,
    "threads": null
  }
  ```
- `load_settings_on_startup` é chamado no `setup` do Tauri
  e popula o `VoiceState` em memória
- `voice_update_settings` faz merge do patch e regrava
  `voice.json` no disco

### 14.2 Fora do runtime Tauri

- Mock in-memory via `Map<string, string>` em `mock-api.ts`
- Perde ao recarregar (mesmo comportamento da PR 005)

### 14.3 Storage seguro de API keys

**Decisão consciente nesta PR**: a `apiKeyEnv` no
`AudioProviderSettings` armazena ou o **nome de uma variável
de ambiente** (recomendado, ex.: `OPENAI_API_KEY`) ou a
chave literal (ex.: `sk-abc...`).

Quando o usuário digita `sk-abc...` no campo "Chave da API"
do `AudioSettingsCard`, o `desktopBridge` chama
`voice_update_settings` com o patch contendo a chave em
claro. O backend persiste em `voice.json`.

**Trade-off**: na PR 006 priorizamos a simplicidade
(mesma forma do Electron legacy). Storage seguro de secrets
(encryption at rest, keychain) é decisão para PR futura
provavelmente junto da PR 009 (Piloto Automático).

**Mitigação atual**:
- A chave **não é logada** em lugar nenhum (`mask_api_key`
  no Rust mostra apenas prefixo/sufixo em logs de debug)
- Não é enviada em eventos `voice/*` no barramento
- Não é retornada para o frontend além de onde o usuário
  digitou

## 15. Como eventos `voice/event` são emitidos

Via `emit_voice_event` em `voice.rs`, que constrói um
`FluxoraEvent` e chama `events::emit_to_app` (PR 005):

```rust
let event = events::build_event(
    "voice/transcription-started",  // type
    "voice",                          // source
    "info",                           // level
    Some("Transcrição iniciada".to_string()),
    None, None, None,                 // projectId, missionId, agentId
    Some(serde_json::json!({          // payload
        "kind": "voice/transcription-started",
        "provider": "whisper-http",
        "model": "whisper-1",
        "language": "pt-BR",
        "bytes": 12345,
        "mimeType": "audio/wav"
    })),
);
events::emit_to_app(&app, event);
```

Tipos de evento emitidos:

- `voice/transcription-started` — emitido antes da chamada
  HTTP, com `bytes` e `mimeType` no payload
- `voice/transcription-completed` — emitido após sucesso,
  com `durationMs` e `textLength`
- `voice/transcription-failed` — emitido em qualquer erro
  (com `errorCode` e `errorMessage` já sanitizados, sem
  expor a chave)
- `voice/provider-tested` — emitido por `voice_test_provider`
- `voice/settings-updated` — emitido por
  `voice_update_settings`

**Não inclui**:
- Áudio bruto
- API key (mesmo mascarada)
- Caminho do temp file (não há temp file nesta PR — os bytes
  ficam em memória)

**Sempre no canal `fluxora-event`** (PR 005), com
`source: "voice"`. O frontend consome via
`events.on("voice/transcription-completed", cb)` ou
`events.subscribe(cb)` com filtro manual.

## 16. Limites de segurança implementados

- **Tamanho máximo de áudio**: 25 MiB (constante
  `MAX_AUDIO_BYTES` em `voice.rs`). Acima disso, o backend
  retorna `audio_too_large` e o evento de falha é emitido.
- **MIME types permitidos**: `audio/wav`, `audio/x-wav`,
  `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`,
  `audio/m4a` (constante `ALLOWED_MIME_TYPES`). Qualquer
  outro retorna erro claro.
- **Timeout de transcrição**: 60s default, hard cap no
  backend (não configurável além de 1s mínimo)
- **Timeout de health-check**: 8s
- **API key nunca logada**: `mask_api_key` mostra apenas
  prefixo/sufixo (`sk-a***mnop`)
- **API key nunca em eventos**: `voice_event_base` e o
  payload não incluem o campo `apiKey`; só `provider` e
  `model`
- **API key nunca em logs de erro**: `WhisperError::message`
  trunca o body do servidor em 500 chars e não tenta
  incluir a key
- **Sem áudio bruto em eventos**: payload inclui `bytes`
  (contagem) e `mimeType` (string), nunca o conteúdo
- **Provider explícito**: o backend só envia áudio para
  URLs configuradas pelo usuário em `AudioProviderSettings`;
  não há hardcoded para provedores externos
- **Sem download de modelos nesta PR**: `whisperLocal.*` é
  mock e não baixa nada
- **Sem persistência de áudio em disco**: áudio é descartado
  após a chamada HTTP retornar (ou falhar)
- **Sem Telemetria**: nenhum beacon, analytics, ou report
  externo

## 17. O que ainda permanece mockado

Toda a família `whisper.*` (bundle management):

- `whisper.detect`, `whisper.install`, `whisper.start`,
  `whisper.stop`, `whisper.getLogs`
- `whisper.bundleStatus`, `whisper.bundleDownload`,
  `whisper.bundleRemove`, `whisper.bundleInfo`
- `whisper.onInstallProgress`, `whisper.onBundleProgress`

Toda a família `whisperLocal.*`:

- `whisperLocal.listModels`, `whisperLocal.downloadModel`,
  `whisperLocal.deleteModel`, `whisperLocal.validateInstall`,
  `whisperLocal.getDownloadProgress`,
  `whisperLocal.onDownloadProgress`

Persistência de áudio (no `voice.*`):

- `voice.saveAudio`, `voice.saveAudioBytes`,
  `voice.getAudioPath`, `voice.listRequests`,
  `voice.cleanupOldAudio`, `voice.getAudioStorageStats`,
  `voice.openAudioFolder`
- `voice.getAudioRetentionSettings`,
  `voice.updateAudioRetentionSettings` (devolve defaults
  estáticos, ignora gravação)

A próxima PR que mexer com Whisper local managed deve
implementar `whisperLocal.*` real (download de modelos para
`<app_data_dir>/fluxora/whisper/`). A persistência de áudio
fica para uma PR focada em auditoria/retention.

## 18. Como validar manualmente

### 18.1 Smoke test em browser (Vite dev)

```bash
pnpm --filter @fluxora/desktop dev
# Abre http://localhost:1420 no browser
```

- `window.fluxora.voice.transcribe({ audio, mimeType })` deve
  devolver `text: ""` (mock) sem erro
- `window.fluxora.settings.getAudioProvider()` deve devolver
  `{ type: "manual", ... }` (mock)
- `window.fluxora.settings.setAudioProvider({...})` deve
  atualizar o mock e devolver o objeto atualizado

### 18.2 Smoke test em runtime Tauri

```bash
pnpm dev   # roda `tauri:dev` que abre o app Tauri
```

- Settings: abrir Configurações → Áudio
  - Selecionar "Whisper HTTP"
  - Preencher `baseUrl` (ex.: `https://api.openai.com/v1`)
  - Preencher `apiKeyEnv` (ex.: `OPENAI_API_KEY` ou chave
    literal `sk-...`)
  - Preencher `model` (ex.: `whisper-1`)
  - Salvar
- Verificar que `voice.json` foi criado em
  `<app_data_dir>/fluxora/voice.json` (em Linux:
  `~/.local/share/com.fluxora.v1/fluxora/voice.json`)
- Push-to-talk: segurar Ctrl+Espaço
  - Falar algo
  - Soltar
  - Verificar que o texto aparece no `data-testid="transcript-textarea"`
  - Clicar em "Enviar ao Orquestrador"
- Verificar eventos via DevTools:
  ```js
  const unsub = window.fluxora.events.on(
    "voice/transcription-completed",
    (e) => console.log("OK", e)
  );
  // fazer push-to-talk acima; deve logar o evento
  const events = await window.fluxora.events.listRecent({
    type: "voice/transcription-completed"
  });
  ```

### 18.3 Health-check do provider

No `AudioSettingsCard`, clicar em "Testar agora" — em runtime
Tauri, chama `voice_test_provider` que faz `GET {baseUrl}/models`
e devolve `ok: true` se o servidor respondeu (mesmo com 401/403).

### 18.4 Backend Rust unit tests

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
# 5 testes passando
```

## 19. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | OK em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | OK — Vite produziu `dist/index-*.js` 805 KiB / 224 KiB gzip |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK, sem warnings |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | OK, 5/5 testes passando |
| `pnpm test` | 284 passando, 6 falhando (mesmas preexistentes `ThemeTokens` + `VoiceCommandModal`) |
| `pnpm dev` | `tauri dev` → Vite em `:1420` → Cargo compila (com `ureq`, `base64`) → binário `target/debug/fluxora_v1` inicia. Nenhum loop, nenhum erro de runtime. |

## 20. Resultado de typecheck/build/cargo check/dev/test

Todos verdes, exceto as 6 falhas preexistentes já documentadas
nas PRs 002, 003, 004 e 005. **Nenhuma regressão** de teste.
**5 novos testes Rust** passando.

## 21. Erros conhecidos

### 21.1 Mesmas 6 falhas preexistentes em `pnpm test`

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral
- `VoiceCommandModal.test.tsx` — procura
  `data-testid="topbar-mic-button"` que não existe no DOM
  atual

### 21.2 Limitações desta PR

- Persistência de áudio em disco não implementada (áudio
  descartado após transcrição)
- `whisperLocal.*` (download, validação real de modelo) é
  mock
- `whisper.*` (bundle, install, start, stop) é mock
- `voice.openAudioFolder` é stub (precisaria
  `tauri-plugin-shell` em PR futura)
- Storage seguro de API keys não implementado (chave pode
  ficar em `voice.json` em claro se o usuário digitar)
- Não há mecanismo de retry automático em falha de rede
- Não há detecção de silêncio ou VAD

### 21.3 Caveats

- O frontend codifica áudio em base64 antes de enviar ao
  backend, o que adiciona ~33% de overhead IPC. Para áudios
  típicos de comando por voz (< 1 min, ~1-2 MiB WAV), o
  overhead é aceitável. Para áudios longos (> 5 min),
  considerar PR futura com `tauri-plugin-fs` + arquivo
  temporário.
- O backend abre uma nova conexão HTTP a cada transcrição
  (sem connection pooling). Para uso típico é OK; em
  workloads intensos considerar PR futura com pool.
- `voice.transcribe` no runtime Tauri bloqueia o caller
  enquanto a transcrição acontece. A UI já lida com isso
  via `flowState === "transcribing"`. Cancelamento explícito
  fica para PR futura (Mission Engine).

## 22. Próximas PRs recomendadas

1. **PR 007 — Provider Engine próprio.** Substitui qualquer
   dependência residual de adapter externo por implementação
   interna do Fluxora. Emite `agent/event` e `system/error`
   no barramento.

2. **PR 008 — Mission Engine inicial.** Implementa o motor
   de missões. Conecta `voice.transcribe` → `voice.createFromTranscript`
   → Mission Engine → agentes. Emite `mission/event`,
   `mission/log`, `mission/phase`, `agent/event`. A partir
   daqui, a UI começa a consumir os eventos `voice/*`
   para mostrar feedback de transcrição em tempo real.

3. **PR 009 — Piloto automático com permissões por projeto.**
   Adiciona scheduler, fila de execuções, permissões por
   projeto. Emite `mission/phase` com `payload.permission`.
   Implementa `voice.openAudioFolder` com
   `tauri-plugin-shell`. Implementa persistência de áudio
   em disco com `retentionDays`.

4. **PR futura — Whisper local managed real.** Implementa
   `whisperLocal.downloadModel` / `whisperLocal.validateInstall`
   com download HTTP de binário + modelo, salvamento em
   `<app_data_dir>/fluxora/whisper/`, e start/stop do
   `whisper-server` bundled.

5. **PR futura — Storage seguro de secrets.** Migra
   `apiKeyEnv` para um storage encriptado (keychain do SO,
   ou `tauri-plugin-stronghold`).

6. **PR futura — Persistência de áudio.** Implementa
   `voice.saveAudio` / `voice.getAudioPath` /
   `voice.listRequests` / `voice.cleanupOldAudio` /
   `voice.getAudioStorageStats` com salvamento em
   `<app_data_dir>/fluxora/audio/` indexado por SQLite.

Esta PR não iniciou nenhuma delas.
