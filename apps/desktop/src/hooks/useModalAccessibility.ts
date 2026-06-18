import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Foco inicial: foca o primeiro elemento focável dentro do container,
 * ou o próprio container se não houver.
 * Restaura o foco ao elemento anterior ao montar/desmontar.
 * Bloqueia Tab/Shift+Tab em loop dentro do container (focus trap).
 * Fecha no ESC.
 */
export function useModalAccessibility(
  containerRef: RefObject<HTMLElement | null>,
  options: {
    onClose: () => void;
    closeOnEscape?: boolean;
  }
) {
  const { onClose, closeOnEscape = true } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    );
    const initialTarget = focusables[0] ?? container;
    // Para o container ser focável
    if (!container.hasAttribute("tabindex")) {
      container.setAttribute("tabindex", "-1");
    }
    initialTarget.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !container!.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container!.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, onClose, closeOnEscape]);
}
