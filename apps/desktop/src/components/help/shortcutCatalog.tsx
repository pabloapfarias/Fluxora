import { Command, CornerDownLeft, ListChecks, Mic, Navigation, Keyboard } from "lucide-react";

export interface ShortcutItem {
  keys: string[];
  action: string;
}

export interface ShortcutSection {
  title: string;
  icon: typeof Command;
  items: ShortcutItem[];
}

export const shortcutSections: ShortcutSection[] = [
  {
    title: "Comando e voz",
    icon: Command,
    items: [
      { keys: ["Ctrl", "K"], action: "Abrir a paleta de comando" },
      { keys: ["/"], action: "Focar o campo principal de comando" },
      { keys: ["Ctrl", "Espaço"], action: "Abrir o painel de voz" },
      { keys: ["Enter"], action: "Enviar missão no campo de comando" },
      { keys: ["Shift", "Enter"], action: "Quebrar linha no campo de comando" },
    ],
  },
  {
    title: "Navegação global",
    icon: Navigation,
    items: [
      { keys: ["g", "o"], action: "Ir para Visão Geral" },
      { keys: ["g", "p"], action: "Ir para Projetos" },
      { keys: ["g", "e"], action: "Ir para Execuções" },
      { keys: ["g", "a"], action: "Ir para Agentes" },
      { keys: ["g", "r"], action: "Ir para Aprovações" },
      { keys: ["g", "s"], action: "Ir para Configurações" },
      { keys: ["g", "h"], action: "Ir para Atalhos" },
      { keys: ["?"], action: "Abrir ajuda rápida de atalhos" },
    ],
  },
  {
    title: "Listas e cards",
    icon: ListChecks,
    items: [
      { keys: ["↑", "↓"], action: "Navegar entre cards de agentes" },
      { keys: ["←", "→"], action: "Navegar horizontalmente entre cards" },
      { keys: ["Home"], action: "Ir ao primeiro card da lista" },
      { keys: ["End"], action: "Ir ao último card da lista" },
      { keys: ["Enter"], action: "Abrir o item selecionado" },
      { keys: ["Espaço"], action: "Abrir o item selecionado" },
    ],
  },
  {
    title: "Modais e diálogos",
    icon: CornerDownLeft,
    items: [
      { keys: ["Esc"], action: "Fechar modais e overlays" },
      { keys: ["Tab"], action: "Avançar foco dentro do modal" },
      { keys: ["Shift", "Tab"], action: "Voltar foco dentro do modal" },
    ],
  },
];

export const onboardingShortcuts = [
  { keys: ["Ctrl", "K"], title: "Paleta de comando", description: "Abra ações globais e navegue sem tirar as mãos do teclado." },
  { keys: ["/"], title: "Campo principal", description: "Foque rapidamente o comando principal para enviar uma missão." },
  { keys: ["Ctrl", "Espaço"], title: "Comando por voz", description: "Abra o painel de voz para falar diretamente com o Orquestrador." },
];

export function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap justify-end">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-text-faint text-[10px]">+</span>}
          <kbd className="px-1.5 py-0.5 rounded-md bg-bg-input border border-border-subtle text-text-primary text-[11px] font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutOnboardingHint() {
  return (
    <div className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-3 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center flex-shrink-0 border border-accent/30">
        <Keyboard size={18} />
      </div>
      <div>
        <div className="text-[13px] font-medium text-text-primary">Dica de onboarding</div>
        <div className="text-[12px] text-text-secondary mt-0.5">
          Se você está começando agora, memorize primeiro: <KeyCombo keys={["Ctrl", "K"]} />, <KeyCombo keys={["Ctrl", "Espaço"]} /> e <KeyCombo keys={["g", "o"]} />.
        </div>
      </div>
    </div>
  );
}

export function ShortcutBestPractices() {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-bg-elevated text-accent border border-accent/30 flex items-center justify-center">
          <Mic size={16} />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-text-primary">Boas práticas</div>
          <div className="text-[10.5px] text-text-muted uppercase tracking-[0.12em]">produto mais fluido</div>
        </div>
      </div>
      <ul className="space-y-2 text-[12px] text-text-secondary list-disc pl-5">
        <li>Use <KeyCombo keys={["Ctrl", "K"]} /> para manter o foco na execução sem depender do mouse.</li>
        <li>Use <KeyCombo keys={["g", "a"]} /> e <KeyCombo keys={["g", "p"]} /> para alternar rapidamente entre agentes e projetos.</li>
        <li>Nos modais, o foco fica preso por acessibilidade — use <KeyCombo keys={["Esc"]} /> para sair rapidamente.</li>
      </ul>
    </div>
  );
}
