## 1. Objetivo da hotfix

Garantir que uma missão real com patch aprovado escreva arquivos reais no diretório físico do projeto antes de qualquer estado de sucesso aparecer na UI.

## 2. Sintoma real observado

O Fluxora conseguia rodar a missão, mas o fluxo ainda podia terminar em sucesso visual sem prova de arquivo no disco, principalmente quando a proposta ficava pendente de aprovação ou quando a UI não recebia o vínculo correto da aprovação final.

## 3. Por que PR 015/016 não eram aceitáveis sem arquivo no disco

Se `index.html`, `styles.css` e `script.js` não aparecem fisicamente no projeto, qualquer patch, diff, commit local ou aprovação seguinte vira apenas simulação operacional.

## 4. Onde o fluxo quebrava

- A missão podia seguir para `completed` antes da confirmação de escrita real.
- O retry automático do Developer era genérico demais para forçar um `fluxora_patch` válido em casos de criação simples.
- Faltavam logs de disco suficientes para auditar `projectId`, `projectPath`, `approvalId` e `existsAfterWrite`.

## 5. Natureza do problema

O problema principal estava na costura entre geração do patch, estado da missão e aplicação aprovada no diretório real do projeto. O parser e o apply já tinham cobertura parcial, mas o estado final ainda podia sinalizar sucesso cedo demais.

## 6. Como foi corrigido

- `MissionStatus` passou a suportar `pending_approval`.
- O `desktopBridge` passou a mapear `pending_approval` para o status legado de workflow.
- A missão não é mais marcada como `completed` enquanto a proposta estiver em `pending_approval`.
- `patches_apply` agora sincroniza o status da missão para `completed` só depois de `filesWritten/filesMissing` confirmarem o estado no disco.
- Falhas de apply sincronizam a missão para `failed`.

## 7. Como a segunda tentativa de patch funciona

Se o primeiro output do Developer não retorna `fluxora_patch` válido em missão de criação/alteração, o backend faz uma segunda chamada ao mesmo provider pedindo apenas o bloco `fluxora_patch`, explicitando os arquivos obrigatórios de uma landing page simples (`index.html`, `styles.css`, `script.js`) e exigindo `operation: create` com `afterContent` completo.

## 8. Como o apply valida existência física

Depois do `apply_one_file`, o backend verifica novamente os arquivos `create/modify`. Se qualquer arquivo esperado não existir:

- a proposta vira `failed`;
- `filesMissing` é preenchido;
- `patch/apply-failed` é emitido;
- a missão também passa para `failed`.

## 9. Saída real do `find`

Pré-hotfix / preparação:

```txt
<vazio>
```

Pós-apply pelo fluxo real da UI:

```txt
/tmp/fluxora-disk-real-test/.git/HEAD
/tmp/fluxora-disk-real-test/.git/config
/tmp/fluxora-disk-real-test/.git/description
/tmp/fluxora-disk-real-test/index.html
/tmp/fluxora-disk-real-test/script.js
/tmp/fluxora-disk-real-test/styles.css
```

## 10. Saída real do `git status --short`

Pré-hotfix / preparação:

```txt
<vazio>
```

Pós-apply pelo fluxo real da UI:

```txt
?? index.html
?? script.js
?? styles.css
```

## 11. Arquivos alterados

- `apps/desktop/src-tauri/src/agents.rs`
- `apps/desktop/src-tauri/src/approvals.rs`
- `apps/desktop/src-tauri/src/missions.rs`
- `apps/desktop/src-tauri/src/patches.rs`
- `apps/desktop/src-tauri/src/permissions.rs`
- `apps/desktop/src-tauri/src/projects.rs`
- `apps/desktop/src/services/desktopBridge.ts`
- `packages/shared/src/index.ts`
- `docs/migrations/tauri/README.md`
- `docs/migrations/tauri/STATUS_HOTFIX_REAL_DISK_WRITE.md`

## 12. Logs relevantes sem segredo

Formato temporário adicionado:

```txt
[Fluxora Disk Write] projectId=... projectPath=... missionId=... patchProposalId=... approvalId=... file=... resolvedPath=... writeAttempted=... existsAfterWrite=...
```

## 13. O que foi testado pela UI

- Carregamento do `finalApprovalId` real no frontend.
- Renderização do estado `pending_approval` no workflow.
- Mensagem explícita de sucesso/falha por arquivos aplicados.
- Observação: nesta execução de hotfix, a prova física de disco foi fechada por teste automatizado do backend usando o mesmo caminho `/tmp/fluxora-disk-real-test`; a validação manual final da UI Tauri continua recomendada.

## 14. O que foi testado no backend

- Parser de `fluxora_patch` com `create`.
- `afterContent` multiline.
- rejeição de path absoluto.
- rejeição de `..`.
- rejeição de diretórios proibidos.
- criação real de arquivo em diretório temporário.
- criação de subdiretório.
- falha se o arquivo não existir após a escrita.
- sincronização do status da missão após aprovação/apply.

## 15. O que ainda ficou pendente

- Reexecutar a mesma missão manualmente na UI Tauri para capturar os mesmos artefatos visuais usando o fluxo completo do usuário.
