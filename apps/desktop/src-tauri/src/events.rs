// PR 005 — Barramento de eventos do Fluxora
//
// Define o tipo `FluxoraEvent` (a contraparte Rust do tipo em
// `@fluxora/shared`), um ring buffer em memória para eventos recentes
// e comandos Tauri para diagnóstico, listagem e limpeza.
//
// Toda a comunicação frontend ↔ backend é feita pelo canal único
// `fluxora-event` (configurado em `lib.rs`). O `type` dentro do
// payload diferencia o significado do evento (ex.: "app/ready",
// "project/updated", "system/error").
//
// Esta PR não persiste eventos em disco. O ring buffer vive apenas
// na memória do processo, com capacidade fixa, e é reiniciado a
// cada inicialização do app. Persistência será tratada em PR
// dedicada, junto do Mission Engine.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Canal único do barramento de eventos do Fluxora no Tauri.
/// O frontend escuta este canal via `@tauri-apps/api/event`.
pub const FLUXORA_EVENT_CHANNEL: &str = "fluxora-event";

/// Capacidade máxima do ring buffer de eventos recentes.
/// Mantém o uso de memória previsível mesmo em sessões longas.
const RECENT_EVENTS_CAPACITY: usize = 200;

/// Códigos de severidade aceitos pelo backend. Mantidos em
/// sincronia com `FluxoraEventLevel` em `@fluxora/shared`.
const LEVELS: &[&str] = &["debug", "info", "warn", "error"];

/// Códigos de origem aceitos pelo backend. Mantidos em
/// sincronia com `FluxoraEventSource` em `@fluxora/shared`.
const SOURCES: &[&str] = &["app", "project", "mission", "agent", "voice", "system"];

/// Evento genérico do barramento. Serializado em camelCase
/// para casar com a tipagem do frontend sem adaptadores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FluxoraEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub timestamp: String,
    pub source: String,
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

/// Estado do barramento: ring buffer simples em memória.
#[derive(Default)]
pub struct AppEventsState {
    pub recent: Mutex<VecDeque<FluxoraEvent>>,
}

impl AppEventsState {
    pub fn new() -> Self {
        Self {
            recent: Mutex::new(VecDeque::with_capacity(RECENT_EVENTS_CAPACITY)),
        }
    }

    /// Insere um evento no ring buffer. Quando o buffer estoura,
    /// o evento mais antigo é descartado.
    pub fn push(&self, event: FluxoraEvent) {
        if let Ok(mut guard) = self.recent.lock() {
            if guard.len() >= RECENT_EVENTS_CAPACITY {
                guard.pop_front();
            }
            guard.push_back(event);
        }
    }

    /// Lista os últimos `limit` eventos (mais recentes primeiro).
    /// Quando `type_filter` é informado, retorna apenas os eventos
    /// com `event_type` igual ao valor fornecido.
    pub fn list_recent(&self, limit: usize, type_filter: Option<&str>) -> Vec<FluxoraEvent> {
        let guard = match self.recent.lock() {
            Ok(guard) => guard,
            Err(_) => return Vec::new(),
        };
        let mut out: Vec<FluxoraEvent> = guard
            .iter()
            .rev()
            .filter(|event| match type_filter {
                Some(value) => event.event_type == value,
                None => true,
            })
            .cloned()
            .collect();
        if limit > 0 && out.len() > limit {
            out.truncate(limit);
        }
        out
    }

    /// Limpa completamente o ring buffer.
    pub fn clear(&self) {
        if let Ok(mut guard) = self.recent.lock() {
            guard.clear();
        }
    }
}

/// Gera um identificador monotônico para o evento. Não usa
/// UUID para manter a dependência apenas na stdlib.
fn generate_event_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("fluxora-evt-{now}-{seq}")
}

/// Timestamp ISO 8601 (UTC) do momento de emissão.
pub fn iso_now() -> String {
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

/// Constrói um evento com validação leve dos campos `level`
/// e `source`. Valores inválidos caem para defaults seguros.
pub fn build_event(
    event_type: impl Into<String>,
    source: impl Into<String>,
    level: impl Into<String>,
    message: Option<String>,
    project_id: Option<String>,
    mission_id: Option<String>,
    agent_id: Option<String>,
    payload: Option<serde_json::Value>,
) -> FluxoraEvent {
    let level_value = level.into();
    let source_value = source.into();
    FluxoraEvent {
        id: generate_event_id(),
        event_type: event_type.into(),
        timestamp: iso_now(),
        source: if SOURCES.contains(&source_value.as_str()) {
            source_value
        } else {
            "system".to_string()
        },
        level: if LEVELS.contains(&level_value.as_str()) {
            level_value
        } else {
            "info".to_string()
        },
        project_id,
        mission_id,
        agent_id,
        message,
        payload,
    }
}

/// Emite um evento para o frontend via canal Tauri e armazena
/// uma cópia no ring buffer. Falhas de serialização/emissão são
/// logadas e descartadas — o barramento nunca deve derrubar o app.
pub fn emit_to_app<R: Runtime>(app: &AppHandle<R>, event: FluxoraEvent) -> FluxoraEvent {
    if let Some(state) = app.try_state::<AppEventsState>() {
        state.push(event.clone());
    }
    if let Err(error) = app.emit(FLUXORA_EVENT_CHANNEL, &event) {
        eprintln!(
            "[fluxora events] falha ao emitir evento {}: {error}",
            event.id
        );
    }
    event
}

/// Recupera o estado global de eventos do app, criando um
/// estado vazio se ainda não estiver registrado (caso de testes
/// ou pontos de entrada que não passam pelo `setup`).
fn events_state<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, AppEventsState> {
    app.state::<AppEventsState>()
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Argumentos aceitos pelo comando `events_emit_diagnostic`.
/// Todos os campos são opcionais exceto `message`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitDiagnosticInput {
    pub message: String,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub mission_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

/// Argumentos aceitos por `events_list_recent`.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListRecentInput {
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub r#type: Option<String>,
}

/// Emite um evento `app/diagnostic` no barramento e devolve
/// o evento criado para o caller (sem callback).
///
/// Esta função é pública mas não usa o atributo `#[tauri::command]`:
/// os wrappers de comando vivem em `lib.rs` para evitar conflitos de
/// macro quando múltiplos módulos registram comandos.
pub fn events_emit_diagnostic(app: AppHandle, input: EmitDiagnosticInput) -> Result<FluxoraEvent, String> {
    if input.message.trim().is_empty() {
        return Err("A mensagem do evento de diagnóstico não pode estar vazia.".to_string());
    }
    let event = build_event(
        "app/diagnostic",
        input.source.unwrap_or_else(|| "app".to_string()),
        input.level.unwrap_or_else(|| "info".to_string()),
        Some(input.message),
        input.project_id,
        input.mission_id,
        input.agent_id,
        input.payload,
    );
    Ok(emit_to_app(&app, event))
}

/// Lista os eventos recentes em memória. Aceita `limit` (default
/// 50, hard cap igual à capacidade do buffer) e `type` opcional
/// para filtrar por tipo semântico.
pub fn events_list_recent(app: AppHandle, input: Option<ListRecentInput>) -> Result<Vec<FluxoraEvent>, String> {
    let input = input.unwrap_or_default();
    let limit = input
        .limit
        .unwrap_or(50)
        .min(RECENT_EVENTS_CAPACITY)
        .max(1);
    let type_filter = input.r#type.as_deref();
    Ok(events_state(&app).list_recent(limit, type_filter))
}

/// Limpa o ring buffer de eventos recentes.
pub fn events_clear_recent(app: AppHandle) -> Result<(), String> {
    events_state(&app).clear();
    Ok(())
}

/// Health-check simples do barramento. Retorna um timestamp ISO
/// 8601 útil para confirmar que o caminho Tauri está vivo.
pub fn events_ping() -> String {
    iso_now()
}
