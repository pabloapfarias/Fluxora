mod filesystem;
mod git;
mod projects;

use filesystem::{
    FsListOptions, FsReadOptions, FsSearchOptions, FsTreeOptions, FsTreeNode, FsEntry, FsReadResult,
};
use git::{
    GitAppInfo, GitChangedFile, GitCommitInfo, GitCommitsOptions, GitSummary,
};
use projects::{CreateProjectPayload, SelectDirectoryResult, UpdateProjectPayload};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
    tauri: bool,
    platform: String,
}

#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Fluxora".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri: true,
        platform: std::env::consts::OS.into(),
    }
}

#[tauri::command]
async fn projects_select_directory(app: AppHandle) -> Result<SelectDirectoryResult, String> {
    let selected = app.dialog().file().blocking_pick_folder();
    let path = selected.and_then(|file_path| file_path.into_path().ok());
    Ok(SelectDirectoryResult {
        canceled: path.is_none(),
        path: path.map(|value| value.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn projects_list(app: AppHandle) -> Result<Vec<projects::ProjectResponse>, String> {
    projects::list(&app)
}

#[tauri::command]
fn projects_get(app: AppHandle, id: String) -> Result<Option<projects::ProjectResponse>, String> {
    projects::get(&app, id)
}

#[tauri::command]
fn projects_create(app: AppHandle, payload: CreateProjectPayload) -> Result<projects::ProjectResponse, String> {
    projects::create(&app, payload)
}

#[tauri::command]
fn projects_update(
    app: AppHandle,
    id: String,
    payload: UpdateProjectPayload,
) -> Result<projects::ProjectResponse, String> {
    projects::update(&app, id, payload)
}

#[tauri::command]
fn projects_remove(app: AppHandle, id: String) -> Result<(), String> {
    projects::remove(&app, id)
}

#[tauri::command]
fn projects_validate_path(project_path: String) -> projects::ValidatePathResult {
    projects::validate_path(project_path)
}

// ---------------------------------------------------------------------------
// Filesystem (PR 003)
// ---------------------------------------------------------------------------

#[tauri::command]
fn fs_list_files(
    app: AppHandle,
    project_id: String,
    relative_path: Option<String>,
    options: Option<FsListOptions>,
) -> Result<Vec<FsEntry>, String> {
    filesystem::fs_list_files(app, project_id, relative_path, options)
}

#[tauri::command]
fn fs_read_file(
    app: AppHandle,
    project_id: String,
    relative_path: String,
    options: Option<FsReadOptions>,
) -> Result<FsReadResult, String> {
    filesystem::fs_read_file(app, project_id, relative_path, options)
}

#[tauri::command]
fn fs_get_file_info(
    app: AppHandle,
    project_id: String,
    relative_path: Option<String>,
) -> Result<Option<FsEntry>, String> {
    filesystem::fs_get_file_info(app, project_id, relative_path)
}

#[tauri::command]
fn fs_search_files(
    app: AppHandle,
    project_id: String,
    query: String,
    options: Option<FsSearchOptions>,
) -> Result<Vec<FsEntry>, String> {
    filesystem::fs_search_files(app, project_id, query, options)
}

#[tauri::command]
fn fs_list_project_tree(
    app: AppHandle,
    project_id: String,
    options: Option<FsTreeOptions>,
) -> Result<FsTreeNode, String> {
    filesystem::fs_list_project_tree(app, project_id, options)
}

// ---------------------------------------------------------------------------
// Git (PR 003)
// ---------------------------------------------------------------------------

#[tauri::command]
fn git_is_repo(app: AppHandle, project_id: String) -> Result<bool, String> {
    git::git_is_repo(app, project_id)
}

#[tauri::command]
fn git_current_branch(
    app: AppHandle,
    project_id: String,
) -> Result<Option<String>, String> {
    git::git_current_branch(app, project_id)
}

#[tauri::command]
fn git_status(app: AppHandle, project_id: String) -> Result<Vec<GitChangedFile>, String> {
    git::git_status(app, project_id)
}

#[tauri::command]
fn git_recent_commits(
    app: AppHandle,
    project_id: String,
    options: Option<GitCommitsOptions>,
) -> Result<Vec<GitCommitInfo>, String> {
    git::git_recent_commits(app, project_id, options)
}

#[tauri::command]
fn git_diff(app: AppHandle, project_id: String, file_path: String) -> Result<String, String> {
    git::git_diff(app, project_id, file_path)
}

#[tauri::command]
fn git_summary(app: AppHandle, project_id: String) -> Result<GitSummary, String> {
    git::git_summary(app, project_id)
}

#[tauri::command]
fn app_get_git_info() -> GitAppInfo {
    git::app_get_git_info()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_app_info,
            projects_select_directory,
            projects_list,
            projects_get,
            projects_create,
            projects_update,
            projects_remove,
            projects_validate_path,
            fs_list_files,
            fs_read_file,
            fs_get_file_info,
            fs_search_files,
            fs_list_project_tree,
            git_is_repo,
            git_current_branch,
            git_status,
            git_recent_commits,
            git_diff,
            git_summary,
            app_get_git_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
