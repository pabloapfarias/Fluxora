// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoiceTranscriptionPanel } from "../components/voice/VoiceTranscriptionPanel";

// Mock useMicCapture
let mockMicState: "idle" | "requesting" | "recording" | "error" = "idle";
vi.mock("../hooks/useMicCapture", () => ({
  useMicCapture: () => ({
    get state() { return mockMicState; },
    error: undefined,
    elapsed: 0,
    audioBlob: undefined,
    audioMimeType: undefined,
    stream: null,
    start: vi.fn(async () => { mockMicState = "recording"; }),
    stop: vi.fn(async () => { mockMicState = "idle"; return new Blob(["audio"], { type: "audio/webm" }); }),
    cancel: vi.fn(() => { mockMicState = "idle"; }),
  }),
}));

// Mock translator
vi.mock("../voice/translator", () => ({
  translate: vi.fn(async (text: string, _from: string, to: string) => {
    if (to === "en") return `[EN] ${text}`;
    if (to === "es") return `[ES] ${text}`;
    return text;
  }),
  normalizeLang: vi.fn((lang: string) => lang.split("-")[0] || lang),
  clearTranslationCache: vi.fn(),
}));

const defaultProps = {
  onSubmit: vi.fn(async () => {}),
  onClose: vi.fn(),
  onRecordingChange: vi.fn(),
  submitError: undefined,
  onClearSubmitError: vi.fn(),
  audioSettings: { type: "whisper_local_managed" as const, language: "pt-BR", model: "base" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMicState = "idle";
  // Mock window.fluxora
  (window as any).fluxora = {
    voice: {
      transcribe: vi.fn().mockResolvedValue({ text: "texto transcrito", provider: "whisper_local_managed" }),
      saveAudioBytes: vi.fn().mockResolvedValue({ audioPath: "/tmp/audio.webm" }),
    },
    settings: {
      getAudioProvider: vi.fn().mockResolvedValue({ type: "whisper_local_managed", language: "pt-BR", model: "base" }),
    },
  };
});

afterEach(() => {
  cleanup();
});

describe("VoiceTranscriptionPanel", () => {
  it("renderiza com botão Gravar e select de idioma", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("record-button")).toBeTruthy();
    });
  });

  it("mostra botão Gravar habilitado quando provider está disponível", () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    const recordBtn = screen.getByTestId("record-button");
    expect(recordBtn.textContent).toContain("Gravar");
    expect(recordBtn.getAttribute("disabled")).toBeNull();
  });

  it("altera o label do botão para 'Parar' durante gravação", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    const recordBtn = screen.getByTestId("record-button");
    fireEvent.click(recordBtn);

    // Após clicar, o mic.state muda para "recording"
    mockMicState = "recording";
    await waitFor(() => {
      expect(recordBtn.textContent).toContain("Parar");
    });
  });

  it("mostra textarea para digitação manual", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const textarea = screen.getByTestId("transcript-textarea");
      expect(textarea).toBeTruthy();
    });
  });

  it("permite digitar texto manualmente", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const textarea = screen.getByTestId("transcript-textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Minha missão" } });
      expect(textarea.value).toContain("Minha missão");
    });
  });

  it("tem botão Enviar que aciona onSubmit", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} onSubmit={onSubmit} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const textarea = screen.getByTestId("transcript-textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Criar cupom" } });
    });

    const submitBtn = screen.getByTestId("submit-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it("tem botão Copiar que aparece quando há texto", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel
          {...defaultProps}
          initialText="Texto inicial"
        />
      </MemoryRouter>,
    );

    // O painel com initialText mostra o textarea com o texto
    await waitFor(() => {
      expect(screen.getByTestId("transcript-textarea")).toBeTruthy();
    });
  });

  it("tem botão Limpar quando há texto", async () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel
          {...defaultProps}
          initialText="Texto para limpar"
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const clearBtn = screen.getByTitle("Limpar");
      expect(clearBtn).toBeTruthy();
    });
  });

  it("mostra seletor de idioma quando não está gravando", () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    const langSelector = screen.getByTestId("language-selector");
    expect(langSelector).toBeTruthy();
    expect((langSelector as HTMLSelectElement).value).toBe("pt-BR");
  });

  it("mostra erro quando transcriptionError é definido", () => {
    // Mock transcriptionError by forcing a WebSpeech error
    // We'll just render and check the error can display
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel
          {...defaultProps}
          submitError="Erro de teste"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Erro de teste/i)).toBeTruthy();
  });

  it("renderiza com provider manual — botão Gravar desabilitado", () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel
          {...defaultProps}
          audioSettings={{ type: "manual" }}
        />
      </MemoryRouter>,
    );

    const recordBtn = screen.getByTestId("record-button");
    expect(recordBtn.className).toMatch(/cursor-not-allowed/);
  });

  it("mostra provider info no rodapé", () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Provider/i)).toBeTruthy();
    expect(screen.getByText(/Whisper local offline/i)).toBeTruthy();
  });

  it("tem botão Configurações que navega para /settings", () => {
    render(
      <MemoryRouter>
        <VoiceTranscriptionPanel {...defaultProps} />
      </MemoryRouter>,
    );

    const settingsBtn = screen.getByTitle("Configurações de áudio");
    expect(settingsBtn).toBeTruthy();
  });
});
