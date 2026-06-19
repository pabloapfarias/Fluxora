# Fluxora

> Desktop Tauri para executar missões com providers, agentes, permissões, aprovações, patches e streaming próprios.

O Fluxora usa motor próprio de providers, missões, agentes, permissões, aprovações, patches e streaming. A arquitetura atual não depende mais de OpenCode para catálogo, execução ou UX ativa.

## Quick start

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

Pré-requisitos: Node.js >= 22 e pnpm >= 11.

## Arquitetura atual

- Provider Engine persistido em `providers.json`
- Mission Engine persistido em `missions.json`
- Agent Engine persistido em `agents.json` e `agent_steps.json`
- Permissions e Approvals por projeto
- Patch Engine com aplicação controlada
- Event Bus próprio via Tauri
- Provider Streaming OpenAI-compatible
- Voice/Whisper configurável no app

## Produto

- Providers reais com suporte OpenAI-compatible e custom
- Agentes reais: Planner, Developer, QA e Finalizer
- Missões com execução assistida, propositiva e controlada por permissões
- Aprovações e diffs antes de aplicar mudanças
- Logs, eventos e timeline de execução
- Voz e transcrição configuráveis

## Docs

- [Migração Electron -> Tauri](docs/migrations/tauri/README.md)
- [PR 013 — Limpeza OpenCode, providers reais e UX](docs/migrations/tauri/STATUS_MIGRATION_TAURI_PR_013_CLEAN_OPENCODE_PROVIDER_UX.md)

## Histórico

Histórico: versões anteriores usavam OpenCode e Electron. Essas referências permanecem apenas na documentação histórica em `docs/migrations/tauri/`.

## Licença

Uso interno.
