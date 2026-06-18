import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, AlertTriangle, ShieldAlert } from "lucide-react";
import type { Approval } from "@fluxora/shared";
import { validateApprovalContext } from "@fluxora/shared";

export function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");

  useEffect(() => {
    loadApprovals();
    const interval = setInterval(loadApprovals, 3000);
    const unsub = (window as any).fluxora.events?.onApprovalChange?.(() => loadApprovals());
    return () => { 
      clearInterval(interval); 
      if (unsub) unsub(); 
    };
  }, []);

  async function loadApprovals() {
    // listActionable reconciles orphaned workflows first, creating approvals in DB
    await window.fluxora.approvals.listActionable();
    // Now list() will include the reconciled approvals
    setApprovals(await window.fluxora.approvals.list());
  }

  async function handleApprove(id: string) {
    await window.fluxora.approvals.approve(id);
    loadApprovals();
  }

  async function handleReject(id: string) {
    await window.fluxora.approvals.reject(id);
    loadApprovals();
  }

  const filtered = approvals.filter((a) => {
    if (filter === "pending") return a.status === "pending";
    if (filter === "resolved") return a.status !== "pending";
    return true;
  });

  const impactColors: Record<string, string> = {
    low: "bg-success/10 text-success",
    medium: "bg-warning/10 text-warning",
    high: "bg-error/10 text-error",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Aprovações</h1>
        <div className="flex gap-2">
          {(["all", "pending", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                filter === f ? "bg-accent text-white" : "bg-bg-card text-text-secondary hover:text-text-primary"
              }`}
            >
              {f === "all" ? "Todas" : f === "pending" ? "Pendentes" : "Resolvidas"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Clock size={48} className="mx-auto mb-4 opacity-50" />
          <p>Nenhuma aprovação encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((approval) => {
            const ctx = validateApprovalContext(approval);
            const canApprove = ctx.canApprove;
            return (
              <div key={approval.id} className={`bg-bg-card border rounded-xl p-4 ${
                approval.status === "pending" && !canApprove ? "border-error/30" : "border-border"
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{approval.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${impactColors[approval.impact]}`}>
                        {approval.impact}
                      </span>
                      {approval.status === "pending" && !canApprove && (
                        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-error/10 text-error">
                          <ShieldAlert size={12} /> {ctx.invalidReason || "Contexto insuficiente"}
                        </span>
                      )}
                      {approval.status === "pending" && canApprove && ctx.invalidReason && (
                        <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                          <ShieldAlert size={12} /> {ctx.invalidReason}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary">{approval.description}</p>
                    <div className="text-xs text-text-muted mt-2">
                      {new Date(approval.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {approval.status === "pending" && canApprove ? (
                      <>
                        <button
                          onClick={() => handleApprove(approval.id)}
                          className="flex items-center gap-1 bg-success/10 hover:bg-success/20 text-success px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <CheckCircle size={14} /> Aprovar
                        </button>
                        <button
                          onClick={() => handleReject(approval.id)}
                          className="flex items-center gap-1 bg-error/10 hover:bg-error/20 text-error px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <XCircle size={14} /> Rejeitar
                        </button>
                      </>
                    ) : approval.status === "pending" && !canApprove ? (
                      <span className="flex items-center gap-1 text-xs text-error">
                        <ShieldAlert size={14} /> Sem contexto
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1 text-xs ${
                        approval.status === "approved" ? "text-success" : "text-error"
                      }`}>
                        {approval.status === "approved" ? <CheckCircle size={14} /> : <XCircle size={14} />}
                        {approval.status === "approved" ? "Aprovada" : "Rejeitada"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
