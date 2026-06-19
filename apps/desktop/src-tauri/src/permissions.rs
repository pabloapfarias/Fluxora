// PR 009 — Permissions Engine do Fluxora.
//
// Cria a infraestrutura de permissões por projeto que prepara o
// terreno para o piloto automático. Esta PR entrega:
//
// - Persistência local de políticas em
//   `<app_data_dir>/fluxora/permissions.json` (versionado).
// - Política padrão conservadora por projeto, criada sob demanda
//   quando o projeto é referenciado pela primeira vez.
// - Comandos Tauri: `permissions_ping` /
//   `permissions_get_project_policy` /
//   `permissions_update_project_policy` /
//   `permissions_list_policies` /
//   `permissions_reset_project_policy` /
//   `permissions_check`.
// - Emissão de eventos `permission/*` no barramento `fluxora-event`
//   (PR 005): `permission/check`, `permission/allowed`,
//   `permission/denied`, `permission/approval-required`.
// - Integração indireta com o módulo `approvals.rs` da PR 009:
//   quando a decisão de uma checagem for `ask`, uma
//   `ExecutionApproval` pendente é criada automaticamente.
//
// **Esta PR NÃO aplica patch, NÃO executa comandos de shell, NÃO
// faz Git write operations.** A aplicação real de permissões em
// ações de escrita fica para a PR 010. O Mission Engine
// (PR 008) passa a consultar `read-files` e `network-provider`
// (as únicas permissões necessárias para a execução
// read-only/propositiva), que têm default `allow` — portanto
// missões existentes continuam funcionando sem mudança
// observável pela UI.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

use crate::approvals;
use crate::events;

// ---------------------------------------------------------------------------
// Tipos canônicos (espelham `ProjectExecutionPolicy` /
// `PermissionAction` / `PermissionDecision` / `ExecutionMode` em
// `@fluxora/shared`).
// ---------------------------------------------------------------------------

const ACTION_READ_FILES: &str = "read-files";
const ACTION_WRITE_FILES: &str = "write-files";
const ACTION_CREATE_FILES: &str = "create-files";
const ACTION_DELETE_FILES: &str = "delete-files";
const ACTION_MOVE_FILES: &str = "move-files";
const ACTION_RUN_COMMANDS: &str = "run-commands";
const ACTION_INSTALL_DEPS: &str = "install-dependencies";
const ACTION_GIT_READ: &str = "git-read";
const ACTION_GIT_WRITE: &str = "git-write";
const ACTION_NETWORK_PROVIDER: &str = "network-provider";
const ACTION_APPLY_PATCH: &str = "apply-patch";
const ACTION_COMMIT: &str = "commit";
const ACTION_PUSH: &str = "push";

const DECISION_ALLOW: &str = "allow";
const DECISION_ASK: &str = "ask";
const DECISION_DENY: &str = "deny";

const MODE_ASSISTIDO: &str = "assistido";
const MODE_PROPOSITIVO: &str = "propositivo";
const MODE_PILOTO_AUTOMATICO: &str = "piloto-automatico";

/// Lista canônica de ações reconhecidas pelo Permissions Engine.
/// Mantida em sincronia com `PERMISSION_ACTIONS` em
/// `@fluxora/shared`.
const ALL_ACTIONS: &[&str] = &[
    ACTION_READ_FILES,
    ACTION_WRITE_FILES,
    ACTION_CREATE_FILES,
    ACTION_DELETE_FILES,
    ACTION_MOVE_FILES,
    ACTION_RUN_COMMANDS,
    ACTION_INSTALL_DEPS,
    ACTION_GIT_READ,
    ACTION_GIT_WRITE,
    ACTION_NETWORK_PROVIDER,
    ACTION_APPLY_PATCH,
    ACTION_COMMIT,
    ACTION_PUSH,
];

/// Lista canônica de modos de execução reconhecidos.
const ALL_MODES: &[&str] = &[MODE_ASSISTIDO, MODE_PROPOSITIVO, MODE_PILOTO_AUTOMATICO];

/// Constrói o mapa padrão de decisões (mesmo conteúdo de
/// `DEFAULT_PERMISSION_DECISIONS` em `@fluxora/shared`).
fn default_permissions_map() -> std::collections::BTreeMap<String, String> {
    let mut map = std::collections::BTreeMap::new();
    let allow: &[&str] = &[ACTION_READ_FILES, ACTION_GIT_READ, ACTION_NETWORK_PROVIDER];
    let ask: &[&str] = &[
        ACTION_WRITE_FILES,
        ACTION_CREATE_FILES,
        ACTION_MOVE_FILES,
        ACTION_RUN_COMMANDS,
        ACTION_INSTALL_DEPS,
        ACTION_APPLY_PATCH,
    ];
    let deny: &[&str] = &[
        ACTION_DELETE_FILES,
        ACTION_GIT_WRITE,
        ACTION_COMMIT,
        ACTION_PUSH,
    ];
    for action in allow {
        map.insert((*action).to_string(), DECISION_ALLOW.to_string());
    }
    for action in ask {
        map.insert((*action).to_string(), DECISION_ASK.to_string());
    }
    for action in deny {
        map.insert((*action).to_string(), DECISION_DENY.to_string());
    }
    map
}

// ---------------------------------------------------------------------------
// Estruturas de dados
// ---------------------------------------------------------------------------

/// Política de execução por projeto (espelha `ProjectExecutionPolicy`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExecutionPolicyRecord {
    pub project_id: String,
    pub default_mode: String,
    pub permissions: std::collections::BTreeMap<String, String>,
    pub autopilot_enabled: bool,
    pub require_approval_for_high_risk: bool,
    pub max_autopilot_steps: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
}

/// Estado em memória.
pub struct PermissionsState {
    pub policies: Mutex<Vec<ProjectExecutionPolicyRecord>>,
}

impl PermissionsState {
    pub fn new() -> Self {
        Self {
            policies: Mutex::new(Vec::new()),
        }
    }
}

/// Estrutura versionada do `permissions.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PermissionsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    policies: Vec<ProjectExecutionPolicyRecord>,
}

fn default_version() -> u32 {
    1
}

impl Default for PermissionsFile {
    fn default() -> Self {
        Self {
            version: 1,
            policies: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Payloads de entrada/saída
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicyPayload {
    #[serde(default)]
    pub default_mode: Option<String>,
    #[serde(default)]
    pub permissions: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    pub autopilot_enabled: Option<bool>,
    #[serde(default)]
    pub require_approval_for_high_risk: Option<bool>,
    #[serde(default)]
    pub max_autopilot_steps: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckPayload {
    pub project_id: String,
    pub action: String,
    #[serde(default)]
    pub mission_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckResultRecord {
    pub action: String,
    pub decision: String,
    pub allowed: bool,
    pub requires_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    events::iso_now()
}

fn generate_policy_event_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("permission-evt-{millis}-{seq}")
}

fn permissions_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("permissions.json"))
}

fn ensure_permissions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = permissions_file_path(app)?;
    let parent = file_path.parent().ok_or_else(|| {
        "Não foi possível resolver o diretório de persistência de permissões.".to_string()
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!("Não foi possível criar o diretório de persistência: {error}")
    })?;
    Ok(file_path)
}

fn read_permissions_file(app: &AppHandle) -> Result<PermissionsFile, String> {
    let file_path = ensure_permissions_dir(app)?;
    if !file_path.exists() {
        return Ok(PermissionsFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(PermissionsFile::default());
    }
    serde_json::from_str::<PermissionsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de permissões inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_permissions_file(app: &AppHandle, store: &PermissionsFile) -> Result<(), String> {
    let file_path = ensure_permissions_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar as permissões: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/// Carrega o arquivo de permissões no startup do Tauri. Falhas
/// de I/O são logadas e descartadas — o app continua com
/// estado vazio até o primeiro `getProjectPolicy`.
pub fn load_permissions_on_startup(app: &AppHandle) {
    match read_permissions_file(app) {
        Ok(store) => {
            let count = store.policies.len();
            if let Some(state) = app.try_state::<PermissionsState>() {
                if let Ok(mut policies) = state.policies.lock() {
                    *policies = store.policies;
                }
                eprintln!("[fluxora permissions] carregadas {count} política(s)");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora permissions] falha ao carregar permissions.json: {error}. Iniciando vazio."
            );
        }
    }
}

/// Persiste o estado atual em `permissions.json`.
fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<PermissionsState>();
    let policies = state
        .policies
        .lock()
        .map_err(|_| "Lock de permissões poisoned.".to_string())?
        .clone();
    let store = PermissionsFile {
        version: 1,
        policies,
    };
    write_permissions_file(app, &store)
}

// ---------------------------------------------------------------------------
// Validação de inputs
// ---------------------------------------------------------------------------

fn validate_action(action: &str) -> Result<(), String> {
    if !ALL_ACTIONS.contains(&action) {
        return Err(format!(
            "Ação de permissão desconhecida: '{action}'. Permitidas: {}.",
            ALL_ACTIONS.join(", ")
        ));
    }
    Ok(())
}

fn validate_decision(decision: &str) -> Result<(), String> {
    match decision {
        DECISION_ALLOW | DECISION_ASK | DECISION_DENY => Ok(()),
        other => Err(format!(
            "Decisão de permissão inválida: '{other}'. Permitidas: allow, ask, deny."
        )),
    }
}

fn validate_mode(mode: &str) -> Result<(), String> {
    if !ALL_MODES.contains(&mode) {
        return Err(format!(
            "Modo de execução inválido: '{mode}'. Permitidos: {}.",
            ALL_MODES.join(", ")
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Mutações de estado
// ---------------------------------------------------------------------------

fn find_policy(state: &PermissionsState, project_id: &str) -> Option<ProjectExecutionPolicyRecord> {
    state
        .policies
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|p| p.project_id == project_id).cloned())
}

fn upsert_policy(
    state: &PermissionsState,
    policy: ProjectExecutionPolicyRecord,
) -> ProjectExecutionPolicyRecord {
    let mut guard = match state.policies.lock() {
        Ok(guard) => guard,
        Err(_) => return policy,
    };
    if let Some(existing) = guard.iter_mut().find(|p| p.project_id == policy.project_id) {
        *existing = policy.clone();
    } else {
        guard.push(policy.clone());
    }
    policy
}

fn build_default_policy(project_id: &str) -> ProjectExecutionPolicyRecord {
    let now = now_iso();
    ProjectExecutionPolicyRecord {
        project_id: project_id.to_string(),
        default_mode: MODE_PROPOSITIVO.to_string(),
        permissions: default_permissions_map(),
        autopilot_enabled: false,
        require_approval_for_high_risk: true,
        max_autopilot_steps: Some(20),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn merge_policy(
    current: &ProjectExecutionPolicyRecord,
    payload: UpdatePolicyPayload,
) -> Result<ProjectExecutionPolicyRecord, String> {
    if let Some(ref mode) = payload.default_mode {
        validate_mode(mode)?;
    }
    if let Some(ref perms) = payload.permissions {
        for (action, decision) in perms.iter() {
            validate_action(action)?;
            validate_decision(decision)?;
        }
    }
    let mut next = current.clone();
    if let Some(mode) = payload.default_mode {
        next.default_mode = mode;
    }
    if let Some(perms) = payload.permissions {
        for (action, decision) in perms.into_iter() {
            next.permissions.insert(action, decision);
        }
    }
    if let Some(enabled) = payload.autopilot_enabled {
        next.autopilot_enabled = enabled;
    }
    if let Some(high_risk) = payload.require_approval_for_high_risk {
        next.require_approval_for_high_risk = high_risk;
    }
    if let Some(max_steps) = payload.max_autopilot_steps {
        next.max_autopilot_steps = Some(max_steps);
    }
    next.updated_at = now_iso();
    Ok(next)
}

/// Resolve ou cria a política de um projeto (helper interno
/// reutilizado pelo Mission Engine).
pub fn get_or_create_policy(
    app: &AppHandle,
    project_id: &str,
) -> Result<ProjectExecutionPolicyRecord, String> {
    let state = app.state::<PermissionsState>();
    if let Some(policy) = find_policy(&state, project_id) {
        return Ok(policy);
    }
    let policy = build_default_policy(project_id);
    let stored = upsert_policy(&state, policy);
    persist(app)?;
    Ok(stored)
}

// ---------------------------------------------------------------------------
// Comandos Tauri (chamados como wrappers em lib.rs)
// ---------------------------------------------------------------------------

/// Health-check simples.
pub fn permissions_ping() -> String {
    now_iso()
}

/// Retorna a política de um projeto (cria a default se não existir).
pub fn permissions_get_project_policy(
    app: AppHandle,
    project_id: String,
) -> Result<ProjectExecutionPolicyRecord, String> {
    get_or_create_policy(&app, &project_id)
}

/// Lista todas as políticas persistidas.
pub fn permissions_list_policies(
    app: AppHandle,
) -> Result<Vec<ProjectExecutionPolicyRecord>, String> {
    let state = app.state::<PermissionsState>();
    let guard = state
        .policies
        .lock()
        .map_err(|_| "Lock de permissões poisoned.".to_string())?;
    let mut out: Vec<ProjectExecutionPolicyRecord> = guard.clone();
    out.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    Ok(out)
}

/// Atualiza (merge) a política de um projeto. Cria a default
/// caso ainda não exista.
pub fn permissions_update_project_policy(
    app: AppHandle,
    project_id: String,
    payload: UpdatePolicyPayload,
) -> Result<ProjectExecutionPolicyRecord, String> {
    let state = app.state::<PermissionsState>();
    let current = find_policy(&state, &project_id).unwrap_or_else(|| build_default_policy(&project_id));
    let next = merge_policy(&current, payload)?;
    let stored = upsert_policy(&state, next);
    persist(&app)?;
    Ok(stored)
}

/// Reseta a política de um projeto para a default.
pub fn permissions_reset_project_policy(
    app: AppHandle,
    project_id: String,
) -> Result<ProjectExecutionPolicyRecord, String> {
    let state = app.state::<PermissionsState>();
    let mut guard = state
        .policies
        .lock()
        .map_err(|_| "Lock de permissões poisoned.".to_string())?;
    let new_policy = build_default_policy(&project_id);
    if let Some(existing) = guard.iter_mut().find(|p| p.project_id == project_id) {
        *existing = new_policy.clone();
    } else {
        guard.push(new_policy.clone());
    }
    drop(guard);
    persist(&app)?;
    Ok(new_policy)
}

/// Avalia uma `PermissionAction` para um projeto. Quando a
/// decisão for `ask`, cria automaticamente uma
/// `ExecutionApproval` pendente e marca o resultado com
/// `requiresApproval: true`.
pub fn permissions_check(
    app: AppHandle,
    payload: PermissionCheckPayload,
) -> Result<PermissionCheckResultRecord, String> {
    validate_action(&payload.action)?;
    let policy = get_or_create_policy(&app, &payload.project_id)?;
    let decision = policy
        .permissions
        .get(&payload.action)
        .cloned()
        .unwrap_or_else(|| DECISION_ASK.to_string());

    // Emite permission/check sempre
    emit_permission_event(
        &app,
        "permission/check",
        "info",
        &payload.project_id,
        payload.mission_id.as_deref(),
        &format!(
            "Verificando permissão '{}' (decisão atual: {})",
            payload.action, decision
        ),
        &serde_json::json!({
            "eventId": generate_policy_event_id(),
            "action": &payload.action,
            "decision": &decision,
            "policyDefaultMode": &policy.default_mode,
            "autopilotEnabled": policy.autopilot_enabled,
        }),
    );

    match decision.as_str() {
        DECISION_ALLOW => {
            let result = PermissionCheckResultRecord {
                action: payload.action.clone(),
                decision: decision.clone(),
                allowed: true,
                requires_approval: false,
                approval_id: None,
                reason: Some("Política do projeto permite a ação.".to_string()),
            };
            emit_permission_event(
                &app,
                "permission/allowed",
                "info",
                &payload.project_id,
                payload.mission_id.as_deref(),
                &format!(
                    "Permissão '{}' concedida pela política do projeto.",
                    payload.action
                ),
                &serde_json::json!({
                    "action": &payload.action,
                    "decision": &decision,
                }),
            );
            Ok(result)
        }
        DECISION_DENY => {
            let result = PermissionCheckResultRecord {
                action: payload.action.clone(),
                decision: decision.clone(),
                allowed: false,
                requires_approval: false,
                approval_id: None,
                reason: Some(
                    "Política do projeto proíbe a ação. Atualize a política ou use um modo mais restritivo."
                        .to_string(),
                ),
            };
            emit_permission_event(
                &app,
                "permission/denied",
                "warn",
                &payload.project_id,
                payload.mission_id.as_deref(),
                &format!(
                    "Permissão '{}' negada pela política do projeto.",
                    payload.action
                ),
                &serde_json::json!({
                    "action": &payload.action,
                    "decision": &decision,
                }),
            );
            Ok(result)
        }
        DECISION_ASK => {
            // Cria uma Approval pendente via módulo `approvals`.
            let title = format!(
                "Aprovar ação: {}",
                humanize_action(&payload.action)
            );
            let description = format!(
                "A política do projeto '{}' exige aprovação explícita para a ação '{}' (modo de execução padrão: {}, piloto automático: {}).",
                payload.project_id,
                payload.action,
                policy.default_mode,
                if policy.autopilot_enabled { "ativado" } else { "desativado" },
            );
            let risk = risk_for_action(&payload.action);
            let create_payload = approvals::CreateApprovalPayload {
                project_id: Some(payload.project_id.clone()),
                mission_id: payload.mission_id.clone(),
                action: payload.action.clone(),
                title,
                description,
                risk,
                requested_by: Some("permissions-check".to_string()),
                payload: Some(serde_json::json!({
                    "source": "permissions-check",
                    "policyDefaultMode": policy.default_mode,
                    "autopilotEnabled": policy.autopilot_enabled,
                })),
            };
            let approval = approvals::approvals_create(app.clone(), create_payload)?;
            let result = PermissionCheckResultRecord {
                action: payload.action.clone(),
                decision: decision.clone(),
                allowed: false,
                requires_approval: true,
                approval_id: Some(approval.id.clone()),
                reason: Some(
                    "Política do projeto exige aprovação. Uma ExecutionApproval foi criada."
                        .to_string(),
                ),
            };
            emit_permission_event(
                &app,
                "permission/approval-required",
                "warn",
                &payload.project_id,
                payload.mission_id.as_deref(),
                &format!(
                    "Permissão '{}' exige aprovação. ExecutionApproval {} criada.",
                    payload.action, approval.id
                ),
                &serde_json::json!({
                    "action": &payload.action,
                    "decision": &decision,
                    "approvalId": &approval.id,
                    "approvalRisk": &approval.risk,
                }),
            );
            Ok(result)
        }
        other => Err(format!("Decisão de permissão desconhecida: '{other}'.")),
    }
}

// ---------------------------------------------------------------------------
// Emissão de eventos `permission/*`
// ---------------------------------------------------------------------------

fn emit_permission_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    project_id: &str,
    mission_id: Option<&str>,
    message: &str,
    payload: &serde_json::Value,
) {
    let event = events::build_event(
        event_type,
        "system",
        level,
        Some(message.to_string()),
        Some(project_id.to_string()),
        mission_id.map(|v| v.to_string()),
        None,
        Some(payload.clone()),
    );
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// Helpers de UX
// ---------------------------------------------------------------------------

/// Rótulo amigável para uma `PermissionAction` (usado em
/// descrições de Approval e mensagens de log).
pub fn humanize_action(action: &str) -> &'static str {
    match action {
        ACTION_READ_FILES => "ler arquivos",
        ACTION_WRITE_FILES => "escrever em arquivos",
        ACTION_CREATE_FILES => "criar arquivos",
        ACTION_DELETE_FILES => "apagar arquivos",
        ACTION_MOVE_FILES => "mover/renomear arquivos",
        ACTION_RUN_COMMANDS => "executar comandos do projeto",
        ACTION_INSTALL_DEPS => "instalar dependências",
        ACTION_GIT_READ => "ler histórico/status do Git",
        ACTION_GIT_WRITE => "escrever no Git (add/commit/reset/checkout)",
        ACTION_NETWORK_PROVIDER => "chamar o provider de IA (rede)",
        ACTION_APPLY_PATCH => "aplicar patch/diff em arquivos",
        ACTION_COMMIT => "fazer commit",
        ACTION_PUSH => "fazer push",
        _ => "ação desconhecida",
    }
}

/// Classifica o risco de uma ação para a `Approval` resultante.
fn risk_for_action(action: &str) -> String {
    match action {
        ACTION_READ_FILES | ACTION_GIT_READ | ACTION_NETWORK_PROVIDER => "low".to_string(),
        ACTION_WRITE_FILES
        | ACTION_CREATE_FILES
        | ACTION_MOVE_FILES
        | ACTION_RUN_COMMANDS
        | ACTION_INSTALL_DEPS
        | ACTION_APPLY_PATCH => "medium".to_string(),
        ACTION_DELETE_FILES | ACTION_GIT_WRITE | ACTION_COMMIT | ACTION_PUSH => "high".to_string(),
        _ => "medium".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Testes unitários
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_permissions_are_conservative() {
        let map = default_permissions_map();
        assert_eq!(map.get(ACTION_READ_FILES).unwrap(), DECISION_ALLOW);
        assert_eq!(map.get(ACTION_GIT_READ).unwrap(), DECISION_ALLOW);
        assert_eq!(map.get(ACTION_NETWORK_PROVIDER).unwrap(), DECISION_ALLOW);
        assert_eq!(map.get(ACTION_WRITE_FILES).unwrap(), DECISION_ASK);
        assert_eq!(map.get(ACTION_DELETE_FILES).unwrap(), DECISION_DENY);
        assert_eq!(map.get(ACTION_GIT_WRITE).unwrap(), DECISION_DENY);
        assert_eq!(map.get(ACTION_COMMIT).unwrap(), DECISION_DENY);
        assert_eq!(map.get(ACTION_PUSH).unwrap(), DECISION_DENY);
    }

    #[test]
    fn default_policy_disables_autopilot() {
        let policy = build_default_policy("proj-test");
        assert_eq!(policy.default_mode, MODE_PROPOSITIVO);
        assert!(!policy.autopilot_enabled);
        assert!(policy.require_approval_for_high_risk);
        assert!(policy.max_autopilot_steps.is_some());
    }

    #[test]
    fn validation_rejects_unknown_action() {
        assert!(validate_action("unknown-action").is_err());
        assert!(validate_action(ACTION_READ_FILES).is_ok());
    }

    #[test]
    fn validation_rejects_invalid_decision() {
        assert!(validate_decision("maybe").is_err());
        assert!(validate_decision(DECISION_ALLOW).is_ok());
        assert!(validate_decision(DECISION_ASK).is_ok());
        assert!(validate_decision(DECISION_DENY).is_ok());
    }

    #[test]
    fn validation_rejects_invalid_mode() {
        assert!(validate_mode("auto").is_err());
        assert!(validate_mode(MODE_ASSISTIDO).is_ok());
        assert!(validate_mode(MODE_PROPOSITIVO).is_ok());
        assert!(validate_mode(MODE_PILOTO_AUTOMATICO).is_ok());
    }

    #[test]
    fn humanize_action_known_values() {
        assert_eq!(humanize_action(ACTION_READ_FILES), "ler arquivos");
        assert_eq!(humanize_action(ACTION_PUSH), "fazer push");
    }

    #[test]
    fn risk_for_action_classifies_correctly() {
        assert_eq!(risk_for_action(ACTION_READ_FILES), "low");
        assert_eq!(risk_for_action(ACTION_WRITE_FILES), "medium");
        assert_eq!(risk_for_action(ACTION_DELETE_FILES), "high");
    }

    #[test]
    fn merge_policy_preserves_untouched_fields() {
        let current = build_default_policy("proj-test");
        let next = merge_policy(
            &current,
            UpdatePolicyPayload {
                default_mode: Some(MODE_PILOTO_AUTOMATICO.to_string()),
                permissions: None,
                autopilot_enabled: Some(true),
                require_approval_for_high_risk: None,
                max_autopilot_steps: None,
            },
        )
        .unwrap();
        assert_eq!(next.default_mode, MODE_PILOTO_AUTOMATICO);
        assert!(next.autopilot_enabled);
        assert!(next.require_approval_for_high_risk);
    }

    #[test]
    fn merge_policy_rejects_invalid_action() {
        let current = build_default_policy("proj-test");
        let mut bad = std::collections::BTreeMap::new();
        bad.insert("nope".to_string(), DECISION_ALLOW.to_string());
        let result = merge_policy(
            &current,
            UpdatePolicyPayload {
                default_mode: None,
                permissions: Some(bad),
                autopilot_enabled: None,
                require_approval_for_high_risk: None,
                max_autopilot_steps: None,
            },
        );
        assert!(result.is_err());
    }
}
