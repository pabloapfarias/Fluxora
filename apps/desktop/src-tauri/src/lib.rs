mod events;
mod filesystem;
mod git;
mod missions;
mod patches;
mod projects;
mod providers;
mod voice;
mod approvals;
mod permissions;

use events::{
    AppEventsState, EmitDiagnosticInput, FluxoraEvent, ListRecentInput,
};
use filesystem::{
    FsListOptions, FsReadOptions, FsSearchOptions, FsTreeOptions, FsTreeNode, FsEntry, FsReadResult,
};
use git::{
    GitAppInfo, GitChangedFile, GitCommitInfo, GitCommitsOptions, GitSummary,
};
use missions::{
    CancelMissionJobPayload, CreateMissionPayload, MissionJobRecord, MissionLogRecord,
    MissionRecord, RunMissionPayload,
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
use permissions::{
    PermissionCheckPayload, PermissionCheckResultRecord, ProjectExecutionPolicyRecord,
    UpdatePolicyPayload,
};
use approvals::{
    CreateApprovalPayload, ExecutionApprovalRecord, RejectApprovalPayload, CancelApprovalPayload,
};
use patches::{PatchFileChangeRecord, PatchProposalRecord};
use serde::{Deserialize, Serialize};
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

// ---------------------------------------------------------------------------
// Missions (PR 008)
// ---------------------------------------------------------------------------

#[tauri::command]
fn missions_ping() -> String {
    missions::missions_ping()
}

#[tauri::command]
fn missions_list(app: AppHandle) -> Result<Vec<MissionRecord>, String> {
    missions::missions_list(app)
}

#[tauri::command]
fn missions_get(app: AppHandle, id: String) -> Result<Option<MissionRecord>, String> {
    missions::missions_get(app, id)
}

#[tauri::command]
fn missions_create(
    app: AppHandle,
    payload: CreateMissionPayload,
) -> Result<MissionRecord, String> {
    missions::missions_create(app, payload)
}

#[tauri::command]
fn missions_run(
    app: AppHandle,
    payload: RunMissionPayload,
) -> Result<MissionRecord, String> {
    missions::missions_run(app, payload)
}

#[tauri::command]
fn missions_create_and_run(
    app: AppHandle,
    payload: CreateMissionPayload,
) -> Result<MissionRecord, String> {
    missions::missions_create_and_run(app, payload)
}

#[tauri::command]
fn missions_list_logs(
    app: AppHandle,
    mission_id: String,
) -> Result<Vec<MissionLogRecord>, String> {
    missions::missions_list_logs(app, mission_id)
}

#[tauri::command]
fn missions_clear(app: AppHandle) -> Result<(), String> {
    missions::missions_clear(app)
}

// ---------------------------------------------------------------------------
// Permissions (PR 009)
// ---------------------------------------------------------------------------

#[tauri::command]
fn permissions_ping() -> String {
    permissions::permissions_ping()
}

#[tauri::command]
fn permissions_get_project_policy(
    app: AppHandle,
    project_id: String,
) -> Result<ProjectExecutionPolicyRecord, String> {
    permissions::permissions_get_project_policy(app, project_id)
}

#[tauri::command]
fn permissions_update_project_policy(
    app: AppHandle,
    project_id: String,
    payload: UpdatePolicyPayload,
) -> Result<ProjectExecutionPolicyRecord, String> {
    permissions::permissions_update_project_policy(app, project_id, payload)
}

#[tauri::command]
fn permissions_list_policies(
    app: AppHandle,
) -> Result<Vec<ProjectExecutionPolicyRecord>, String> {
    permissions::permissions_list_policies(app)
}

#[tauri::command]
fn permissions_reset_project_policy(
    app: AppHandle,
    project_id: String,
) -> Result<ProjectExecutionPolicyRecord, String> {
    permissions::permissions_reset_project_policy(app, project_id)
}

#[tauri::command]
fn permissions_check(
    app: AppHandle,
    payload: PermissionCheckPayload,
) -> Result<PermissionCheckResultRecord, String> {
    permissions::permissions_check(app, payload)
}

// ---------------------------------------------------------------------------
// Approvals (PR 009)
// ---------------------------------------------------------------------------

#[tauri::command]
fn approvals_ping() -> String {
    approvals::approvals_ping()
}

#[tauri::command]
fn approvals_list(app: AppHandle) -> Result<Vec<ExecutionApprovalRecord>, String> {
    approvals::approvals_list(app)
}

#[tauri::command]
fn approvals_get(
    app: AppHandle,
    id: String,
) -> Result<Option<ExecutionApprovalRecord>, String> {
    approvals::approvals_get(app, id)
}

#[tauri::command]
fn approvals_create(
    app: AppHandle,
    payload: CreateApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    approvals::approvals_create(app, payload)
}

#[tauri::command]
fn approvals_approve(
    app: AppHandle,
    id: String,
) -> Result<ExecutionApprovalRecord, String> {
    approvals::approvals_approve(app, id)
}

#[tauri::command]
fn approvals_reject(
    app: AppHandle,
    payload: RejectApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    approvals::approvals_reject(app, payload)
}

#[tauri::command]
fn approvals_cancel(
    app: AppHandle,
    payload: CancelApprovalPayload,
) -> Result<ExecutionApprovalRecord, String> {
    approvals::approvals_cancel(app, payload)
}

#[tauri::command]
fn approvals_list_actionable(
    app: AppHandle,
) -> Result<Vec<ExecutionApprovalRecord>, String> {
    approvals::approvals_list_actionable(app)
}

// ---------------------------------------------------------------------------
// Scheduler (PR 009)
// ---------------------------------------------------------------------------

#[tauri::command]
fn scheduler_ping() -> String {
    missions::scheduler_ping()
}

#[tauri::command]
fn scheduler_list_jobs(app: AppHandle) -> Result<Vec<MissionJobRecord>, String> {
    missions::scheduler_list_jobs(app)
}

#[tauri::command]
fn scheduler_get_job(
    app: AppHandle,
    job_id: String,
) -> Result<Option<MissionJobRecord>, String> {
    missions::scheduler_get_job(app, job_id)
}

#[tauri::command]
fn scheduler_cancel_job(
    app: AppHandle,
    payload: CancelMissionJobPayload,
) -> Result<Option<MissionJobRecord>, String> {
    missions::scheduler_cancel_job(app, payload)
}

// ---------------------------------------------------------------------------
// Patches (PR 010)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePatchProposalPayload {
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub mission_id: String,
    pub project_id: String,
    pub files: Vec<PatchFileChangeRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyPatchPayload {
    pub proposal_id: String,
    #[serde(default)]
    pub approval_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectPatchPayload {
    pub id: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[tauri::command]
fn patches_ping() -> String {
    patches::patches_ping()
}

#[tauri::command]
fn patches_list(app: AppHandle) -> Result<Vec<PatchProposalRecord>, String> {
    patches::patches_list(app)
}

#[tauri::command]
fn patches_get(
    app: AppHandle,
    id: String,
) -> Result<Option<PatchProposalRecord>, String> {
    patches::patches_get(app, id)
}

#[tauri::command]
fn patches_list_by_mission(
    app: AppHandle,
    mission_id: String,
) -> Result<Vec<PatchProposalRecord>, String> {
    patches::patches_list_by_mission(app, mission_id)
}

#[tauri::command]
fn patches_create(
    app: AppHandle,
    payload: CreatePatchProposalPayload,
) -> Result<PatchProposalRecord, String> {
    patches::patches_create(
        app,
        payload.title,
        payload.summary,
        payload.mission_id,
        payload.project_id,
        payload.files,
    )
}

#[tauri::command]
fn patches_apply(
    app: AppHandle,
    payload: ApplyPatchPayload,
) -> Result<PatchProposalRecord, String> {
    patches::patches_apply(app, payload.proposal_id, payload.approval_id)
}

#[tauri::command]
fn patches_reject(
    app: AppHandle,
    payload: RejectPatchPayload,
) -> Result<PatchProposalRecord, String> {
    patches::patches_reject(app, payload.id, payload.note)
}

#[tauri::command]
fn patches_get_changed_files(
    app: AppHandle,
    workflow_run_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    patches::patches_get_changed_files(app, workflow_run_id)
}

#[tauri::command]
fn patches_get_file_diff(
    app: AppHandle,
    workflow_run_id: String,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    patches::patches_get_file_diff(app, workflow_run_id, file_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppEventsState::new())
        .manage(VoiceState::new())
        .manage(providers::ProvidersState::new())
        .manage(missions::MissionsState::new())
        .manage(missions::MissionJobsState::new())
        .manage(permissions::PermissionsState::new())
        .manage(approvals::ApprovalsState::new())
        .manage(patches::PatchesState::new())
        .setup(|app| {
            // PR 006 — Carrega `voice.json` salvo no app data dir.
            // Falhas de I/O são logadas e descartadas; o app
            // continua com defaults até o usuário salvar pela UI.
            let handle = app.handle().clone();
            voice::load_settings_on_startup(&handle);

            // PR 007 — Carrega `providers.json` salvo no app data
            // dir. Mesma estratégia de tolerância a falhas.
            providers::load_providers_on_startup(&handle);

            // PR 008 — Carrega `missions.json` salvo no app data
            // dir. Mesma estratégia de tolerância a falhas.
            missions::load_missions_on_startup(&handle);

            // PR 009 — Carrega `permissions.json` salvo no app data
            // dir (estado vazio até a primeira chamada de
            // `getProjectPolicy`).
            permissions::load_permissions_on_startup(&handle);

            // PR 009 — Carrega `approvals.json` salvo no app data
            // dir (estado vazio até a primeira criação).
            approvals::load_approvals_on_startup(&handle);

            // PR 010 — Carrega `patches.json` salvo no app data
            // dir (estado vazio até a primeira proposta).
            patches::load_patches_on_startup(&handle);

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
            providers_chat_once,
            missions_ping,
            missions_list,
            missions_get,
            missions_create,
            missions_run,
            missions_create_and_run,
            missions_list_logs,
            missions_clear,
            permissions_ping,
            permissions_get_project_policy,
            permissions_update_project_policy,
            permissions_list_policies,
            permissions_reset_project_policy,
            permissions_check,
            approvals_ping,
            approvals_list,
            approvals_get,
            approvals_create,
            approvals_approve,
            approvals_reject,
            approvals_cancel,
            approvals_list_actionable,
            scheduler_ping,
            scheduler_list_jobs,
            scheduler_get_job,
            scheduler_cancel_job,
            patches_ping,
            patches_list,
            patches_get,
            patches_list_by_mission,
            patches_create,
            patches_apply,
            patches_reject,
            patches_get_changed_files,
            patches_get_file_diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
