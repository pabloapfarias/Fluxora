import { useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { KeyCombo, onboardingShortcuts } from "./shortcutCatalog";
import { useModalAccessibility } from "../../hooks/useModalAccessibility";

export const FIRST_RUN_ONBOARDING_KEY = "fluxora:firstRunOnboarding:v1";

export function FirstRunOnboarding({
  onClose,
  onOpenShortcuts,
}: {
  onClose: () => void;
  onOpenShortcuts: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, { onClose });

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-6" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} aria-label="Fechar onboarding" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-onboarding-title"
        className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-bg-card shadow-2xl"
      >
        <div className="px-6 py-5 border-b border-border-subtle flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent border border-accent/30 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 id="first-run-onboarding-title" className="text-lg font-semibold text-text-primary">3 atalhos para começar mais rápido</h2>
              <div className="text-[12px] text-text-muted mt-0.5">
                Para tirar valor do Fluxora desde o primeiro minuto.
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="no-drag w-9 h-9 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent/30 flex items-center justify-center" aria-label="Fechar onboarding de atalhos">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-3">
          {onboardingShortcuts.map((item) => (
            <div key={item.title} className="rounded-xl border border-border-subtle bg-bg-deep/30 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium text-text-primary">{item.title}</div>
                <div className="text-[12px] text-text-secondary mt-0.5">{item.description}</div>
              </div>
              <KeyCombo keys={item.keys} />
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-2">
          <button type="button" onClick={onClose} className="no-drag px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent/25">
            Entendi
          </button>
          <button type="button" onClick={onOpenShortcuts} className="no-drag bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-white">
            Ver todos os atalhos
          </button>
        </div>
      </div>
    </div>
  );
}
