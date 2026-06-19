import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { deriveProviderEngineGlobalDefault, type GlobalDefaultAgentModel } from "@fluxora/shared";

const DISMISS_KEY = "fluxora:globalDefaultBanner:dismissedAt";
const DISMISS_HOURS = 12;

export function GlobalDefaultBanner() {
  const [value, setValue] = useState<GlobalDefaultAgentModel | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.fluxora.providers
      .list()
      .then((providers) => {
        if (!mounted) return;
        setValue(deriveProviderEngineGlobalDefault(providers));
      })
      .catch(() => {
        if (!mounted) return;
        setValue({ providerId: null, modelName: null });
      });
    try {
      const last = window.localStorage.getItem(DISMISS_KEY);
      if (last) {
        const elapsed = Date.now() - new Date(last).getTime();
        if (elapsed < DISMISS_HOURS * 60 * 60 * 1000) {
          setDismissed(true);
        }
      }
    } catch {
      // ignore storage errors
    }
    return () => {
      mounted = false;
    };
  }, []);

  if (!value || !value.providerId || !value.modelName) return null;
  if (dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 px-4 py-1.5 bg-accent/10 border-b border-accent/25 text-[11.5px] text-text-secondary"
    >
      <Sparkles size={12} className="text-accent flex-shrink-0" />
      <span>
        <span className="text-text-primary font-medium">Fallback real do Mission Engine ativo.</span>
        {" "}Missões e agentes sem sobrescrita usarão <span className="font-mono text-text-primary">{value.modelName}</span>.
      </span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(DISMISS_KEY, new Date().toISOString());
          } catch {
            // ignore
          }
        }}
        className="no-drag ml-auto p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-deep/50"
        aria-label="Dispensar aviso"
      >
        <X size={12} />
      </button>
    </div>
  );
}
