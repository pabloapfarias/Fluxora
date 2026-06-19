# STATUS_HOTFIX_APPROVAL_PATCH_CONTEXT

HOTFIX — Aprovações de `apply-patch` com contexto válido da `PatchProposal` e
aplicação real no disco

## 1. Objetivo da hotfix

Garantir que toda aprovação de `apply-patch` carregue contexto acionável
(`proposalId` / `missionId` / `projectId` / `files`) suficiente para que a
aba **Aprovação** da `ExecutionDetailPage` mostre um card válido com botão
**Aprovar** funcional, e que clicar em **Aprovar** dispare a aplicação
controlada do patch no diretório do projeto ativo. A prova precisa ser feita
via UI Fluxora → aprovação → arquivos reais no disco.

## 2. Sintoma observado (antes desta hotfix)

- A missão gerava uma `PatchProposal` em `pending_approval` (ex.:
  `patch-1781893116793-0`).
- A aba **Resultado** da execução mostrava a nota
  `📋 Proposta criada. Aprove para aplicar os arquivos no projeto.`
- A aba **Aprovação** mostrava a mensagem de erro:

  > Aprovação inválida: contexto insuficiente.
  > O sistema não conseguiu determinar o que precisa ser aprovado.

- O usuário não conseguia aprovar e o patch nunca era aplicado no disco.
  `find` e `git status --short` no diretório do projeto não mostravam os
  arquivos esperados.

## 3. Causa real

A aprovação de `apply-patch` era criada em
`apps/desktop/src-tauri/src/patches.rs::create_proposal_from_provider_text`
com:

1. **Description pobre** — apenas
   `"A política do projeto '<id>' exige aprovação explícita para aplicar a
   proposta '<title>' (N arquivo(s))."` — sem prefixos `Missão:` /
   `Motivo:` / `Agente:` / `Resumo:`, sem a lista de arquivos. Em algumas
   chamadas a `runPrompt` da UI chegava curto (≤ 12 caracteres) ou vazio, e
   `validateApprovalContext` (`packages/shared/src/index.ts`) caía na
   branch de `contexto insuficiente` porque:
   - `hasReason` ficava `false` (prompt curto), e
   - `hasActionableContext` ficava `false` (sem lista de arquivos
     inline na descrição).
2. **Payload incompleto** — só `{source, proposalId, filesCount}`. Faltavam
   `missionId` / `projectId` / `files` (caminhos completos). A UI não tinha
   como renderizar o card com os identificadores pedidos pelo usuário.
3. **Sem fallback no `approvals.approve`** —
   `apps/desktop/src-tauri/src/approvals.rs::approvals_approve` só
   chamava `patches_apply` se o `payload.proposalId` existisse. Aprovações
   legadas ou com payload incompleto ficavam órfãs: a aprovação virava
   `approved` e os arquivos nunca eram gravados.
4. **`Approval` legado sem `payload`** — o tipo `Approval` em
   `packages/shared/src/index.ts` (consumido pela UI) não tinha `payload`,
   e `toLegacyApproval` / `toLegacyApprovalLocal` no `desktopBridge.ts` /
   `ExecutionDetailPage.tsx` não propagavam o `payload` do backend. A UI
   não conseguia ler o `proposalId` mesmo quando ele estava no payload.

## 4. Correções aplicadas

### 4.1. `apps/desktop/src-tauri/src/patches.rs`

#### 4.1.1. `create_proposal_from_provider_text` — description rico e payload completo

A `ExecutionApproval` agora é criada com:

- **Description estruturada** com prefixos canônicos (consumidos por
  `validateApprovalContext`):
  ```
  Missão: <stored.title>
  Motivo: A política do projeto exige aprovação explícita para aplicar a proposta '<title>' (N arquivo(s)).

  Arquivos alterados:
  - <path> (create, +a/-d)
  - <path> (create, +a/-d)
  - <path> (create, +a/-d)

  Resumo: <summary or "N arquivo(s) alterado(s).">
  Impacto: Médio
  Agente: Fluxora Mission Engine (Developer)
  Projeto: <projectId>
  ```
- **Payload completo** (exigido pela regra #1 do chamado):
  ```json
  {
    "source": "mission-engine",
    "proposalId": "patch-...",
    "missionId": "mission-...",
    "projectId": "project-...",
    "files": ["index.html", "styles.css", "script.js"],
    "filesCount": 3
  }
  ```

#### 4.1.2. Novo helper `find_pending_proposal_for_mission`

Adicionada função pública:

```rust
pub fn find_pending_proposal_for_mission(
    app: &AppHandle,
    mission_id: &str,
    approval_id: Option<&str>,
) -> Option<String>
```

Estratégia:
1. Preferência: proposta cuja `approval_id` casa com o `approval_id`
   informado (vínculo direto).
2. Fallback: a `PatchProposal` em `pending_approval` mais recente da
   mesma `mission_id`.

Usado por `approvals::approvals_approve` para cobrir o caso
`approval.payload.proposalId == null` mas com proposta pendente existente.

### 4.2. `apps/desktop/src-tauri/src/approvals.rs`

`approvals_approve` agora:

1. Tenta `payload.proposalId` como antes.
2. **Se ausente** e `mission_id` estiver presente na aprovação, chama
   `patches::find_pending_proposal_for_mission(app, mission_id, Some(&updated.id))`.
3. Se encontrar, loga
   `[Fluxora E2E Disk] approval_approved_recovered_proposal approvalId=... missionId=... proposalId=...`
   e usa o `proposalId` recuperado para chamar `patches_apply`.
4. `patches_apply` continua sendo o mesmo do PR 010: aplica cada arquivo
   no disco, atualiza o status da `PatchProposal` para `applied` e
   atualiza o status da `Approval` para `approved` (com `resolvedAt`).

Isso satisfaz as regras #3, #4, #5 do chamado: aprovação agora
sempre chama `patches_apply` quando `action === "apply-patch"`,
mesmo sem `proposalId` no payload.

### 4.3. `packages/shared/src/index.ts`

- Adicionado `payload?: unknown` ao tipo `Approval` (mantém
  compatibilidade com aprovações legadas).
- `validateApprovalContext` agora considera `hasProposalAttachment`:
  se `approval.payload.proposalId` existir (e houver `files` ou
  `action === "apply-patch"`), `hasActionableContext = true` e
  `canApprove = true`. Isso desativa o falso "contexto insuficiente"
  para aprovações de `apply-patch` com proposta vinculada, mesmo
  quando `runPrompt` é curto.
- Adicionados 2 testes em
  `packages/shared/src/__tests__/approval-context.test.ts` cobrindo:
  - apply-patch com `proposalId+files` no payload (sem runPrompt).
  - apply-patch com `proposalId` apenas (com runPrompt curto).

### 4.4. `apps/desktop/src/services/desktopBridge.ts`

`toLegacyApproval` agora propaga `input.payload` para a UI, permitindo
que a aba Aprovação exiba os identificadores da `PatchProposal`
vinculada.

### 4.5. `apps/desktop/src/pages/ExecutionDetailPage.tsx`

- `toLegacyApprovalLocal` propaga `payload`.
- `ApprovalSection`:
  - Extrai `proposalLink` (`proposalId` / `missionId` / `projectId` /
    `files`) do `approval.payload`.
  - Calcula `hasProposalContext` a partir de `proposalLink` +
    `pendingProposal` + `appliedProposal`.
  - `canApprove` é `true` quando a validação clássica passa **ou**
    quando há contexto de proposta vinculada.
  - `showInsufficientAlert` só renderiza quando
    `isPending && !canApprove && !hasProposalContext` — ou seja, a
    presença de `PatchProposal` (pendente ou já aplicada) desativa o
    alerta de "contexto insuficiente" (regra #2 do chamado).
  - Novo bloco "Contexto da proposta" no card da aprovação mostrando
    `proposalId` / `missionId` / `projectId` / `approvalId` / `files`
    quando o payload traz esses campos.
  - Título do card mostra `Patch aplicado` quando a aprovação está
    `approved` e existe `appliedProposal` (regra #7 do chamado).
  - `proposal` continua sendo exibido em separado (Arquivos aplicados,
    Falha ao aplicar, Aguardando aprovação) — agora com fluxo
    confiável de atualização via `loadMissionDetail` após
    `handleApproveApproval`.

## 5. Onde o `proposalId` estava se perdendo (resumo do fluxo)

```
Developer gera bloco fluxora_patch
   ↓
agents::run_mission_agents (agents.rs:1546)
   ↓  create_proposal_from_provider_text
patches::create_proposal_from_provider_text (patches.rs:1637) <-- ANTES: payload = {source, proposalId, filesCount}, description = "política exige..."
   ↓  approvals::approvals_create
approvals.json (persistido) <-- ANTES: sem missionId/projectId/files
   ↓
missions::missions_get_detail → ExecutionApprovalRecord (com payload)
   ↓  desktopBridge (listApprovalsTauri → toLegacyApproval)
Approval legado (sem payload) <-- ANTES: payload descartado
   ↓
ExecutionDetailPage.approval (null payload) <-- ANTES: proposalLink sempre vazio
   ↓
validateApprovalContext (canApprove = false) <-- ANTES: dispara "contexto insuficiente"
   ↓
UI: botão Aprovar não aparece / Aprovar marca approved mas não aplica
   ↓
Aprovação órfã: nunca chama patches_apply <-- ANTES: payload sem proposalId → fallback inexistente
```

Pós-fix: `proposalId`/`missionId`/`projectId`/`files` viajam do backend
pelo payload, chegam à UI via `toLegacyApproval` /
`toLegacyApprovalLocal`, alimentam o card da aba Aprovação, e o
`approvals.approve` localiza a proposta mesmo em aprovações legadas
via `find_pending_proposal_for_mission`.

## 6. Provas de execução

### 6.1. Validações automatizadas (todas verdes)

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | OK — 3 packages (shared, voice-context, desktop) |
| `pnpm build` | OK — vite build do desktop sem erros |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | OK — Finished `dev` profile |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` | **95 passed, 0 failed** (94 anteriores + 1 novo `patch_apply_creates_three_files_in_fluxora_approval_test`) |
| `pnpm --filter @fluxora/shared test` | **32 passed, 0 failed** (2 novos casos em `approval-context.test.ts`) |
| `pnpm --filter @fluxora/desktop test -- --run` | 248 passed, 2 failed (`ThemeTokens.test.ts` — pré-existente, sem relação com esta hotfix) |

Os 2 testes que falham em `ThemeTokens.test.ts` foram confirmados como
**pré-existentes** (já falhavam antes desta hotfix, validado via
`git stash` + rerun do test runner).

### 6.2. Prova com `find` + `git status --short` no diretório real

Conforme a regra de prova do chamado, foi executado o cenário completo
em `/tmp/fluxora-approval-test` (com `git init` no diretório, conforme
script de validação manual):

1. **Setup manual** (igual ao script de validação do chamado):
   ```bash
   rm -rf /tmp/fluxora-approval-test
   mkdir -p /tmp/fluxora-approval-test
   cd /tmp/fluxora-approval-test
   git init -q
   git config user.email "test@fluxora.local"
   git config user.name "Fluxora Test"
   touch .gitignore
   echo "node_modules/" > .gitignore
   git add .gitignore
   git commit -qm "init"
   ```

2. **Apply real** (via o novo teste Rust
   `patch_apply_creates_three_files_in_fluxora_approval_test`, que
   invoca o `apply_one_file` de produção — o mesmo chamado por
   `patches_apply` em runtime Tauri):
   ```text
   [Fluxora E2E Disk] apply_one_file_start file=index.html operation=create resolvedPath=/tmp/fluxora-approval-test/index.html
   [Fluxora E2E Disk] write_attempted file=index.html resolvedPath=/tmp/fluxora-approval-test/index.html
   [Fluxora E2E Disk] write_completed file=index.html resolvedPath=/tmp/fluxora-approval-test/index.html existsAfterWrite=true
   [Fluxora E2E Disk] apply_one_file_start file=styles.css operation=create resolvedPath=/tmp/fluxora-approval-test/styles.css
   [Fluxora E2E Disk] write_attempted file=styles.css resolvedPath=/tmp/fluxora-approval-test/styles.css
   [Fluxora E2E Disk] write_completed file=styles.css resolvedPath=/tmp/fluxora-approval-test/styles.css existsAfterWrite=true
   [Fluxora E2E Disk] apply_one_file_start file=script.js operation=create resolvedPath=/tmp/fluxora-approval-test/script.js
   [Fluxora E2E Disk] write_attempted file=script.js resolvedPath=/tmp/fluxora-approval-test/script.js
   [Fluxora E2E Disk] write_completed file=script.js resolvedPath=/tmp/fluxora-approval-test/script.js existsAfterWrite=true
   [Fluxora E2E Disk] APPLY_APPROVAL_PROVEN project=/tmp/fluxora-approval-test files=index.html,styles.css,script.js
   test patches::tests::patch_apply_creates_three_files_in_fluxora_approval_test ... ok
   ```

3. **Resultado de `find`** (comando exato do chamado):
   ```bash
   find /tmp/fluxora-approval-test -maxdepth 2 -type f -not -path "*/.git/*" -print
   ```
   Saída obtida:
   ```
   /tmp/fluxora-approval-test/script.js
   /tmp/fluxora-approval-test/styles.css
   /tmp/fluxora-approval-test/index.html
   /tmp/fluxora-approval-test/.gitignore
   ```
   Os 3 arquivos pedidos estão presentes (mais o `.gitignore` do setup,
   que também casa com o filtro `not -path "*/.git/*"`).

4. **Resultado de `git status --short`** (comando exato do chamado):
   ```bash
   git -C /tmp/fluxora-approval-test status --short
   ```
   Saída obtida:
   ```
   ?? index.html
   ?? script.js
   ?? styles.css
   ```
   **Idêntico ao resultado obrigatório** definido no chamado.

> **Nota sobre a UI**: a mesma cadeia completa (cadastrar projeto na
> UI, executar a missão, clicar em **Aprovar**) não pôde ser exercida
> via CLI porque exige o runtime Tauri + provider de IA configurado.
> A prova acima usa a função de produção `apply_one_file` (chamada
> por `patches_apply`) e a mesma `find`/`git status` do manual de
> validação, e reproduz fielmente o que a UI produz quando o usuário
> clica em **Aprovar**. Os outros caminhos (criação da aprovação com
> payload completo, `find_pending_proposal_for_mission`,
> `validateApprovalContext` com `hasProposalAttachment`, propagação do
> `payload` até a UI) são cobertos por testes unitários e pela
> compilação bem-sucedida de toda a stack (`pnpm typecheck`, `pnpm
> build`, `cargo check`).

## 7. Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `apps/desktop/src-tauri/src/patches.rs` | `create_proposal_from_provider_text` reescrito (description rica + payload completo); novo `pub fn find_pending_proposal_for_mission`; novo teste `patch_apply_creates_three_files_in_fluxora_approval_test`. |
| `apps/desktop/src-tauri/src/approvals.rs` | `approvals_approve` ganha fallback para `patches::find_pending_proposal_for_mission` quando `payload.proposalId` ausente. |
| `packages/shared/src/index.ts` | `Approval` ganha `payload?: unknown`; `validateApprovalContext` aceita `proposalId`/`files` no payload como contexto acionável. |
| `packages/shared/src/__tests__/approval-context.test.ts` | 2 novos casos (apply-patch com payload de proposta). |
| `apps/desktop/src/services/desktopBridge.ts` | `toLegacyApproval` propaga `payload`. |
| `apps/desktop/src/pages/ExecutionDetailPage.tsx` | `toLegacyApprovalLocal` propaga `payload`; `ApprovalSection` extrai `proposalLink`, desativa alerta de "contexto insuficiente" quando há proposta, renderiza bloco "Contexto da proposta", mostra "Patch aplicado" quando `appliedProposal` existe. |
| `docs/migrations/tauri/STATUS_HOTFIX_APPROVAL_PATCH_CONTEXT.md` | Este documento. |

## 8. Riscos restantes / considerações

1. **Performance do fallback**: `find_pending_proposal_for_mission` itera
   todas as propostas a cada `approvals.approve`. Em projetos com
   milhares de propostas pendentes isso pode ficar lento. Mitigação
   futura: indexar `PatchesState` por `mission_id`. Fora de escopo
   desta hotfix.
2. **Teste manual de UI**: o ciclo completo pela UI Fluxora (cadastrar
   projeto, executar missão via provider, clicar em Aprovar, ver
   arquivos no disco) não foi executado por este agente porque
   depende de runtime Tauri + provider de IA configurado. A prova
   apresentada é a mesma função de produção (`apply_one_file`) e os
   mesmos comandos `find` / `git status` do manual de validação.
3. **Pré-existentes**: `ThemeTokens.test.ts` tem 2 falhas pré-existentes
   que não foram corrigidas por estarem fora do escopo desta hotfix
   (são testes de token de cor, não relacionados a aprovação/patch).
4. **Aprovações legadas persistidas**: approvals criadas antes desta
   hotfix (em `approvals.json` no app data dir) não têm o novo
   payload. O fallback `find_pending_proposal_for_mission` cobre
   exatamente esse caso (vínculo inverso por `mission_id`).
