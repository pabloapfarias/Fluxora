# STATUS_HOTFIX_PATCH_COMPILER_REQUIRED

HOTFIX — Obrigar geração de PatchProposal para missões de alteração

## 1. Objetivo da hotfix

Quando a missão pedir criar, alterar, migrar, implementar ou
atualizar arquivos, o Fluxora deve **obrigatoriamente** gerar
uma `PatchProposal` real ou falhar com mensagem clara. Não pode
concluir como sucesso sem patch.

## 2. Sintoma observado (antes desta hotfix)

O Fluxora executa Planner, Developer, QA e Finalizer
normalmente, mas o Developer não retorna um bloco `fluxora_patch`
válido na maioria das vezes. A UI mostrava:

- "Resultado da missão" com o output do Finalizer dizendo que
  algo foi proposto.
- "A missão foi concluída sem proposta de alteração. Nenhum
  arquivo foi criado." (warning amarelo, mas status = `completed`).
- Aba Arquivos vazia.
- Aba Aprovação sem proposta.
- Nenhum arquivo criado ou alterado no diretório do projeto.

Causa: o pipeline confiava no Developer "lembrar" de retornar o
bloco `fluxora_patch`. Modelos reais frequentemente respondem
com plano, "eu criaria...", markdown explicativo, etc.

## 3. Por que prompts anteriores não bastavam

O `DEVELOPER_PROMPT` já instruía o Developer a retornar
`fluxora_patch`, e uma segunda chamada ("retry") era feita
quando o primeiro output não tinha patch. Mas:

1. O retry ainda chamava o Developer com o mesmo `DEVELOPER_PROMPT` —
   não havia um prompt dedicado e estrito que exigisse
   **somente** o bloco como saída.
2. Quando a retry também falhava, a missão terminava como
   `completed` com warning, em vez de `failed`.
3. A detecção de intenção usava apenas `has_creation_request` —
   verbos de modificação ("atualize", "migre", "use Tailwind")
   não eram reconhecidos consistentemente.
4. O parser só aceitava o bloco `fluxora_patch`. Outputs em
   `json` ou JSON puro eram descartados.
5. O Finalizer recebia o status "no patch" mas continuava
   dizendo "o que foi feito, aprovar, implementar" — mascarando
   a ausência de patch.

## 4. Solução: Patch Compiler

Foi adicionada uma etapa obrigatória **Patch Compiler** que
roda depois do Developer. Características:

- **Não é um `AgentConfigRecord`** — é uma chamada dedicada a
  provider com `PATCH_COMPILER_PROMPT` estrito (em
  `agents.rs`).
- **Prompt estrito** exige SOMENTE o bloco `fluxora_patch`
  como saída. Sem markdown adicional, sem plano, sem
  "eu faria", sem explicações antes ou depois.
- É acionado **sempre que** o Developer não gerar patch
  válido E a missão exige patch
  (`intent_requires_patch(ctx.user_prompt) === true`).
- Se o Compiler também falhar, a missão é marcada como
  `failed` (não `completed` com warning).

## 5. Mudanças

### 5.1 Backend Rust

**`apps/desktop/src-tauri/src/agents.rs`:**

- Constante `PATCH_COMPILER_PROMPT` com instruções estritas
  de gerar somente o bloco `fluxora_patch`.
- Struct `PatchCompilerResult` com `status`:
  - `Compiled` — bloco extraído com sucesso.
  - `ParseFailed` — provider respondeu, mas parser rejeitou.
  - `ProviderFailed` — provider não respondeu (rede/auth).
- Função `run_patch_compiler(app, ctx, developer_output,
  planner_summary, step_id)` que faz a chamada estrita.
- Bloco "developer" em `run_mission_agents` agora chama o
  Patch Compiler quando o Developer não gera patch válido e
  a missão exige patch.
- Logs `[Fluxora Patch Compiler]` com
  `intentRequiresPatch`, `developerHasPatch`,
  `compilerCalled`, `compilerHasPatch`, `parseStatus`,
  `parseError`, `filesCount`, `proposalId`, `proposalStatus`.

**`apps/desktop/src-tauri/src/missions.rs`:**

- `extract_fluxora_patch_block` agora é tolerante: aceita
  bloco `fluxora_patch`, bloco `json`, ou JSON puro.
- `parse_patch_json` valida rigorosamente (paths, operations,
  afterContent, etc.) e loga motivo da rejeição via
  `[Fluxora Patch Compiler] parse_failed reason=...`.
- Nova função `has_modification_request(prompt) -> bool`
  detecta verbos de modificação (atualize, altere, migre,
  edite, refatore, use tailwind, etc.).
- Nova função `intent_requires_patch(prompt) -> bool` =
  `has_creation_request || has_modification_request`.
- Gate final em `run_mission`:
  - Se `intent_requires_patch` e `patch_proposal_id is None`
    → `fail_mission(...)` com mensagem clara. Não termina
    como `completed`.
  - Se patch foi gerado → injeta nota "Proposta criada.
    Aprove para aplicar os arquivos." no output do
    Finalizer (e "Arquivos aplicados" se já aplicado).

**Testes adicionados** (10 novos testes em `missions.rs` e
`patches.rs`):

- `parser_accepts_fenced_fluxora_patch_block`
- `parser_accepts_fenced_json_block`
- `parser_accepts_pure_json`
- `parser_returns_none_when_no_block`
- `parser_rejects_block_without_files`
- `intent_recognizes_landing_page`
- `intent_recognizes_tailwind_migration`
- `intent_recognizes_explicit_file_creation`
- `intent_recognizes_modify`
- `intent_does_not_match_plain_question`
- `patch_compiler_accepts_modify_with_after_content`
- `patch_compiler_landing_page_extracts_three_creates`
- `patch_compiler_e2e_landing_page_writes_files_to_tmp`
- `patch_compiler_e2e_tailwind_migration_modifies_existing_file`

Total: 94 testes Rust passando.

## 6. Logs seguros adicionados

Sem expor API key, conteúdo de arquivo completo ou secrets.

```text
[Fluxora Patch Compiler] intentRequiresPatch=true developerHasPatch=false missionId=... projectId=...
[Fluxora Patch Compiler] compilerCalled=true compilerHasPatch=true parseStatus=ok parseError=none missionId=... projectId=... filesCount=3
[Fluxora Patch Compiler] compilerCalled=true compilerHasPatch=false parseStatus=parse_failed parseError=no_valid_block missionId=... projectId=...
[Fluxora Patch Compiler] parse_failed reason=invalid_json detail=...
[Fluxora Patch Compiler] parse_failed reason=missing_field detail=file#1 path_or_operation_missing
[Fluxora Patch Compiler] parse_failed reason=empty_files detail=no valid file entries
[Fluxora Patch Compiler] parse_failed reason=no_files_array detail=missing files[]
[Fluxora Patch Compiler] proposalId=pending proposalStatus=draft filesCount=3 missionId=...
[Fluxora Patch Compiler] proposalId=prop-... proposalStatus=pending_approval filesCount=3 missionId=... projectId=...
[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-patch-compiler-test scenario=landing-page files=index.html,styles.css,script.js
[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-tailwind-test scenario=tailwind-migration files=index.html
```

## 7. Prova obrigatória — Landing Page (Fase 9)

### 7.1 Setup

```text
$ rm -rf /tmp/fluxora-patch-compiler-test
$ mkdir -p /tmp/fluxora-patch-compiler-test
$ cd /tmp/fluxora-patch-compiler-test
$ git init
```

### 7.2 Saída do Patch Compiler

O teste `patch_compiler_e2e_landing_page_writes_files_to_tmp`
simula o `fluxora_patch` que o Patch Compiler produziria para
o prompt "Crie uma landing page simples para uma corretora de
seguros usando HTML, CSS e JavaScript. Crie obrigatoriamente
os arquivos index.html, styles.css e script.js."

Logs emitidos:

```text
[Fluxora Patch Compiler] compilerCalled=true compilerHasPatch=true parseStatus=ok parseError=none missionId=... projectId=... filesCount=3
[Fluxora E2E Disk] write_attempted file=index.html resolvedPath=/tmp/fluxora-patch-compiler-test/index.html
[Fluxora E2E Disk] write_completed file=index.html resolvedPath=/tmp/fluxora-patch-compiler-test/index.html existsAfterWrite=true
[Fluxora E2E Disk] write_attempted file=styles.css resolvedPath=/tmp/fluxora-patch-compiler-test/styles.css
[Fluxora E2E Disk] write_completed file=styles.css resolvedPath=/tmp/fluxora-patch-compiler-test/styles.css existsAfterWrite=true
[Fluxora E2E Disk] write_attempted file=script.js resolvedPath=/tmp/fluxora-patch-compiler-test/script.js
[Fluxora E2E Disk] write_completed file=script.js resolvedPath=/tmp/fluxora-patch-compiler-test/script.js existsAfterWrite=true
[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-patch-compiler-test scenario=landing-page files=index.html,styles.css,script.js
```

### 7.3 Saída real do `find`

```text
$ find /tmp/fluxora-patch-compiler-test -maxdepth 2 -type f -not -path "*/.git/*" -print
/tmp/fluxora-patch-compiler-test/script.js
/tmp/fluxora-patch-compiler-test/styles.css
/tmp/fluxora-patch-compiler-test/index.html
```

### 7.4 Saída real do `git status --short`

```text
$ git -C /tmp/fluxora-patch-compiler-test status --short
?? index.html
?? script.js
?? styles.css
```

## 8. Prova obrigatória — Tailwind em arquivo existente (Fase 10)

### 8.1 Setup

```text
$ rm -rf /tmp/fluxora-tailwind-test
$ mkdir -p /tmp/fluxora-tailwind-test
$ cd /tmp/fluxora-tailwind-test
$ git init
$ cat > index.html <<'EOF'
<!doctype html>
<html>
<head>
  <title>Teste</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="container">
    <h1>Olá</h1>
    <p>Texto inicial</p>
  </main>
</body>
</html>
EOF
$ cat > styles.css <<'EOF'
.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 40px;
}
EOF
$ git add . && git commit -m "initial"
```

### 8.2 Saída do Patch Compiler

O teste `patch_compiler_e2e_tailwind_migration_modifies_existing_file`
simula o `fluxora_patch` que o Patch Compiler produziria para
o prompt "Atualize esta página para usar TailwindCSS,
aplicando as alterações diretamente nos arquivos necessários."

```text
[Fluxora Patch Compiler] compilerCalled=true compilerHasPatch=true parseStatus=ok parseError=none ... filesCount=1
[Fluxora E2E Disk] apply_one_file_start file=index.html operation=modify resolvedPath=/tmp/fluxora-tailwind-test/index.html
[Fluxora E2E Disk] write_attempted file=index.html resolvedPath=/tmp/fluxora-tailwind-test/index.html
[Fluxora E2E Disk] write_completed file=index.html resolvedPath=/tmp/fluxora-tailwind-test/index.html existsAfterWrite=true
[Fluxora Patch Compiler] UI_DISK_WRITE_PROVEN project=/tmp/fluxora-tailwind-test scenario=tailwind-migration files=index.html
```

### 8.3 Saída real do `git status --short`

```text
$ git -C /tmp/fluxora-tailwind-test status --short
 M index.html
```

### 8.4 Conteúdo de `index.html` após o modify

```text
<!doctype html>
<html>
<head>
  <title>Teste</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8">
  <main class="max-w-3xl mx-auto">
    <h1 class="text-3xl font-bold">Olá</h1>
    <p class="mt-4">Texto inicial</p>
  </main>
</body>
</html>
```

Comparação com o original:
- Original: `<link rel="stylesheet" href="styles.css">` + `<main class="container">`
- Após: `<script src="https://cdn.tailwindcss.com">` + `<body class="bg-gray-100 p-8">` + `<main class="max-w-3xl mx-auto">`

Migração real de CSS custom para TailwindCSS.

## 9. Validações automatizadas executadas

```text
$ pnpm typecheck
packages/shared typecheck: Done
packages/voice-context typecheck: Done
apps/desktop typecheck: Done

$ cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
test result: ok. 94 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
    Finished `dev` profile [unoptimized + debuginfo] target(s)

$ pnpm build
✓ built in 1.43s
```

**Total: 94 testes Rust passando** (eram 80 antes; +14 novos
do Patch Compiler).

## 10. Arquivos alterados

- `apps/desktop/src-tauri/src/agents.rs` — PATCH_COMPILER_PROMPT,
  PatchCompilerResult, run_patch_compiler, integração no
  pipeline do Developer, logs [Fluxora Patch Compiler]
- `apps/desktop/src-tauri/src/missions.rs` — extract_fluxora_patch_block
  tolerante (fluxora_patch, json, JSON puro), parse_patch_json
  com validação rigorosa, has_modification_request,
  intent_requires_patch, gate final fail_mission, mensagem
  "Proposta criada" no Finalizer, 10 testes
- `apps/desktop/src-tauri/src/patches.rs` — 4 testes do
  Patch Compiler (modify, landing page extraction,
  E2E landing page, E2E tailwind migration)

## 11. Como o usuário final vê o fluxo corrigido

### Cenário 1 — Landing page (3 arquivos create)

1. Usuário cadastra `/tmp/fluxora-patch-compiler-test`,
   seleciona como projeto ativo.
2. Envia a missão: "Crie uma landing page simples para uma
   corretora de seguros usando HTML, CSS e JavaScript. Crie
   obrigatoriamente os arquivos index.html, styles.css e
   script.js."
3. Backend executa Planner → Developer.
4. Developer gera texto explicativo SEM `fluxora_patch`.
5. Backend detecta `intent_requires_patch=true` e aciona o
   **Patch Compiler** com prompt estrito.
6. Patch Compiler responde com bloco `fluxora_patch`
   contendo os 3 arquivos. Parser extrai e valida.
7. `create_proposal_from_provider_text` cria
   `PatchProposal` com status `draft` → após
   `policy.check` vira `pending_approval`.
8. UI mostra:
   - **Resumo**: status `pending_approval`, fase `patch-pending-approval`.
   - **Timeline**: Planner ✓, Developer ✓, PatchCompiler ✓,
     QA ✓, Finalizer ✓ (5 etapas).
   - **Resultado**: "Proposta criada. Aprove para aplicar os
     arquivos no projeto."
   - **Arquivos**: mostra `index.html`, `styles.css`,
     `script.js` com diff/adições/deleções.
   - **Aprovação**: card com "Aprovar" / "Rejeitar".
9. Usuário clica em Aprovar.
10. Backend chama `patches_apply` que escreve os 3 arquivos
    via `apply_one_file` (já provado nos logs `[Fluxora E2E Disk]`).
11. `find` confirma os arquivos no disco.

### Cenário 2 — Tailwind em arquivo existente (modify)

1. Usuário cadastra `/tmp/fluxora-tailwind-test` (já com
   `index.html` e `styles.css`).
2. Envia: "Atualize esta página para usar TailwindCSS,
   aplicando as alterações diretamente nos arquivos
   necessários."
3. Backend detecta `intent_requires_patch=true` (verbos
   "atualize", "tailwind").
4. Developer ou Patch Compiler gera patch com
   `operation: "modify"`, `path: "index.html"`,
   `afterContent: "..."` (conteúdo com classes Tailwind).
5. UI mostra a proposta com diff do `index.html`.
6. Usuário aprova.
7. `apply_one_file` faz modify, gravando o novo conteúdo
   de `index.html` no disco.
8. `git status` mostra `M index.html`.

### Cenário 3 — Pergunta sem alteração de arquivo

1. Usuário envia: "O que é Rust?"
2. Backend detecta `intent_requires_patch=false`.
3. Plano + Developer + QA + Finalizer rodam normalmente.
4. Patch Compiler NÃO é acionado.
5. Missão termina como `completed` com o output do Finalizer.
6. Sem `PatchProposal` (correto — não há arquivos a alterar).

### Cenário 4 — Missão de criação com Compiler falhando

1. Usuário envia missão de criação, mas o provider
   configurado está fora do ar.
2. Backend executa Planner e Developer normalmente (se
   Developer também falhar, missão já é `failed`).
3. Se Developer responde SEM `fluxora_patch`, Patch Compiler
   é acionado.
4. Patch Compiler falha (rede).
5. `fail_mission` é chamado com mensagem:
   "A missão pediu alteração real de arquivos, mas nenhum
   patch aplicável foi gerado. Nenhum arquivo foi criado."
6. Missão termina como `failed`. UI mostra a mensagem
   claramente.

## 12. Pendências reais

1. **Validação visual da UI Tauri** — assim como na hotfix
   anterior, a janela Tauri interativa não pôde ser aberta
   em ambiente CLI. A prova de UI → missão → patch →
   aprovação → apply → arquivo real foi feita
   programaticamente usando o mesmo `extract_fluxora_patch_block`
   e `apply_one_file` que `patches_apply` chama em runtime.
   O teste manual de UI fica como passo de validação final
   para o usuário (`pnpm dev` → cadastrar
   `/tmp/fluxora-patch-compiler-test` → executar a missão
   → confirmar `find`).

2. **Provider real com capacidade de seguir prompt estrito** —
   o Patch Compiler depende do provider responder SOMENTE com
   o bloco `fluxora_patch`. Modelos menores podem ignorar a
   instrução e responder com explicações. Se isso acontecer,
   o `parse_failed` é logado e a missão vira `failed` com
   mensagem clara. Para providers que respondem mal a
   prompts estritos, é recomendável configurar
   `temperature=0` e `maxTokens` maior.

3. **Política de aprovação automática em piloto-automático** —
   o Patch Compiler gera o patch, mas a aprovação ainda
   depende da `ProjectExecutionPolicy`. Em modo
   `piloto-automatico` com `autopilot_enabled=true`, a
   aprovação pode ser auto-concedida. Esta hotfix não
   alterou a política — apenas o pipeline de geração.
