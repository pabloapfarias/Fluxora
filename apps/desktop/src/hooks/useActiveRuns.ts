import { useState, useEffect } from "react";

const ACTIVE_STATUSES = ["running", "approved", "pending_approval"];

export function useActiveRuns(limit?: number) {
  const [runs, setRuns] = useState<any[]>([]);
  
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const all = await (window as any).fluxora.workflows.list();
        const active = all.filter((r: any) => ACTIVE_STATUSES.includes(r.status));
        if (mounted) setRuns(limit ? active.slice(0, limit) : active);
      } catch (e) {
        console.error("Failed to load active runs:", e);
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
  }, [limit]);
  
  return runs;
}
