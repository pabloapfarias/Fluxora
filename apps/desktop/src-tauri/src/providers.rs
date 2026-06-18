// PR 007 — Provider Engine próprio do FluxoraV1
//
// Cria um motor de providers em Rust/Tauri, eliminando a
// dependência conceitual do OpenCode CLI como intermediário para
// chamadas aos modelos de IA. Esta PR entrega apenas a
// infraestrutura de providers; agentes reais, Mission Engine,
// streaming, tool calling e storage seguro de secrets ficam
// para PRs futuras.
//
// Persistência: `<app_data_dir>/fluxora/providers.json` com
// estrutura versionada (`version: 1`).
//
// Adapter real desta PR: `openai-compatible` (POST
// `{baseUrl}/chat/completions`, GET `{baseUrl}/models`).
// Outros tipos (`anthropic`, `gemini`, `mistral`, `deepseek`,
// `minimax`, `local`, `custom`) são reconhecidos pelo tipo
// `ProviderKind` mas o backend retorna erro claro
// "provider não implementado nesta PR" — eles ficam reservados
// para PRs dedicadas.
//
// Toda comunicação de progresso emite eventos `provider/*` no
// barramento `fluxora-event` da PR 005, sem nunca incluir a
// API key em payload.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufRead;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use ureq::{Agent, AgentBuilder};

use crate::events;

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/// Timeout padrão para `providers_test` e `providers_list_models`
/// (health-check de listagem).
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 8_000;

/// Timeout padrão para `providers_chat_once` (chamada simples).
pub const DEFAULT_CHAT_TIMEOUT_MS: u64 = 60_000;

/// Timeout do chat invocado pelo Mission Engine (PR 008). É
/// ligeiramente mais alto que o do provider direto para acomodar
/// missões maiores (contexto do projeto + prompt).
pub const MISSION_CHAT_TIMEOUT_MS: u64 = 90_000;

/// Tamanho máximo de mensagem de erro exposto em eventos/resultados.
const MAX_ERROR_MESSAGE_LEN: usize = 500;

/// Hard cap para `max_tokens` aceito pelo backend.
pub const HARD_MAX_TOKENS: u32 = 32_000;

// PR 012 — Limites de streaming OpenAI-compatible.
// Definem o cap superior para um único `providers_chat_stream`
// (ou `execute_mission_chat_stream` chamado pelo Agent Engine).
// Qualquer violação aborta o stream com erro claro.

/// Timeout total de um stream (envio + leitura de todos os chunks).
/// Maior que `MISSION_CHAT_TIMEOUT_MS` porque o modelo pode levar
/// mais tempo para emitir todos os tokens.
pub const STREAM_TIMEOUT_MS: u64 = 120_000;

/// Número máximo de chunks por stream. Evita loops infinitos
/// ou providers mal-comportados.
pub const MAX_STREAM_CHUNKS: usize = 20_000;

/// Tamanho máximo do texto acumulado por stream (em bytes).
/// 512 KiB é mais que suficiente para respostas típicas de
/// modelos grandes.
pub const MAX_STREAM_ACCUMULATED_BYTES: usize = 512 * 1024;

/// Tamanho máximo de um único delta (em bytes). Limites
/// arbitrários razoáveis; deltas maiores são provavelmente bug
/// do provider.
pub const MAX_STREAM_DELTA_BYTES: usize = 8 * 1024;

/// Lista canônica de `kind` reconhecidos. Usada para validação
/// leve. Adicionar novos valores requer suporte real no adapter.
const VALID_KINDS: &[&str] = &[
    "openai-compatible",
    "anthropic",
    "gemini",
    "mistral",
    "deepseek",
    "minimax",
    "local",
    "custom",
];

/// Lista de `kind` com implementação real nesta PR. Apenas
/// `openai-compatible`. Outros retornam erro claro.
pub const SUPPORTED_KINDS: &[&str] = &["openai-compatible", "local"];

// ---------------------------------------------------------------------------
// Modelo de dados
// ---------------------------------------------------------------------------

/// Capacidades opcionais de um provider/modelo.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_streaming: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_audio: Option<bool>,
}

/// Configuração persistida de um provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProvider {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Nome de env var ou chave literal. Nunca exposto em eventos.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ProviderCapabilities>,
    pub created_at: String,
    pub updated_at: String,
}

/// Modelo exposto por um provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_streaming: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_audio: Option<bool>,
}

/// Arquivo de providers.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProvidersFile {
    #[serde(default = "default_providers_version")]
    pub version: u32,
    #[serde(default)]
    pub providers: Vec<StoredProvider>,
}

fn default_providers_version() -> u32 {
    1
}

// ---------------------------------------------------------------------------
// Estado compartilhado
// ---------------------------------------------------------------------------

/// Estado interno do Provider Engine.
#[derive(Default)]
pub struct ProvidersState {
    pub providers: Mutex<Vec<StoredProvider>>,
}

impl ProvidersState {
    pub fn new() -> Self {
        Self {
            providers: Mutex::new(Vec::new()),
        }
    }

    pub fn snapshot(&self) -> Vec<StoredProvider> {
        self.providers
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn replace(&self, providers: Vec<StoredProvider>) {
        if let Ok(mut guard) = self.providers.lock() {
            *guard = providers;
        }
    }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

fn providers_file_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Não foi possível resolver app_data_dir: {e}"))?;
    Ok(base_dir.join("fluxora").join("providers.json"))
}

fn ensure_providers_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = providers_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Não foi possível criar diretório de providers: {e}"))?;
    }
    Ok(path)
}

fn write_providers_file<R: tauri::Runtime>(
    app: &AppHandle<R>,
    store: &ProvidersFile,
) -> Result<(), String> {
    let path = ensure_providers_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Não foi possível serializar providers: {e}"))?;
    fs::write(&path, content)
        .map_err(|e| format!("Não foi possível salvar {}: {e}", path.display()))
}

/// Carrega os providers na inicialização do Tauri. Falhas de I/O
/// são logadas e descartadas; o app continua com lista vazia
/// até o usuário cadastrar providers.
pub fn load_providers_on_startup<R: tauri::Runtime>(app: &AppHandle<R>) {
    let path = match providers_file_path(app) {
        Ok(p) => p,
        Err(error) => {
            eprintln!("[fluxora providers] app_data_dir indisponível: {error}");
            return;
        }
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
    match serde_json::from_str::<ProvidersFile>(&raw) {
        Ok(parsed) => {
            if let Some(state) = app.try_state::<ProvidersState>() {
                state.replace(parsed.providers);
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora providers] falha ao parsear providers.json ({path:?}): {error}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve a API key a partir de `api_key_env` (que pode ser
/// nome de env var ou chave literal). Mesma semântica da PR 006
/// (voice) — refatoração para helper compartilhado fica para PR
/// futura.
pub(crate) fn resolve_api_key(
    api_key_env: &Option<String>,
    api_key_optional: bool,
) -> Result<Option<String>, String> {
    let Some(raw) = api_key_env else {
        return if api_key_optional {
            Ok(None)
        } else {
            Err("API key não configurada.".to_string())
        };
    };
    if raw.is_empty() {
        return if api_key_optional {
            Ok(None)
        } else {
            Err("API key vazia.".to_string())
        };
    }
    if raw.chars().next().map(|c| c.is_ascii_uppercase() || c == '_').unwrap_or(false)
        && raw
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && raw != "_local_no_key"
    {
        if let Ok(value) = std::env::var(raw) {
            if !value.is_empty() {
                return Ok(Some(value));
            }
        }
    }
    Ok(Some(raw.clone()))
}

/// Mascara API key para uso em logs (prefixo/sufixo).
fn mask_api_key(key: &str) -> String {
    if key.len() <= 8 {
        return "***".to_string();
    }
    format!("{}***{}", &key[..4], &key[key.len() - 4..])
}

/// Trunca mensagens de erro para evitar exposição exagerada.
fn truncate_error_message(input: &str) -> String {
    if input.chars().count() <= MAX_ERROR_MESSAGE_LEN {
        return input.to_string();
    }
    let mut out: String = input.chars().take(MAX_ERROR_MESSAGE_LEN).collect();
    out.push('…');
    out
}

fn normalize_kind(kind: &str) -> String {
    if VALID_KINDS.contains(&kind) {
        kind.to_string()
    } else {
        "custom".to_string()
    }
}

fn is_supported_kind(kind: &str) -> bool {
    SUPPORTED_KINDS.contains(&kind)
}

/// Variante pública de `is_supported_kind` usada por módulos
/// vizinhos (Mission Engine) para decidir se um provider
/// pode ser invocado.
pub fn provider_kind_is_supported(kind: &str) -> bool {
    is_supported_kind(kind)
}

fn generate_provider_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("provider-{millis}-{seq}")
}

fn iso_now() -> String {
    events::iso_now()
}

fn make_error_code(prefix: &str, code: &str) -> String {
    format!("{prefix}_{code}")
}

// ---------------------------------------------------------------------------
// Emissão de eventos `provider/*`
// ---------------------------------------------------------------------------

/// Helper privado que monta e emite um `provider/*` no
/// barramento `fluxora-event` (PR 005). Nunca inclui a API key
/// ou detalhes sensíveis. O `kind` segue o padrão dos demais
/// módulos: `voice/...`, `project/updated`, etc.
fn emit_provider_event<R: tauri::Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    provider_id: Option<&str>,
    provider_name: Option<&str>,
    provider_kind: Option<&str>,
    level: &str,
    payload: serde_json::Value,
) {
    let mut merged = payload;
    if let Some(obj) = merged.as_object_mut() {
        if let Some(id) = provider_id {
            obj.entry("providerId".to_string())
                .or_insert(serde_json::Value::String(id.to_string()));
        }
        if let Some(name) = provider_name {
            obj.entry("providerName".to_string())
                .or_insert(serde_json::Value::String(name.to_string()));
        }
        if let Some(pk) = provider_kind {
            obj.entry("kind2".to_string())
                .or_insert(serde_json::Value::String(pk.to_string()));
        }
        obj.entry("kind".to_string())
            .or_insert(serde_json::Value::String(kind.to_string()));
    }
    let event = events::build_event(
        kind,
        "system",
        level,
        Some(default_message_for_kind(kind)),
        None,
        None,
        None,
        Some(merged),
    );
    events::emit_to_app(app, event);
}

fn default_message_for_kind(kind: &str) -> String {
    match kind {
        "provider/test-started" => "Teste de provider iniciado".to_string(),
        "provider/test-completed" => "Teste de provider concluído".to_string(),
        "provider/test-failed" => "Teste de provider falhou".to_string(),
        "provider/models-loaded" => "Modelos do provider carregados".to_string(),
        "provider/request-started" => "Requisição ao provider iniciada".to_string(),
        "provider/request-completed" => "Requisição ao provider concluída".to_string(),
        "provider/request-failed" => "Requisição ao provider falhou".to_string(),
        "provider/stream-started" => "Stream de provider iniciado".to_string(),
        "provider/stream-chunk" => "Chunk de stream de provider recebido".to_string(),
        "provider/stream-completed" => "Stream de provider concluído".to_string(),
        "provider/stream-failed" => "Stream de provider falhou".to_string(),
        "provider/settings-updated" => "Configurações de provider atualizadas".to_string(),
        "provider/created" => "Provider criado".to_string(),
        "provider/updated" => "Provider atualizado".to_string(),
        "provider/removed" => "Provider removido".to_string(),
        _ => format!("Evento provider: {kind}"),
    }
}

// PR 012 — Helper para emitir eventos `provider/stream-*` no
// barramento `fluxora-event`. Mesma forma do `emit_provider_event`
// mas com defaults apropriados para o ciclo de vida do stream.
// Nunca inclui API key nem `messages` no payload — apenas
// metadados de progresso e o `delta` incremental.
fn emit_stream_event<R: tauri::Runtime>(
    app: &AppHandle<R>,
    kind: &str,
    provider_id: &str,
    provider_name: &str,
    provider_kind: &str,
    level: &str,
    payload: serde_json::Value,
) {
    let event = events::build_event(
        kind,
        "provider",
        level,
        Some(default_message_for_kind(kind)),
        None,
        None,
        None,
        Some(payload),
    );
    let _ = (provider_id, provider_name, provider_kind);
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// Payloads de entrada/saída
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProviderPayload {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub capabilities: Option<ProviderCapabilities>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderPayload {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub base_url: Option<Option<String>>,
    #[serde(default)]
    pub api_key_env: Option<Option<String>>,
    #[serde(default)]
    pub default_model: Option<Option<String>>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub capabilities: Option<ProviderCapabilities>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResultPayload {
    pub ok: bool,
    pub provider_id: String,
    pub status: String,
    pub message: Option<String>,
    pub duration_ms: u64,
    pub models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOncePayload {
    pub provider_id: String,
    #[serde(default)]
    pub model: Option<String>,
    pub messages: Vec<ChatMessagePayload>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOnceResultPayload {
    pub text: String,
    pub model: Option<String>,
    pub provider_id: String,
    pub duration_ms: u64,
    pub usage: Option<serde_json::Value>,
}

// PR 012 — Payloads de streaming OpenAI-compatible.

/// Request aceito por `providers_chat_stream`. Igual a
/// `ChatOncePayload` (com `stream: true` implícito).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamPayload {
    pub provider_id: String,
    #[serde(default)]
    pub model: Option<String>,
    pub messages: Vec<ChatMessagePayload>,
    #[serde(default)]
    #[allow(dead_code)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub request_id: Option<String>,
}

/// Resultado final de `providers_chat_stream`. Retornado ao
/// frontend quando o stream termina. Inclui `chunks` para
/// diagnóstico (limite: 20 000).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStreamResultPayload {
    pub request_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub text: String,
    pub duration_ms: u64,
    pub chunks: u32,
    pub usage: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Erros internos do adapter
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ProviderError {
    MissingConfig(String),
    InvalidUrl(String),
    UnsupportedKind(String),
    Network(String),
    HttpStatus { status: u16, body: String },
    InvalidResponse(String),
    NoApiKey,
    /// Erro retornado pelo callback do stream (ex.: Agent
    /// Engine sinaliza cancelamento ou erro ao processar um
    /// chunk). Nunca inclui API key.
    Callback(String),
}

impl ProviderError {
    fn code(&self) -> &'static str {
        match self {
            ProviderError::MissingConfig(_) => "missing_config",
            ProviderError::InvalidUrl(_) => "invalid_url",
            ProviderError::UnsupportedKind(_) => "unsupported_kind",
            ProviderError::Network(_) => "network_error",
            ProviderError::HttpStatus { .. } => "http_error",
            ProviderError::InvalidResponse(_) => "invalid_response",
            ProviderError::NoApiKey => "missing_api_key",
            ProviderError::Callback(_) => "callback_error",
        }
    }

    fn message(&self) -> String {
        match self {
            ProviderError::MissingConfig(m) => m.clone(),
            ProviderError::InvalidUrl(m) => format!("URL inválida: {m}"),
            ProviderError::UnsupportedKind(k) => format!(
                "Provider '{k}' ainda não implementado nesta PR. Suportados: {}.",
                SUPPORTED_KINDS.join(", ")
            ),
            ProviderError::Network(m) => format!("Falha de rede: {m}"),
            ProviderError::HttpStatus { status, body } => {
                let body_snip = truncate_error_message(body);
                format!("Provider respondeu {status}: {body_snip}")
            }
            ProviderError::InvalidResponse(m) => format!("Resposta inválida: {m}"),
            ProviderError::NoApiKey => "API key não configurada para este provider.".to_string(),
            ProviderError::Callback(m) => format!("Callback do stream falhou: {m}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Adapter OpenAI-compatible
// ---------------------------------------------------------------------------

/// Faz `GET {baseUrl}/models` em um servidor OpenAI-compatible.
/// Aceita 401/403 como "servidor respondeu, credencial
/// possivelmente inválida" (igual ao `voice_test_provider`).
fn openai_list_models(
    base_url: &str,
    api_key: Option<&str>,
    timeout: Duration,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let agent: Agent = AgentBuilder::new().timeout(timeout).build();
    let mut request = agent.get(&url).timeout(timeout);
    if let Some(key) = api_key {
        request = request.set("Authorization", &format!("Bearer {key}"));
    }

    match request.call() {
        Ok(response) => {
            let status = response.status();
            if status == 401 || status == 403 {
                return Err(ProviderError::HttpStatus {
                    status,
                    body: "Autenticação rejeitada.".to_string(),
                });
            }
            if status >= 400 {
                let body = response.into_string().unwrap_or_default();
                return Err(ProviderError::HttpStatus { status, body });
            }
            let payload: serde_json::Value = response
                .into_json()
                .map_err(|e| ProviderError::InvalidResponse(e.to_string()))?;
            parse_models_response(payload, base_url)
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            if status == 401 || status == 403 {
                Err(ProviderError::HttpStatus {
                    status,
                    body: "Autenticação rejeitada.".to_string(),
                })
            } else {
                Err(ProviderError::HttpStatus { status, body })
            }
        }
        Err(ureq::Error::Transport(transport)) => {
            Err(ProviderError::Network(transport.to_string()))
        }
    }
}

fn parse_models_response(
    payload: serde_json::Value,
    _base_url: &str,
) -> Result<Vec<ModelInfo>, ProviderError> {
    // Formato OpenAI: { "data": [ { "id": "...", ... }, ... ] }
    let data = payload
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ProviderError::InvalidResponse("campo 'data' ausente".to_string()))?;
    let mut out: Vec<ModelInfo> = Vec::with_capacity(data.len());
    for entry in data {
        if let Some(id) = entry.get("id").and_then(|v| v.as_str()) {
            let owned_id = id.to_string();
            out.push(ModelInfo {
                id: owned_id.clone(),
                provider_id: String::new(), // preenchido pelo caller
                name: owned_id,
                display_name: entry
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                context_window: None,
                supports_streaming: None,
                supports_tools: None,
                supports_vision: None,
                supports_audio: None,
            });
        }
    }
    Ok(out)
}

fn openai_chat_once(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[ChatMessagePayload],
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    timeout: Duration,
) -> Result<(String, Option<serde_json::Value>), ProviderError> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let msgs_json: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": msgs_json,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(mt) = max_tokens {
        body["max_tokens"] = serde_json::json!(mt);
    }

    let agent: Agent = AgentBuilder::new().timeout(timeout).build();
    let mut request = agent
        .post(&url)
        .set("Content-Type", "application/json")
        .timeout(timeout);
    if let Some(key) = api_key {
        request = request.set("Authorization", &format!("Bearer {key}"));
    }

    let body_str = serde_json::to_string(&body)
        .map_err(|e| ProviderError::InvalidResponse(format!("serialize: {e}")))?;

    match request.send_string(&body_str) {
        Ok(response) => {
            let status = response.status();
            if status >= 400 {
                let resp_body = response.into_string().unwrap_or_default();
                return Err(ProviderError::HttpStatus {
                    status,
                    body: resp_body,
                });
            }
            let payload: serde_json::Value = response
                .into_json()
                .map_err(|e| ProviderError::InvalidResponse(e.to_string()))?;
            let text = payload
                .get("choices")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let usage = payload.get("usage").cloned();
            Ok((text, usage))
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(ProviderError::HttpStatus { status, body })
        }
        Err(ureq::Error::Transport(transport)) => {
            Err(ProviderError::Network(transport.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// PR 012 — Streaming OpenAI-compatible (SSE)
// ---------------------------------------------------------------------------
//
// Implementa `stream: true` sobre o adapter OpenAI-compatible.
// O formato esperado é:
//
//   data: {"choices":[{"delta":{"content":"..."}}]}
//   data: {"choices":[{"delta":{"content":"..."}}]}
//   ...
//   data: [DONE]
//
// Linhas vazias, comentários (`: ...`) e campos não-`data`
// (`event:`, `id:`, `retry:`) são ignorados. O parser abaixo
// é uma função pura testável unitariamente.

/// Evento extraído de uma linha SSE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SseEvent {
    /// Linha vazia, comentário ou campo não-`data` (ignorado).
    Empty,
    /// `data: [DONE]` — fim do stream.
    Done,
    /// Delta incremental extraído do chunk OpenAI-compatible.
    Delta(String),
    /// JSON cru (chunk válido, mas sem `delta.content` extraível).
    /// Pode acontecer em chunks de "ferramentas" ou quando o
    /// provider usa um campo diferente — contado como chunk mas
    /// sem adicionar texto.
    Raw(String),
}

/// Faz o parse de uma única linha SSE. Retorna o evento
/// correspondente. Esta função é pública para permitir testes
/// unitários sem precisar de I/O.
pub fn parse_sse_line(line: &str) -> SseEvent {
    let trimmed = line.trim_end_matches(['\n', '\r']);
    if trimmed.is_empty() {
        return SseEvent::Empty;
    }
    // Comentário SSE: linhas que começam com `:`.
    if trimmed.starts_with(':') {
        return SseEvent::Empty;
    }
    // Apenas linhas `data:` interessam. Outras (`event:`, `id:`,
    // `retry:`) são ignoradas.
    if !trimmed.starts_with("data:") {
        return SseEvent::Empty;
    }
    let payload = trimmed[5..].trim_start();
    if payload.is_empty() {
        return SseEvent::Empty;
    }
    if payload == "[DONE]" {
        return SseEvent::Done;
    }
    // Tenta parsear JSON. Em caso de falha, devolve `Raw` para
    // que o caller possa contar o chunk mas não falhe o stream
    // por causa de um único JSON malformado.
    let parsed: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return SseEvent::Raw(payload.to_string()),
    };
    // Tenta extrair `choices[0].delta.content` (formato
    // OpenAI-compatible com `stream: true`).
    if let Some(content) = parsed
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| {
            choice
                .get("delta")
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
                // Fallback para adapters que enviam a mensagem
                // inteira no primeiro chunk (sem `delta`).
                .or_else(|| {
                    choice
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str())
                })
        })
    {
        return SseEvent::Delta(content.to_string());
    }
    // Chunk sem `content` (ex.: chunk de finalização, ou chunk
    // de `tool_calls` — fora do escopo desta PR).
    SseEvent::Raw(payload.to_string())
}

/// Resumo de um stream OpenAI-compatible processado por
/// `openai_chat_stream`.
#[derive(Debug, Clone)]
pub struct OpenAIStreamSummary {
    pub text: String,
    pub chunks: u32,
    #[allow(dead_code)]
    pub duration_ms: u64,
}

/// Faz uma chamada de chat OpenAI-compatible com `stream: true`
/// e processa o SSE incrementalmente. Para cada delta extraído
/// (ou seja, não vazio), chama `on_delta(&str)`. O callback
/// pode devolver `Err` para abortar o stream com erro
/// controlado.
fn openai_chat_stream(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[ChatMessagePayload],
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    timeout: Duration,
    mut on_delta: impl FnMut(&str) -> Result<(), String>,
) -> Result<OpenAIStreamSummary, ProviderError> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let msgs_json: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": msgs_json,
        "stream": true,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(mt) = max_tokens {
        body["max_tokens"] = serde_json::json!(mt);
    }

    let agent: Agent = AgentBuilder::new().timeout(timeout).build();
    let mut request = agent
        .post(&url)
        .set("Content-Type", "application/json")
        .timeout(timeout);
    if let Some(key) = api_key {
        request = request.set("Authorization", &format!("Bearer {key}"));
    }
    let body_str = serde_json::to_string(&body)
        .map_err(|e| ProviderError::InvalidResponse(format!("serialize: {e}")))?;

    let response = match request.send_string(&body_str) {
        Ok(r) => r,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(ProviderError::HttpStatus { status, body });
        }
        Err(ureq::Error::Transport(transport)) => {
            return Err(ProviderError::Network(transport.to_string()));
        }
    };
    let status = response.status();
    if status >= 400 {
        let resp_body = response.into_string().unwrap_or_default();
        return Err(ProviderError::HttpStatus {
            status,
            body: resp_body,
        });
    }
    // `into_reader` devolve um `Box<dyn Read + Send + Sync>`
    // que vamos consumir linha a linha.
    let reader = response.into_reader();
    let mut buf = std::io::BufReader::new(reader);

    let started = Instant::now();
    let mut line = String::new();
    let mut full = String::new();
    let mut chunk_count: u32 = 0;
    let mut saw_done = false;
    let mut non_empty_chunks: u32 = 0;

    loop {
        line.clear();
        let read = match buf.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(_n) => {}
            Err(error) => {
                return Err(ProviderError::Network(format!(
                    "Falha de leitura no stream: {error}"
                )));
            }
        };
        let _ = read;
        // Conta como chunk sempre que recebemos uma linha não-vazia
        // e não-comentário.
        let event = parse_sse_line(&line);
        match event {
            SseEvent::Empty => continue,
            SseEvent::Done => {
                saw_done = true;
                break;
            }
            SseEvent::Raw(_) => {
                chunk_count += 1;
                if chunk_count as usize > MAX_STREAM_CHUNKS {
                    return Err(ProviderError::InvalidResponse(format!(
                        "Limite de {MAX_STREAM_CHUNKS} chunks excedido."
                    )));
                }
                continue;
            }
            SseEvent::Delta(delta) => {
                chunk_count += 1;
                if chunk_count as usize > MAX_STREAM_CHUNKS {
                    return Err(ProviderError::InvalidResponse(format!(
                        "Limite de {MAX_STREAM_CHUNKS} chunks excedido."
                    )));
                }
                if delta.len() > MAX_STREAM_DELTA_BYTES {
                    return Err(ProviderError::InvalidResponse(format!(
                        "Delta excede {MAX_STREAM_DELTA_BYTES} bytes."
                    )));
                }
                if full.len() + delta.len() > MAX_STREAM_ACCUMULATED_BYTES {
                    return Err(ProviderError::InvalidResponse(format!(
                        "Texto acumulado excede {MAX_STREAM_ACCUMULATED_BYTES} bytes."
                    )));
                }
                non_empty_chunks += 1;
                full.push_str(&delta);
                on_delta(&delta).map_err(ProviderError::Callback)?;
            }
        }
    }

    if !saw_done && full.is_empty() && non_empty_chunks == 0 {
        return Err(ProviderError::InvalidResponse(
            "Stream encerrado sem [DONE] nem conteúdo.".to_string(),
        ));
    }

    Ok(OpenAIStreamSummary {
        text: full,
        chunks: chunk_count,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Validações de entrada
// ---------------------------------------------------------------------------

fn validate_base_url(base_url: &Option<String>) -> Result<String, ProviderError> {
    let Some(raw) = base_url else {
        return Err(ProviderError::InvalidUrl("baseUrl ausente".to_string()));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::InvalidUrl("baseUrl vazio".to_string()));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(ProviderError::InvalidUrl(
            "baseUrl deve começar com http:// ou https://".to_string(),
        ));
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

fn validate_name(name: &str) -> Result<String, ProviderError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::MissingConfig(
            "O nome do provider não pode estar vazio.".to_string(),
        ));
    }
    if trimmed.chars().count() > 80 {
        return Err(ProviderError::MissingConfig(
            "O nome do provider é muito longo (max 80 chars).".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_model_field(model: &Option<String>) -> Option<String> {
    model
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Comandos Tauri (chamados como wrappers em lib.rs)
// ---------------------------------------------------------------------------

/// Health-check simples do módulo. Usado em smoke-tests.
pub fn providers_ping() -> String {
    iso_now()
}

/// Lista todos os providers configurados.
pub fn providers_list(app: AppHandle) -> Result<Vec<StoredProvider>, String> {
    let state = app.state::<ProvidersState>();
    Ok(state.snapshot())
}

/// Retorna um provider pelo id.
pub fn providers_get(app: AppHandle, id: String) -> Result<Option<StoredProvider>, String> {
    let state = app.state::<ProvidersState>();
    Ok(state.snapshot().into_iter().find(|p| p.id == id))
}

/// Cria um novo provider.
pub fn providers_create(
    app: AppHandle,
    payload: CreateProviderPayload,
) -> Result<StoredProvider, String> {
    let name = validate_name(&payload.name).map_err(|e| e.message())?;
    let kind = normalize_kind(&payload.kind);
    if !is_supported_kind(&kind) {
        // Permitimos criar providers "ainda não suportados" para
        // que o usuário possa cadastrá-los. Eles só falham quando
        // uma chamada real é feita.
    }
    let base_url = match &payload.base_url {
        Some(value) if !value.trim().is_empty() => {
            Some(validate_base_url(&Some(value.clone())).map_err(|e| e.message())?)
        }
        _ => None,
    };
    let api_key_env = payload
        .api_key_env
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let default_model = validate_model_field(&payload.default_model);

    let now = iso_now();
    let stored = StoredProvider {
        id: generate_provider_id(),
        name,
        kind,
        base_url,
        api_key_env,
        default_model,
        enabled: payload.enabled,
        capabilities: payload.capabilities,
        created_at: now.clone(),
        updated_at: now,
    };

    let state = app.state::<ProvidersState>();
    let mut current = state.snapshot();
    if current.iter().any(|p| p.name == stored.name) {
        return Err(format!(
            "Já existe um provider cadastrado com o nome '{}'.",
            stored.name
        ));
    }
    current.push(stored.clone());
    state.replace(current.clone());
    write_providers_file(&app, &ProvidersFile {
        version: 1,
        providers: current,
    })?;

    emit_provider_event(
        &app,
        "provider/created",
        Some(&stored.id),
        Some(&stored.name),
        Some(&stored.kind),
        "info",
        serde_json::json!({}),
    );
    Ok(stored)
}

/// Atualiza um provider.
pub fn providers_update(
    app: AppHandle,
    id: String,
    payload: UpdateProviderPayload,
) -> Result<StoredProvider, String> {
    let state = app.state::<ProvidersState>();
    let mut current = state.snapshot();
    let idx = current
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| format!("Provider {id} não encontrado."))?;
    let mut provider = current[idx].clone();

    if let Some(name) = payload.name {
        let trimmed = validate_name(&name).map_err(|e| e.message())?;
        // Conflito de nome com outro provider.
        if current.iter().any(|p| p.id != id && p.name == trimmed) {
            return Err(format!(
                "Já existe outro provider cadastrado com o nome '{trimmed}'."
            ));
        }
        provider.name = trimmed;
    }
    if let Some(kind) = payload.kind {
        provider.kind = normalize_kind(&kind);
    }
    if let Some(base_url) = payload.base_url {
        provider.base_url = match base_url {
            Some(value) if !value.trim().is_empty() => {
                Some(validate_base_url(&Some(value)).map_err(|e| e.message())?)
            }
            _ => None,
        };
    }
    if let Some(api_key_env) = payload.api_key_env {
        provider.api_key_env = match api_key_env {
            Some(value) if !value.trim().is_empty() => Some(value),
            _ => None,
        };
    }
    if let Some(default_model) = payload.default_model {
        provider.default_model = validate_model_field(&default_model);
    }
    if let Some(enabled) = payload.enabled {
        provider.enabled = enabled;
    }
    if let Some(capabilities) = payload.capabilities {
        provider.capabilities = Some(capabilities);
    }
    provider.updated_at = iso_now();

    current[idx] = provider.clone();
    state.replace(current.clone());
    write_providers_file(&app, &ProvidersFile {
        version: 1,
        providers: current,
    })?;

    emit_provider_event(
        &app,
        "provider/updated",
        Some(&provider.id),
        Some(&provider.name),
        Some(&provider.kind),
        "info",
        serde_json::json!({}),
    );
    Ok(provider)
}

/// Remove um provider.
pub fn providers_remove(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<ProvidersState>();
    let mut current = state.snapshot();
    let before = current.len();
    let removed = current.iter().find(|p| p.id == id).cloned();
    current.retain(|p| p.id != id);
    if current.len() == before {
        return Err(format!("Provider {id} não encontrado."));
    }
    state.replace(current.clone());
    write_providers_file(&app, &ProvidersFile {
        version: 1,
        providers: current,
    })?;

    if let Some(p) = removed {
        emit_provider_event(
            &app,
            "provider/removed",
            Some(&p.id),
            Some(&p.name),
            Some(&p.kind),
            "info",
            serde_json::json!({}),
        );
    }
    Ok(())
}

/// Testa a conexão com o provider. Faz `GET {baseUrl}/models`
/// (com `Authorization: Bearer <key>` quando aplicável).
/// Aceita 401/403 como "servidor respondeu" (`ok: true`).
pub fn providers_test(app: AppHandle, id: String) -> Result<ProviderTestResultPayload, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Provider {id} não encontrado."))?;

    if !provider.enabled {
        emit_provider_event(
            &app,
            "provider/test-failed",
            Some(&provider.id),
            Some(&provider.name),
            Some(&provider.kind),
            "warn",
            serde_json::json!({
                "durationMs": 0,
                "errorCode": "disabled",
                "errorMessage": "Provider desabilitado.",
            }),
        );
        return Ok(ProviderTestResultPayload {
            ok: false,
            provider_id: provider.id.clone(),
            status: "disabled".to_string(),
            message: Some("Provider desabilitado.".to_string()),
            duration_ms: 0,
            models: Vec::new(),
        });
    }

    if !is_supported_kind(&provider.kind) {
        let err = ProviderError::UnsupportedKind(provider.kind.clone());
        emit_provider_event(
            &app,
            "provider/test-failed",
            Some(&provider.id),
            Some(&provider.name),
            Some(&provider.kind),
            "warn",
            serde_json::json!({
                "durationMs": 0,
                "errorCode": err.code(),
                "errorMessage": err.message(),
            }),
        );
        return Ok(ProviderTestResultPayload {
            ok: false,
            provider_id: provider.id.clone(),
            status: "invalid".to_string(),
            message: Some(err.message()),
            duration_ms: 0,
            models: Vec::new(),
        });
    }

    emit_provider_event(
        &app,
        "provider/test-started",
        Some(&provider.id),
        Some(&provider.name),
        Some(&provider.kind),
        "info",
        serde_json::json!({}),
    );

    let started = Instant::now();
    let result = run_provider_test(&provider, DEFAULT_PROBE_TIMEOUT_MS);
    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok(models) => {
            let count = models.len();
            let status = if count > 0 { "configured" } else { "configured" };
            emit_provider_event(
                &app,
                "provider/test-completed",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                "info",
                serde_json::json!({
                    "ok": true,
                    "durationMs": elapsed,
                    "modelsCount": count,
                    "status": status,
                }),
            );
            Ok(ProviderTestResultPayload {
                ok: true,
                provider_id: provider.id.clone(),
                status: status.to_string(),
                message: Some(format!(
                    "Provider respondeu. {count} modelo(s) detectado(s)."
                )),
                duration_ms: elapsed,
                models,
            })
        }
        Err(err) => {
            let code = make_error_code("provider_test", err.code());
            let msg = truncate_error_message(&err.message());
            let status = match err.code() {
                "no_api_key" | "missing_api_key" => "missing-api-key",
                "invalid_url" | "missing_config" => "invalid",
                "network_error" | "http_error" => "unreachable",
                "unsupported_kind" => "invalid",
                _ => "unreachable",
            };
            let level = if status == "missing-api-key" { "warn" } else { "error" };
            emit_provider_event(
                &app,
                "provider/test-failed",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                level,
                serde_json::json!({
                    "durationMs": elapsed,
                    "errorCode": code,
                    "errorMessage": msg,
                    "status": status,
                }),
            );
            Ok(ProviderTestResultPayload {
                ok: false,
                provider_id: provider.id.clone(),
                status: status.to_string(),
                message: Some(msg),
                duration_ms: elapsed,
                models: Vec::new(),
            })
        }
    }
}

fn run_provider_test(
    provider: &StoredProvider,
    timeout_ms: u64,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let timeout = Duration::from_millis(timeout_ms);
    let base_url = validate_base_url(
        &provider
            .base_url
            .clone()
            .or_else(|| default_base_url_for_kind(&provider.kind)),
    )?;
    let api_key = resolve_api_key(&provider.api_key_env, true)
        .map_err(|_m| ProviderError::NoApiKey)?;
    let models = openai_list_models(&base_url, api_key.as_deref(), timeout)?;
    Ok(models
        .into_iter()
        .map(|mut m| {
            m.provider_id = provider.id.clone();
            m
        })
        .collect())
}

/// Lista modelos de um provider. Tenta `GET /models` no adapter
/// correspondente. Se o provider não suportar, devolve `[]` e
/// emite `provider/models-loaded` com `modelsCount: 0` mesmo
/// assim (a UI sabe interpretar).
pub fn providers_list_models(app: AppHandle, id: String) -> Result<Vec<ModelInfo>, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Provider {id} não encontrado."))?;

    if !provider.enabled {
        return Err("Provider desabilitado.".to_string());
    }
    if !is_supported_kind(&provider.kind) {
        return Err(format!(
            "Listagem de modelos não implementada para '{}' nesta PR. Suportados: {}.",
            provider.kind,
            SUPPORTED_KINDS.join(", ")
        ));
    }

    let started = Instant::now();
    let result = run_provider_list_models(&provider, DEFAULT_PROBE_TIMEOUT_MS);
    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok(models) => {
            let count = models.len();
            emit_provider_event(
                &app,
                "provider/models-loaded",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                "info",
                serde_json::json!({
                    "modelsCount": count,
                    "durationMs": elapsed,
                }),
            );
            Ok(models)
        }
        Err(err) => {
            let code = make_error_code("provider_list_models", err.code());
            let msg = truncate_error_message(&err.message());
            emit_provider_event(
                &app,
                "provider/test-failed",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                "error",
                serde_json::json!({
                    "durationMs": elapsed,
                    "errorCode": code,
                    "errorMessage": msg,
                }),
            );
            Err(msg)
        }
    }
}

fn run_provider_list_models(
    provider: &StoredProvider,
    timeout_ms: u64,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let timeout = Duration::from_millis(timeout_ms);
    let base_url = validate_base_url(
        &provider
            .base_url
            .clone()
            .or_else(|| default_base_url_for_kind(&provider.kind)),
    )?;
    let api_key = resolve_api_key(&provider.api_key_env, true)
        .map_err(|_m| ProviderError::NoApiKey)?;
    let models = openai_list_models(&base_url, api_key.as_deref(), timeout)?;
    Ok(models
        .into_iter()
        .map(|mut m| {
            m.provider_id = provider.id.clone();
            m
        })
        .collect())
}

/// `defaultBaseUrlForKind` — apenas para `openai-compatible`.
/// Outros kinds exigem `baseUrl` explícito.
fn default_base_url_for_kind(kind: &str) -> Option<String> {
    if kind == "openai-compatible" || kind == "local" {
        // Sem default seguro para OpenAI; `local` poderia usar
        // algo como `http://localhost:11434/v1` (Ollama), mas
        // não é seguro assumir. O usuário deve informar.
        None
    } else {
        None
    }
}

/// Resultado de `execute_mission_chat` — usado pelo Mission
/// Engine (PR 008) para chamar o adapter OpenAI-compatible
/// **sem** emitir eventos `provider/*`. O Mission Engine emite
/// seus próprios `mission/phase` events; duplicar os dois
/// barulhos polui o barramento.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionChatResult {
    pub text: String,
    pub model: String,
    pub provider_id: String,
    pub provider_name: String,
    pub duration_ms: u64,
    /// Número de chunks recebidos. `0` para chamada
    /// não-streaming (`execute_mission_chat` da PR 007);
    /// `>= 1` para streaming (`execute_mission_chat_stream` da
    /// PR 012).
    pub chunks: u32,
    pub usage: Option<serde_json::Value>,
}

/// Helper público invocado pelo Mission Engine (PR 008) para
/// fazer uma chamada de chat com o adapter OpenAI-compatible
/// sem emitir `provider/*` events. Faz o mesmo trabalho de
/// `providers_chat_once`, mas com timeout mais alto
/// (`MISSION_CHAT_TIMEOUT_MS`) e `max_tokens` configurável.
///
/// Retorna `Err(String)` com mensagem já sanitizada (sem
/// chaves em claro, body truncado em 500 chars) para que o
/// Mission Engine possa exibi-la ao usuário.
pub fn execute_mission_chat(
    app: &AppHandle,
    provider_id: &str,
    model: &str,
    messages: &[ChatMessagePayload],
    max_tokens: Option<u32>,
) -> Result<MissionChatResult, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider {provider_id} não encontrado."))?;

    if !provider.enabled {
        return Err("Provider desabilitado.".to_string());
    }
    if !is_supported_kind(&provider.kind) {
        return Err(format!(
            "Provider '{}' ainda não implementado nesta PR. Suportados: {}.",
            provider.kind,
            SUPPORTED_KINDS.join(", ")
        ));
    }

    let base_url = validate_base_url(
        &provider
            .base_url
            .clone()
            .or_else(|| default_base_url_for_kind(&provider.kind)),
    )
    .map_err(|e| e.message())?;
    let api_key = resolve_api_key(&provider.api_key_env, false).map_err(|e| e)?;
    let max_tokens = max_tokens
        .map(|v| v.min(HARD_MAX_TOKENS).max(1))
        .or(Some(1024));

    let started = Instant::now();
    let result = openai_chat_once(
        &base_url,
        api_key.as_deref(),
        model,
        messages,
        Some(0.7_f32),
        max_tokens,
        Duration::from_millis(MISSION_CHAT_TIMEOUT_MS),
    );
    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok((text, usage)) => Ok(MissionChatResult {
            text,
            model: model.to_string(),
            provider_id: provider.id.clone(),
            provider_name: provider.name.clone(),
            duration_ms: elapsed,
            chunks: 0,
            usage,
        }),
        Err(err) => {
            let msg = truncate_error_message(&err.message());
            // Log com chave mascarada (se houver) para diagnóstico.
            if let Some(key) = &api_key {
                eprintln!(
                    "[fluxora providers] mission chat falhou base_url={base_url} key={} code={} msg={msg}",
                    mask_api_key(key),
                    err.code()
                );
            } else {
                eprintln!(
                    "[fluxora providers] mission chat falhou base_url={base_url} code={} msg={msg}",
                    err.code()
                );
            }
            Err(msg)
        }
    }
}

/// Helper público invocado pelo Agent Engine (PR 011) e pelo
/// comando Tauri `providers_chat_stream` (PR 012) para fazer
/// uma chamada de chat com `stream: true` no adapter
/// OpenAI-compatible. Emite `provider/stream-started`,
/// `provider/stream-chunk` (por delta) e `provider/stream-completed`
/// ou `provider/stream-failed` no barramento `fluxora-event`.
///
/// **Esta função NÃO inclui API key, prompt ou `messages` no
/// payload dos eventos** — apenas metadados de progresso
/// (`requestId`, `providerId`, `model`, `index`,
/// `accumulatedLength`, `delta`) e o `delta` (saída do modelo).
///
/// Quando o provider não suporta streaming, esta função
/// devolve `Err("Provider não suporta streaming")`. O caller
/// (Agent Engine) decide se faz fallback para
/// `execute_mission_chat` (não-streaming) ou se propaga o
/// erro.
pub fn execute_mission_chat_stream(
    app: &AppHandle,
    provider_id: &str,
    model: &str,
    messages: &[ChatMessagePayload],
    max_tokens: Option<u32>,
    request_id: Option<String>,
    mut on_chunk: impl FnMut(String, usize, usize) -> Result<(), String>,
) -> Result<MissionChatResult, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider {provider_id} não encontrado."))?;

    if !provider.enabled {
        return Err("Provider desabilitado.".to_string());
    }
    if !is_supported_kind(&provider.kind) {
        return Err(format!(
            "Provider '{}' ainda não implementado nesta PR. Suportados: {}.",
            provider.kind,
            SUPPORTED_KINDS.join(", ")
        ));
    }
    // Capabilities: quando `supports_streaming === Some(false)`,
    // falhamos imediatamente. Quando `Some(true)` ou `None`,
    // tentamos — adapters OpenAI-compatible modernos aceitam
    // `stream: true`.
    if let Some(caps) = &provider.capabilities {
        if let Some(false) = caps.supports_streaming {
            return Err("Provider não suporta streaming.".to_string());
        }
    }

    let base_url = validate_base_url(
        &provider
            .base_url
            .clone()
            .or_else(|| default_base_url_for_kind(&provider.kind)),
    )
    .map_err(|e| e.message())?;
    let api_key = resolve_api_key(&provider.api_key_env, false).map_err(|e| e)?;
    let max_tokens = max_tokens
        .map(|v| v.min(HARD_MAX_TOKENS).max(1))
        .or(Some(1024));

    let request_id = request_id.unwrap_or_else(|| {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("stream-{millis}-{seq}")
    });
    let message_count = messages.len();
    let api_key_for_log = api_key.clone();

    emit_stream_event(
        app,
        "provider/stream-started",
        &provider.id,
        &provider.name,
        &provider.kind,
        "info",
        serde_json::json!({
            "requestId": &request_id,
            "providerId": &provider.id,
            "providerName": &provider.name,
            "model": model,
            "messageCount": message_count,
            "maxTokens": max_tokens,
        }),
    );

    let started = Instant::now();
    // Acumulador de chunks. `index` é 0-based, monotonamente
    // crescente por stream.
    let mut index: usize = 0;
    let mut accumulated: usize = 0;
    let result = openai_chat_stream(
        &base_url,
        api_key.as_deref(),
        model,
        messages,
        Some(0.7_f32),
        max_tokens,
        Duration::from_millis(STREAM_TIMEOUT_MS),
        |delta| {
            index += 1;
            accumulated += delta.chars().count();
            // Emite o evento de chunk com o índice 0-based.
            emit_stream_event(
                app,
                "provider/stream-chunk",
                &provider.id,
                &provider.name,
                &provider.kind,
                "info",
                serde_json::json!({
                    "requestId": &request_id,
                    "providerId": &provider.id,
                    "providerName": &provider.name,
                    "model": model,
                    "index": index.saturating_sub(1),
                    "delta": delta,
                    "accumulatedLength": accumulated,
                    "done": false,
                }),
            );
            on_chunk(delta.to_string(), index, accumulated)
        },
    );
    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok(summary) => {
            let text_length = summary.text.chars().count();
            emit_stream_event(
                app,
                "provider/stream-completed",
                &provider.id,
                &provider.name,
                &provider.kind,
                "info",
                serde_json::json!({
                    "requestId": &request_id,
                    "providerId": &provider.id,
                    "providerName": &provider.name,
                    "model": model,
                    "durationMs": elapsed,
                    "textLength": text_length,
                    "chunks": summary.chunks,
                }),
            );
            Ok(MissionChatResult {
                text: summary.text,
                model: model.to_string(),
                provider_id: provider.id.clone(),
                provider_name: provider.name.clone(),
                duration_ms: elapsed,
                chunks: summary.chunks,
                usage: None,
            })
        }
        Err(err) => {
            let code = make_error_code("provider_stream", err.code());
            let msg = truncate_error_message(&err.message());
            if let Some(key) = &api_key_for_log {
                eprintln!(
                    "[fluxora providers] stream falhou base_url={base_url} key={} code={} msg={msg}",
                    mask_api_key(key),
                    err.code()
                );
            } else {
                eprintln!(
                    "[fluxora providers] stream falhou base_url={base_url} code={} msg={msg}",
                    err.code()
                );
            }
            emit_stream_event(
                app,
                "provider/stream-failed",
                &provider.id,
                &provider.name,
                &provider.kind,
                "error",
                serde_json::json!({
                    "requestId": &request_id,
                    "providerId": &provider.id,
                    "providerName": &provider.name,
                    "model": model,
                    "durationMs": elapsed,
                    "errorCode": code,
                    "errorMessage": msg,
                }),
            );
            Err(msg)
        }
    }
}

/// Fundação técnica: faz uma chamada simples de chat. Apenas
/// para validação do adapter. O chat real com streaming/tools
/// fica para o Mission Engine (PR 008).
pub fn providers_chat_once(
    app: AppHandle,
    payload: ChatOncePayload,
) -> Result<ChatOnceResultPayload, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == payload.provider_id)
        .ok_or_else(|| format!("Provider {} não encontrado.", payload.provider_id))?;

    if !provider.enabled {
        return Err("Provider desabilitado.".to_string());
    }
    if !is_supported_kind(&provider.kind) {
        return Err(format!(
            "Provider '{}' ainda não implementado nesta PR. Suportados: {}.",
            provider.kind,
            SUPPORTED_KINDS.join(", ")
        ));
    }

    let base_url = validate_base_url(
        &provider
            .base_url
            .clone()
            .or_else(|| default_base_url_for_kind(&provider.kind)),
    )
    .map_err(|e| e.message())?;
    let api_key = resolve_api_key(&provider.api_key_env, false).map_err(|e| e)?;
    let model = payload
        .model
        .clone()
        .or_else(|| provider.default_model.clone())
        .ok_or_else(|| {
            "Nenhum modelo informado e o provider não tem `defaultModel` configurado."
                .to_string()
        })?;
    let max_tokens = payload
        .max_tokens
        .map(|v| v.min(HARD_MAX_TOKENS).max(1))
        .or(Some(1024));

    let message_count = payload.messages.len();
    emit_provider_event(
        &app,
        "provider/request-started",
        Some(&provider.id),
        Some(&provider.name),
        Some(&provider.kind),
        "info",
        serde_json::json!({
            "model": model,
            "messageCount": message_count,
        }),
    );

    let started = Instant::now();
    let result = openai_chat_once(
        &base_url,
        api_key.as_deref(),
        &model,
        &payload.messages,
        payload.temperature,
        max_tokens,
        Duration::from_millis(DEFAULT_CHAT_TIMEOUT_MS),
    );
    let elapsed = started.elapsed().as_millis() as u64;

    match result {
        Ok((text, usage)) => {
            let text_length = text.chars().count();
            emit_provider_event(
                &app,
                "provider/request-completed",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                "info",
                serde_json::json!({
                    "model": model,
                    "durationMs": elapsed,
                    "textLength": text_length,
                }),
            );
            Ok(ChatOnceResultPayload {
                text,
                model: Some(model),
                provider_id: provider.id.clone(),
                duration_ms: elapsed,
                usage,
            })
        }
        Err(err) => {
            let code = make_error_code("provider_chat", err.code());
            let msg = truncate_error_message(&err.message());
            // Log com chave mascarada (se houver) para diagnóstico.
            if let Some(key) = &api_key {
                eprintln!(
                    "[fluxora providers] chat falhou base_url={base_url} key={} code={} msg={msg}",
                    mask_api_key(key),
                    err.code()
                );
            } else {
                eprintln!(
                    "[fluxora providers] chat falhou base_url={base_url} code={} msg={msg}",
                    err.code()
                );
            }
            emit_provider_event(
                &app,
                "provider/request-failed",
                Some(&provider.id),
                Some(&provider.name),
                Some(&provider.kind),
                "error",
                serde_json::json!({
                    "model": model,
                    "durationMs": elapsed,
                    "errorCode": code,
                    "errorMessage": msg,
                }),
            );
            Err(msg)
        }
    }
}

// PR 012 — Comando Tauri para streaming OpenAI-compatible.
// O progresso incremental é emitido pelo barramento
// `fluxora-event` (eventos `provider/stream-*`); o
// `ProviderStreamResultPayload` retornado aqui é o resultado
// final consolidado.
///
/// Faz uma chamada de chat com `stream: true` no adapter
/// OpenAI-compatible. Emite `provider/stream-started` antes
/// de enviar, `provider/stream-chunk` para cada delta
/// incremental, e `provider/stream-completed` (com
/// `textLength` e `chunks`) ou `provider/stream-failed` (com
/// `errorCode`/`errorMessage`) ao final.
///
/// NUNCA inclui a API key, o prompt completo ou as mensagens
/// no payload dos eventos.
pub fn providers_chat_stream(
    app: AppHandle,
    payload: ChatStreamPayload,
) -> Result<ProviderStreamResultPayload, String> {
    let state = app.state::<ProvidersState>();
    let provider = state
        .snapshot()
        .into_iter()
        .find(|p| p.id == payload.provider_id)
        .ok_or_else(|| format!("Provider {} não encontrado.", payload.provider_id))?;

    if !provider.enabled {
        return Err("Provider desabilitado.".to_string());
    }
    if !is_supported_kind(&provider.kind) {
        return Err(format!(
            "Provider '{}' ainda não implementado nesta PR. Suportados: {}.",
            provider.kind,
            SUPPORTED_KINDS.join(", ")
        ));
    }
    let model = payload
        .model
        .clone()
        .or_else(|| provider.default_model.clone())
        .ok_or_else(|| {
            "Nenhum modelo informado e o provider não tem `defaultModel` configurado."
                .to_string()
        })?;
    let max_tokens = payload
        .max_tokens
        .map(|v| v.min(HARD_MAX_TOKENS).max(1))
        .or(Some(1024));

    // Streaming: para a UI, o callback só precisa acumular
    // (não emitimos `agent/step-chunk` aqui — isso é papel do
    // Agent Engine em `agents.rs`).
    let result = execute_mission_chat_stream(
        &app,
        &provider.id,
        &model,
        &payload.messages,
        max_tokens,
        payload.request_id.clone(),
        |_delta, _index, _accumulated| Ok(()),
    )?;

    Ok(ProviderStreamResultPayload {
        request_id: payload.request_id.unwrap_or_else(|| "stream-unknown".to_string()),
        provider_id: result.provider_id,
        provider_name: result.provider_name,
        model: result.model,
        text: result.text,
        duration_ms: result.duration_ms,
        chunks: result.chunks,
        usage: result.usage,
    })
}

// ---------------------------------------------------------------------------
// Testes unitários
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_short_key() {
        assert_eq!(mask_api_key("abcd"), "***");
        assert_eq!(mask_api_key("sk-abcdefghijklmnop"), "sk-a***mnop");
    }

    #[test]
    fn truncates_long_error_message() {
        let big = "x".repeat(MAX_ERROR_MESSAGE_LEN + 100);
        let out = truncate_error_message(&big);
        assert!(out.chars().count() <= MAX_ERROR_MESSAGE_LEN + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn normalizes_unknown_kind_to_custom() {
        assert_eq!(normalize_kind("openai-compatible"), "openai-compatible");
        assert_eq!(normalize_kind("desconhecido"), "custom");
    }

    #[test]
    fn supported_kinds_are_recognized() {
        assert!(is_supported_kind("openai-compatible"));
        assert!(is_supported_kind("local"));
        assert!(!is_supported_kind("anthropic"));
        assert!(!is_supported_kind("custom"));
    }

    #[test]
    fn validate_name_rejects_empty_and_long() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        let big = "a".repeat(81);
        assert!(validate_name(&big).is_err());
        assert!(validate_name("OpenAI").is_ok());
    }

    #[test]
    fn validate_base_url_requires_scheme() {
        assert!(validate_base_url(&None).is_err());
        assert!(validate_base_url(&Some("".to_string())).is_err());
        assert!(validate_base_url(&Some("not-a-url".to_string())).is_err());
        assert!(validate_base_url(&Some("https://api.openai.com/v1".to_string())).is_ok());
        assert!(validate_base_url(&Some("http://localhost:1234/v1/".to_string())).is_ok());
    }

    #[test]
    fn resolve_api_key_env_or_literal() {
        // Sem env setada → cai pra literal
        std::env::remove_var("FLUXORA_TEST_API_KEY_NOT_SET");
        let v = resolve_api_key(&Some("FLUXORA_TEST_API_KEY_NOT_SET".to_string()), false);
        // Sem a env var, o helper aceita como literal (formato de env var).
        assert!(v.is_ok());
        // Chave literal com formato não-env: retornada como literal
        let v = resolve_api_key(&Some("sk-abcdef".to_string()), false).unwrap();
        assert_eq!(v, Some("sk-abcdef".to_string()));
    }

    #[test]
    fn resolve_api_key_optional() {
        // None com optional=true → Ok(None)
        assert_eq!(resolve_api_key(&None, true).unwrap(), None);
        // None com optional=false → Err
        assert!(resolve_api_key(&None, false).is_err());
    }

    #[test]
    fn validates_chat_messages_role() {
        // Apenas validamos que o parser de payload aceita
        // `system`, `user`, `assistant`. O backend confia no
        // frontend para os papéis; aqui só documentamos a forma.
        let payload = ChatOncePayload {
            provider_id: "provider-1".to_string(),
            model: Some("gpt-4o-mini".to_string()),
            messages: vec![
                ChatMessagePayload { role: "system".to_string(), content: "x".to_string() },
                ChatMessagePayload { role: "user".to_string(), content: "oi".to_string() },
            ],
            temperature: Some(0.5),
            max_tokens: Some(256),
        };
        assert_eq!(payload.messages.len(), 2);
    }

    #[test]
    fn parse_models_response_extracts_data_array() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                {"id": "gpt-4o-mini"},
                {"id": "gpt-4o", "display_name": "GPT-4o"}
            ]
        });
        let models = parse_models_response(payload, "https://api.openai.com/v1").unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-4o-mini");
        assert_eq!(models[0].name, "gpt-4o-mini");
        assert_eq!(models[1].id, "gpt-4o");
        assert_eq!(models[1].display_name.as_deref(), Some("GPT-4o"));
    }

    #[test]
    fn parse_models_response_rejects_missing_data() {
        let payload = serde_json::json!({"oops": 1});
        let result = parse_models_response(payload, "https://api.openai.com/v1");
        assert!(result.is_err());
    }

    // PR 012 — Testes do parser SSE.

    #[test]
    fn parse_sse_line_extracts_openai_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"Olá"}}]}"#;
        match parse_sse_line(line) {
            SseEvent::Delta(d) => assert_eq!(d, "Olá"),
            other => panic!("esperado Delta, recebi {:?}", other),
        }
    }

    #[test]
    fn parse_sse_line_handles_done_marker() {
        let line = "data: [DONE]";
        assert_eq!(parse_sse_line(line), SseEvent::Done);
    }

    #[test]
    fn parse_sse_line_ignores_empty_and_comments() {
        assert_eq!(parse_sse_line(""), SseEvent::Empty);
        assert_eq!(parse_sse_line("\n"), SseEvent::Empty);
        assert_eq!(parse_sse_line("\r\n"), SseEvent::Empty);
        assert_eq!(parse_sse_line(": keep-alive"), SseEvent::Empty);
        assert_eq!(parse_sse_line("event: message"), SseEvent::Empty);
        assert_eq!(parse_sse_line("id: 42"), SseEvent::Empty);
        assert_eq!(parse_sse_line("retry: 1000"), SseEvent::Empty);
    }

    #[test]
    fn parse_sse_line_ignores_data_with_empty_payload() {
        assert_eq!(parse_sse_line("data:"), SseEvent::Empty);
        assert_eq!(parse_sse_line("data: "), SseEvent::Empty);
        assert_eq!(parse_sse_line("data:    "), SseEvent::Empty);
    }

    #[test]
    fn parse_sse_line_treats_invalid_json_as_raw() {
        // JSON inválido: não extrai delta, mas não falha.
        let line = r#"data: {invalid json"#;
        match parse_sse_line(line) {
            SseEvent::Raw(s) => assert!(s.contains("invalid")),
            other => panic!("esperado Raw, recebi {:?}", other),
        }
    }

    #[test]
    fn parse_sse_line_handles_message_fallback() {
        // Alguns providers (ex.: ollama sem `stream: true`
        // configurado) podem enviar a mensagem inteira no
        // primeiro chunk em `choices[0].message.content`.
        let line = r#"data: {"choices":[{"message":{"content":"Fallback"}}]}"#;
        match parse_sse_line(line) {
            SseEvent::Delta(d) => assert_eq!(d, "Fallback"),
            other => panic!("esperado Delta, recebi {:?}", other),
        }
    }

    #[test]
    fn parse_sse_line_handles_chunk_without_content() {
        // Chunk de finalização, sem `content`.
        let line = r#"data: {"choices":[{"finish_reason":"stop"}]}"#;
        match parse_sse_line(line) {
            SseEvent::Raw(_) => {}
            other => panic!("esperado Raw, recebi {:?}", other),
        }
    }

    #[test]
    fn parse_sse_line_preserves_leading_space_after_colon() {
        // O protocolo SSE exige um espaço após `data:` (mas é
        // tolerante). Cobre ambos formatos.
        assert!(matches!(
            parse_sse_line(r#"data:{"choices":[{"delta":{"content":"x"}}]}"#),
            SseEvent::Delta(_)
        ));
        assert!(matches!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"content":"x"}}]}"#),
            SseEvent::Delta(_)
        ));
    }

    #[test]
    fn parse_sse_line_handles_multiple_choices_gracefully() {
        // N>=2 choices: pegamos o primeiro.
        let line = r#"data: {"choices":[{"delta":{"content":"A"}},{"delta":{"content":"B"}}]}"#;
        match parse_sse_line(line) {
            SseEvent::Delta(d) => assert_eq!(d, "A"),
            other => panic!("esperado Delta, recebi {:?}", other),
        }
    }

    #[test]
    fn parse_sse_line_handles_crlf_line_endings() {
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\r\n";
        match parse_sse_line(line) {
            SseEvent::Delta(d) => assert_eq!(d, "x"),
            other => panic!("esperado Delta, recebi {:?}", other),
        }
    }
}
