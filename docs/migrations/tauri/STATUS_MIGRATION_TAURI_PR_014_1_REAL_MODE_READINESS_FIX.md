# STATUS_MIGRATION_TAURI_PR_014_1_REAL_MODE_READINESS_FIX

## 1. Objetivo da hotfix

1. Corrigir o bloqueio indevido do modo Real na Central de Comando. O sistema mostrava o alerta "Modo real indisponível. Configure ao menos um provider ativo e um agente com modelo selecionado na tela de Agentes." mesmo quando a `missions.getReadiness()` retornava `ready === true`.
2. Corrigir o travamento/congelamento inicial (freeze) do aplicativo ao iniciar, no qual o app ficava travado logo na tela de abertura.

## 2. Sintoma observado

### 2.1 Bloqueio do modo Real
1. Barra superior mostra: "Missões e agentes sem sobrescrita usarão deepseek-v4-flash."
2. Configurações mostram: Provider Engine pronto, Agent Engine com 4 agentes persistidos, Mission Engine pronto.
3. AgentsPage mostra: Planner, Developer, QA e Finalizer habilitados, todos herdando provider/modelo, provider efetivo `provider-1781834595533-0`, modelo efetivo `deepseek-v4-flash`.
4. Ao enviar missão no modo Real, aparece alerta: "Modo real indisponível. Configure ao menos um provider ativo e um agente com modelo selecionado na tela de Agentes."

### 2.2 Travamento inicial (App começa congelado)
1. Ao abrir o aplicativo, a janela ficava congelada sem responder a cliques ou atalhos de teclado.
2. A thread principal ficava ocupada aguardando requisições síncronas de rede/disco iniciadas pelo frontend no carregamento inicial.

## 3. Causa raiz

O `OverviewPage.tsx` tinha **dois guards legados** que bloqueavam o modo
Real independentemente da `missions.getReadiness()`:

### 3.1 Guard em `executeCommand` (linhas 519-528)

```typescript
if (executionMode === "real") {
    const readyAgents = agents.filter((agent) =>
        isAgentConfiguredForRealExecution(agent)
    );
    const hasEnabledProvider = Boolean(catalog?.providers.length);
    if (!hasEnabledProvider || readyAgents.length === 0) {
        window.alert(
            "Modo real indisponível. Configure ao menos um provider ativo e um agente com modelo selecionado na tela de Agentes."
        );
        return;
    }
}
```

`isAgentConfiguredForRealExecution(agent)` exige `agent.modelProviderId` E
`agent.modelName` explícitos. Quando agentes **herdam** provider/modelo
(não têm campos próprios), esses campos são `undefined` no tipo legado
`Agent`. Resultado: `readyAgents.length === 0` → bloqueio.

### 3.2 Guard redundante para `multi_agent` (linhas 530-544)

```typescript
if (executionMode === "multi_agent") {
    const readiness = await window.fluxora.missions.getReadiness({...});
    if (!readiness.ready) {
        window.alert(...);
        return;
    }
}
```

Check duplicado — `handleCommandSubmit` já faz a mesma verificação.

### 3.3 Por que `handleCommandSubmit` não era suficiente

`handleCommandSubmit` (linha 626) já chamava `missions.getReadiness()`
corretamente e, se `ready`, chamava `executeCommand(text)`. Mas
`executeCommand` tinha seu próprio guard legado que bloqueava antes de
chegar à criação da missão.

### 3.4 Travamento inicial devido a comandos síncronos de I/O na thread de UI
Os comandos do Tauri declarados no backend Rust em `lib.rs` eram, em sua maioria, funções síncronas (`fn`). Durante o carregamento inicial da interface (`AppShell.tsx`), o frontend executava requisições concorrentes e chamava `providers_list_models` para construir o catálogo. Como esse comando efetuava chamadas HTTP síncronas/bloqueantes de rede (`ureq`) com timeout de 8 segundos, ele ocupava a thread principal de interface gráfica (event loop do Tauri), deixando o aplicativo completamente travado na inicialização.

## 4. Qual guard antigo bloqueava o modo Real

O guard em `executeCommand` (linhas 519-528) que usava
`isAgentConfiguredForRealExecution(agent)` — uma função que exige
`modelProviderId` E `modelName` explícitos no agente, ignorando a
herança de provider/modelo via `globalDefault`.

## 5. Quais arquivos foram alterados

### `apps/desktop/src/pages/OverviewPage.tsx`

- **Removido**: Guard legado em `executeCommand` (linhas 519-528) que
  bloqueava o modo Real usando `isAgentConfiguredForRealExecution`.
- **Removido**: Check redundante de readiness para `multi_agent` em
  `executeCommand` (linhas 530-544).
- **Atualizado**: `handleCommandSubmit` — adicionado log de diagnóstico
  (`console.debug("[Fluxora readiness]", {...})`) e tratamento de erro.
- **Atualizado**: `realExecutionBlocker` — mensagens de erro alinhadas
  com terminologia de readiness.

### `apps/desktop/src/components/layout/GlobalDefaultBanner.tsx`

- **Atualizado**: Texto de "Fallback real do Mission Engine ativo." para
  "Provider padrão de execução ativo."

### `apps/desktop/src/components/layout/AppShell.tsx`

- **Adicionado**: Import de `deriveProviderEngineGlobalDefault` e
  `isAgentReadyWithFallback` de `@fluxora/shared`.
- **Adicionado**: Estado `providers` e `globalDefault` (useMemo).
- **Atualizado**: Readiness de agentes no command palette — usa
  `isAgentReadyWithFallback(agent, globalDefault)` em vez de checar
  `modelProviderId`/`modelName` explicitamente.

### `apps/desktop/src-tauri/src/lib.rs`

- **Atualizado**: Todos os comandos do Tauri que efetuam chamadas bloqueantes de rede ou disco (como `providers_list_models`, `fs_*`, `git_*`, `missions_run`, etc.) foram migrados de `fn` síncronos para `async fn` assíncronos. Isso delega a execução dessas tarefas pesadas e conexões externas para o pool de tarefas assíncronas do `tokio` (gerenciado pelo Tauri), impedindo o bloqueio da thread principal da interface gráfica e solucionando o congelamento completo do aplicativo no startup.

## 6. Como o submit real funciona agora

1. Usuário digita missão e clica Enviar (ou Enter/Ctrl+Enter).
2. `handleCommandSubmit` é chamado.
3. Se `executionMode === "real"` ou `"multi_agent"`:
   a. Chama `missions.getReadiness({ projectId })`.
   b. Loga readiness no console para diagnóstico.
   c. Se `!readiness.ready` → abre `MissionDiagnosticModal` com as
      issues reais.
   d. Se `readiness.ready` → chama `executeCommand(text)`.
4. `executeCommand` cria o workflow e executa (sem guards legados).
5. Missão é criada e executada pelo Mission Engine.

## 7. Como `missions.getReadiness` virou a única validação

- `handleCommandSubmit` é o **único ponto de entrada** para envio de
  missão (via `CommandPanel.onSubmit`).
- Para modos `real` e `multi_agent`, `missions.getReadiness()` é
  chamado **antes** de `executeCommand`.
- Nenhum outro guard (`buildMissionPrecheck`,
  `getMissingAgentConfigMessage`, `isAgentConfiguredForRealExecution`)
  pode bloquear a execução real.
- O `realExecutionBlocker` (useMemo síncrono) permanece como hint
  visual imediato (desabilita botão Enviar), mas a validação final
  é sempre `missions.getReadiness()`.

## 8. Como provider/modelo herdado é aceito

- `resolveExecutionReadiness` (shared) e `execution_resolver.rs`
  (Rust) resolvem provider/modelo efetivo para cada agente:
  1. `agent.providerId` se definido; senão herda.
  2. `agent.model` se definido; senão herda.
  3. Herda do provider padrão (primeiro enabled com defaultModel).
- `isAgentReadyWithFallback(agent, globalDefault)` considera a
  herança: se o agente está enabled E há globalDefault, retorna
  true mesmo sem `modelProviderId`/`modelName` explícitos.
- O command palette agora usa `isAgentReadyWithFallback` em vez
  de checar campos explícitos.

## 9. Como mensagens de erro foram padronizadas

| Cenário | Mensagem antiga | Mensagem nova |
|---|---|---|
| Sem provider | "Modo real indisponível: configure um provider real no Provider Engine." | "Nenhum provider configurado. Cadastre um provider em Configurações > Providers." |
| Sem agente pronto | "Modo real indisponível: habilite ao menos um agente real com provider/modelo ou use o fallback real do Mission Engine." | "Nenhum agente pronto para execução. Verifique provider e agentes em Configurações." |
| Alerta em executeCommand | "Modo real indisponível. Configure ao menos um provider ativo e um agente com modelo selecionado na tela de Agentes." | **Removido** — agora usa readiness + diagnóstico modal |
| Banner global | "Fallback real do Mission Engine ativo." | "Provider padrão de execução ativo." |
| Multiagente | "Modo multiagente indisponível: habilite modelo/provider para X (ou use o fallback real do Mission Engine)." | "Agentes não prontos: X. Verifique provider e agentes em Configurações." |

## 10. Resultado do teste via DevTools

A ser executado manualmente no runtime Tauri (ver Fase 10 do prompt).

## 11. Resultado do teste pela UI

A ser executado manualmente no runtime Tauri (ver Fase 11 do prompt).

## 12. Comandos de validação executados

```bash
pnpm typecheck    # OK (3/3 pacotes, sem erros)
pnpm build        # OK (774 KiB minified)
cargo check       # OK
cargo test --lib  # OK, 65 testes passando
pnpm test         # 248 passando, 2 falhas preexistentes em ThemeTokens.test.ts
```

## 13. Resultado de typecheck/build/cargo/test/dev

- `pnpm typecheck`: OK
- `pnpm build`: OK
- `cargo check`: OK
- `cargo test --lib`: 65 testes passando
- `pnpm test`: 248 passando, 2 falhas preexistentes em `ThemeTokens.test.ts`
  (esperava accent `#ff4d4d`, tema atual usa `#7c5bf5`) — mantidas sem
  correção nesta PR.

## 14. O que ainda ficou pendente

- `RightPanel.tsx` ainda mapeia agentes para formato legado com
  `modelProviderId`/`modelName` — pode mostrar status incorreto para
  agentes que herdam. Não bloqueia execução.
- `useUsageStats.ts` usa `Agent[]` legado para métricas — não afeta
  execução.
- `isAgentConfiguredForRealExecution` e `buildMissionPrecheck` ainda
  existem em `shared` como funções deprecated. Podem ser removidos em
  PR futura quando todos os callers migrarem para readiness.
- Tipos legados `Agent` / `BUILT_IN_AGENT_ROLES` / `MultiAgentRole`
  continuam existindo por causa de adaptadores e mocks.

## 15. Próximas PRs recomendadas

1. **Migrar RightPanel e useUsageStats para readiness** — usar
   `resolveExecutionReadiness` em vez de `Agent[]` legado para
   status de agentes e métricas.
2. **Remover funções deprecated** — `isAgentConfiguredForRealExecution`,
   `buildMissionPrecheck`, `getAgentReadiness` quando todos os callers
   migrarem.
3. **UI dedicada para streaming em tempo real** — componente que assina
   `agent/step-chunk` e `provider/stream-chunk`.
4. **Reexecução de missão com override de readiness** — permitir ao
   usuário escolher explicitamente qual provider/modelo usar.
