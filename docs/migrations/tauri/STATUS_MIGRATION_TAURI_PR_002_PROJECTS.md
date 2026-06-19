# STATUS_MIGRATION_TAURI_PR_002_PROJECTS

## 1. Objetivo da PR 002

Migrar o domínio `projects.*` do fallback mock para implementação real em Tauri/Rust, mantendo a UI React/TypeScript atual e adicionando persistência local simples, validação real de caminho e detecção inicial de stack.

## 2. Resumo do estado herdado da PR 001

- A PR 001 já havia criado a shell Tauri em `apps/desktop/src-tauri`
- `window.fluxora` já estava preservado via `desktopBridge`
- O frontend continuava inteiro em React/TypeScript
- `projects.*` ainda dependia majoritariamente do mock em `apps/desktop/src/api/mock-api.ts`
- O backend Rust tinha apenas comandos placeholders

## 3. Como `projects.*` funcionava antes

Antes desta PR:

- `projects.list` retornava uma lista em memória com seeds mockados
- `projects.create` apenas inseria o projeto em array local do mock
- `projects.update` alterava o objeto em memória
- `projects.remove` removia do array em memória
- `projects.selectDirectory` retornava `{ canceled: true }`
- `projects.validatePath` retornava:
  - erro apenas quando o caminho era vazio
  - sucesso automático para qualquer caminho não vazio
  - `hasGit: true` fixo no mock para caminhos não vazios

Ou seja: a UI compilava e abria, mas não trabalhava com projetos locais reais.

## 4. Como `projects.*` funciona agora

No runtime Tauri:

- `projects.list` chama o comando Rust `projects_list`
- `projects.create` chama `projects_create`
- `projects.update` chama `projects_update`
- `projects.remove` chama `projects_remove`
- `projects.selectDirectory` chama `projects_select_directory`
- `projects.validatePath` chama `projects_validate_path`

Fora do runtime Tauri:

- o `desktopBridge` mantém fallback para o `mock-api`

No runtime Tauri, erros de `projects.*` nao sao mascarados com fallback silencioso. A ideia agora e expor erro real de persistencia/validacao em vez de esconder problema de backend.

## 5. Comandos Rust/Tauri criados

Criados ou substituídos em `apps/desktop/src-tauri/src/lib.rs`:

- `projects_select_directory`
- `projects_list`
- `projects_get`
- `projects_create`
- `projects_update`
- `projects_remove`
- `projects_validate_path`

Plugin inicializado:

- `tauri_plugin_dialog::init()`

## 6. Arquivos frontend alterados

- `apps/desktop/src/services/desktopBridge.ts`
- `packages/shared/src/index.ts`

Arquivos frontend lidos/impactados para compatibilidade:

- `apps/desktop/src/api/mock-api.ts`
- `apps/desktop/src/pages/ProjectsPage.tsx`
- `apps/desktop/src/pages/OverviewPage.tsx`
- `apps/desktop/src/components/layout/Sidebar.tsx`
- `apps/desktop/src/components/layout/AppShell.tsx`
- `apps/desktop/src/components/layout/StatusBar.tsx`

## 7. Arquivos backend Rust alterados

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/projects.rs`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/capabilities/default.json`

## 8. Formato de persistência adotado

Foi adotado arquivo JSON local simples.

Estrutura:

- arquivo com `version`
- array `projects`

Cada item persistido usa uma estrutura interna própria do backend com metadados extras.

## 9. Local onde os projetos são salvos

Os projetos sao salvos em:

`<app_data_dir>/fluxora/projects.json`

Onde `app_data_dir` e resolvido pelo Tauri em runtime.

No Linux, com o identificador atual `com.fluxora`, a localizacao esperada tende a ser algo equivalente a:

`~/.local/share/com.fluxora/fluxora/projects.json`

## 10. Campos salvos para cada projeto

Campos persistidos:

- `id`
- `name`
- `path`
- `stack`
- `status`
- `currentAgent`
- `lastAction`
- `createdAt`
- `updatedAt`
- `lastOpenedAt`
- `hasGit`
- `relevantFiles`

Campos retornados para a UI, preservando compatibilidade com `@fluxora/shared`:

- `id`
- `name`
- `path`
- `stack`
- `status`
- `currentAgent`
- `lastAction`
- `createdAt`
- `updatedAt`

## 11. Como a validação de caminho funciona

`projects_validate_path` agora faz validacao real:

1. rejeita caminho vazio
2. resolve caminho relativo para absoluto
3. verifica se o caminho existe
4. verifica se e diretorio
5. verifica se o diretorio pode ser lido
6. normaliza o caminho via `canonicalize` quando possivel
7. detecta `.git`
8. detecta stack basica
9. retorna arquivos relevantes encontrados

Resposta retornada para o frontend:

- `valid`
- `exists`
- `isDirectory`
- `hasGit`
- `normalizedPath`
- `detectedStack`
- `relevantFiles`
- `error`

## 12. Como a detecção de stack funciona

Deteccao simples baseada em arquivos-raiz:

- `composer.json`
  - marca `PHP`
  - marca `Laravel` quando encontra `laravel/framework`
  - marca `Livewire` quando aplicavel
- `package.json`
  - marca `Node.js`
  - tenta detectar `React`, `Next.js`, `Vue`, `Nuxt`, `Svelte`, `Angular`, `Vite`
  - marca `TypeScript` quando encontra dependencia ou `tsconfig.json`
  - fallback `JavaScript` quando apropriado
- `pubspec.yaml`
  - marca `Flutter` e `Dart`
- `Cargo.toml`
  - marca `Rust`
- `go.mod`
  - marca `Go`
- `pyproject.toml` ou `requirements.txt`
  - marca `Python`
- `.git`
  - marca `Git`

Na criacao/atualizacao:

- se o usuario informar stack manual, ela e mantida e enriquecida sem duplicatas com a stack detectada
- se a stack vier vazia, a stack detectada e usada

## 13. Quais partes ainda usam mock

Ainda usam mock no Fluxora:

- todo o restante fora de `projects.*`, como:
  - `workflows.*`
  - `approvals.*`
  - `agents.*`
  - `opencode.*`
  - `git.*`
  - `voice.*`
  - `events.*`
  - `settings.*`
  - `commands.*`
  - `agentSteps.*`
  - `whisperLocal.*`

O proprio `projects.*` ainda usa fallback mock somente quando o app esta fora do runtime Tauri.

## 14. Quais comandos foram executados para validação

Executados em `/home/pablo/projects/Fluxora`:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm --filter @fluxora/desktop tauri:build
pnpm test
```

Resultado:

- `pnpm install`: ja estava consistente da PR 001
- `pnpm typecheck`: sucesso
- `pnpm build`: sucesso
- `pnpm --filter @fluxora/desktop tauri:build`: compilou e gerou binario/bundles, mas falhou no empacotamento final via `linuxdeploy`
- `pnpm test`: falhou em testes ja existentes de tema/voz, nao causados por `projects.*`

## 15. Erros encontrados

### 15.1 Erro de codigo corrigido durante a PR

Durante a primeira tentativa de build Tauri apareceu:

```text
no method named `path` found for reference `&AppHandle`
help: trait `Manager` which provides `path` is implemented but not in scope
```

Correcao aplicada:

- import de `tauri::Manager` em `apps/desktop/src-tauri/src/projects.rs`

### 15.2 Erro restante no empacotamento Linux

Build Tauri atual:

- compilacao Rust concluida
- binario release gerado
- bundles `.deb`, `.rpm` e etapa de AppImage iniciadas
- falha final no empacotamento com:

```text
failed to bundle project `failed to run linuxdeploy`
```

Isso nao bloqueou a compilacao do modulo de projetos em si; o problema restante ficou no empacotamento Linux final.

### 15.3 Testes frontend que continuam falhando

Falhas registradas em `pnpm test`:

- `apps/desktop/src/__tests__/ThemeTokens.test.ts`
  - espera cor accent vermelha/coral, mas a base atual continua com accent roxa
- `apps/desktop/src/__tests__/VoiceCommandModal.test.tsx`
  - procura `data-testid=\"topbar-mic-button\"` que nao esta presente no DOM atual

Essas falhas aparentam ser preexistentes e nao estao ligadas ao modulo `projects.*`.

## 16. Próximas PRs recomendadas

1. PR 003 — Git e filesystem reais.
2. PR 004 — Eventos reais via Tauri event system.
3. PR 005 — Voice/Whisper no Tauri.
4. PR 006 — Provider Engine próprio.
5. PR 007 — Mission Engine inicial.
6. PR 008 — Piloto automático com permissões por projeto.
