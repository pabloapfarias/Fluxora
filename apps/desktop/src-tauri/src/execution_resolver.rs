// PR 014 — Fonte única de resolução de execução.
//
// Esta camada é o ÚNICO lugar onde provider/modelo efetivo e
// readiness de cada agente são calculados. Ela é reusada por:
//  - `missions_run` (antes de chamar o Agent Engine)
//  - `missions_get_readiness` (comando Tauri exposto à UI)
//  - O diagnóstico da missão (via `missions_get_readiness`)
//  - A AgentsPage (via `missions_get_readiness`)
//
// Os 4 agentes reais do Agent Engine (Planner / Developer / QA /
// Finalizer) são restaurados sob demanda quando o `agents.json`
// está vazio, garantindo que a readiness sempre fale sobre o
// pipeline real.
//
// Não há fallback para tipos legados (`AgentRole::BackendDev` /
// `FrontendDev` / `MobileDev` / `Orchestrator`) — o resolver só
// conhece `FluxoraAgentRole` (`planner` / `developer` / `qa` /
// `finalizer` / `custom`).

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::agents::{self, AgentConfigRecord, AgentStatus};
use crate::providers::{self, ProvidersState, StoredProvider};

/// Roles canônicos que o pipeline atual sempre executa.
/// Mantidos em sincronia com `REAL_DEFAULT_ROLES` em
/// `packages/shared/src/index.ts`.
pub(crate) const REAL_DEFAULT_ROLES: [&str; 4] = ["planner", "developer", "qa", "finalizer"];

/// Provider/modelo efetivo resolvido para um único agente real.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveExecutionAgent {
    pub agent_id: String,
    pub name: String,
    pub role: String,
    pub order: u32,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub inherits_provider: bool,
    pub inherits_model: bool,
    pub ready: bool,
    pub issues: Vec<String>,
}

/// Readiness agregada de uma missão.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionExecutionReadiness {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    pub agents: Vec<EffectiveExecutionAgent>,
    pub ready: bool,
    pub issues: Vec<String>,
    pub resolved_at: String,
}

/// Parâmetros de entrada aceitos pelo resolver. Todos os campos
/// são opcionais — o resolver sempre consulta o estado real do
/// backend (`providers.json` + `agents.json`) para preencher o
/// que faltar.
#[derive(Debug, Clone, Default)]
pub(crate) struct ResolveReadinessInput {
    pub project_id: Option<String>,
    pub mission_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let datetime = format_iso(secs);
    datetime
}

fn format_iso(unix_secs: u64) -> String {
    // Formato ISO 8601 simplificado (UTC) — mesmo estilo do
    // restante do backend.
    let days_since_epoch = (unix_secs / 86_400) as i64;
    let secs_of_day = unix_secs % 86_400;
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let (year, month, day) = civil_from_days(days_since_epoch);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

/// Encontra o provider real a usar como fallback quando o agente
/// não tem `providerId` próprio. Mesma regra de `missions_run`:
/// 1. `explicit` (informado no input).
/// 2. Primeiro provider `enabled` com `defaultModel` configurado.
/// 3. Primeiro provider `enabled` qualquer.
fn resolve_fallback_provider(
    state: &ProvidersState,
    explicit: Option<&str>,
) -> Option<StoredProvider> {
    let snapshot = state.snapshot();
    if let Some(id) = explicit {
        if let Some(p) = snapshot
            .iter()
            .find(|p| p.enabled && p.id == id)
            .cloned()
        {
            return Some(p);
        }
    }
    if let Some(p) = snapshot
        .iter()
        .find(|p| p.enabled && p.default_model.is_some())
        .cloned()
    {
        return Some(p);
    }
    snapshot.into_iter().find(|p| p.enabled)
}

fn resolve_agent(
    agent: &AgentConfigRecord,
    fallback_provider_id: Option<&str>,
    _fallback_provider_name: Option<&str>,
    fallback_model: Option<&str>,
    providers_snapshot: &[StoredProvider],
) -> EffectiveExecutionAgent {
    let inherits_provider = agent.provider_id.is_none();
    let inherits_model = agent.model.is_none();
    let effective_provider_id: Option<String> = if inherits_provider {
        fallback_provider_id.map(|s| s.to_string())
    } else {
        agent.provider_id.clone()
    };
    let effective_model: Option<String> = if inherits_model {
        fallback_model.map(|s| s.to_string())
    } else {
        agent.model.clone()
    };
    let mut issues: Vec<String> = Vec::new();
    let enabled = agent.status == AgentStatus::Enabled.as_str();
    if !enabled {
        issues.push(
            "Agente desabilitado. Habilite o agente para executar a missão.".to_string(),
        );
    }
    let provider_meta: Option<(String, String)> = match effective_provider_id.as_deref() {
        Some(id) => {
            let found = providers_snapshot.iter().find(|p| p.id == id);
            match found {
                Some(p) => Some((p.id.clone(), p.name.clone())),
                None => {
                    issues.push(format!(
                        "Provider '{id}' não encontrado no Provider Engine."
                    ));
                    Some((id.to_string(), id.to_string()))
                }
            }
        }
        None => None,
    };
    if let Some((id, name)) = &provider_meta {
        let provider = providers_snapshot.iter().find(|p| p.id == *id);
        if let Some(p) = provider {
            if !p.enabled {
                issues.push(format!("Provider '{name}' está desabilitado."));
            } else if p.default_model.is_none() && inherits_model {
                issues.push(format!(
                    "Provider '{name}' sem modelo padrão. Defina um modelo padrão para executar missões."
                ));
            }
        }
    } else {
        issues.push(
            "Nenhum provider configurado. Cadastre um provider em Configurações > Providers."
                .to_string(),
        );
    }
    let model_trim = effective_model.as_deref().map(|s| s.trim()).unwrap_or("");
    if model_trim.is_empty() {
        issues.push(
            "Nenhum modelo selecionado. Defina um modelo padrão para executar missões."
                .to_string(),
        );
    }
    let ready = enabled
        && provider_meta.is_some()
        && !model_trim.is_empty()
        && !issues
            .iter()
            .any(|issue| issue.contains("desabilitado") || issue.contains("não encontrado"));
    let (provider_id, provider_name) = match provider_meta {
        Some((id, name)) => (Some(id), Some(name)),
        None => (None, None),
    };
    EffectiveExecutionAgent {
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        role: agent.role.clone(),
        order: agent.order,
        enabled,
        provider_id,
        provider_name,
        model: if model_trim.is_empty() {
            None
        } else {
            Some(model_trim.to_string())
        },
        inherits_provider,
        inherits_model,
        ready,
        issues,
    }
}

/// Resolve a readiness de uma missão usando SOMENTE dados reais
/// (Agent Engine + Provider Engine). Retorna:
/// - `defaultProviderId` / `defaultModel`: o que será usado
///   pela execução;
/// - `agents`: a lista efetiva (sempre os 4 papéis reais;
///   agents `custom` extras são incluídos ao final);
/// - `ready`: true apenas quando TODOS os 4 agentes estão
///   `ready` e não há issues globais.
pub fn resolve_mission_readiness(
    app: &AppHandle,
    input: ResolveReadinessInput,
) -> MissionExecutionReadiness {
    // 1. Garante que os agentes padrão existam (idempotente).
    let agents = agents::ensure_default_agents(app);
    let mut sorted_agents = agents;
    sorted_agents.sort_by(|a, b| a.order.cmp(&b.order));

    // 2. Resolve fallback real do Mission Engine.
    let providers_state = app.state::<providers::ProvidersState>();
    let providers_snapshot = providers_state.snapshot();
    let fallback = resolve_fallback_provider(&providers_state, input.provider_id.as_deref());
    let fallback_provider_id = fallback.as_ref().map(|p| p.id.clone());
    let fallback_provider_name = fallback.as_ref().map(|p| p.name.clone());
    let fallback_model: Option<String> = input
        .model
        .clone()
        .or_else(|| fallback.as_ref().and_then(|p| p.default_model.clone()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 3. Issues globais sobre provider/modelo.
    let mut issues: Vec<String> = Vec::new();
    match fallback.as_ref() {
        None => issues.push(
            "Nenhum provider configurado. Cadastre um provider em Configurações > Providers."
                .to_string(),
        ),
        Some(p) => {
            if !p.enabled {
                issues.push(format!("Provider '{}' está desabilitado.", p.name));
            } else if fallback_model.is_none() {
                issues.push(format!(
                    "Provider '{}' sem modelo padrão. Defina um modelo padrão para executar missões.",
                    p.name
                ));
            }
        }
    }

    // 4. Calcula readiness por agente real (Planner / Developer /
    //    QA / Finalizer). Surface dos custom ao final.
    let mut resolved: Vec<EffectiveExecutionAgent> = Vec::new();
    let mut missing_roles: Vec<&str> = Vec::new();
    for role in REAL_DEFAULT_ROLES.iter() {
        let matched = sorted_agents.iter().find(|a| a.role == *role).cloned();
        match matched {
            Some(agent) => resolved.push(resolve_agent(
                &agent,
                fallback_provider_id.as_deref(),
                fallback_provider_name.as_deref(),
                fallback_model.as_deref(),
                &providers_snapshot,
            )),
            None => missing_roles.push(role),
        }
    }
    for role in missing_roles.iter() {
        issues.push(format!(
            "Agente real ausente: {role}. Restaure os agentes padrão na tela de Agentes."
        ));
    }
    for agent in sorted_agents.iter() {
        if REAL_DEFAULT_ROLES.contains(&agent.role.as_str()) {
            continue;
        }
        resolved.push(resolve_agent(
            agent,
            fallback_provider_id.as_deref(),
            fallback_provider_name.as_deref(),
            fallback_model.as_deref(),
            &providers_snapshot,
        ));
    }

    // 5. Decide `ready` global.
    let all_default_ready = resolved
        .iter()
        .filter(|a| REAL_DEFAULT_ROLES.contains(&a.role.as_str()))
        .all(|a| a.ready);
    let ready = all_default_ready && missing_roles.is_empty() && issues.is_empty();

    MissionExecutionReadiness {
        project_id: input.project_id,
        mission_id: input.mission_id,
        default_provider_id: fallback_provider_id,
        default_provider_name: fallback_provider_name,
        default_model: fallback_model,
        agents: resolved,
        ready,
        issues,
        resolved_at: now_iso(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_days_matches_well_known_dates() {
        // 2026-01-01 → unix days since 1970-01-01 = 20454
        let (y, m, d) = civil_from_days(20454);
        assert_eq!((y, m, d), (2026, 1, 1));
        // 1970-01-01 → 0
        let (y, m, d) = civil_from_days(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }
}