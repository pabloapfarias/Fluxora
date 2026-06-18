import { useEffect, useCallback } from "react";
import { X } from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// Modal — overlay com painel central, scroll interno, fechar com Escape/click
// ────────────────────────────────────────────────────────────────────────────

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Largura do painel. Default: md */
  width?: "sm" | "md" | "lg";
  /** Classes extras para o painel */
  className?: string;
}

const WIDTH_CLASSES: Record<string, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "md",
  className,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    // Prevenir scroll do body quando modal está aberto
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title || "Modal"}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Painel */}
      <div
        className={`relative w-full ${WIDTH_CLASSES[width]} max-h-[85vh] flex flex-col rounded-xl border border-border-subtle shadow-2xl overflow-hidden ${className || ""}`}
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border-subtle flex-shrink-0">
            <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              className="no-drag w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-input transition-colors"
              aria-label="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Sem título — botão fechar absoluto */}
        {!title && (
          <button
            onClick={onClose}
            className="no-drag absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-input transition-colors z-10"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        )}

        {/* Conteúdo com scroll */}
        <div className="flex-1 overflow-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
