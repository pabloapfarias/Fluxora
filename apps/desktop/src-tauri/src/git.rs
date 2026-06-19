// PR 003 — Git backend
//
// Comandos Tauri para inspeção segura de repositórios Git em
// projetos cadastrados. Implementa apenas leitura/inspeção
// (status, branch, diff, commits recentes). Nenhuma operação
// destrutiva (commit, push, pull, checkout, reset) é exposta
// nesta PR.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

use crate::approvals;
use crate::events;
use crate::permissions;
use crate::projects;

const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_RECENT_COMMITS: usize = 20;
const HARD_RECENT_COMMITS: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAppInfo {
    /// Branch atual do app (cwd). String vazia quando
    /// indisponível; o componente `StatusBar` já trata
    /// `""` como "branch desconhecida".
    pub branch: String,
    /// Commit curto atual do app. String vazia quando
    /// indisponível.
    pub commit: String,
    /// Mensagem de erro amigável quando o app não está em um
    /// repositório Git ou o comando falhou. Não enviado quando
    /// não há erro.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub is_repo: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub files: Vec<GitChangedFile>,
    pub total_additions: u32,
    pub total_deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitsOptions {
    pub limit: Option<usize>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve o `project_id` para o diretório root canônico, igual
/// ao helper usado em `filesystem.rs`.
fn project_root(app: &AppHandle, project_id: &str) -> Result<std::path::PathBuf, String> {
    let raw = projects::find_project_path(app, project_id)?;
    let metadata = std::fs::metadata(&raw).map_err(|error| {
        format!(
            "Projeto {project_id} cadastrado em caminho inacessível ({}): {error}",
            raw.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "Projeto {project_id} cadastrado em caminho que não é diretório: {}",
            raw.display()
        ));
    }
    Ok(raw.canonicalize().unwrap_or(raw))
}

/// Executa `git` em `cwd` com `args`, com timeout. Retorna
/// `(exit_code, stdout, stderr)`. Não falha se o comando
/// retornar código não-zero — quem chama decide o que fazer.
fn run_git(cwd: &Path, args: &[&str], timeout: Duration) -> Result<RunOutput, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = command
        .spawn()
        .map_err(|error| format!("Falha ao iniciar git: {error}"))?;
    let (tx, rx) = mpsc::channel();
    let pid = child.id();
    let waiter = thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });
    let output = match rx.recv_timeout(timeout) {
        Ok(result) => result.map_err(|error| format!("git falhou: {error}"))?,
        Err(_) => {
            // Tenta matar o processo (best effort — em Unix o kill
            // é direto; em Windows Command::kill funciona).
            #[cfg(unix)]
            unsafe {
                libc_kill(pid);
            }
            let _ = waiter.join();
            return Err(format!(
                "git {} excedeu o tempo limite de {:?}",
                args.join(" "),
                timeout
            ));
        }
    };
    let _ = waiter.join();
    Ok(RunOutput::from(output))
}

#[cfg(unix)]
unsafe fn libc_kill(pid: u32) {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe {
        kill(pid as i32, 9);
    }
}

struct RunOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl From<std::process::Output> for RunOutput {
    fn from(output: std::process::Output) -> Self {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Self {
            exit_code: output.status.code(),
            stdout,
            stderr,
        }
    }
}

fn git_dir_exists(project_dir: &Path) -> bool {
    project_dir.join(".git").exists()
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Retorna `true` se o diretório do projeto é um repositório Git
/// (tem `.git` na raiz e responde a `git rev-parse`).
pub fn git_is_repo(app: AppHandle, project_id: String) -> Result<bool, String> {
    let root = project_root(&app, &project_id)?;
    if !git_dir_exists(&root) {
        return Ok(false);
    }
    let output = run_git(&root, &["rev-parse", "--is-inside-work-tree"], DEFAULT_COMMAND_TIMEOUT)?;
    Ok(output.exit_code == Some(0) && output.stdout.trim() == "true")
}

/// Retorna a branch atual (`HEAD` resolvido), se houver.
pub fn git_current_branch(
    app: AppHandle,
    project_id: String,
) -> Result<Option<String>, String> {
    let root = project_root(&app, &project_id)?;
    if !git_dir_exists(&root) {
        return Ok(None);
    }
    let output = run_git(
        &root,
        &["symbolic-ref", "--short", "HEAD"],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    if output.exit_code != Some(0) {
        // detached HEAD — tenta rev-parse
        let fallback = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"], DEFAULT_COMMAND_TIMEOUT)?;
        if fallback.exit_code == Some(0) {
            let trimmed = fallback.stdout.trim().to_string();
            if trimmed.is_empty() || trimmed == "HEAD" {
                return Ok(None);
            }
            return Ok(Some(trimmed));
        }
        return Ok(None);
    }
    let trimmed = output.stdout.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_string()))
    }
}

/// Retorna o status atual do repositório (arquivos modificados,
/// adicionados, removidos, renomeados, não rastreados).
pub fn git_status(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<GitChangedFile>, String> {
    let root = project_root(&app, &project_id)?;
    if !git_dir_exists(&root) {
        return Ok(Vec::new());
    }
    // `git status --porcelain` retorna linhas do tipo
    // "XY path" onde XY é o status de 2 caracteres e path pode
    // vir entre aspas.
    let output = run_git(
        &root,
        &["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=dirty"],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    if output.exit_code != Some(0) {
        return Err(format!(
            "git status falhou: {}",
            if output.stderr.trim().is_empty() {
                output.stdout.trim().to_string()
            } else {
                output.stderr.trim().to_string()
            }
        ));
    }

    let mut out = Vec::new();
    for line in output.stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let code = &line[..2];
        let path_part = line[3..].trim();
        let path = unquote_porcelain_path(path_part);
        if path.is_empty() {
            continue;
        }
        out.push(GitChangedFile {
            path,
            status: porcelain_code_to_status(code),
            additions: 0,
            deletions: 0,
        });
    }
    Ok(out)
}

fn unquote_porcelain_path(raw: &str) -> String {
    // Caminhos com espaços/special chars vêm com aspas C-style:
    //   "path/with space/and \"quote\""
    if raw.starts_with('"') {
        let mut out = String::new();
        let bytes = raw.as_bytes();
        let mut i = 1;
        while i < bytes.len() {
            let b = bytes[i];
            if b == b'\\' && i + 1 < bytes.len() {
                out.push(bytes[i + 1] as char);
                i += 2;
            } else {
                out.push(b as char);
                i += 1;
            }
        }
        out
    } else {
        raw.to_string()
    }
}

fn porcelain_code_to_status(code: &str) -> String {
    // Mapeamento simplificado para os status que o UI já conhece.
    // X = staged, Y = unstaged.
    let x = code.chars().next().unwrap_or(' ');
    let y = code.chars().nth(1).unwrap_or(' ');
    match (x, y) {
        ('?', '?') => "untracked",
        ('!', '!') => "ignored",
        ('A', _) => "added",
        ('D', _) => "deleted",
        ('R', _) => "renamed",
        ('C', _) => "renamed",
        (_, 'M') | ('M', _) => "modified",
        _ => "modified",
    }
    .to_string()
}

/// Lê os N commits mais recentes do histórico.
pub fn git_recent_commits(
    app: AppHandle,
    project_id: String,
    options: Option<GitCommitsOptions>,
) -> Result<Vec<GitCommitInfo>, String> {
    let root = project_root(&app, &project_id)?;
    if !git_dir_exists(&root) {
        return Ok(Vec::new());
    }
    let limit = options
        .as_ref()
        .and_then(|opts| opts.limit)
        .unwrap_or(DEFAULT_RECENT_COMMITS)
        .min(HARD_RECENT_COMMITS);

    // Format: hash\x1fshort\x1fauthor_name\x1fauthor_email\x1fiso_date\x1fsubject
    let sep = "\u{1f}";
    let format = format!("%H{sep}%h{sep}%an{sep}%ae{sep}%aI{sep}%s");
    let n = format!("-n{}", limit);
    let output = run_git(
        &root,
        &["log", &n, &format!("--pretty=format:{format}")],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    if output.exit_code != Some(0) {
        return Err(format!(
            "git log falhou: {}",
            if output.stderr.trim().is_empty() {
                output.stdout.trim().to_string()
            } else {
                output.stderr.trim().to_string()
            }
        ));
    }

    let mut commits = Vec::new();
    for line in output.stdout.lines() {
        let parts: Vec<&str> = line.split(sep).collect();
        if parts.len() < 6 {
            continue;
        }
        commits.push(GitCommitInfo {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            author_name: parts[2].to_string(),
            author_email: parts[3].to_string(),
            committed_at: parts[4].to_string(),
            subject: parts[5].to_string(),
        });
    }
    Ok(commits)
}

/// Retorna o diff unificado de um arquivo específico em relação
/// ao último commit (`HEAD`). Para arquivos não rastreados,
/// retorna o conteúdo do arquivo como diff "novo".
pub fn git_diff(
    app: AppHandle,
    project_id: String,
    file_path: String,
) -> Result<String, String> {
    let root = project_root(&app, &project_id)?;
    if !git_dir_exists(&root) {
        return Err("Projeto não é um repositório Git.".to_string());
    }
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("file_path não pode estar vazio.".to_string());
    }
    // Proteção contra path traversal
    let path = std::path::PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err("file_path deve ser relativo ao root do projeto.".to_string());
    }
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("file_path não pode conter '..'.".to_string());
        }
    }

    // Tenta diff unificado padrão primeiro.
    let output = run_git(
        &root,
        &["diff", "--no-color", "HEAD", "--", trimmed],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    if output.exit_code == Some(0) {
        if !output.stdout.is_empty() {
            return Ok(output.stdout);
        }
    } else {
        return Err(format!(
            "git diff falhou: {}",
            if output.stderr.trim().is_empty() {
                output.stdout.trim().to_string()
            } else {
                output.stderr.trim().to_string()
            }
        ));
    }

    // Sem mudanças em HEAD — pode ser arquivo não rastreado.
    let status_output = run_git(
        &root,
        &["status", "--porcelain", "--", trimmed],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    let is_untracked = status_output
        .stdout
        .lines()
        .any(|line| line.starts_with("??"));
    if is_untracked {
        let full_path = root.join(trimmed);
        let mut buffer = String::new();
        let mut file = match std::fs::File::open(&full_path) {
            Ok(file) => file,
            Err(error) => {
                return Err(format!(
                    "Não foi possível abrir arquivo não rastreado: {error}"
                ));
            }
        };
        if file.read_to_string(&mut buffer).is_err() {
            return Err("Arquivo não rastreado é binário ou não-legível como texto.".to_string());
        }
        let mut diff = String::new();
        diff.push_str(&format!("--- /dev/null\n+++ b/{trimmed}\n"));
        diff.push_str("@@ -0,0 +1,");
        let line_count = buffer.lines().count();
        diff.push_str(&line_count.to_string());
        diff.push_str(" @@\n");
        for line in buffer.lines() {
            diff.push('+');
            diff.push_str(line);
            diff.push('\n');
        }
        return Ok(diff);
    }
    // Sem diff e não-untracked: arquivo está limpo em HEAD.
    Ok(String::new())
}

/// Resumo consolidado: `isRepo`, branch, status, totais.
/// Mesmo formato de `GitInspectionResult` consumido pela UI.
pub fn git_summary(app: AppHandle, project_id: String) -> Result<GitSummary, String> {
    let root = match project_root(&app, &project_id) {
        Ok(value) => value,
        Err(error) => {
            return Ok(GitSummary {
                is_repo: false,
                branch: None,
                files: Vec::new(),
                total_additions: 0,
                total_deletions: 0,
                error: Some(error),
            });
        }
    };
    if !git_dir_exists(&root) {
        return Ok(GitSummary {
            is_repo: false,
            branch: None,
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
            error: None,
        });
    }

    let is_repo = match run_git(&root, &["rev-parse", "--is-inside-work-tree"], DEFAULT_COMMAND_TIMEOUT) {
        Ok(out) => out.exit_code == Some(0) && out.stdout.trim() == "true",
        Err(_) => false,
    };
    if !is_repo {
        return Ok(GitSummary {
            is_repo: false,
            branch: None,
            files: Vec::new(),
            total_additions: 0,
            total_deletions: 0,
            error: None,
        });
    }

    let branch = git_current_branch(app.clone(), project_id.clone()).unwrap_or(None);
    let status = git_status(app.clone(), project_id.clone()).unwrap_or_default();
    let total_additions: u32 = status.iter().map(|entry| entry.additions).sum();
    let total_deletions: u32 = status.iter().map(|entry| entry.deletions).sum();

    Ok(GitSummary {
        is_repo: true,
        branch,
        files: status,
        total_additions,
        total_deletions,
        error: None,
    })
}

/// Versão "app-level" do Git info — branch/commit do **diretório
/// onde o app está rodando**, não de um projeto. Usado pela
/// `StatusBar` para mostrar a versão em desenvolvimento.
pub fn app_get_git_info() -> GitAppInfo {
    let cwd = match std::env::current_dir() {
        Ok(dir) => dir,
        Err(error) => {
            return GitAppInfo {
                branch: String::new(),
                commit: String::new(),
                error: Some(format!("Não foi possível resolver o cwd: {error}")),
            };
        }
    };
    if !cwd.join(".git").exists() {
        return GitAppInfo {
            branch: String::new(),
            commit: String::new(),
            error: Some("App não está em um repositório Git.".to_string()),
        };
    }
    let branch = run_git(
        &cwd,
        &["rev-parse", "--abbrev-ref", "HEAD"],
        DEFAULT_COMMAND_TIMEOUT,
    )
    .ok()
    .and_then(|output| {
        if output.exit_code == Some(0) {
            let trimmed = output.stdout.trim();
            if trimmed.is_empty() || trimmed == "HEAD" {
                None
            } else {
                Some(trimmed.to_string())
            }
        } else {
            None
        }
    });
    let commit = run_git(
        &cwd,
        &["rev-parse", "--short", "HEAD"],
        DEFAULT_COMMAND_TIMEOUT,
    )
    .ok()
    .and_then(|output| {
        if output.exit_code == Some(0) {
            let trimmed = output.stdout.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        } else {
            None
        }
    });
    GitAppInfo {
        branch: branch.unwrap_or_default(),
        commit: commit.unwrap_or_default(),
        error: None,
    }
}

// ---------------------------------------------------------------------------
// PR 016 — Git branch e commit local controlado após patch aplicado
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResultRecord {
    pub id: String,
    pub project_id: String,
    pub mission_id: Option<String>,
    pub patch_proposal_id: Option<String>,
    pub branch: Option<String>,
    pub commit_hash: Option<String>,
    pub message: String,
    pub files: Vec<String>,
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GitCommitsFile {
    version: u32,
    commits: Vec<GitCommitResultRecord>,
}

impl Default for GitCommitsFile {
    fn default() -> Self {
        Self {
            version: 1,
            commits: Vec::new(),
        }
    }
}

pub struct GitCommitsState {
    pub commits: Mutex<Vec<GitCommitResultRecord>>,
}

impl GitCommitsState {
    pub fn new() -> Self {
        Self {
            commits: Mutex::new(Vec::new()),
        }
    }
}

fn git_commits_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("git_commits.json"))
}

fn ensure_git_commits_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = git_commits_file_path(app)?;
    let parent = file_path.parent().ok_or_else(|| {
        "Não foi possível resolver o diretório de persistência de commits.".to_string()
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_git_commits_file(app: &AppHandle) -> Result<GitCommitsFile, String> {
    let file_path = ensure_git_commits_dir(app)?;
    if !file_path.exists() {
        return Ok(GitCommitsFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(GitCommitsFile::default());
    }
    serde_json::from_str::<GitCommitsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de commits inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_git_commits_file(app: &AppHandle, store: &GitCommitsFile) -> Result<(), String> {
    let file_path = ensure_git_commits_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar as informações de commit: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

pub fn load_git_commits_on_startup(app: &AppHandle) {
    match read_git_commits_file(app) {
        Ok(store) => {
            let count = store.commits.len();
            if let Some(state) = app.try_state::<GitCommitsState>() {
                if let Ok(mut commits) = state.commits.lock() {
                    *commits = store.commits;
                }
                eprintln!("[fluxora git commits] carregados {count} commit(s) local(is)");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora git commits] falha ao carregar git_commits.json: {error}. Iniciando vazio."
            );
        }
    }
}

fn persist_commits(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<GitCommitsState>();
    let commits = state
        .commits
        .lock()
        .map_err(|_| "Lock de commits poisoned.".to_string())?
        .clone();
    let store = GitCommitsFile {
        version: 1,
        commits,
    };
    write_git_commits_file(app, &store)
}

fn generate_commit_result_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("git-commit-{millis}-{seq}")
}

fn now_iso() -> String {
    events::iso_now()
}

fn emit_git_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    project_id: &str,
    mission_id: Option<&str>,
    patch_proposal_id: Option<&str>,
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
    if let Some(pid) = patch_proposal_id {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("patchProposalId".to_string(), serde_json::Value::String(pid.to_string()));
        }
    }
    let event = events::build_event(
        event_type,
        "system",
        level,
        Some(message.to_string()),
        Some(project_id.to_string()),
        mission_id.map(|m| m.to_string()),
        None,
        Some(payload),
    );
    events::emit_to_app(app, event);
}

fn is_safe_commit_path(rel: &str) -> bool {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return false;
    }
    if trimmed.chars().nth(1) == Some(':') {
        return false;
    }
    let normalized = trimmed.replace('\\', "/");
    for component in std::path::Path::new(&normalized).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return false;
        }
    }
    for component in std::path::Path::new(&normalized).components() {
        if let std::path::Component::Normal(name) = component {
            if let Some(name_str) = name.to_str() {
                let lower = name_str.to_lowercase();
                if lower == "node_modules"
                    || lower == ".git"
                    || lower == "vendor"
                    || lower == "dist"
                    || lower == "target"
                    || lower.contains("secret")
                    || lower.starts_with(".env")
                {
                    return false;
                }
            }
        }
    }
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWriteReadiness {
    pub is_repo: bool,
    pub current_branch: Option<String>,
    pub has_uncommitted_changes: bool,
    pub has_outside_changes: bool,
    pub pre_existing_warning: Option<String>,
}

/// Retorna informações sobre o estado do repositório antes de realizar um commit,
/// incluindo se existem alterações locais e se há modificações que não pertencem à PatchProposal.
pub fn git_get_write_readiness(
    app: AppHandle,
    project_id: String,
    patch_proposal_id: Option<String>,
) -> Result<GitWriteReadiness, String> {
    let is_repo = git_is_repo(app.clone(), project_id.clone()).unwrap_or(false);
    if !is_repo {
        return Ok(GitWriteReadiness {
            is_repo: false,
            current_branch: None,
            has_uncommitted_changes: false,
            has_outside_changes: false,
            pre_existing_warning: Some("O projeto não é um repositório Git. Por favor, inicialize um repositório Git no diretório do projeto para habilitar commits.".to_string()),
        });
    }
    let current_branch = git_current_branch(app.clone(), project_id.clone()).unwrap_or(None);
    let status = git_status(app.clone(), project_id.clone()).unwrap_or_default();
    let has_uncommitted_changes = !status.is_empty();
    
    let mut has_outside_changes = false;
    let mut pre_existing_warning = None;
    if let Some(proposal_id) = &patch_proposal_id {
        if let Some(patches_state) = app.try_state::<crate::patches::PatchesState>() {
            if let Ok(guard) = patches_state.proposals.lock() {
                if let Some(prop) = guard.iter().find(|p| p.id == *proposal_id) {
                    let prop_paths: std::collections::BTreeSet<String> = prop.files.iter().map(|f| f.path.clone()).collect();
                    for file in &status {
                        if !prop_paths.contains(&file.path) {
                            has_outside_changes = true;
                            break;
                        }
                    }
                }
            }
        }
    }
    
    if has_outside_changes {
        pre_existing_warning = Some("Existem alterações fora desta missão. O Fluxora commitará apenas arquivos da proposta aplicada.".to_string());
    }
    
    Ok(GitWriteReadiness {
        is_repo: true,
        current_branch,
        has_uncommitted_changes,
        has_outside_changes,
        pre_existing_warning,
    })
}

/// Cria ou alterna para uma branch local para a missão de forma segura e não destrutiva.
pub fn git_create_branch_for_mission(
    app: AppHandle,
    project_id: String,
    branch_name: String,
) -> Result<String, String> {
    let root = project_root(&app, &project_id)?;
    if !git_is_repo(app.clone(), project_id.clone())? {
        return Err("O projeto não é um repositório Git.".to_string());
    }
    let bname = branch_name.trim();
    if bname.is_empty() {
        return Err("Nome da branch não pode estar vazio.".to_string());
    }
    let res = run_git(&root, &["checkout", "-b", bname], DEFAULT_COMMAND_TIMEOUT);
    if res.is_err() || res.as_ref().unwrap().exit_code != Some(0) {
        let res2 = run_git(&root, &["checkout", bname], DEFAULT_COMMAND_TIMEOUT)?;
        if res2.exit_code != Some(0) {
            return Err(format!("Falha ao criar ou alternar para branch '{}': {}", bname, res2.stderr));
        }
    }
    
    emit_git_event(
        &app,
        "git/branch-created",
        "info",
        &project_id,
        None,
        None,
        &format!("Branch criada/alternada: {}", bname),
        Some(serde_json::json!({ "branch": bname })),
    );
    
    Ok(bname.to_string())
}

/// Helper para registrar falha e emitir evento.
fn handle_commit_failure(
    app: &AppHandle,
    project_id: &str,
    mission_id: Option<String>,
    patch_proposal_id: Option<String>,
    message: String,
    files: Vec<String>,
    error_msg: String,
    approval_id: Option<String>,
) -> Result<GitCommitResultRecord, String> {
    let now = now_iso();
    let state = app.state::<GitCommitsState>();
    let mut guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
    
    let record = if let Some(existing) = guard.iter_mut().find(|c| {
        c.project_id == project_id
            && c.mission_id == mission_id
            && c.patch_proposal_id == patch_proposal_id
            && c.status == "pending_approval"
    }) {
        existing.status = "failed".to_string();
        existing.error = Some(error_msg.clone());
        existing.clone()
    } else {
        let new_id = generate_commit_result_id();
        let rec = GitCommitResultRecord {
            id: new_id,
            project_id: project_id.to_string(),
            mission_id: mission_id.clone(),
            patch_proposal_id: patch_proposal_id.clone(),
            branch: None,
            commit_hash: None,
            message: message.clone(),
            files: files.clone(),
            status: "failed".to_string(),
            created_at: now,
            error: Some(error_msg.clone()),
            approval_id: approval_id.clone(),
        };
        guard.push(rec.clone());
        rec
    };
    drop(guard);
    let _ = persist_commits(app);
    
    emit_git_event(
        app,
        "git/commit-failed",
        "error",
        project_id,
        mission_id.as_deref(),
        patch_proposal_id.as_deref(),
        &format!("Falha ao criar commit: {}", error_msg),
        Some(serde_json::json!({
            "errorMessage": error_msg,
        })),
    );
    
    Ok(record)
}

/// Executa a criação de commit local controlado.
pub fn git_commit_patch(
    app: AppHandle,
    project_id: String,
    mission_id: Option<String>,
    patch_proposal_id: Option<String>,
    create_branch: Option<bool>,
    branch_name: Option<String>,
    message: String,
    files: Vec<String>,
    approval_id: Option<String>,
) -> Result<GitCommitResultRecord, String> {
    let root = project_root(&app, &project_id)?;

    // 1. Validar Git Repo
    if !git_is_repo(app.clone(), project_id.clone())? {
        return Err("O projeto não está configurado como um repositório Git. Por favor, inicialize um repositório Git no diretório do projeto para habilitar commits.".to_string());
    }

    // 2. Segurança de arquivos
    for file in &files {
        if !is_safe_commit_path(file) {
            return Err(format!("O arquivo '{}' viola as regras de segurança ou contém caminhos proibidos.", file));
        }
        let resolved = root.join(file);
        let root_canon = root.canonicalize().unwrap_or_else(|_| root.clone());
        let resolved_canon = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());
        if !resolved_canon.starts_with(&root_canon) {
            return Err(format!("O arquivo '{}' escapa do diretório do projeto.", file));
        }
    }

    // 3. Validar PatchProposal
    if let Some(proposal_id) = &patch_proposal_id {
        if let Some(patches_state) = app.try_state::<crate::patches::PatchesState>() {
            let proposals = patches_state.proposals.lock().ok();
            if let Some(guard) = proposals {
                if let Some(prop) = guard.iter().find(|p| p.id == *proposal_id) {
                    let prop_paths: std::collections::BTreeSet<String> = prop.files.iter().map(|f| f.path.clone()).collect();
                    for file in &files {
                        if !prop_paths.contains(file) {
                            return Err(format!("O arquivo '{}' não pertence à PatchProposal '{}'.", file, proposal_id));
                        }
                    }
                }
            }
        }
    }

    // 4. Verificar Permissões e aprovações
    let policy = permissions::get_or_create_policy(&app, &project_id)?;
    let git_write_decision = policy.permissions.get("git-write").cloned().unwrap_or_else(|| "ask".to_string());
    let commit_decision = policy.permissions.get("commit").cloned().unwrap_or_else(|| "ask".to_string());

    if git_write_decision == "deny" || commit_decision == "deny" {
        return Err("A política do projeto proíbe a gravação no Git ou commits (decisão 'deny').".to_string());
    }

    let needs_approval = git_write_decision == "ask" || commit_decision == "ask";
    if needs_approval {
        if let Some(aid) = &approval_id {
            let approval = approvals::approvals_get(app.clone(), aid.clone())
                .map_err(|e| format!("Falha ao buscar aprovação {aid}: {e}"))?;
            match approval {
                Some(a) if a.status == "approved" => {
                    // OK, aprovada.
                }
                Some(a) => {
                    return Err(format!(
                        "Ação requer aprovação, mas a aprovação {} está com status '{}'.",
                        a.id, a.status
                    ));
                }
                None => {
                    return Err(format!(
                        "Ação requer aprovação, mas a aprovação {} não foi encontrada.",
                        aid
                    ));
                }
            }
        } else {
            // Verifica se já existe proposta pendente de aprovação
            let state = app.state::<GitCommitsState>();
            let guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
            if let Some(existing) = guard.iter().find(|c| {
                c.project_id == project_id
                    && c.mission_id == mission_id
                    && c.patch_proposal_id == patch_proposal_id
                    && c.status == "pending_approval"
            }) {
                if existing.approval_id.is_some() {
                    return Ok(existing.clone());
                }
            }
            drop(guard);

            // Cria ExecutionApproval
            let title = format!("Criar commit local: {}", message);
            let description = format!(
                "A política do projeto '{}' exige aprovação explícita para criar commits locais (ação: commit).",
                project_id
            );
            let create_payload = approvals::CreateApprovalPayload {
                project_id: Some(project_id.clone()),
                mission_id: mission_id.clone(),
                action: "commit".to_string(),
                title,
                description,
                risk: "high".to_string(),
                requested_by: Some("git-commit-engine".to_string()),
                payload: Some(serde_json::json!({
                    "source": "git-commit-engine",
                    "projectId": &project_id,
                    "missionId": &mission_id,
                    "patchProposalId": &patch_proposal_id,
                    "createBranch": create_branch,
                    "branchName": &branch_name,
                    "message": &message,
                    "files": &files,
                })),
            };
            let approval = approvals::approvals_create(app.clone(), create_payload)?;
            
            let record = GitCommitResultRecord {
                id: generate_commit_result_id(),
                project_id: project_id.clone(),
                mission_id: mission_id.clone(),
                patch_proposal_id: patch_proposal_id.clone(),
                branch: branch_name.clone(),
                commit_hash: None,
                message: message.clone(),
                files: files.clone(),
                status: "pending_approval".to_string(),
                created_at: now_iso(),
                error: Some("Ação requer aprovação.".to_string()),
                approval_id: Some(approval.id.clone()),
            };
            
            let state = app.state::<GitCommitsState>();
            let mut guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
            guard.push(record.clone());
            drop(guard);
            persist_commits(&app)?;
            
            emit_git_event(
                &app,
                "git/commit-approval-required",
                "warn",
                &project_id,
                mission_id.as_deref(),
                patch_proposal_id.as_deref(),
                &format!("Commit local requer aprovação: {}", message),
                Some(serde_json::json!({
                    "approvalId": &approval.id,
                    "filesCount": files.len(),
                })),
            );

            return Ok(record);
        }
    }

    let now = now_iso();
    
    emit_git_event(
        &app,
        "git/commit-started",
        "info",
        &project_id,
        mission_id.as_deref(),
        patch_proposal_id.as_deref(),
        &format!("Iniciando commit local: {}", message),
        Some(serde_json::json!({
            "filesCount": files.len(),
        })),
    );

    // Opcionalmente cria branch
    let mut actual_branch = None;
    if let (Some(true), Some(bname)) = (create_branch, &branch_name) {
        if !bname.trim().is_empty() {
            let bname_trimmed = bname.trim();
            let res = run_git(&root, &["checkout", "-b", bname_trimmed], DEFAULT_COMMAND_TIMEOUT);
            if res.is_err() || res.as_ref().unwrap().exit_code != Some(0) {
                let res2 = run_git(&root, &["checkout", bname_trimmed], DEFAULT_COMMAND_TIMEOUT)?;
                if res2.exit_code != Some(0) {
                    let err_msg = format!("Falha ao criar/alternar para branch '{}': {}", bname_trimmed, res2.stderr);
                    return handle_commit_failure(&app, &project_id, mission_id, patch_proposal_id, message, files, err_msg, approval_id);
                }
            }
            actual_branch = Some(bname_trimmed.to_string());
            
            emit_git_event(
                &app,
                "git/branch-created",
                "info",
                &project_id,
                mission_id.as_deref(),
                patch_proposal_id.as_deref(),
                &format!("Branch criada/alternada: {}", bname_trimmed),
                Some(serde_json::json!({ "branch": bname_trimmed })),
            );
        }
    }

    if actual_branch.is_none() {
        actual_branch = git_current_branch(app.clone(), project_id.clone()).unwrap_or(None);
    }

    // Git add
    let mut add_args = vec!["add", "--"];
    for f in &files {
        add_args.push(f);
    }
    let add_res = run_git(&root, &add_args, DEFAULT_COMMAND_TIMEOUT)?;
    if add_res.exit_code != Some(0) {
        let err_msg = format!("git add falhou: {}", add_res.stderr);
        return handle_commit_failure(&app, &project_id, mission_id, patch_proposal_id, message, files, err_msg, approval_id);
    }

    // Git commit com autor genérico
    let commit_res = run_git(
        &root,
        &[
            "-c", "user.name=Fluxora Agent",
            "-c", "user.email=agent@fluxora.ai",
            "commit",
            "-m",
            &message,
        ],
        DEFAULT_COMMAND_TIMEOUT,
    )?;
    
    if commit_res.exit_code != Some(0) {
        let err_msg = format!("git commit falhou: {}", commit_res.stderr);
        return handle_commit_failure(&app, &project_id, mission_id, patch_proposal_id, message, files, err_msg, approval_id);
    }

    // Pega hash
    let rev_res = run_git(&root, &["rev-parse", "HEAD"], DEFAULT_COMMAND_TIMEOUT)?;
    let commit_hash = if rev_res.exit_code == Some(0) {
        Some(rev_res.stdout.trim().to_string())
    } else {
        None
    };

    let state = app.state::<GitCommitsState>();
    let mut guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
    
    let record_id = if let Some(existing) = guard.iter_mut().find(|c| {
        c.project_id == project_id
            && c.mission_id == mission_id
            && c.patch_proposal_id == patch_proposal_id
            && c.status == "pending_approval"
    }) {
        existing.status = "committed".to_string();
        existing.branch = actual_branch.clone();
        existing.commit_hash = commit_hash.clone();
        existing.error = None;
        existing.id.clone()
    } else {
        let new_id = generate_commit_result_id();
        let record = GitCommitResultRecord {
            id: new_id.clone(),
            project_id: project_id.clone(),
            mission_id: mission_id.clone(),
            patch_proposal_id: patch_proposal_id.clone(),
            branch: actual_branch.clone(),
            commit_hash: commit_hash.clone(),
            message: message.clone(),
            files: files.clone(),
            status: "committed".to_string(),
            created_at: now.clone(),
            error: None,
            approval_id: approval_id.clone(),
        };
        guard.push(record);
        new_id
    };
    drop(guard);
    persist_commits(&app)?;

    emit_git_event(
        &app,
        "git/commit-completed",
        "info",
        &project_id,
        mission_id.as_deref(),
        patch_proposal_id.as_deref(),
        &format!("Commit local criado com sucesso: {}", message),
        Some(serde_json::json!({
            "branch": actual_branch,
            "commitHash": commit_hash,
            "filesCount": files.len(),
        })),
    );

    let final_guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
    let final_record = final_guard.iter().find(|c| c.id == record_id).cloned().unwrap();
    Ok(final_record)
}

pub fn git_get_commit_result(
    app: AppHandle,
    id: String,
) -> Result<Option<GitCommitResultRecord>, String> {
    let state = app.state::<GitCommitsState>();
    let guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
    Ok(guard.iter().find(|c| c.id == id).cloned())
}

pub fn git_list_mission_commits(
    app: AppHandle,
    mission_id: String,
) -> Result<Vec<GitCommitResultRecord>, String> {
    let state = app.state::<GitCommitsState>();
    let guard = state.commits.lock().map_err(|_| "Lock de commits poisoned.".to_string())?;
    let out = guard.iter().filter(|c| c.mission_id.as_deref() == Some(&mission_id)).cloned().collect();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_commit_path_validations() {
        assert!(!is_safe_commit_path(""));
        assert!(!is_safe_commit_path("/etc/passwd"));
        assert!(!is_safe_commit_path("\\\\server\\share"));
        assert!(!is_safe_commit_path("C:\\Windows"));
        assert!(!is_safe_commit_path("../outside.txt"));
        assert!(!is_safe_commit_path("foo/../../bar"));
        assert!(!is_safe_commit_path("node_modules/index.js"));
        assert!(!is_safe_commit_path(".git/config"));
        assert!(!is_safe_commit_path("vendor/autoload.php"));
        assert!(!is_safe_commit_path("dist/bundle.js"));
        assert!(!is_safe_commit_path("target/debug/app"));
        assert!(!is_safe_commit_path(".env"));
        assert!(!is_safe_commit_path(".env.local"));
        assert!(!is_safe_commit_path("secrets.json"));
        assert!(is_safe_commit_path("src/index.ts"));
        assert!(is_safe_commit_path("README.md"));
    }

    #[test]
    fn test_git_operations_in_temp_repo() {
        let temp_dir = std::env::current_dir().unwrap().join("target").join("test-git-repo");
        if temp_dir.exists() {
            let _ = std::fs::remove_dir_all(&temp_dir);
        }
        std::fs::create_dir_all(&temp_dir).unwrap();

        assert!(!git_dir_exists(&temp_dir));

        let init_res = run_git(&temp_dir, &["init"], Duration::from_secs(5));
        if init_res.is_ok() && init_res.as_ref().unwrap().exit_code == Some(0) {
            assert!(git_dir_exists(&temp_dir));
            
            let status = run_git(&temp_dir, &["status", "--porcelain"], Duration::from_secs(5)).unwrap();
            assert!(status.stdout.trim().is_empty());

            let file_path = temp_dir.join("test.txt");
            std::fs::write(&file_path, "hello world").unwrap();

            let status2 = run_git(&temp_dir, &["status", "--porcelain"], Duration::from_secs(5)).unwrap();
            assert!(status2.stdout.contains("?? test.txt"));

            let add_res = run_git(&temp_dir, &["add", "test.txt"], Duration::from_secs(5)).unwrap();
            assert_eq!(add_res.exit_code, Some(0));

            let commit_res = run_git(
                &temp_dir,
                &[
                    "-c", "user.name=Test Agent",
                    "-c", "user.email=test@agent.com",
                    "commit",
                    "-m",
                    "initial commit",
                ],
                Duration::from_secs(5)
            ).unwrap();
            assert_eq!(commit_res.exit_code, Some(0));

            let rev_res = run_git(&temp_dir, &["rev-parse", "HEAD"], Duration::from_secs(5)).unwrap();
            assert_eq!(rev_res.exit_code, Some(0));
            assert!(!rev_res.stdout.trim().is_empty());
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
