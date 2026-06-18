use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub stack: Vec<String>,
    pub status: String,
    pub current_agent: Option<String>,
    pub last_action: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub has_git: bool,
    pub relevant_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectPayload {
    pub name: String,
    pub path: String,
    pub stack: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectPayload {
    pub name: Option<String>,
    pub path: Option<String>,
    pub stack: Option<Vec<String>>,
    pub status: Option<String>,
    pub current_agent: Option<String>,
    pub last_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectDirectoryResult {
    pub canceled: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePathResult {
    pub valid: bool,
    pub exists: bool,
    pub is_directory: bool,
    pub has_git: bool,
    pub normalized_path: Option<String>,
    pub detected_stack: Vec<String>,
    pub relevant_files: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResponse {
    pub id: String,
    pub name: String,
    pub path: String,
    pub stack: Vec<String>,
    pub status: String,
    pub current_agent: Option<String>,
    pub last_action: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ProjectsFile {
    version: u32,
    projects: Vec<ProjectRecord>,
}

impl Default for ProjectsFile {
    fn default() -> Self {
        Self {
            version: 1,
            projects: Vec::new(),
        }
    }
}

pub fn list(app: &AppHandle) -> Result<Vec<ProjectResponse>, String> {
    let store = read_projects_file(app)?;
    Ok(store.projects.into_iter().map(map_project_response).collect())
}

pub fn get(app: &AppHandle, id: String) -> Result<Option<ProjectResponse>, String> {
    let store = read_projects_file(app)?;
    Ok(store
        .projects
        .into_iter()
        .find(|project| project.id == id)
        .map(map_project_response))
}

pub fn create(app: &AppHandle, payload: CreateProjectPayload) -> Result<ProjectResponse, String> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err("O nome do projeto não pode estar vazio.".to_string());
    }

    let mut store = read_projects_file(app)?;
    let validation = validate_path_internal(&payload.path);
    if !validation.valid {
        return Err(validation
            .error
            .unwrap_or_else(|| "Caminho do projeto é inválido.".to_string()));
    }

    let normalized_path = validation
        .normalized_path
        .clone()
        .ok_or_else(|| "Falha ao normalizar o caminho do projeto.".to_string())?;

    if store.projects.iter().any(|project| project.path == normalized_path) {
        return Err("Já existe um projeto cadastrado para este caminho.".to_string());
    }

    let now = iso_now();
    let stack = merge_stack(payload.stack, validation.detected_stack.clone());
    let project = ProjectRecord {
        id: generate_project_id(),
        name,
        path: normalized_path,
        stack,
        status: "idle".to_string(),
        current_agent: None,
        last_action: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: Some(now),
        has_git: validation.has_git,
        relevant_files: validation.relevant_files,
    };

    store.projects.push(project.clone());
    write_projects_file(app, &store)?;
    Ok(map_project_response(project))
}

pub fn update(
    app: &AppHandle,
    id: String,
    payload: UpdateProjectPayload,
) -> Result<ProjectResponse, String> {
    let mut store = read_projects_file(app)?;
    let project_index = store
        .projects
        .iter()
        .position(|project| project.id == id)
        .ok_or_else(|| format!("Projeto {} não encontrado.", id))?;

    let mut project = store.projects[project_index].clone();

    if let Some(name) = payload.name {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("O nome do projeto não pode estar vazio.".to_string());
        }
        project.name = trimmed;
    }

    let mut validation_result = None;
    if let Some(path) = payload.path {
        let validation = validate_path_internal(&path);
        if !validation.valid {
            return Err(validation
                .error
                .unwrap_or_else(|| "Caminho do projeto é inválido.".to_string()));
        }

        let normalized_path = validation
            .normalized_path
            .clone()
            .ok_or_else(|| "Falha ao normalizar o caminho do projeto.".to_string())?;

        if store
            .projects
            .iter()
            .any(|entry| entry.id != id && entry.path == normalized_path)
        {
            return Err("Já existe outro projeto cadastrado para este caminho.".to_string());
        }

        project.path = normalized_path;
        project.has_git = validation.has_git;
        project.relevant_files = validation.relevant_files.clone();
        validation_result = Some(validation);
    }

    if let Some(status) = payload.status {
        project.status = status;
    }

    project.current_agent = payload.current_agent.or(project.current_agent);
    project.last_action = payload.last_action.or(project.last_action);

    if let Some(stack) = payload.stack {
        let detected_stack = validation_result
            .as_ref()
            .map(|result| result.detected_stack.clone())
            .unwrap_or_default();
        project.stack = merge_stack(stack, detected_stack);
    } else if let Some(validation) = validation_result {
        project.stack = merge_stack(project.stack.clone(), validation.detected_stack);
    }

    project.updated_at = iso_now();
    store.projects[project_index] = project.clone();
    write_projects_file(app, &store)?;
    Ok(map_project_response(project))
}

pub fn remove(app: &AppHandle, id: String) -> Result<(), String> {
    let mut store = read_projects_file(app)?;
    let before = store.projects.len();
    store.projects.retain(|project| project.id != id);
    if store.projects.len() == before {
        return Err(format!("Projeto {} não encontrado.", id));
    }
    write_projects_file(app, &store)?;
    Ok(())
}

pub fn validate_path(project_path: String) -> ValidatePathResult {
    validate_path_internal(&project_path)
}

/// Resolve o `project_id` para o `PathBuf` cadastrado na store.
///
/// Retorna `Err` se o projeto não existir. Usado pelos módulos
/// `git` e `filesystem` para garantir que operações sensíveis
/// operem apenas dentro de projetos cadastrados.
pub fn find_project_path(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let store = read_projects_file(app)?;
    let project = store
        .projects
        .iter()
        .find(|entry| entry.id == project_id)
        .ok_or_else(|| format!("Projeto {project_id} não encontrado."))?;
    Ok(PathBuf::from(&project.path))
}

fn map_project_response(project: ProjectRecord) -> ProjectResponse {
    ProjectResponse {
        id: project.id,
        name: project.name,
        path: project.path,
        stack: project.stack,
        status: project.status,
        current_agent: project.current_agent,
        last_action: project.last_action,
        created_at: project.created_at,
        updated_at: project.updated_at,
    }
}

fn projects_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("projects.json"))
}

fn ensure_projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = projects_file_path(app)?;
    let parent = file_path
        .parent()
        .ok_or_else(|| "Não foi possível resolver o diretório de persistência dos projetos.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_projects_file(app: &AppHandle) -> Result<ProjectsFile, String> {
    let file_path = ensure_projects_dir(app)?;
    if !file_path.exists() {
        return Ok(ProjectsFile::default());
    }

    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;

    if raw.trim().is_empty() {
        return Ok(ProjectsFile::default());
    }

    serde_json::from_str::<ProjectsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de projetos inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_projects_file(app: &AppHandle, store: &ProjectsFile) -> Result<(), String> {
    let file_path = ensure_projects_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar os projetos: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

fn validate_path_internal(project_path: &str) -> ValidatePathResult {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return ValidatePathResult {
            valid: false,
            exists: false,
            is_directory: false,
            has_git: false,
            normalized_path: None,
            detected_stack: Vec::new(),
            relevant_files: Vec::new(),
            error: Some("O caminho não pode estar vazio.".to_string()),
        };
    }

    let raw_path = PathBuf::from(trimmed);
    let absolute_path = if raw_path.is_absolute() {
        raw_path
    } else {
        match std::env::current_dir() {
            Ok(current_dir) => current_dir.join(raw_path),
            Err(error) => {
                return ValidatePathResult {
                    valid: false,
                    exists: false,
                    is_directory: false,
                    has_git: false,
                    normalized_path: None,
                    detected_stack: Vec::new(),
                    relevant_files: Vec::new(),
                    error: Some(format!("Não foi possível resolver o diretório atual: {error}")),
                }
            }
        }
    };

    let exists = absolute_path.exists();
    if !exists {
        return ValidatePathResult {
            valid: false,
            exists: false,
            is_directory: false,
            has_git: false,
            normalized_path: Some(absolute_path.to_string_lossy().to_string()),
            detected_stack: Vec::new(),
            relevant_files: Vec::new(),
            error: Some("O caminho informado não existe.".to_string()),
        };
    }

    let metadata = match fs::metadata(&absolute_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return ValidatePathResult {
                valid: false,
                exists: true,
                is_directory: false,
                has_git: false,
                normalized_path: Some(absolute_path.to_string_lossy().to_string()),
                detected_stack: Vec::new(),
                relevant_files: Vec::new(),
                error: Some(format!("Não foi possível ler os metadados do caminho: {error}")),
            }
        }
    };

    if !metadata.is_dir() {
        return ValidatePathResult {
            valid: false,
            exists: true,
            is_directory: false,
            has_git: false,
            normalized_path: Some(absolute_path.to_string_lossy().to_string()),
            detected_stack: Vec::new(),
            relevant_files: Vec::new(),
            error: Some("O caminho informado não é um diretório.".to_string()),
        };
    }

    if let Err(error) = fs::read_dir(&absolute_path) {
        return ValidatePathResult {
            valid: false,
            exists: true,
            is_directory: true,
            has_git: false,
            normalized_path: Some(absolute_path.to_string_lossy().to_string()),
            detected_stack: Vec::new(),
            relevant_files: Vec::new(),
            error: Some(format!("Sem permissão para ler o diretório: {error}")),
        };
    }

    let normalized_path = absolute_path
        .canonicalize()
        .unwrap_or_else(|_| absolute_path.clone())
        .to_string_lossy()
        .to_string();
    let (detected_stack, relevant_files, has_git) = detect_stack(&absolute_path);

    ValidatePathResult {
        valid: true,
        exists: true,
        is_directory: true,
        has_git,
        normalized_path: Some(normalized_path),
        detected_stack,
        relevant_files,
        error: None,
    }
}

fn detect_stack(root: &Path) -> (Vec<String>, Vec<String>, bool) {
    let mut stack = Vec::new();
    let mut relevant_files = Vec::new();

    let composer_json = root.join("composer.json");
    let package_json = root.join("package.json");
    let pubspec_yaml = root.join("pubspec.yaml");
    let cargo_toml = root.join("Cargo.toml");
    let go_mod = root.join("go.mod");
    let pyproject = root.join("pyproject.toml");
    let requirements = root.join("requirements.txt");
    let tsconfig = root.join("tsconfig.json");
    let git_dir = root.join(".git");

    if composer_json.exists() {
        push_unique(&mut relevant_files, "composer.json");
        push_unique(&mut stack, "PHP");
        if let Ok(content) = fs::read_to_string(&composer_json) {
            if content.contains("\"laravel/framework\"") {
                push_unique(&mut stack, "Laravel");
            }
            if content.contains("\"livewire/livewire\"") {
                push_unique(&mut stack, "Livewire");
            }
        }
    }

    if package_json.exists() {
        push_unique(&mut relevant_files, "package.json");
        push_unique(&mut stack, "Node.js");
        if let Ok(content) = fs::read_to_string(&package_json) {
            detect_package_json_stack(&content, &mut stack);
        }
    }

    if tsconfig.exists() {
        push_unique(&mut relevant_files, "tsconfig.json");
        push_unique(&mut stack, "TypeScript");
    }

    if pubspec_yaml.exists() {
        push_unique(&mut relevant_files, "pubspec.yaml");
        push_unique(&mut stack, "Flutter");
        push_unique(&mut stack, "Dart");
    }

    if cargo_toml.exists() {
        push_unique(&mut relevant_files, "Cargo.toml");
        push_unique(&mut stack, "Rust");
    }

    if go_mod.exists() {
        push_unique(&mut relevant_files, "go.mod");
        push_unique(&mut stack, "Go");
    }

    if pyproject.exists() {
        push_unique(&mut relevant_files, "pyproject.toml");
        push_unique(&mut stack, "Python");
    }

    if requirements.exists() {
        push_unique(&mut relevant_files, "requirements.txt");
        push_unique(&mut stack, "Python");
    }

    let has_git = git_dir.exists();
    if has_git {
        push_unique(&mut relevant_files, ".git");
        push_unique(&mut stack, "Git");
    }

    (stack, relevant_files, has_git)
}

fn detect_package_json_stack(content: &str, stack: &mut Vec<String>) {
    let parsed = match serde_json::from_str::<Value>(content) {
        Ok(value) => value,
        Err(_) => {
            push_unique(stack, "JavaScript");
            return;
        }
    };

    let Some(object) = parsed.as_object() else {
        push_unique(stack, "JavaScript");
        return;
    };

    let mut dependencies = Vec::new();
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(Value::Object(map)) = object.get(key) {
            for dep in map.keys() {
                dependencies.push(dep.to_lowercase());
            }
        }
    }

    if dependencies.iter().any(|dep| dep == "typescript") {
        push_unique(stack, "TypeScript");
    } else {
        push_unique(stack, "JavaScript");
    }

    if dependencies.iter().any(|dep| dep == "react") {
        push_unique(stack, "React");
    }
    if dependencies.iter().any(|dep| dep == "next") {
        push_unique(stack, "Next.js");
    }
    if dependencies.iter().any(|dep| dep == "vue") {
        push_unique(stack, "Vue");
    }
    if dependencies.iter().any(|dep| dep == "nuxt" || dep == "nuxt3") {
        push_unique(stack, "Nuxt");
    }
    if dependencies.iter().any(|dep| dep == "svelte") {
        push_unique(stack, "Svelte");
    }
    if dependencies.iter().any(|dep| dep == "@angular/core") {
        push_unique(stack, "Angular");
    }
    if dependencies.iter().any(|dep| dep == "vite") {
        push_unique(stack, "Vite");
    }
}

fn merge_stack(manual: Vec<String>, detected: Vec<String>) -> Vec<String> {
    let mut merged = Vec::new();
    for item in manual {
        push_unique(&mut merged, item.trim());
    }
    for item in detected {
        push_unique(&mut merged, item.trim());
    }
    merged
}

fn push_unique(list: &mut Vec<String>, value: &str) {
    if value.is_empty() {
        return;
    }
    if !list.iter().any(|entry| entry.eq_ignore_ascii_case(value)) {
        list.push(value.to_string());
    }
}

fn iso_now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn generate_project_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("proj-{millis}")
}
