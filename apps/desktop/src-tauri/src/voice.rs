// PR 006 — Voice/Whisper backend
//
// Migra o domínio `voice.*` e `whisper.*` do fallback mock/Electron
// para uma implementação real em Tauri, com persistência de
// configurações em JSON local e transcrição real via Whisper HTTP
// (OpenAI-compat) e Whisper local (servidor em localhost).
//
// Esta PR é estritamente incremental:
// - Captura de áudio continua no frontend (`useMicCapture`).
// - Persistência de áudio (gravação em disco) NÃO é implementada.
// - Download de modelos locais NÃO é implementado (Whisper "managed").
// - Streaming, hotkey global, VAD, Mission Engine: fora do escopo.
//
// Toda comunicação de progresso emite eventos `voice/*` no
// barramento `fluxora-event` criado na PR 005.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use ureq::{Agent, AgentBuilder};

use crate::events;

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/// Tamanho máximo de áudio aceito pelo backend (25 MiB).
/// Cap acima do uso típico (comandos por voz curtos) e abaixo
/// do que pode travar a serialização IPC.
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

/// MIME types permitidos. Qualquer outro retorna erro claro.
const ALLOWED_MIME_TYPES: &[&str] = &[
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/m4a",
];

/// Timeout padrão para transcrição (60s).
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS: u64 = 60_000;

/// Timeout padrão para health-check (8s).
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 8_000;

// ---------------------------------------------------------------------------
// Persistência de AudioProviderSettings
// ---------------------------------------------------------------------------

/// Estado persistido em JSON. Equivalente a
/// `AudioProviderSettings` do `@fluxora/shared`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredAudioSettings {
    #[serde(rename = "type", default)]
    pub provider_type: String,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub model_path: Option<String>,
    #[serde(default)]
    pub threads: Option<u32>,
}

/// Estado interno do módulo, compartilhado entre comandos.
#[derive(Default)]
pub struct VoiceState {
    pub settings: Mutex<StoredAudioSettings>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(StoredAudioSettings::default()),
        }
    }

    pub fn snapshot(&self) -> StoredAudioSettings {
        self.settings
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn update(&self, patch: StoredAudioSettings) -> StoredAudioSettings {
        let mut guard = self.settings.lock().unwrap_or_else(|p| p.into_inner());
        *guard = patch.clone();
        guard.clone()
    }
}

fn settings_file_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Não foi possível resolver app_data_dir: {e}"))?;
    Ok(base_dir.join("fluxora").join("voice.json"))
}

fn ensure_settings_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = settings_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Não foi possível criar diretório de settings: {e}"))?;
    }
    Ok(path)
}

pub fn load_settings_on_startup<R: tauri::Runtime>(app: &AppHandle<R>) {
    let path = match settings_file_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    if !path.exists() {
        return;
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return,
    };
    if raw.trim().is_empty() {
        return;
    }
    match serde_json::from_str::<StoredAudioSettings>(&raw) {
        Ok(parsed) => {
            if let Some(state) = app.try_state::<VoiceState>() {
                let _ = state.update(parsed);
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora voice] falha ao parsear voice.json ({path:?}): {error}"
            );
        }
    }
}

fn save_settings_to_disk<R: tauri::Runtime>(
    app: &AppHandle<R>,
    settings: &StoredAudioSettings,
) -> Result<(), String> {
    let path = ensure_settings_dir(app)?;
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Não foi possível serializar settings: {e}"))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Não foi possível escrever voice.json: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Entrada/saída dos comandos
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsPayload {
    #[serde(default)]
    pub provider_type: Option<String>,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub model_path: Option<String>,
    #[serde(default)]
    pub threads: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribePayload {
    /// Áudio codificado em base64. Vindo do frontend
    /// (`Uint8Array` → `btoa(String.fromCharCode(...))`).
    pub audio_base64: String,
    /// MIME type do áudio (ex.: "audio/wav").
    pub mime_type: String,
    /// Idioma opcional (ex.: "pt-BR").
    #[serde(default)]
    pub language: Option<String>,
    /// Timeout em ms (default 60s, hard cap igual a
    /// `MAX_TRANSCRIPTION_TIMEOUT_MS`).
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscriptionResult {
    pub text: String,
    pub language: Option<String>,
    pub duration_ms: Option<u64>,
    pub provider: String,
    pub model: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/// Emite um evento `voice/*` no barramento `fluxora-event` com
/// `source: "voice"` e o payload discriminado por `kind`. A
/// função nunca falha: erros são logados e descartados, igual
/// ao `emit_to_app` da PR 005.
fn emit_voice_event<R: tauri::Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    _provider: &str,
    payload: serde_json::Value,
) {
    let event = events::build_event(
        kind,
        "voice",
        if kind.ends_with("-failed") { "error" } else { "info" },
        Some(match kind {
            "voice/transcription-started" => "Transcrição iniciada".to_string(),
            "voice/transcription-completed" => "Transcrição concluída".to_string(),
            "voice/transcription-failed" => "Falha na transcrição".to_string(),
            "voice/provider-tested" => "Provider testado".to_string(),
            "voice/settings-updated" => "Configurações de voz atualizadas".to_string(),
            _ => format!("Evento voice: {kind}"),
        }),
        None,
        None,
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

fn map_provider_to_kind(provider_type: &str) -> &'static str {
    match provider_type {
        "whisper_http" => "whisper-http",
        "whisper_local" => "whisper-local",
        "whisper_local_managed" => "whisper-local-managed",
        "openai_whisper" => "openai-whisper",
        "manual" => "manual",
        _ => "manual",
    }
}

fn normalize_provider_type(value: &str) -> &str {
    match value {
        "whisper_http" | "whisper_local" | "whisper_local_managed"
        | "openai_whisper" | "manual" => value,
        _ => "manual",
    }
}

fn is_allowed_mime(mime: &str) -> bool {
    let lower = mime.to_lowercase();
    // aceita com parâmetros: "audio/wav;codecs=pcm"
    let base = lower.split(';').next().unwrap_or("").trim();
    ALLOWED_MIME_TYPES.iter().any(|m| *m == base)
}

fn guess_extension(mime: &str) -> &'static str {
    let base = mime.split(';').next().unwrap_or("").trim();
    match base {
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/m4a" => "m4a",
        "audio/mpeg" => "mp3",
        _ => "bin",
    }
}

/// Lê `apiKeyEnv`. Se for o nome de uma env var real
/// (`^[A-Z_][A-Z0-9_]*$`), lê do ambiente. Senão, trata como
/// chave literal. Retorna `None` se nada configurado.
fn resolve_api_key(api_key_env: &Option<String>, api_key_optional: bool) -> Result<Option<String>, String> {
    let Some(raw) = api_key_env else {
        return if api_key_optional { Ok(None) } else {
            Err("API key não configurada.".to_string())
        };
    };
    if raw.is_empty() {
        return if api_key_optional { Ok(None) } else {
            Err("API key vazia.".to_string())
        };
    }
    // Nome de env var válido → lê do ambiente
    if raw.chars().next().map(|c| c.is_ascii_uppercase() || c == '_').unwrap_or(false)
        && raw.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && raw != "_local_no_key"
    {
        if let Ok(value) = std::env::var(raw) {
            if !value.is_empty() {
                return Ok(Some(value));
            }
        }
    }
    // Senão, trata como chave literal (sk-..., etc.)
    Ok(Some(raw.clone()))
}

/// Mascara uma chave para uso em logs. Mantém prefixo/sufixo.
fn mask_api_key(key: &str) -> String {
    if key.len() <= 8 {
        return "***".to_string();
    }
    format!("{}***{}", &key[..4], &key[key.len() - 4..])
}

// ---------------------------------------------------------------------------
// Adapter Whisper HTTP (compatível com OpenAI)
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct WhisperHttpParams {
    base_url: String,
    api_key: Option<String>,
    model: String,
    language: Option<String>,
    timeout: Duration,
}

#[derive(Debug)]
enum WhisperError {
    MissingConfig(String),
    Network(String),
    HttpStatus { status: u16, body: String },
    InvalidResponse(String),
    EmptyTranscript,
    AudioTooLarge { size: usize, max: usize },
}

impl WhisperError {
    fn code(&self) -> &'static str {
        match self {
            WhisperError::MissingConfig(_) => "missing_config",
            WhisperError::Network(_) => "network_error",
            WhisperError::HttpStatus { .. } => "http_error",
            WhisperError::InvalidResponse(_) => "invalid_response",
            WhisperError::EmptyTranscript => "empty_transcript",
            WhisperError::AudioTooLarge { .. } => "audio_too_large",
        }
    }

    fn message(&self) -> String {
        match self {
            WhisperError::MissingConfig(m) => m.clone(),
            WhisperError::Network(m) => format!("Falha de rede: {m}"),
            WhisperError::HttpStatus { status, body } => {
                let body_snip = body.chars().take(500).collect::<String>();
                format!("Whisper HTTP retornou {status}: {body_snip}")
            }
            WhisperError::InvalidResponse(m) => format!("Resposta inválida: {m}"),
            WhisperError::EmptyTranscript => "Whisper retornou transcrição vazia".to_string(),
            WhisperError::AudioTooLarge { size, max } => {
                format!("Áudio muito grande: {size} bytes (max {max})")
            }
        }
    }
}

/// Constrói manualmente um body multipart/form-data.
/// Cada `field` aparece como text field; `file` aparece como
/// file field com filename e content-type.
fn build_multipart_body(
    boundary: &str,
    file_name: &str,
    file_mime: &str,
    file_bytes: &[u8],
    fields: &[(&str, &str)],
) -> Vec<u8> {
    let mut body: Vec<u8> = Vec::with_capacity(file_bytes.len() + 1024);
    for (k, v) in fields {
        body.extend_from_slice(b"--");
        body.extend_from_slice(boundary.as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{k}\"\r\n\r\n").as_bytes());
        body.extend_from_slice(v.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(b"--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {file_mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n--");
    body.extend_from_slice(boundary.as_bytes());
    body.extend_from_slice(b"--\r\n");
    body
}

fn generate_boundary() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_nanos())
        .unwrap_or(0);
    format!("----fluxora-boundary-{ts}-{seq}")
}

fn call_whisper_http(
    params: &WhisperHttpParams,
    audio: &[u8],
    mime_type: &str,
) -> Result<VoiceTranscriptionResult, WhisperError> {
    if audio.len() > MAX_AUDIO_BYTES {
        return Err(WhisperError::AudioTooLarge {
            size: audio.len(),
            max: MAX_AUDIO_BYTES,
        });
    }

    let url = format!(
        "{}/audio/transcriptions",
        params.base_url.trim_end_matches('/')
    );
    let boundary = generate_boundary();
    let file_ext = guess_extension(mime_type);
    let file_name = format!("audio.{file_ext}");

    let mut fields: Vec<(&str, &str)> = Vec::with_capacity(2);
    fields.push(("model", &params.model));
    if let Some(lang) = &params.language {
        fields.push(("language", lang.as_str()));
    }
    fields.push(("response_format", "json"));

    let body = build_multipart_body(
        &boundary,
        &file_name,
        mime_type,
        audio,
        &fields,
    );

    let content_type = format!("multipart/form-data; boundary={boundary}");

    let mut request = ureq::post(&url)
        .set("Content-Type", &content_type)
        .timeout(params.timeout);

    if let Some(key) = &params.api_key {
        let auth_value = format!("Bearer {key}");
        request = request.set("Authorization", &auth_value);
    }

    let response = request.send_bytes(&body);

    let result = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(status, response)) => {
            let body = response
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect::<String>();
            return Err(WhisperError::HttpStatus { status, body });
        }
        Err(ureq::Error::Transport(transport)) => {
            return Err(WhisperError::Network(transport.to_string()));
        }
    };

    let status = result.status();
    if status >= 400 {
        let body = result.into_string().unwrap_or_default();
        return Err(WhisperError::HttpStatus { status, body });
    }

    let payload: serde_json::Value = result
        .into_json()
        .map_err(|e| WhisperError::InvalidResponse(e.to_string()))?;

    let text = payload
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if text.trim().is_empty() {
        return Err(WhisperError::EmptyTranscript);
    }

    Ok(VoiceTranscriptionResult {
        text: text.trim().to_string(),
        language: params.language.clone().or_else(|| {
            payload
                .get("language")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        }),
        duration_ms: payload
            .get("duration")
            .and_then(|v| v.as_f64())
            .map(|v| (v * 1000.0) as u64),
        provider: "whisper-http".to_string(),
        model: Some(params.model.clone()),
    })
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Health-check simples do módulo de voz.
pub fn voice_ping() -> String {
    events::iso_now()
}

/// Retorna as configurações de áudio persistidas. O frontend
/// usa essa superfície no lugar de `settings.getAudioProvider`.
pub fn voice_get_settings(app: AppHandle) -> Result<StoredAudioSettings, String> {
    let state = app.state::<VoiceState>();
    // Refila do disco em primeira chamada para cobrir updates
    // feitos por outros caminhos em testes.
    Ok(state.snapshot())
}

/// Atualiza e persiste as configurações de áudio.
pub fn voice_update_settings(
    app: AppHandle,
    payload: UpdateSettingsPayload,
) -> Result<StoredAudioSettings, String> {
    let state = app.state::<VoiceState>();
    let mut current = state.snapshot();
    if let Some(v) = payload.provider_type {
        current.provider_type = normalize_provider_type(&v).to_string();
    }
    if let Some(v) = payload.api_key_env {
        current.api_key_env = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.language {
        current.language = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.base_url {
        current.base_url = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.model {
        current.model = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.binary_path {
        current.binary_path = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.model_path {
        current.model_path = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = payload.threads {
        current.threads = Some(v);
    }
    let updated = state.update(current);
    save_settings_to_disk(&app, &updated)?;

    emit_voice_event(
        &app,
        "voice/settings-updated",
        map_provider_to_kind(&updated.provider_type),
        serde_json::json!({
            "kind": "voice/settings-updated",
            "provider": map_provider_to_kind(&updated.provider_type),
        }),
    );

    Ok(updated)
}

/// Faz a transcrição do áudio enviado. O frontend envia
/// `audioBase64` (codificado de `Uint8Array`).
pub fn voice_transcribe(
    app: AppHandle,
    payload: TranscribePayload,
) -> Result<VoiceTranscriptionResult, String> {
    if !is_allowed_mime(&payload.mime_type) {
        return Err(format!(
            "MIME type não suportado: {} (permitidos: {})",
            payload.mime_type,
            ALLOWED_MIME_TYPES.join(", ")
        ));
    }

    let audio_bytes = match base64::engine::general_purpose::STANDARD.decode(&payload.audio_base64) {
        Ok(b) => b,
        Err(error) => {
            return Err(format!("Áudio inválido (base64): {error}"));
        }
    };

    if audio_bytes.is_empty() {
        return Err("Áudio vazio.".to_string());
    }
    if audio_bytes.len() > MAX_AUDIO_BYTES {
        return Err(format!(
            "Áudio muito grande: {} bytes (max {})",
            audio_bytes.len(),
            MAX_AUDIO_BYTES
        ));
    }

    let settings = app.state::<VoiceState>().snapshot();
    let provider_type = normalize_provider_type(&settings.provider_type).to_string();
    let provider_kind = map_provider_to_kind(&provider_type);

    if provider_type == "manual" {
        return Err(
            "Provider de voz em modo manual. Selecione Whisper local ou HTTP nas Configurações."
                .to_string(),
        );
    }

    let effective_language = payload
        .language
        .clone()
        .or_else(|| settings.language.clone());

    // Resolve timeout
    let timeout_ms = payload
        .timeout_ms
        .unwrap_or(DEFAULT_TRANSCRIPTION_TIMEOUT_MS)
        .min(DEFAULT_TRANSCRIPTION_TIMEOUT_MS)
        .max(1_000);

    // Emite evento de início
    emit_voice_event(
        &app,
        "voice/transcription-started",
        provider_kind,
        serde_json::json!({
            "kind": "voice/transcription-started",
            "provider": provider_kind,
            "model": settings.model,
            "language": effective_language,
            "bytes": audio_bytes.len(),
            "mimeType": payload.mime_type,
        }),
    );

    let started = Instant::now();
    let result = transcribe_with_provider(
        &app,
        &provider_type,
        &settings,
        &audio_bytes,
        &payload.mime_type,
        effective_language.as_deref(),
        Duration::from_millis(timeout_ms),
    );

    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok(transcription) => {
            let language_for_event = transcription
                .language
                .clone()
                .or_else(|| effective_language.clone());
            emit_voice_event(
                &app,
                "voice/transcription-completed",
                provider_kind,
                serde_json::json!({
                    "kind": "voice/transcription-completed",
                    "provider": provider_kind,
                    "model": settings.model,
                    "language": language_for_event,
                    "durationMs": elapsed,
                    "textLength": transcription.text.len(),
                }),
            );
            Ok(transcription)
        }
        Err(error) => {
            // Não vaza API key. Mensagem já vem "limpa" do
            // `WhisperError::message`.
            emit_voice_event(
                &app,
                "voice/transcription-failed",
                provider_kind,
                serde_json::json!({
                    "kind": "voice/transcription-failed",
                    "provider": provider_kind,
                    "model": settings.model,
                    "durationMs": elapsed,
                    "errorCode": error.code(),
                    "errorMessage": error.message(),
                }),
            );
            Err(error.message())
        }
    }
}

/// Despacha para o adapter correto baseado no `provider_type`
/// persistido. Apenas `whisper_http`, `openai_whisper` e
/// `whisper_local` (com `whisper_local_managed` caindo no
/// mesmo adapter HTTP local) são suportados nesta PR.
fn transcribe_with_provider(
    _app: &AppHandle,
    provider_type: &str,
    settings: &StoredAudioSettings,
    audio: &[u8],
    mime_type: &str,
    language: Option<&str>,
    timeout: Duration,
) -> Result<VoiceTranscriptionResult, WhisperError> {
    match provider_type {
        "whisper_http" | "openai_whisper" => {
            let base_url = settings
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            let model = settings
                .model
                .clone()
                .unwrap_or_else(|| "whisper-1".to_string());
            let api_key = resolve_api_key(&settings.api_key_env, false).map_err(|m| {
                WhisperError::MissingConfig(m)
            })?;
            let params = WhisperHttpParams {
                base_url,
                api_key,
                model,
                language: language.map(|s| s.to_string()),
                timeout,
            };
            call_whisper_http(&params, audio, mime_type)
        }
        "whisper_local" | "whisper_local_managed" => {
            let base_url = settings
                .base_url
                .clone()
                .unwrap_or_else(|| "http://localhost:8178/v1".to_string());
            let model = settings
                .model
                .clone()
                .unwrap_or_else(|| "whisper-1".to_string());
            // Servidor local geralmente não exige auth, mas se
            // tiver `apiKeyEnv` configurado, envia.
            let api_key = resolve_api_key(&settings.api_key_env, true).map_err(|m| {
                WhisperError::MissingConfig(m)
            })?;
            let params = WhisperHttpParams {
                base_url,
                api_key,
                model,
                language: language.map(|s| s.to_string()),
                timeout,
            };
            call_whisper_http(&params, audio, mime_type)
        }
        _ => Err(WhisperError::MissingConfig(format!(
            "Provider '{provider_type}' não é suportado pelo backend Rust nesta PR. Use 'whisper_http', 'whisper_local' ou 'whisper_local_managed'."
        ))),
    }
}

/// Health-check simples de um provider configurado, sem
/// enviar áudio. Faz `GET {baseUrl}/models` (compatível com
/// OpenAI) e devolve `ok` + mensagem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProviderTestResult {
    pub ok: bool,
    pub provider: String,
    pub base_url: String,
    pub model: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub duration_ms: u64,
}

pub fn voice_test_provider(app: AppHandle) -> Result<VoiceProviderTestResult, String> {
    let state = app.state::<VoiceState>();
    let settings = state.snapshot();
    let provider_type = normalize_provider_type(&settings.provider_type).to_string();
    let provider_kind = map_provider_to_kind(&provider_type);
    let started = Instant::now();

    let (base_url, model, api_key_optional) = match provider_type.as_str() {
        "whisper_http" | "openai_whisper" => (
            settings
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            settings.model.clone(),
            false,
        ),
        "whisper_local" | "whisper_local_managed" => (
            settings
                .base_url
                .clone()
                .unwrap_or_else(|| "http://localhost:8178/v1".to_string()),
            settings.model.clone(),
            true,
        ),
        "manual" => {
            return Ok(VoiceProviderTestResult {
                ok: true,
                provider: provider_kind.to_string(),
                base_url: "".to_string(),
                model: None,
                error_code: None,
                error_message: Some("Provider manual: sem transcrição automática.".to_string()),
                duration_ms: 0,
            });
        }
        other => {
            return Err(format!("Provider '{other}' não suportado nesta PR."));
        }
    };

    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let api_key = resolve_api_key(&settings.api_key_env, api_key_optional).map_err(|e| e)?;

    let agent: Agent = AgentBuilder::new()
        .timeout(Duration::from_millis(DEFAULT_PROBE_TIMEOUT_MS))
        .build();

    let mut request = agent.get(&url).timeout(Duration::from_millis(DEFAULT_PROBE_TIMEOUT_MS));
    if let Some(key) = &api_key {
        request = request.set("Authorization", &format!("Bearer {key}"));
    }

    let result = request.call();
    let elapsed = started.elapsed().as_millis() as u64;

    let (ok, error_code, error_message) = match result {
        Ok(response) => {
            let status = response.status();
            if status < 400 || status == 401 || status == 403 {
                (true, None, None)
            } else {
                let body = response.into_string().unwrap_or_default();
                (
                    false,
                    Some(format!("http_{status}")),
                    Some(format!(
                        "Servidor respondeu com status {status}: {}",
                        body.chars().take(200).collect::<String>()
                    )),
                )
            }
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            if status == 401 || status == 403 {
                (true, None, Some(format!("Autenticação rejeitada ({status}), mas servidor respondeu.")))
            } else {
                (
                    false,
                    Some(format!("http_{status}")),
                    Some(format!(
                        "Servidor respondeu com status {status}: {}",
                        body.chars().take(200).collect::<String>()
                    )),
                )
            }
        }
        Err(ureq::Error::Transport(t)) => {
            let msg = t.to_string();
            // Erros comuns de localhost offline
            let code = if msg.contains("Connection refused")
                || msg.contains("connection refused")
                || msg.contains("timed out")
                || msg.contains("Name or service not known")
            {
                "server_unreachable"
            } else {
                "network_error"
            };
            (false, Some(code.to_string()), Some(msg))
        }
    };

    let test_result = VoiceProviderTestResult {
        ok,
        provider: provider_kind.to_string(),
        base_url: base_url.clone(),
        model,
        error_code: error_code.clone(),
        error_message: error_message.clone(),
        duration_ms: elapsed,
    };

    // Emite evento
    let mut payload = serde_json::json!({
        "kind": "voice/provider-tested",
        "provider": provider_kind,
        "ok": ok,
        "durationMs": elapsed,
    });
    if let Some(code) = &error_code {
        payload["errorCode"] = serde_json::json!(code);
    }
    if let Some(msg) = &error_message {
        payload["errorMessage"] = serde_json::json!(msg);
    }
    emit_voice_event(&app, "voice/provider-tested", provider_kind, payload);

    // Não loga a API key. Mensagens do `ureq` não costumam
    // incluir a chave, mas se a env var existe e o usuário
    // está depurando, mostrar a versão mascarada pode ajudar.
    if let Some(key) = &api_key {
        eprintln!(
            "[fluxora voice] provider test base_url={base_url} key={} ok={ok}",
            mask_api_key(key)
        );
    }

    Ok(test_result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_short_key() {
        assert_eq!(mask_api_key("abcd"), "***");
        assert_eq!(
            mask_api_key("sk-abcdefghijklmnop"),
            "sk-a***mnop"
        );
    }

    #[test]
    fn accepts_well_known_mime_types() {
        assert!(is_allowed_mime("audio/wav"));
        assert!(is_allowed_mime("audio/wav;codecs=pcm"));
        assert!(is_allowed_mime("audio/webm"));
        assert!(is_allowed_mime("audio/ogg"));
        assert!(is_allowed_mime("audio/mp4"));
        assert!(!is_allowed_mime("text/plain"));
    }

    #[test]
    fn builds_multipart_with_file_and_fields() {
        let body = build_multipart_body(
            "BOUNDARY",
            "audio.wav",
            "audio/wav",
            b"RIFF....",
            &[("model", "whisper-1"), ("response_format", "json")],
        );
        let s = String::from_utf8_lossy(&body);
        assert!(s.contains("name=\"model\""));
        assert!(s.contains("whisper-1"));
        assert!(s.contains("name=\"file\""));
        assert!(s.contains("filename=\"audio.wav\""));
        assert!(s.contains("Content-Type: audio/wav"));
        assert!(s.contains("RIFF...."));
        assert!(s.ends_with("--BOUNDARY--\r\n"));
    }

    #[test]
    fn normalizes_unknown_provider_to_manual() {
        assert_eq!(normalize_provider_type("whisper_http"), "whisper_http");
        assert_eq!(normalize_provider_type("whisper_local"), "whisper_local");
        assert_eq!(normalize_provider_type("desconhecido"), "manual");
    }

    #[test]
    fn maps_provider_to_kind() {
        assert_eq!(map_provider_to_kind("whisper_http"), "whisper-http");
        assert_eq!(map_provider_to_kind("whisper_local"), "whisper-local");
        assert_eq!(map_provider_to_kind("whisper_local_managed"), "whisper-local-managed");
        assert_eq!(map_provider_to_kind("manual"), "manual");
    }
}
