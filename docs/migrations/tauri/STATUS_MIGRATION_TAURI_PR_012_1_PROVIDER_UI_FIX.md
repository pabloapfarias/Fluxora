# STATUS_MIGRATION_TAURI_PR_012_1_PROVIDER_UI_FIX

## 1. Problema encontrado

A UI do FluxoraV1 continuava exibindo providers/modelos do
catálogo legado do OpenCode como se fossem a configuração real
da aplicação. Na prática:

- Settings mostrava "Catálogo do OpenCode" e "Modelo padrão global".
- Agents mostrava os 7 agentes legados/mock.
- O usuário via provider/modelo "configurado" na UI.
- O Mission Engine real falhava ao executar com:
  `Nenhum provider configurado. Cadastre um provider antes de executar missões.`

O bug era crítico porque o backend real já estava usando o
Provider Engine próprio da PR 007, persistido em:

`<app_data_dir>/fluxora/providers.json`

## 2. Por que a UI mostrava provider configurado, mas o Mission Engine falhava

Havia dois mundos coexistindo:

1. Mundo legado de UI:
   `window.fluxora.opencode.getCatalog()` e `agents.list()`
   ainda alimentavam várias telas.
2. Mundo real de execução:
   `window.fluxora.providers.*`, `missions.rs` e `agents.rs`
   usavam apenas o Provider Engine e o Agent Engine próprios.

O `desktopBridge` ainda fazia um fallback perigoso:

- em runtime Tauri, quando não havia provider real, ele caía no
  mock legado do OpenCode;
- isso mascarava a ausência de providers em `providers.json`.

Resultado: a UI dizia "tem provider", mas o backend real não
tinha nenhum provider habilitado para resolver a missão.

## 3. Diferença entre catálogo legado OpenCode e Provider Engine real

### Catálogo legado do OpenCode

- Serve só para compatibilidade/diagnóstico.
- Não é fonte de verdade para execução real.
- Não deve ser tratado como prova de que existe provider
  utilizável pelo Mission Engine.

### Provider Engine real

- Fonte de verdade da execução atual.
- Persistido em `providers.json`.
- Consumido por:
  - `missions.rs`
  - `agents.rs`
  - `providers.rs`
  - `window.fluxora.providers.*`

## 4. Arquivos alterados

- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/pages/AgentsPage.tsx`
- `apps/desktop/src/services/desktopBridge.ts`
- `apps/desktop/src-tauri/src/missions.rs`
- `packages/shared/src/index.ts`
- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/pages/ProjectsPage.tsx`
- `apps/desktop/src/components/overview/ActiveProjectBlock.tsx`
- `apps/desktop/src/components/layout/GlobalDefaultBanner.tsx`

## 5. Como a UI agora lista providers reais

### Settings

A tela de configurações agora tem uma seção explícita de
`Providers reais do Provider Engine` que usa:

- `window.fluxora.providers.list()`
- `window.fluxora.providers.create()`
- `window.fluxora.providers.update()`
- `window.fluxora.providers.remove()`
- `window.fluxora.providers.test()`
- `window.fluxora.providers.listModels()`

O antigo bloco foi renomeado para:

`Catálogo legado do OpenCode`

com aviso explícito:

`Este catálogo não é usado pelo Mission Engine atual. Cadastre um provider real no Provider Engine.`

### Bridge

Em runtime Tauri, `opencode.getCatalog()` não cai mais no mock
legado quando não há provider real. Agora:

- retorna catálogo derivado de providers reais quando eles existem;
- retorna catálogo vazio/erro quando não existem;
- evita falso positivo de prontidão.

## 6. Como o fallback global real funciona agora

Foi adotada a opção simples/alinhada ao backend atual:

1. provider/model informados na missão;
2. provider/model do agente;
3. primeiro provider `enabled` com `defaultModel`;
4. erro claro se nenhum provider real existir.

A UI passou a refletir esse fallback real do Mission Engine em
vez de depender do `localStorage` legado como se fosse uma
configuração canônica do backend.

## 7. Como a tela de agentes mudou

A `AgentsPage` deixou de mostrar os 7 agentes legados/mock como
fonte principal e passou a listar os agentes reais de:

`window.fluxora.agents.listConfigs()`

O ajuste/salvamento usa:

- `window.fluxora.agents.updateConfig(...)`
- `window.fluxora.models.updateAgentConfigModel(...)`

A UI agora deixa explícito que a execução real usa:

- Planner
- Developer
- QA
- Finalizer

## 8. Como o erro de provider ausente foi melhorado

Em `missions.rs`, a falha sem provider real agora devolve uma
mensagem explícita:

`Nenhum provider real do Provider Engine está configurado. O catálogo legado do OpenCode não é usado pelo Mission Engine. Cadastre um provider em Providers usando baseUrl, apiKeyEnv e defaultModel.`

Também passou a emitir:

- evento `provider/missing`
- `mission/failed` com payload seguro

Payload seguro:

```json
{
  "reason": "no-real-provider",
  "legacyCatalogVisible": true
}
```

Sem expor API key.

## 9. Como configurar um provider real

Exemplo OpenAI-compatible:

```js
await window.fluxora.providers.create({
  name: "OpenAI",
  kind: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  defaultModel: "gpt-5.4",
  enabled: true,
  supportsStreaming: true
});
```

Exemplo local:

```js
await window.fluxora.providers.create({
  name: "LM Studio",
  kind: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
  apiKeyEnv: "lm-studio",
  defaultModel: "qwen2.5-7b-instruct",
  enabled: true,
  supportsStreaming: true
});
```

## 10. Como validar via DevTools

```js
const providers = await window.fluxora.providers.list();
console.log(providers);

await window.fluxora.providers.test(providers[0].id);
await window.fluxora.providers.listModels(providers[0].id);

const projects = await window.fluxora.projects.list();
await window.fluxora.missions.createAndRun({
  projectId: projects[0].id,
  providerId: providers[0].id,
  model: providers[0].defaultModel,
  mode: "assistido",
  prompt: "Crie uma página simples para um advogado."
});
```

## 11. Resultado das validações

### Passou

- `pnpm typecheck`
- `pnpm build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

### Não passou, mas não por regressão desta PR

- `timeout 90s pnpm dev`
  Falhou porque a porta `1420` já estava em uso.
  O app Rust/Tauri chegou a iniciar e carregou os estados:
  missões, permissões, approvals, patches, agentes e steps.

- `pnpm test`
  Continuam 6 falhas preexistentes:
  - 2 em `src/__tests__/ThemeTokens.test.ts`
  - 4 em `src/__tests__/VoiceCommandModal.test.tsx`

Nenhuma dessas falhas foi corrigida nesta PR.

## 12. O que ainda permanece legado/mock

- `OpenCode CLI` ainda existe como integração legada e
  diagnóstico.
- Algumas superfícies herdadas ainda consomem formas
  compatíveis do `desktopBridge` por retrocompatibilidade.
- O catálogo do OpenCode ainda existe como conceito de UI
  legada, mas agora explicitamente marcado como não-canônico.

## 13. Próximas PRs recomendadas

1. Criar persistência canônica de configuração global de
   provider/model se a UX exigir override explícito além da
   regra de fallback atual.
2. Migrar as telas auxiliares restantes para `AgentConfig`
   puro, removendo de vez adaptações herdadas do tipo `Agent`.
3. Adicionar uma tela de streaming/telemetria consumindo
   `provider/stream-*` e `agent/step-*`.
4. Tratar as 6 falhas preexistentes de tema/voz em PR separada.
