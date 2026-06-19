# STATUS_MIGRATION_TAURI_PR_001

## 1. Objetivo da migracao

Migrar a shell desktop do Fluxora de Electron para Tauri, preservando a UI React/TypeScript existente e trocando a camada Electron/preload/IPC por uma ponte de compatibilidade (`desktopBridge`) com comandos Rust minimos.

## 2. O que foi encontrado no projeto Electron original

- Projeto fonte lido em `/home/pablo/projects/Fluxora`
- Estrutura: monorepo `pnpm`
- Frontend desktop: `apps/desktop`
- Framework frontend: React 19 + TypeScript + Vite 8
- Estilo/UI: Tailwind CSS + CSS global em `apps/desktop/src/styles/globals.css`
- Rotas: `apps/desktop/src/App.tsx`
- Entrada React: `apps/desktop/src/main.tsx`
- Componentes React: `apps/desktop/src/components`
- Paginas/telas: `apps/desktop/src/pages`
- Hooks: `apps/desktop/src/hooks`
- Contextos usados no lugar de store dedicada: `apps/desktop/src/contexts`
- `src/stores`: nao existe no projeto atual
- Assets: `apps/desktop/src/assets`
- Tipos compartilhados: `packages/shared/src/index.ts`
- Voz/contexto usado pelo frontend: `packages/voice-context`
- Config Vite atual: `apps/desktop/vite.config.ts`
- Main Electron: `apps/desktop/electron/main.ts`
- Preload Electron: `apps/desktop/electron/preload.ts`
- Superficie IPC exposta ao frontend: `window.fluxora`

Resumo tecnico do acoplamento original:

- O preload concentrava `ipcRenderer.invoke(...)` e expunha `window.fluxora`.
- O frontend inteiro ja consumia `window.fluxora`, sem importar Electron diretamente.
- O fallback browser ja existia em `apps/desktop/src/api/mock-api.ts`.
- O backend Electron concentrava persistencia, Git, OpenCode, audio e eventos.

## 3. O que foi criado no Fluxora

- Novo workspace em `/home/pablo/projects/Fluxora`
- Copia controlada da UI existente de `apps/desktop`
- Pacotes preservados para o frontend compilar:
  - `packages/shared`
  - `packages/voice-context`
- Base Tauri criada em `apps/desktop/src-tauri`
- Config Tauri criada em `apps/desktop/src-tauri/tauri.conf.json`
- Capability minima criada em `apps/desktop/src-tauri/capabilities/default.json`
- Icones do app reaproveitados em `apps/desktop/src-tauri/icons`
- Ponte de compatibilidade criada em `apps/desktop/src/services/desktopBridge.ts`

## 4. Quais partes da UI foram migradas

Foram preservadas na nova base, sem redesenho:

- layout geral
- navegacao e rotas
- dashboard/overview
- projetos
- execucoes
- detalhe de execucao
- agentes
- approvals
- settings
- schedule
- shortcuts
- usage
- tradutor em tempo real
- componentes de painel lateral
- cards
- modais
- logs/eventos
- diff viewer
- assets e tema visual existentes

Arquivos-fonte principais preservados:

- `apps/desktop/src/components`
- `apps/desktop/src/pages`
- `apps/desktop/src/hooks`
- `apps/desktop/src/contexts`
- `apps/desktop/src/lib`
- `apps/desktop/src/styles`
- `apps/desktop/src/assets`
- `apps/desktop/src/voice`

## 5. Quais dependencias foram mantidas

Mantidas no app desktop:

- `react`
- `react-dom`
- `react-router-dom`
- `lucide-react`
- `react-markdown`
- `remark-gfm`
- `uuid`
- `tailwindcss`
- `postcss`
- `autoprefixer`
- `vite`
- `typescript`
- `vitest`
- `@fluxora/shared`
- `@fluxora/voice-context`

Adicionadas para a migracao:

- `@tauri-apps/api`
- `@tauri-apps/cli`

## 6. Quais dependencias Electron foram removidas ou isoladas

Removidas do novo app desktop:

- `electron`
- `electron-builder`
- `vite-plugin-electron`
- `vite-plugin-electron-renderer`
- `@electron/rebuild`
- `better-sqlite3`
- dependencias workspace de backend Node acopladas ao Electron:
  - `@fluxora/workspace-core`
  - `@fluxora/workflow-engine`
  - `@fluxora/opencode-adapter`
  - `@fluxora/model-router`

Arquivos Electron removidos da nova base:

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron-builder.yml`
- diretório `apps/desktop/electron/`

## 7. Quais chamadas Electron ainda precisam ser migradas

Os componentes React continuam consumindo `window.fluxora`, agora inicializado por `desktopBridge`. Isso preserva a UI, mas a maioria das operacoes ainda esta apoiada no fallback mock nesta PR.

Chamadas ainda nao migradas para backend Rust real:

- `projects.create/update/remove/validatePath`
- `workflows.*`
- `approvals.*`
- `agents.*`
- `models.updateAgentModel`
- `voice.*`
- `events.*`
- `opencode.*`
- `git.*`
- `settings.*`
- `commands.*`
- `agentSteps.list`
- `whisperLocal.*`
- `env.get/has`

Observacao:

- `invoke()` ficou concentrado em `apps/desktop/src/services/desktopBridge.ts`
- o restante da UI nao passou a chamar `invoke()` diretamente

## 8. Quais comandos Tauri/Rust foram criados

Criados em `apps/desktop/src-tauri/src/lib.rs`:

- `ping`
- `get_app_info`
- `open_project_placeholder`
- `list_recent_projects_placeholder`

Objetivo destes comandos nesta PR:

- validar o fluxo `React -> desktopBridge -> Tauri invoke -> Rust -> resposta`
- fornecer placeholders suficientes para a shell desktop abrir com a UI atual

## 9. Quais stubs/mocks temporarios existem

- `apps/desktop/src/api/mock-api.ts` continua sendo a implementacao completa de fallback
- `desktopBridge` usa Tauri apenas onde esta PR precisa provar a comunicacao
- `open_project_placeholder` retorna um caminho mockado
- `list_recent_projects_placeholder` retorna uma lista mockada de projetos recentes
- `get_app_info` retorna metadados basicos do app

Comentarios de TODO esperados para fases seguintes:

- implementar persistencia real
- migrar fluxo de projetos
- migrar eventos
- migrar workflows/Git/OpenCode/audio para comandos Rust ou plugins Tauri apropriados

## 10. Quais comandos foram executados para validacao

Executados em `/home/pablo/projects/Fluxora`:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm --filter @fluxora/desktop tauri:build
```

Resultado:

- `pnpm install`: sucesso
- `pnpm typecheck`: sucesso
- `pnpm build`: sucesso
- `pnpm --filter @fluxora/desktop tauri:build`: falhou por dependencia nativa ausente no sistema Linux

Lint:

- nao existe script `lint` no projeto fonte nem na nova base nesta PR

## 11. Quais erros permanecem

Bloqueio atual de ambiente para empacotamento/compilacao Tauri em Linux:

```text
Package javascriptcoregtk-4.1 was not found in the pkg-config search path.
Package 'javascriptcoregtk-4.1' not found
The system library `javascriptcoregtk-4.1` required by crate `javascriptcore-rs-sys` was not found.
```

Contexto:

- host identificado como `Ubuntu 26.04 LTS`
- `sudo` nao estava disponivel sem autenticacao interativa neste run
- por isso nao foi possivel instalar os pacotes de sistema exigidos pelo WebKitGTK/Tauri

Pacotes de sistema que provavelmente precisarao ser instalados antes da proxima validacao Tauri em Linux:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

## 12. Proximas PRs recomendadas

1. PR 002: migrar `projects.*` para Tauri real com dialog/file system controlado e persistencia local.
2. PR 003: migrar `app.getGitInfo`, `git.inspect`, `git.diff` e leitura de projeto para comandos Rust reais.
3. PR 004: introduzir armazenamento real no backend Tauri e remover a dependencia do `mock-api` para projetos/agentes/workflows.
4. PR 005: migrar o barramento de eventos para `@tauri-apps/api/event` e substituir listeners mockados.
5. PR 006: avaliar audio/voz e OpenCode como modulos separados, com permissao minima e comandos explicitamente versionados.
