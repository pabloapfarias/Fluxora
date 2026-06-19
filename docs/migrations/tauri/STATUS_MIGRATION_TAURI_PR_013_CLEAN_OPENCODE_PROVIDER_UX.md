# STATUS_MIGRATION_TAURI_PR_013_CLEAN_OPENCODE_PROVIDER_UX

## 1. Objetivo da PR 013

Remover OpenCode da UI ativa do Fluxora, eliminar UX de migração/legado e consolidar o Provider Engine próprio como única fonte de verdade para providers e modelos.

## 2. Motivo da remoção do OpenCode da UI ativa

- A arquitetura atual já roda com Provider Engine, Mission Engine, Agent Engine, Patch Engine, Permissions, Approvals, Scheduler, Event Bus e Provider Streaming próprios.
- Manter OpenCode na UI ativa criava uma percepção falsa de dependência arquitetural.
- O usuário final deve configurar Fluxora, não um adaptador histórico.

## 3. Diferença entre arquitetura antiga e arquitetura atual

- Antes: catálogo, diagnóstico e fluxo de execução expostos como OpenCode/CLI/Electron.
- Agora: providers reais persistidos em `providers.json`, agentes reais em `agents.json`, missões reais em `missions.json`, eventos reais em `fluxora-event`.

## 4. Arquivos auditados

- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/pages/AgentsPage.tsx`
- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/pages/ExecutionDetailPage.tsx`
- `apps/desktop/src/pages/ProjectsPage.tsx`
- `apps/desktop/src/components/layout/*`
- `apps/desktop/src/components/overview/*`
- `apps/desktop/src/components/events/EventLog.tsx`
- `apps/desktop/src/hooks/useLiveExecutionEvents.ts`
- `apps/desktop/src/hooks/useUsageStats.ts`
- `apps/desktop/src/services/desktopBridge.ts`
- `apps/desktop/src/api/mock-api.ts`
- `README.md`

## 5. Ocorrências removidas

- Seção `OpenCode CLI` da página de Configurações.
- `OpenCodeDiagnosticPanel`.
- `ControlledExecutionPanel`.
- Rota e item de menu `MiMo Voice` / tradutor em tempo real.
- Botões e listeners ativos de diagnóstico/execução controlada do OpenCode.

## 6. Ocorrências renomeadas para Provider Engine / Fluxora Engine

- Status de prontidão na UI principal passou de OpenCode para Provider Engine.
- Labels de stream/log foram trocados para termos do Fluxora.
- README e Settings passaram a falar em Fluxora Engine / Provider Engine / Agentes / Missões.

## 7. Ocorrências mantidas apenas por histórico

- Referências históricas em `docs/migrations/tauri/`.
- Tipos `OpenCode*` em `packages/shared/src/index.ts` permanecem por compatibilidade de contrato.

## 8. Alterações em `desktopBridge`

- `events.onOpenCodeStdout/Stderr/JsonEvent` agora falham com erro claro de depreciação.
- `opencode.*` agora é stub deprecated com erro explícito.
- A UI ativa passou a consumir `providers.*`, `agents.listConfigs()` e barramento genérico `events.subscribe`.

## 9. Alterações em `mock-api`

- `opencode.*` e `events.onOpenCode*` agora retornam erro claro de depreciação.
- A UI browser/Tauri deixou de depender de catálogo OpenCode para providers reais.

## 10. Alterações em `packages/shared`

- Nenhuma mudança estrutural obrigatória no contrato principal.
- Tipos históricos foram preservados para compatibilidade de build.

## 11. Alterações em Configurações

- Nova `SettingsPage` focada em produto.
- Seções: Ambiente, Providers, Modelo padrão de execução, Agentes, Voz, Segurança e permissões, Diagnóstico do Fluxora.
- Nenhum texto ativo de OpenCode, legado, Electron ou mock.

## 12. Alterações em Providers

- Lista carrega `window.fluxora.providers.list()`.
- Empty state real quando não há providers.
- Detalhes reais por provider, modelos reais, teste real e toggle habilitar/desabilitar.

## 13. Alterações no botão Novo provider

- O botão agora abre modal funcional.
- Campos: nome, kind, base URL, API key env ou token, modelo padrão, habilitado, streaming, tools, visão e áudio.
- Salva com `window.fluxora.providers.create(...)` e atualiza a lista real.

## 14. Alterações no menu/rotas

- Rota `/translator` removida.
- Item de menu correspondente removido.

## 15. Alterações na tela de agentes

- `AgentsPage` reforça explicitamente Planner, Developer, QA e Finalizer como agentes reais.
- Removida a mensagem que chamava os agentes antigos de `mock`.

## 16. Alterações em documentação

- `README.md` reescrito para a arquitetura atual.
- `docs/migrations/tauri/README.md` atualizado com link da PR 013.

## 17. Como validar que OpenCode não é mais motor

- Abrir Configurações e confirmar que não há `OpenCode`, `Electron`, `mock` ou `legado`.
- Confirmar que providers aparecem via `window.fluxora.providers.list()`.
- Confirmar que a UI não chama `window.fluxora.opencode.*`.
- Confirmar que listeners antigos `onOpenCode*` não são mais usados pela UI.

## 18. Como validar criação real de provider

1. Abrir Configurações.
2. Clicar em `Novo provider`.
3. Preencher e salvar.
4. Verificar que o provider aparece na lista.
5. Reiniciar o app e confirmar persistência.

## 19. Comandos de validação executados

```bash
pnpm typecheck
pnpm build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
timeout 90s pnpm dev
pnpm test
pnpm --filter @fluxora/desktop tauri:build
```

## 20. Resultado de typecheck/build/cargo check/test/dev

- `pnpm typecheck`: OK
- `pnpm build`: OK
- `cargo check`: OK
- `cargo test --lib`: OK, 64 testes passando
- `timeout 90s pnpm dev`: app iniciou com Vite + Tauri; observado fallback repetido do IPC custom protocol para `postMessage`, sem crash no bootstrap
- `pnpm test`: 248 testes passando; 2 falhas preexistentes em `src/__tests__/ThemeTokens.test.ts` cobrando accent vermelho/coral quando o tema atual ainda usa `#7c5bf5`
- `pnpm --filter @fluxora/desktop tauri:build`: build web e empacotamento Tauri executados com geração dos bundles `.deb`, `.rpm` e `.AppImage`

## 21. O que ainda ficou temporariamente deprecated

- `window.fluxora.opencode.*`
- `window.fluxora.events.onOpenCodeStdout`
- `window.fluxora.events.onOpenCodeStderr`
- `window.fluxora.events.onOpenCodeJsonEvent`

Todos agora retornam erro claro de depreciação.

## 22. Próximas PRs recomendadas

1. Remover tipos `OpenCode*` e adaptações legadas restantes do `packages/shared`.
2. Migrar `OverviewPage` e diagnósticos auxiliares para tipos canônicos de `AgentConfig`.
3. Criar UI dedicada para streaming em tempo real via `provider/stream-*` e `agent/step-chunk`.
4. Refinar o warning do IPC custom protocol no runtime Tauri.
