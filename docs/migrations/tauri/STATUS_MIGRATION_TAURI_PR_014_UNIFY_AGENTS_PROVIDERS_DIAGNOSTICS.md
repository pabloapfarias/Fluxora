# STATUS_MIGRATION_TAURI_PR_014_UNIFY_AGENTS_PROVIDERS_DIAGNOSTICS

## 1. Objetivo da PR 014

Eliminar divergências entre `AgentsPage`, `Mission Engine`, diagnóstico da missão, recomendação por stack e execução real. O Fluxora passa a ter uma única fonte de verdade para:

- Providers reais (`providers.json`).
- Modelo padrão de execução.
- Agentes reais (`agents.json`).
- Provider/modelo efetivo de cada agente.
- Diagnóstico da missão.
- Recomendação de agentes por stack.
- Status de prontidão antes de executar uma missão.

Regra de produto: se a tela de Agentes mostra Planner, Developer, QA e Finalizer habilitados com provider/modelo efetivo, o diagnóstico da missão mostra exatamente os mesmos agentes e o mesmo provider/modelo efetivo.

## 2. Problema encontrado (antes da PR 014)

- `AgentsPage` consumia `agents.listConfigs()` + `providers.list()` + `deriveProviderEngineGlobalDefault` e mostrava `provider-1781834595533-0` / `deepseek-v4-flash` como efetivo.
- `MissionDiagnosticModal` consumia `agents: Agent[]` (tipo legado) + `getMissionAgentRequirements(intent, suggestedAgents)` (que retornava `["planner", "backend-dev" | "frontend-dev" | "mobile-dev", "qa"]`) + `getAgentReadiness(agent)` (legado, sem fallback real).
- O resultado era:
  - Planner aparecia sem provider selecionado.
  - Developer aparecia como `Backend Dev`.
  - QA aparecia sem provider selecionado.
  - Diagnóstico dizia "Nenhum provider selecionado", "Nenhum fallback real do Mission Engine está disponível", "Nenhum modelo selecionado" — mesmo quando AgentsPage mostrava o contrário.
- Recomendação por stack (`recommendDeveloperRoleForStack` etc.) estava decidindo o `Developer` da execução, podendo trocar Developer por Backend Dev / Frontend Dev / Mobile Dev.
- `OverviewPage` chamava `window.fluxora.agents.list()` (legado, retornava `Agent` com `orchestrator`, `backend-dev`, `frontend-dev`, `mobile-dev`, `qa`, `devops`) em vez de `agents.listConfigs()`.
- Mocks (`mock-api.ts`) usavam heurística de regex de prompt para escolher `devVariant = "backend-dev" | "frontend-dev" | "mobile-dev"` — fora de sincronia com a arquitetura atual.

## 3. Por que AgentsPage, diagnóstico e execução divergiam

Três fontes de verdade coexistiam:

1. **Frontend legacy** (`getMissionAgentRequirements` + `Agent` legado) — usado pelo `MissionDiagnosticModal` e pelo `OverviewPage` para pré-checagem. Não enxergava `providers.json` nem `agents.json` reais.
2. **Frontend real parcial** (`AgentsPage` com `deriveProviderEngineGlobalDefault`) — mostrava provider efetivo correto, mas só para a tela de Agentes.
3. **Backend real** (`missions_run` em `missions.rs` + `agents::run_mission_agents` em `agents.rs`) — resolvia provider/modelo real, mas a UI nunca consultava essa resolução diretamente. O diagnóstico recalculava `readiness` no lado frontend com dados desatualizados.

## 4. Fontes antigas removidas

- `getMissionAgentRequirements(intent, suggestedAgents)` como fonte ativa da UI de diagnóstico. Marcada como `@deprecated` em `packages/shared/src/index.ts` e removida do fluxo do `OverviewPage`/`MissionDiagnosticModal`.
- `recordProjectRecommendation` / `appendProjectRecommendationHistory` como persistência automática. Removidos do fluxo de submit (`handleCommandSubmit`).
- `savedRecommendation` / `recommendationHistory` no `MissionDiagnosticModal`. Removidos (a recomendação por stack agora é apenas um hint decorativo na nova seção "Recomendação de especialização").
- Heurística `devVariant = "backend-dev" | "frontend-dev" | "mobile-dev"` em `mock-api.ts` baseada em regex de prompt. Substituída por Developer fixo.
- `agents.list()` (legado) continua existindo para mocks, mas a UI ativa parou de chamá-lo. `AgentsPage` usa `agents.listConfigs()` + `agents.updateConfig()` + `models.updateAgentConfigModel()`.
- Tipos `BuiltInAgentRole`, `CustomAgentRole`, `AgentRole`, `MultiAgentRole`, `AgentStepOutput`, `Agent`, `BUILT_IN_AGENT_ROLES` marcados como `@deprecated` em JSDoc, mas mantidos para compatibilidade de mocks e adaptadores.

## 5. Nova fonte única de verdade

### 5.1 Backend Rust — `execution_resolver.rs`

Novo módulo `apps/desktop/src-tauri/src/execution_resolver.rs` com a função:

```rust
pub fn resolve_mission_readiness(
    app: &AppHandle,
    input: ResolveReadinessInput,
) -> MissionExecutionReadiness
```

Responsabilidades:

- Garantir que os 4 agentes padrão (`Planner` / `Developer` / `QA` / `Finalizer`) existam em `agents.json` antes de calcular a readiness (idempotente via `agents::ensure_default_agents`).
- Resolver o `fallbackProviderId` + `defaultModel` no Provider Engine com a mesma regra do `missions_run`:
  1. `explicit` (informado no input).
  2. Primeiro provider `enabled` com `defaultModel`.
  3. Primeiro provider `enabled`.
- Calcular `EffectiveExecutionAgent` para cada papel real (Planner / Developer / QA / Finalizer) e incluir custom ao final.
- Devolver `MissionExecutionReadiness { defaultProviderId, defaultProviderName, defaultModel, agents, ready, issues, resolvedAt }`.

Regras de resolução por agente:

- Provider do agente se definido; senão provider da missão; senão `fallbackProviderId`.
- Model do agente se definido; senão model da missão; senão `provider.defaultModel`.
- Status `enabled` obrigatório.
- Mensagens de erro claras para a UI (sem termos internos como "fallback real do Mission Engine").

### 5.2 Frontend — `packages/shared/src/index.ts`

Função espelho para o fallback browser (Vite dev):

```ts
export function resolveExecutionReadiness(
  input: ResolveExecutionReadinessInput
): MissionExecutionReadiness
```

Mesma lógica, mesmos 4 papéis, mesmas mensagens.

### 5.3 Comando Tauri

```rust
#[tauri::command]
fn missions_get_readiness(
    app: AppHandle,
    payload: MissionReadinessPayload,
) -> MissionExecutionReadiness
```

`desktopBridge.missions.getReadiness({ projectId?, missionId?, providerId?, model? })` chama esse comando em runtime Tauri e cai no `resolveExecutionReadiness` em browser.

## 6. Como provider/modelo efetivo é resolvido

Ordem de prioridade (idêntica no backend Rust e no frontend):

1. `input.providerId` (override explícito do caller).
2. Primeiro provider `enabled` em `providers.json`.
3. (em fallback browser) `deriveProviderEngineGlobalDefault` faz a mesma coisa.

Modelo:

1. `input.model` (override explícito).
2. `provider.defaultModel` do provider resolvido.

Por agente:

- `agent.providerId` tem prioridade absoluta sobre o fallback.
- `agent.model` tem prioridade absoluta sobre `provider.defaultModel`.
- Quando `agent.providerId` é `null` e o agente está habilitado, o agente **herda** o provider padrão.
- Quando `agent.model` é `null`, o agente **herda** o modelo padrão do provider efetivo.

## 7. Como agentes efetivos são resolvidos

1. Backend chama `agents::ensure_default_agents(app)` — cria Planner / Developer / QA / Finalizer em `agents.json` se ausentes (idempotente).
2. Para cada papel real (`planner`, `developer`, `qa`, `finalizer`), busca o agente correspondente em `agents.json` pelo `role`.
3. Se algum papel estiver ausente, marca `issues[]` com `"Agente real ausente: <role>. Restaure os agentes padrão na tela de Agentes."`.
4. Calcula `providerId` / `model` efetivo conforme seção 6.
5. `ready === true` apenas quando:
   - Há um provider real configurado.
   - O provider tem `defaultModel` ou o caller forneceu `model`.
   - Todos os 4 papéis reais existem.
   - Todos os 4 papéis têm provider/modelo efetivo resolvido.

## 8. Como diagnóstico da missão funciona agora

`MissionDiagnosticModal` foi reescrito. Props antigas (`agents: Agent[]`, `catalog`, `hasEnabledProvider`, `activeProjectStack`, `savedRecommendation`, `recommendationHistory`) foram removidas.

Novas props:

```ts
interface MissionDiagnosticModalProps {
  intent: string;
  projectId?: string;
  onClose: () => void;
  onGoToAgents: () => void;
}
```

Fluxo:

1. `useEffect` chama `window.fluxora.missions.getReadiness({ projectId })`.
2. Renderiza bloco de "Provider padrão de execução" (nome do provider + modelo).
3. Renderiza lista dos 4 agentes reais com `providerName`, `model`, origem (herdado / próprio), status (Pronto / Pendente) e `issues`.
4. Renderiza pendências globais (`issues[]` da readiness).
5. Seção "Recomendação de especialização" — apenas um hint decorativo, deixando claro que "a execução continua usando Developer / QA / Planner / Finalizer".
6. Removeu: lista de Backend Dev / Frontend Dev / Mobile Dev / Orquestrador, "Agentes exigidos" baseados em `getMissionAgentRequirements`, "Histórico de recomendações deste projeto", "Recomendação por stack" como fonte ativa.

## 9. Como AgentsPage funciona agora

`AgentsPage` continua listando agentes via `window.fluxora.agents.listConfigs()` e mantém o formulário de edição (provider + modelo específicos por agente).

Mudanças:

- Agora consulta também `window.fluxora.missions.getReadiness()` e usa o resultado como **fonte primária** do provider/modelo efetivo exibido por agente.
- Texto do banner: `"Usa o provider padrão de execução quando nenhum provider específico é definido."` (substituiu `"Este agente herda provider/modelo da missão ou do fallback real do Mission Engine."`).
- Banner global: `"Provider padrão de execução: <id> / <model>"` (substituiu `"Fallback real atual do Mission Engine: ..."`).
- Empty state: `"Nenhum provider configurado. Cadastre um provider em Configurações > Providers."` (substituiu `"Nenhum fallback real disponível. Configure um provider habilitado com defaultModel."`).

## 10. Como recomendação por stack foi removida / rebaixada

- `recommendDeveloperRoleForStack`, `recommendPlannerRoleForStack`, `recommendQaRoleForStack` continuam existindo em `shared` (marcadas como `@deprecated`).
- `OverviewPage` parou de usá-las para decidir agentes da missão.
- `MissionDiagnosticModal` mostra apenas um bloco "Recomendação de especialização" deixando claro que a execução **não** troca Developer por Backend Dev / Frontend Dev / Mobile Dev.
- Persistência automática de `ProjectRecommendation` / `ProjectRecommendationHistory` foi removida do fluxo de submit.

## 11. Alterações no backend Rust

### Novos arquivos
- `apps/desktop/src-tauri/src/execution_resolver.rs` — fonte única de resolução de execução.

### `apps/desktop/src-tauri/src/lib.rs`
- Adicionado `mod execution_resolver;`.
- Adicionado `use execution_resolver::{MissionExecutionReadiness, ResolveReadinessInput};`.
- Adicionado comando Tauri `missions_get_readiness` registrado no `invoke_handler`.

### `apps/desktop/src-tauri/src/missions.rs`
- `missions_run` agora consulta `execution_resolver::resolve_mission_readiness` antes de resolver provider/model, e usa `readiness.defaultModel` / `readiness.issues` para mensagens de erro alinhadas com a UI.
- Falha de `mission_run` agora emite mensagens idênticas às exibidas no diagnóstico.

## 12. Alterações no `desktopBridge`

- Adicionado import `MissionExecutionReadiness` e `resolveExecutionReadiness` em `@fluxora/shared`.
- Adicionado helper `getReadinessTauri(input)` que delega para `missions_get_readiness` em runtime Tauri e para `resolveExecutionReadiness` em browser.
- Adicionado `missions.getReadiness(input?)` no objeto `missions` da `FluxoraAPI`.

## 13. Alterações no `packages/shared`

- Novos tipos `EffectiveExecutionAgent` e `MissionExecutionReadiness` com `providerId`/`providerName`/`model`/`inheritsProvider`/`inheritsModel`/`ready`/`issues`.
- Nova função `resolveExecutionReadiness(input: ResolveExecutionReadinessInput): MissionExecutionReadiness` — espelho TS do `execution_resolver.rs`.
- `FluxoraAPI.missions.getReadiness(input?)` adicionado à interface.
- Tipos legados (`BuiltInAgentRole`, `CustomAgentRole`, `AgentRole`, `Agent`) marcados como `@deprecated` em JSDoc com nota explicando que a readiness real é a fonte de verdade.
- `getMissionAgentRequirements`, `recommendDeveloperRoleForStack`, `STACK_DEVELOPER_RECOMMENDATION`, `recommendProjectStackLabel`, `recordProjectRecommendation`, `appendProjectRecommendationHistory` marcadas como `@deprecated` em JSDoc.

## 14. Alterações na UI

### `apps/desktop/src/pages/AgentsPage.tsx`
- Consome `window.fluxora.missions.getReadiness()` para provider/modelo efetivo.
- Texto do banner global atualizado.
- Texto do hint por agente atualizado.

### `apps/desktop/src/components/overview/MissionDiagnosticModal.tsx`
- Reescrito. Não usa mais `getMissionAgentRequirements` nem `getAgentReadiness`.
- Mostra apenas os 4 agentes reais do `MissionExecutionReadiness`.
- Mostra pendências globais.
- Recomendação por stack rebaixada a seção "Recomendação de especialização".

### `apps/desktop/src/pages/OverviewPage.tsx`
- Removido `savedRecommendation` / `recommendationHistory` / `recordProjectRecommendation` / `appendProjectRecommendationHistory`.
- `handleCommandSubmit` consulta `missions.getReadiness()` em vez de `buildMissionPrecheck` legado.
- Bloco `executionMode === "multi_agent"` em `executeCommand` consulta `missions.getReadiness()` em vez de `getMissingAgentConfigMessage`.
- Imports do `shared` reduzidos ao mínimo necessário.

## 15. Alterações no `mock-api.ts`

- `mockAgents` reduzido para Planner / Developer / QA (o Orquestrador / Backend Dev / Frontend Dev / Mobile Dev / DevOps saíram do fallback mock ativo).
- Heurística `devVariant = "backend-dev" | "frontend-dev" | "mobile-dev"` removida do `runRealMultiAgentMock`. Developer agora é fixo (papel real do Agent Engine).
- `agents.*` mockado mantém `listConfigs()` retornando `[]` em runtime browser; quem usa readiness no browser cai no `resolveExecutionReadiness` puro (sem mock de agente).
- `missions.getReadiness` adicionado ao mock retornando readiness vazia com mensagem `"Mission Engine só funciona em runtime Tauri. Inicie o app via Tauri para executar missões."`.

## 16. Como validar manualmente

1. Configurar provider real (Settings → Novo provider).
2. Definir `defaultModel`.
3. Abrir AgentsPage.
4. Clicar em "Restaurar agentes padrão".
5. Confirmar que aparecem Planner / Developer / QA / Finalizer.
6. Confirmar que cada card mostra "Provider efetivo" e "Modelo efetivo" iguais aos do banner global.
7. Abrir diagnóstico da missão (Overview → "Ver diagnóstico detalhado").
8. Confirmar que o diagnóstico mostra os mesmos 4 agentes com o mesmo provider/modelo efetivo.
9. Confirmar que NÃO aparece Backend Dev / Frontend Dev / Mobile Dev / Orquestrador.
10. Confirmar que NÃO aparece "Nenhum fallback real" / "Nenhum provider selecionado" quando há provider real.
11. Executar missão.
12. Confirmar que `agentSteps.listByMission(run.id)` retorna os 4 agentes reais com os mesmos provider/modelo.
13. Confirmar que logs/eventos da missão correspondem aos 4 agentes.

### Validação via DevTools

```js
const projects = await window.fluxora.projects.list();
const providers = await window.fluxora.providers.list();
const agents = await window.fluxora.agents.listConfigs();
console.log({ providers, agents });

const readiness = await window.fluxora.missions.getReadiness({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
});
console.log(readiness);
// esperado:
// readiness.ready === true
// readiness.agents.length === 4
// readiness.agents.map(a => a.role) === ["planner", "developer", "qa", "finalizer"]
// todos possuem providerId
// todos possuem model
```

```js
const run = await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "assistido",
  prompt: "Crie uma página simples para um advogado.",
});
const steps = await window.fluxora.agentSteps.listByMission(run.id);
console.log(steps.map(s => ({ name: s.agentName, role: s.role, status: s.status })));
// esperado:
// Planner planner ...
// Developer developer ...
// QA qa ...
// Finalizer finalizer ...
```

## 17. Comandos de validação executados

```bash
pnpm typecheck
pnpm build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
timeout 90s pnpm dev
pnpm test
pnpm --filter @fluxora/desktop tauri:build
```

## 18. Resultado de typecheck / build / cargo / test / dev

- `pnpm typecheck`: OK (3/3 pacotes, sem erros).
- `pnpm build`: OK (web build, 774 KiB minified).
- `cargo check`: OK.
- `cargo test --lib`: **65 testes passando** (eram 64 antes; +1 do `civil_from_days` em `execution_resolver.rs`).
- `timeout 90s pnpm dev`: app inicia Vite + Tauri; backend carrega 4 agentes padrão em `agents.json`; nenhum crash no bootstrap.
- `pnpm test`: **248 testes passando**; **2 falhas preexistentes** em `ThemeTokens.test.ts` (esperava accent `#ff4d4d`, tema atual usa `#7c5bf5`) — mantidas sem correção nesta PR.
- `pnpm --filter @fluxora/desktop tauri:build`: build web + empacotamento Tauri executados com sucesso, gerando bundles `.deb`, `.rpm`, `.AppImage`.

## 19. O que ainda ficou pendente

- Tipos `OpenCode*` no `packages/shared` ainda existem por compatibilidade (já estavam deprecated na PR 013).
- Tipos legados `Agent` / `MultiAgentRole` / `AgentStepOutput` / `BUILT_IN_AGENT_ROLES` continuam existindo por causa de adaptadores e mocks. Marcados como `@deprecated` em JSDoc.
- `recommendDeveloperRoleForStack` / `recommendPlannerRoleForStack` / `recommendQaRoleForStack` ainda são importadas em `OverviewPage` para a heurística de "Recomendado para este projeto" no `CommandPanel`. PR futura pode rebaixar essa heurística também.
- `AgentStepOutput` é o tipo consumido pelo `AgentStepOutputPanel` e pelo `ExecutionDetailPage`. Continua existindo como adapter sobre `AgentStepRecord` real.
- `agents.list()` legado ainda existe no mock-api e no desktopBridge (para `listAgentOutputs` / fallback de mocks). UI ativa parou de consumi-lo, mas qualquer teste futuro pode continuar usando.

## 20. Próximas PRs recomendadas

1. **Remover tipos legados `Agent` / `BUILT_IN_AGENT_ROLES` / `MultiAgentRole`** quando o `AgentStepOutputPanel` e o `ExecutionDetailPage` migrarem totalmente para `AgentStepRecord` / `EffectiveExecutionAgent`.
2. **UI dedicada para streaming em tempo real** via `provider/stream-*` e `agent/step-chunk` (mencionada na PR 013).
3. **Reexecução de missão com override de readiness** — permitir ao usuário escolher explicitamente qual provider/modelo usar ao rodar uma missão (já existe o input `providerId`/`model` em `getReadiness`).
4. **Persistir readiness no histórico da missão** — salvar snapshot da `MissionExecutionReadiness` no momento do `mission/started` para auditoria.
5. **Refinar a heurística de "Recomendado para este projeto"** no `CommandPanel` para também consumir readiness em vez de recomendação por stack.