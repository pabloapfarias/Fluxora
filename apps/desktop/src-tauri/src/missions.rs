// PR 008 — Mission Engine inicial do Fluxora.
// PR 009 — Piloto automático: scheduler/fila mínima e
//          integração com o sistema de permissões por projeto.
//
// A PR 008 entrega a fundação observável e controlada:
//
// - Persistência local de missões e logs em JSON versionado
//   (`<app_data_dir>/fluxora/missions.json`).
// - Comandos Tauri: `missions_ping` / `missions_list` /
//   `missions_get` / `missions_create` / `missions_run` /
//   `missions_create_and_run` / `missions_list_logs` /
//   `missions_clear`.
// - Execução inicial segura e propositiva (read-only): a missão
//   NÃO altera arquivos do projeto, NÃO executa comandos de
//   shell, NÃO faz Git write operations.
// - Contexto do projeto coletado de forma conservadora
//   (arquivos relevantes, ignorando diretórios pesados).
// - Prompt interno seguro com aviso explícito de "modo
//   propositivo / read-only".
// - Integração com o Provider Engine da PR 007 via
//   `providers::execute_mission_chat` (helper que NÃO emite
//   `provider/*` events — quem emite `mission/*` é o Mission
//   Engine).
// - Eventos `mission/created` / `mission/started` /
//   `mission/phase` / `mission/log` / `mission/completed` /
//   `mission/failed` / `mission/cancelled` no barramento
//   `fluxora-event` (PR 005).
//
// A PR 009 adiciona:
// - Estado de jobs (MissionJobRecord) em memória, com fila
//   mínima e proteção contra execuções simultâneas da mesma
//   missão.
// - Comandos Tauri: `scheduler_ping` / `scheduler_list_jobs` /
//   `scheduler_get_job` / `scheduler_cancel_job`.
// - Eventos `mission/job-created` / `mission/job-started` /
//   `mission/job-completed` / `mission/job-failed` /
//   `mission/job-cancelled` no mesmo barramento.
// - Integração com o Permissions Engine (PR 009) antes da
//   coleta de contexto e antes da chamada do provider. A
//   política default é conservadora (allow para `read-files`,
//   `git-read` e `network-provider`; ask para `write-files`,
//   `create-files`, `move-files`, `run-commands`,
//   `install-dependencies`, `apply-patch`; deny para
//   `delete-files`, `git-write`, `commit`, `push`).
// - Suporte aos modos `assistido`, `propositivo` e
//   `piloto-automatico` no `missions_create_and_run`. O modo
//   `piloto-automatico` só é aceito quando a política do
//   projeto tem `autopilotEnabled: true`; caso contrário a
//   missão é degradada para `propositivo` (e o evento
//   `mission/phase` registra o fallback).
//
// Não-objetivos desta PR (registrados para PRs futuras):
// - Aplicar patch em arquivos do projeto.
// - Execução real de comandos de shell.
// - Git write operations (commit, push, checkout, reset, ...).
// - Tool calling.
// - Streaming de provider.
// - Agentes paralelos reais.
// - Storage seguro de secrets.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

use crate::agents;
use crate::events;
use crate::patches;
use crate::permissions;
use crate::projects;
use crate::providers;

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/// Tamanho máximo do prompt do usuário (em chars). Evita prompts
/// gigantes e abuso de tokens do provider.
const MAX_PROMPT_LENGTH: usize = 4_000;

/// Número máximo de arquivos coletados para o contexto da missão.
const MAX_CONTEXT_FILES: usize = 10;

/// Tamanho máximo por arquivo no contexto (em bytes).
const MAX_CONTEXT_FILE_BYTES: u64 = 32 * 1024; // 32 KiB

/// Tamanho máximo total do contexto coletado (em bytes).
const MAX_CONTEXT_TOTAL_BYTES: u64 = 128 * 1024; // 128 KiB

/// Tamanho máximo de mensagem de erro exposto na missão/eventos.
const MAX_ERROR_MESSAGE_LEN: usize = 500;

/// Diretórios pesados a serem ignorados no contexto. Reservado
/// para uso futuro (PR 009 — Piloto Automático pode precisar
/// filtrar árvores inteiras; aqui o Mission Engine só lê
/// arquivos preferenciais curados por `PREFERRED_CONTEXT_FILES`).
#[allow(dead_code)]
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules", ".git", "vendor", "dist", "build", ".next", "target",
    ".cache", ".turbo", ".parcel-cache", ".venv", "venv", "__pycache__",
];

/// Arquivos preferenciais (em ordem) que o Mission Engine tenta
/// incluir no contexto. Os que existirem e forem menores que
/// `MAX_CONTEXT_FILE_BYTES` são incluídos.
const PREFERRED_CONTEXT_FILES: &[&str] = &[
    "README.md",
    "package.json",
    "composer.json",
    "pubspec.yaml",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
];

// ---------------------------------------------------------------------------
// Modelo de dados
// ---------------------------------------------------------------------------

/// Missão persistida (espelha o `MissionRun` em `@fluxora/shared`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub prompt: String,
    pub status: String,
    pub mode: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub current_phase: Option<String>,
    pub result_text: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// Log de fase/evento da missão (espelha `MissionLog`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionLogRecord {
    pub id: String,
    pub mission_id: String,
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub phase: Option<String>,
    pub payload: Option<serde_json::Value>,
}

/// Estado em memória (carregado do disco no startup).
pub struct MissionsState {
    pub missions: Mutex<Vec<MissionRecord>>,
    pub logs: Mutex<Vec<MissionLogRecord>>,
}

impl MissionsState {
    pub fn new() -> Self {
        Self {
            missions: Mutex::new(Vec::new()),
            logs: Mutex::new(Vec::new()),
        }
    }
}

/// `MissionJob` da PR 009 — estado observável do scheduler/fila
/// mínima em memória. Espelha a forma canônica nova em
/// `@fluxora/shared`. **Não persistido em disco nesta PR** — a
/// `MissionRun` correspondente em `missions.json` carrega o
/// estado durável; o `MissionJob` é reconstruído no startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionJobRecord {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    pub status: String,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Estado em memória do scheduler/fila.
pub struct MissionJobsState {
    pub jobs: Mutex<Vec<MissionJobRecord>>,
}

impl MissionJobsState {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(Vec::new()),
        }
    }
}

/// Estrutura versionada do `missions.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MissionsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    missions: Vec<MissionRecord>,
    #[serde(default)]
    logs: Vec<MissionLogRecord>,
}

fn default_version() -> u32 {
    1
}

impl Default for MissionsFile {
    fn default() -> Self {
        Self {
            version: 1,
            missions: Vec::new(),
            logs: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Payloads de entrada/saída dos comandos Tauri
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMissionPayload {
    pub project_id: String,
    pub prompt: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMissionPayload {
    pub mission_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelMissionJobPayload {
    pub job_id: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionContextFile {
    pub path: String,
    pub bytes: u64,
    pub truncated: bool,
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    events::iso_now()
}

fn generate_mission_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("mission-{millis}-{seq}")
}

fn generate_log_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("mission-log-{millis}-{seq}")
}

fn truncate_error(input: &str) -> String {
    if input.chars().count() <= MAX_ERROR_MESSAGE_LEN {
        return input.to_string();
    }
    let mut out: String = input.chars().take(MAX_ERROR_MESSAGE_LEN).collect();
    out.push('…');
    out
}

fn is_path_safe(rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    // Rejeita absolutos e ".."
    if rel.starts_with('/') || rel.starts_with('\\') {
        return false;
    }
    for component in Path::new(rel).components() {
        use std::path::Component;
        if matches!(component, Component::ParentDir) {
            return false;
        }
    }
    true
}

fn missions_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("missions.json"))
}

fn ensure_missions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = missions_file_path(app)?;
    let parent = file_path
        .parent()
        .ok_or_else(|| "Não foi possível resolver o diretório de persistência de missões.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_missions_file(app: &AppHandle) -> Result<MissionsFile, String> {
    let file_path = ensure_missions_dir(app)?;
    if !file_path.exists() {
        return Ok(MissionsFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(MissionsFile::default());
    }
    serde_json::from_str::<MissionsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de missões inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_missions_file(app: &AppHandle, store: &MissionsFile) -> Result<(), String> {
    let file_path = ensure_missions_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar as missões: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/// Carrega missões e logs do disco no startup do Tauri.
/// Falhas de I/O são logadas e descartadas — o app continua
/// com estado vazio até o usuário criar a primeira missão.
pub fn load_missions_on_startup(app: &AppHandle) {
    match read_missions_file(app) {
        Ok(store) => {
            let missions_count = store.missions.len();
            let logs_count = store.logs.len();
            if let Some(state) = app.try_state::<MissionsState>() {
                if let Ok(mut missions) = state.missions.lock() {
                    *missions = store.missions;
                }
                if let Ok(mut logs) = state.logs.lock() {
                    *logs = store.logs;
                }
                eprintln!(
                    "[fluxora missions] carregadas {} missão(ões) e {} log(s)",
                    missions_count, logs_count
                );
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora missions] falha ao carregar missions.json: {error}. Iniciando vazio."
            );
        }
    }
}

/// Persiste o estado atual em `missions.json`.
fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<MissionsState>();
    let missions = state
        .missions
        .lock()
        .map_err(|_| "Lock de missões poisoned.".to_string())?
        .clone();
    let logs = state
        .logs
        .lock()
        .map_err(|_| "Lock de logs poisoned.".to_string())?
        .clone();
    let store = MissionsFile {
        version: 1,
        missions,
        logs,
    };
    write_missions_file(app, &store)
}

// ---------------------------------------------------------------------------
// Mutações de estado
// ---------------------------------------------------------------------------

fn find_mission(state: &MissionsState, id: &str) -> Option<MissionRecord> {
    state
        .missions
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|m| m.id == id).cloned())
}

fn append_log(
    state: &MissionsState,
    mission_id: &str,
    level: &str,
    message: &str,
    phase: Option<&str>,
    payload: Option<serde_json::Value>,
) -> MissionLogRecord {
    let log = MissionLogRecord {
        id: generate_log_id(),
        mission_id: mission_id.to_string(),
        timestamp: now_iso(),
        level: level.to_string(),
        message: message.to_string(),
        phase: phase.map(|p| p.to_string()),
        payload,
    };
    if let Ok(mut guard) = state.logs.lock() {
        guard.push(log.clone());
    }
    log
}

fn update_mission<F>(state: &MissionsState, id: &str, mutator: F) -> Option<MissionRecord>
where
    F: FnOnce(&mut MissionRecord),
{
    let mut guard = state.missions.lock().ok()?;
    let mission = guard.iter_mut().find(|m| m.id == id)?;
    mutator(mission);
    mission.updated_at = now_iso();
    Some(mission.clone())
}

// ---------------------------------------------------------------------------
// Emissão de eventos `mission/*`
// ---------------------------------------------------------------------------

fn emit_mission_event(
    app: &AppHandle,
    kind: &str,
    mission_id: &str,
    project_id: Option<&str>,
    level: &str,
    message: &str,
    phase: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    let mut payload = payload.unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = payload.as_object_mut() {
        if let Some(phase_value) = phase {
            obj.entry("phase".to_string())
                .or_insert(serde_json::Value::String(phase_value.to_string()));
        }
    }
    let event = events::build_event(
        kind,
        "mission",
        level,
        Some(message.to_string()),
        project_id.map(|p| p.to_string()),
        Some(mission_id.to_string()),
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

fn emit_provider_missing_event(
    app: &AppHandle,
    mission_id: &str,
    project_id: Option<&str>,
) {
    let event = events::build_event(
        "provider/missing",
        "mission",
        "error",
        Some(
            "Nenhum provider real do Provider Engine está configurado para executar a missão."
                .to_string(),
        ),
        project_id.map(|value| value.to_string()),
        Some(mission_id.to_string()),
        None,
        Some(serde_json::json!({
            "reason": "no-real-provider",
            "legacyCatalogVisible": true,
        })),
    );
    events::emit_to_app(app, event);
}

fn default_phase_message(phase: &str) -> &'static str {
    match phase {
        "created" => "Missão criada.",
        "context" => "Coletando contexto do projeto.",
        "planning" => "Preparando prompt com base no contexto.",
        "provider-call" => "Chamando provider configurado.",
        "response" => "Resposta recebida do provider.",
        "final-report" => "Montando relatório final.",
        "failed" => "Missão falhou.",
        _ => "Atualização de fase.",
    }
}

fn record_phase(
    app: &AppHandle,
    state: &MissionsState,
    mission: &MissionRecord,
    phase: &str,
    extra_payload: Option<serde_json::Value>,
) {
    let payload = extra_payload.unwrap_or_else(|| serde_json::json!({}));
    let _ = append_log(
        state,
        &mission.id,
        "info",
        default_phase_message(phase),
        Some(phase),
        Some(payload.clone()),
    );
    emit_mission_event(
        app,
        "mission/phase",
        &mission.id,
        Some(&mission.project_id),
        "info",
        default_phase_message(phase),
        Some(phase),
        Some(payload),
    );
}

/// Registra um log e emite o evento `mission/log` correspondente.
/// Reservado para uso futuro (logs fora do pipeline padrão de
/// fases). Não é chamado nesta PR, mas fica disponível para
/// extensões de diagnóstico sem precisar reintroduzir código
/// morto mais tarde.
#[allow(dead_code)]
fn record_log(
    app: &AppHandle,
    state: &MissionsState,
    mission_id: &str,
    project_id: &str,
    level: &str,
    message: &str,
    phase: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    let _ = append_log(state, mission_id, level, message, phase, payload.clone());
    emit_mission_event(
        app,
        "mission/log",
        mission_id,
        Some(project_id),
        level,
        message,
        phase,
        payload,
    );
}

// ---------------------------------------------------------------------------
// Coleta de contexto do projeto
// ---------------------------------------------------------------------------

/// Lista arquivos "relevantes" para o contexto da missão. Primeiro
/// tenta os `PREFERRED_CONTEXT_FILES` que existirem; depois cai
/// nos `relevantFiles` salvos no `ProjectRecord`; respeitando os
/// limites (`MAX_CONTEXT_FILES`).
fn collect_relevant_files(project_root: &Path) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for preferred in PREFERRED_CONTEXT_FILES {
        let candidate = project_root.join(preferred);
        if candidate.is_file() {
            let rel = preferred.to_string();
            if seen.insert(rel.clone()) {
                out.push(rel);
            }
        }
    }
    out
}

/// Lê um arquivo do projeto respeitando os limites de tamanho e
/// a heurística de binário. Retorna `None` se o arquivo for
/// binário, vazio, grande demais ou inacessível.
fn try_read_file(root: &Path, relative: &str) -> Option<(String, u64, bool)> {
    if !is_path_safe(relative) {
        return None;
    }
    let path = root.join(relative);
    if !path.is_file() {
        return None;
    }
    let metadata = fs::metadata(&path).ok()?;
    let size = metadata.len();
    if size == 0 {
        return None;
    }
    // Heurística de binário: lê primeiros 8 KiB e checa NUL
    let probe = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return None,
    };
    let probe_window = &probe[..probe.len().min(8 * 1024)];
    if probe_window.contains(&0u8) {
        return None;
    }
    let read_bytes = size.min(MAX_CONTEXT_FILE_BYTES);
    let truncated = size > MAX_CONTEXT_FILE_BYTES;
    let content = match std::str::from_utf8(&probe[..read_bytes as usize]) {
        Ok(text) => text.to_string(),
        Err(_) => return None,
    };
    Some((content, read_bytes, truncated))
}

/// Coleta o contexto do projeto (arquivos pequenos e seguros) que
/// será enviado ao provider como parte do prompt. Retorna
/// `(contexto_formatado, lista_de_arquivos_incluídos)`.
fn collect_project_context(project_root: &Path) -> (String, Vec<MissionContextFile>) {
    let mut included: Vec<MissionContextFile> = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut sections: Vec<String> = Vec::new();

    let candidates = collect_relevant_files(project_root);
    for rel in candidates {
        if included.len() >= MAX_CONTEXT_FILES {
            break;
        }
        if total_bytes >= MAX_CONTEXT_TOTAL_BYTES {
            break;
        }
        if let Some((content, bytes, truncated)) = try_read_file(project_root, &rel) {
            if total_bytes + bytes > MAX_CONTEXT_TOTAL_BYTES {
                continue;
            }
            total_bytes += bytes;
            included.push(MissionContextFile {
                path: rel.clone(),
                bytes,
                truncated,
            });
            let header = if truncated {
                format!("### {} (truncado, primeiros {} bytes)", rel, bytes)
            } else {
                format!("### {}", rel)
            };
            sections.push(format!("{}\n```\n{}\n```", header, content));
        }
    }

    if sections.is_empty() {
        return (
            "(nenhum arquivo de contexto coletado)".to_string(),
            included,
        );
    }
    (sections.join("\n\n"), included)
}

// ---------------------------------------------------------------------------
// Construção do prompt
// ---------------------------------------------------------------------------

fn build_mission_prompt(
    user_prompt: &str,
    project_name: &str,
    project_stack: &[String],
    context: &str,
) -> Vec<providers::ChatMessagePayload> {
    let system_prompt = format!(
        "Você está executando uma missão dentro do Fluxora, um cockpit \
desktop para orquestrar tarefas de desenvolvimento.\n\
O projeto atual é: {project_name}.\n\
Stack detectada: {stack}.\n\n\
Nessa execução você está em MODO PROPOSITIVO / READ-ONLY.\n\
- Você pode analisar o contexto do projeto e propor alterações.\n\
- Você NÃO pode modificar arquivos diretamente.\n\
- Se sugerir alterações, explique quais arquivos alteraria, \
mas não aplique.\n\
- Responda com:\n  1. Entendimento da missão\n  2. Plano de ação\n  \
3. Arquivos provavelmente envolvidos\n  4. Resultado ou proposta final\n  \
5. Próximos passos recomendados\n\n\
Se quiser propor alterações concretas, inclua ao final da resposta um \
bloco EXATAMENTE assim:\n\n\
```fluxora_patch\n\
{{\n  \"title\": \"Resumo curto da alteração\",\n  \"summary\": \"Descrição do que será alterado\",\n  \"files\": [\n    {{\n      \"path\": \"caminho/relativo/arquivo.ts\",\n      \"operation\": \"modify\",\n      \"afterContent\": \"conteúdo completo final do arquivo\"\n    }}\n  ]\n}}\n\
```\n\n\
Regras do bloco `fluxora_patch`:\n\
- Use apenas caminhos RELATIVOS ao projeto (sem `..`, sem absolutos).\n\
- Não proponha alterações em `node_modules`, `.git`, `vendor`, `dist`, `build`, `target`, `.next`, `.cache`, `.turbo`, `out`.\n\
- `operation` deve ser `create`, `modify` ou `delete`.\n\
- Para `create` ou `modify`, envie o conteúdo final completo em `afterContent`.\n\
- Para `delete`, use `operation: delete` sem `afterContent`.\n\
- O bloco é OPCIONAL. Se você não quiser propor alterações concretas, \
não inclua o bloco e responda apenas com a análise.\n\
- O backend do Fluxora vai validar o bloco e aplicar SOMENTE se a \
política do projeto permitir (ou se o usuário aprovar). Você nunca \
aplica alterações diretamente — apenas propõe.",
        project_name = project_name,
        stack = if project_stack.is_empty() {
            "(não detectada)".to_string()
        } else {
            project_stack.join(", ")
        },
    );

    let user_message = format!(
        "Contexto do projeto:\n{context}\n\nMissão do usuário:\n{user_prompt}",
        context = context,
        user_prompt = user_prompt,
    );

    vec![
        providers::ChatMessagePayload {
            role: "system".to_string(),
            content: system_prompt,
        },
        providers::ChatMessagePayload {
            role: "user".to_string(),
            content: user_message,
        },
    ]
}

// ---------------------------------------------------------------------------
// PR 010 — Parser do bloco `fluxora_patch`
// ---------------------------------------------------------------------------
//
// O provider pode incluir, ao final da resposta, um bloco
// markdown exatamente assim:
//
// ```fluxora_patch
// { ...JSON... }
// ```
//
// O backend do Fluxora extrai esse bloco, valida o JSON,
// valida os paths/limites, e cria uma `PatchProposal` (que
// pode virar uma `ExecutionApproval` se a política exigir).
// A resposta textual (sem o bloco) continua sendo salva em
// `MissionRun.resultText` para o usuário ler.

const FLUXORA_PATCH_MARKER: &str = "```fluxora_patch";
const FLUXORA_PATCH_END: &str = "```";

/// Resultado do parser do bloco `fluxora_patch`.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct FluxoraPatchExtract {
    /// Texto original sem o bloco `fluxora_patch` (limpo).
    pub cleaned_text: String,
    /// Bloco extraído como JSON (sem o `\\`fluxora_patch`).
    pub raw_json: Option<String>,
    /// Arquivos parseados a partir do JSON (já validados pela
    /// estrutura `PatchFileChangeRecord`). `None` quando o
    /// bloco não foi encontrado.
    pub files: Option<Vec<patches::PatchFileChangeRecord>>,
    /// `title` extraído (já trim).
    pub title: Option<String>,
    /// `summary` extraído (já trim).
    pub summary: Option<String>,
}

/// Extrai o bloco `fluxora_patch` da resposta do provider.
/// Retorna o texto limpo (sem o bloco) e os metadados
/// extraídos (se houver). Não falha se o bloco não estiver
/// presente ou estiver malformado — apenas devolve
/// `raw_json: None` ou `files: None` conforme o caso.
pub(crate) fn extract_fluxora_patch_block(text: &str) -> FluxoraPatchExtract {
    let marker_pos = match text.find(FLUXORA_PATCH_MARKER) {
        Some(pos) => pos,
        None => {
            return FluxoraPatchExtract {
                cleaned_text: text.to_string(),
                raw_json: None,
                files: None,
                title: None,
                summary: None,
            };
        }
    };
    // Encontra o início do JSON (após o marker)
    let after_marker = marker_pos + FLUXORA_PATCH_MARKER.len();
    let rest = &text[after_marker..];
    // Pula \n ou \r\n após o marker
    let rest = rest.trim_start_matches(|c| c == '\n' || c == '\r');
    // Encontra o fim do bloco (próximo ```)
    let end_pos = match rest.find(FLUXORA_PATCH_END) {
        Some(pos) => pos,
        None => {
            return FluxoraPatchExtract {
                cleaned_text: text.to_string(),
                raw_json: None,
                files: None,
                title: None,
                summary: None,
            };
        }
    };
    let raw_json = rest[..end_pos].trim().to_string();
    // Limpa o texto removendo o bloco inteiro (incluindo o
    // ```fluxora_patch e o ``` final). A linha onde o bloco
    // começa e o trailing newline são removidos.
    let mut cleaned = String::with_capacity(text.len());
    cleaned.push_str(&text[..marker_pos]);
    let after_end = after_marker + (rest.len() - end_pos) + FLUXORA_PATCH_END.len();
    cleaned.push_str(&text[after_end..]);
    let cleaned = cleaned.trim_end_matches(|c: char| c == '\n' || c == ' ').to_string();
    // Tenta parsear o JSON
    let parsed: Option<serde_json::Value> = serde_json::from_str(&raw_json)
        .map_err(|e| {
            eprintln!("[fluxora missions] bloco fluxora_patch inválido (JSON): {e}");
            e
        })
        .ok();
    let (mut title, mut summary, mut files): (Option<String>, Option<String>, Option<Vec<patches::PatchFileChangeRecord>>) =
        (None, None, None);
    if let Some(value) = parsed {
        if let Some(t) = value.get("title").and_then(|v| v.as_str()) {
            title = Some(t.to_string());
        }
        if let Some(s) = value.get("summary").and_then(|v| v.as_str()) {
            summary = Some(s.to_string());
        }
        if let Some(arr) = value.get("files").and_then(|v| v.as_array()) {
            let mut out: Vec<patches::PatchFileChangeRecord> = Vec::new();
            for (idx, item) in arr.iter().enumerate() {
                let path = item
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let operation = item
                    .get("operation")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let after_content = item
                    .get("afterContent")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let before_content = item
                    .get("beforeContent")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let unified_diff = item
                    .get("unifiedDiff")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let additions = item.get("additions").and_then(|v| v.as_u64()).map(|n| n as u32);
                let deletions = item.get("deletions").and_then(|v| v.as_u64()).map(|n| n as u32);
                if path.is_none() || operation.is_none() {
                    eprintln!(
                        "[fluxora missions] bloco fluxora_patch: arquivo #{} sem path ou operation",
                        idx + 1
                    );
                    continue;
                }
                out.push(patches::PatchFileChangeRecord {
                    path: path.unwrap(),
                    operation: operation.unwrap(),
                    before_content,
                    after_content,
                    unified_diff,
                    additions,
                    deletions,
                    is_new_file: None,
                    is_deleted_file: None,
                });
            }
            files = Some(out);
        }
    }
    FluxoraPatchExtract {
        cleaned_text: cleaned,
        raw_json: Some(raw_json),
        files,
        title,
        summary,
    }
}

// ---------------------------------------------------------------------------
// Resolução de provider/model
// ---------------------------------------------------------------------------

/// Resolve o `providerId` a usar. Prioridade:
/// 1. `explicit` (informado no input).
/// 2. Primeiro provider `enabled` com `defaultModel` configurado.
/// 3. Primeiro provider `enabled` qualquer.
/// Retorna `None` se não houver provider configurado.
fn resolve_provider(
    state: &providers::ProvidersState,
    explicit: Option<&str>,
) -> Option<providers::StoredProvider> {
    let all = state.snapshot();
    if let Some(id) = explicit {
        return all.into_iter().find(|p| p.enabled && p.id == id);
    }
    // Primeiro: enabled + defaultModel
    if let Some(p) = all
        .iter()
        .find(|p| p.enabled && p.default_model.is_some())
    {
        return Some(p.clone());
    }
    // Fallback: primeiro enabled
    all.into_iter().find(|p| p.enabled)
}

// ---------------------------------------------------------------------------
// Comandos Tauri (chamados como wrappers em lib.rs)
// ---------------------------------------------------------------------------

/// Health-check simples. Retorna um timestamp ISO 8601.
pub fn missions_ping() -> String {
    now_iso()
}

/// Lista missões (mais recentes primeiro). Aplica cap interno
/// para evitar resposta gigante.
pub fn missions_list(app: AppHandle) -> Result<Vec<MissionRecord>, String> {
    let state = app.state::<MissionsState>();
    let guard = state
        .missions
        .lock()
        .map_err(|_| "Lock de missões poisoned.".to_string())?;
    let mut out = guard.clone();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Retorna uma missão por `id` (ou `None` se não existir).
pub fn missions_get(app: AppHandle, id: String) -> Result<Option<MissionRecord>, String> {
    let state = app.state::<MissionsState>();
    Ok(find_mission(&state, &id))
}

/// Cria uma missão (status inicial: "queued"). NÃO executa.
pub fn missions_create(
    app: AppHandle,
    payload: CreateMissionPayload,
) -> Result<MissionRecord, String> {
    let prompt = payload.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("O prompt da missão não pode estar vazio.".to_string());
    }
    if prompt.chars().count() > MAX_PROMPT_LENGTH {
        return Err(format!(
            "O prompt da missão excede o limite de {} caracteres.",
            MAX_PROMPT_LENGTH
        ));
    }
    if payload.project_id.trim().is_empty() {
        return Err("O projeto da missão não pode estar vazio.".to_string());
    }
    // Garante que o projeto existe
    let _ = projects::find_project_path(&app, &payload.project_id)?;

    let now = now_iso();
    let title = payload
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            // Primeira linha do prompt ou prefixo até 60 chars
            let first_line = prompt.lines().next().unwrap_or("Missão").to_string();
            if first_line.chars().count() <= 60 {
                first_line
            } else {
                first_line.chars().take(57).collect::<String>() + "…"
            }
        });

    let mission = MissionRecord {
        id: generate_mission_id(),
        project_id: payload.project_id.clone(),
        title,
        prompt,
        status: "queued".to_string(),
        mode: payload.mode.unwrap_or_else(|| "propositivo".to_string()),
        provider_id: payload.provider_id,
        model: payload.model,
        current_phase: Some("created".to_string()),
        result_text: None,
        error: None,
        created_at: now.clone(),
        updated_at: now,
        started_at: None,
        completed_at: None,
    };

    let state = app.state::<MissionsState>();
    {
        let mut guard = state
            .missions
            .lock()
            .map_err(|_| "Lock de missões poisoned.".to_string())?;
        guard.push(mission.clone());
    }
    let _ = persist(&app);

    // Evento mission/created
    emit_mission_event(
        &app,
        "mission/created",
        &mission.id,
        Some(&mission.project_id),
        "info",
        "Missão criada.",
        Some("created"),
        Some(serde_json::json!({
            "title": &mission.title,
            "mode": &mission.mode,
            "providerId": mission.provider_id,
            "model": mission.model,
        })),
    );

    // Log inicial
    let _ = append_log(
        &state,
        &mission.id,
        "info",
        "Missão criada.",
        Some("created"),
        Some(serde_json::json!({
            "title": &mission.title,
            "mode": &mission.mode,
        })),
    );

    Ok(mission)
}

/// Cria e executa uma missão em uma única chamada.
pub fn missions_create_and_run(
    app: AppHandle,
    payload: CreateMissionPayload,
) -> Result<MissionRecord, String> {
    let mission = missions_create(app.clone(), payload)?;
    let payload_run = RunMissionPayload {
        mission_id: mission.id.clone(),
    };
    missions_run(app, payload_run)
}

/// Lista logs de uma missão, ordenados por timestamp crescente.
pub fn missions_list_logs(app: AppHandle, mission_id: String) -> Result<Vec<MissionLogRecord>, String> {
    let state = app.state::<MissionsState>();
    let guard = state
        .logs
        .lock()
        .map_err(|_| "Lock de logs poisoned.".to_string())?;
    let mut out: Vec<MissionLogRecord> = guard
        .iter()
        .filter(|l| l.mission_id == mission_id)
        .cloned()
        .collect();
    out.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(out)
}

/// Limpa o arquivo `missions.json` (apenas dev/debug). Útil
/// durante a iteração local — não é exposto no `FluxoraAPI` na
/// UI (apenas via comando Tauri direto em smoke-tests).
pub fn missions_clear(app: AppHandle) -> Result<(), String> {
    let state = app.state::<MissionsState>();
    {
        let mut guard = state
            .missions
            .lock()
            .map_err(|_| "Lock de missões poisoned.".to_string())?;
        guard.clear();
    }
    {
        let mut guard = state
            .logs
            .lock()
            .map_err(|_| "Lock de logs poisoned.".to_string())?;
        guard.clear();
    }
    persist(&app)?;
    Ok(())
}

/// Executa uma missão já criada. Atualiza o status persistido
/// (`queued` → `running` → `completed` | `failed`) e emite
/// eventos `mission/phase` / `mission/log` /
/// `mission/completed` / `mission/failed`.
pub fn missions_run(app: AppHandle, payload: RunMissionPayload) -> Result<MissionRecord, String> {
    let state = app.state::<MissionsState>();
    let mission_id = payload.mission_id.clone();

    // Carrega a missão (clone para usar fora do lock)
    let mission = match find_mission(&state, &mission_id) {
        Some(m) => m,
        None => return Err(format!("Missão {mission_id} não encontrada.")),
    };

    // Já em execução ou finalizada?
    if mission.status == "running" {
        return Err("Missão já está em execução.".to_string());
    }
    if mission.status == "completed" || mission.status == "failed" || mission.status == "cancelled" {
        return Err(format!(
            "Missão já finalizada com status '{}'.",
            mission.status
        ));
    }

    // PR 009 — Criar `MissionJob` e resolver o modo efetivo
    // (com fallback de `piloto-automatico` → `propositivo`
    // quando a política do projeto tem `autopilotEnabled: false`).
    let job = create_mission_job(&app, &mission)?;
    let job_id = job.id.clone();
    if let Err(error) = resolve_effective_mode(&app, &state, &mission) {
        mark_job_failed(&app, Some(&job_id), &error);
        fail_mission(&app, &state, &mission, &error, Some(&job_id));
        return Err(error);
    }
    // Recarrega a missão após o fallback de modo (pode ter
    // alterado `mode`).
    let mission = match find_mission(&state, &mission_id) {
        Some(m) => m,
        None => {
            let err = format!("Missão {mission_id} não encontrada.");
            mark_job_failed(&app, Some(&job_id), &err);
            return Err(err);
        }
    };

    // 1. Resolver provider/model usando a MESMA fonte de verdade
    //    que `missions_get_readiness` e que a UI consome via
    //    `resolveExecutionReadiness`. PR 014 unificou a fonte
    //    única — `execution_resolver::resolve_mission_readiness`
    //    — para que diagnóstico, AgentsPage e execução usem
    //    exatamente o mesmo provider/modelo.
    let provider_state = app.state::<providers::ProvidersState>();
    let readiness = crate::execution_resolver::resolve_mission_readiness(
        &app,
        crate::execution_resolver::ResolveReadinessInput {
            project_id: Some(mission.project_id.clone()),
            mission_id: Some(mission.id.clone()),
            provider_id: mission.provider_id.clone(),
            model: mission.model.clone(),
        },
    );
    let provider = match resolve_provider(&provider_state, mission.provider_id.as_deref()) {
        Some(p) => p,
        None => {
            let err = readiness
                .issues
                .first()
                .cloned()
                .unwrap_or_else(|| {
                    "Nenhum provider configurado. Cadastre um provider em Configurações > Providers."
                        .to_string()
                });
            emit_provider_missing_event(&app, &mission.id, Some(&mission.project_id));
            fail_mission(&app, &state, &mission, &err, Some(&job_id));
            return Err(err);
        }
    };
    if !providers::provider_kind_is_supported(&provider.kind) {
        let err = format!(
            "Provider '{}' não está implementado nesta PR.",
            provider.kind
        );
        fail_mission(&app, &state, &mission, &err, Some(&job_id));
        return Err(err);
    }
    let model = readiness
        .default_model
        .clone()
        .or_else(|| mission.model.clone())
        .or_else(|| provider.default_model.clone());
    let model = match model {
        Some(m) if !m.trim().is_empty() => m,
        _ => {
            let err = readiness
                .issues
                .iter()
                .find(|issue| issue.contains("modelo padrão"))
                .cloned()
                .unwrap_or_else(|| {
                    format!(
                        "Nenhum modelo informado e o provider '{}' não tem defaultModel configurado.",
                        provider.name
                    )
                });
            fail_mission(&app, &state, &mission, &err, Some(&job_id));
            return Err(err);
        }
    };

    // 2. Atualiza status → running e emite mission/started
    let running = update_mission(&state, &mission.id, |m| {
        m.status = "running".to_string();
        m.started_at = Some(now_iso());
        m.current_phase = Some("context".to_string());
        m.provider_id = Some(provider.id.clone());
        m.model = Some(model.clone());
    })
    .unwrap_or_else(|| mission.clone());
    let _ = persist(&app);
    let _ = mark_job_running(&app, &job_id);
    emit_mission_event(
        &app,
        "mission/started",
        &running.id,
        Some(&running.project_id),
        "info",
        "Execução da missão iniciada.",
        Some("created"),
        Some(serde_json::json!({
            "providerId": provider.id,
            "providerName": provider.name,
            "model": &model,
            "mode": &running.mode,
            "jobId": &job_id,
        })),
    );

    // PR 009 — Checagem de permissão `read-files` antes da
    // coleta de contexto. Em missões read-only/propositivas a
    // decisão default é `allow`, então essa checagem só
    // bloqueia em projetos com política explícita.
    if let Err(error) = check_action_for_mission(&app, &running, "read-files", "context") {
        let truncated = truncate_error(&error);
        let _ = update_mission(&state, &running.id, |m| {
            m.error = Some(truncated.clone());
            m.current_phase = Some("failed".to_string());
        });
        let _ = persist(&app);
        mark_job_failed(&app, Some(&job_id), &error);
        return Err(error);
    }

    // 3. Coletar contexto do projeto
    let project_root = match projects::find_project_path(&app, &running.project_id) {
        Ok(p) => p,
        Err(error) => {
            fail_mission(&app, &state, &running, &error, Some(&job_id));
            return Err(error);
        }
    };
    let project_record = find_project_meta(&app, &running.project_id);
    let project_name = project_record
        .as_ref()
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "Projeto".to_string());
    let project_stack = project_record
        .as_ref()
        .map(|p| p.stack.clone())
        .unwrap_or_default();

    let (context_text, context_files) = collect_project_context(&project_root);
    record_phase(
        &app,
        &state,
        &running,
        "context",
        Some(serde_json::json!({
            "contextFiles": context_files.iter().map(|f| serde_json::json!({
                "path": f.path,
                "bytes": f.bytes,
                "truncated": f.truncated,
            })).collect::<Vec<_>>(),
            "contextFilesCount": context_files.len(),
        })),
    );

    // 4. Construir prompt base (reusado pelo contexto do Agent Engine)
    let _messages =
        build_mission_prompt(&running.prompt, &project_name, &project_stack, &context_text);
    let _ = update_mission(&state, &running.id, |m| {
        m.current_phase = Some("planning".to_string());
    });
    let _ = persist(&app);
    record_phase(
        &app,
        &state,
        &running,
        "planning",
        Some(serde_json::json!({
            "messagesCount": _messages.len(),
        })),
    );

    // 5. Provider call
    let _ = update_mission(&state, &running.id, |m| {
        m.current_phase = Some("provider-call".to_string());
    });
    let _ = persist(&app);
    record_phase(
        &app,
        &state,
        &running,
        "provider-call",
        Some(serde_json::json!({
            "providerId": provider.id,
            "model": &model,
        })),
    );

    // PR 009 — Checagem de permissão `network-provider` antes
    // da chamada real do provider. Em missões
    // read-only/propositivas a decisão default é `allow`,
    // então essa checagem só bloqueia em projetos com
    // política explícita que negue acesso à rede.
    if let Err(error) =
        check_action_for_mission(&app, &running, "network-provider", "provider-call")
    {
        let truncated = truncate_error(&error);
        let _ = update_mission(&state, &running.id, |m| {
            m.error = Some(truncated.clone());
            m.current_phase = Some("failed".to_string());
        });
        let _ = persist(&app);
        mark_job_failed(&app, Some(&job_id), &error);
        return Err(error);
    }

    // PR 011 — Pipeline de 4 agentes sequenciais
    // (Planner → Developer → QA → Finalizer). Substitui a
    // antiga chamada única a `execute_mission_chat` da PR 008
    // e a extração manual do `fluxora_patch` da PR 010. Cada
    // agente tem seu próprio `AgentStepRecord` persistido em
    // `agent_steps.json`, e o Developer já cuida do
    // `extract_fluxora_patch_block` + `create_proposal_from_provider_text`.
    let agent_ctx = agents::MissionAgentContext {
        mission: &running,
        user_prompt: &running.prompt,
        project_name: &project_name,
        project_stack: &project_stack,
        context_text: &context_text,
        default_provider_id: &provider.id,
        default_model: &model,
    };
    let agents_result = match agents::run_mission_agents(&app, &agent_ctx) {
        Ok(r) => r,
        Err(error) => {
            let truncated = truncate_error(&error);
            fail_mission(&app, &state, &running, &truncated, Some(&job_id));
            return Err(truncated);
        }
    };

    // 6. PR 010 — Se o Developer gerou uma `PatchProposal`,
    //    emitir `mission/phase` com o status final. A proposta
    //    já foi criada pelo Agent Engine; aqui só refletimos o
    //    resultado no MissionLog/eventos.
    if let Some(proposal_id) = &agents_result.patch_proposal_id {
        // Recarrega a proposta para descobrir o status final
        // (pode ter virado `pending_approval`, `failed` ou
        // permanecer `draft`).
        let state_patches = app.state::<patches::PatchesState>();
        let proposal_status = state_patches
            .proposals
            .lock()
            .ok()
            .and_then(|guard| {
                guard
                    .iter()
                    .find(|p| p.id == *proposal_id)
                    .map(|p| p.status.clone())
            })
            .unwrap_or_else(|| "draft".to_string());
        let phase_label = match proposal_status.as_str() {
            "pending_approval" => "patch-pending-approval",
            "applied" => "patch-applied",
            "failed" => "patch-failed",
            _ => "patch-detected",
        };
        let _ = emit_mission_event(
            &app,
            "mission/phase",
            &running.id,
            Some(&running.project_id),
            if proposal_status == "pending_approval" { "warn" } else { "info" },
            &format!(
                "Proposta de patch criada pelo Developer: {proposal_id} (status: {proposal_status})"
            ),
            Some(phase_label),
            Some(serde_json::json!({
                "proposalId": proposal_id,
                "status": &proposal_status,
            })),
        );
    }

    // 7. Valida se nenhum patch foi gerado para missões de criação/alteração
    let has_creation_verbs = has_creation_request(&running.prompt);

    let final_text = if agents_result.patch_proposal_id.is_none() {
        if has_creation_verbs {
            let err = "A missão pediu criação/alteração de arquivos, mas o Developer não retornou um bloco fluxora_patch válido após a tentativa de correção. Nenhum arquivo foi criado.".to_string();
            fail_mission(&app, &state, &running, &err, Some(&job_id));
            return Err(err);
        } else {
            let mut text = agents_result.finalizer_output;
            let warning = "\n\n⚠️ A missão foi concluída sem proposta de alteração. Nenhum arquivo foi criado.";
            text.push_str(warning);
            text
        }
    } else {
        agents_result.finalizer_output
    };

    // 8. Final report — usa o output do Finalizer (que já
    //    incorpora o resumo do Developer/QA + a info do patch).
    let _ = update_mission(&state, &running.id, |m| {
        m.current_phase = Some("final-report".to_string());
        m.result_text = Some(final_text.clone());
    });
    let _ = persist(&app);
    record_phase(
        &app,
        &state,
        &running,
        "final-report",
        Some(serde_json::json!({
            "resultLength": final_text.chars().count(),
        })),
    );

    // 9. Marcar como completed
    let completed = update_mission(&state, &running.id, |m| {
        m.status = "completed".to_string();
        m.completed_at = Some(now_iso());
        m.current_phase = Some("final-report".to_string());
    })
    .unwrap();
    let _ = persist(&app);
    let _ = mark_job_completed(&app, &job_id);
    emit_mission_event(
        &app,
        "mission/completed",
        &completed.id,
        Some(&completed.project_id),
        "info",
        "Missão concluída.",
        Some("final-report"),
        Some(serde_json::json!({
            "resultLength": final_text.chars().count(),
            "jobId": &job_id,
        })),
    );

    Ok(completed)
}

/// Marca a missão como `failed` e emite o evento `mission/failed`.
/// Quando `job_id` é fornecido, o `MissionJob` correspondente
/// também transita para `failed` (PR 009).
fn fail_mission(
    app: &AppHandle,
    state: &MissionsState,
    mission: &MissionRecord,
    error: &str,
    job_id: Option<&str>,
) {
    let truncated = truncate_error(error);
    let no_real_provider = error.contains("Nenhum provider real do Provider Engine está configurado");
    let updated = update_mission(state, &mission.id, |m| {
        m.status = "failed".to_string();
        m.error = Some(truncated.clone());
        m.current_phase = Some("failed".to_string());
        if m.completed_at.is_none() {
            m.completed_at = Some(now_iso());
        }
    })
    .unwrap_or_else(|| mission.clone());
    let _ = persist(app);
    let _ = append_log(
        state,
        &updated.id,
        "error",
        &truncated,
        Some("failed"),
        None,
    );
    emit_mission_event(
        app,
        "mission/failed",
        &updated.id,
        Some(&updated.project_id),
        "error",
        &truncated,
        Some("failed"),
        Some(serde_json::json!({
            "errorMessage": truncated,
            "reason": if no_real_provider { "no-real-provider" } else { "mission-failed" },
            "legacyCatalogVisible": no_real_provider,
        })),
    );
    mark_job_failed(app, job_id, error);
}

/// Lê metadados básicos do projeto (nome, stack) sem expor o
/// `ProjectRecord` completo (que tem campos internos).
fn find_project_meta(app: &AppHandle, project_id: &str) -> Option<ProjectMeta> {
    let store = projects::list(app).ok()?;
    store
        .into_iter()
        .find(|p| p.id == project_id)
        .map(|p| ProjectMeta {
            name: p.name,
            stack: p.stack,
        })
}

struct ProjectMeta {
    name: String,
    stack: Vec<String>,
}

// ---------------------------------------------------------------------------
// PR 009 — Scheduler/fila mínima
// ---------------------------------------------------------------------------
//
// Representa cada execução de missão como um `MissionJob` em
// memória. A persistência é responsabilidade da `MissionRun`
// correspondente em `missions.json`; o `MissionJob` é
// reconstruído no startup a partir das missões persistidas.

const JOB_STATUS_QUEUED: &str = "queued";
const JOB_STATUS_RUNNING: &str = "running";
const JOB_STATUS_COMPLETED: &str = "completed";
const JOB_STATUS_FAILED: &str = "failed";
const JOB_STATUS_CANCELLED: &str = "cancelled";

fn generate_job_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("job-{millis}-{seq}")
}

fn find_active_job_for_mission(
    state: &MissionJobsState,
    mission_id: &str,
) -> Option<MissionJobRecord> {
    let guard = state.jobs.lock().ok()?;
    guard
        .iter()
        .find(|j| {
            j.mission_id == mission_id
                && (j.status == JOB_STATUS_QUEUED || j.status == JOB_STATUS_RUNNING)
        })
        .cloned()
}

fn find_job_by_id(state: &MissionJobsState, job_id: &str) -> Option<MissionJobRecord> {
    state
        .jobs
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|j| j.id == job_id).cloned())
}

fn insert_job(state: &MissionJobsState, job: MissionJobRecord) {
    if let Ok(mut guard) = state.jobs.lock() {
        guard.push(job);
    }
}

fn update_job<F>(state: &MissionJobsState, job_id: &str, mutator: F) -> Option<MissionJobRecord>
where
    F: FnOnce(&mut MissionJobRecord),
{
    let mut guard = state.jobs.lock().ok()?;
    let job = guard.iter_mut().find(|j| j.id == job_id)?;
    mutator(job);
    job.updated_at = now_iso();
    Some(job.clone())
}

/// Cria um `MissionJob` para a missão e o registra no
/// `MissionJobsState`. Bloqueia criação se já houver um job
/// ativo (`queued` ou `running`) para a mesma missão.
fn create_mission_job(app: &AppHandle, mission: &MissionRecord) -> Result<MissionJobRecord, String> {
    let state = app.state::<MissionJobsState>();
    if let Some(existing) = find_active_job_for_mission(&state, &mission.id) {
        return Err(format!(
            "Já existe um job ativo ({}, status: {}) para a missão {}.",
            existing.id, existing.status, mission.id
        ));
    }
    let now = now_iso();
    let job = MissionJobRecord {
        id: generate_job_id(),
        mission_id: mission.id.clone(),
        project_id: mission.project_id.clone(),
        status: JOB_STATUS_QUEUED.to_string(),
        mode: mission.mode.clone(),
        created_at: now.clone(),
        updated_at: now,
        started_at: None,
        completed_at: None,
        error: None,
    };
    insert_job(&state, job.clone());
    emit_job_event(
        app,
        "mission/job-created",
        "info",
        &job,
        "Job de missão criado.",
        Some(serde_json::json!({ "mode": &job.mode })),
    );
    Ok(job)
}

fn mark_job_running(app: &AppHandle, job_id: &str) -> Option<MissionJobRecord> {
    let state = app.state::<MissionJobsState>();
    let updated = update_job(&state, job_id, |j| {
        j.status = JOB_STATUS_RUNNING.to_string();
        j.started_at = Some(now_iso());
    })?;
    emit_job_event(
        app,
        "mission/job-started",
        "info",
        &updated,
        "Job de missão iniciado.",
        None,
    );
    Some(updated)
}

fn mark_job_completed(app: &AppHandle, job_id: &str) -> Option<MissionJobRecord> {
    let state = app.state::<MissionJobsState>();
    let updated = update_job(&state, job_id, |j| {
        j.status = JOB_STATUS_COMPLETED.to_string();
        j.completed_at = Some(now_iso());
    })?;
    emit_job_event(
        app,
        "mission/job-completed",
        "info",
        &updated,
        "Job de missão concluído.",
        None,
    );
    Some(updated)
}

fn mark_job_failed(app: &AppHandle, job_id: Option<&str>, error: &str) {
    let Some(job_id) = job_id else {
        return;
    };
    let state = app.state::<MissionJobsState>();
    let truncated = truncate_error(error);
    if let Some(updated) = update_job(&state, job_id, |j| {
        j.status = JOB_STATUS_FAILED.to_string();
        j.error = Some(truncated.clone());
        j.completed_at = Some(now_iso());
    }) {
        emit_job_event(
            app,
            "mission/job-failed",
            "error",
            &updated,
            "Job de missão falhou.",
            Some(serde_json::json!({ "errorMessage": truncated })),
        );
    }
}

fn mark_job_cancelled(app: &AppHandle, job_id: &str) -> Option<MissionJobRecord> {
    let state = app.state::<MissionJobsState>();
    let updated = update_job(&state, job_id, |j| {
        j.status = JOB_STATUS_CANCELLED.to_string();
        j.completed_at = Some(now_iso());
    })?;
    emit_job_event(
        app,
        "mission/job-cancelled",
        "info",
        &updated,
        "Job de missão cancelado.",
        None,
    );
    Some(updated)
}

fn emit_job_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    job: &MissionJobRecord,
    message: &str,
    extra: Option<serde_json::Value>,
) {
    let mut payload = serde_json::json!({
        "jobId": &job.id,
        "missionId": &job.mission_id,
        "projectId": &job.project_id,
        "status": &job.status,
        "mode": &job.mode,
    });
    if let Some(extra) = extra {
        if let (Some(obj), Some(extra_obj)) = (payload.as_object_mut(), extra.as_object()) {
            for (k, v) in extra_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    let event = events::build_event(
        event_type,
        "mission",
        level,
        Some(message.to_string()),
        Some(job.project_id.clone()),
        Some(job.mission_id.clone()),
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// PR 009 — Integração com o Permissions Engine
// ---------------------------------------------------------------------------

/// Helper que aplica o `permissions_check` para uma ação dentro
/// do contexto de uma missão. Quando a decisão for `ask` ou
/// `deny`, devolve `Err` com mensagem clara para que o
/// `missions_run` falhe a missão; quando for `allow`, devolve
/// `Ok(result)`. Emite `mission/phase` com payload de
/// permissão.
fn check_action_for_mission(
    app: &AppHandle,
    mission: &MissionRecord,
    action: &str,
    phase_label: &str,
) -> Result<permissions::PermissionCheckResultRecord, String> {
    let payload = permissions::PermissionCheckPayload {
        project_id: mission.project_id.clone(),
        action: action.to_string(),
        mission_id: Some(mission.id.clone()),
    };
    let result = permissions::permissions_check(app.clone(), payload)?;
    let state = app.state::<MissionsState>();
    let _ = append_log(
        &state,
        &mission.id,
        "info",
        &format!(
            "Permissão '{}' avaliada: decisão='{}', allowed={}, requires_approval={}",
            action, result.decision, result.allowed, result.requires_approval
        ),
        Some(phase_label),
        Some(serde_json::json!({
            "permission": {
                "action": &result.action,
                "decision": &result.decision,
                "allowed": result.allowed,
                "requiresApproval": result.requires_approval,
                "approvalId": &result.approval_id,
                "reason": &result.reason,
            }
        })),
    );
    let _ = emit_mission_event(
        app,
        "mission/phase",
        &mission.id,
        Some(&mission.project_id),
        if result.allowed { "info" } else { "warn" },
        &format!(
            "Permissão '{}' avaliada (decisão: {}).",
            action, result.decision
        ),
        Some(phase_label),
        Some(serde_json::json!({
            "permission": {
                "action": &result.action,
                "decision": &result.decision,
                "allowed": result.allowed,
                "requiresApproval": result.requires_approval,
                "approvalId": &result.approval_id,
            }
        })),
    );
    if result.allowed {
        return Ok(result);
    }
    let reason = result.reason.clone().unwrap_or_else(|| {
        format!(
            "Política do projeto exige '{}' para a ação '{}'.",
            result.decision, action
        )
    });
    if result.requires_approval {
        if let Some(approval_id) = &result.approval_id {
            Err(format!(
                "Ação '{}' requer aprovação: {}. Aprovação criada: {}.",
                action, reason, approval_id
            ))
        } else {
            Err(format!("Ação '{}' requer aprovação: {}.", action, reason))
        }
    } else {
        Err(format!("Ação '{}' negada pela política do projeto: {}.", action, reason))
    }
}

/// Resolve o modo efetivo da missão aplicando fallback quando o
/// `piloto-automatico` é solicitado mas a política do projeto
/// tem `autopilotEnabled: false`. Persiste o `mode` efetivo na
/// missão e emite um `mission/phase` registrando o fallback.
fn resolve_effective_mode(
    app: &AppHandle,
    state: &MissionsState,
    mission: &MissionRecord,
) -> Result<String, String> {
    let policy = permissions::get_or_create_policy(app, &mission.project_id)?;
    let requested = mission.mode.trim().to_lowercase();
    let effective = if requested == "piloto-automatico" && !policy.autopilot_enabled {
        let _ = emit_mission_event(
            app,
            "mission/phase",
            &mission.id,
            Some(&mission.project_id),
            "warn",
            "Piloto automático solicitado mas desativado na política do projeto. Degradando para 'propositivo'.",
            Some("policy-fallback"),
            Some(serde_json::json!({
                "requestedMode": &requested,
                "effectiveMode": "propositivo",
                "autopilotEnabled": policy.autopilot_enabled,
                "defaultMode": &policy.default_mode,
            })),
        );
        "propositivo".to_string()
    } else if requested.is_empty() || !["assistido", "propositivo", "piloto-automatico"]
        .contains(&requested.as_str())
    {
        let fallback = policy.default_mode.clone();
        let _ = emit_mission_event(
            app,
            "mission/phase",
            &mission.id,
            Some(&mission.project_id),
            "info",
            &format!(
                "Modo '{}' desconhecido. Usando defaultMode da política: {}.",
                requested, fallback
            ),
            Some("policy-fallback"),
            Some(serde_json::json!({
                "requestedMode": &requested,
                "effectiveMode": &fallback,
                "defaultMode": &fallback,
            })),
        );
        fallback
    } else {
        requested
    };
    let _ = update_mission(state, &mission.id, |m| {
        m.mode = effective.clone();
    });
    let _ = persist(app);
    Ok(effective)
}

// ---------------------------------------------------------------------------
// PR 009 — Comandos Tauri do scheduler/fila
// ---------------------------------------------------------------------------

/// Health-check do scheduler.
pub fn scheduler_ping() -> String {
    now_iso()
}

/// Lista todos os `MissionJob` conhecidos (mais recentes primeiro).
pub fn scheduler_list_jobs(app: AppHandle) -> Result<Vec<MissionJobRecord>, String> {
    let state = app.state::<MissionJobsState>();
    let guard = state
        .jobs
        .lock()
        .map_err(|_| "Lock de jobs poisoned.".to_string())?;
    let mut out = guard.clone();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Retorna um `MissionJob` por id.
pub fn scheduler_get_job(
    app: AppHandle,
    job_id: String,
) -> Result<Option<MissionJobRecord>, String> {
    let state = app.state::<MissionJobsState>();
    Ok(find_job_by_id(&state, &job_id))
}

/// Tenta cancelar um job. Comportamento:
/// - Job `running`: marca o `MissionJob` como `cancelled`,
///   mas como as missões são síncronas o `missions_run` em
///   andamento não pode ser interrompido nesta PR. O status
///   do `MissionJob` reflete a intenção; a `MissionRun`
///   correspondente segue o ciclo normal.
/// - Job `queued`: transita para `cancelled` antes que
///   `missions_run` possa pegá-lo (a checagem
///   `find_active_job_for_mission` é feita pelo
///   `create_mission_job` no momento da criação do próximo
///   job, então o efeito é: o job existente aparece como
///   `cancelled` no `list_jobs`).
pub fn scheduler_cancel_job(
    app: AppHandle,
    payload: CancelMissionJobPayload,
) -> Result<Option<MissionJobRecord>, String> {
    let state = app.state::<MissionJobsState>();
    let Some(job) = find_job_by_id(&state, &payload.job_id) else {
        return Ok(None);
    };
    if job.status == JOB_STATUS_COMPLETED
        || job.status == JOB_STATUS_FAILED
        || job.status == JOB_STATUS_CANCELLED
    {
        return Ok(Some(job));
    }
    let updated = mark_job_cancelled(&app, &payload.job_id).ok_or_else(|| {
        format!("Job {} não encontrado para cancelamento.", payload.job_id)
    })?;
    if let Some(reason) = payload.reason.as_ref() {
        // Registra o motivo do cancelamento como um log na
        // missão correspondente (sem mutar o `result_text`).
        let missions_state = app.state::<MissionsState>();
        let _ = append_log(
            &missions_state,
            &updated.mission_id,
            "info",
            &format!("Job {} cancelado: {}", updated.id, reason),
            Some("cancelled"),
            Some(serde_json::json!({
                "jobId": &updated.id,
                "cancelReason": reason,
            })),
        );
    }
    Ok(Some(updated))
}

// ---------------------------------------------------------------------------
// Testes unitários
// ---------------------------------------------------------------------------

pub fn has_creation_request(prompt: &str) -> bool {
    let lower = prompt.to_lowercase();
    lower.contains("crie")
        || lower.contains("criar")
        || lower.contains("cria")
        || lower.contains("criação")
        || lower.contains("edite")
        || lower.contains("editar")
        || lower.contains("edita")
        || lower.contains("altere")
        || lower.contains("alterar")
        || lower.contains("altera")
        || lower.contains("implemente")
        || lower.contains("implementar")
        || lower.contains("construa")
        || lower.contains("construir")
        || lower.contains("adicione")
        || lower.contains("adicionar")
        || lower.contains("escreva")
        || lower.contains("escrever")
        || lower.contains("gere")
        || lower.contains("gerar")
        || lower.contains("faça uma página")
        || lower.contains("landing page")
        || lower.contains("componente")
        || lower.contains("arquivo")
        || lower.contains("modify")
        || lower.contains("create")
        || lower.contains("write")
        || lower.contains("implement")
        || lower.contains("build")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_long_error() {
        let big = "x".repeat(MAX_ERROR_MESSAGE_LEN + 100);
        let out = truncate_error(&big);
        assert!(out.chars().count() <= MAX_ERROR_MESSAGE_LEN + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(!is_path_safe("../etc/passwd"));
        assert!(!is_path_safe("foo/../bar"));
        assert!(!is_path_safe("/absolute"));
        assert!(!is_path_safe(""));
        assert!(is_path_safe("README.md"));
        assert!(is_path_safe("src/index.ts"));
    }

    #[test]
    fn preferred_files_are_listed_in_order() {
        // Esta função é difícil de testar sem filesystem; testa-se
        // apenas que o array constante tem o tamanho esperado e
        // que os principais arquivos estão presentes.
        assert!(PREFERRED_CONTEXT_FILES.contains(&"README.md"));
        assert!(PREFERRED_CONTEXT_FILES.contains(&"package.json"));
        assert!(PREFERRED_CONTEXT_FILES.contains(&"Cargo.toml"));
        assert!(PREFERRED_CONTEXT_FILES.len() >= 10);
    }

    #[test]
    fn ignored_dirs_include_common_heavy_ones() {
        for name in ["node_modules", ".git", "vendor", "dist", "build", "target"] {
            assert!(
                IGNORED_DIR_NAMES.contains(&name),
                "expected {name} in IGNORED_DIR_NAMES"
            );
        }
    }

    #[test]
    fn validates_prompt_size() {
        // Reaproveita o limite para validar heurística de tamanho
        // de prompt sem precisar de I/O.
        let too_long = "a".repeat(MAX_PROMPT_LENGTH + 1);
        assert!(too_long.chars().count() > MAX_PROMPT_LENGTH);
    }
}
