mod events;
mod filesystem;
mod git;
mod projects;
mod providers;
mod voice;

use events::{
    AppEventsState, EmitDiagnosticInput, FluxoraEvent, ListRecentInput,
};
use filesystem::{
    FsListOptions, FsReadOptions, FsSearchOptions, FsTreeOptions, FsTreeNode, FsEntry, FsReadResult,
};
use git::{
    GitAppInfo, GitChangedFile, GitCommitInfo, GitCommitsOptions, GitSummary,
};
use projects::{CreateProjectPayload, SelectDirectoryResult, UpdateProjectPayload};
use providers::{
    ChatOncePayload, ChatOnceResultPayload, CreateProviderPayload, ProviderTestResultPayload,
    StoredProvider, UpdateProviderPayload,
};
use voice::{
    TranscribePayload, UpdateSettingsPayload, VoiceProviderTestResult, VoiceState,
    VoiceTranscriptionResult,
};
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
    let response = projects::create(&app, payload)?;
    // Emite o evento real `project/updated` no barramento.
    // O frontend decide se quer reagir (a UI atual ignora por enquanto).
    let event = events::build_event(
        "project/updated",
        "project",
        "info",
        Some(format!("Projeto criado: {}", response.name)),
        Some(response.id.clone()),
        None,
        None,
        Some(serde_json::json!({ "action": "created", "project": &response })),
    );
    events::emit_to_app(&app, event);
    Ok(response)
}

#[tauri::command]
fn projects_update(
    app: AppHandle,
    id: String,
    payload: UpdateProjectPayload,
) -> Result<projects::ProjectResponse, String> {
    let response = projects::update(&app, id, payload)?;
    let event = events::build_event(
        "project/updated",
        "project",
        "info",
        Some(format!("Projeto atualizado: {}", response.name)),
        Some(response.id.clone()),
        None,
        None,
        Some(serde_json::json!({ "action": "updated", "project": &response })),
    );
    events::emit_to_app(&app, event);
    Ok(response)
}

#[tauri::command]
fn projects_remove(app: AppHandle, id: String) -> Result<(), String> {
    projects::remove(&app, id.clone())?;
    // `remove` não devolve o projeto; emitimos apenas com o `id`.
    let event = events::build_event(
        "project/updated",
        "project",
        "info",
        Some(format!("Projeto removido: {id}")),
        Some(id),
        None,
        None,
        Some(serde_json::json!({ "action": "removed" })),
    );
    events::emit_to_app(&app, event);
    Ok(())
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

// ---------------------------------------------------------------------------
// Voice / Whisper (PR 006)
// ---------------------------------------------------------------------------

#[tauri::command]
fn voice_ping() -> String {
    voice::voice_ping()
}

#[tauri::command]
fn voice_get_settings(app: AppHandle) -> Result<voice::StoredAudioSettings, String> {
    voice::voice_get_settings(app)
}

#[tauri::command]
fn voice_update_settings(
    app: AppHandle,
    payload: UpdateSettingsPayload,
) -> Result<voice::StoredAudioSettings, String> {
    voice::voice_update_settings(app, payload)
}

#[tauri::command]
fn voice_transcribe(
    app: AppHandle,
    payload: TranscribePayload,
) -> Result<VoiceTranscriptionResult, String> {
    voice::voice_transcribe(app, payload)
}

#[tauri::command]
fn voice_test_provider(app: AppHandle) -> Result<VoiceProviderTestResult, String> {
    voice::voice_test_provider(app)
}

// ---------------------------------------------------------------------------
// Events (PR 005)
// ---------------------------------------------------------------------------

#[tauri::command]
fn events_ping() -> String {
    events::events_ping()
}

#[tauri::command]
fn events_emit_diagnostic(
    app: AppHandle,
    input: EmitDiagnosticInput,
) -> Result<FluxoraEvent, String> {
    events::events_emit_diagnostic(app, input)
}

#[tauri::command]
fn events_list_recent(
    app: AppHandle,
    input: Option<ListRecentInput>,
) -> Result<Vec<FluxoraEvent>, String> {
    events::events_list_recent(app, input)
}

#[tauri::command]
fn events_clear_recent(app: AppHandle) -> Result<(), String> {
    events::events_clear_recent(app)
}

// ---------------------------------------------------------------------------
// Providers (PR 007)
// ---------------------------------------------------------------------------

#[tauri::command]
fn providers_ping() -> String {
    providers::providers_ping()
}

#[tauri::command]
fn providers_list(app: AppHandle) -> Result<Vec<StoredProvider>, String> {
    providers::providers_list(app)
}

#[tauri::command]
fn providers_get(app: AppHandle, id: String) -> Result<Option<StoredProvider>, String> {
    providers::providers_get(app, id)
}

#[tauri::command]
fn providers_create(
    app: AppHandle,
    payload: CreateProviderPayload,
) -> Result<StoredProvider, String> {
    providers::providers_create(app, payload)
}

#[tauri::command]
fn providers_update(
    app: AppHandle,
    id: String,
    payload: UpdateProviderPayload,
) -> Result<StoredProvider, String> {
    providers::providers_update(app, id, payload)
}

#[tauri::command]
fn providers_remove(app: AppHandle, id: String) -> Result<(), String> {
    providers::providers_remove(app, id)
}

#[tauri::command]
fn providers_test(
    app: AppHandle,
    id: String,
) -> Result<ProviderTestResultPayload, String> {
    providers::providers_test(app, id)
}

#[tauri::command]
fn providers_list_models(
    app: AppHandle,
    id: String,
) -> Result<Vec<providers::ModelInfo>, String> {
    providers::providers_list_models(app, id)
}

#[tauri::command]
fn providers_chat_once(
    app: AppHandle,
    payload: ChatOncePayload,
) -> Result<ChatOnceResultPayload, String> {
    providers::providers_chat_once(app, payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppEventsState::new())
        .manage(VoiceState::new())
        .manage(providers::ProvidersState::new())
        .setup(|app| {
            // PR 006 — Carrega `voice.json` salvo no app data dir.
            // Falhas de I/O são logadas e descartadas; o app
            // continua com defaults até o usuário salvar pela UI.
            let handle = app.handle().clone();
            voice::load_settings_on_startup(&handle);

            // PR 007 — Carrega `providers.json` salvo no app data
            // dir. Mesma estratégia de tolerância a falhas.
            providers::load_providers_on_startup(&handle);

            // Emite o evento `app/ready` no barramento assim que o
            // shell Tauri está pronto. Este é o primeiro evento real
            // que a UI pode observar via `events.subscribe`.
            let ready = events::build_event(
                "app/ready",
                "app",
                "info",
                Some("FluxoraV1 shell inicializado.".to_string()),
                None,
                None,
                None,
                Some(serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "channel": events::FLUXORA_EVENT_CHANNEL,
                })),
            );
            events::emit_to_app(&handle, ready);
            Ok(())
        })
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
            app_get_git_info,
            voice_ping,
            voice_get_settings,
            voice_update_settings,
            voice_transcribe,
            voice_test_provider,
            events_ping,
            events_emit_diagnostic,
            events_list_recent,
            events_clear_recent,
            providers_ping,
            providers_list,
            providers_get,
            providers_create,
            providers_update,
            providers_remove,
            providers_test,
            providers_list_models,
            providers_chat_once
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
