# STATUS_MIGRATION_TAURI_PR_003_GIT_FILESYSTEM

## 1. Objetivo da PR 003

Adicionar leitura/inspeção de **Git** e **filesystem** reais no backend
Tauri, reduzir a dependência do mock nos domínios `git.*` e
`app.getGitInfo`, organizar a documentação de migração em uma pasta
própria e manter a UI React/TypeScript existente sem redesenho.

## 2. Organização de documentação realizada

Antes desta PR, os arquivos de status das PRs anteriores estavam
dispersos na raiz do projeto. A migração criou agora uma pasta
própria e moveu tudo para lá.

Arquivos movidos da raiz para `docs/migrations/tauri/`:

- `STATUS_MIGRATION_TAURI_PR_001.md`
- `STATUS_MIGRATION_TAURI_PR_002_PROJECTS.md`

Nada foi apagado, renomeado ou modificado em conteúdo — apenas
movido para a nova localização.

Criado nesta PR:

- `docs/migrations/tauri/README.md` — índice das PRs da migração
- `docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_003_GIT_FILESYSTEM.md`
  (este arquivo)

`README.md` principal da raiz foi preservado intacto.

Como o projeto Fluxora ainda não estava em um repositório Git,
foi usado `mv` simples (não `git mv`).

## 3. Estado herdado da PR 002

Da PR 002 já estavam prontos:

- Base Tauri em `apps/desktop/src-tauri/`
- `desktopBridge` com `projects.*` real e fallback mock
- `window.fluxora` preservado via `createDesktopBridge()`
- Persistência local de projetos em JSON
- `app.getVersion()` real via `get_app_info`
- Capability `dialog:default` registrada
- Plugin `tauri-plugin-dialog` carregado

O que ainda dependia totalmente do mock no início da PR 003:

- `git.inspect` (mock fixo com 4 arquivos)
- `git.diff` (mock com diff hardcoded)
- `git.changedFiles` (store em memória de simuladores de workflow)
- `git.fileDiff` (idem)
- `app.getGitInfo` (hardcoded `{main, abc1234}`)
- Qualquer `fs.*` (não existia)

## 4. Como Git e filesystem funcionavam antes

### `git.inspect(projectId)`

- Se o projeto não existia no store mock, retornava
  `{ isRepo: false, files: [], totalAdditions: 0, totalDeletions: 0, error: "Projeto não encontrado" }`.
- Caso contrário, retornava uma lista fixa de 4 arquivos simulados,
  com `isRepo: true`, `branch: "main"` e totais 119/6.

### `git.diff(projectId, filePath)`

- Retornava um diff literal hardcoded, independente do arquivo
  ou do estado real do projeto.

### `git.changedFiles(workflowRunId)` / `git.fileDiff(...)`

- Lidos de `changedFilesByWorkflow` / `fileDiffsByWorkflow`, maps
  em memória populados pelos simuladores
  `simulateRealWorkflow` e `simulateMultiAgentWorkflow`. Como o
  workflow engine real ainda não existe no Tauri, esses métodos
  só funcionam dentro do mock do navegador.

### `app.getGitInfo()`

- Hardcoded `{ branch: "main", commit: "abc1234" }` em
  `mock-api.ts`. Nada lia o cwd do app.

### `fs.*`

- Não existia no backend nem no frontend. O `projects.validatePath`
  (PR 002) já fazia a única leitura de filesystem real — checagem
  de `.git` e de arquivos de stack — mas sem expor isso como
  comando Tauri genérico.

## 5. Como Git e filesystem funcionam agora

No runtime Tauri:

- `git.inspect(projectId)` chama o comando Rust `git_summary`,
  que:
  1. resolve `projectId` para o `path` do projeto cadastrado
     (via `projects::find_project_path`)
  2. verifica a presença de `.git`
  3. executa `git rev-parse --is-inside-work-tree`
  4. lê a branch atual via `git symbolic-ref --short HEAD`
     (com fallback para `git rev-parse --abbrev-ref HEAD`)
  5. lê `git status --porcelain --untracked-files=all` e mapeia
     os códigos de 2 caracteres para os status esperados pela UI
     (`added`, `modified`, `deleted`, `renamed`, `untracked`)
  6. retorna `GitSummary` com `isRepo`, `branch`, `files`,
     `totalAdditions`, `totalDeletions` e `error` opcional
- `git.diff(projectId, filePath)` chama `git_diff`, que:
  1. valida `file_path` (rejeita absoluto, `..`, vazio)
  2. executa `git diff --no-color HEAD -- <file>`
  3. se vazio, detecta arquivo não rastreado e gera um diff
     "novo" (`--- /dev/null`, `+++ b/<path>`, `@@ -0,0 +1,N @@`)
- `git.changedFiles` e `git.fileDiff` continuam mockados nesta PR
  (dependem do workflow engine)
- `app.getGitInfo` chama `app_get_git_info`, que:
  1. pega o cwd do app via `std::env::current_dir()`
  2. checa `.git`
  3. lê branch e commit curto via `git rev-parse`
  4. retorna `{ branch, commit, error? }` — strings vazias
     quando fora de um repo, e a UI já trata isso com fallback

Comandos Tauri adicionais (registrados mas não expostos via
`desktopBridge` porque a UI atual não os consome):

- `fs_list_files`, `fs_read_file`, `fs_get_file_info`,
  `fs_search_files`, `fs_list_project_tree`
- `git_is_repo`, `git_current_branch`, `git_status`,
  `git_recent_commits`

Esses comandos ficam disponíveis para uso interno do backend e
para PRs futuras, sem alterar a superfície `window.fluxora`.

Fora do runtime Tauri (modo browser/Vite dev):

- `desktopBridge` mantém o fallback para `mock-api.ts`, exatamente
  como nas PRs anteriores. Nenhuma chamada de UI foi alterada.

## 6. Comandos Rust/Tauri criados

Criados em `apps/desktop/src-tauri/src/`:

- `filesystem.rs`
  - `fs_list_files(projectId, relativePath?, options?)`
  - `fs_read_file(projectId, relativePath, options?)`
  - `fs_get_file_info(projectId, relativePath?)`
  - `fs_search_files(projectId, query, options?)`
  - `fs_list_project_tree(projectId, options?)`
- `git.rs`
  - `git_is_repo(projectId)`
  - `git_current_branch(projectId)`
  - `git_status(projectId)`
  - `git_recent_commits(projectId, options?)`
  - `git_diff(projectId, filePath)`
  - `git_summary(projectId)`
  - `app_get_git_info()`

Adicionado em `apps/desktop/src-tauri/src/projects.rs`:

- `pub fn find_project_path(app, project_id) -> Result<PathBuf, String>`
  usado por `filesystem.rs` e `git.rs` para resolver o path
  canônico de um projeto a partir do `project_id`, garantindo
  que operações sensíveis operem apenas dentro de projetos
  cadastrados.

## 7. Arquivos frontend alterados

- `apps/desktop/src/services/desktopBridge.ts`
  - Novas funções `inspectProjectGit`, `diffProjectFile`,
    `getAppGitInfo`
  - `createDesktopBridge()` agora sobrescreve
    `app.getGitInfo`, `git.inspect` e `git.diff` para chamar
    comandos Tauri reais quando em runtime Tauri
  - `git.changedFiles` e `git.fileDiff` continuam delegando
    ao mock (preservação completa da UI)

Nenhum componente React foi modificado nesta PR. A UI
continua consumindo `window.fluxora` exatamente como antes.

## 8. Arquivos backend Rust alterados

- `apps/desktop/src-tauri/src/lib.rs` — registra os novos
  módulos e comandos
- `apps/desktop/src-tauri/src/projects.rs` — adiciona
  `find_project_path`
- `apps/desktop/src-tauri/src/filesystem.rs` — novo módulo
- `apps/desktop/src-tauri/src/git.rs` — novo módulo

`Cargo.toml` não precisou de dependências novas (uso de
`std::process::Command` e `std::sync::mpsc` da stdlib).

## 9. Contrato das funções de filesystem

Todas as funções operam **somente em projetos cadastrados** e
exigem `project_id`. O caminho `relativePath` (quando aplicável)
é sempre relativo ao root do projeto e validado contra path
traversal.

### `fs_list_files(projectId, relativePath?, options?)`

- Argumentos: `projectId: String`, `relativePath: Option<String>`,
  `options: { maxEntries?: number }` (default 500, hard cap 5.000)
- Retorno: `FsEntry[]` com
  `{ path, name, kind: "file"|"directory"|"symlink"|"other", sizeBytes, isHidden }`
- Erros: caminho fora do projeto, caminho absoluto, path traversal,
  diretório não acessível

### `fs_read_file(projectId, relativePath, options?)`

- Argumentos: `projectId: String`, `relativePath: String`,
  `options: { maxBytes?: number }` (default 256 KiB, hard cap 2 MiB)
- Retorno: `FsReadResult { path, sizeBytes, readBytes, truncated, content, isBinary, exists }`
- Heurística de binário: presença de NUL nos primeiros 8 KiB.
  Quando binário, `content` é `""` e `isBinary: true`.
- Erros: arquivo não encontrado, sem permissão, caminho inválido

### `fs_get_file_info(projectId, relativePath?)`

- Argumentos: `projectId: String`, `relativePath: Option<String>`
- Retorno: `FsEntry | null` (null quando não existe)
- Erros: caminho inválido

### `fs_search_files(projectId, query, options?)`

- Argumentos: `projectId: String`, `query: String`,
  `options: { maxResults?: number, relativePath?: string }` (default 100, hard cap 1.000)
- Retorno: `FsEntry[]` (busca case-insensitive por nome, recursiva,
  limitada por profundidade e quantidade)
- Erros: nenhum, retorna `[]` se nada bater

### `fs_list_project_tree(projectId, options?)`

- Argumentos: `projectId: String`, `options: { maxDepth?: number, maxEntries?: number }` (default 4 / 500, hard cap 8 / 5.000)
- Retorno: `FsTreeNode { path, name, kind, children, truncated }`
- Ignora por padrão: `node_modules`, `.git`, `vendor`, `dist`,
  `build`, `.next`, `target`, `.turbo`, `.cache`, `.parcel-cache`,
  `.venv`, `venv`, `__pycache__`

## 10. Contrato das funções de Git

### `git_is_repo(projectId)`

- Retorno: `boolean`
- Considera `true` apenas se `.git` existir e
  `git rev-parse --is-inside-work-tree` responder `true`

### `git_current_branch(projectId)`

- Retorno: `string | null`
- Usa `git symbolic-ref --short HEAD`; em detached HEAD, tenta
  `git rev-parse --abbrev-ref HEAD`; retorna `null` se não
  conseguir resolver

### `git_status(projectId)`

- Retorno: `GitChangedFile[]` com `{ path, status, additions, deletions }`
- `status` ∈ `"added" | "modified" | "deleted" | "renamed" | "untracked" | "ignored"`
- Adições/remoções ficam zeradas nesta PR (parser numdiff fica
  para uma PR dedicada, fora do escopo)

### `git_recent_commits(projectId, options?)`

- Argumentos: `options: { limit?: number }` (default 20, hard cap 200)
- Retorno: `GitCommitInfo[]` com
  `{ hash, shortHash, authorName, authorEmail, subject, committedAt }`
- `committedAt` é ISO 8601 (`%aI`)

### `git_diff(projectId, filePath)`

- Argumentos: `filePath: String` (relativo ao root)
- Retorno: `string` (diff unificado)
- Para arquivos não rastreados, gera diff "novo" a partir do
  conteúdo atual do arquivo
- Erros: arquivo inexistente, sem Git, `filePath` inválido

### `git_summary(projectId)`

- Retorno: `GitSummary { isRepo, branch?, files, totalAdditions, totalDeletions, error? }`
- Mesmo formato consumido pela UI em `GitInspectionResult`
- `error` é omitido do JSON quando ausente
  (`#[serde(skip_serializing_if = "Option::is_none")]`)

### `app_get_git_info()`

- Retorno: `GitAppInfo { branch, commit, error? }`
- `branch` e `commit` são strings (vazias quando ausentes), o
  componente `StatusBar` já trata `""` como "branch desconhecida"
- `error` omitido do JSON quando ausente

## 11. Estratégia de segurança de paths

Todas as operações de filesystem e git exigem um `project_id`
válido e operam exclusivamente dentro do path canônico
do projeto cadastrado. Detalhes:

1. `project_id` é resolvido via `projects::find_project_path`,
   que consulta o store JSON e retorna o `path` salvo
2. O path retornado é canonicalizado (`std::fs::canonicalize`)
   antes de qualquer operação
3. `relativePath` fornecido pelo frontend:
   - rejeita caminhos absolutos
   - rejeita qualquer `Component::ParentDir` (`..`)
   - após `join` com o root, `canonicalize` e comparação
     `starts_with(root_canonico)` para garantir que o resultado
     continua dentro do projeto
4. Limites rígidos (`HARD_*`) impedem leituras abusivas mesmo
   se o frontend solicitar valores grandes
5. `git_diff` valida `file_path` da mesma forma antes de
   passar para o Git CLI

Diretórios considerados "pesados" e ignorados em listagens
e árvores por padrão:

- `node_modules`
- `.git`
- `vendor`
- `dist`
- `build`
- `.next`
- `target`
- `.turbo`
- `.cache`
- `.parcel-cache`
- `.venv`, `venv`, `__pycache__`

## 12. Limitações atuais

- `git_status` retorna `additions: 0` e `deletions: 0`. Contar
  linhas adicionadas/removidas exigiria `git diff --numstat`,
  fora do escopo desta PR.
- `git.changedFiles(workflowRunId)` e `git.fileDiff(workflowRunId)`
  continuam mockados porque dependem do workflow engine real,
  que será migrado em PR dedicada (PR 007).
- `app.getGitInfo` lê o `cwd` no momento da chamada. Quando o
  app for distribuído como `.deb`/`.rpm`/`.AppImage`, o cwd
  provavelmente será o diretório onde o binário foi invocado;
  isso é adequado para o uso atual pela `StatusBar` (mostrar a
  branch em desenvolvimento).
- Os comandos `fs_*` estão registrados e funcionam, mas não
  são expostos via `desktopBridge` porque nenhum componente
  atual consome `window.fluxora.fs.*`. Ficam prontos para PRs
  futuras.
- Timeouts de comandos Git são básicos (`mpsc::recv_timeout` +
  `kill` em Unix). Em Windows o `Command::kill` cobre o caso.
  Timeouts mais sofisticados podem ser refinados depois.

## 13. Quais partes ainda usam mock

Ainda usam mock no Fluxora (além do fallback fora do runtime
Tauri):

- `workflows.*`
- `approvals.*`
- `agents.*`
- `models.updateAgentModel`
- `opencode.*`
- `voice.*`
- `events.*`
- `settings.*`
- `commands.*`
- `agentSteps.*`
- `whisperLocal.*`
- `whisper.*`
- `git.changedFiles` e `git.fileDiff` (até o workflow engine)
- `env.get/has`

O domínio `git.*` migrou parcialmente: `inspect` e `diff` (de
projeto) são reais; `changedFiles` e `fileDiff` (de workflow)
permanecem mockados.

`app.getGitInfo` migrou totalmente.

## 14. Quais comandos foram executados para validação

Executados em `/home/pablo/projects/Fluxora`:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm --filter @fluxora/desktop tauri:build
```

Adicional (sanidade):

```bash
cd apps/desktop/src-tauri && cargo check
```

### Resultado

- `pnpm install`: já estava consistente
- `pnpm typecheck`: sucesso (`packages/shared`,
  `packages/voice-context`, `apps/desktop`)
- `pnpm build`: sucesso (Vite 8 — bundle de 798 KiB / 222 KiB gzip)
- `pnpm test`: 6 falhas preexistentes (mesmas da PR 002),
  284 testes passando. As 6 falhas estão em
  `ThemeTokens.test.ts` e `VoiceCommandModal.test.tsx` e não
  foram causadas por esta PR
- `pnpm --filter @fluxora/desktop tauri:build`: **sucesso
  completo**. Compilou Rust em release, gerou o binário
  `fluxora` (15 MiB) e produziu os bundles `.deb`, `.rpm`
  e `.AppImage`. Diferente da PR 002, o empacotamento Linux
  não falhou nesta PR
- `cargo check`: sucesso, sem warnings

### Erros encontrados

Nenhum erro de código novo nesta PR. Os 6 testes que falham
são preexistentes e estão documentados:

- `ThemeTokens.test.ts`: espera `accent` vermelho/coral
- `VoiceCommandModal.test.tsx`: procura `data-testid="topbar-mic-button"`
  que não existe no DOM atual

Ambos são de tema/voz, sem relação com Git/filesystem.

## 15. Próximas PRs recomendadas

1. PR 004 — Eventos reais via Tauri event system
2. PR 005 — Voice/Whisper no Tauri
3. PR 006 — Provider Engine próprio
4. PR 007 — Mission Engine inicial (desbloqueia
   `git.changedFiles` e `git.fileDiff` reais, com parser
   `git diff --numstat` para `additions`/`deletions`)
5. PR 008 — Piloto automático com permissões por projeto
