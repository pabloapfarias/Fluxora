# Fluxora

> Central desktop para orquestrar agentes de IA em múltiplos projetos.

Fluxora é um aplicativo desktop (Electron + React) que transforma a forma como desenvolvedores trabalham com agentes de IA. Em vez de alternar entre terminais e prompts soltos, você **fala ou digita uma missão** e o Fluxora distribui o trabalho entre agentes especializados, acompanha a execução em tempo real e só aplica mudanças com sua aprovação.

[Quick start](#quick-start) · [Features](#features) · [Comando por voz](#comando-por-voz) · [Stack](#stack) · [Changelog](#changelog) · [Docs](#docs)

---

## Quick start

```bash
pnpm install        # instala dependências + compila better-sqlite3
pnpm dev            # abre a janela Electron
pnpm typecheck      # valida tipos
pnpm test           # roda a suíte de testes
```

**Pré-requisitos:** Node.js >= 22, pnpm >= 11. OpenCode CLI opcional (para modo de execução real).

---

## Features

- **Multi-projeto** — cadastre quantos projetos quiser (Laravel, Flutter, Node, Vue, React, scripts). Cada um com sua pasta, stack e comandos.
- **4 modos de execução** — Simulado, Real, Multiagente e Execução Controlada. Do playground ao controle total.
- **Aprovação humana** — toda alteração detectada gera aprovação pendente com contexto rico. Aprovar ou rejeitar em um clique.
- **Comando por voz** — interim em tempo real com tradução automática para EN e ES. Funciona sem instalar nada.
- **Workflow Engine** — fluxo previsível: Planejamento → Implementação → QA → Correção → QA Final → Relatório.
- **Catálogo dinâmico** — providers e modelos descobertos em runtime via OpenCode CLI. Zero lista hardcoded.
- **Model Router** — cada agente pode usar um provider/modelo diferente.
- **Observabilidade** — fluxo visual dinâmico, logs categorizados, diff colorido por arquivo.
- **Segurança** — renderer isolado, comandos validados, comandos perigosos bloqueados, aprovação obrigatória.

---

## Comando por voz

> **Novo na PR 013:** interim em tempo real com cursor piscando + tradução automática para EN/ES via MyMemory + visualizador de áudio reativo.

O Fluxora permite acionar o Orquestrador por voz ou digitação. **3 formas** de usar:

### Padrão: Web Speech API (recomendado)

Funciona sem instalar nada, sem API key, sem download. Usa o reconhecimento de fala nativo do Chromium do Electron.

- **Interim em tempo real** — veja o texto sendo formado enquanto fala
- **3 painéis simultâneos** — original (PT) + tradução EN + tradução ES
- **7 idiomas source** — pt-BR, en-US, es-ES, fr-FR, de-DE, ja-JP, zh-CN
- **Visualizador de áudio** — bars animadas que reagem à sua voz
- **Export** — .txt, .json, .webm

### Nuvem: OpenAI Whisper

Para máxima precisão, configure sua chave da OpenAI (ou Groq, Mistral, etc.) nas Configurações → Captura de Áudio → Nuvem (OpenAI).

### Local: servidor próprio (avançado)

Configure a URL de um servidor whisper local (ex.: `faster-whisper-server`, `whisper.cpp`) nas Configurações → Captura de Áudio → Voz local.

---

## Arquitetura

```
┌──────────────────────────────────────────┐
│ Fluxora Desktop (Electron + React)       │
│ Interface visual + voz + aprovações      │
└─────────────────┬────────────────────────┘
                  │ IPC seguro (contextIsolation)
┌─────────────────▼────────────────────────┐
│ Main Process                             │
│ projetos, comandos, permissões, OpenCode │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ Workflow Engine                          │
│ planner → dev → QA → fix → final          │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ OpenCode Adapter / Model Router          │
│ agentes, modelos, sessões, providers     │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ Projetos locais                          │
│ Laravel, Flutter, Vue, React, Node etc.  │
└──────────────────────────────────────────┘
```

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Desktop | Electron 42 + React 19 + Vite 6 |
| Linguagem | TypeScript 6 |
| Estilo | Tailwind CSS |
| Roteamento | react-router-dom 7 |
| Banco | SQLite (better-sqlite3 12) |
| Ícones | lucide-react 1 |
| Testes | vitest 3 |
| Empacotamento | pnpm 11 + workspaces |
| STT | Web Speech API + Whisper HTTP |
| Tradução | MyMemory API (gratuito) |
| Motor IA | OpenCode CLI (opcional) |

**Monorepo**: `packages/` (shared, workspace-core, workflow-engine, model-router, voice-context, opencode-adapter) + `apps/desktop`.

---

## Changelog

### PR 013 (atual) — Voice Rewrite
- Interim em tempo real com cursor piscando (palavra por palavra)
- 3 painéis simultâneos: original + EN + ES via MyMemory (gratuito)
- Visualizador de áudio reativo (bars animadas)
- Provider default: Web Speech API (zero setup)
- WhisperBundler removido (whisper_local virou opt-in avançado)
- `adm-zip`, `WhisperServerClient`, ~1000 linhas de complexidade removidos
- [Detalhes](docs/STATUS_PR_013_VOICE_REWRITE.md)

### PR 012 — Settings e ajustes de voz
### PR 011 — Modernização do stack (Electron 42, React 19, Vite 6, TS 6)
### PR 010 — Usage & Analytics
### PR 009 — Catálogo dinâmico do OpenCode
### PR 008 — Observabilidade real + multiagente
### PR 007 — Tema cockpit + logs em tempo real
### PR 006 — Execução controlada na UI
### PR 005 — Sandbox isolado + diff real
### PR 004 — Diagnóstico + streaming + cancelamento
### PR 003 — Multiagente + Whisper HTTP
### PR 002 — Integração real com OpenCode CLI
### PR 001 — MVP funcional

---

## Docs

- [Especificação técnica](fluxora_docs/PROJECT_SPEC.md) — visão completa do produto
- [Documentação de marketing](fluxora_docs/MARKETING_DYNAMIC_CATALOG.md) — posicionamento e diferenciais
- [PR 013 — Voice Rewrite](docs/STATUS_PR_013_VOICE_REWRITE.md) — detalhes da reescrita de voz
- [PR 009 — Catálogo dinâmico](docs/IMPLEMENTATION_PR_009.md) — como funciona o catálogo OpenCode
- [PRs anteriores](docs/) — status detalhado de cada marco

---

## Licença

Uso interno. Desenvolvido para auxiliar o desenvolvimento dos próprios sistemas.
