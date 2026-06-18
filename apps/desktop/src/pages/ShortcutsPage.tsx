import { shortcutSections, KeyCombo, ShortcutBestPractices, ShortcutOnboardingHint } from "../components/help/shortcutCatalog";

export function ShortcutsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Atalhos</h1>
        <p className="text-[12.5px] text-text-muted mt-1 max-w-3xl">
          Referência rápida dos atalhos de teclado do Fluxora. Esta página existe para que qualquer pessoa descubra o produto sem depender de tentativa e erro.
        </p>
      </div>

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
                  <div className="text-[10.5px] text-text-muted uppercase tracking-[0.12em]">atalhos disponíveis</div>
                </div>
              </div>

              <div className="space-y-2.5">
                {section.items.map((item) => (
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
  );
}
