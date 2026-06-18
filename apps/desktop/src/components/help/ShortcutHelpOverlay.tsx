import { useRef } from "react";
import { ArrowRight, Keyboard, X } from "lucide-react";
import { ShortcutBestPractices, ShortcutOnboardingHint, shortcutSections, KeyCombo } from "./shortcutCatalog";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

export function ShortcutHelpOverlay({
  onClose,
  onOpenFullPage,
}: {
  onClose: () => void;
  onOpenFullPage: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Fechar ajuda de atalhos" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        className="relative z-10 w-full max-w-5xl max-h-[88vh] overflow-auto rounded-2xl border border-border bg-bg-card shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-5 border-b border-border-subtle bg-bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent border border-accent/30 flex items-center justify-center">
              <Keyboard size={18} />
            </div>
            <div>
              <h2 id="shortcut-help-title" className="text-lg font-semibold text-text-primary">Ajuda rápida de atalhos</h2>
              <div className="text-[12px] text-text-muted mt-0.5">
                Use esta visão rápida sem sair da tela atual. Pressione <KeyCombo keys={["Esc"]} /> para fechar.
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center" aria-label="Fechar ajuda rápida de atalhos">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <ShortcutOnboardingHint />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {shortcutSections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.title} className="rounded-xl border border-border bg-bg-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-bg-elevated text-accent border border-accent/30 flex items-center justify-center">
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="text-[14px] font-semibold text-text-primary">{section.title}</div>
                      <div className="text-[10.5px] text-text-muted uppercase tracking-[0.12em]">referência rápida</div>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {section.items.slice(0, 4).map((item) => (
                      <div key={`${section.title}-${item.action}`} className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle bg-bg-deep/30 px-3 py-2.5">
                        <div className="text-[12px] text-text-secondary">{item.action}</div>
                        <KeyCombo keys={item.keys} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <ShortcutBestPractices />
        </div>

        <div className="sticky bottom-0 z-10 px-6 py-4 border-t border-border-subtle bg-bg-card flex justify-end gap-2">
          <button type="button" onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25">
            Fechar
          </button>
          <button type="button" onClick={onOpenFullPage} className="no-drag flex items-center gap-1 bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-white">
            Abrir página completa <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
