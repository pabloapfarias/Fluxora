// PR 003 — Git backend
//
// Comandos Tauri para inspeção segura de repositórios Git em
// projetos cadastrados. Implementa apenas leitura/inspeção
// (status, branch, diff, commits recentes). Nenhuma operação
// destrutiva (commit, push, pull, checkout, reset) é exposta
// nesta PR.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

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
