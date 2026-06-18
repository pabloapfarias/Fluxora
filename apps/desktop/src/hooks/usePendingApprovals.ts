import { useState, useEffect } from "react";

export function usePendingApprovals() {
  const [approvals, setApprovals] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const list = await (window as any).fluxora.approvals.listActionable();
        if (mounted) setApprovals(list);
      } catch (e) {
        console.error("Failed to load pending approvals:", e);
      }
    };
    load();
    const interval = setInterval(load, 3000);
    const unsub = (window as any).fluxora.events?.onApprovalChange?.(() => load());
    return () => {
      mounted = false;
      clearInterval(interval);
      if (unsub) unsub();
    };
  }, []);

  return approvals;
}
