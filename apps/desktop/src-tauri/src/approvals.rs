// PR 009 — Aprovações operacionais do Fluxora.
//
// Cria a infraestrutura de `ExecutionApproval` para a base do
// piloto automático. Esta PR entrega:
//
// - Persistência local em
//   `<app_data_dir>/fluxora/approvals.json` (versionado).
// - Comandos Tauri: `approvals_ping` / `approvals_list` /
//   `approvals_get` / `approvals_create` /
//   `approvals_approve` / `approvals_reject` /
//   `approvals_cancel` / `approvals_list_actionable`.
// - Emissão de eventos `approval/*` no barramento `fluxora-event`
//   (PR 005): `approval/created` / `approval/approved` /
//   `approval/rejected` / `approval/cancelled` / `approval/expired`.
// - Integração com o módulo `permissions.rs` (toda `ask` no
//   `permissions_check` cria automaticamente uma Approval
//   pendente).
//
// **Esta PR NÃO aplica patch, NÃO executa comandos de shell, NÃO
// faz Git write operations.** Aprovações criadas são
// **infraestrutura**: elas não disparam patch/diff nem alteram o
// estado do projeto. A aplicação real do que a aprovação
// permitir fica para a PR 010.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

use crate::events;

// ---------------------------------------------------------------------------
// Estruturas de dados
// ---------------------------------------------------------------------------

/// `ExecutionApproval` persistida (espelha a forma canônica nova
/// em `@fluxora/shared`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionApprovalRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    pub action: String,
    pub title: String,
    pub description: String,
    pub risk: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

/// Estado em memória.
pub struct ApprovalsState {
    pub approvals: Mutex<Vec<ExecutionApprovalRecord>>,
}

impl ApprovalsState {
    pub fn new() -> Self {
        Self {
            approvals: Mutex::new(Vec::new()),
        }
    }
}

/// Estrutura versionada do `approvals.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApprovalsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    approvals: Vec<ExecutionApprovalRecord>,
}

fn default_version() -> u32 {
    1
}

impl Default for ApprovalsFile {
    fn default() -> Self {
        Self {
            version: 1,
            approvals: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApprovalPayload {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub mission_id: Option<String>,
    pub action: String,
    pub title: String,
    pub description: String,
    pub risk: String,
    #[serde(default)]
    pub requested_by: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectApprovalPayload {
    pub id: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelApprovalPayload {
    pub id: String,
    #[serde(default)]
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_PENDING: &str = "pending";
const STATUS_APPROVED: &str = "approved";
const STATUS_REJECTED: &str = "rejected";
const STATUS_CANCELLED: &str = "cancelled";

const VALID_RISKS: &[&str] = &["low", "medium", "high"];

fn now_iso() -> String {
    events::iso_now()
}

fn generate_approval_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("appr-{millis}-{seq}")
}

fn approvals_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("approvals.json"))
}

fn ensure_approvals_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = approvals_file_path(app)?;
    let parent = file_path
        .parent()
        .ok_or_else(|| "Não foi possível resolver o diretório de persistência de aprovações.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_approvals_file(app: &AppHandle) -> Result<ApprovalsFile, String> {
    let file_path = ensure_approvals_dir(app)?;
    if !file_path.exists() {
        return Ok(ApprovalsFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(ApprovalsFile::default());
    }
    serde_json::from_str::<ApprovalsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de aprovações inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_approvals_file(app: &AppHandle, store: &ApprovalsFile) -> Result<(), String> {
    let file_path = ensure_approvals_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar as aprovações: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

fn validate_risk(risk: &str) -> Result<(), String> {
    if !VALID_RISKS.contains(&risk) {
        return Err(format!(
            "Risco inválido: '{risk}'. Permitidos: {}.",
            VALID_RISKS.join(", ")
        ));
    }
    Ok(())
}

fn validate_inputs(payload: &CreateApprovalPayload) -> Result<(), String> {
    let action = payload.action.trim();
    if action.is_empty() {
        return Err("A ação da aprovação não pode estar vazia.".to_string());
    }
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("O título da aprovação não pode estar vazio.".to_string());
    }
    let description = payload.description.trim();
    if description.is_empty() {
        return Err("A descrição da aprovação não pode estar vazia.".to_string());
    }
    validate_risk(&payload.risk)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/// Carrega o arquivo de aprovações no startup do Tauri. Falhas
/// de I/O são logadas e descartadas.
pub fn load_approvals_on_startup(app: &AppHandle) {
    match read_approvals_file(app) {
        Ok(store) => {
            let count = store.approvals.len();
            if let Some(state) = app.try_state::<ApprovalsState>() {
                if let Ok(mut approvals) = state.approvals.lock() {
                    *approvals = store.approvals;
                }
                eprintln!("[fluxora approvals] carregadas {count} aprovação(ões)");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora approvals] falha ao carregar approvals.json: {error}. Iniciando vazio."
            );
        }
    }
}

fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ApprovalsState>();
    let approvals = state
        .approvals
        .lock()
        .map_err(|_| "Lock de aprovações poisoned.".to_string())?
        .clone();
    let store = ApprovalsFile {
        version: 1,
        approvals,
    };
    write_approvals_file(app, &store)
}

// ---------------------------------------------------------------------------
// Mutações de estado
// ---------------------------------------------------------------------------

fn find_approval(state: &ApprovalsState, id: &str) -> Option<ExecutionApprovalRecord> {
    state
        .approvals
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|a| a.id == id).cloned())
}

/// HOTFIX UI E2E — Lista aprovações vinculadas a uma missão
/// (mais recentes primeiro). Usado pelo
/// `missions_get_detail` para alimentar a aba "Aprovação"
/// da `ExecutionDetailPage` a partir de uma única fonte de
/// verdade, em vez de a UI ter que listar todas as aprovações
/// e filtrar no cliente.
pub fn find_approvals_by_mission(
    app: &AppHandle,
    mission_id: &str,
) -> Vec<ExecutionApprovalRecord> {
    let state = app.state::<ApprovalsState>();
    let guard = match state.approvals.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<ExecutionApprovalRecord> = guard
        .iter()
        .filter(|a| a.mission_id.as_deref() == Some(mission_id))
        .cloned()
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

fn update_approval<F>(
    state: &ApprovalsState,
    id: &str,
    mutator: F,
) -> Option<ExecutionApprovalRecord>
where
    F: FnOnce(&mut ExecutionApprovalRecord),
{
    let mut guard = state.approvals.lock().ok()?;
    let approval = guard.iter_mut().find(|a| a.id == id)?;
    mutator(approval);
    approval.updated_at = now_iso();
    Some(approval.clone())
}

// ---------------------------------------------------------------------------
// Emissão de eventos `approval/*`
// ---------------------------------------------------------------------------

fn emit_approval_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    approval: &ExecutionApprovalRecord,
    message: &str,
    extra: Option<serde_json::Value>,
) {
    let mut payload = serde_json::json!({
        "approvalId": &approval.id,
        "action": &approval.action,
        "risk": &approval.risk,
        "status": &approval.status,
        "projectId": &approval.project_id,
        "missionId": &approval.mission_id,
    });
    if let Some(extra) = extra {
        if let Some(obj) = payload.as_object_mut() {
            if let Some(extra_obj) = extra.as_object() {
                for (k, v) in extra_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let event = events::build_event(
        event_type,
        "system",
        level,
        Some(message.to_string()),
        approval.project_id.clone(),
        approval.mission_id.clone(),
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Health-check.
pub fn approvals_ping() -> String {
    now_iso()
}

/// Cria uma nova `ExecutionApproval` pendente e emite o evento
/// `approval/created`.
pub fn approvals_create(
    app: AppHandle,
    payload: CreateApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    validate_inputs(&payload)?;
    let now = now_iso();
    let approval = ExecutionApprovalRecord {
        id: generate_approval_id(),
        project_id: payload.project_id.clone(),
        mission_id: payload.mission_id.clone(),
        action: payload.action.trim().to_string(),
        title: payload.title.trim().to_string(),
        description: payload.description.trim().to_string(),
        risk: payload.risk.trim().to_lowercase(),
        status: STATUS_PENDING.to_string(),
        created_at: now.clone(),
        updated_at: now,
        resolved_at: None,
        requested_by: payload.requested_by.clone(),
        payload: payload.payload.clone(),
    };
    let state = app.state::<ApprovalsState>();
    {
        let mut guard = state
            .approvals
            .lock()
            .map_err(|_| "Lock de aprovações poisoned.".to_string())?;
        guard.push(approval.clone());
    }
    persist(&app)?;
    emit_approval_event(
        &app,
        "approval/created",
        "info",
        &approval,
        &format!("Aprovação criada: {}", approval.title),
        None,
    );
    Ok(approval)
}

/// Lista todas as aprovações (mais recentes primeiro).
pub fn approvals_list(app: AppHandle) -> Result<Vec<ExecutionApprovalRecord>, String> {
    let state = app.state::<ApprovalsState>();
    let guard = state
        .approvals
        .lock()
        .map_err(|_| "Lock de aprovações poisoned.".to_string())?;
    let mut out = guard.clone();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Retorna uma aprovação por id.
pub fn approvals_get(
    app: AppHandle,
    id: String,
) -> Result<Option<ExecutionApprovalRecord>, String> {
    let state = app.state::<ApprovalsState>();
    Ok(find_approval(&state, &id))
}

/// Lista aprovações pendentes que ainda podem ser resolvidas
/// (exclui `cancelled` e `expired`).
pub fn approvals_list_actionable(
    app: AppHandle,
) -> Result<Vec<ExecutionApprovalRecord>, String> {
    let state = app.state::<ApprovalsState>();
    let guard = state
        .approvals
        .lock()
        .map_err(|_| "Lock de aprovações poisoned.".to_string())?;
    let mut out: Vec<ExecutionApprovalRecord> = guard
        .iter()
        .filter(|a| a.status == STATUS_PENDING)
        .cloned()
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Aprova uma aprovação pendente. Não permite aprovar uma
/// aprovação já resolvida (a não ser `pending`).
///
/// **PR 010 — Integração com Patch Engine:** se a aprovação
/// for de `apply-patch` e existir uma `PatchProposal`
/// vinculada em status `pending_approval`, chama
/// `patches::patches_apply` automaticamente após marcar a
/// aprovação como `approved`. O resultado da aplicação (sucesso
/// ou falha) é comunicado via eventos `patch/*` no barramento.
pub fn approvals_approve(
    app: AppHandle,
    id: String,
) -> Result<ExecutionApprovalRecord, String> {
    let state = app.state::<ApprovalsState>();
    let current = match find_approval(&state, &id) {
        Some(a) => a,
        None => return Err(format!("Aprovação {id} não encontrada.")),
    };
    if current.status != STATUS_PENDING {
        return Err(format!(
            "Aprovação {id} não está pendente (status atual: '{}').",
            current.status
        ));
    }
    let now = now_iso();
    let updated = update_approval(&state, &id, |a| {
        a.status = STATUS_APPROVED.to_string();
        a.resolved_at = Some(now.clone());
    })
    .ok_or_else(|| format!("Aprovação {id} não encontrada."))?;
    persist(&app)?;
    emit_approval_event(
        &app,
        "approval/approved",
        "info",
        &updated,
        &format!("Aprovação concedida: {}", updated.title),
        None,
    );
    // PR 010 — Integração com Patch Engine. Aprovar uma
    // aprovação de `apply-patch` dispara a aplicação da
    // proposta vinculada (se houver e se a política permitir).
    if updated.action == "apply-patch" {
        // Tenta localizar a PatchProposal vinculada pelo
        // `proposalId` salvo no payload da aprovação.
        let linked_proposal_id: Option<String> = updated
            .payload
            .as_ref()
            .and_then(|p| p.get("proposalId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        // HOTFIX UI E2E — Log seguro do approval + intenção de
        // apply. Não loga conteúdo.
        eprintln!(
            "[Fluxora E2E Disk] approval_approved action={} approvalId={} approvalStatus={} linkedProposalId={} missionId={} projectId={}",
            updated.action,
            updated.id,
            updated.status,
            linked_proposal_id.clone().unwrap_or_else(|| "none".to_string()),
            updated.mission_id.clone().unwrap_or_else(|| "none".to_string()),
            updated.project_id.clone().unwrap_or_else(|| "none".to_string())
        );
        if let Some(proposal_id) = linked_proposal_id {
            // HOTFIX UI E2E — Log do apply chamado a partir da
            // aprovação.
            eprintln!(
                "[Fluxora E2E Disk] apply_called_by_approval proposalId={} approvalId={}",
                proposal_id,
                updated.id
            );
            match crate::patches::patches_apply(
                app.clone(),
                proposal_id.clone(),
                Some(updated.id.clone()),
            ) {
                Ok(_proposal) => {
                    eprintln!(
                        "[fluxora approvals] patches_apply disparado a partir de approval/approved (proposal={proposal_id}, approval={id})"
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[fluxora approvals] patches_apply falhou após approval/approved (proposal={proposal_id}): {error}"
                    );
                    // A aprovação continua como `approved`; o
                    // erro é registrado nos eventos `patch/*`.
                }
            }
        }
    } else if updated.action == "commit" {
        let payload_obj = updated.payload.as_ref();
        let project_id = payload_obj.and_then(|p| p.get("projectId")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let mission_id = payload_obj.and_then(|p| p.get("missionId")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let patch_proposal_id = payload_obj.and_then(|p| p.get("patchProposalId")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let create_branch = payload_obj.and_then(|p| p.get("createBranch")).and_then(|v| v.as_bool());
        let branch_name = payload_obj.and_then(|p| p.get("branchName")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let message = payload_obj.and_then(|p| p.get("message")).and_then(|v| v.as_str()).map(|s| s.to_string());
        let files: Option<Vec<String>> = payload_obj
            .and_then(|p| p.get("files"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|val| val.as_str().map(|s| s.to_string())).collect());

        if let (Some(pid), Some(msg), Some(fls)) = (project_id, message, files) {
            match crate::git::git_commit_patch(
                app.clone(),
                pid,
                mission_id,
                patch_proposal_id,
                create_branch,
                branch_name,
                msg,
                fls,
                Some(updated.id.clone()),
            ) {
                Ok(_) => {
                    eprintln!(
                        "[fluxora approvals] git_commit_patch disparado a partir de approval/approved (approval={id})"
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[fluxora approvals] git_commit_patch falhou após approval/approved: {error}"
                    );
                }
            }
        }
    }
    Ok(updated)
}

/// Rejeita uma aprovação pendente. Aceita nota opcional.
pub fn approvals_reject(
    app: AppHandle,
    payload: RejectApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    let state = app.state::<ApprovalsState>();
    let current = match find_approval(&state, &payload.id) {
        Some(a) => a,
        None => return Err(format!("Aprovação {} não encontrada.", payload.id)),
    };
    if current.status != STATUS_PENDING {
        return Err(format!(
            "Aprovação {} não está pendente (status atual: '{}').",
            payload.id, current.status
        ));
    }
    let now = now_iso();
    let updated = update_approval(&state, &payload.id, |a| {
        a.status = STATUS_REJECTED.to_string();
        a.resolved_at = Some(now.clone());
        if let Some(note) = &payload.note {
            let mut next_payload = a.payload.clone().unwrap_or_else(|| serde_json::json!({}));
            if let Some(obj) = next_payload.as_object_mut() {
                obj.insert("rejectionNote".to_string(), serde_json::Value::String(note.clone()));
            }
            a.payload = Some(next_payload);
        }
    })
    .ok_or_else(|| format!("Aprovação {} não encontrada.", payload.id))?;
    persist(&app)?;
    emit_approval_event(
        &app,
        "approval/rejected",
        "warn",
        &updated,
        &format!("Aprovação rejeitada: {}", updated.title),
        payload
            .note
            .as_ref()
            .map(|n| serde_json::json!({ "rejectionNote": n })),
    );
    Ok(updated)
}

/// Cancela uma aprovação pendente (por exemplo, quando a
/// missão que a originou já foi rejeitada por outro caminho).
pub fn approvals_cancel(
    app: AppHandle,
    payload: CancelApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    let state = app.state::<ApprovalsState>();
    let current = match find_approval(&state, &payload.id) {
        Some(a) => a,
        None => return Err(format!("Aprovação {} não encontrada.", payload.id)),
    };
    if current.status != STATUS_PENDING {
        return Err(format!(
            "Aprovação {} não está pendente (status atual: '{}').",
            payload.id, current.status
        ));
    }
    let now = now_iso();
    let updated = update_approval(&state, &payload.id, |a| {
        a.status = STATUS_CANCELLED.to_string();
        a.resolved_at = Some(now.clone());
        if let Some(reason) = &payload.reason {
            let mut next_payload = a.payload.clone().unwrap_or_else(|| serde_json::json!({}));
            if let Some(obj) = next_payload.as_object_mut() {
                obj.insert("cancelReason".to_string(), serde_json::Value::String(reason.clone()));
            }
            a.payload = Some(next_payload);
        }
    })
    .ok_or_else(|| format!("Aprovação {} não encontrada.", payload.id))?;
    persist(&app)?;
    emit_approval_event(
        &app,
        "approval/cancelled",
        "info",
        &updated,
        &format!("Aprovação cancelada: {}", updated.title),
        payload
            .reason
            .as_ref()
            .map(|r| serde_json::json!({ "cancelReason": r })),
    );
    Ok(updated)
}

// ---------------------------------------------------------------------------
// Helpers auxiliares (reservados para uso futuro / testes)
// ---------------------------------------------------------------------------

/// Limpa todas as aprovações (apenas dev/debug). Não exposto
/// no `FluxoraAPI` (sem comando Tauri).
#[allow(dead_code)]
pub fn clear_all_for_tests(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ApprovalsState>();
    {
        let mut guard = state
            .approvals
            .lock()
            .map_err(|_| "Lock de aprovações poisoned.".to_string())?;
        guard.clear();
    }
    persist(app)
}

// ---------------------------------------------------------------------------
// Testes unitários
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_inputs_rejects_empty_fields() {
        let mut payload = CreateApprovalPayload {
            project_id: None,
            mission_id: None,
            action: "read-files".to_string(),
            title: "ok".to_string(),
            description: "ok".to_string(),
            risk: "low".to_string(),
            requested_by: None,
            payload: None,
        };
        assert!(validate_inputs(&payload).is_ok());
        payload.action = "".to_string();
        assert!(validate_inputs(&payload).is_err());
        payload.action = "read-files".to_string();
        payload.title = "  ".to_string();
        assert!(validate_inputs(&payload).is_err());
        payload.title = "ok".to_string();
        payload.risk = "extreme".to_string();
        assert!(validate_inputs(&payload).is_err());
    }

    #[test]
    fn validate_risk_accepts_only_known_values() {
        assert!(validate_risk("low").is_ok());
        assert!(validate_risk("medium").is_ok());
        assert!(validate_risk("high").is_ok());
        assert!(validate_risk("extreme").is_err());
    }

    #[test]
    fn status_constants_include_all_values() {
        for status in [
            STATUS_PENDING,
            STATUS_APPROVED,
            STATUS_REJECTED,
            STATUS_CANCELLED,
        ] {
            assert!(matches!(status, "pending" | "approved" | "rejected" | "cancelled"));
        }
    }
}
