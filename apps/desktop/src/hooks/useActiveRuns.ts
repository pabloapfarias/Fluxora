import { useState, useEffect } from "react";

// HOTFIX UI E2E — Apenas execuções em estado verdadeiramente
// ativo entram no painel lateral. Concluídas (completed),
// falhadas (failed), canceladas (cancelled) e rejeitadas
// (rejected) NÃO são ativas — elas vão para o histórico
// (Execuções Recentes / aba Execuções).
const ACTIVE_STATUSES = ["queued", "running", "approved", "pending_approval"];

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
