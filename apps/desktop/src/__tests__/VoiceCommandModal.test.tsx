// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Topbar } from "../components/layout/Topbar";
import type { AudioProviderSettings } from "@fluxora/shared";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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

const baseFluxoraMock = {
  projects: {
    list: vi.fn().mockResolvedValue([
      { id: "proj-adv", name: "Escritorio Advocacia", path: "/adv", stack: [], status: "idle", createdAt: "", updatedAt: "" },
    ]),
  },
  voice: {
    transcribe: vi.fn().mockResolvedValue({ text: "" }),
    saveAudioBytes: vi.fn().mockResolvedValue({ audioPath: "/tmp/audio.webm" }),
    createFromTranscript: vi.fn(),
  },
};

function setAudioProviderMock(provider: AudioProviderSettings | null) {
  (window as any).fluxora = {
    ...baseFluxoraMock,
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
  it("renderiza o comando por voz inline no topo", async () => {
    setAudioProviderMock({ type: "whisper_local_managed", language: "pt-BR", model: "base" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    const micButton = await screen.findByTestId("topbar-mic-button");
    const commandInput = await screen.findByTestId("topbar-command-input");

    expect(micButton).toBeTruthy();
    expect(commandInput).toBeTruthy();
    expect(screen.getByPlaceholderText(/Fale com o Orquestrador/i)).toBeTruthy();
  });

  it("envia o comando digitado e navega para /overview", async () => {
    setAudioProviderMock({ type: "whisper_local_managed", language: "pt-BR", model: "base" });
    render(
      <MemoryRouter initialEntries={["/shortcuts"]}>
        <Topbar />
      </MemoryRouter>,
    );

    const commandInput = await screen.findByTestId("topbar-command-input");
    fireEvent.change(commandInput, { target: { value: "Criar cupom" } });
    fireEvent.keyDown(commandInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/overview", {
        state: {
          prefillCommand: "Criar cupom",
        },
      });
    });
  });

  it("mantem o botao de microfone com opacidade reduzida quando o provider e manual", async () => {
    setAudioProviderMock({ type: "manual" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    const micButton = await screen.findByTestId("topbar-mic-button");
    expect(micButton.className).toMatch(/opacity-60/);
  });

  it("mostra erro ao tentar gravar sem provider de voz configurado", async () => {
    setAudioProviderMock({ type: "manual" });
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    );

    const micButton = await screen.findByTestId("topbar-mic-button");
    fireEvent.click(micButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Selecione Whisper local offline ou nuvem nas Configurações/i)).toBeTruthy();
    });
  });
});
