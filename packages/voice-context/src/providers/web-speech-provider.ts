import type { SpeechToTextProvider, TranscriptionInput, TranscriptionResult } from "../stt";

/**
 * Shape mínima do `webkitSpeechRecognition` / `SpeechRecognition` no Chromium.
 * Não re-exporta `webkitSpeechRecognition` para evitar acoplamento com DOM.
 */
export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionFactory = () => SpeechRecognitionLike | null;

export interface WebSpeechProviderConfig {
  /** Idioma padrão (ex.: "pt-BR"). Pode ser sobrescrito pelo `input.language`. */
  language?: string;
  /** Timeout em ms. Default: 30s. */
  timeoutMs?: number;
  /**
   * Callback chamado a cada resultado intermediário (interim).
   * Recebe o texto parcial que o usuário está falando.
   * Útil para mostrar transcrição em tempo real com cursor piscando.
   */
  onInterim?: (text: string) => void;
  /**
   * Injetável para testes. Default: factory que tenta `webkitSpeechRecognition`
   * e depois `SpeechRecognition` no escopo global.
   */
  factory?: SpeechRecognitionFactory;
  /**
   * Injetável para testes. Default: `setTimeout`/`clearTimeout` globais.
   */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class WebSpeechProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "WebSpeechProviderError";
  }
}

/**
 * Provider de STT baseado na Web Speech API do Chromium.
 *
 * Diferente dos providers baseados em bytes (Whisper HTTP), este provider
 * controla sua própria sessão de reconhecimento: o `audio` enviado no input
 * é ignorado — o reconhecimento vem do microfone do próprio navegador.
 *
 * @important Projetado para rodar no **renderer** do Electron, pois depende
 * de APIs do DOM. No main process, sempre caia em `ManualTranscriptProvider`.
 *
 * O método `transcribe` é "fire-and-resolve":
 *  - Inicia a sessão de reconhecimento (se ainda não estiver ativa).
 *  - Aguarda `onend` (parada explícita) ou `timeoutMs`.
 *  - Resolve com o último resultado `isFinal=true` ou com `empty_transcript`.
 */
export class WebSpeechProvider implements SpeechToTextProvider {
  readonly name = "web_speech";
  private config: WebSpeechProviderConfig;
  private factory: SpeechRecognitionFactory;
  private setTimeoutFn: (handler: () => void, ms: number) => unknown;
  private clearTimeoutFn: (handle: unknown) => void;
  private timeoutMs: number;

  /** Sessão atual (apenas uma por vez). */
  private recognition: SpeechRecognitionLike | null = null;
  /** Texto acumulado dos resultados finais. */
  private finalText: string = "";
  /** Indica se a sessão foi iniciada (startSession() chamado). */
  private started: boolean = false;
  /** Marcado quando o timeout dispara e força stop() — para distinguir no onend. */
  private timedOut: boolean = false;
  /** Promise pendente da sessão ativa. */
  private currentSessionPromise: Promise<TranscriptionResult> | null = null;
  /** Idioma da sessão ativa (para o resultado final). */
  private currentSessionLanguage: string = "pt-BR";
  /** Resolver da sessão ativa (injetado em startSession). */
  private currentSessionResolve: ((value: TranscriptionResult) => void) | null = null;
  /** Rejecter da sessão ativa. */
  private currentSessionReject: ((reason: unknown) => void) | null = null;

  constructor(config: WebSpeechProviderConfig = {}) {
    this.config = { ...config };
    this.factory =
      config.factory ||
      (() => {
        if (typeof globalThis === "undefined") return null;
        const w = globalThis as any;
        if (typeof w.webkitSpeechRecognition === "function") {
          return new w.webkitSpeechRecognition();
        }
        if (typeof w.SpeechRecognition === "function") {
          return new w.SpeechRecognition();
        }
        return null;
      });
    this.setTimeoutFn = config.setTimeoutFn || ((h, ms) => setTimeout(h, ms));
    this.clearTimeoutFn = config.clearTimeoutFn || ((h) => clearTimeout(h as any));
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /**
   * Indica se o ambiente (renderer) tem a API disponível.
   */
  isSupported(): boolean {
    return this.factory() !== null;
  }

  /**
   * Cancela a sessão atual, se ativa. Útil para o botão "Cancelar gravação".
   */
  cancel(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }
    this.reset();
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    // Mantido por compatibilidade com a interface SpeechToTextProvider.
    // Inicia a sessão e para imediatamente, retornando o texto acumulado.
    // Importante: chama `stopSession()` em um microtask para garantir que
    // o `currentSessionPromise` foi atribuído antes do `onend` disparar.
    const promise = this.startSession(input);
    await Promise.resolve();
    this.stopSession();
    return promise;
  }

  private reset(): void {
    this.recognition = null;
    this.finalText = "";
    this.started = false;
    this.timedOut = false;
    this.currentSessionPromise = null;
    this.currentSessionResolve = null;
    this.currentSessionReject = null;
  }

  /**
   * Inicia uma sessão de reconhecimento de fala. A promise retornada
   * resolve quando `stopSession()` for chamado (ou em caso de erro/timeout).
   *
   * @param input - contém o `language` (opcional, sobrescreve o default)
   *                e o `mimeType` (informativo, ignorado — a captura
   *                de áudio é responsabilidade do `webkitSpeechRecognition`)
   */
  startSession(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (this.recognition && this.started) {
      return Promise.reject(
        new WebSpeechProviderError(
          "session_busy",
          "Já existe uma sessão de reconhecimento ativa. Pare a sessão antes de iniciar outra."
        )
      );
    }

    const recognition = this.factory();
    if (!recognition) {
      return Promise.reject(
        new WebSpeechProviderError(
          "stt_unavailable",
          "A Web Speech API não está disponível neste ambiente. " +
            "Use o provider Whisper HTTP ou digite a missão manualmente."
        )
      );
    }

    this.recognition = recognition;
    this.finalText = "";
    this.started = true;
    this.timedOut = false;

    const language = input.language || this.config.language || "pt-BR";
    this.currentSessionLanguage = language;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const timeoutHandle = this.setTimeoutFn(() => {
      this.timedOut = true;
      try {
        recognition.stop();
      } catch {
        // ignore — onend ainda será disparado
      }
    }, this.timeoutMs);

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && result[0]) {
          const chunk = result[0].transcript || "";
          if (chunk) {
            this.finalText = this.finalText
              ? `${this.finalText} ${chunk}`.trim()
              : chunk;
          }
        } else if (result[0]) {
          // Resultado intermediário (ainda sendo falado)
          const chunk = result[0].transcript || "";
          if (chunk) {
            interimText = interimText
              ? `${interimText} ${chunk}`.trim()
              : chunk;
          }
        }
      }
      // Notifica o callback de interim com o texto parcial
      if (interimText && this.config.onInterim) {
        this.config.onInterim(interimText);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorLike) => {
      this.clearTimeoutFn(timeoutHandle);
      const code = event.error || "unknown";
      const message = event.message || mapErrorToMessage(code);
      const err = new WebSpeechProviderError(`stt_${code}`, message);
      this.currentSessionReject?.(err);
      this.reset();
    };

    recognition.onend = () => {
      this.clearTimeoutFn(timeoutHandle);
      const text = this.finalText.trim();
      const wasTimeout = this.timedOut;
      const lang = this.currentSessionLanguage;
      if (wasTimeout && !text) {
        this.currentSessionReject?.(
          new WebSpeechProviderError(
            "timeout",
            `Web Speech timeout após ${this.timeoutMs}ms sem transcrição final.`
          )
        );
      } else if (!text) {
        this.currentSessionReject?.(
          new WebSpeechProviderError(
            "empty_transcript",
            "Nenhuma transcrição foi produzida. Fale mais alto ou verifique o microfone."
          )
        );
      } else {
        this.currentSessionResolve?.({
          text,
          language: lang,
          provider: this.name,
        });
      }
      this.reset();
    };

    this.currentSessionPromise = new Promise<TranscriptionResult>(
      (resolve, reject) => {
        this.currentSessionResolve = resolve;
        this.currentSessionReject = reject;
      }
    );

    try {
      recognition.start();
    } catch (err) {
      this.clearTimeoutFn(timeoutHandle);
      this.reset();
      return Promise.reject(
        new WebSpeechProviderError(
          "start_failed",
          `Falha ao iniciar reconhecimento: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      );
    }

    return this.currentSessionPromise;
  }

  /**
   * Para a sessão de reconhecimento atual, disparando `onend` no objeto
   * subjacente. A promise retornada por `startSession()` resolve com o
   * texto final acumulado.
   */
  stopSession(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
  }
}

function mapErrorToMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permissão de microfone negada. Habilite o acesso nas configurações do sistema.";
    case "no-speech":
      return "Nenhuma fala detectada. Tente novamente.";
    case "audio-capture":
      return "Não foi possível capturar áudio do microfone.";
    case "network":
      return "Falha de rede ao usar o serviço de reconhecimento de fala.";
    case "aborted":
      return "Reconhecimento cancelado.";
    default:
      return `Erro no reconhecimento de fala: ${code}`;
  }
}
