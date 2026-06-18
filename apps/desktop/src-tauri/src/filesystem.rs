// PR 003 — Filesystem backend
//
// Comandos Tauri para leitura segura do filesystem de projetos cadastrados.
// Todas as operações são restritas a projetos presentes na store gerada
// por `projects.rs`, com normalização de caminhos e proteção contra
// path traversal.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::projects;

// Limites padrão — todos overridáveis via argumento do comando.
const DEFAULT_MAX_ENTRIES: usize = 500;
const HARD_MAX_ENTRIES: usize = 5_000;
const DEFAULT_MAX_BYTES: u64 = 256 * 1024; // 256 KiB
const HARD_MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB
const DEFAULT_MAX_DEPTH: usize = 4;
const HARD_MAX_DEPTH: usize = 8;
const DEFAULT_MAX_RESULTS: usize = 100;
const HARD_MAX_RESULTS: usize = 1_000;

/// Diretórios considerados "pesados" e ignorados por padrão
/// em listagens e árvores. O objetivo é evitar ler
/// `node_modules`, `target`, `.next` e similares durante
/// inspeções simples.
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "vendor",
    "dist",
    "build",
    ".next",
    "target",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    /// Caminho relativo ao root do projeto, sempre com `/`.
    pub path: String,
    pub name: String,
    pub kind: FsEntryKind,
    pub size_bytes: u64,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FsEntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResult {
    pub path: String,
    pub size_bytes: u64,
    /// Bytes efetivamente lidos (pode ser menor que `size_bytes`
    /// quando o limite é atingido).
    pub read_bytes: u64,
    pub truncated: bool,
    /// Conteúdo decodificado como UTF-8. Vazio quando o arquivo
    /// é binário ou não pôde ser decodificado.
    pub content: String,
    /// `true` quando o conteúdo parece ser binário
    /// (heurística: presença de NUL nos primeiros 8 KiB).
    pub is_binary: bool,
    /// `true` quando o arquivo existe e pôde ser lido.
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTreeNode {
    pub path: String,
    pub name: String,
    pub kind: FsEntryKind,
    pub children: Vec<FsTreeNode>,
    /// `true` quando a subárvore foi truncada por limites de
    /// profundidade ou número de entradas.
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListOptions {
    pub max_entries: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadOptions {
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchOptions {
    pub max_results: Option<usize>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTreeOptions {
    pub max_depth: Option<usize>,
    pub max_entries: Option<usize>,
}

// ---------------------------------------------------------------------------
// Helpers de segurança de path
// ---------------------------------------------------------------------------

/// Resolve o `project_id` para o diretório root canônico.
fn project_root(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let raw = projects::find_project_path(app, project_id)?;
    let metadata = fs::metadata(&raw).map_err(|error| {
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
    let canonical = raw.canonicalize().map_err(|error| {
        format!(
            "Não foi possível canonicalizar o caminho do projeto {project_id} ({}): {error}",
            raw.display()
        )
    })?;
    Ok(canonical)
}

/// Valida que `relative_path` (vindo do frontend) é seguro em relação
/// ao root do projeto. Rejeita:
///   - caminhos absolutos
///   - tentativas de traversal via `..`
///   - caminhos que, após canonicalização, saem do root
fn resolve_within_root(
    root: &Path,
    relative_path: Option<&str>,
) -> Result<PathBuf, String> {
    let raw = relative_path.unwrap_or("").trim();
    if raw.is_empty() {
        return Ok(root.to_path_buf());
    }

    let provided = PathBuf::from(raw);
    if provided.is_absolute() {
        return Err(format!(
            "Caminho absoluto não permitido dentro de projeto: {raw}"
        ));
    }
    for component in provided.components() {
        match component {
            Component::ParentDir => {
                return Err(format!(
                    "Caminho com '..' não permitido dentro de projeto: {raw}"
                ));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("Caminho inválido: {raw}"));
            }
            _ => {}
        }
    }

    let candidate = root.join(&provided);
    // Garante que o caminho resolvido continua dentro do root
    // usando comparação canônica quando possível.
    let canonical_root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let canonical_candidate = candidate.canonicalize().unwrap_or(candidate.clone());
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!(
            "Caminho fora do projeto após resolução: {raw}"
        ));
    }
    Ok(canonical_candidate)
}

fn is_ignored_dir_name(name: &str) -> bool {
    IGNORED_DIR_NAMES.iter().any(|entry| *entry == name)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Heurística simples: considera binário se houver NUL nos primeiros
/// 8 KiB lidos.
fn looks_binary(bytes: &[u8]) -> bool {
    let limit = bytes.len().min(8 * 1024);
    bytes[..limit].contains(&0)
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

/// Lista arquivos e diretórios imediatamente dentro de `relative_path`
/// (relativo ao root do projeto).
pub fn fs_list_files(
    app: AppHandle,
    project_id: String,
    relative_path: Option<String>,
    options: Option<FsListOptions>,
) -> Result<Vec<FsEntry>, String> {
    let root = project_root(&app, &project_id)?;
    let target = resolve_within_root(&root, relative_path.as_deref())?;
    let metadata = fs::metadata(&target)
        .map_err(|error| format!("Não foi possível ler {}: {error}", target.display()))?;
    if !metadata.is_dir() {
        return Err(format!(
            "Caminho não é diretório: {}",
            target.display()
        ));
    }

    let max = options
        .and_then(|opts| opts.max_entries)
        .unwrap_or(DEFAULT_MAX_ENTRIES)
        .min(HARD_MAX_ENTRIES);

    let mut entries = Vec::new();
    let read = fs::read_dir(&target)
        .map_err(|error| format!("Não foi possível ler {}: {error}", target.display()))?;
    for entry in read.flatten() {
        if entries.len() >= max {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored_dir_name(&name) {
            continue;
        }
        let entry_path = entry.path();
        let kind = match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => FsEntryKind::Directory,
            Ok(file_type) if file_type.is_file() => FsEntryKind::File,
            Ok(file_type) if file_type.is_symlink() => FsEntryKind::Symlink,
            Ok(_) => FsEntryKind::Other,
            Err(_) => FsEntryKind::Other,
        };
        let size = entry
            .metadata()
            .map(|meta| meta.len())
            .unwrap_or(0);
        let relative = entry_path
            .strip_prefix(&root)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(FsEntry {
            path: relative,
            name: name.clone(),
            kind,
            size_bytes: size,
            is_hidden: is_hidden(&name),
        });
    }

    entries.sort_by(|a, b| {
        // Diretórios primeiro, depois por nome case-insensitive.
        let dir_first = (a.kind == FsEntryKind::Directory)
            .cmp(&(b.kind == FsEntryKind::Directory))
            .reverse();
        dir_first.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Lê um arquivo do projeto respeitando limites de tamanho e
/// detectando binários. Retorna erro claro em casos comuns.
pub fn fs_read_file(
    app: AppHandle,
    project_id: String,
    relative_path: String,
    options: Option<FsReadOptions>,
) -> Result<FsReadResult, String> {
    let root = project_root(&app, &project_id)?;
    let target = resolve_within_root(&root, Some(relative_path.as_str()))?;
    let metadata = fs::metadata(&target)
        .map_err(|error| format!("Não foi possível ler {}: {error}", target.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "Caminho não é arquivo regular: {}",
            target.display()
        ));
    }

    let max = options
        .and_then(|opts| opts.max_bytes)
        .unwrap_or(DEFAULT_MAX_BYTES)
        .min(HARD_MAX_BYTES);
    let size = metadata.len();

    if size == 0 {
        return Ok(FsReadResult {
            path: relative_path,
            size_bytes: 0,
            read_bytes: 0,
            truncated: false,
            content: String::new(),
            is_binary: false,
            exists: true,
        });
    }

    let to_read = size.min(max);
    let mut buffer = vec![0u8; to_read as usize];
    use std::io::Read;
    let mut file = fs::File::open(&target)
        .map_err(|error| format!("Não foi possível abrir {}: {error}", target.display()))?;
    file.read_exact(&mut buffer)
        .map_err(|error| format!("Erro de leitura em {}: {error}", target.display()))?;

    let binary = looks_binary(&buffer);
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&buffer).to_string()
    };

    Ok(FsReadResult {
        path: relative_path,
        size_bytes: size,
        read_bytes: to_read,
        truncated: size > max,
        content,
        is_binary: binary,
        exists: true,
    })
}

/// Retorna metadados de um arquivo ou diretório.
pub fn fs_get_file_info(
    app: AppHandle,
    project_id: String,
    relative_path: Option<String>,
) -> Result<Option<FsEntry>, String> {
    let root = project_root(&app, &project_id)?;
    let target = resolve_within_root(&root, relative_path.as_deref())?;
    let metadata = match fs::symlink_metadata(&target) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Não foi possível ler metadados de {}: {error}",
                target.display()
            ));
        }
    };

    let name = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let kind = if metadata.file_type().is_dir() {
        FsEntryKind::Directory
    } else if metadata.file_type().is_file() {
        FsEntryKind::File
    } else if metadata.file_type().is_symlink() {
        FsEntryKind::Symlink
    } else {
        FsEntryKind::Other
    };
    let relative = target
        .strip_prefix(&root)
        .unwrap_or(&target)
        .to_string_lossy()
        .replace('\\', "/");

    Ok(Some(FsEntry {
        path: relative,
        name,
        kind,
        size_bytes: metadata.len(),
        is_hidden: is_hidden(
            &target
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
        ),
    }))
}

/// Busca arquivos cujo nome (case-insensitive) contém `query`.
/// Quando `query` é vazio, retorna lista vazia (UI deve usar
/// `fs_list_files` para listar).
pub fn fs_search_files(
    app: AppHandle,
    project_id: String,
    query: String,
    options: Option<FsSearchOptions>,
) -> Result<Vec<FsEntry>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let needle = trimmed.to_lowercase();

    let root = project_root(&app, &project_id)?;
    let start = resolve_within_root(&root, options.as_ref().and_then(|opts| opts.relative_path.as_deref()))?;
    let max = options
        .as_ref()
        .and_then(|opts| opts.max_results)
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .min(HARD_MAX_RESULTS);

    let mut out = Vec::new();
    let mut stack = vec![(start, 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= max || depth > HARD_MAX_DEPTH {
            continue;
        }
        let read = match fs::read_dir(&dir) {
            Ok(read) => read,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            if out.len() >= max {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_ignored_dir_name(&name) {
                continue;
            }
            if name.to_lowercase().contains(&needle) {
                let entry_path = entry.path();
                let metadata = entry.metadata().ok();
                let kind = metadata
                    .as_ref()
                    .map(|meta| {
                        if meta.is_dir() {
                            FsEntryKind::Directory
                        } else if meta.is_file() {
                            FsEntryKind::File
                        } else if meta.is_symlink() {
                            FsEntryKind::Symlink
                        } else {
                            FsEntryKind::Other
                        }
                    })
                    .unwrap_or(FsEntryKind::Other);
                let size = metadata.map(|meta| meta.len()).unwrap_or(0);
                let relative = entry_path
                    .strip_prefix(&root)
                    .unwrap_or(&entry_path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(FsEntry {
                    path: relative,
                    name: name.clone(),
                    kind,
                    size_bytes: size,
                    is_hidden: is_hidden(&name),
                });
            }
            let is_dir = entry
                .file_type()
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            if is_dir {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    Ok(out)
}

/// Lista a árvore leve do projeto a partir do root, com
/// profundidade e número de entries limitados.
pub fn fs_list_project_tree(
    app: AppHandle,
    project_id: String,
    options: Option<FsTreeOptions>,
) -> Result<FsTreeNode, String> {
    let root = project_root(&app, &project_id)?;
    let max_depth = options
        .as_ref()
        .and_then(|opts| opts.max_depth)
        .unwrap_or(DEFAULT_MAX_DEPTH)
        .min(HARD_MAX_DEPTH);
    let max_entries = options
        .as_ref()
        .and_then(|opts| opts.max_entries)
        .unwrap_or(DEFAULT_MAX_ENTRIES)
        .min(HARD_MAX_ENTRIES);

    let mut counter: usize = 0;
    let mut truncated = false;
    let node = build_tree_node(&root, &root, 0, max_depth, max_entries, &mut counter, &mut truncated)?;
    Ok(node)
}

fn build_tree_node(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    counter: &mut usize,
    truncated: &mut bool,
) -> Result<FsTreeNode, String> {
    let metadata = fs::metadata(dir)
        .map_err(|error| format!("Não foi possível ler {}: {error}", dir.display()))?;
    let name = dir
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let kind = if metadata.is_dir() {
        FsEntryKind::Directory
    } else {
        FsEntryKind::File
    };
    let relative = dir
        .strip_prefix(root)
        .unwrap_or(dir)
        .to_string_lossy()
        .replace('\\', "/");

    let mut node = FsTreeNode {
        path: relative,
        name,
        kind,
        children: Vec::new(),
        truncated: false,
    };

    if depth >= max_depth {
        return Ok(node);
    }

    let read = fs::read_dir(dir)
        .map_err(|error| format!("Não foi possível ler {}: {error}", dir.display()))?;
    let mut entries: Vec<_> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_ignored_dir_name(&name) {
                return None;
            }
            Some((entry, name))
        })
        .collect();
    entries.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));

    for (entry, name) in entries {
        if *counter >= max_entries {
            *truncated = true;
            break;
        }
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            *counter += 1;
            let child = build_tree_node(root, &path, depth + 1, max_depth, max_entries, counter, truncated)?;
            node.children.push(child);
        } else if metadata.is_file() {
            *counter += 1;
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            node.children.push(FsTreeNode {
                path: relative,
                name,
                kind: FsEntryKind::File,
                children: Vec::new(),
                truncated: false,
            });
        }
    }
    node.truncated = *truncated;
    Ok(node)
}
