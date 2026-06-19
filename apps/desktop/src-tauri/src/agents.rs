// PR 011 — Agent Engine do Fluxora.
//
// Cria a infraestrutura real de agentes no backend Rust/Tauri,
// substituindo os `AgentStepOutput` sintéticos (derivados dos logs
// pelo `buildSyntheticSteps` da PR 008) por steps reais persistidos
// em `<app_data_dir>/fluxora/agent_steps.json`.
//
// Esta PR entrega:
//
// - Persistência local de configurações de agentes em
//   `<app_data_dir>/fluxora/agents.json` (versionado).
// - Persistência local de steps de agentes em
//   `<app_data_dir>/fluxora/agent_steps.json` (versionado).
// - 4 agentes padrão (Planner / Developer / QA / Finalizer) criados
//   sob demanda com system prompts internos seguros.
// - Comandos Tauri: `agents_ping` / `agents_list` / `agents_get` /
//   `agents_create` / `agents_update` / `agents_remove` /
//   `agents_reset_defaults` / `agent_steps_list` / `agent_steps_get`
//   / `agent_steps_list_by_mission`.
// - Integração com o Mission Engine (PR 008): a função
//   `run_mission_agents` é chamada pelo `missions_run` no lugar da
//   antiga pipeline de uma única chamada. Os 4 agentes são
//   executados sequencialmente (Planner → Developer → QA →
//   Finalizer), cada um com seu próprio `AgentStepRecord`.
// - Integração com o Provider Engine (PR 007) via
//   `providers::execute_mission_chat`. Cada agente pode ter
//   `providerId`/`model` próprios ou herdar da missão.
// - Integração com o Patch Engine (PR 010): se o Developer gerar
//   um bloco `fluxora_patch`, o Mission Engine cria a proposta
//   automaticamente (reaproveita `extract_fluxora_patch_block` e
//   `patches::create_proposal_from_provider_text` da PR 010).
// - Eventos `agent/*` no barramento `fluxora-event` (PR 005):
//   `agent/defaults-created`, `agent/settings-updated`,
//   `agent/step-created`, `agent/step-started`,
//   `agent/step-completed`, `agent/step-failed`,
//   `agent/plan-created`, `agent/qa-completed`.
// - Compatibilidade com a UI atual via `desktopBridge`:
//   `workflows.getStepOutputs(id)` / `listAgentOutputs(id)` passam
//   a retornar os `AgentStepRecord` reais convertidos para
//   `AgentStepOutput` legado. O `AgentStepOutputPanel`,
//   `ExecutionDetailPage` e `useUsageStats` continuam
//   consumindo `window.fluxora.workflows.listAgentOutputs` sem
//   alteração de componente.
//
// **Esta PR NÃO implementa streaming, tool calling, execução de
// comandos de shell, Git write operations, commit/push.** Os agentes chamam o Provider Engine da
// PR 007 (mesmo helper `execute_mission_chat`) e respeitam
// permissões/approvals da PR 009 e patch/diff controlado da PR 010.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;
use tauri::{AppHandle, Manager};

use crate::events;
use crate::missions;
use crate::providers;

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/// Tamanho máximo do `outputText` salvo em um `AgentStepRecord`
/// (em bytes). Evita que respostas gigantes do provider
/// estourem o `agent_steps.json`.
const MAX_STEP_OUTPUT_BYTES: u64 = 256 * 1024; // 256 KiB

/// Tamanho máximo do `inputSummary` salvo em um `AgentStepRecord`
/// (em chars). Apenas um resumo curto do input é persistido — o
/// `outputText` mantém a saída completa (truncada).
const MAX_INPUT_SUMMARY_CHARS: usize = 1_000;

/// Tamanho máximo de mensagens de erro salvas em
/// `AgentStepRecord.error` (em chars).
const MAX_ERROR_MESSAGE_CHARS: usize = 500;

/// Número máximo de agentes executados por missão (limite duro
/// nesta PR). Os 4 agentes padrão cabem; agentes custom
/// adicionais são ignorados na execução (mas podem ser listados).
pub(crate) const MAX_AGENTS_PER_MISSION: usize = 4;

/// System prompt interno padrão do Planner (PR 011). Não-editável
/// pelo usuário nesta PR. Salvo no `AgentConfig.systemPrompt` na
/// criação padrão para que o caller possa auditar.
pub(crate) const PLANNER_PROMPT: &str = "Você é o Planner do Fluxora.\n\
Sua função é entender a missão, analisar o contexto do projeto e criar um plano de ação.\n\
Não altere arquivos.\n\
Não gere patch.\n\
Responda com:\n\
1. Entendimento da missão\n\
2. Plano em etapas\n\
3. Arquivos provavelmente envolvidos\n\
4. Riscos\n\
5. Critérios de sucesso";

/// System prompt interno padrão do Developer (PR 011).
pub(crate) const DEVELOPER_PROMPT: &str = "Você é o Developer do Fluxora.\n\
Sua função é propor a solução com base no plano do Planner e no contexto do projeto.\n\
Quando a missão pedir criar, crie, implementar, implemente, construir, construa, gerar, gere, adicionar, adicione, alterar, altere, editar, edite, fazer uma página, faça uma página, landing page, componente, arquivo ou código, você DEVE retornar obrigatoriamente um bloco fluxora_patch ao final da resposta.\n\
Não responda apenas com plano, não diga \"eu criaria\", e não diga que criou se não retornou o patch.\n\
Não execute comandos.\n\
Não faça commit.\n\n\
O bloco fluxora_patch deve seguir EXATAMENTE o formato JSON abaixo:\n\
```fluxora_patch\n\
{{\n  \"title\": \"Título curto da alteração\",\n  \"summary\": \"Descrição do que será alterado\",\n  \"files\": [\n    {{\n      \"path\": \"caminho/relativo/arquivo.html\",\n      \"operation\": \"create\",\n      \"afterContent\": \"conteúdo completo do arquivo\"\n    }}\n  ]\n}}\n\
```\n\n\
Regras estritas:\n\
- Use apenas caminhos RELATIVOS ao projeto (NUNCA use path absoluto, NUNCA use \"..\").\n\
- operation deve ser \"create\", \"modify\" ou \"delete\". Para arquivos novos, use \"create\". Para alterações, use \"modify\".\n\
- Para \"create\" e \"modify\", forneça o conteúdo final completo em afterContent (NUNCA use placeholders ou trechos incompletos).\n\
- Para \"delete\", use operation: \"delete\" sem afterContent.\n\
- NUNCA escreva ou altere arquivos em: .git, node_modules, vendor, dist, target, build, .next, .cache, .turbo, out.\n\
- Para página simples em projeto vazio, crie pelo menos index.html, styles.css e script.js.\n\n\
Responda com:\n\
1. Solução proposta\n\
2. Justificativa\n\
3. Riscos\n\
4. Bloco fluxora_patch (ao final)";

/// System prompt interno padrão do QA (PR 011).
pub(crate) const QA_PROMPT: &str = "Você é o QA do Fluxora.\n\
Sua função é revisar a proposta do Developer.\n\
Verifique riscos, inconsistências, arquivos perigosos e clareza.\n\
Não execute testes reais.\n\
Não altere arquivos.\n\
Responda com:\n\
1. Problemas encontrados\n\
2. Riscos\n\
3. Aprovação ou reprovação da proposta\n\
4. Recomendações";

/// System prompt interno padrão do Finalizer (PR 011).
pub(crate) const FINALIZER_PROMPT: &str = "Você é o Finalizer do Fluxora.\n\
Sua função é consolidar o resultado da missão para o usuário.\n\
Resuma o que foi feito, o que foi proposto, o que precisa de aprovação e próximos passos.\n\
Seja conciso e direto.";

// ---------------------------------------------------------------------------
// Tipos canônicos (espelham `AgentConfig` / `AgentStepRecord` em
// `@fluxora/shared`).
// ---------------------------------------------------------------------------

/// Status (habilitado / desabilitado) de um agente.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Enabled,
    Disabled,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Enabled => "enabled",
            Self::Disabled => "disabled",
        }
    }

    pub fn from_str(value: &str) -> Self {
        if value.trim().eq_ignore_ascii_case("enabled") {
            Self::Enabled
        } else {
            Self::Disabled
        }
    }
}

/// Configuração persistida de um agente (espelha `AgentConfig`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigRecord {
    pub id: String,
    pub name: String,
    /// Role do agente (`planner` | `developer` | `qa` | `finalizer`
    /// | `custom`). Mantido como `String` para preservar tipos
    /// custom futuros.
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    pub order: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// Status do ciclo de vida de um `AgentStepRecord`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl StepStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }

    #[allow(dead_code)]
    pub fn from_str(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "pending" => Self::Pending,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "skipped" => Self::Skipped,
            _ => Self::Pending,
        }
    }
}

/// Step real de um agente (espelha `AgentStepRecord`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub role: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------------

pub struct AgentsState {
    pub agents: Mutex<Vec<AgentConfigRecord>>,
    pub steps: Mutex<Vec<AgentStepRecord>>,
}

impl AgentsState {
    pub fn new() -> Self {
        Self {
            agents: Mutex::new(Vec::new()),
            steps: Mutex::new(Vec::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    agents: Vec<AgentConfigRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentStepsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    steps: Vec<AgentStepRecord>,
}

fn default_version() -> u32 {
    1
}

impl Default for AgentsFile {
    fn default() -> Self {
        Self {
            version: 1,
            agents: Vec::new(),
        }
    }
}

impl Default for AgentStepsFile {
    fn default() -> Self {
        Self {
            version: 1,
            steps: Vec::new(),
        }
    }
}

fn agents_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível resolver app_data_dir: {error}"))?;
    Ok(base_dir.join("fluxora").join("agents.json"))
}

#[allow(dead_code)]
fn agent_steps_file_path(_app: &AppHandle) -> Result<PathBuf, String> {
    // Mesmo path que `agents_file_path` (só usamos para validar
    // diretório) — o `agent_steps.json` é salvo no mesmo local.
    Ok(PathBuf::from("agent_steps.json"))
}

fn ensure_agents_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let file_path = agents_file_path(app)?;
    let parent = file_path.parent().ok_or_else(|| {
        "Não foi possível resolver o diretório de persistência de agents.".to_string()
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível criar o diretório de persistência: {error}"))?;
    Ok(file_path)
}

fn read_agents_file(app: &AppHandle) -> Result<AgentsFile, String> {
    let file_path = ensure_agents_dir(app)?;
    if !file_path.exists() {
        return Ok(AgentsFile::default());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", file_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(AgentsFile::default());
    }
    serde_json::from_str::<AgentsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de agents inválido em {}: {error}",
            file_path.display()
        )
    })
}

fn write_agents_file(app: &AppHandle, store: &AgentsFile) -> Result<(), String> {
    let file_path = ensure_agents_dir(app)?;
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar os agents: {error}"))?;
    fs::write(&file_path, content)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", file_path.display()))
}

fn read_agent_steps_file(app: &AppHandle) -> Result<AgentStepsFile, String> {
    let file_path = ensure_agents_dir(app)?;
    let steps_path = file_path
        .parent()
        .ok_or_else(|| "Diretório de agent_steps inválido.".to_string())?
        .join("agent_steps.json");
    if !steps_path.exists() {
        return Ok(AgentStepsFile::default());
    }
    let raw = fs::read_to_string(&steps_path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", steps_path.display()))?;
    if raw.trim().is_empty() {
        return Ok(AgentStepsFile::default());
    }
    serde_json::from_str::<AgentStepsFile>(&raw).map_err(|error| {
        format!(
            "Arquivo de agent_steps inválido em {}: {error}",
            steps_path.display()
        )
    })
}

fn write_agent_steps_file(app: &AppHandle, store: &AgentStepsFile) -> Result<(), String> {
    let file_path = ensure_agents_dir(app)?;
    let steps_path = file_path
        .parent()
        .ok_or_else(|| "Diretório de agent_steps inválido.".to_string())?
        .join("agent_steps.json");
    let content = serde_json::to_string_pretty(store)
        .map_err(|error| format!("Não foi possível serializar os agent_steps: {error}"))?;
    fs::write(&steps_path, content).map_err(|error| {
        format!(
            "Não foi possível salvar {}: {error}",
            steps_path.display()
        )
    })
}

/// Carrega `agents.json` e `agent_steps.json` no startup do
/// Tauri. Falhas de I/O são logadas e descartadas — o app
/// continua com estado vazio até o primeiro acesso.
pub fn load_agents_on_startup(app: &AppHandle) {
    // agents.json
    match read_agents_file(app) {
        Ok(store) => {
            let count = store.agents.len();
            if let Some(state) = app.try_state::<AgentsState>() {
                if let Ok(mut agents) = state.agents.lock() {
                    *agents = store.agents;
                }
                eprintln!("[fluxora agents] carregados {count} agente(s)");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora agents] falha ao carregar agents.json: {error}. Iniciando vazio."
            );
        }
    }
    // agent_steps.json
    match read_agent_steps_file(app) {
        Ok(store) => {
            let count = store.steps.len();
            if let Some(state) = app.try_state::<AgentsState>() {
                if let Ok(mut steps) = state.steps.lock() {
                    *steps = store.steps;
                }
                eprintln!("[fluxora agent_steps] carregados {count} step(s) de agente");
            }
        }
        Err(error) => {
            eprintln!(
                "[fluxora agent_steps] falha ao carregar agent_steps.json: {error}. Iniciando vazio."
            );
        }
    }
}

fn persist_agents(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AgentsState>();
    let agents = state
        .agents
        .lock()
        .map_err(|_| "Lock de agents poisoned.".to_string())?
        .clone();
    let store = AgentsFile {
        version: 1,
        agents,
    };
    write_agents_file(app, &store)
}

fn persist_agent_steps(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AgentsState>();
    let steps = state
        .steps
        .lock()
        .map_err(|_| "Lock de agent_steps poisoned.".to_string())?
        .clone();
    let store = AgentStepsFile {
        version: 1,
        steps,
    };
    write_agent_steps_file(app, &store)
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    events::iso_now()
}

fn generate_agent_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("agent-{millis}-{seq}")
}

fn generate_step_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("agent-step-{millis}-{seq}")
}

fn truncate_output(text: &str) -> String {
    if text.len() <= MAX_STEP_OUTPUT_BYTES as usize {
        return text.to_string();
    }
    // Truncar em bytes (não chars) para garantir o cap. O ponto
    // de corte pode cair no meio de um char UTF-8 — usamos
    // `char_indices` para encontrar o último boundary válido.
    let mut end = MAX_STEP_OUTPUT_BYTES as usize;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = String::with_capacity(end + 1);
    out.push_str(&text[..end]);
    out.push('…');
    out
}

fn truncate_input_summary(text: &str) -> String {
    if text.chars().count() <= MAX_INPUT_SUMMARY_CHARS {
        return text.to_string();
    }
    let mut out: String = text.chars().take(MAX_INPUT_SUMMARY_CHARS).collect();
    out.push('…');
    out
}

fn truncate_error(input: &str) -> String {
    if input.chars().count() <= MAX_ERROR_MESSAGE_CHARS {
        return input.to_string();
    }
    let mut out: String = input.chars().take(MAX_ERROR_MESSAGE_CHARS).collect();
    out.push('…');
    out
}

fn find_agent_by_id(state: &AgentsState, id: &str) -> Option<AgentConfigRecord> {
    state
        .agents
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|a| a.id == id).cloned())
}

fn find_step_by_id(state: &AgentsState, id: &str) -> Option<AgentStepRecord> {
    state
        .steps
        .lock()
        .ok()
        .and_then(|guard| guard.iter().find(|s| s.id == id).cloned())
}

pub fn find_steps_by_mission(state: &AgentsState, mission_id: &str) -> Vec<AgentStepRecord> {
    let guard = match state.steps.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<AgentStepRecord> = guard
        .iter()
        .filter(|s| s.mission_id == mission_id)
        .cloned()
        .collect();
    // Ordena por `createdAt` crescente (ordem natural de criação)
    // — a UI espera os steps na ordem do pipeline.
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    out
}

fn insert_agent(state: &AgentsState, agent: AgentConfigRecord) {
    if let Ok(mut guard) = state.agents.lock() {
        guard.push(agent);
    }
}

fn update_agent<F>(state: &AgentsState, id: &str, mutator: F) -> Option<AgentConfigRecord>
where
    F: FnOnce(&mut AgentConfigRecord),
{
    let mut guard = state.agents.lock().ok()?;
    let agent = guard.iter_mut().find(|a| a.id == id)?;
    mutator(agent);
    agent.updated_at = now_iso();
    Some(agent.clone())
}

fn remove_agent(state: &AgentsState, id: &str) -> bool {
    if let Ok(mut guard) = state.agents.lock() {
        let before = guard.len();
        guard.retain(|a| a.id != id);
        return guard.len() < before;
    }
    false
}

fn insert_step(state: &AgentsState, step: AgentStepRecord) {
    if let Ok(mut guard) = state.steps.lock() {
        guard.push(step);
    }
}

fn update_step<F>(state: &AgentsState, id: &str, mutator: F) -> Option<AgentStepRecord>
where
    F: FnOnce(&mut AgentStepRecord),
{
    let mut guard = state.steps.lock().ok()?;
    let step = guard.iter_mut().find(|s| s.id == id)?;
    mutator(step);
    step.updated_at = now_iso();
    Some(step.clone())
}

// ---------------------------------------------------------------------------
// Default agents
// ---------------------------------------------------------------------------

/// Cria os 4 agentes padrão (Planner / Developer / QA / Finalizer)
/// se ainda não existirem. Devolve a lista final de agentes.
///
/// Os IDs são determinísticos (`agent-planner` etc.) para que
/// re-chamadas não dupliquem. Quando um agente com mesmo `role`
/// já existir, é preservado.
pub fn ensure_default_agents(app: &AppHandle) -> Vec<AgentConfigRecord> {
    let state = app.state::<AgentsState>();
    let now = now_iso();
    let mut needs_persist = false;
    {
        let mut guard = match state.agents.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        // Força atualização do prompt do desenvolvedor se o prompt atual divergir
        if let Some(dev_agent) = guard.iter_mut().find(|a| a.id == "agent-developer") {
            if dev_agent.system_prompt.as_deref() != Some(DEVELOPER_PROMPT) {
                dev_agent.system_prompt = Some(DEVELOPER_PROMPT.to_string());
                dev_agent.updated_at = now.clone();
                needs_persist = true;
            }
        }
        // Verifica se já existe pelo menos um agente de cada
        // role padrão. Se sim, não recria.
        let have_planner = guard.iter().any(|a| a.role == "planner");
        let have_developer = guard.iter().any(|a| a.role == "developer");
        let have_qa = guard.iter().any(|a| a.role == "qa");
        let have_finalizer = guard.iter().any(|a| a.role == "finalizer");
        if have_planner && have_developer && have_qa && have_finalizer {
            if needs_persist {
                let _ = persist_agents(app);
            }
            return guard.clone();
        }
        if !have_planner {
            guard.push(AgentConfigRecord {
                id: "agent-planner".to_string(),
                name: "Planner".to_string(),
                role: "planner".to_string(),
                description: Some(
                    "Entende a missão, analisa contexto e cria plano de ação.".to_string(),
                ),
                provider_id: None,
                model: None,
                status: AgentStatus::Enabled.as_str().to_string(),
                system_prompt: Some(PLANNER_PROMPT.to_string()),
                order: 0,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
            needs_persist = true;
        }
        if !have_developer {
            guard.push(AgentConfigRecord {
                id: "agent-developer".to_string(),
                name: "Developer".to_string(),
                role: "developer".to_string(),
                description: Some(
                    "Propõe solução com base no plano. Pode gerar bloco fluxora_patch."
                        .to_string(),
                ),
                provider_id: None,
                model: None,
                status: AgentStatus::Enabled.as_str().to_string(),
                system_prompt: Some(DEVELOPER_PROMPT.to_string()),
                order: 1,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
            needs_persist = true;
        }
        if !have_qa {
            guard.push(AgentConfigRecord {
                id: "agent-qa".to_string(),
                name: "QA".to_string(),
                role: "qa".to_string(),
                description: Some(
                    "Revisa a proposta do Developer e avalia riscos.".to_string(),
                ),
                provider_id: None,
                model: None,
                status: AgentStatus::Enabled.as_str().to_string(),
                system_prompt: Some(QA_PROMPT.to_string()),
                order: 2,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
            needs_persist = true;
        }
        if !have_finalizer {
            guard.push(AgentConfigRecord {
                id: "agent-finalizer".to_string(),
                name: "Finalizer".to_string(),
                role: "finalizer".to_string(),
                description: Some(
                    "Consolida o resultado final da missão para o usuário.".to_string(),
                ),
                provider_id: None,
                model: None,
                status: AgentStatus::Enabled.as_str().to_string(),
                system_prompt: Some(FINALIZER_PROMPT.to_string()),
                order: 3,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
            needs_persist = true;
        }
    }
    if needs_persist {
        let _ = persist_agents(app);
        emit_agent_event(
            app,
            "agent/defaults-created",
            "info",
            "Agentes padrão criados/atualizados.",
            None,
            None,
            None,
            Some(serde_json::json!({
                "defaultRoles": ["planner", "developer", "qa", "finalizer"],
            })),
        );
    }
    list_agents_internal(app).unwrap_or_default()
}

/// Helper interno para listar agentes (reusado por
/// `ensure_default_agents`).
fn list_agents_internal(app: &AppHandle) -> Result<Vec<AgentConfigRecord>, String> {
    let state = app.state::<AgentsState>();
    let guard = state
        .agents
        .lock()
        .map_err(|_| "Lock de agents poisoned.".to_string())?;
    let mut out = guard.clone();
    out.sort_by(|a, b| a.order.cmp(&b.order));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Eventos agent/*
// ---------------------------------------------------------------------------

/// Emite um evento `agent/*` no barramento `fluxora-event`.
/// `mission_id` e `agent_id` são opcionais (alguns eventos não
/// estão vinculados a uma missão específica, ex.: defaults-created).
pub(crate) fn emit_agent_event(
    app: &AppHandle,
    event_type: &str,
    level: &str,
    message: &str,
    project_id: Option<String>,
    mission_id: Option<String>,
    agent_id: Option<String>,
    payload: Option<serde_json::Value>,
) {
    let event = events::build_event(
        event_type,
        "agent",
        level,
        Some(message.to_string()),
        project_id,
        mission_id,
        agent_id,
        payload,
    );
    events::emit_to_app(app, event);
}

// ---------------------------------------------------------------------------
// Comandos Tauri (PR 011)
// ---------------------------------------------------------------------------

/// Health-check do Agent Engine. Retorna um timestamp ISO 8601.
pub fn agents_ping() -> String {
    now_iso()
}

/// Lista todas as configurações de agentes persistidas. Cria os
/// agentes padrão sob demanda se `agents.json` estiver vazio.
pub fn agents_list(app: AppHandle) -> Result<Vec<AgentConfigRecord>, String> {
    let state = app.state::<AgentsState>();
    let guard = state
        .agents
        .lock()
        .map_err(|_| "Lock de agents poisoned.".to_string())?;
    let mut out = guard.clone();
    // Garante que os 4 agentes padrão existam (idempotente).
    drop(guard);
    if out.is_empty() {
        out = ensure_default_agents(&app);
    }
    out.sort_by(|a, b| a.order.cmp(&b.order));
    Ok(out)
}

/// Retorna um agente por `id` (ou `None`).
pub fn agents_get(app: AppHandle, id: String) -> Result<Option<AgentConfigRecord>, String> {
    let state = app.state::<AgentsState>();
    Ok(find_agent_by_id(&state, &id))
}

/// Cria um novo agente. Retorna o `AgentConfigRecord` persistido.
pub fn agents_create(
    app: AppHandle,
    name: String,
    role: String,
    description: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
    status: Option<String>,
    system_prompt: Option<String>,
    order: Option<u32>,
) -> Result<AgentConfigRecord, String> {
    let name_trim = name.trim().to_string();
    if name_trim.is_empty() {
        return Err("O nome do agente não pode estar vazio.".to_string());
    }
    let role_trim = role.trim().to_lowercase();
    if !matches!(
        role_trim.as_str(),
        "planner" | "developer" | "qa" | "finalizer" | "custom"
    ) {
        return Err(format!(
            "Role '{role_trim}' inválida. Esperado: planner, developer, qa, finalizer, custom."
        ));
    }
    let now = now_iso();
    let record = AgentConfigRecord {
        id: generate_agent_id(),
        name: name_trim,
        role: role_trim,
        description,
        provider_id,
        model,
        status: status
            .map(|s| AgentStatus::from_str(&s).as_str().to_string())
            .unwrap_or_else(|| AgentStatus::Enabled.as_str().to_string()),
        system_prompt,
        order: order.unwrap_or(99),
        created_at: now.clone(),
        updated_at: now,
    };
    let state = app.state::<AgentsState>();
    insert_agent(&state, record.clone());
    persist_agents(&app)?;
    Ok(record)
}

/// Atualiza um agente existente. Retorna o `AgentConfigRecord`
/// atualizado.
pub fn agents_update(
    app: AppHandle,
    id: String,
    name: Option<String>,
    description: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
    status: Option<String>,
    system_prompt: Option<String>,
    order: Option<u32>,
) -> Result<AgentConfigRecord, String> {
    let state = app.state::<AgentsState>();
    if find_agent_by_id(&state, &id).is_none() {
        return Err(format!("Agente '{id}' não encontrado."));
    }
    let updated = update_agent(&state, &id, |a| {
        if let Some(n) = name {
            let n_trim = n.trim().to_string();
            if !n_trim.is_empty() {
                a.name = n_trim;
            }
        }
        if let Some(d) = description {
            a.description = Some(d);
        }
        if let Some(p) = provider_id {
            a.provider_id = if p.is_empty() { None } else { Some(p) };
        }
        if let Some(m) = model {
            a.model = if m.is_empty() { None } else { Some(m) };
        }
        if let Some(s) = status {
            a.status = AgentStatus::from_str(&s).as_str().to_string();
        }
        if let Some(sp) = system_prompt {
            a.system_prompt = Some(sp);
        }
        if let Some(o) = order {
            a.order = o;
        }
    })
    .ok_or_else(|| format!("Agente '{id}' não encontrado."))?;
    persist_agents(&app)?;
    emit_agent_event(
        &app,
        "agent/settings-updated",
        "info",
        &format!("Agente '{}' atualizado.", updated.name),
        None,
        None,
        Some(updated.id.clone()),
        Some(serde_json::json!({
            "agentName": &updated.name,
            "role": &updated.role,
        })),
    );
    Ok(updated)
}

/// Remove um agente. Retorna `Ok(())` se removido ou se já não
/// existia. Recusar remover os 4 agentes padrão seria drástico
/// (a UI não tem como recriá-los nesta PR), mas o `reset_defaults`
/// faz isso.
pub fn agents_remove(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AgentsState>();
    if remove_agent(&state, &id) {
        persist_agents(&app)?;
    }
    Ok(())
}

/// Reseta os agentes para os 4 padrão. Remove todos os agentes
/// persistidos e recria Planner / Developer / QA / Finalizer.
/// Devolve a lista final.
pub fn agents_reset_defaults(app: AppHandle) -> Result<Vec<AgentConfigRecord>, String> {
    let state = app.state::<AgentsState>();
    {
        let mut guard = state
            .agents
            .lock()
            .map_err(|_| "Lock de agents poisoned.".to_string())?;
        guard.clear();
    }
    persist_agents(&app)?;
    let defaults = ensure_default_agents(&app);
    Ok(defaults)
}

// ---------------------------------------------------------------------------
// Comandos Tauri — agent_steps
// ---------------------------------------------------------------------------

/// Lista os steps reais de uma missão (ordenados por `createdAt`).
pub fn agent_steps_list_by_mission(
    app: AppHandle,
    mission_id: String,
) -> Result<Vec<AgentStepRecord>, String> {
    let state = app.state::<AgentsState>();
    Ok(find_steps_by_mission(&state, &mission_id))
}

/// Lista os steps reais de um workflowRunId. Re-export para
/// compatibilidade com a API legada `agentSteps.list(workflowRunId)`
/// — o `workflowRunId` da UI é tratado como `missionId` (mesmo id).
pub fn agent_steps_list(app: AppHandle, mission_id: String) -> Result<Vec<AgentStepRecord>, String> {
    agent_steps_list_by_mission(app, mission_id)
}

/// Retorna um step real por `id`.
pub fn agent_steps_get(app: AppHandle, id: String) -> Result<Option<AgentStepRecord>, String> {
    let state = app.state::<AgentsState>();
    Ok(find_step_by_id(&state, &id))
}

// ---------------------------------------------------------------------------
// Pipeline de agentes para missões (PR 011 — Fase 7)
// ---------------------------------------------------------------------------

/// Contexto necessário para executar o pipeline de agentes de
/// uma missão. É construído pelo `missions_run` (PR 008 +
/// extensão PR 011) e passado para `run_mission_agents`.
pub(crate) struct MissionAgentContext<'a> {
    pub mission: &'a missions::MissionRecord,
    pub user_prompt: &'a str,
    pub project_name: &'a str,
    pub project_stack: &'a [String],
    pub context_text: &'a str,
    /// Provider resolvido pela missão (fallback quando o agente
    /// não tem `providerId` próprio).
    pub default_provider_id: &'a str,
    /// Modelo resolvido pela missão (fallback quando o agente
    /// não tem `model` próprio).
    pub default_model: &'a str,
}

/// Resultado agregado do pipeline de agentes. O `finalizer_output`
/// é salvo no `MissionRun.resultText` (substituindo a antiga
/// `result_text` da PR 008). Os steps são persistidos em
/// `agent_steps.json`.
pub(crate) struct MissionAgentsResult {
    /// Texto final consolidado pelo Finalizer (para
    /// `MissionRun.resultText`).
    pub finalizer_output: String,
    /// `proposalId` quando o Developer gerou um `fluxora_patch`
    /// válido que virou `PatchProposal`.
    pub patch_proposal_id: Option<String>,
}

/// PR 012 — Helper que executa uma chamada de provider com
/// suporte a streaming + fallback automático para
/// não-streaming. Usado por `run_mission_agents` no lugar da
/// antiga `providers::execute_mission_chat` direta.
///
/// Comportamento:
/// 1. Tenta `providers::execute_mission_chat_stream` (PR 012).
///    Cada delta emitido pelo stream vira um evento
///    `agent/step-chunk` no barramento `fluxora-event`.
/// 2. Se o stream falhar **antes** de qualquer chunk ser
///    enviado (ex.: provider respondeu com 400, ou erro de
///    rede antes do primeiro byte), faz fallback transparente
///    para `providers::execute_mission_chat` (PR 007). A UI
///    recebe o output final normalmente, sem `agent/step-chunk`.
/// 3. Se o stream falhar **após** algum chunk já ter sido
///    enviado, propaga o erro para que o `run_mission_agents`
///    marque o step como `failed` com mensagem clara. A
///    saída parcial (até onde o stream chegou) é preservada
///    no `AgentStepRecord.outputText` apenas em casos
///    específicos — por padrão, o step é marcado como
///    `failed` para evitar confundir o usuário com output
///    parcial sem flag de erro.
///
/// Esta função NÃO altera o contrato do pipeline — recebe
/// `(app, contexto, mensagens, max_tokens)` e devolve um
/// `MissionChatResult` (com `chunks: u32`).
fn execute_provider_chat_for_agent(
    app: &AppHandle,
    step_id: &str,
    mission_id: &str,
    project_id: &str,
    agent_id: &str,
    agent_name: &str,
    role: &str,
    provider_id: &str,
    model: &str,
    messages: &[providers::ChatMessagePayload],
    max_tokens: Option<u32>,
) -> Result<providers::MissionChatResult, String> {
    // Contadores de chunks para a decisão de fallback.
    let mut chunks_emitted: u32 = 0;
    let stream_result = providers::execute_mission_chat_stream(
        app,
        provider_id,
        model,
        messages,
        max_tokens,
        None,
        |delta: String, index: usize, accumulated: usize| {
            chunks_emitted = chunks_emitted.saturating_add(1);
            emit_agent_event(
                app,
                "agent/step-chunk",
                "info",
                &format!("Chunk {} do agente {} ({} chars).", index, agent_name, delta.chars().count()),
                Some(project_id.to_string()),
                Some(mission_id.to_string()),
                Some(agent_id.to_string()),
                Some(serde_json::json!({
                    "stepId": step_id,
                    "missionId": mission_id,
                    "projectId": project_id,
                    "agentId": agent_id,
                    "agentName": agent_name,
                    "role": role,
                    "chunkIndex": index.saturating_sub(1),
                    "delta": delta,
                    "accumulatedLength": accumulated,
                })),
            );
            Ok(())
        },
    );

    match stream_result {
        Ok(result) => Ok(result),
        Err(err) if chunks_emitted == 0 => {
            // Fallback transparente para não-streaming. A
            // missão prossegue como antes da PR 012.
            eprintln!(
                "[fluxora agents] stream falhou antes do primeiro chunk, fallback para não-streaming: {err}"
            );
            providers::execute_mission_chat(
                app,
                provider_id,
                model,
                messages,
                max_tokens,
            )
        }
        Err(err) => Err(err),
    }
}

/// Executa o pipeline de 4 agentes sequenciais (Planner →
/// Developer → QA → Finalizer) para a missão. Persiste os
/// `AgentStepRecord`, emite eventos `agent/*` e `mission/phase`,
/// e devolve o `MissionAgentsResult`.
///
/// **Esta função NÃO chama o provider diretamente** — ela usa
/// `providers::execute_mission_chat` da PR 007. Se o Developer
/// gerar um bloco `fluxora_patch`, reaproveita
/// `patches::create_proposal_from_provider_text` da PR 010.
///
/// Se algum agente falhar, o step correspondente é marcado como
/// `failed` e a pipeline é interrompida. O erro é retornado para
/// que o `missions_run` marque a missão como `failed`. Falhas do
/// Finalizer são toleráveis: a missão pode completar com o output
/// do último agente bem-sucedido.
pub fn run_mission_agents(
    app: &AppHandle,
    ctx: &MissionAgentContext,
) -> Result<MissionAgentsResult, String> {
    // Garante que os agentes padrão existam.
    let agents = ensure_default_agents(app);
    if agents.is_empty() {
        return Err("Nenhum agente configurado no Agent Engine.".to_string());
    }
    // Limita a `MAX_AGENTS_PER_MISSION`. Os 4 padrão cabem.
    let ordered: Vec<AgentConfigRecord> = {
        let mut copy = agents;
        copy.sort_by(|a, b| a.order.cmp(&b.order));
        copy.truncate(MAX_AGENTS_PER_MISSION);
        copy
    };
    // Filtra apenas agentes `enabled`.
    let enabled: Vec<AgentConfigRecord> = ordered
        .into_iter()
        .filter(|a| a.status == AgentStatus::Enabled.as_str())
        .collect();
    if enabled.is_empty() {
        return Err("Nenhum agente habilitado configurado.".to_string());
    }

    // Acumuladores para QA e Finalizer.
    let mut planner_output: Option<String> = None;
    let mut planner_summary: Option<String> = None;
    let mut developer_output: Option<String> = None;
    let mut developer_summary: Option<String> = None;
    let mut qa_output: Option<String> = None;
    let mut qa_summary: Option<String> = None;
    let mut developer_patch_proposal_id: Option<String> = None;
    let mut finalizer_output: Option<String> = None;

    for (_idx, agent) in enabled.iter().enumerate() {
        // Cria o step inicial.
        let now = now_iso();
        let step = AgentStepRecord {
            id: generate_step_id(),
            mission_id: ctx.mission.id.clone(),
            project_id: ctx.mission.project_id.clone(),
            agent_id: agent.id.clone(),
            agent_name: agent.name.clone(),
            role: agent.role.clone(),
            status: StepStatus::Running.as_str().to_string(),
            input_summary: None,
            output_summary: None,
            output_text: None,
            started_at: Some(now.clone()),
            completed_at: None,
            error: None,
            created_at: now.clone(),
            updated_at: now,
            metadata: None,
        };
        let state = app.state::<AgentsState>();
        insert_step(&state, step.clone());
        let _ = persist_agent_steps(app);
        let step_id = step.id.clone();
        emit_agent_event(
            app,
            "agent/step-started",
            "info",
            &format!("Agente {} iniciou execução.", agent.name),
            Some(ctx.mission.project_id.clone()),
            Some(ctx.mission.id.clone()),
            Some(agent.id.clone()),
            Some(serde_json::json!({
                "stepId": &step_id,
                "role": &agent.role,
                "agentName": &agent.name,
            })),
        );

        // Monta o prompt específico para o agente.
        let (input_summary, messages) = build_agent_messages(
            agent,
            ctx,
            planner_summary.as_deref(),
            developer_summary.as_deref(),
            qa_summary.as_deref(),
            developer_patch_proposal_id.as_deref(),
        );
        // Persiste o input_summary no step.
        let state = app.state::<AgentsState>();
        let _ = update_step(&state, &step_id, |s| {
            s.input_summary = Some(input_summary.clone());
        });
        let _ = persist_agent_steps(app);

        // Resolve provider/model para o agente.
        let provider_id = agent.provider_id.as_deref().unwrap_or(ctx.default_provider_id);
        let model = agent.model.as_deref().unwrap_or(ctx.default_model);

        // PR 012 — Chama o provider com streaming + fallback
        // automático. Cada delta vira um evento
        // `agent/step-chunk`. Se o stream falhar antes de
        // qualquer chunk, faz fallback para `execute_mission_chat`
        // (PR 007) — comportamento idêntico ao da PR 011.
        let result = execute_provider_chat_for_agent(
            app,
            &step_id,
            &ctx.mission.id,
            &ctx.mission.project_id,
            &agent.id,
            &agent.name,
            &agent.role,
            provider_id,
            model,
            &messages,
            Some(2048),
        );

        match result {
            Ok(chat) => {
                let truncated = truncate_output(&chat.text);
                let output_summary = summarize_text(&truncated, 280);
                // Marca o step como completed.
                let state = app.state::<AgentsState>();
                let _ = update_step(&state, &step_id, |s| {
                    s.status = StepStatus::Completed.as_str().to_string();
                    s.output_text = Some(truncated.clone());
                    s.output_summary = Some(output_summary.clone());
                    s.completed_at = Some(now_iso());
                    s.metadata = Some(serde_json::json!({
                        "model": &chat.model,
                        "providerId": &chat.provider_id,
                        "durationMs": chat.duration_ms,
                    }));
                });
                let _ = persist_agent_steps(app);
                emit_agent_event(
                    app,
                    "agent/step-completed",
                    "info",
                    &format!("Agente {} concluído.", agent.name),
                    Some(ctx.mission.project_id.clone()),
                    Some(ctx.mission.id.clone()),
                    Some(agent.id.clone()),
                    Some(serde_json::json!({
                        "stepId": &step_id,
                        "role": &agent.role,
                        "agentName": &agent.name,
                        "outputLength": truncated.chars().count(),
                        "durationMs": chat.duration_ms,
                    })),
                );

                // Pipeline-specific: cada role tem
                // responsabilidade diferente.
                match agent.role.as_str() {
                    "planner" => {
                        planner_output = Some(truncated.clone());
                        planner_summary = Some(output_summary.clone());
                        emit_agent_event(
                            app,
                            "agent/plan-created",
                            "info",
                            "Plano criado pelo Planner.",
                            Some(ctx.mission.project_id.clone()),
                            Some(ctx.mission.id.clone()),
                            Some(agent.id.clone()),
                            Some(serde_json::json!({
                                "stepId": &step_id,
                                "outputLength": truncated.chars().count(),
                            })),
                        );
                    }
                    "developer" => {
                        // Verifica se há bloco fluxora_patch e
                        // cria a proposta via Patch Engine (PR 010).
                        let mut final_truncated = truncated.clone();
                        let mut final_output_summary = output_summary.clone();
                        let mut extract = missions::extract_fluxora_patch_block(&final_truncated);
                        let mut has_patch = extract.files.as_ref().map(|f| !f.is_empty()).unwrap_or(false) && extract.title.is_some();

                        if !has_patch && missions::has_creation_request(ctx.user_prompt) {
                            emit_agent_event(
                                app,
                                "agent/step-chunk",
                                "info",
                                "O Developer não retornou um bloco fluxora_patch válido. Tentando correção automática...",
                                Some(ctx.mission.project_id.clone()),
                                Some(ctx.mission.id.clone()),
                                Some(agent.id.clone()),
                                None,
                            );

                            let mut retry_messages = messages.clone();
                            retry_messages.push(providers::ChatMessagePayload {
                                role: "assistant".to_string(),
                                content: final_truncated.clone(),
                            });
                            retry_messages.push(providers::ChatMessagePayload {
                                role: "user".to_string(),
                                content: "A resposta anterior não contém um bloco fluxora_patch válido.\n\
Converta sua solução em um bloco fluxora_patch válido agora.\n\
Retorne somente o bloco fluxora_patch.".to_string(),
                            });

                            let retry_result = execute_provider_chat_for_agent(
                                app,
                                &step_id,
                                &ctx.mission.id,
                                &ctx.mission.project_id,
                                &agent.id,
                                &agent.name,
                                &agent.role,
                                provider_id,
                                model,
                                &retry_messages,
                                Some(2048),
                            );

                            match retry_result {
                                Ok(chat) => {
                                    let retry_truncated = truncate_output(&chat.text);
                                    let retry_summary = summarize_text(&retry_truncated, 280);
                                    let retry_extract = missions::extract_fluxora_patch_block(&retry_truncated);
                                    let retry_has_patch = retry_extract.files.as_ref().map(|f| !f.is_empty()).unwrap_or(false) && retry_extract.title.is_some();
                                    
                                    if retry_has_patch {
                                        final_truncated = retry_truncated;
                                        final_output_summary = retry_summary;
                                        extract = retry_extract;
                                        has_patch = true;

                                        // Atualiza o step com o novo texto de sucesso da retry
                                        let state = app.state::<AgentsState>();
                                        let _ = update_step(&state, &step_id, |s| {
                                            s.output_text = Some(final_truncated.clone());
                                            s.output_summary = Some(final_output_summary.clone());
                                        });
                                        let _ = persist_agent_steps(app);
                                    } else {
                                        eprintln!("[fluxora agents] segunda tentativa não retornou patch válido.");
                                    }
                                }
                                Err(err) => {
                                    eprintln!("[fluxora agents] erro na chamada de segunda tentativa: {err}");
                                }
                            }
                        }

                        developer_output = Some(final_truncated.clone());
                        developer_summary = Some(final_output_summary.clone());

                        if has_patch {
                            let files = extract.files.unwrap();
                            let title = extract.title.unwrap();
                            // HOTFIX UI E2E — Log seguro da
                            // detecção de patch no Developer.
                            eprintln!(
                                "[Fluxora E2E Disk] developer_has_patch missionId={} projectId={} filesCount={} title={}",
                                ctx.mission.id,
                                ctx.mission.project_id,
                                files.len(),
                                title
                            );
                            match crate::patches::create_proposal_from_provider_text(
                                app,
                                ctx.mission,
                                title.clone(),
                                extract.summary.clone(),
                                files.clone(),
                            ) {
                                Ok((proposal, _log)) => {
                                    developer_patch_proposal_id =
                                        Some(proposal.id.clone());
                                    let state = app.state::<AgentsState>();
                                    let _ = update_step(
                                        &state,
                                        &step_id,
                                        |s| {
                                            if let Some(meta) = s.metadata.as_mut() {
                                                if let Some(obj) = meta.as_object_mut() {
                                                    obj.insert(
                                                        "proposalId".to_string(),
                                                        serde_json::Value::String(
                                                            proposal.id.clone(),
                                                        ),
                                                    );
                                                    obj.insert(
                                                        "proposalStatus".to_string(),
                                                        serde_json::Value::String(
                                                            proposal.status.clone(),
                                                        ),
                                                    );
                                                    obj.insert(
                                                        "filesCount".to_string(),
                                                        serde_json::Value::Number(
                                                            serde_json::Number::from(
                                                                proposal.files.len() as u64,
                                                            ),
                                                        ),
                                                    );
                                                }
                                            }
                                        },
                                    );
                                    let _ = persist_agent_steps(app);
                                }
                                Err(error) => {
                                    eprintln!(
                                        "[fluxora agents] patch proposal rejeitada: {error}"
                                    );
                                }
                            }
                        }
                    }
                    "qa" => {
                        qa_output = Some(truncated.clone());
                        qa_summary = Some(output_summary.clone());
                        emit_agent_event(
                            app,
                            "agent/qa-completed",
                            "info",
                            "QA revisou a proposta do Developer.",
                            Some(ctx.mission.project_id.clone()),
                            Some(ctx.mission.id.clone()),
                            Some(agent.id.clone()),
                            Some(serde_json::json!({
                                "stepId": &step_id,
                                "outputLength": truncated.chars().count(),
                            })),
                        );
                    }
                    "finalizer" => {
                        finalizer_output = Some(truncated);
                    }
                    _ => {
                        // Custom: apenas registrado no step.
                    }
                }
            }
            Err(error) => {
                let truncated_err = truncate_error(&error);
                let state = app.state::<AgentsState>();
                let _ = update_step(&state, &step_id, |s| {
                    s.status = StepStatus::Failed.as_str().to_string();
                    s.error = Some(truncated_err.clone());
                    s.completed_at = Some(now_iso());
                });
                let _ = persist_agent_steps(app);
                emit_agent_event(
                    app,
                    "agent/step-failed",
                    "error",
                    &format!("Agente {} falhou: {}", agent.name, truncated_err),
                    Some(ctx.mission.project_id.clone()),
                    Some(ctx.mission.id.clone()),
                    Some(agent.id.clone()),
                    Some(serde_json::json!({
                        "stepId": &step_id,
                        "role": &agent.role,
                        "agentName": &agent.name,
                        "errorMessage": truncated_err,
                    })),
                );
                // Falhas do Finalizer são toleráveis: a missão
                // pode completar com o output do último agente
                // que teve sucesso.
                if agent.role == "finalizer" {
                    let last_output = finalizer_output
                        .clone()
                        .or(qa_output.clone())
                        .or(developer_output.clone())
                        .or(planner_output.clone())
                        .unwrap_or_else(|| {
                            "(Sem output do Finalizer.)".to_string()
                        });
                    return Ok(MissionAgentsResult {
                        finalizer_output: last_output,
                        patch_proposal_id: developer_patch_proposal_id,
                    });
                }
                return Err(format!(
                    "Agente '{}' ({}) falhou: {}",
                    agent.name, agent.role, truncated_err
                ));
            }
        }
    }

    // Após o loop, o `finalizer_output` é o `truncated` do
    // Finalizer. Se o Finalizer não estiver nos 4 padrão
    // (improvável), caímos para o output do último agente que
    // retornou algo.
    let result = finalizer_output
        .or(qa_output)
        .or(developer_output)
        .or(planner_output)
        .unwrap_or_else(|| "(Sem output do Finalizer.)".to_string());

    Ok(MissionAgentsResult {
        finalizer_output: result,
        patch_proposal_id: developer_patch_proposal_id,
    })
}

// ---------------------------------------------------------------------------
// Construção de prompts por agente
// ---------------------------------------------------------------------------

/// Gera o `input_summary` e a lista de mensagens para um agente
/// específico. O conteúdo é construído de forma a NUNCA expor o
/// `outputText` completo do provider anterior — apenas o
/// `output_summary` curto. Nenhum chain-of-thought é preservado
/// entre agentes.
fn build_agent_messages(
    agent: &AgentConfigRecord,
    ctx: &MissionAgentContext,
    planner_summary: Option<&str>,
    developer_summary: Option<&str>,
    qa_summary: Option<&str>,
    developer_patch_proposal_id: Option<&str>,
) -> (String, Vec<providers::ChatMessagePayload>) {
    let system = agent
        .system_prompt
        .clone()
        .unwrap_or_else(|| "Você é um agente do Fluxora.".to_string());

    // Resumos (curtos) dos outputs anteriores para incluir no
    // prompt do agente.
    let planner_block = planner_summary
        .unwrap_or("(Planner ainda não executou.)")
        .to_string();
    let developer_block = developer_summary
        .unwrap_or("(Developer ainda não executou.)")
        .to_string();
    let qa_block = qa_summary.unwrap_or("(QA ainda não executou.)").to_string();
    let patch_block = developer_patch_proposal_id
        .map(|id| format!("PatchProposal criada com id '{id}' (status pendente de aprovação)."))
        .unwrap_or_else(|| "Nenhuma PatchProposal gerada.".to_string());

    // User message — construída por role.
    let user = match agent.role.as_str() {
        "planner" => format!(
            "Missão do usuário: {prompt}\n\n\
Contexto do projeto '{name}' (stack: {stack}):\n{ctx}\n\n\
Sua tarefa: criar um plano de ação detalhado. Não proponha patches.",
            prompt = ctx.user_prompt,
            name = ctx.project_name,
            stack = if ctx.project_stack.is_empty() {
                "(não detectada)".to_string()
            } else {
                ctx.project_stack.join(", ")
            },
            ctx = ctx.context_text,
        ),
        "developer" => format!(
            "Missão do usuário: {prompt}\n\n\
Contexto do projeto '{name}':\n{ctx}\n\n\
Plano do Planner:\n{plan}\n\n\
Sua tarefa: propor a solução. Quando a missão pedir criar, crie, implementar, implemente, construir, construa, gerar, gere, adicionar, adicione, alterar, altere, editar, edite, fazer uma página, faça uma página, landing page, componente, arquivo ou código, você DEVE incluir obrigatoriamente um bloco fluxora_patch ao final da resposta no seguinte formato JSON:\n\n\
```fluxora_patch\n\
{{\n  \"title\": \"Resumo curto\",\n  \"summary\": \"Descrição\",\n  \"files\": [\n    {{\n      \"path\": \"index.html\",\n      \"operation\": \"create\",\n      \"afterContent\": \"conteúdo completo\"\n    }}\n  ]\n}}\n\
```\n\n\
Regras:\n\
- Não responda apenas com plano, não diga \"eu criaria\", e não diga que criou se não retornou o patch.\n\
- Use apenas caminhos relativos ao projeto (NUNCA use path absoluto, NUNCA use \"..\").\n\
- operation deve ser \"create\", \"modify\" ou \"delete\". Para arquivos novos, use \"create\". Para alterações, use \"modify\".\n\
- Para \"create\" e \"modify\", envie o conteúdo final completo em afterContent (NUNCA use placeholders or incomplete files).\n\
- Para \"delete\", use operation: \"delete\" sem afterContent.\n\
- NUNCA escreva ou altere arquivos em: .git, node_modules, vendor, dist, target, build, .next, .cache, .turbo, out.",
            prompt = ctx.user_prompt,
            name = ctx.project_name,
            ctx = ctx.context_text,
            plan = planner_block,
        ),
        "qa" => format!(
            "Missão do usuário: {prompt}\n\n\
Plano do Planner:\n{plan}\n\n\
Proposta do Developer:\n{dev}\n\n\
Status de patch: {patch}\n\n\
Sua tarefa: revisar a proposta e listar problemas, riscos, \
aprovação/reprovação e recomendações. Não execute testes reais. \
Não altere arquivos.",
            prompt = ctx.user_prompt,
            plan = planner_block,
            dev = developer_block,
            patch = patch_block,
        ),
        "finalizer" => format!(
            "Missão do usuário: {prompt}\n\n\
Plano do Planner:\n{plan}\n\n\
Proposta do Developer:\n{dev}\n\n\
Revisão do QA:\n{qa}\n\n\
Status de patch: {patch}\n\n\
Sua tarefa: consolidar o resultado final para o usuário. \
Seja conciso. Liste: o que foi feito, o que foi proposto, \
o que precisa de aprovação, próximos passos.",
            prompt = ctx.user_prompt,
            plan = planner_block,
            dev = developer_block,
            qa = qa_block,
            patch = patch_block,
        ),
        _ => format!(
            "Missão: {prompt}\n\nContexto:\n{ctx}",
            prompt = ctx.user_prompt,
            ctx = ctx.context_text,
        ),
    };

    let input_summary = truncate_input_summary(&user);

    let messages = vec![
        providers::ChatMessagePayload {
            role: "system".to_string(),
            content: system,
        },
        providers::ChatMessagePayload {
            role: "user".to_string(),
            content: user,
        },
    ];
    (input_summary, messages)
}

/// Gera um resumo curto (até `max_chars` chars) do texto.
/// Implementação intencionalmente simples: pega o primeiro
/// parágrafo (até a primeira linha em branco), ou os primeiros
/// `max_chars` chars, com reticências.
fn summarize_text(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "(vazio)".to_string();
    }
    let first_paragraph = trimmed.split("\n\n").next().unwrap_or(trimmed).trim();
    let one_line = first_paragraph.replace('\n', " ");
    if one_line.chars().count() <= max_chars {
        return one_line;
    }
    let mut out: String = one_line.chars().take(max_chars).collect();
    out.push('…');
    out
}

// Silencia o warning de unused — re-exportado para uso futuro.
#[allow(dead_code)]
const AGENT_CHAT_TIMEOUT_MS: u64 = providers::MISSION_CHAT_TIMEOUT_MS;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_long_output() {
        let big = "a".repeat((MAX_STEP_OUTPUT_BYTES as usize) + 10);
        let out = truncate_output(&big);
        assert!(out.len() <= MAX_STEP_OUTPUT_BYTES as usize + 5);
    }

    #[test]
    fn truncates_long_input_summary() {
        let big = "b".repeat(MAX_INPUT_SUMMARY_CHARS + 50);
        let out = truncate_input_summary(&big);
        assert!(out.chars().count() <= MAX_INPUT_SUMMARY_CHARS + 1);
    }

    #[test]
    fn truncates_long_error() {
        let big = "c".repeat(MAX_ERROR_MESSAGE_CHARS + 50);
        let out = truncate_error(&big);
        assert!(out.chars().count() <= MAX_ERROR_MESSAGE_CHARS + 1);
    }

    #[test]
    fn agent_status_roundtrip() {
        assert_eq!(AgentStatus::from_str("enabled").as_str(), "enabled");
        assert_eq!(AgentStatus::from_str("DISABLED").as_str(), "disabled");
        assert_eq!(AgentStatus::from_str("unknown").as_str(), "disabled");
    }

    #[test]
    fn step_status_roundtrip() {
        assert_eq!(StepStatus::from_str("running").as_str(), "running");
        assert_eq!(StepStatus::from_str("FAILED").as_str(), "failed");
        assert_eq!(StepStatus::from_str("unknown").as_str(), "pending");
    }

    #[test]
    fn summarize_short_text_returns_as_is() {
        let summary = summarize_text("Olá mundo", 100);
        assert_eq!(summary, "Olá mundo");
    }

    #[test]
    fn summarize_long_text_truncates() {
        let big = "x".repeat(500);
        let summary = summarize_text(&big, 50);
        assert!(summary.chars().count() <= 51);
        assert!(summary.ends_with('…'));
    }

    #[test]
    fn summarize_empty_text_returns_marker() {
        let summary = summarize_text("", 100);
        assert_eq!(summary, "(vazio)");
    }
}
