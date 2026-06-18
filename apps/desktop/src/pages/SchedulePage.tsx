import { CalendarClock, CalendarDays, ListTodo } from "lucide-react";

export function SchedulePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-text-primary leading-tight">Cronograma</h1>
        <p className="text-[12.5px] text-text-muted mt-0.5">
          Tarefas agendadas, rotinas e lembretes do Fluxora
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          icon={<CalendarClock size={16} />}
          title="Execuções agendadas"
          value="0"
          hint="Nenhuma rotina configurada"
        />
        <KpiCard
          icon={<CalendarDays size={16} />}
          title="Hoje"
          value="—"
          hint="Sem atividades previstas"
        />
        <KpiCard
          icon={<ListTodo size={16} />}
          title="Pendentes"
          value="0"
          hint="Tudo em dia"
        />
      </div>

      <div className="rounded-xl border border-dashed border-border bg-bg-card p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center mx-auto mb-3 border border-accent/30">
          <CalendarClock size={22} />
        </div>
        <div className="text-[14px] font-medium text-text-primary">Em breve</div>
        <div className="text-[12.5px] text-text-muted mt-1 max-w-md mx-auto">
          O agendador de execuções está planejado para a PR 002. Por enquanto, todas as execuções são iniciadas manualmente.
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, title, value, hint }: { icon: React.ReactNode; title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="flex items-center gap-2 text-text-muted text-[11px] uppercase tracking-wider">
        {icon}
        {title}
      </div>
      <div className="text-[24px] font-semibold text-text-primary mt-2">{value}</div>
      <div className="text-[11.5px] text-text-muted mt-1">{hint}</div>
    </div>
  );
}
