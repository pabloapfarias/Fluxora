import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Info, ShieldCheck, ShieldAlert } from "lucide-react";
import type { Approval } from "@fluxora/shared";
import { validateApprovalContext } from "@fluxora/shared";
import {
  ActionButton,
  ImpactBadge,
  MissionCard,
  type ImpactBadgeImpact,
} from "../ui";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PendingApprovalsPanelProps {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onViewAll: () => void;
}

function mapImpact(impact: string): ImpactBadgeImpact {
  switch (impact) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "critical":
      return "critical";
    default:
      return "medium";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PendingApprovalsPanel({ approvals, onApprove, onReject, onViewAll }: PendingApprovalsPanelProps) {
  const navigate = useNavigate();
  const visible = approvals.slice(0, 2);
  const hasAnyPending = approvals.length > 0;

  return (
    <MissionCard className="overflow-hidden" padding="sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-text-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Aprovações pendentes: {approvals.length}
          </span>
          <span
            aria-label={`Total de aprovações pendentes: ${approvals.length}`}
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
              hasAnyPending
                ? "bg-warning-soft text-warning border-warning/25"
                : "bg-success-soft text-success border-success/25"
            }`}
          >
            {approvals.length}
          </span>
        </div>
      </div>

      {/* Empty state */}
      {visible.length === 0 && approvals.length === 0 ? (
        <div className="px-3.5 py-6 text-center">
          <div className="w-9 h-9 mx-auto rounded-full bg-success-soft text-success flex items-center justify-center mb-2">
            <CheckCircle2 size={16} />
          </div>
          <div className="text-[12px] text-text-secondary">Tudo em dia</div>
          <div className="text-[11px] text-text-muted">Nenhuma aprovação pendente</div>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {visible.map((a) => {
            const ctx = validateApprovalContext(a);
            const canApprove = ctx.canApprove;
            return (
              <div key={a.id} className="px-3.5 py-3 space-y-2.5 hover:bg-bg-elevated/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-text-primary truncate">
                      {a.title}
                    </div>
                    {!canApprove && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-error">
                        <ShieldAlert size={10} /> {ctx.invalidReason || "Contexto insuficiente"}
                      </div>
                    )}
                    {canApprove && ctx.invalidReason && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-warning">
                        <ShieldAlert size={10} /> {ctx.invalidReason}
                      </div>
                    )}
                  </div>
                  <ImpactBadge impact={mapImpact(a.impact)} size="sm" verbose />
                </div>

                <div className="flex items-center gap-1.5">
                  {canApprove ? (
                    <>
                      <ActionButton
                        variant="success"
                        size="sm"
                        icon={<CheckCircle2 size={12} />}
                        onClick={() => onApprove(a.id)}
                        aria-label={`Aprovar: ${a.title}`}
                        className="flex-1"
                      >
                        Aprovar
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        size="sm"
                        icon={<XCircle size={12} />}
                        onClick={() => onReject(a.id)}
                        aria-label={`Rejeitar: ${a.title}`}
                        className="flex-1"
                      >
                        Rejeitar
                      </ActionButton>
                    </>
                  ) : (
                    <div className="flex-1 text-[10.5px] text-error text-center py-1">
                      Aprovação inválida
                    </div>
                  )}
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    icon={<Info size={12} />}
                    onClick={() => navigate("/approvals")}
                    aria-label="Ver detalhes da aprovação"
                    title="Detalhes"
                  />
                </div>
              </div>
            );
          })}
          {approvals.length > visible.length && (
            <div className="px-3.5 py-2 text-[10.5px] text-text-muted">
              +{approvals.length - visible.length} pendente(s) adicional(is)
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {approvals.length > 0 && (
        <div className="px-3.5 py-2 border-t border-border-subtle">
          <button
            onClick={onViewAll}
            className="no-drag w-full text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Ver todas aprovações →
          </button>
        </div>
      )}
    </MissionCard>
  );
}
