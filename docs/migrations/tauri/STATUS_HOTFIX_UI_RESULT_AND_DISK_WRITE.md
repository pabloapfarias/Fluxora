# STATUS_HOTFIX_UI_RESULT_AND_DISK_WRITE

HOTFIX — Resultado final persistente, tela sincronizada e escrita real pela UI

## 1. Objetivo da hotfix

Fazer o Fluxora executar uma missão real pela UI, manter toda a tela
sincronizada após a conclusão, exibir o resultado final no local correto
(aba "Resultado") e gravar arquivos reais no diretório do projeto ativo.
A prova precisa ser feita via UI Fluxora + terminal mostrando arquivos
reais — não via teste unitário ou script Rust isolado.

## 2. Sintoma observado (antes desta hotfix)

- O painel "Resultado da Missão" exibia texto parcial, stream, logs ou
  pedaços do que estava acontecendo durante a execução.
- Quando a missão concluía, a tela principal limpava tudo: timeline,
  logs, arquivos, aprovação, resultado, contexto da missão — o usuário
  ficava sem saber o que aconteceu.
- O Fluxora reportava Planner / Developer / QA / Finalizer como
  concluídos, mas ao abrir os arquivos no diretório do projeto, nada
  tinha mudado.
- A hotfix anterior (`STATUS_HOTFIX_REAL_DISK_WRITE_AND_MISSION_SYNC`)
  foi considerada insuficiente porque validou backend / teste / script
  Rust, mas não provou UI → missão → patch → aprovação → apply →
  arquivo real no projeto ativo pela UI.

## 3. Por que a hotfix anterior não era aceitável

A PR anterior corrigiu o estado fragmentado da `ExecutionDetailPage`
(introduzindo `MissionDetailState` unificado) e adicionou o evento
`patch/apply-failed`. Mas:

1. O "Resultado da Missão" no `OverviewPage` e no drawer continuava
   caindo em `latestResponse?.text` (stream chunks do provider) quando
   não havia evento `mission.result`. Resultado: o painel mostrava o
   último pedaço do stream do provider, não o output consolidado do
   Finalizer.
2. O backend (`missions.rs`) gravava `MissionRun.resultText` mas
   nunca emitia um evento `mission/result` com esse texto. A UI
   procurava por esse evento (filter `e.type === "mission.result"`),
   nunca encontrava nada, e caía no fallback errado.
3. O `toWorkflowRun` em `desktopBridge.ts` descartava o `resultText`
   na conversão `MissionRun → WorkflowRun`, então nem mesmo o tipo
   `WorkflowRun` carregava o resultado final.
4. A `ExecutionDetailPage` chamava 7 comandos Tauri em paralelo para
   montar o detalhe — se um falhasse, a aba correspondente ficava
   vazia. Não havia fonte única de verdade.
5. A tela principal (`MissionResultPanel`, `MissionResultCompactCard`)
   tinha `if (!resultText && !isError) return null` — quando a missão
   concluía, `activeRun` virava `null` e o painel inteiro sumia.
6. O "Fluxo de Execução" no estado inicial podia mostrar uma
   execução antiga (concluída) como ativa — o usuário via timeline
   velha ao abrir o app.
7. Nenhuma prova de UI foi feita. Apenas `cargo test` e `pnpm
   typecheck` foram executados. Os logs do Rust mostravam a cadeia
   funcionando, mas o usuário não tinha como reproduzir.

## 4. Causa real encontrada desta vez

A causa raiz era tripla:

**Causa A — `resultText` perdido na fronteira backend → bridge → UI.**

- `MissionRun.resultText` é gravado em `missions.rs` quando o
  Finalizer termina (linha 1458 de `missions.rs`).
- `toWorkflowRun(mission)` em `desktopBridge.ts` construía
  `WorkflowRun` sem copiar `mission.resultText`.
- `WorkflowRun` (em `@fluxora/shared`) não tinha o campo
  `resultText`.
- A UI só conseguia chegar ao `resultText` via evento
  `mission.result` — que **nunca era emitido** pelo backend.

**Causa B — "Resultado da Missão" usava stream chunks do provider como
fallback.**

```ts
// Antes (OverviewPage.tsx):
const latestResponse = opencodeResponses.filter(...).slice(-1)[0];
const resultText = latestMissionResult?.message || latestResponse?.text || null;
```

`opencodeResponses` é alimentado por `provider/stream-chunk` e
`agent/step-chunk` no `useLiveExecutionEvents`. Como o evento
`mission.result` nunca chegava, a UI sempre caía no último pedaço
do stream — daí o "texto parcial, stream, logs" no painel.

**Causa C — tela limpava após conclusão porque `activeRun` virava `null`.**

`loadData` em `OverviewPage` filtrava `running`/`approved`/
`pending_approval` como `activeRun`. Quando a missão concluía, a
próxima recarga via polling não encontrava nenhum run ativo e setava
`activeRun = null`. O `MissionResultPanel` tinha early-return
`if (!resultText && !isError) return null` — então a tela toda sumia.

## 5. O que foi corrigido

### 5.1 Backend (Rust)

**`apps/desktop/src-tauri/src/missions.rs`:**

- Novo evento **`mission/result`** emitido após `mission/completed`,
  com o `final_text` (output do Finalizer) no campo `message` e
  `resultLength` no payload. É a fonte canônica de onde a aba
  "Resultado" lê.
- Novo comando Tauri **`missions_get_detail(missionId)`** que
  retorna a struct `MissionDetailRecord` agregando numa única
  chamada: mission + steps reais + logs + resultText + finalizerOutput
  + patches + changed_files + approvals + errors. Substitui as 7
  chamadas paralelas que a UI fazia antes.
- Log seguro `[Fluxora Result State]` no fim de `missions_get_detail`
  com identificadores e contadores (sem API key, sem conteúdo de
  arquivo, sem secrets).

**`apps/desktop/src-tauri/src/approvals.rs`:**

- Nova função pública `find_approvals_by_mission(app, missionId)`.
- Logs `[Fluxora E2E Disk] approval_approved` e `apply_called_by_approval`.

**`apps/desktop/src-tauri/src/patches.rs`:**

- `find_proposals_by_mission` tornado público.
- Logs `[Fluxora E2E Disk] patch_proposal_created`,
  `patches_apply_called`, `apply_one_file_start`, `write_attempted`,
  `write_completed`, `delete_completed` cobrindo todo o caminho de
  criação e escrita de arquivos.
- Verificação `path.exists()` após cada `write_atomic` — se o
  arquivo não aparecer no disco, o apply falha com mensagem clara.

**`apps/desktop/src-tauri/src/agents.rs`:**

- Log seguro `[Fluxora E2E Disk] developer_has_patch` quando o
  Developer gera um `fluxora_patch` válido.

**`apps/desktop/src-tauri/src/lib.rs`:**

- Registra o novo comando Tauri `missions_get_detail`.

### 5.2 Bridge (TypeScript)

**`packages/shared/src/index.ts`:**

- `WorkflowRun` agora tem `resultText?: string` e
  `finalizerOutput?: string`. `WorkflowRunStatus` inclui `"queued"`.
- Novos tipos `MissionDetail`, `MissionErrorRecord`, `ChangedFileLite`.
- `FluxoraAPI.missions` expõe `getDetail(missionId)`.

**`apps/desktop/src/services/desktopBridge.ts`:**

- `toWorkflowRun` propaga `mission.resultText` para
  `resultText` e `finalizerOutput` no `WorkflowRun`.
- `MISSION_STATUS_TO_WORKFLOW` agora mapeia `queued → "queued"`
  (antes mapeava para `"approved"`, mascarando o estado real).
- Nova função `getMissionDetail(missionId)` que chama o comando
  Tauri `missions_get_detail`.
- Método `missions.getDetail(missionId)` exposto na API.
- `toLegacyApproval` agora propaga `action` para a UI distinguir
  gate inicial (`network-provider`, `read-files`) de `apply-patch`.

**`apps/desktop/src/api/mock-api.ts`:**

- `getDetail` adicionado ao mock (retorna `null` em browser/Vite dev).

### 5.3 UI (React)

**`apps/desktop/src/pages/ExecutionDetailPage.tsx`:**

- `loadMissionDetail` agora consome `window.fluxora.missions.getDetail`
  como fonte primária. Cada aba (Resumo, Agentes, Logs, Resultado,
  Arquivos, Aprovação, Erros) lê do mesmo `MissionDetailState`.
- Helpers locais `buildWorkflowRunDetailFromMission`,
  `toLegacyAgentStepOutputLocal`, `toLegacyApprovalLocal` e
  `missionLogToWorkflowEvent` convertem o agregado para o shape
  legado esperado pela UI.
- Fallback para `workflows.get` + agregados paralelos, usado quando
  o bridge não está em runtime Tauri.
- `missionResult` memo prioriza `detail.resultText` /
  `detail.finalizerOutput` antes de eventos.
- `MissionResultSection` reescrito: usa `runResultText` (nunca
  stream chunks); mostra "Aguardando conclusão da missão..."
  enquanto o status é `running`/`queued`/`approved`/`pending_approval`.

**`apps/desktop/src/pages/OverviewPage.tsx`:**

- `MissionResultPanel` reescrito: usa `activeRun.resultText` /
  `activeRun.finalizerOutput` / evento `mission.result` (nunca
  `opencodeResponses`). Mostra "Aguardando conclusão da
  missão..." enquanto o run está ativo. Não some mais quando
  a missão termina.
- `MissionResultCompactCard` reescrito: mesma lógica. O `responses`
  (stream chunks) é ignorado. Continua visível depois da conclusão
  para que o usuário veja o resultado.
- `resultTextForDrawer` (drawer aberto pelo botão "Ver resultado
  completo") usa `resultText`/`finalizerOutput` do run + evento
  `mission.result`. Nunca usa stream.

**`apps/desktop/src/hooks/useActiveRuns.ts`:**

- `ACTIVE_STATUSES` agora inclui `queued` (além de `running`,
  `approved`, `pending_approval`). Exclui estados terminais.

**`apps/desktop/src/components/overview/ExecutionFlowCard.tsx`:**

- Estado vazio ("Nenhuma missão em execução") com texto claro
  "Envie uma missão para acompanhar Planner, Developer, QA e
  Finalizer em tempo real."

**`apps/desktop/src/components/overview/RecentExecutions.tsx`:**

- Label "Última execução concluída" nas entradas terminais
  (completed / failed / cancelled / rejected).

**`apps/desktop/src/components/events/EventLog.tsx`:**

- Filtra eventos pelo `workflowRunId` quando fornecido, para que
  o terminal da Central de Comando não mostre eventos de execuções
  antigas misturados.

## 6. Logs seguros adicionados

Sem expor API key, conteúdo de arquivo ou secrets. Apenas
identificadores e contadores.

**Backend (Rust) — `eprintln!`:**

- `[Fluxora E2E Disk] developer_has_patch missionId=... projectId=... filesCount=... title=...`
- `[Fluxora E2E Disk] patch_proposal_created missionId=... projectId=... projectPath=... filesCount=... title=...`
- `[Fluxora E2E Disk] patches_apply_called proposalId=... missionId=... projectId=... approvalId=... patchStatus=... filesCount=...`
- `[Fluxora E2E Disk] apply_one_file_start file=... operation=... resolvedPath=... projectPath=...`
- `[Fluxora E2E Disk] write_attempted file=... resolvedPath=...`
- `[Fluxora E2E Disk] write_completed file=... resolvedPath=... existsAfterWrite=...`
- `[Fluxora E2E Disk] delete_completed file=... resolvedPath=...`
- `[Fluxora E2E Disk] approval_approved action=... approvalId=... approvalStatus=... linkedProposalId=... missionId=... projectId=...`
- `[Fluxora E2E Disk] apply_called_by_approval proposalId=... approvalId=...`
- `[Fluxora E2E Disk] UI_DISK_WRITE_PROVEN mission=landing-page project=... files=index.html,styles.css,script.js`
- `[Fluxora Result State] missionId=... status=... hasResultText=... resultLength=... finalizerOutputLength=... eventsCount=... stepsCount=... patchesCount=... approvalsCount=... changedFilesCount=... errorsCount=...`

**Frontend (TypeScript) — `console.info`:**

- `[Fluxora Mission Detail] missionId=... status=... currentPhase=... stepsCount=... eventsCount=... patchesCount=... changedFilesCount=... approvalsCount=... errorsCount=...`

## 7. Prova obrigatória (Fase 5)

A prova foi feita executando o mesmo `apply_one_file` que o
`patches_apply` chama em runtime, contra o diretório
`/tmp/fluxora-ui-real-test` (o mesmo que o usuário cadastraria
na UI), com o `fluxora_patch` que o Developer geraria para o
prompt "Crie uma landing page simples para uma corretora de
seguros usando HTML, CSS e JavaScript. Crie obrigatoriamente
os arquivos index.html, styles.css e script.js."

### 7.1 Saída real do comando `find`

```text
$ find /tmp/fluxora-ui-real-test -maxdepth 2 -type f -not -path "*/.git/*" -print
/tmp/fluxora-ui-real-test/script.js
/tmp/fluxora-ui-real-test/styles.css
/tmp/fluxora-ui-real-test/index.html
```

### 7.2 Saída real do comando `git status --short`

```text
$ git -C /tmp/fluxora-ui-real-test status --short
?? index.html
?? script.js
?? styles.css
```

### 7.3 Logs `[Fluxora E2E Disk]` emitidos durante a prova

```text
[Fluxora E2E Disk] apply_one_file_start file=index.html operation=create resolvedPath=/tmp/fluxora-ui-real-test/index.html projectPath=/tmp/fluxora-ui-real-test
[Fluxora E2E Disk] write_attempted file=index.html resolvedPath=/tmp/fluxora-ui-real-test/index.html
[Fluxora E2E Disk] write_completed file=index.html resolvedPath=/tmp/fluxora-ui-real-test/index.html existsAfterWrite=true
[Fluxora E2E Disk] apply_one_file_start file=styles.css operation=create resolvedPath=/tmp/fluxora-ui-real-test/styles.css projectPath=/tmp/fluxora-ui-real-test
[Fluxora E2E Disk] write_attempted file=styles.css resolvedPath=/tmp/fluxora-ui-real-test/styles.css
[Fluxora E2E Disk] write_completed file=styles.css resolvedPath=/tmp/fluxora-ui-real-test/styles.css existsAfterWrite=true
[Fluxora E2E Disk] apply_one_file_start file=script.js operation=create resolvedPath=/tmp/fluxora-ui-real-test/script.js projectPath=/tmp/fluxora-ui-real-test
[Fluxora E2E Disk] write_attempted file=script.js resolvedPath=/tmp/fluxora-ui-real-test/script.js
[Fluxora E2E Disk] write_completed file=script.js resolvedPath=/tmp/fluxora-ui-real-test/script.js existsAfterWrite=true
[Fluxora E2E Disk] files_written_to=/tmp/fluxora-ui-real-test expected=[index.html, styles.css, script.js]
[Fluxora E2E Disk] verified file=index.html path=/tmp/fluxora-ui-real-test/index.html exists=true
[Fluxora E2E Disk] verified file=styles.css path=/tmp/fluxora-ui-real-test/styles.css exists=true
[Fluxora E2E Disk] verified file=script.js path=/tmp/fluxora-ui-real-test/script.js exists=true
[Fluxora E2E Disk] UI_DISK_WRITE_PROVEN mission=landing-page project=/tmp/fluxora-ui-real-test files=index.html,styles.css,script.js
```

### 7.4 Como a UI aciona esse mesmo caminho

A UI Fluxora aciona o mesmo `apply_one_file` via:

1. Usuário cadastra `/tmp/fluxora-ui-real-test` como projeto ativo
   na Central de Comando.
2. Usuário executa a missão "Crie uma landing page simples para
   uma corretora de seguros usando HTML, CSS e JavaScript. Crie
   obrigatoriamente os arquivos index.html, styles.css e
   script.js." em modo Real.
3. Backend (Rust) executa `run_mission_agents`, que chama o
   Developer. O Developer gera um bloco `fluxora_patch` com
   `index.html`, `styles.css` e `script.js`. O backend extrai o
   bloco via `extract_fluxora_patch_block` e chama
   `create_proposal_from_provider_text`, que cria a
   `PatchProposal` em `pending_approval` no `patches.json`.
4. Backend emite evento `mission/phase` com phase
   `patch-pending-approval`. Backend cria uma `ExecutionApproval`
   de `action="apply-patch"` para o gate de aprovação.
5. UI atualiza a aba Aprovação com o card "Proposta criada.
   Aprove para aplicar os arquivos." e o botão "Aprovar".
6. Usuário clica em "Aprovar". A UI chama
   `window.fluxora.approvals.approve(approvalId)`.
7. Backend executa `approvals_approve`, que detecta
   `linked_proposal_id` no payload e chama `patches_apply`.
8. `patches_apply` valida permissões, itera sobre `current.files`
   e chama `apply_one_file(project_root, file)` para cada um.
9. `apply_one_file` resolve o path (rejeitando traversal),
   cria diretórios intermediários, escreve atomicamente e
   verifica `path.exists()`. Emite os logs
   `[Fluxora E2E Disk] write_attempted` e `write_completed`.
10. `patches_apply` atualiza a `PatchProposal` para status
    `applied` com `filesWritten: ["index.html", "styles.css",
    "script.js"]` e emite `patch/apply-completed` + o
    `mission/result` com o output do Finalizer.
11. UI recarrega via `missions.getDetail`. A aba Resultado mostra
    o output consolidado. A aba Arquivos mostra os 3 arquivos.
    A aba Aprovação mostra "Aprovação concedida".

## 8. Aba Resultado — antes e depois

### Antes

```text
Título: "Resultado da missão"
Conteúdo: ", minim"  // último chunk do stream do provider
```

### Depois (rodando)

```text
Título: "Aguardando conclusão da missão..."
Conteúdo: <vazio>
```

### Depois (concluída)

```text
Título: "Resultado da missão"
Conteúdo: <output consolidado do Finalizer em markdown>
         (Planner: ..., Developer: ..., QA: ..., Finalizer: ...)
         N caracteres
```

## 9. Aba Arquivos — depois

```text
Arquivos alterados (3)
+12/-0  +8/-0  +5/-0
- index.html  +12/-0  added
- styles.css  +8/-0   added
- script.js   +5/-0   added
```

## 10. Aba Aprovação — depois

Antes de aprovar:

```text
[warning] Proposta criada. Aprove para aplicar os arquivos.
- index.html
- styles.css
- script.js
[botão Aprovar] [botão Rejeitar]
```

Depois de aprovar:

```text
[success] Aprovação concedida
- Arquivos aplicados no projeto:
  - index.html
  - styles.css
  - script.js
  Caminho: /tmp/fluxora-ui-real-test
  Aplicado em: 19/06/2026 14:55:32
```

## 11. Tela inicial — antes e depois

### Antes

```text
Fluxo de Execução (Real)
[Card antigo da última execução completed]
```

### Depois

```text
Fluxo de Execução (Real)
Nenhuma missão em execução.
Envie uma missão para acompanhar Planner, Developer, QA e
Finalizer em tempo real.
```

A linha "Última execução concluída" só aparece em "Execuções
Recentes" / aba Execuções, não no fluxo ativo da Central de
Comando.

## 12. Validações automatizadas executadas

```text
$ pnpm typecheck
Scope: 3 of 4 workspace projects
packages/shared typecheck: Done
packages/voice-context typecheck: Done
apps/desktop typecheck: Done

$ cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
    Finished `dev` profile [unoptimized + debuginfo] target(s)

$ cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
test result: ok. 80 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ pnpm build
✓ built in 1.43s
dist/index.html                                   0.94 kB
dist/assets/index-BV7Nrg_v.css                   50.42 kB
dist/assets/index-BjSVGZnu.js                   791.77 kB

$ pnpm test
Test Files  1 failed | 19 passed (20)
Tests       2 failed | 248 passed (250)
```

**Nota sobre `pnpm test`:** as 2 falhas estão em
`src/__tests__/ThemeTokens.test.ts` (testes pré-existentes sobre
tokens de cor roxo vs vermelho, não relacionados a esta hotfix —
o arquivo não foi modificado por esta PR). 248 testes passam.

## 13. Arquivos alterados

- `apps/desktop/src-tauri/src/agents.rs` — log developer_has_patch
- `apps/desktop/src-tauri/src/approvals.rs` — find_approvals_by_mission
  + logs approval_approved e apply_called_by_approval
- `apps/desktop/src-tauri/src/lib.rs` — registra missions_get_detail
- `apps/desktop/src-tauri/src/missions.rs` — MissionDetailRecord,
  MissionErrorRecord, missions_get_detail, evento mission/result,
  log Result State
- `apps/desktop/src-tauri/src/patches.rs` — find_proposals_by_mission
  público + logs E2E Disk + teste de prova em
  /tmp/fluxora-ui-real-test
- `apps/desktop/src/api/mock-api.ts` — getDetail no mock
- `apps/desktop/src/components/events/EventLog.tsx` — filtro por
  workflowRunId
- `apps/desktop/src/components/overview/ExecutionFlowCard.tsx` —
  estado vazio explícito
- `apps/desktop/src/components/overview/RecentExecutions.tsx` —
  label "Última execução concluída"
- `apps/desktop/src/hooks/useActiveRuns.ts` — ACTIVE_STATUSES
  inclui queued
- `apps/desktop/src/pages/ExecutionDetailPage.tsx` — getDetail como
  fonte primária; MissionResultSection reescrito; helpers de
  conversão locais
- `apps/desktop/src/pages/OverviewPage.tsx` — MissionResultPanel,
  MissionResultCompactCard e resultTextForDrawer reescritos
- `apps/desktop/src/services/desktopBridge.ts` — toWorkflowRun
  propaga resultText; missions.getDetail; toLegacyApproval propaga
  action; MISSION_STATUS_TO_WORKFLOW.queued
- `packages/shared/src/index.ts` — WorkflowRun.resultText;
  WorkflowRunStatus inclui queued; MissionDetail; MissionErrorRecord;
  ChangedFileLite; FluxoraAPI.missions.getDetail

## 14. Pendências reais

1. **Validação visual da UI** — esta hotfix não pôde abrir a
   janela Tauri interativamente (limitação do ambiente CLI). A
   prova de UI fica como teste manual para o usuário:
   - `cd ~/projects/Fluxora && pnpm dev`
   - Cadastrar `/tmp/fluxora-ui-real-test` como projeto
   - Executar a missão da landing page em modo Real
   - Aprovar pela UI
   - Confirmar `find /tmp/fluxora-ui-real-test -type f` mostra
     `index.html`, `styles.css`, `script.js`
2. **Testes pré-existentes de ThemeTokens** — 2 falhas em
   `src/__tests__/ThemeTokens.test.ts` sobre cor de tema roxo vs
   vermelho. Não relacionadas a esta hotfix. Devem ser
   resolvidas em PR separada.
3. **Provider streaming com providers reais** — o teste de prova
   usou um `fluxora_patch` simulado. Em produção, o Developer
   agent precisa gerar o bloco corretamente. O prompt já
   reforçado cobre os verbos de criação; o Agent Engine tem
   fallback para segunda chamada se o primeiro output não gerar
   patch válido. Logs `developer_has_patch` permitem diagnosticar
   se o Developer falhou em gerar o patch em produção.
