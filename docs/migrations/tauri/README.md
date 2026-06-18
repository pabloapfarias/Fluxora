# Migração Electron → Tauri — Índice

Esta pasta concentra o histórico de PRs da migração da shell desktop do Fluxora
de Electron para Tauri, preservando a UI React/TypeScript existente e
trocando a camada Electron/preload/IPC por uma ponte de compatibilidade
(`desktopBridge`) com comandos Rust.

## PRs

- [PR 001 — Base Tauri](./STATUS_MIGRATION_TAURI_PR_001.md)
  Estabelece a base Tauri (`apps/desktop/src-tauri`), cria `desktopBridge`,
  preserva `window.fluxora` e mantém o restante da UI no fallback mock.
- [PR 002 — Projects reais](./STATUS_MIGRATION_TAURI_PR_002_PROJECTS.md)
  Migra o domínio `projects.*` para backend real em Tauri/Rust, com
  persistência local em JSON, validação real de caminho, seleção de
  diretório via `tauri-plugin-dialog` e detecção inicial de stack.
- [PR 003 — Git e filesystem reais](./STATUS_MIGRATION_TAURI_PR_003_GIT_FILESYSTEM.md)
  Adiciona módulos `git.rs` e `filesystem.rs` no backend, expõe
  `git.inspect`, `git.diff` e `app.getGitInfo` reais via `desktopBridge`,
  sem mexer em layout/tema/navegação. Avança também na organização
  da própria documentação, centralizando os status das PRs nesta pasta.
- [PR 004 — Git baseline, controle de versão e comando dev](./STATUS_MIGRATION_TAURI_PR_004_GIT_BASELINE.md)
  Inicializa o repositório Git local em `~/projects/FluxoraV1` com
  branch `main`, cria `.gitignore` adequado para Tauri/React/pnpm/Rust,
  ajusta `pnpm dev` na raiz para abrir o app desktop Tauri (substituindo
  o atalho antigo que abria só o Vite) e remove o risco de loop no
  `beforeDevCommand` do `tauri.conf.json`. PR estritamente
  organizacional — nenhuma feature nova, nenhuma alteração de UI.

## Convenções aplicadas em todas as PRs

- Toda a documentação de status fica nesta pasta, nunca mais na raiz.
- `desktopBridge` é o único ponto do frontend que conhece Tauri.
- Componentes React continuam consumindo `window.fluxora`.
- O mock `apps/desktop/src/api/mock-api.ts` continua existindo como
  fallback para o caso de a app rodar fora do runtime Tauri
  (modo navegador/Vite dev).
- O projeto original em `~/projects/Fluxora` é somente leitura
  durante a migração.
