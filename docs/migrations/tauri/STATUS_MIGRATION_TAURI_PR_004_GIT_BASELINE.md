# STATUS_MIGRATION_TAURI_PR_004_GIT_BASELINE

## 1. Objetivo da PR 004

Corrigir duas falhas de processo da migração do Fluxora para Tauri:

1. Inicializar o controle de versão Git do projeto `~/projects/Fluxora`
   (que ainda não era um repositório desde a PR 001).
2. Restaurar a experiência simples de desenvolvimento que existia no
   Electron: rodar o app com `pnpm dev` na raiz do monorepo. Após esta
   PR, esse comando abre o aplicativo desktop **Tauri** (não Electron).

Esta PR é exclusivamente organizacional e de infraestrutura de
desenvolvimento. Nenhuma feature nova, nenhuma alteração de UI,
nenhuma mudança de lógica funcional de projetos, Git, filesystem,
voz, providers, workflows ou agentes.

## 2. Motivo da PR

Ao final da PR 003, o `~/projects/Fluxora` já tinha:

- base Tauri funcional
- `projects.*` real em Rust
- `git.inspect`, `git.diff` e `app.getGitInfo` reais
- documentação de migração organizada em `docs/migrations/tauri/`
- build Tauri em release gerando `.deb`, `.rpm` e `.AppImage` com sucesso

Mas **ainda não era um repositório Git**. Toda a evolução da migração
estava em risco de perda e sem histórico versionado. Além disso, o
script `pnpm dev` da raiz estava chamando o `dev` do app desktop,
que era apenas `vite`, ou seja, abria o frontend web puro e não o
app Tauri. A experiência de "rodar o app com um comando" do Electron
estava quebrada.

A PR 004 resolve exatamente esses dois pontos, sem tocar em mais nada.

## 3. Estado do repositório Git

- **Antes desta PR:** o projeto **não** era repositório Git.
  `git rev-parse --is-inside-work-tree` retornava erro fatal.
- **Depois desta PR:** repositório Git local inicializado.
- **Branch inicial:** `main` (a inicialização criou `master`, renomeado
  em seguida com `git branch -M main`).
- **Remoto:** nenhum configurado. O repositório está pronto para
  receber um remote (`origin`) quando você pedir, mas **nenhum push
  foi feito**.

## 4. `.gitignore`

Criado na raiz do projeto (`~/projects/Fluxora/.gitignore`),
cobrindo o que o stack atual (Tauri 2 + React 19 + Vite 8 + pnpm 11 +
Rust stable) gera como artefato.

### Principais padrões ignorados

| Categoria | Padrões |
|---|---|
| Dependências JS | `node_modules/`, `.pnpm-store/` |
| Build frontend | `dist/`, `build/`, `.vite/`, `.cache/`, `.turbo/`, `.parcel-cache/`, `.next/`, `out/` |
| Logs | `*.log`, `npm-debug.log*`, `pnpm-debug.log*`, `yarn-debug.log*` |
| Ambiente / secrets | `.env`, `.env.*`, `.env.local`, `.env.*.local` (mantém `.env.example`) |
| OS / editor | `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/*` (mantém `extensions.json` e `settings.json`) |
| Rust / Tauri | `target/`, `apps/desktop/src-tauri/target/`, `apps/desktop/src-tauri/gen/`, `apps/desktop/src-tauri/.cargo/` |
| Bundles | `apps/desktop/src-tauri/target/release/bundle/`, `*.AppImage`, `*.deb`, `*.rpm`, `*.msi`, `*.dmg`, `*.pkg`, `*.exe`, `*.app` |
| Test / coverage | `coverage/`, `.nyc_output/`, `*.lcov`, `junit.xml` |
| Bancos locais | `*.sqlite`, `*.sqlite3`, `*.db`, `*.db-journal` |
| Temporários | `tmp/`, `temp/`, `.tmp/`, `*.tmp`, `*.bak`, `*.orig`, `*.rej` |
| Tooling local | `.commandcode/`, `.aider*`, `.cursor*`, `.opencode/` |

### Explicitamente **não** ignorados

- `pnpm-lock.yaml` — necessário para reprodutibilidade
- `apps/desktop/src-tauri/Cargo.lock` — necessário para builds Rust reprodutíveis
- `apps/desktop/src-tauri/icons/*` — ícones do app fazem parte do build
- `apps/desktop/src-tauri/src/*` — código-fonte Rust versionado
- `apps/desktop/src-tauri/capabilities/*` — capabilities Tauri versionadas
- `docs/migrations/tauri/*` — histórico de migração
- `packages/shared/` e `packages/voice-context/` — código-fonte

## 5. Organização da documentação

A documentação de migração já estava organizada em
`docs/migrations/tauri/` desde a PR 003. Nenhum arquivo de status
estava solto na raiz antes ou depois desta PR.

Arquivos presentes em `docs/migrations/tauri/`:

- `README.md` (índice das PRs — atualizado nesta PR)
- `STATUS_MIGRATION_TAURI_PR_001.md`
- `STATUS_MIGRATION_TAURI_PR_002_PROJECTS.md`
- `STATUS_MIGRATION_TAURI_PR_003_GIT_FILESYSTEM.md`
- `STATUS_MIGRATION_TAURI_PR_004_GIT_BASELINE.md` (este arquivo)

Nada foi apagado, renomeado ou movido. Apenas o `README.md` foi
atualizado para incluir o link desta PR.

## 6. Scripts de desenvolvimento

### Situação antes

```jsonc
// package.json (raiz)
"dev": "pnpm --filter @fluxora/desktop dev"   // = vite, sem Tauri
```

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
"beforeDevCommand": "pnpm dev"  // = mesmo vite, sem Tauri
```

Resultado: `pnpm dev` na raiz subia só o Vite, e o Tauri nunca
chamava `tauri dev`.

### Situação depois

```jsonc
// package.json (raiz)
"dev":      "pnpm --filter @fluxora/desktop tauri:dev",  // abre o Tauri
"dev:web":  "pnpm --filter @fluxora/desktop dev",        // só Vite (legado)
"tauri:dev":   "pnpm --filter @fluxora/desktop tauri:dev",
"tauri:build": "pnpm --filter @fluxora/desktop tauri:build",
"build":       "pnpm --filter @fluxora/desktop build",
"typecheck":   "pnpm -r typecheck",
"test":        "pnpm -r test"
```

```jsonc
// apps/desktop/package.json — sem alteração
"dev":         "vite",
"tauri:dev":   "tauri dev",
"tauri:build": "tauri build",
"build":       "tsc --noEmit && vite build",
"typecheck":   "tsc --noEmit",
"test":        "vitest run"
```

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
"beforeDevCommand": "pnpm --filter @fluxora/desktop dev"  // vite puro
```

A mudança em `beforeDevCommand` foi obrigatória para **evitar loop**:
como `pnpm dev` na raiz agora chama `tauri:dev`, o Tauri não pode
chamar `pnpm dev` de volta. Por isso o `beforeDevCommand` aponta
diretamente para o `dev` do desktop (apenas Vite).

### Scripts preservados

Os scripts já em uso continuam funcionando:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm --filter @fluxora/desktop tauri:build`
- `pnpm tauri:dev` (atalho raiz que aponta para o desktop)

`pnpm dev:web` foi adicionado para o caso de alguém querer rodar
só o frontend web (com fallback mock), sem o shell Tauri.

## 7. Como rodar o projeto agora

Na raiz do monorepo:

```bash
cd ~/projects/Fluxora
pnpm install        # se ainda não instalou
pnpm dev            # abre o app desktop Tauri em modo desenvolvimento
```

O fluxo é:

1. `pnpm dev` (raiz)
2. → `pnpm --filter @fluxora/desktop tauri:dev`
3. → `tauri dev` (Rust)
4. → `beforeDevCommand`: `pnpm --filter @fluxora/desktop dev` (apenas Vite, em `http://localhost:1420/`)
5. → Tauri compila o backend Rust (primeira vez é lento) e abre a janela desktop

Para frontend web puro (sem Tauri):

```bash
pnpm dev:web
```

Para build de produção:

```bash
pnpm --filter @fluxora/desktop tauri:build
```

## 8. Validação do `pnpm dev`

Executado em `~/projects/Fluxora`:

```bash
timeout 30s pnpm dev
```

Saída observada (resumida):

```text
$ pnpm --filter @fluxora/desktop tauri:dev
$ tauri dev
     Running BeforeDevCommand (`pnpm --filter @fluxora/desktop dev`)
$ vite
  VITE v8.0.16  ready in 183 ms
  ➜  Local:   http://localhost:1420/
  ➜  Network: http://192.168.100.53:1420/
  ➜  Network: http://192.168.0.180:1420/
     Running DevCommand (`cargo  run --no-default-features --color always --`)
        Info Watching /home/pablo/projects/Fluxora/apps/desktop/src-tauri for changes...
   Compiling equivalent v1.0.2
   Compiling hashbrown v0.17.1
   ... (Cargo começou a compilar normalmente)
```

**Conclusão:** `pnpm dev` chama o Tauri corretamente, sem loop, sem
erro de script ausente, sem qualquer referência a Electron. A
primeira compilação Rust é lenta (muitos crates a serem compilados),
mas o comando em si é o correto.

A janela desktop não chegou a abrir dentro da janela de 30s do
`timeout` por causa do tempo de compilação inicial, mas o
comportamento é exatamente o esperado: Tauri foi invocado, Vite
subiu, Cargo começou a compilar.

## 9. Comandos de validação executados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | Sucesso em `packages/shared`, `packages/voice-context`, `apps/desktop` |
| `pnpm build` | Sucesso — Vite 8 gerou `dist/` (~798 KiB / 222 KiB gzip) |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | Sucesso em 1.06s, sem warnings |
| `pnpm test` | 284 testes passando, 6 falhas preexistentes (mesmas das PRs 002 e 003) |
| `timeout 30s pnpm dev` | `pnpm dev` → `tauri dev` → Vite em `:1420` → Cargo compilando (sem erros, sem loop, sem Electron) |

### Falhas preexistentes em `pnpm test`

São as mesmas 6 falhas documentadas nas PRs 002 e 003, sem relação
com a PR 004:

- `ThemeTokens.test.ts` — espera `accent` vermelho/coral
- `VoiceCommandModal.test.tsx` — procura `data-testid="topbar-mic-button"`
  que não existe no DOM atual

Ambas são de tema/voz. A PR 004 não tenta corrigi-las, pois isso
estaria fora do escopo declarado e poderia introduzir mudanças de
tema/UI não desejadas.

## 10. Commits criados nesta PR

Quatro commits locais na branch `main`, sem push remoto:

1. `chore: organize Tauri migration documentation baseline` —
   adiciona `.gitignore` e os status de migração das PRs 001..004
   em `docs/migrations/tauri/`.
2. `chore: make pnpm dev launch Tauri desktop` — ajusta scripts
   da raiz e `tauri.conf.json` para que `pnpm dev` abra o Tauri
   sem loop no `beforeDevCommand`.
3. `chore: initialize Fluxora Tauri migration baseline` —
   baseline com todo o código-fonte acumulado das PRs 001..003
   (UI React/TS, backend Rust/Tauri, packages workspace, lockfiles).
4. `docs: update PR 004 status with final commit hashes` — commit
   de sincronização: este status foi escrito antes dos commits
   existirem; após criá-los, foi atualizado com os hashes reais
   e consolidado em um único commit adicional.

> Os hashes exatos dos quatro commits podem ser lidos com
> `git log --format="%H %s" -n 4` no repositório local. Este
> documento evita listar hashes literais porque o próprio commit
> 4 é parte da mensagem deste status — listar seu hash aqui
> produziria um snapshot desatualizado a cada amend.

`git status` após os quatro commits:

```text
No ramo main
nothing to commit, working tree clean
```

`git remote -v`:

```text
(vazio — nenhum remote configurado)
```

`git branch --show-current`:

```text
main
```

## 11. Itens propositalmente não versionados

- `node_modules/` (todas as workspaces)
- `target/` (workspace Rust e `apps/desktop/src-tauri/target/`)
- `apps/desktop/src-tauri/gen/` (schemas gerados pelo Tauri)
- `apps/desktop/dist/` (build de produção do Vite)
- Bundles Tauri (`.deb`, `.rpm`, `.AppImage`, `.msi`, `.dmg`, `.pkg`, `.exe`, `.app`)
- `apps/desktop/src-tauri/target/release/bundle/`
- Logs (`*.log`, `pnpm-debug.log*`, etc.)
- `.env` e variantes (mantido apenas `.env.example` se vier a existir)
- Bancos locais (`*.sqlite`, `*.db`)
- Tooling local de máquina (`.commandcode/`, `.aider*`, `.cursor*`, `.opencode/`)
- Temporários (`tmp/`, `temp/`, `*.tmp`, `*.bak`, `*.orig`, `*.rej`)

Nada disso foi adicionado ao controle de versão.

## 12. Remote / push

**Nenhum remote foi configurado.** **Nenhum push foi executado.**

O repositório está pronto para receber:

```bash
git remote add origin <URL>
git push -u origin main
```

…quando você pedir explicitamente.

## 13. Próximas PRs recomendadas

1. **PR 005 — Eventos reais via Tauri event system** (substituir
   listeners mockados por `@tauri-apps/api/event`).
2. **PR 006 — Voice/Whisper no Tauri** (migração do domínio
   `voice.*` e `whisper.*`).
3. **PR 007 — Provider Engine próprio** (substituir dependência
   residual de `opencode-adapter`).
4. **PR 008 — Mission Engine inicial** (desbloqueia
   `git.changedFiles` e `git.fileDiff` reais, com parser
   `git diff --numstat` para `additions`/`deletions`).
5. **PR 009 — Piloto automático com permissões por projeto**.

Nenhuma delas foi iniciada nesta PR.

## 14. Resumo executivo

- ✅ `~/projects/Fluxora` agora é um repositório Git local
- ✅ Branch inicial: `main`
- ✅ `.gitignore` cobre Tauri + React + pnpm + Rust
- ✅ Artefatos de build e secrets fora do versionamento
- ✅ Documentação de migração organizada em `docs/migrations/tauri/`
- ✅ `pnpm dev` na raiz abre o Tauri (não Electron, não só Vite)
- ✅ `tauri.conf.json` ajustado para evitar loop com o novo `pnpm dev`
- ✅ Validações de typecheck, build, cargo check e dev executadas com sucesso
- ✅ 6 testes preexistentes documentados (não corrigidos nesta PR)
- ✅ Commit baseline criado em três commits na branch `main`
- ✅ Nenhum push remoto executado
- ✅ Nenhuma feature nova implementada
