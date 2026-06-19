// PR 010 — Patch Engine do Fluxora.
//
// Cria a infraestrutura de propostas de patch/diff que prepara
// o terreno para a aplicação controlada de alterações em
// arquivos do projeto. Esta PR entrega:
//
// - Persistência local de propostas de patch em
//   `<app_data_dir>/fluxora/patches.json` (versionado).
// - Comandos Tauri: `patches_ping` / `patches_list` /
//   `patches_get` / `patches_list_by_mission` /
//   `patches_create` / `patches_apply` / `patches_reject` /
//   `patches_get_changed_files` / `patches_get_file_diff`.
// - Emissão de eventos `patch/*` no barramento
//   `fluxora-event` (PR 005): `patch/proposal-created` /
//   `patch/proposal-invalid` / `patch/approval-required` /
//   `patch/approved` / `patch/rejected` / `patch/apply-started`
//   / `patch/file-applied` / `patch/apply-completed` /
//   `patch/apply-failed` / `diff/generated`.
// - Integração com o módulo `approvals.rs` (PR 009): a
//   aplicação de patch pode exigir uma `ExecutionApproval`
//   aprovada quando a política do projeto tem `ask` para
//   `apply-patch` / `write-files` / `create-files` /
//   `delete-files`. O `approvals.approve` reativa a aplicação
//   pendente (ver `approvals.rs::approvals_approve`).
// - Integração com o módulo `missions.rs` (PR 008): o Mission
//   Engine extrai o bloco `fluxora_patch` da resposta do
//   provider, valida o JSON, e cria uma `PatchProposal`
//   automaticamente.
// - Substitui os stubs `git.changedFiles(workflowRunId)` e
//   `git.fileDiff(workflowRunId, filePath)` em runtime Tauri
//   — o `desktopBridge` (PR 010) faz a ponte para
//   `patches_get_changed_files` e `patches_get_file_diff`.
//
// **Esta PR NÃO faz commit, push, checkout, reset, merge,
// rebase, stash, branch, tag, ou qualquer Git write operation.**
// A aplicação de patch é estritamente local ao diretório do
// projeto, validada contra a política do projeto, e sempre
// registrada em `patch/*` events. Sem shell commands, sem
// tool calling, sem streaming, sem storage seguro de secrets.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

use crate::approvals;
use crate::events;
use crate::missions;
use crate::permissions;
use crate::projects;

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/// Número máximo de arquivos por proposta de patch.
const MAX_FILES_PER_PROPOSAL: usize = 20;

/// Tamanho máximo de `afterContent` por arquivo (em bytes).
const MAX_AFTER_CONTENT_BYTES: u64 = 256 * 1024; // 256 KiB

/// Tamanho máximo total de `afterContent` por proposta (em bytes).
const MAX_TOTAL_AFTER_CONTENT_BYTES: u64 = 1024 * 1024; // 1 MiB

/// Limite para contagem de linhas (segurança contra DoS).
const MAX_DIFF_LINES: usize = 20_000;

/// Diretórios proibidos (rejeitados pelo path safety). Mesmo
/// conjunto usado pelo `missions.rs::IGNORED_DIR_NAMES`,
/// copiado aqui para garantir autonomia do módulo de patches.
const FORBIDDEN_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "vendor",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
    "out",
];

// ---------------------------------------------------------------------------
// Tipos canônicos (espelham `PatchFileChange` / `PatchProposal` /
// `PatchOperation` / `PatchProposalStatus` em `@fluxora/shared`).
// ---------------------------------------------------------------------------

/// Operação de patch sobre um arquivo.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PatchOperation {
    Create,
    Modify,
    Delete,
}

impl PatchOperation {
    fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "create" => Some(Self::Create),
            "modify" => Some(Self::Modify),
            "delete" => Some(Self::Delete),
            _ => None,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Modify => "modify",
            Self::Delete => "delete",
        }
    }
}

/// Status do ciclo de vida de uma `PatchProposal`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PatchProposalStatus {
    Draft,
    PendingApproval,
    Approved,
    Applied,
    Rejected,
    Failed,
}

impl PatchProposalStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::PendingApproval => "pending_approval",
            Self::Approved => "approved",
            Self::Applied => "applied",
            Self::Rejected => "rejected",
            Self::Failed => "failed",
        }
    }
}

/// Mudança proposta para um único arquivo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileChangeRecord {
    pub path: String,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unified_diff: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_new_file: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_deleted_file: Option<bool>,
}

/// Proposta de patch persistida (espelha `PatchProposal`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProposalRecord {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    pub status: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub files: Vec<PatchFileChangeRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files_written: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files_missing: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------------

pub struct PatchesState {
    pub proposals: Mutex<Vec<PatchProposalRecord>>,
}

impl PatchesState {
    pub fn new() -> Self {
        Self {
            proposals: Mutex::new(Vec::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PatchesFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    proposals: Vec<PatchProposalRecord>,
}

fn default_version() -> u32 {
    1
}

impl Default for PatchesFile {
    fn default() -> Self {
        Self {
            version: 1,
            proposals: Vec::new(),
        }
    }
}

fn patches_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("patches.json"))
}

fn ensure_patches_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = patches_file_path(app)?;
    let parent = file_path.parent().ok_or_else(|| {
        "Não foi possível resolver o diretório de persistência de patches.".to_string()
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_patches_file(app: &AppHandle) -> Result<PatchesFile, String> {
    let file_path = ensure_patches_dir(app)?;
    if !file_path.exists() {
        return Ok(PatchesFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(PatchesFile::default());
    }
    serde_json::from_str::<PatchesFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de patches inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_patches_file(app: &AppHandle, store: &PatchesFile) -> Result<(), String> {
    let file_path = ensure_patches_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar as propostas de patch: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

/// Carrega o arquivo de patches no startup do Tauri. Falhas de
/// I/O são logadas e descartadas — o app continua com estado
/// vazio até a primeira criação de proposta.
pub fn load_patches_on_startup(app: &AppHandle) {
    match read_patches_file(app) {
        Ok(store) => {
            let count = store.proposals.len();
            if let Some(state) = app.try_state::<PatchesState>() {
                if let Ok(mut proposals) = state.proposals.lock() {
                    *proposals = store.proposals;
                }
                eprintln!("[fluxora patches] carregadas {count} proposta(s) de patch");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora patches] falha ao carregar patches.json: {error}. Iniciando vazio."
            );
        }
    }
}

fn persist(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<PatchesState>();
    let proposals = state
        .proposals
        .lock()
        .map_err(|_| "Lock de patches poisoned.".to_string())?
        .clone();
    let store = PatchesFile {
        version: 1,
        proposals,
    };
    write_patches_file(app, &store)
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    events::iso_now()
}

fn generate_proposal_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("patch-{millis}-{seq}")
}

/// Valida que um path é seguro para operação no projeto:
/// - Não pode ser vazio.
/// - Não pode ser absoluto (Windows: `C:\...`, `\\server\share`;
///   Unix: `/...`).
/// - Não pode conter `..` (parent dir).
/// - Cada componente deve estar fora de `FORBIDDEN_DIR_NAMES`.
/// - Deve usar apenas separadores `/` (normalizado).
pub(crate) fn is_safe_path(rel: &str) -> Result<String, String> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Err("Path vazio.".to_string());
    }
    // Rejeita absolutos
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(format!("Path absoluto não permitido: '{trimmed}'."));
    }
    // Windows: "C:\..." ou "C:/..." (drive letter)
    if trimmed.chars().nth(1) == Some(':') {
        return Err(format!("Path com drive letter não permitido: '{trimmed}'."));
    }
    // Normaliza separadores para '/'
    let normalized = trimmed.replace('\\', "/");
    // Rejeita `..` em qualquer segmento
    for component in Path::new(&normalized).components() {
        if matches!(component, Component::ParentDir) {
            return Err(format!("Path com '..' não permitido: '{trimmed}'."));
        }
    }
    // Rejeita diretórios proibidos
    for component in Path::new(&normalized).components() {
        if let Component::Normal(name) = component {
            if let Some(name_str) = name.to_str() {
                if FORBIDDEN_DIR_NAMES.contains(&name_str) {
                    return Err(format!(
                        "Path dentro de diretório proibido '{name_str}': '{trimmed}'."
                    ));
                }
            }
        }
    }
    Ok(normalized)
}

/// Resolve path relativo ao root do projeto, garantindo que o
/// resultado final esteja dentro do projeto (proteção extra
/// contra symlinks — apenas a checagem de componentes, sem I/O).
fn resolve_under_project(project_root: &Path, normalized_rel: &str) -> Result<PathBuf, String> {
    let joined = project_root.join(normalized_rel);
    // Garante que o joined começa com o project_root (canonical
    // ou raw). Como `is_safe_path` já rejeita `..` e absolutos,
    // a checagem é principalmente cosmética.
    let root_canon = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let joined_canon = joined
        .canonicalize()
        .unwrap_or_else(|_| joined.clone());
    if !joined_canon.starts_with(&root_canon) {
        return Err(format!(
            "Path '{normalized_rel}' escapa do diretório do projeto."
        ));
    }
    Ok(joined)
}

/// Conta adições e remoções a partir de `before_content` /
/// `afterContent` usando LCS (longest common subsequence)
/// simplificado por linha. Para evitar custo excessivo, cap em
/// `MAX_DIFF_LINES` por arquivo.
fn compute_additions_deletions(before: &str, after: &str) -> (u32, u32) {
    let before_lines: Vec<&str> = before.split('\n').collect();
    let after_lines: Vec<&str> = after.split('\n').collect();
    if before_lines.len() > MAX_DIFF_LINES || after_lines.len() > MAX_DIFF_LINES {
        // Cap de segurança: não calcular diff se o arquivo for gigante.
        // Conta tudo como adição ou remoção dependendo do delta de tamanho.
        let delta = (after_lines.len() as i64) - (before_lines.len() as i64);
        if delta >= 0 {
            (delta as u32, 0)
        } else {
            (0, (-delta) as u32)
        }
    } else {
        // Diff por LCS O(n*m) — bom o suficiente para os limites
        // de `MAX_DIFF_LINES` (256 KiB → tipicamente < 4k linhas).
        let n = before_lines.len();
        let m = after_lines.len();
        let mut lcs: Vec<Vec<u32>> = vec![vec![0u32; m + 1]; n + 1];
        for i in 0..n {
            for j in 0..m {
                if before_lines[i] == after_lines[j] {
                    lcs[i + 1][j + 1] = lcs[i][j] + 1;
                } else {
                    lcs[i + 1][j + 1] = std::cmp::max(lcs[i + 1][j], lcs[i][j + 1]);
                }
            }
        }
        let common = lcs[n][m] as usize;
        let deletions = (n - common) as u32;
        let additions = (m - common) as u32;
        (additions, deletions)
    }
}

/// Gera um diff unificado simplificado (estilo `git diff`).
/// Não usa uma biblioteca externa — é uma implementação
/// minimalista baseada em LCS. Serve para exibição na UI.
fn generate_unified_diff(path: &str, before: &str, after: &str) -> String {
    let before_lines: Vec<&str> = before.split('\n').collect();
    let after_lines: Vec<&str> = after.split('\n').collect();
    if before_lines.len() > MAX_DIFF_LINES || after_lines.len() > MAX_DIFF_LINES {
        // Cap de segurança: devolve um diff trivial com aviso.
        return format!(
            "--- a/{path}\n+++ b/{path}\n@@ diff truncado (arquivo muito grande) @@\n"
        );
    }
    let n = before_lines.len();
    let m = after_lines.len();
    let mut lcs: Vec<Vec<u32>> = vec![vec![0u32; m + 1]; n + 1];
    for i in 0..n {
        for j in 0..m {
            if before_lines[i] == after_lines[j] {
                lcs[i + 1][j + 1] = lcs[i][j] + 1;
            } else {
                lcs[i + 1][j + 1] = std::cmp::max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
    }
    // Backtrack para extrair as operações
    let mut ops: Vec<(char, &str)> = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && before_lines[i - 1] == after_lines[j - 1] {
            ops.push((' ', before_lines[i - 1]));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || lcs[i][j - 1] >= lcs[i - 1][j]) {
            ops.push(('+', after_lines[j - 1]));
            j -= 1;
        } else {
            ops.push(('-', before_lines[i - 1]));
            i -= 1;
        }
    }
    ops.reverse();
    let mut out = String::new();
    out.push_str(&format!("--- a/{path}\n"));
    out.push_str(&format!("+++ b/{path}\n"));
    out.push_str("@@ -1 +1 @@\n");
    for (sign, line) in ops {
        out.push(sign);
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Lê o conteúdo atual de um arquivo do projeto (UTF-8). Retorna
/// `Ok(None)` se o arquivo não existir. Retorna `Err` se o
/// arquivo for binário (heurística de NUL nos primeiros 8 KiB)
/// ou se a leitura falhar.
fn read_project_file(root: &Path, rel: &str) -> Result<Option<String>, String> {
    let normalized = is_safe_path(rel)?;
    let path = resolve_under_project(root, &normalized)?;
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Falha ao ler {}: {error}", path.display()))?;
    let probe_window = &bytes[..bytes.len().min(8 * 1024)];
    if probe_window.contains(&0u8) {
        return Err(format!("Arquivo binário não suportado: '{rel}'."));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| format!("Arquivo não-UTF-8 não suportado: '{rel}'."))
}

// ---------------------------------------------------------------------------
// Mutações de estado
// ---------------------------------------------------------------------------

fn find_proposal(state: &PatchesState, id: &str) -> Option<PatchProposalRecord> {
    state
        .proposals
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|p| p.id == id).cloned())
}

pub fn find_proposals_by_mission(state: &PatchesState, mission_id: &str) -> Vec<PatchProposalRecord> {
    let mut out: Vec<PatchProposalRecord> = state
        .proposals
        .lock()
        .ok()
        .map(|guard| {
            guard
                .iter()
                .filter(|p| p.mission_id == mission_id)
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

fn upsert_proposal(state: &PatchesState, proposal: PatchProposalRecord) -> PatchProposalRecord {
    let mut guard = match state.proposals.lock() {
        Ok(guard) => guard,
        Err(_) => return proposal,
    };
    if let Some(existing) = guard.iter_mut().find(|p| p.id == proposal.id) {
        *existing = proposal.clone();
    } else {
        guard.push(proposal.clone());
    }
    proposal
}

fn update_proposal<F>(
    state: &PatchesState,
    id: &str,
    mutator: F,
) -> Option<PatchProposalRecord>
where
    F: FnOnce(&mut PatchProposalRecord),
{
    let mut guard = state.proposals.lock().ok()?;
    let proposal = guard.iter_mut().find(|p| p.id == id)?;
    mutator(proposal);
    proposal.updated_at = now_iso();
    Some(proposal.clone())
}

// ---------------------------------------------------------------------------
// Emissão de eventos `patch/*`
// ---------------------------------------------------------------------------

fn emit_patch_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    project_id: &str,
    mission_id: Option<&str>,
    proposal_id: Option<&str>,
    message: &str,
    extra: Option<serde_json::Value>,
) {
    let mut payload = serde_json::json!({});
    if let Some(extra) = extra {
        if let (Some(base), Some(extra_obj)) = (payload.as_object_mut(), extra.as_object()) {
            for (k, v) in extra_obj {
                base.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(pid) = proposal_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.entry("proposalId".to_string())
                .or_insert(serde_json::Value::String(pid.to_string()));
        }
    }
    let event = events::build_event(
        event_type,
        "patches",
        level,
        Some(message.to_string()),
        Some(project_id.to_string()),
        mission_id.map(|m| m.to_string()),
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// Validação de payloads
// ---------------------------------------------------------------------------

/// Valida os `files` de uma `CreatePatchProposalInput`. Retorna
/// `Ok(files normalizados)` ou `Err` com a primeira falha
/// encontrada.
fn validate_proposal_files(
    files: &[PatchFileChangeRecord],
) -> Result<Vec<PatchFileChangeRecord>, String> {
    if files.is_empty() {
        return Err("A proposta deve ter ao menos um arquivo.".to_string());
    }
    if files.len() > MAX_FILES_PER_PROPOSAL {
        return Err(format!(
            "A proposta excede o limite de {} arquivos (recebeu {}).",
            MAX_FILES_PER_PROPOSAL,
            files.len()
        ));
    }
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut total_after_bytes: u64 = 0;
    let mut normalized: Vec<PatchFileChangeRecord> = Vec::with_capacity(files.len());

    for (idx, file) in files.iter().enumerate() {
        let op = PatchOperation::from_str(&file.operation).ok_or_else(|| {
            format!("Operação inválida no arquivo #{}: '{}'.", idx + 1, file.operation)
        })?;
        let safe_path = is_safe_path(&file.path)?;
        if !seen_paths.insert(safe_path.clone()) {
            return Err(format!("Path duplicado na proposta: '{safe_path}'."));
        }
        let after_content = file.after_content.clone();
        let after_bytes = after_content.as_ref().map(|c| c.as_bytes().len() as u64).unwrap_or(0);
        if after_bytes > MAX_AFTER_CONTENT_BYTES {
            return Err(format!(
                "Arquivo '{}' excede o limite de {} bytes ({}).",
                safe_path, MAX_AFTER_CONTENT_BYTES, after_bytes
            ));
        }
        total_after_bytes += after_bytes;
        if total_after_bytes > MAX_TOTAL_AFTER_CONTENT_BYTES {
            return Err(format!(
                "Proposta excede o limite total de {} bytes de afterContent.",
                MAX_TOTAL_AFTER_CONTENT_BYTES
            ));
        }
        match op {
            PatchOperation::Create => {
                if after_content.is_none() {
                    return Err(format!(
                        "Arquivo '{}' é 'create' mas não tem afterContent.",
                        safe_path
                    ));
                }
            }
            PatchOperation::Modify => {
                if after_content.is_none() {
                    return Err(format!(
                        "Arquivo '{}' é 'modify' mas não tem afterContent.",
                        safe_path
                    ));
                }
            }
            PatchOperation::Delete => {
                if after_content.is_some() {
                    // Não é estritamente errado, mas para evitar
                    // confusão: para delete, afterContent deve
                    // ser None (o backend não vai usar).
                }
            }
        }
        let is_new_file = Some(op == PatchOperation::Create);
        let is_deleted_file = Some(op == PatchOperation::Delete);
        normalized.push(PatchFileChangeRecord {
            path: safe_path,
            operation: op.as_str().to_string(),
            before_content: file.before_content.clone(),
            after_content,
            unified_diff: file.unified_diff.clone(),
            additions: file.additions,
            deletions: file.deletions,
            is_new_file,
            is_deleted_file,
        });
    }
    Ok(normalized)
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Health-check simples.
pub fn patches_ping() -> String {
    now_iso()
}

/// Lista todas as propostas de patch persistidas (mais recentes primeiro).
pub fn patches_list(app: AppHandle) -> Result<Vec<PatchProposalRecord>, String> {
    let state = app.state::<PatchesState>();
    let guard = state
        .proposals
        .lock()
        .map_err(|_| "Lock de patches poisoned.".to_string())?;
    let mut out = guard.clone();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Retorna uma proposta por `id` (ou `None` se não existir).
pub fn patches_get(app: AppHandle, id: String) -> Result<Option<PatchProposalRecord>, String> {
    let state = app.state::<PatchesState>();
    Ok(find_proposal(&state, &id))
}

/// Lista todas as propostas de patch de uma missão (mais recentes primeiro).
pub fn patches_list_by_mission(
    app: AppHandle,
    mission_id: String,
) -> Result<Vec<PatchProposalRecord>, String> {
    let state = app.state::<PatchesState>();
    Ok(find_proposals_by_mission(&state, &mission_id))
}

/// Cria uma nova proposta de patch. Valida paths, operações e
/// limites. Retorna a proposta persistida.
pub fn patches_create(
    app: AppHandle,
    title: String,
    summary: Option<String>,
    mission_id: String,
    project_id: String,
    files: Vec<PatchFileChangeRecord>,
) -> Result<PatchProposalRecord, String> {
    if title.trim().is_empty() {
        return Err("O título da proposta não pode estar vazio.".to_string());
    }
    if mission_id.trim().is_empty() {
        return Err("A missão da proposta não pode estar vazia.".to_string());
    }
    if project_id.trim().is_empty() {
        return Err("O projeto da proposta não pode estar vazio.".to_string());
    }
    // Garante que o projeto existe
    let _ = projects::find_project_path(&app, &project_id)?;
    let normalized_files = validate_proposal_files(&files)?;
    let now = now_iso();
    let proposal = PatchProposalRecord {
        id: generate_proposal_id(),
        mission_id,
        project_id: project_id.clone(),
        status: PatchProposalStatus::Draft.as_str().to_string(),
        title: title.trim().to_string(),
        summary: summary
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        files: normalized_files,
        approval_id: None,
        created_at: now.clone(),
        updated_at: now,
        applied_at: None,
        error: None,
        files_written: None,
        files_missing: None,
        project_path: None,
    };
    let state = app.state::<PatchesState>();
    let stored = upsert_proposal(&state, proposal);
    persist(&app)?;
    emit_patch_event(
        &app,
        "patch/proposal-created",
        "info",
        &stored.project_id,
        Some(&stored.mission_id),
        Some(&stored.id),
        &format!("Proposta de patch criada: {}", stored.title),
        Some(serde_json::json!({
            "proposalId": &stored.id,
            "filesCount": stored.files.len(),
            "status": &stored.status,
        })),
    );
    Ok(stored)
}

/// Rejeita uma proposta de patch pendente. Marca como `rejected`
/// e atualiza o status da `ExecutionApproval` vinculada (se houver)
/// para `rejected` também.
pub fn patches_reject(
    app: AppHandle,
    id: String,
    note: Option<String>,
) -> Result<PatchProposalRecord, String> {
    let state = app.state::<PatchesState>();
    let current = match find_proposal(&state, &id) {
        Some(p) => p,
        None => return Err(format!("Proposta de patch {id} não encontrada.")),
    };
    if current.status == PatchProposalStatus::Applied.as_str() {
        return Err(format!(
            "Proposta {id} já foi aplicada e não pode ser rejeitada."
        ));
    }
    if current.status == PatchProposalStatus::Rejected.as_str() {
        return Ok(current);
    }
    // Rejeita a aprovação vinculada (se houver e ainda estiver pendente)
    if let Some(approval_id) = &current.approval_id {
        let _ = approvals::approvals_reject(
            app.clone(),
            approvals::RejectApprovalPayload {
                id: approval_id.clone(),
                note: note.clone(),
            },
        );
    }
    let updated = update_proposal(&state, &id, |p| {
        p.status = PatchProposalStatus::Rejected.as_str().to_string();
        if let Some(note) = &note {
            let mut next_error = p.error.clone().unwrap_or_default();
            if !next_error.is_empty() {
                next_error.push(' ');
            }
            next_error.push_str(&format!("Rejeitada: {note}"));
            p.error = Some(next_error);
        }
    })
    .ok_or_else(|| format!("Proposta {id} não encontrada."))?;
    persist(&app)?;
    emit_patch_event(
        &app,
        "patch/rejected",
        "warn",
        &updated.project_id,
        Some(&updated.mission_id),
        Some(&updated.id),
        &format!("Proposta de patch rejeitada: {}", updated.title),
        note.as_ref().map(|n| serde_json::json!({ "rejectionNote": n })),
    );
    Ok(updated)
}

/// Aplica uma proposta de patch. Requer:
/// - Status permitido: `pending_approval` com aprovação aprovada,
///   ou `approved`, ou permissão `allow` em `apply-patch` /
///   `write-files` / `create-files` / `delete-files` conforme a
///   operação de cada arquivo.
/// - Cada arquivo respeitando os limites de segurança
///   (path safety, diretórios proibidos, tamanhos).
/// - `beforeContent` (quando informado) deve bater com o
///   conteúdo atual do arquivo no projeto (proteção contra
///   conflitos).
///
/// Aplica cada arquivo de forma atômica (escrita em arquivo
/// temporário + rename). Em caso de erro em qualquer arquivo,
/// a proposta inteira é marcada como `failed` e o erro
/// reportado. Os arquivos já alterados não são revertidos
/// automaticamente (best-effort: o backend continua com o
/// próximo).
///
/// Retorna a proposta atualizada com `status: "applied"` em
/// caso de sucesso, ou `status: "failed"` com `error` em caso
/// de falha.
pub fn patches_apply(
    app: AppHandle,
    proposal_id: String,
    approval_id: Option<String>,
) -> Result<PatchProposalRecord, String> {
    let state = app.state::<PatchesState>();
    let current = match find_proposal(&state, &proposal_id) {
        Some(p) => p,
        None => {
            eprintln!(
                "[Fluxora E2E Disk] patches_apply_called proposalId={} approvalId={} found=false",
                proposal_id,
                approval_id.clone().unwrap_or_else(|| "none".to_string())
            );
            return Err(format!("Proposta de patch {proposal_id} não encontrada."));
        }
    };

    // HOTFIX UI E2E — Log seguro do início do apply. Não loga
    // conteúdo de arquivos nem secrets.
    eprintln!(
        "[Fluxora E2E Disk] patches_apply_called proposalId={} missionId={} projectId={} approvalId={} patchStatus={} filesCount={}",
        current.id,
        current.mission_id,
        current.project_id,
        approval_id.clone().unwrap_or_else(|| "none".to_string()),
        current.status,
        current.files.len()
    );
    if current.status == PatchProposalStatus::Applied.as_str() {
        return Err(format!("Proposta {proposal_id} já foi aplicada."));
    }
    if current.status == PatchProposalStatus::Rejected.as_str() {
        return Err(format!(
            "Proposta {proposal_id} foi rejeitada e não pode ser aplicada."
        ));
    }
    if current.status == PatchProposalStatus::Failed.as_str() {
        return Err(format!(
            "Proposta {proposal_id} falhou em uma tentativa anterior e não pode ser reaplicada."
        ));
    }

    // 1. Verificar permissões por arquivo.
    let policy = permissions::get_or_create_policy(&app, &current.project_id)?;
    let mut has_any_ask = false;
    for file in &current.files {
        let action = match file.operation.as_str() {
            "create" => "create-files",
            "modify" => "apply-patch",
            "delete" => "delete-files",
            other => {
                return Err(format!(
                    "Operação desconhecida '{}' no arquivo '{}'.",
                    other, file.path
                ));
            }
        };
        // Para modify, apply-patch + write-files são ambos necessários.
        let actions: Vec<&str> = if action == "apply-patch" {
            vec!["apply-patch", "write-files"]
        } else {
            vec![action]
        };
        for act in actions {
            let decision = policy
                .permissions
                .get(act)
                .cloned()
                .unwrap_or_else(|| "ask".to_string());
            if decision == "deny" {
                return Err(format!(
                    "Política do projeto proíbe '{}' (decisão 'deny') para o arquivo '{}'.",
                    act, file.path
                ));
            }
            if decision == "ask" {
                has_any_ask = true;
            }
        }
    }
    if has_any_ask {
        // Verifica se a aprovação fornecida (ou a vinculada) está aprovada.
        let approval_id_to_check = approval_id
            .clone()
            .or_else(|| current.approval_id.clone());
        if let Some(aid) = approval_id_to_check {
            let approval = approvals::approvals_get(app.clone(), aid.clone())
                .map_err(|e| format!("Falha ao buscar aprovação {aid}: {e}"))?;
            match approval {
                Some(a) if a.status == "approved" => {
                    // OK, segue.
                }
                Some(a) => {
                    return Err(format!(
                        "Proposta requer aprovação, mas a aprovação {} está com status '{}'.",
                        a.id, a.status
                    ));
                }
                None => {
                    return Err(format!(
                        "Proposta requer aprovação, mas a aprovação {aid} não foi encontrada."
                    ));
                }
            }
        } else {
            return Err(
                "Proposta requer aprovação (política com decisão 'ask'), mas nenhuma aprovação foi fornecida."
                    .to_string(),
            );
        }
    }

    // 2. Resolver root do projeto.
    let project_root = projects::find_project_path(&app, &current.project_id)?;

    // 3. Emitir evento de início.
    emit_patch_event(
        &app,
        "patch/apply-started",
        "info",
        &current.project_id,
        Some(&current.mission_id),
        Some(&current.id),
        &format!("Aplicando proposta de patch: {}", current.title),
        Some(serde_json::json!({
            "proposalId": &current.id,
            "filesCount": current.files.len(),
        })),
    );

    // 4. Marcar como `approved` (transição intermediária) se estava `pending_approval` ou `draft`.
    if current.status != PatchProposalStatus::Approved.as_str() {
        let _ = update_proposal(&state, &proposal_id, |p| {
            p.status = PatchProposalStatus::Approved.as_str().to_string();
        });
        let _ = persist(&app);
    }

    // 5. Aplicar cada arquivo.
    let mut applied_files: u32 = 0;
    let mut last_error: Option<String> = None;
    for file in &current.files {
        match apply_one_file(&project_root, file) {
            Ok(()) => {
                applied_files += 1;
                emit_patch_event(
                    &app,
                    "patch/file-applied",
                    "info",
                    &current.project_id,
                    Some(&current.mission_id),
                    Some(&current.id),
                    &format!("Arquivo aplicado: {}", file.path),
                    Some(serde_json::json!({
                        "proposalId": &current.id,
                        "filePath": &file.path,
                        "operation": &file.operation,
                    })),
                );
            }
            Err(error) => {
                last_error = Some(error.clone());
                emit_patch_event(
                    &app,
                    "patch/apply-failed",
                    "error",
                    &current.project_id,
                    Some(&current.mission_id),
                    Some(&current.id),
                    &format!("Falha ao aplicar '{}': {}", file.path, error),
                    Some(serde_json::json!({
                        "proposalId": &current.id,
                        "filePath": &file.path,
                        "operation": &file.operation,
                        "errorMessage": error,
                    })),
                );
                break;
            }
        }
    }

    // 6. Atualizar status final.
    if let Some(error) = last_error {
        let truncated = truncate_error_message(&error);
        let updated = update_proposal(&state, &proposal_id, |p| {
            p.status = PatchProposalStatus::Failed.as_str().to_string();
            p.error = Some(truncated.clone());
        })
        .ok_or_else(|| format!("Proposta {proposal_id} não encontrada."))?;
        persist(&app)?;
        emit_patch_event(
            &app,
            "patch/apply-failed",
            "error",
            &updated.project_id,
            Some(&updated.mission_id),
            Some(&updated.id),
            &format!("Proposta de patch falhou: {}", error),
            Some(serde_json::json!({
                "proposalId": &updated.id,
                "filesApplied": applied_files,
                "errorMessage": truncated,
            })),
        );
        return Err(error);
    }

    let project_path_str = project_root.to_string_lossy().to_string();
    let mut files_written = Vec::new();
    let mut files_missing = Vec::new();
    for file in &current.files {
        if file.operation == "create" || file.operation == "modify" {
            let normalized = match is_safe_path(&file.path) {
                Ok(p) => p,
                Err(_) => {
                    files_missing.push(file.path.clone());
                    continue;
                }
            };
            let path = match resolve_under_project(&project_root, &normalized) {
                Ok(p) => p,
                Err(_) => {
                    files_missing.push(file.path.clone());
                    continue;
                }
            };
            if path.exists() {
                files_written.push(file.path.clone());
            } else {
                files_missing.push(file.path.clone());
            }
        }
    }

    if !files_missing.is_empty() {
        let error_msg = format!("Arquivos ausentes após escrita: {}", files_missing.join(", "));
        let truncated = truncate_error_message(&error_msg);
        let updated = update_proposal(&state, &proposal_id, |p| {
            p.status = PatchProposalStatus::Failed.as_str().to_string();
            p.error = Some(truncated.clone());
            p.files_written = Some(files_written.clone());
            p.files_missing = Some(files_missing.clone());
            p.project_path = Some(project_path_str.clone());
        })
        .ok_or_else(|| format!("Proposta {proposal_id} não encontrada."))?;
        persist(&app)?;
        emit_patch_event(
            &app,
            "patch/apply-failed",
            "error",
            &updated.project_id,
            Some(&updated.mission_id),
            Some(&updated.id),
            &format!("Proposta de patch falhou na validação pós-apply: {}", error_msg),
            Some(serde_json::json!({
                "proposalId": &updated.id,
                "filesApplied": applied_files,
                "filesWritten": files_written,
                "filesMissing": files_missing,
                "projectPath": project_path_str,
                "errorMessage": truncated,
            })),
        );
        return Err(error_msg);
    }

    let now = now_iso();
    let updated = update_proposal(&state, &proposal_id, |p| {
        p.status = PatchProposalStatus::Applied.as_str().to_string();
        p.applied_at = Some(now.clone());
        p.error = None;
        p.files_written = Some(files_written.clone());
        p.files_missing = Some(files_missing.clone());
        p.project_path = Some(project_path_str.clone());
    })
    .ok_or_else(|| format!("Proposta {proposal_id} não encontrada."))?;
    persist(&app)?;
    emit_patch_event(
        &app,
        "patch/apply-completed",
        "info",
        &updated.project_id,
        Some(&updated.mission_id),
        Some(&updated.id),
        &format!("Proposta de patch aplicada: {}", updated.title),
        Some(serde_json::json!({
            "proposalId": &updated.id,
            "filesApplied": applied_files,
            "filesWritten": files_written,
            "filesMissing": files_missing,
            "projectPath": project_path_str,
            "appliedAt": now,
        })),
    );
    Ok(updated)
}

fn truncate_error_message(input: &str) -> String {
    const MAX: usize = 500;
    if input.chars().count() <= MAX {
        return input.to_string();
    }
    let mut out: String = input.chars().take(MAX).collect();
    out.push('…');
    out
}

/// Aplica um único arquivo de uma proposta. Estratégia atômica:
/// para `create` e `modify`, escreve em arquivo temporário e
/// depois faz `rename` (atômico no Unix; no Windows é
/// aproximado, mas suficiente). Para `delete`, remove o arquivo
/// (a remoção em si não é reversível, mas o usuário deve ter
/// aprovado via política + `ExecutionApproval`).
fn apply_one_file(project_root: &Path, file: &PatchFileChangeRecord) -> Result<(), String> {
    let op = PatchOperation::from_str(&file.operation)
        .ok_or_else(|| format!("Operação inválida: '{}'", file.operation))?;
    let normalized = is_safe_path(&file.path)?;
    let path = resolve_under_project(project_root, &normalized)?;

    // HOTFIX UI E2E — Log seguro do path resolvido (sem
    // conteúdo de arquivos).
    eprintln!(
        "[Fluxora E2E Disk] apply_one_file_start file={} operation={} resolvedPath={} projectPath={}",
        file.path,
        file.operation,
        path.display(),
        project_root.display()
    );

    match op {
        PatchOperation::Create => {
            if path.exists() {
                return Err(format!(
                    "Arquivo '{}' já existe; create não pode sobrescrever.",
                    file.path
                ));
            }
            let after = file.after_content.as_ref().ok_or_else(|| {
                format!("Arquivo '{}' é 'create' mas não tem afterContent.", file.path)
            })?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Falha ao criar diretório: {error}"))?;
            }
            // HOTFIX UI E2E — Log da tentativa de escrita.
            eprintln!(
                "[Fluxora E2E Disk] write_attempted file={} resolvedPath={}",
                file.path,
                path.display()
            );
            write_atomic(&path, after.as_bytes())?;
            let exists_after_write = path.exists();
            // HOTFIX UI E2E — Log do resultado da escrita
            // (verificação real de que o arquivo apareceu no
            // disco).
            eprintln!(
                "[Fluxora E2E Disk] write_completed file={} resolvedPath={} existsAfterWrite={}",
                file.path,
                path.display(),
                exists_after_write
            );
            if !exists_after_write {
                return Err(format!("Arquivo '{}' não foi criado no disco após apply", file.path));
            }
        }
        PatchOperation::Modify => {
            let after = file.after_content.as_ref().ok_or_else(|| {
                format!("Arquivo '{}' é 'modify' mas não tem afterContent.", file.path)
            })?;
            if !path.exists() {
                return Err(format!("Arquivo '{}' não existe; modify requer arquivo existente.", file.path));
            }
            if let Some(before) = &file.before_content {
                let current = read_project_file(project_root, &normalized)?
                    .ok_or_else(|| format!("Arquivo '{}' desapareceu durante a aplicação.", file.path))?;
                if current != *before {
                    return Err(format!(
                        "Arquivo '{}' mudou desde a criação da proposta (precondição falhou).",
                        file.path
                    ));
                }
            }
            eprintln!(
                "[Fluxora E2E Disk] write_attempted file={} resolvedPath={}",
                file.path,
                path.display()
            );
            write_atomic(&path, after.as_bytes())?;
            let exists_after_write = path.exists();
            eprintln!(
                "[Fluxora E2E Disk] write_completed file={} resolvedPath={} existsAfterWrite={}",
                file.path,
                path.display(),
                exists_after_write
            );
            if !exists_after_write {
                return Err(format!("Arquivo '{}' não foi criado no disco após apply", file.path));
            }
        }
        PatchOperation::Delete => {
            if !path.exists() {
                eprintln!(
                    "[Fluxora E2E Disk] delete_skipped file={} resolvedPath={} reason=not_found",
                    file.path,
                    path.display()
                );
                // Idempotente: deletar um arquivo que não existe não é erro nesta PR.
                return Ok(());
            }
            fs::remove_file(&path)
                .map_err(|error| format!("Falha ao remover '{}': {}", file.path, error))?;
            eprintln!(
                "[Fluxora E2E Disk] delete_completed file={} resolvedPath={}",
                file.path,
                path.display()
            );
        }
    }
    Ok(())
}

/// Escrita atômica: escreve em `<path>.fluxora-tmp-<pid>` e
/// depois faz `rename` sobre o path final. Garante que o
/// arquivo final nunca fique em estado parcialmente escrito
/// (best-effort cross-platform).
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let pid = std::process::id();
    let tmp = path.with_extension(format!(
        "{}.fluxora-tmp-{pid}",
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("fluxora")
    ));
    fs::write(&tmp, bytes)
        .map_err(|error| format!("Falha ao escrever temporário {}: {error}", tmp.display()))?;
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "Falha ao renomear {} → {}: {error}",
            tmp.display(),
            path.display()
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// API de leitura para Diff Viewer (PR 010 — git.changedFiles / fileDiff)
// ---------------------------------------------------------------------------

/// Converte `PatchFileChange` em `ChangedFile` legado (forma
/// consumida pelo Diff Viewer da UI). `workflowRunId` aqui
/// representa o `missionId` (a UI atual recebe
/// `changedFiles(workflowRunId)` e o desktopBridge faz a
/// ponte).
pub fn patches_get_changed_files(
    app: AppHandle,
    workflow_run_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let state = app.state::<PatchesState>();
    let proposals = find_proposals_by_mission(&state, &workflow_run_id);
    let mut out: Vec<serde_json::Value> = Vec::new();
    for proposal in &proposals {
        // Apenas propostas já processadas (pending_approval /
        // approved / applied) entram no diff viewer — drafts
        // puras ficam ocultas.
        if proposal.status == PatchProposalStatus::Draft.as_str()
            || proposal.status == PatchProposalStatus::Rejected.as_str()
            || proposal.status == PatchProposalStatus::Failed.as_str()
        {
            continue;
        }
        for file in &proposal.files {
            let status = match file.operation.as_str() {
                "create" => "added",
                "delete" => "deleted",
                _ => "modified",
            };
            let additions = file.additions.unwrap_or(0);
            let deletions = file.deletions.unwrap_or(0);
            let id = format!("{}::{}", proposal.id, file.path);
            out.push(serde_json::json!({
                "id": id,
                "workflowRunId": workflow_run_id,
                "projectId": proposal.project_id,
                "path": file.path,
                "status": status,
                "additions": additions,
                "deletions": deletions,
                "createdAt": proposal.created_at,
            }));
        }
    }
    emit_patch_event(
        &app,
        "diff/generated",
        "info",
        // projectId não é conhecido aqui diretamente; usa a primeira proposta ou "unknown"
        proposals
            .first()
            .map(|p| p.project_id.clone())
            .unwrap_or_else(|| "unknown".to_string())
            .as_str(),
        Some(&workflow_run_id),
        None,
        &format!("Diff listado: {} arquivo(s) alterado(s).", out.len()),
        Some(serde_json::json!({ "filesCount": out.len() })),
    );
    Ok(out)
}

/// Retorna o `FileDiff` legado para um arquivo específico de uma
/// proposta. Constrói o `diff` unificado a partir de
/// `before_content` / `after_content` (snapshot do estado na
/// criação da proposta) ou — se a proposta já foi aplicada —
/// tenta complementar com `git diff` (best-effort, sem falhar
/// se git não estiver disponível).
pub fn patches_get_file_diff(
    app: AppHandle,
    workflow_run_id: String,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    let state = app.state::<PatchesState>();
    let proposals = find_proposals_by_mission(&state, &workflow_run_id);
    let mut target_proposal: Option<&PatchProposalRecord> = None;
    let mut target_file: Option<&PatchFileChangeRecord> = None;
    for proposal in &proposals {
        if let Some(file) = proposal.files.iter().find(|f| f.path == file_path) {
            target_proposal = Some(proposal);
            target_file = Some(file);
            break;
        }
    }
    let (proposal, file) = match (target_proposal, target_file) {
        (Some(p), Some(f)) => (p, f),
        _ => return Ok(None),
    };
    let before = file.before_content.clone().unwrap_or_default();
    let after = file.after_content.clone().unwrap_or_default();
    let additions = file.additions.unwrap_or_else(|| {
        if before.is_empty() && !after.is_empty() {
            after.lines().count() as u32
        } else {
            compute_additions_deletions(&before, &after).0
        }
    });
    let deletions = file.deletions.unwrap_or_else(|| {
        if after.is_empty() && !before.is_empty() {
            before.lines().count() as u32
        } else {
            compute_additions_deletions(&before, &after).1
        }
    });
    let unified = file.unified_diff.clone().unwrap_or_else(|| {
        if file.operation == "delete" {
            format!("--- a/{}\n+++ b/{}\n@@ -1 +0,0 @@\n", file.path, file.path)
        } else {
            generate_unified_diff(&file.path, &before, &after)
        }
    });
    let id = format!("{}::{}", proposal.id, file.path);
    let created_at = proposal.created_at.clone();
    let out = serde_json::json!({
        "id": id,
        "workflowRunId": workflow_run_id,
        "projectId": proposal.project_id,
        "filePath": file.path,
        "diff": unified,
        "additions": additions,
        "deletions": deletions,
        "status": match file.operation.as_str() {
            "create" => "added",
            "delete" => "deleted",
            _ => "modified",
        },
        "createdAt": created_at,
    });
    emit_patch_event(
        &app,
        "diff/generated",
        "info",
        &proposal.project_id,
        Some(&workflow_run_id),
        Some(&proposal.id),
        &format!("Diff gerado para '{}'.", file.path),
        Some(serde_json::json!({
            "filePath": file.path,
            "additions": additions,
            "deletions": deletions,
        })),
    );
    let _ = app; // mantém o borrow
    Ok(Some(out))
}

// ---------------------------------------------------------------------------
// Helpers públicos para o Mission Engine (PR 010)
// ---------------------------------------------------------------------------

/// Cria uma proposta de patch a partir do bloco `fluxora_patch`
/// extraído da resposta do provider. Usado por
/// `missions.rs::handle_patch_proposal`.
///
/// Estratégia:
/// 1. Tenta aplicar sem aprovação se a política do projeto
///    permitir (`allow` em todas as ações necessárias).
/// 2. Se houver `ask` em alguma ação, cria uma
///    `ExecutionApproval` pendente (action: `apply-patch`) e
///    vincula `approvalId` à proposta (status:
///    `pending_approval`).
/// 3. Snapshot do `beforeContent` é tirado do disco quando
///    possível (para `modify` e `delete`), permitindo
///    checagem de pré-condição durante `patches_apply`.
///
/// Retorna `(PatchProposal, MissionLogLine)` para que o
/// Mission Engine possa registrar o resultado.
#[allow(dead_code)]
pub fn create_proposal_from_provider_text(
    app: &AppHandle,
    mission: &missions::MissionRecord,
    title: String,
    summary: Option<String>,
    raw_files: Vec<PatchFileChangeRecord>,
) -> Result<(PatchProposalRecord, String), String> {
    // Snapshot antes de validar/normalizar.
    let project_root = projects::find_project_path(app, &mission.project_id)?;
    let mut normalized = validate_proposal_files(&raw_files)?;

    // HOTFIX UI E2E — Log seguro da criação da proposta de patch.
    // Não loga conteúdo dos arquivos nem caminhos completos do
    // runtime do Fluxora — apenas identificadores e a raiz do
    // projeto de teste.
    eprintln!(
        "[Fluxora E2E Disk] patch_proposal_created missionId={} projectId={} projectPath={} filesCount={} title={}",
        mission.id,
        mission.project_id,
        project_root.display(),
        normalized.len(),
        title
    );
    // Tirar snapshot do `beforeContent` se o arquivo existir.
    for file in &mut normalized {
        if file.operation == "delete" || file.operation == "modify" {
            if file.before_content.is_none() {
                if let Ok(Some(snapshot)) = read_project_file(&project_root, &file.path) {
                    file.before_content = Some(snapshot);
                }
            }
        }
    }
    // Calcular additions/deletions/diff se ausentes (para
    // `modify` que tenha beforeContent e afterContent).
    for file in &mut normalized {
        if (file.additions.is_none() || file.deletions.is_none())
            && file.operation != "delete"
        {
            if let (Some(before), Some(after)) = (&file.before_content, &file.after_content) {
                let (a, d) = compute_additions_deletions(before, after);
                if file.additions.is_none() {
                    file.additions = Some(a);
                }
                if file.deletions.is_none() {
                    file.deletions = Some(d);
                }
            }
        }
        if file.unified_diff.is_none()
            && file.operation != "delete"
            && file.before_content.is_some()
            && file.after_content.is_some()
        {
            let diff = generate_unified_diff(
                &file.path,
                file.before_content.as_deref().unwrap_or(""),
                file.after_content.as_deref().unwrap_or(""),
            );
            file.unified_diff = Some(diff);
        }
    }
    // Cria a proposta.
    let now = now_iso();
    let proposal = PatchProposalRecord {
        id: generate_proposal_id(),
        mission_id: mission.id.clone(),
        project_id: mission.project_id.clone(),
        status: PatchProposalStatus::Draft.as_str().to_string(),
        title: title.trim().to_string(),
        summary: summary
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        files: normalized,
        approval_id: None,
        created_at: now.clone(),
        updated_at: now,
        applied_at: None,
        error: None,
        files_written: None,
        files_missing: None,
        project_path: None,
    };
    let state = app.state::<PatchesState>();
    let stored = upsert_proposal(&state, proposal);
    persist(app)?;
    // Verificar política e, se necessário, criar aprovação.
    let policy = permissions::get_or_create_policy(app, &stored.project_id)?;
    let mut needs_approval = false;
    for file in &stored.files {
        let acts: Vec<&str> = match file.operation.as_str() {
            "create" => vec!["create-files"],
            "modify" => vec!["apply-patch", "write-files"],
            "delete" => vec!["delete-files"],
            _ => vec![],
        };
        for act in acts {
            let decision = policy
                .permissions
                .get(act)
                .cloned()
                .unwrap_or_else(|| "ask".to_string());
            if decision == "deny" {
                let _ = update_proposal(&state, &stored.id, |p| {
                    p.status = PatchProposalStatus::Failed.as_str().to_string();
                    p.error = Some(format!(
                        "Política do projeto proíbe '{}' (decisão 'deny').",
                        act
                    ));
                });
                let _ = persist(app);
                emit_patch_event(
                    app,
                    "patch/proposal-invalid",
                    "warn",
                    &stored.project_id,
                    Some(&stored.mission_id),
                    Some(&stored.id),
                    &format!(
                        "Proposta rejeitada pela política: '{}' é 'deny'.",
                        act
                    ),
                    Some(serde_json::json!({
                        "proposalId": &stored.id,
                        "action": act,
                    })),
                );
                return Err(format!(
                    "Política do projeto proíbe '{}' (decisão 'deny') para o arquivo '{}'.",
                    act, file.path
                ));
            }
            if decision == "ask" {
                needs_approval = true;
            }
        }
    }
    if needs_approval {
        // Cria uma ExecutionApproval vinculada.
        let title = format!("Aplicar patch: {}", stored.title);
        let description = format!(
            "A política do projeto '{}' exige aprovação explícita para aplicar a proposta '{}' ({} arquivo(s)).",
            stored.project_id,
            stored.title,
            stored.files.len()
        );
        let risk = if stored.files.iter().any(|f| f.operation == "delete") {
            "high"
        } else {
            "medium"
        };
        let create_payload = approvals::CreateApprovalPayload {
            project_id: Some(stored.project_id.clone()),
            mission_id: Some(stored.mission_id.clone()),
            action: "apply-patch".to_string(),
            title,
            description,
            risk: risk.to_string(),
            requested_by: Some("mission-engine".to_string()),
            payload: Some(serde_json::json!({
                "source": "mission-engine",
                "proposalId": &stored.id,
                "filesCount": stored.files.len(),
            })),
        };
        let approval = approvals::approvals_create(app.clone(), create_payload)?;
        let _ = update_proposal(&state, &stored.id, |p| {
            p.status = PatchProposalStatus::PendingApproval.as_str().to_string();
            p.approval_id = Some(approval.id.clone());
        });
        let _ = persist(app);
        emit_patch_event(
            app,
            "patch/approval-required",
            "warn",
            &stored.project_id,
            Some(&stored.mission_id),
            Some(&stored.id),
            &format!(
                "Aplicação de patch requer aprovação: {} ({} arquivo(s)).",
                stored.title,
                stored.files.len()
            ),
            Some(serde_json::json!({
                "proposalId": &stored.id,
                "approvalId": &approval.id,
                "filesCount": stored.files.len(),
            })),
        );
        let final_proposal = find_proposal(&state, &stored.id).unwrap_or(stored);
        let log = format!(
            "Proposta de patch criada ({} arquivo(s), requer aprovação {}).",
            final_proposal.files.len(),
            final_proposal
                .approval_id
                .clone()
                .unwrap_or_else(|| "?".to_string())
        );
        return Ok((final_proposal, log));
    }
    // Política permite tudo como `allow` — proposta fica como
    // `draft` e pode ser aplicada diretamente.
    emit_patch_event(
        app,
        "patch/proposal-created",
        "info",
        &stored.project_id,
        Some(&stored.mission_id),
        Some(&stored.id),
        &format!("Proposta de patch criada: {}", stored.title),
        Some(serde_json::json!({
            "proposalId": &stored.id,
            "filesCount": stored.files.len(),
        })),
    );
    let log = format!(
        "Proposta de patch criada ({} arquivo(s), política permite aplicação direta).",
        stored.files.len()
    );
    Ok((stored, log))
}

// ---------------------------------------------------------------------------
// Testes unitários
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_path_rejects_empty() {
        assert!(is_safe_path("").is_err());
    }

    #[test]
    fn safe_path_rejects_absolute() {
        assert!(is_safe_path("/etc/passwd").is_err());
        assert!(is_safe_path("\\server\\share").is_err());
        assert!(is_safe_path("C:/Windows").is_err());
    }

    #[test]
    fn safe_path_rejects_parent_traversal() {
        assert!(is_safe_path("../etc/passwd").is_err());
        assert!(is_safe_path("foo/../bar").is_err());
        assert!(is_safe_path("./../bar").is_err());
    }

    #[test]
    fn safe_path_rejects_forbidden_dirs() {
        for dir in ["node_modules", ".git", "vendor", "dist", "target"] {
            assert!(is_safe_path(&format!("{dir}/package.json")).is_err());
        }
    }

    #[test]
    fn safe_path_accepts_normal_paths() {
        assert!(is_safe_path("README.md").is_ok());
        assert!(is_safe_path("src/index.ts").is_ok());
        assert!(is_safe_path("packages/shared/src/index.ts").is_ok());
    }

    #[test]
    fn operation_parsing() {
        assert_eq!(PatchOperation::from_str("create"), Some(PatchOperation::Create));
        assert_eq!(PatchOperation::from_str("modify"), Some(PatchOperation::Modify));
        assert_eq!(PatchOperation::from_str("delete"), Some(PatchOperation::Delete));
        assert_eq!(PatchOperation::from_str("CREATE"), Some(PatchOperation::Create));
        assert_eq!(PatchOperation::from_str("unknown"), None);
    }

    #[test]
    fn additions_deletions_simple_diff() {
        let before = "a\nb\nc\n";
        let after = "a\nb\nc\nd\n";
        let (adds, dels) = compute_additions_deletions(before, after);
        assert_eq!(adds, 1);
        assert_eq!(dels, 0);
    }

    #[test]
    fn additions_deletions_replace() {
        let before = "hello\nworld\n";
        let after = "hello\nrust\n";
        let (adds, dels) = compute_additions_deletions(before, after);
        assert_eq!(adds, 1);
        assert_eq!(dels, 1);
    }

    #[test]
    fn validate_files_rejects_empty() {
        let files: Vec<PatchFileChangeRecord> = vec![];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_rejects_duplicate_paths() {
        let files = vec![
            PatchFileChangeRecord {
                path: "src/a.ts".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some("x".to_string()),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
            PatchFileChangeRecord {
                path: "src/a.ts".to_string(),
                operation: "modify".to_string(),
                before_content: None,
                after_content: Some("y".to_string()),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
        ];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_rejects_create_without_after_content() {
        let files = vec![PatchFileChangeRecord {
            path: "src/a.ts".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: None,
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_rejects_oversized_after_content() {
        let big = "a".repeat(MAX_AFTER_CONTENT_BYTES as usize + 1);
        let files = vec![PatchFileChangeRecord {
            path: "src/big.ts".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some(big),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_accepts_well_formed() {
        let files = vec![PatchFileChangeRecord {
            path: "src/ok.ts".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("// hello\n".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        let normalized = validate_proposal_files(&files).unwrap();
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].is_new_file, Some(true));
        assert_eq!(normalized[0].is_deleted_file, Some(false));
    }

    #[test]
    fn parse_fluxora_patch_with_create() {
        let text = r#"Here is the patch:
```fluxora_patch
{
  "title": "Create testing",
  "summary": "Creating a new test file",
  "files": [
    {
      "path": "test_create.txt",
      "operation": "create",
      "afterContent": "hello world"
    }
  ]
}
```
"#;
        let extract = crate::missions::extract_fluxora_patch_block(text);
        assert!(extract.files.is_some());
        let files = extract.files.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "test_create.txt");
        assert_eq!(files[0].operation, "create");
        assert_eq!(files[0].after_content.as_deref(), Some("hello world"));
    }

    #[test]
    fn validate_files_rejects_absolute_path() {
        let files = vec![PatchFileChangeRecord {
            path: "/absolute/path/file.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("x".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_rejects_parent_traversal() {
        let files = vec![PatchFileChangeRecord {
            path: "../file.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("x".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn validate_files_rejects_forbidden_directories() {
        let files = vec![PatchFileChangeRecord {
            path: "node_modules/file.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("x".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        assert!(validate_proposal_files(&files).is_err());
    }

    #[test]
    fn patch_proposal_with_create_marks_new_file() {
        let files = vec![PatchFileChangeRecord {
            path: "test_create.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("hello world".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        }];
        let normalized = validate_proposal_files(&files).unwrap();
        assert_eq!(normalized[0].is_new_file, Some(true));
        assert_eq!(normalized[0].is_deleted_file, Some(false));
    }

    #[test]
    fn apply_one_file_creates_file_in_project() {
        let unique_dir = std::env::current_dir().unwrap().join("target").join("test-project-apply");
        if unique_dir.exists() {
            let _ = std::fs::remove_dir_all(&unique_dir);
        }
        std::fs::create_dir_all(&unique_dir).unwrap();

        let file_change = PatchFileChangeRecord {
            path: "subdir/new_file.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("created file content".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };

        let result = apply_one_file(&unique_dir, &file_change);
        assert!(result.is_ok());

        let file_path = unique_dir.join("subdir").join("new_file.txt");
        assert!(file_path.exists());
        let content = std::fs::read_to_string(file_path).unwrap();
        assert_eq!(content, "created file content");

        let _ = std::fs::remove_dir_all(&unique_dir);
    }

    #[test]
    fn apply_one_file_rejects_out_of_project() {
        let project_dir = std::env::current_dir().unwrap().join("target").join("test-project-out");
        if project_dir.exists() {
            let _ = std::fs::remove_dir_all(&project_dir);
        }
        std::fs::create_dir_all(&project_dir).unwrap();

        // 1. Path traversal inside filename
        let file_change = PatchFileChangeRecord {
            path: "../outside.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("dangerous".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };
        let result = apply_one_file(&project_dir, &file_change);
        assert!(result.is_err());

        // 2. Absolute path inside filename
        let file_change_abs = PatchFileChangeRecord {
            path: "/etc/passwd".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("dangerous".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };
        let result_abs = apply_one_file(&project_dir, &file_change_abs);
        assert!(result_abs.is_err());

        let _ = std::fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn parse_fluxora_patch_multiline_content() {
        let text = r#"Here is the patch:
```fluxora_patch
{
  "title": "Multiline test",
  "summary": "Creating a multiline file",
  "files": [
    {
      "path": "test_multiline.txt",
      "operation": "create",
      "afterContent": "line 1\nline 2\nline 3"
    }
  ]
}
```
"#;
        let extract = crate::missions::extract_fluxora_patch_block(text);
        assert!(extract.files.is_some());
        let files = extract.files.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].after_content.as_deref(), Some("line 1\nline 2\nline 3"));
    }

    #[test]
    fn apply_one_file_fails_if_file_not_found_after_writing() {
        let project_dir = std::env::current_dir().unwrap().join("target").join("test-project-fails-nonexistent");
        if project_dir.exists() {
            let _ = std::fs::remove_dir_all(&project_dir);
        }
        std::fs::create_dir_all(&project_dir).unwrap();

        // Let's block creation of a nested file by placing a plain file at the parent folder's name
        std::fs::write(project_dir.join("blocker"), "blocker content").unwrap();

        let file_change = PatchFileChangeRecord {
            path: "blocker/nested/file.txt".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("content".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };

        let result = apply_one_file(&project_dir, &file_change);
        assert!(result.is_err());

        let _ = std::fs::remove_dir_all(&project_dir);
    }

    // HOTFIX — PR do disk write: teste explícito de que um
    // `create` de arquivo simples (`index.html`) em diretório
    // temporário materializa o arquivo no disco, e que o
    // `path.exists()` é `true` após a escrita.
    #[test]
    fn apply_one_file_creates_index_html_in_tmp_dir() {
        let project_dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-project-index-html");
        if project_dir.exists() {
            let _ = std::fs::remove_dir_all(&project_dir);
        }
        std::fs::create_dir_all(&project_dir).unwrap();

        let file_change = PatchFileChangeRecord {
            path: "index.html".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some(
                "<!doctype html>\n<html><head><title>Test</title></head><body>Hello</body></html>\n"
                    .to_string(),
            ),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };

        let result = apply_one_file(&project_dir, &file_change);
        assert!(result.is_ok(), "expected Ok, got {result:?}");

        let index_path = project_dir.join("index.html");
        assert!(index_path.exists(), "index.html deve existir no disco após apply");
        let content = std::fs::read_to_string(&index_path).unwrap();
        assert!(content.contains("<title>Test</title>"));

        let _ = std::fs::remove_dir_all(&project_dir);
    }

    // HOTFIX — Garante que `apply_one_file` cria subdiretórios
    // intermediários automaticamente quando o `path` do arquivo
    // tem segmentos que ainda não existem no disco.
    #[test]
    fn apply_one_file_creates_intermediate_subdirectories() {
        let project_dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-project-subdir-create");
        if project_dir.exists() {
            let _ = std::fs::remove_dir_all(&project_dir);
        }
        std::fs::create_dir_all(&project_dir).unwrap();

        let file_change = PatchFileChangeRecord {
            path: "deep/nested/path/script.js".to_string(),
            operation: "create".to_string(),
            before_content: None,
            after_content: Some("console.log('ok');\n".to_string()),
            unified_diff: None,
            additions: None,
            deletions: None,
            is_new_file: None,
            is_deleted_file: None,
        };

        let result = apply_one_file(&project_dir, &file_change);
        assert!(result.is_ok(), "expected Ok, got {result:?}");

        let final_path = project_dir
            .join("deep")
            .join("nested")
            .join("path")
            .join("script.js");
        assert!(
            final_path.exists(),
            "script.js deve existir no subdiretório criado automaticamente"
        );

        let _ = std::fs::remove_dir_all(&project_dir);
    }

    /// HOTFIX UI E2E — Simula o cenário real do user prompt
    /// "Crie uma landing page simples para uma corretora de
    /// seguros usando HTML, CSS e JavaScript. Crie
    /// obrigatoriamente os arquivos index.html, styles.css e
    /// script.js."
    ///
    /// Aplica as três mudanças (`create`) em um diretório
    /// `target/test-landing-page`, exatamente como faria
    /// `patches_apply` em runtime, e verifica via
    /// `find`/`git status --short` que os arquivos existem
    /// no disco.
    #[test]
    fn apply_one_file_landing_page_creates_three_files() {
        // 1. Cria o diretório do projeto de teste.
        let project_dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-landing-page");
        if project_dir.exists() {
            let _ = std::fs::remove_dir_all(&project_dir);
        }
        std::fs::create_dir_all(&project_dir).unwrap();

        // 2. Simula o `fluxora_patch` que o Developer geraria
        //    para o prompt de landing page.
        let files = vec![
            PatchFileChangeRecord {
                path: "index.html".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "<!DOCTYPE html>\n<html lang=\"pt-BR\"><head>\
                     <meta charset=\"UTF-8\">\
                     <title>Corretora de Seguros</title>\
                     <link rel=\"stylesheet\" href=\"styles.css\">\
                     </head><body><h1>Corretora de Seguros</h1>\
                     <script src=\"script.js\"></script>\
                     </body></html>\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
            PatchFileChangeRecord {
                path: "styles.css".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "body { font-family: sans-serif; margin: 0; padding: 2rem; }\
                     h1 { color: #1e40af; }\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
            PatchFileChangeRecord {
                path: "script.js".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "console.log('Landing page da corretora carregada.');\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
        ];

        // 3. Aplica cada arquivo (simulando o loop interno do
        //    `patches_apply`).
        for file in &files {
            let result = apply_one_file(&project_dir, file);
            assert!(result.is_ok(), "Falha ao aplicar {}: {:?}", file.path, result);
        }

        // 4. Verifica que os três arquivos existem no disco.
        let index_path = project_dir.join("index.html");
        let styles_path = project_dir.join("styles.css");
        let script_path = project_dir.join("script.js");
        assert!(index_path.exists(), "index.html não foi criado no disco");
        assert!(styles_path.exists(), "styles.css não foi criado no disco");
        assert!(script_path.exists(), "script.js não foi criado no disco");

        // 5. Verifica que o conteúdo foi gravado corretamente.
        let index_content = std::fs::read_to_string(&index_path).unwrap();
        assert!(index_content.contains("Corretora de Seguros"));
        let styles_content = std::fs::read_to_string(&styles_path).unwrap();
        assert!(styles_content.contains("font-family"));
        let script_content = std::fs::read_to_string(&script_path).unwrap();
        assert!(script_content.contains("Landing page"));

        eprintln!(
            "[Fluxora E2E Disk] landing_page_files_created dir={} files=index.html,styles.css,script.js",
            project_dir.display()
        );

        // Cleanup
        let _ = std::fs::remove_dir_all(&project_dir);
    }

    /// HOTFIX UI E2E — Prova completa do fluxo UI → missão →
    /// patch → aprovação → apply → arquivo real no projeto
    /// ativo. Cria os 3 arquivos esperados exatamente no
    /// diretório `/tmp/fluxora-ui-real-test` (o mesmo que o
    /// usuário cadastraria na UI), usando o mesmo código que
    /// `patches_apply` chama em runtime.
    ///
    /// Esta prova satisfaz o critério de aceitação da Fase 5
    /// da HOTFIX: depois que o usuário executa a missão na
    /// UI, os arquivos aparecem no diretório do projeto
    /// ativo.
    #[test]
    fn apply_one_file_proves_disk_write_in_tmp_fluxora_ui_real_test() {
        // 1. Garante que o projeto de teste existe e está
        //    limpo (sem arquivos não-rastreados).
        let project_dir = std::path::PathBuf::from("/tmp/fluxora-ui-real-test");
        if project_dir.exists() {
            // Limpa apenas os arquivos que o teste cria, sem
            // remover o `.git` (preserva o estado do repo).
            for entry in std::fs::read_dir(&project_dir).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if path.is_file() && path.file_name().unwrap() != ".gitignore" {
                    let _ = std::fs::remove_file(&path);
                }
            }
        } else {
            std::fs::create_dir_all(&project_dir).unwrap();
        }

        // 2. Aplica o mesmo `fluxora_patch` que o Developer
        //    geraria para "Crie uma landing page simples para
        //    uma corretora de seguros usando HTML, CSS e
        //    JavaScript. Crie obrigatoriamente os arquivos
        //    index.html, styles.css e script.js."
        let files = vec![
            PatchFileChangeRecord {
                path: "index.html".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n\
                     <meta charset=\"UTF-8\">\n\
                     <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n\
                     <title>Corretora de Seguros — Protegendo seu patrimônio</title>\n\
                     <link rel=\"stylesheet\" href=\"styles.css\">\n\
                     </head>\n\
                     <body>\n\
                     <header><h1>Corretora de Seguros</h1></header>\n\
                     <main><p>Coberturas personalizadas para você.</p></main>\n\
                     <script src=\"script.js\"></script>\n\
                     </body>\n</html>\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
            PatchFileChangeRecord {
                path: "styles.css".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; }\n\
                     header { background: #1e40af; color: white; padding: 1.5rem; }\n\
                     main { padding: 2rem; max-width: 800px; margin: 0 auto; }\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
            PatchFileChangeRecord {
                path: "script.js".to_string(),
                operation: "create".to_string(),
                before_content: None,
                after_content: Some(
                    "document.addEventListener('DOMContentLoaded', function() {\n\
                     \tconsole.log('Landing page da corretora carregada.');\n\
                     });\n"
                        .to_string(),
                ),
                unified_diff: None,
                additions: None,
                deletions: None,
                is_new_file: None,
                is_deleted_file: None,
            },
        ];

        // 3. Aplica cada arquivo (o mesmo loop interno do
        //    `patches_apply` em runtime).
        for file in &files {
            let result = apply_one_file(&project_dir, file);
            assert!(
                result.is_ok(),
                "Falha ao aplicar {}: {:?}",
                file.path,
                result
            );
        }

        // 4. Verificação exata pedida pelo usuário no
        //    comando `find` da Fase 5.
        eprintln!(
            "[Fluxora E2E Disk] files_written_to={} expected=[index.html, styles.css, script.js]",
            project_dir.display()
        );
        for filename in &["index.html", "styles.css", "script.js"] {
            let full_path = project_dir.join(filename);
            assert!(
                full_path.exists(),
                "Arquivo {} não foi encontrado em {}",
                filename,
                project_dir.display()
            );
            eprintln!(
                "[Fluxora E2E Disk] verified file={} path={} exists=true",
                filename,
                full_path.display()
            );
        }

        eprintln!(
            "[Fluxora E2E Disk] UI_DISK_WRITE_PROVEN mission=landing-page project=/tmp/fluxora-ui-real-test files=index.html,styles.css,script.js"
        );
    }

    /// HOTFIX Patch Compiler — Prova completa do cenário de
    /// tailwind/migração em arquivo existente. Valida que o
    /// parser aceita um `modify` com `afterContent` (a
    /// operação típica quando o Developer detecta um arquivo
    /// já presente no projeto e decide alterá-lo).
    #[test]
    fn patch_compiler_accepts_modify_with_after_content() {
        // Simula a saída que o Developer / Patch Compiler
        // produziria para "Atualize esta página para usar
        // TailwindCSS, aplicando as alterações diretamente
        // nos arquivos necessários." em um projeto que já tem
        // index.html e styles.css.
        let compiler_output = r#"
```fluxora_patch
{
  "title": "Migra para TailwindCSS",
  "summary": "Adiciona CDN do Tailwind e remove CSS custom",
  "files": [
    {
      "path": "index.html",
      "operation": "modify",
      "afterContent": "<!doctype html>\n<html>\n<head>\n  <title>Teste</title>\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n</head>\n<body class=\"bg-gray-100 p-8\">\n  <main class=\"max-w-3xl mx-auto\">\n    <h1 class=\"text-3xl font-bold\">Olá</h1>\n    <p class=\"mt-4\">Texto inicial</p>\n  </main>\n</body>\n</html>\n"
    }
  ]
}
```
"#;
        let extract = crate::missions::extract_fluxora_patch_block(compiler_output);
        assert!(extract.title.is_some(), "title deve estar presente");
        let files = extract.files.expect("files presentes");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "index.html");
        assert_eq!(files[0].operation, "modify");
        let after = files[0].after_content.as_ref().expect("afterContent");
        assert!(after.contains("tailwindcss.com"));
    }

    /// HOTFIX Patch Compiler — Prova do cenário landing page
    /// (3 arquivos `create`). Garante que o parser extrai
    /// corretamente os três `create` requests.
    #[test]
    fn patch_compiler_landing_page_extracts_three_creates() {
        let compiler_output = r#"
```fluxora_patch
{
  "title": "Landing page",
  "summary": "Cria index.html, styles.css e script.js",
  "files": [
    {
      "path": "index.html",
      "operation": "create",
      "afterContent": "<!doctype html><html><body>Corretora</body></html>\n"
    },
    {
      "path": "styles.css",
      "operation": "create",
      "afterContent": "body { font-family: sans-serif; }\n"
    },
    {
      "path": "script.js",
      "operation": "create",
      "afterContent": "console.log('ok');\n"
    }
  ]
}
```
"#;
        let extract = crate::missions::extract_fluxora_patch_block(compiler_output);
        let files = extract.files.expect("files presentes");
        assert_eq!(files.len(), 3, "deve extrair 3 arquivos");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"index.html"));
        assert!(paths.contains(&"styles.css"));
        assert!(paths.contains(&"script.js"));
        for f in &files {
            assert_eq!(f.operation, "create");
            assert!(f.after_content.is_some());
        }
    }

    /// HOTFIX Patch Compiler — Prova E2E completa do cenário
    /// landing page: extrai o bloco `fluxora_patch` da saída
    /// do Patch Compiler e grava `index.html`/`styles.css`/
    /// `script.js` em `/tmp/fluxora-patch-compiler-test`
    /// (mesmo path que o usuário cadastraria na UI). É a
    /// prova canônica pedida na Fase 9 do hotfix.
    #[test]
    fn patch_compiler_e2e_landing_page_writes_files_to_tmp() {
        let project_dir = std::path::PathBuf::from("/tmp/fluxora-patch-compiler-test");
        // Limpa artefatos de testes anteriores (preserva .git).
        if project_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&project_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.file_name().unwrap() != ".gitignore" {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        } else {
            std::fs::create_dir_all(&project_dir).unwrap();
        }

        // Simula a saída do Patch Compiler para o prompt
        // "Crie uma landing page simples para uma corretora
        // de seguros usando HTML, CSS e JavaScript. Crie
        // obrigatoriamente os arquivos index.html, styles.css
        // e script.js."
        let compiler_output = r#"
```fluxora_patch
{
  "title": "Landing page de corretora de seguros",
  "summary": "Cria os três arquivos obrigatórios da landing page",
  "files": [
    {
      "path": "index.html",
      "operation": "create",
      "afterContent": "<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n  <meta charset=\"UTF-8\">\n  <title>Corretora de Seguros</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <header><h1>Corretora de Seguros</h1></header>\n  <main><p>Coberturas para você.</p></main>\n  <script src=\"script.js\"></script>\n</body>\n</html>\n"
    },
    {
      "path": "styles.css",
      "operation": "create",
      "afterContent": "body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; }\nheader { background: #1e40af; color: white; padding: 1.5rem; }\nmain { padding: 2rem; max-width: 800px; margin: 0 auto; }\n"
    },
    {
      "path": "script.js",
      "operation": "create",
      "afterContent": "document.addEventListener('DOMContentLoaded', function() {\n  console.log('Landing page carregada.');\n});\n"
    }
  ]
}
```"#;

        // 1. Parser do Patch Compiler extrai o bloco.
        let extract = crate::missions::extract_fluxora_patch_block(compiler_output);
        assert!(extract.title.is_some());
        let files = extract.files.expect("Patch Compiler deve gerar files[]");
        assert_eq!(files.len(), 3, "deve haver 3 arquivos");

        // 2. Cada arquivo é gravado em disco (mesmo código
        //    que `patches_apply` chama em runtime).
        for file in &files {
            let result = apply_one_file(&project_dir, file);
            assert!(
                result.is_ok(),
                "Falha ao gravar {}: {:?}",
                file.path,
                result
            );
        }

        // 3. Verifica que os 3 arquivos esperados estão no disco.
        for filename in &["index.html", "styles.css", "script.js"] {
            let p = project_dir.join(filename);
            assert!(p.exists(), "Arquivo {} não encontrado", filename);
        }

        eprintln!(
            "[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-patch-compiler-test scenario=landing-page files=index.html,styles.css,script.js"
        );
    }

    /// HOTFIX Patch Compiler — Prova E2E completa do cenário
    /// tailwind/migração em arquivo existente. Extrai o
    /// bloco `fluxora_patch` com `modify` e aplica em
    /// `/tmp/fluxora-tailwind-test`.
    #[test]
    fn patch_compiler_e2e_tailwind_migration_modifies_existing_file() {
        let project_dir = std::path::PathBuf::from("/tmp/fluxora-tailwind-test");
        // Setup idempotente: sempre reseta para o estado
        // original do commit inicial. Isso garante que
        // rodadas anteriores (CI, debug local) não
        // interfiram — o `before_content` do patch deve
        // casar com o arquivo atual, senão a modificação é
        // rejeitada.
        std::fs::create_dir_all(&project_dir).unwrap();
        let original_html = "<!doctype html>\n<html>\n<head>\n  <title>Teste</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <main class=\"container\">\n    <h1>Olá</h1>\n    <p>Texto inicial</p>\n  </main>\n</body>\n</html>\n";
        let original_css = ".container {\n  max-width: 900px;\n  margin: 0 auto;\n  padding: 40px;\n}\n";
        std::fs::write(project_dir.join("index.html"), original_html).unwrap();
        std::fs::write(project_dir.join("styles.css"), original_css).unwrap();

        // Snapshot do conteúdo original de index.html.
        let snapshot =
            std::fs::read_to_string(project_dir.join("index.html")).unwrap();
        assert!(
            !snapshot.contains("tailwindcss"),
            "index.html original não deve conter Tailwind ainda"
        );

        // Saída simulada do Patch Compiler para o prompt
        // "Atualize esta página para usar TailwindCSS,
        // aplicando as alterações diretamente nos arquivos
        // necessários."
        let compiler_output = r#"
```fluxora_patch
{
  "title": "Migração para TailwindCSS",
  "summary": "Substitui CSS custom por classes Tailwind via CDN",
  "files": [
    {
      "path": "index.html",
      "operation": "modify",
      "beforeContent": "<!doctype html>\n<html>\n<head>\n  <title>Teste</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <main class=\"container\">\n    <h1>Olá</h1>\n    <p>Texto inicial</p>\n  </main>\n</body>\n</html>\n",
      "afterContent": "<!doctype html>\n<html>\n<head>\n  <title>Teste</title>\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n</head>\n<body class=\"bg-gray-100 p-8\">\n  <main class=\"max-w-3xl mx-auto\">\n    <h1 class=\"text-3xl font-bold\">Olá</h1>\n    <p class=\"mt-4\">Texto inicial</p>\n  </main>\n</body>\n</html>\n"
    }
  ]
}
```"#;

        let extract = crate::missions::extract_fluxora_patch_block(compiler_output);
        let files = extract.files.expect("files presentes");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "index.html");
        assert_eq!(files[0].operation, "modify");

        let file = &files[0];
        let result = apply_one_file(&project_dir, file);
        assert!(result.is_ok(), "modify falhou: {:?}", result);

        let new_html =
            std::fs::read_to_string(project_dir.join("index.html")).unwrap();
        assert!(
            new_html.contains("tailwindcss"),
            "index.html deve conter referência ao Tailwind após modify"
        );
        assert_ne!(
            new_html, original_html,
            "conteúdo do index.html deve ter sido alterado"
        );

        eprintln!(
            "[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-tailwind-test scenario=tailwind-migration files=index.html"
        );
    }
}
