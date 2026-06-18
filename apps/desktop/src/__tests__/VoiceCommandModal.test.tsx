// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Topbar } from "../components/layout/Topbar";
import type { AudioProviderSettings, VoiceContextResult } from "@fluxora/shared";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock useMicCapture para evitar dependência de getUserMedia em jsdom.
let mockMicState: "idle" | "requesting" | "recording" | "error" = "idle";
vi.mock("../hooks/useMicCapture", () => ({
  useMicCapture: () => ({
    get state() {
      return mockMicState;
    },
    error: undefined,
    elapsed: 0,
    stream: null,
    start: vi.fn(async () => {
      mockMicState = "recording";
    }),
    stop: vi.fn(async () => {
      mockMicState = "idle";
      return new Blob(["audio"], { type: "audio/webm" });
    }),
    cancel: vi.fn(() => {
      mockMicState = "idle";
    }),
  }),
}));

vi.mock("../contexts/ActiveProjectContext", () => ({
  useActiveProject: () => ({ activeProjectId: "proj-adv", setActiveProjectId: () => {} }),
}));

const SAMPLE_CONTEXT: VoiceContextResult = {
  intent: "feature_request",
  title: "Criar cupom de primeira compra",
  summary: "Implementar cupom de primeira compra no eBig Food.",
  suggestedProjects: ["eBig Food API"],
  suggestedAgents: ["backend-dev", "qa"],
  risk: "medium",
  requiresApproval: true,
};

function setAudioProviderMock(provider: AudioProviderSettings | null) {
  (window as any).fluxora = {
    projects: {
      list: vi.fn().mockResolvedValue([
        { id: "proj-adv", name: "Escritório Advocacia", path: "/adv", stack: [], status: "idle", createdAt: "", updatedAt: "" },
      ]),
    },
    voice: {
      transcribe: vi.fn().mockResolvedValue({ text: "" }),
      saveAudioBytes: vi.fn().mockResolvedValue({ audioPath: "/tmp/audio.webm" }),
      createFromTranscript: vi.fn().mockResolvedValue(SAMPLE_CONTEXT),
    },
    settings: {
      getAudioProvider: vi.fn().mockResolvedValue(provider),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMicState = "idle";
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Topbar — comando por voz", () => {
  it("abre o modal ao clicar no mic e mostra o painel de transcrição", async () => {
    setAudioProviderMock({ type: "whisper_local_managed", language: "pt-BR", model: "base" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    const micButton = await screen.findByTestId("topbar-mic-button");
    fireEvent.click(micButton);

    // O modal "Comando por Voz" deve aparecer
    await waitFor(() => {
      expect(screen.getByText(/Comando por Voz/i)).toBeTruthy();
    });

    // E o painel mostra o select de idioma e botão Gravar
    await waitFor(() => {
      expect(screen.getByTestId("record-button")).toBeTruthy();
    });
  });

  it("fecha o modal ao clicar no X", async () => {
    setAudioProviderMock({ type: "whisper_local_managed", language: "pt-BR", model: "base" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    const micButton = await screen.findByTestId("topbar-mic-button");
    fireEvent.click(micButton);

    await waitFor(() => {
      expect(screen.getByText(/Comando por Voz/i)).toBeTruthy();
    });

    // O modal é fechado clicando no backdrop (overlay)
    const backdrop = document.querySelector(".fixed.inset-0");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByText(/Comando por Voz/i)).toBeNull();
    });
  });

  it("envia a transcrição e navega para /overview preenchendo o comando principal", async () => {
    setAudioProviderMock({ type: "whisper_local_managed", language: "pt-BR", model: "base" });
    render(
      <MemoryRouter initialEntries={["/shortcuts"]}>
        <Topbar />
      </MemoryRouter>,
    );

    // Abre o modal
    const micButton = await screen.findByTestId("topbar-mic-button");
    fireEvent.click(micButton);

    await waitFor(() => {
      expect(screen.getByText(/Comando por Voz/i)).toBeTruthy();
    });

    // O novo painel mostra o textarea e botão "Enviar"
    const textarea = screen.getByTestId("transcript-textarea");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "Criar cupom" } });

    // Envia
    const submit = screen.getByTestId("submit-button");
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/overview", {
        state: {
          prefillCommand: "Criar cupom",
        },
      });
    });

    expect((window as any).fluxora.voice.createFromTranscript).not.toHaveBeenCalled();

    // O modal fecha (submit aciona onSubmit que chama onClose)
    await waitFor(() => {
      expect(screen.queryByText(/Comando por Voz/i)).toBeNull();
    });
  });

  it("mostra o mic com opacidade reduzida quando o provider é manual", async () => {
    setAudioProviderMock({ type: "manual" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    // Aguarda as settings carregarem
    const micButton = await screen.findByTestId("topbar-mic-button");
    expect(micButton.className).toMatch(/opacity-60/);
    expect(micButton.getAttribute("title")).toMatch(/desabilitado/i);

    // Abre o modal
    fireEvent.click(micButton);
    await waitFor(() => {
      expect(screen.getByText(/Comando por Voz/i)).toBeTruthy();
    });
  });
});
