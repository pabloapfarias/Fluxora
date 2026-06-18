import { type ReactNode, useState } from "react";

export function HintTooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-full mt-2 right-0 z-[80] w-56 rounded-lg border border-border-subtle bg-bg-card px-3 py-2 text-[11px] text-text-secondary shadow-xl"
        >
          {content}
        </div>
      )}
    </div>
  );
}
