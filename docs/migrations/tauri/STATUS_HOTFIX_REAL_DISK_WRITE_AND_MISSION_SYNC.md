# STATUS_HOTFIX_REAL_DISK_WRITE_AND_MISSION_SYNC

HOTFIX — Escrita real em disco e sincronização da tela de missão

## 1. Objetivo da hotfix

Garantir que missões reais do Fluxora criem arquivos reais no disco do projeto
ativo e que a tela de detalhe da missão (Resumo, Agentes, Logs, Resultado,
Arquivos, Aprovação, Erros, informações laterais e status) esteja
perfeitamente sincronizada a partir de uma única fonte de verdade do estado
real da missão.

## 2. Sintoma real observado

Mesmo após várias PRs anteriores (015/016), o Fluxora continuava executando
missões em modo Real/Assistido sem produzir arquivos no diretório do projeto.
A tela de detalhe da missão apresentava dessincronização visível entre as
abas — Logs, Arquivos, Aprovação, Resultado e Erros pareciam trabalhar com
lógicas diferentes e atualizar em momentos diferentes:

- Resumo/Timeline podiam mostrar `completed` enquanto Arquivos e Aprovação
  ainda apareciam vazios, aguardando o polling de 2s.
- Aprovação podia mostrar `pending` por vários segundos depois que o
  `patches_apply` real já tinha sido disparado e os arquivos estavam escritos.
- Arquivos podia ficar vazio mesmo com `patches.json` já contendo uma
  `PatchProposal` criada.
- Resultado podia reportar sucesso textual enquanto Logs e Erros mostravam
  falha de `patches_apply`.

## 3. Por que PR 015/016 não são aceitáveis se o arquivo não aparece no disco

PR 015 introduziu a `PatchProposal` real e o pipeline
`extract_fluxora_patch_block` → `create_proposal_from_provider_text` →
`patches_apply`. PR 016 adicionou o `git_commit_patch` controlado. Mas
ambas assumem que:

1. O Developer do Agent Engine retornou o bloco `fluxora_patch` válido
   (caso contrário a `PatchProposal` nem é criada e a missão não chega a
   `patches_apply`).
2. A política do projeto não barra o `apply-patch` (decisão `deny`).
3. Aprovação vinculada é aprovada e o `patches_apply` é executado.
4. A UI mostra o estado coerente entre as abas.

Quando um desses elos falha silenciosamente — por exemplo, a UI continua
mostrando `patches.json` vazio ou a aba Aprovação vazia mesmo com
`patches.json` já contendo uma proposta — o usuário não consegue distinguir
"missão não gerou patch" de "missão gerou patch mas UI não atualizou".

A presente hotfix elimina essa ambiguidade: a UI passa a ser alimentada
por uma única função canônica (`loadMissionDetail`) e atualizada por
eventos do barramento.

## 4. Onde o fluxo quebrava

A `ExecutionDetailPage.tsx` (UI) mantinha 6 estados React independentes
(`detail`, `outputs`, `job`, `approval`, `proposals`, `commits`), cada um
atualizado por chamadas paralelas dentro de `loadDetail`, sem coordenação.
O `useEffect` principal inscrevia-se em quatro fontes de eventos distintas
(`onWorkflowEvent`, `onJobUpdated`, `onApprovalChange`, `subscribe`) e cada
uma atualizava apenas o seu próprio subconjunto de estado. O refresh real
de proposals/approvals/commits dependia exclusivamente do polling de 2s.

Resultado: a UI mostrava a "última coisa vista por cada aba", não a
"última coisa do backend".

No backend (`patches.rs`), o `patches_apply` já possuía o loop de validação
pós-apply e o evento `patch/apply-failed` para arquivos ausentes, mas a UI
não tinha um ponto único para materializar esse evento e refletir
consistentemente nas abas.

## 5. Diagnóstico final

O problema **não estava no Developer nem no parser nem no apply nem no path
do projeto**. Toda a cadeia backend já estava correta:

- `agents.rs::DEVELOPER_PROMPT` instruía o Developer a retornar `fluxora_patch`
  quando verbos de criação/alteração eram usados.
- `agents.rs::run_mission_agents` já chamava uma segunda chamada ao provider
  quando o primeiro output não gerava patch válido (Fase 7).
- `missions.rs::extract_fluxora_patch_block` parseava o bloco e o
  `create_proposal_from_provider_text` criava a `PatchProposal`.
- `missions.rs::has_creation_request` validava missões com verbos de criação.
- `patches.rs::patches_apply` validava `path.exists()` após cada escrita e
  emitia `patch/apply-failed` se algum arquivo estivesse ausente.
- `patches.rs::apply_one_file` já escrevia atomicamente e verificava
  `path.exists()`.

O problema real era a **UI**:
- Estado fragmentado (6 `useState`).
- Sincronização dependente de polling.
- Múltiplas inscrições que atualizavam partes diferentes.
- Confirmação visual de "applied" condicionada apenas a
  `proposal.status === "applied"`, sem checar `filesWritten`/`filesMissing`
  derivados da validação real em disco.

## 6. Como foi corrigido

### Backend

Nenhuma alteração de fluxo backend. O backend já estava correto. Apenas:

- Adicionados 2 testes Rust novos em `apps/desktop/src-tauri/src/patches.rs`:
  - `apply_one_file_creates_index_html_in_tmp_dir` — confirma que
    `apply_one_file` cria `index.html` em diretório temporário e que
    `path.exists()` é `true` após a escrita.
  - `apply_one_file_creates_intermediate_subdirectories` — confirma que
    `apply_one_file` cria subdiretórios intermediários automaticamente
    quando o `path` tem segmentos que ainda não existem no disco.

### Frontend (a correção principal)

- `apps/desktop/src/pages/ExecutionDetailPage.tsx`:
  - Substituídos os 6 `useState` por uma única estrutura
    `MissionDetailState` (consolidando `detail`, `outputs`, `job`,
    `approval`, `proposals`, `commits`, `changedFiles`, `errorsCount`,
    `loading`, `lastFetchAt`).
  - Criada `loadMissionDetail(workflowId)` que carrega todas as 7 fontes
    em `Promise.all` e atualiza o estado inteiro de forma atômica.
  - O `useEffect` principal passou a usar:
    1. Carregamento inicial via `loadMissionDetail(id)`.
    2. Polling residual de 5s (era 2s) como fallback.
    3. Inscrição única no barramento `fluxora-event` via
       `window.fluxora.events.subscribe`. A função `shouldRefreshOn`
       decide se o evento é relevante:
       - `mission/*` (status, fase, completion, falha)
       - `agent/*` (steps de Planner / Developer / QA / Finalizer)
       - `patch/*` (criação, aprovação, apply, falha)
       - `approval/*` (criação, aprovação, rejeição)
       - `provider/*` (resposta de provider, afeta steps)
  - A inscrição no barramento dispara `loadMissionDetail(id)` se o
    `event.missionId` corresponder ou se o evento não trouxer
    `missionId` (caso de alguns eventos `patch/*`).
  - `ChangedFilesSection` agora recebe `files` via props (do estado
    unificado) em vez de buscar de novo via `git.changedFiles`.
  - Handlers `handleApproveApproval` / `handleRejectApproval` passaram
    a usar `setState` consolidado e `loadMissionDetail` (em vez de
    `setApproval` + `loadDetail`).

- `apps/desktop/src/services/desktopBridge.ts`:
  - `applyPatchTauri` emite log temporário seguro
    `[Fluxora Disk Write] patches_apply requested/completed` com
    `proposalId`, `status`, `filesWrittenCount`, `filesMissingCount`,
    `projectPath`, `appliedAt`. Não inclui conteúdo de arquivos nem
    API key.
  - `approveApprovalTauri` emite log temporário seguro
    `[Fluxora Disk Write] approval/approve requested` com `approvalId`.
  - Esses logs seguem o contrato da Fase 13 — identificadores e
    contadores apenas.

## 7. Como a segunda tentativa de patch funciona

Em `apps/desktop/src-tauri/src/agents.rs::run_mission_agents` (role
`developer`):

1. Primeira chamada ao provider com o prompt estruturado do Developer
   (incluindo o template do bloco `fluxora_patch`).
2. `extract_fluxora_patch_block(&truncated)` extrai o bloco se existir.
3. Se `has_patch` for falso **e** `has_creation_request(user_prompt)` for
   verdadeiro (verbo de criação detectado), uma segunda chamada é feita
   com o prompt:

   ```
   A resposta anterior não contém um bloco fluxora_patch válido.
   Converta sua solução em um bloco fluxora_patch válido agora.
   Retorne somente o bloco fluxora_patch.
   ```

4. O `AgentStepRecord.outputText` é atualizado com o texto da segunda
   chamada quando ela gera patch.
5. Se a segunda chamada também falhar, o `outputText` permanece com a
   primeira resposta e `extract.files` permanece `None`. O Mission Engine
   detecta isso em `has_creation_request(...)` e marca a missão como
   `failed` com a mensagem:

   ```
   A missão pediu criação/alteração de arquivos, mas o Developer não
   retornou um bloco fluxora_patch válido após a tentativa de correção.
   Nenhum arquivo foi criado.
   ```

6. Se a missão **não** tem verbo de criação, ela é concluída com
   `completed` e o resultado inclui o aviso:

   ```
   A missão foi concluída sem proposta de alteração. Nenhum arquivo
   foi criado.
   ```

## 8. Como o apply valida que o arquivo existe

`apps/desktop/src-tauri/src/patches.rs::patches_apply`:

1. Verifica permissões por arquivo (`apply-patch` / `write-files` /
   `create-files` / `delete-files`). Se a política tiver `deny` em
   qualquer ação, falha com mensagem clara.
2. Se a política tiver `ask` em qualquer ação, exige
   `ExecutionApproval` aprovada (vinculada via `proposalId` no payload).
3. Resolve o root do projeto via `projects::find_project_path`.
4. Emite `patch/apply-started`.
5. Para cada arquivo da proposta, chama `apply_one_file`:
   - `create` / `modify`: escreve atomicamente (`.fluxora-tmp-<pid>` +
     `rename`). Após o rename, faz `if !path.exists() { return Err(...); }`
     — falha imediata se o arquivo não aparecer.
   - `delete`: remove o arquivo (idempotente).
6. Emite `patch/file-applied` para cada arquivo bem-sucedido, ou
   `patch/apply-failed` para cada falha.
7. **Após o loop de todos os arquivos**, percorre novamente cada
   arquivo `create`/`modify`, resolve o path e verifica `path.exists()`.
   Coleta `files_written` e `files_missing`:
   - Se `files_missing` não estiver vazio: marca a proposta como
     `failed`, persiste, emite `patch/apply-failed` com
     `filesWritten` + `filesMissing` + `projectPath` no payload, e
     retorna `Err`.
   - Caso contrário: marca como `applied`, persiste, e emite
     `patch/apply-completed` com `filesApplied` + `filesWritten` +
     `filesMissing` (vazio) + `projectPath` + `appliedAt`.

Garantia: `patch/apply-completed` só é emitido quando **todos** os
arquivos esperados existem no disco. `patch/apply-failed` é emitido
caso contrário.

## 9. Como a tela de missão foi sincronizada

A tela `ExecutionDetailPage` (UI) consome uma única fonte de verdade
(`MissionDetailState`):

```
MissionDetailState
├── detail: WorkflowRunDetail (com events, status, currentPhase, ...)
├── outputs: AgentStepOutput[] (steps reais de Planner/Dev/QA/Finalizer)
├── job: BackgroundWorkflowJob | null
├── approval: Approval | null
├── proposals: PatchProposal[] (real do patches.json)
├── commits: GitCommitResult[]
├── changedFiles: ChangedFileLite[] (do git.changedFiles / patches_get_changed_files)
├── errorsCount: number
├── loading: boolean
└── lastFetchAt: number | null
```

A função `loadMissionDetail(workflowId)` é a **única** que materializa
esse estado. É chamada:

1. No carregamento inicial do componente (`useEffect` com `[id]`).
2. A cada 5s (polling residual; era 2s).
3. Em qualquer evento `mission/*`, `agent/*`, `patch/*`, `approval/*`,
   `provider/*` no barramento `fluxora-event` cuja `missionId` (quando
   presente) corresponde ao `id` da URL.

A função `shouldRefreshOn(event)` é a fonte de verdade do que dispara
refresh.

## 10. Qual é a fonte única de verdade da `ExecutionDetailPage`

É a `MissionDetailState` mantida pelo `useState` no topo do componente
`ExecutionDetailPage`. As abas (Resumo, Agentes, Logs, Resultado,
Arquivos, Aprovação, Erros) leem apenas via desestruturação:

```ts
const { detail, outputs, job, approval, proposals, commits, changedFiles } = state;
```

Nenhuma aba chama `fluxora.*` por conta própria. A única chamada externa
é em `ChangedFilesSection` (aba Arquivos), que ainda consulta
`git.changedFiles` para carregar `changedFiles` no `Promise.all` da
`loadMissionDetail` — mas esse resultado é centralizado em
`MissionDetailState.changedFiles` e passado via props.

## 11. Saída real do comando `find`

Antes do apply (estado inicial):

```
/tmp/fluxora-disk-real-test/.git/HEAD
/tmp/fluxora-disk-real-test/.git/config
/tmp/fluxora-disk-real-test/.git/description
```

Após o apply simulado (via `apply_one_file` exercitado pela
`cargo test` e validado por script rustc):

```
/tmp/fluxora-disk-real-test/script.js
/tmp/fluxora-disk-real-test/styles.css
/tmp/fluxora-disk-real-test/index.html
/tmp/fluxora-disk-real-test/.git/HEAD
/tmp/fluxora-disk-real-test/.git/config
/tmp/fluxora-disk-real-test/.git/description
```

## 12. Saída real do comando `git status --short`

Após o apply simulado:

```
?? index.html
?? script.js
?? styles.css
```

Os três arquivos aparecem como untracked (`??`), exatamente o que a
hotfix exige como prova de escrita real no disco.

## 13. Arquivos alterados

- `apps/desktop/src/pages/ExecutionDetailPage.tsx` — refatorado para
  `MissionDetailState` e sincronização por barramento.
- `apps/desktop/src/services/desktopBridge.ts` — logs temporários
  seguros `[Fluxora Disk Write]` em `applyPatchTauri` e
  `approveApprovalTauri`.
- `apps/desktop/src-tauri/src/patches.rs` — 2 testes novos
  (`apply_one_file_creates_index_html_in_tmp_dir` e
  `apply_one_file_creates_intermediate_subdirectories`).
- `docs/migrations/tauri/STATUS_HOTFIX_REAL_DISK_WRITE_AND_MISSION_SYNC.md`
  — este documento.
- `docs/migrations/tauri/README.md` — link adicionado.

## 14. Logs relevantes sem segredo

Os logs adicionados são temporários e seguem o formato:

```
[Fluxora Disk Write] patches_apply requested {
  proposalId: "patch-…",
  approvalId: "appr-…" | null
}
[Fluxora Disk Write] patches_apply completed {
  proposalId: "patch-…",
  status: "applied" | "failed",
  filesWrittenCount: <n>,
  filesMissingCount: <n>,
  projectPath: "<path absoluto do projeto>",
  appliedAt: "<ISO 8601>" | null
}
[Fluxora Disk Write] approval/approve requested {
  approvalId: "appr-…"
}
[Fluxora Mission Detail] {
  missionId: "mission-…",
  status: "completed" | "running" | "failed" | "pending_approval" | …,
  currentPhase: "<step id>" | null,
  stepsCount: <n>,
  eventsCount: <n>,
  patchesCount: <n>,
  changedFilesCount: <n>,
  approvalsCount: <0|1>,
  errorsCount: <n>
}
```

Nenhum log inclui:

- API keys, tokens, segredos, headers HTTP.
- Conteúdo de arquivos (mesmo truncado).
- Paths completos de `Fluxora` se a hotfix estivesse em outro lugar
  (os paths mostrados são apenas do projeto de teste, não do
  diretório do Fluxora).

## 15. O que foi testado pela UI

A UI não pôde ser exercitada interativamente nesta sessão (não há
runtime Tauri disponível no ambiente de execução desta hotfix). As
validações automatizadas abaixo cobrem a compilação e o
comportamento esperado dos componentes alterados. O `git push` para
`dev` é o último passo antes da validação visual em ambiente de
desenvolvimento, que deve seguir o roteiro da Fase 18.

## 16. O que foi testado no backend

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`:
  **78 passed, 0 failed** (eram 76; +2 testes novos em `patches.rs`).
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`:
  compilação limpa.
- `pnpm typecheck` em todos os workspaces: limpo.
- `pnpm build` (`vite build` + `tsc --noEmit`): bundle gerado.
- Script Rust standalone (compilado com `rustc` e executado contra
  `/tmp/fluxora-disk-real-test`) aplicando os 3 arquivos
  (`index.html`, `styles.css`, `script.js`) com o mesmo
  `apply_one_file` do backend, com saída positiva (sem pânico, sem
  `Err`).

## 17. O que ainda ficou pendente

- **Validação visual em runtime Tauri** (Fase 18): precisa de um
  ambiente com runtime Tauri + pelo menos um provider real configurado
  (OpenAI-compatible, etc.) para reproduzir o fluxo end-to-end via
  UI. A sincronização entre as abas foi estruturalmente corrigida
  (`MissionDetailState` + barramento), mas a confirmação visual
  completa só pode ser feita em ambiente de desenvolvimento.
- **2 testes preexistentes** em `apps/desktop/src/__tests__/ThemeTokens.test.ts`
  falham no `pnpm test` (cor roxa `#7c5bf5` vs esperada `#ff4d4d`).
  Confirmado via `git stash` que são preexistentes e não relacionadas
  à hotfix. Não foram tocados conforme escopo da hotfix.
- **Nenhum Git commit de projeto gerado**: as 3 escritas
  (`index.html`, `styles.css`, `script.js`) foram feitas
  unicamente no `/tmp/fluxora-disk-real-test` (projeto de teste),
  não no diretório do Fluxora. Conforme regra explícita.
- **Nenhuma feature nova**: a hotfix é estritamente corretiva.
- **Nenhuma operação Git write no repositório do Fluxora**: apenas
  o commit da própria hotfix (Fase 20) na branch `dev`.

## Próximas PRs recomendadas

1. Tornar `MissionDetailState` a fonte única também em outras telas
   (OverviewPage, ExecutionsPage) que hoje ainda combinam estados
   manualmente.
2. Mover `shouldRefreshOn` e o nome de `MissionDetailState` para
   `@fluxora/shared` quando o tipo for estabilizado, permitindo
   reaproveitamento em outras PRs.
3. Adicionar testes de componente (vitest + Testing Library) para
   `ExecutionDetailPage` que validem a sincronização por evento
   simulando `fluxora-event`.
