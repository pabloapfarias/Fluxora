import { describe, it, expect, vi } from "vitest";
import {
  WebSpeechProvider,
  WebSpeechProviderError,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionErrorLike,
} from "../providers/web-speech-provider";

/**
 * Cria um mock de `SpeechRecognition` controlado por sinal.
 * Permite disparar `result`, `error`, `end` e `start` programaticamente.
 */
function makeMockRecognition(): {
  rec: SpeechRecognitionLike;
  emit: {
    result: (transcript: string, isFinal: boolean) => void;
    error: (code: string, message?: string) => void;
    end: () => void;
  };
  state: { started: boolean; stopped: boolean; aborted: boolean };
} {
  const state = { started: false, stopped: false, aborted: false };
  const rec: SpeechRecognitionLike = {
    lang: "",
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    start() {
      state.started = true;
      rec.onstart?.();
    },
    stop() {
      state.stopped = true;
      rec.onend?.();
    },
    abort() {
      state.aborted = true;
      rec.onend?.();
    },
  };
  return {
    rec,
    state,
    emit: {
      result(transcript: string, isFinal: boolean) {
        const event: SpeechRecognitionEventLike = {
          resultIndex: 0,
          results: {
            0: { 0: { transcript, confidence: 0.9 }, isFinal, length: 1 },
            length: 1,
          } as unknown as ArrayLike<SpeechRecognitionResultLike>,
        };
        rec.onresult?.(event);
      },
      error(code: string, message?: string) {
        const err: SpeechRecognitionErrorLike = { error: code, message };
        rec.onerror?.(err);
      },
      end() {
        rec.onend?.();
      },
    },
  };
}

function flushMicrotasks(): Promise<void> {
  // Permite que setTimeout(0) e filas de Promise drenem.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WebSpeechProvider — basics", () => {
  it("expõe o nome correto do provider", () => {
    const provider = new WebSpeechProvider({
      factory: () => null,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });
    expect(provider.name).toBe("web_speech");
  });

  it("isSupported() reflete o resultado do factory", () => {
    const no = new WebSpeechProvider({ factory: () => null });
    expect(no.isSupported()).toBe(false);

    const mock = makeMockRecognition();
    const yes = new WebSpeechProvider({ factory: () => mock.rec });
    expect(yes.isSupported()).toBe(true);
  });
});

describe("WebSpeechProvider — happy path", () => {
  it("resolve com o texto final acumulado após onend", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      language: "pt-BR",
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });

    mock.emit.result("Quero criar", true);
    mock.emit.result("um cupom de primeira compra", true);
    mock.emit.end();

    const result = await promise;
    expect(result.text).toBe("Quero criar um cupom de primeira compra");
    expect(result.language).toBe("pt-BR");
    expect(result.provider).toBe("web_speech");
    expect(mock.state.started).toBe(true);
  });

  it("concatena resultados parciais com espaço entre eles", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    mock.emit.result("Olá", true);
    mock.emit.result("mundo", true);
    mock.emit.end();

    const result = await promise;
    expect(result.text).toBe("Olá mundo");
  });

  it("ignora resultados com isFinal=false", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    mock.emit.result("apenas parcial", false);
    mock.emit.result("final real", true);
    mock.emit.end();

    const result = await promise;
    expect(result.text).toBe("final real");
  });

  it("respeita o idioma do input sobre o default", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      language: "pt-BR",
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({
      audio: new Uint8Array(),
      mimeType: "audio/webm",
      language: "en-US",
    });
    expect(mock.rec.lang).toBe("en-US");
    mock.emit.result("hello", true);
    mock.emit.end();
    const result = await promise;
    expect(result.language).toBe("en-US");
  });
});

describe("WebSpeechProvider — error paths", () => {
  it("rejeita com stt_unavailable quando o factory devolve null", async () => {
    const provider = new WebSpeechProvider({
      factory: () => null,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });
    await expect(
      provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" })
    ).rejects.toMatchObject({ code: "stt_unavailable" });
  });

  it("rejeita com empty_transcript quando onend vem sem texto", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    mock.emit.end();
    await expect(promise).rejects.toBeInstanceOf(WebSpeechProviderError);
    await expect(promise).rejects.toMatchObject({ code: "empty_transcript" });
  });

  it("rejeita com código de erro do reconhecimento (not-allowed)", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    mock.emit.error("not-allowed");
    await expect(promise).rejects.toMatchObject({ code: "stt_not-allowed" });
  });

  it("rejeita com start_failed se start() lançar", async () => {
    const throwingRec: SpeechRecognitionLike = {
      ...makeMockRecognition().rec,
      start() {
        throw new Error("blocked");
      },
    };
    const provider = new WebSpeechProvider({
      factory: () => throwingRec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });
    await expect(
      provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" })
    ).rejects.toMatchObject({ code: "start_failed" });
  });
});

describe("WebSpeechProvider — timeout", () => {
  it("rejeita com timeout se o provider não produzir texto antes do tempo", async () => {
    const mock = makeMockRecognition();
    type TimeoutHandler = () => void;
    const schedulers: TimeoutHandler[] = [];
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      timeoutMs: 50,
      setTimeoutFn: (handler: () => void, _ms: number) => {
        schedulers.push(handler);
        return 0;
      },
      clearTimeoutFn: () => undefined,
    });

    // Anexa handler de rejeição IMEDIATAMENTE para evitar unhandled rejection
    // quando o timeout dispara síncronamente.
    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    const catchPromise = promise.catch((err: unknown) => err);
    // Dispara o timeout programaticamente
    expect(schedulers.length).toBeGreaterThan(0);
    const fire = schedulers[0]!;
    fire();
    await flushMicrotasks();
    const err = await catchPromise;
    expect(err).toBeInstanceOf(WebSpeechProviderError);
    expect((err as WebSpeechProviderError).code).toBe("timeout");
  });
});

describe("WebSpeechProvider — session guard", () => {
  it("rejeita com session_busy se uma sessão já está ativa", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    const first = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    // Antes do onend, tentar iniciar outra sessão deve falhar
    await expect(
      provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" })
    ).rejects.toMatchObject({ code: "session_busy" });

    // Encerrar a primeira
    mock.emit.end();
    await expect(first).rejects.toMatchObject({ code: "empty_transcript" });
  });
});

describe("WebSpeechProvider — cancel", () => {
  it("chama abort() na sessão ativa e reseta o estado", async () => {
    const mock = makeMockRecognition();
    const provider = new WebSpeechProvider({
      factory: () => mock.rec,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    });

    // Inicia uma sessão que será abortada — capturamos a rejeição esperada.
    const promise = provider.transcribe({ audio: new Uint8Array(), mimeType: "audio/webm" });
    promise.catch(() => {
      /* esperado: abort → onend → empty_transcript */
    });
    provider.cancel();
    expect(mock.state.aborted).toBe(true);
    // Aguarda microtasks drenarem a fila do abort
    await flushMicrotasks();
  });
});
