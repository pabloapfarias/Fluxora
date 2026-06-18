/**
 * Smoke tests para o UI kit. Garantem que o módulo é importável,
 * os componentes renderizam sem erros e os tipos discriminados
 * estão expostos.
 *
 * Usamos matchers nativos do Vitest (sem `@testing-library/jest-dom`)
 * para manter o conjunto de dependências alinhado ao restante do projeto.
 */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ActionButton,
  ImpactBadge,
  MetricPill,
  MissionCard,
  ModeBadge,
  SectionHeader,
  StatusBadge,
} from "..";
import type {
  ActionButtonSize,
  ActionButtonVariant,
  BadgeSize,
  CardPadding,
  CardVariant,
  ImpactBadgeImpact,
  ModeBadgeMode,
  StatusBadgeStatus,
  TrendDirection,
} from "..";

function getRoot(container: HTMLElement): HTMLElement {
  const root = container.firstChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("Expected first child to be an HTMLElement");
  }
  return root;
}

describe("UI kit — public API", () => {
  it("exports every required component", () => {
    // Funções ou objetos (forwardRef retorna um objeto com `render`).
    const isComponent = (v: unknown) =>
      typeof v === "function" || (typeof v === "object" && v !== null);
    expect(isComponent(StatusBadge)).toBe(true);
    expect(isComponent(ModeBadge)).toBe(true);
    expect(isComponent(ImpactBadge)).toBe(true);
    expect(isComponent(ActionButton)).toBe(true);
    expect(isComponent(SectionHeader)).toBe(true);
    expect(isComponent(MissionCard)).toBe(true);
    expect(isComponent(MetricPill)).toBe(true);
  });
});

describe("StatusBadge", () => {
  const statuses: StatusBadgeStatus[] = [
    "pending",
    "running",
    "completed",
    "failed",
    "rejected",
    "waiting_approval",
  ];

  it.each(statuses)("renders without crashing for status=%s", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
  });

  it("respects size variants", () => {
    const { rerender, container } = render(<StatusBadge status="running" size="sm" />);
    expect(getRoot(container).className).toContain("text-[10.5px]");
    rerender(<StatusBadge status="running" size="md" />);
    expect(getRoot(container).className).toContain("text-[11px]");
  });

  it("hides icon when hideIcon is true", () => {
    const { container } = render(<StatusBadge status="completed" hideIcon />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("uses override label when provided", () => {
    const { container } = render(<StatusBadge status="completed" label="Finalizado" />);
    expect(container.textContent).toContain("Finalizado");
  });
});

describe("ModeBadge", () => {
  const modes: ModeBadgeMode[] = ["real", "simulated", "multiagent", "controlled"];

  it.each(modes)("renders without crashing for mode=%s", (mode) => {
    const { container } = render(<ModeBadge mode={mode} />);
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
  });

  it("uses the violet tone for multiagent", () => {
    const { container } = render(<ModeBadge mode="multiagent" />);
    const root = getRoot(container);
    expect(root.className).toMatch(/violet/);
  });
});

describe("ImpactBadge", () => {
  const impacts: ImpactBadgeImpact[] = ["low", "medium", "high", "critical"];

  it.each(impacts)("renders without crashing for impact=%s", (impact) => {
    const { container } = render(<ImpactBadge impact={impact} />);
    expect(container.firstChild).toBeInstanceOf(HTMLElement);
  });

  it("supports verbose label", () => {
    const { container } = render(<ImpactBadge impact="high" verbose />);
    expect(container.textContent).toContain("Alto impacto");
  });
});

describe("ActionButton", () => {
  it("renders children", () => {
    const { container } = render(<ActionButton icon={<span data-testid="icon" />}>Salvar</ActionButton>);
    expect(container.textContent).toContain("Salvar");
    expect(container.querySelector("[data-testid=icon]")).not.toBeNull();
  });

  it("disables and exposes aria-busy while loading", () => {
    const { container } = render(<ActionButton loading>Salvando</ActionButton>);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(button!.getAttribute("aria-busy")).toBe("true");
    expect(button!.querySelector("svg")).not.toBeNull();
  });

  it("respects variant + size combinations", () => {
    const variants: ActionButtonVariant[] = [
      "primary",
      "secondary",
      "ghost",
      "success",
      "danger",
    ];
    const sizes: ActionButtonSize[] = ["sm", "md", "lg"];
    for (const variant of variants) {
      for (const size of sizes) {
        const { container } = render(
          <ActionButton variant={variant} size={size}>Ok</ActionButton>,
        );
        expect(container.querySelector("button")).toBeInstanceOf(HTMLButtonElement);
      }
    }
  });

  it("forwards extra HTML attributes", () => {
    const { container } = render(
      <ActionButton type="submit" data-testid="submit" aria-label="enviar">
        Enviar
      </ActionButton>,
    );
    const button = container.querySelector("button")!;
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("aria-label")).toBe("enviar");
  });
});

describe("SectionHeader", () => {
  it("renders title and subtitle", () => {
    const { container } = render(
      <SectionHeader title="Missão" subtitle="Status em tempo real" />,
    );
    expect(container.textContent).toContain("Missão");
    expect(container.textContent).toContain("Status em tempo real");
  });

  it("renders optional action element", () => {
    const { container } = render(
      <SectionHeader
        title="Cabeçalho"
        action={<button type="button">Atualizar</button>}
      />,
    );
    expect(container.textContent).toContain("Atualizar");
    expect(container.querySelector("button")).not.toBeNull();
  });
});

describe("MissionCard", () => {
  const variants: CardVariant[] = ["default", "elevated", "interactive"];
  const paddings: CardPadding[] = ["sm", "md", "lg"];

  it.each(variants)("supports variant=%s", (variant) => {
    const { container } = render(
      <MissionCard variant={variant}>
        <span>conteúdo</span>
      </MissionCard>,
    );
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });

  it.each(paddings)("supports padding=%s", (padding) => {
    const { container } = render(
      <MissionCard padding={padding}>x</MissionCard>,
    );
    const root = getRoot(container);
    expect(root.className).toMatch(/p-[356]/);
  });

  it("forwards extra className", () => {
    const { container } = render(
      <MissionCard className="my-extra">conteúdo</MissionCard>,
    );
    expect(getRoot(container).className).toContain("my-extra");
  });
});

describe("MetricPill", () => {
  it("renders label and value", () => {
    const { container } = render(<MetricPill label="Projetos" value={12} />);
    expect(container.textContent).toContain("Projetos");
    expect(container.textContent).toContain("12");
  });

  it("renders trend icon when trend is provided", () => {
    const trends: TrendDirection[] = ["up", "down", "neutral"];
    for (const trend of trends) {
      const { container, unmount } = render(
        <MetricPill label="X" value={1} trend={trend} />,
      );
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("omits trend icon when trend is not provided", () => {
    const { container } = render(<MetricPill label="X" value={1} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("Type exports sanity check", () => {
  it("exports the badge size union", () => {
    const sizes: BadgeSize[] = ["sm", "md"];
    expect(sizes).toHaveLength(2);
  });
});
