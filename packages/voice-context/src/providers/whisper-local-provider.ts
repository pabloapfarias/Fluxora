import { WhisperHttpProvider, type WhisperHttpProviderConfig } from "./whisper-http-provider";

/**
 * URL padrão dos servidores Whisper locais OpenAI-compatible.
 * - `faster-whisper-server`: porta 8178 por padrão
 * - `whisper-asr-webservice`: porta 9000
 *
 * Nota: o `whisper-server` do whisper.cpp NÃO usa prefixo `/v1`.
 * Se você está usando o binário bundled do Fluxora, a URL do servidor
 * é `http://localhost:8178` (sem `/v1`).
 */
export const WHISPER_LOCAL_DEFAULT_URL = "http://localhost:8178/v1";

export interface WhisperLocalProviderConfig {
  /**
   * URL do endpoint local. Default: `http://localhost:8178/v1`.
   * Para o whisper-server do whisper.cpp (bundled), use `http://localhost:8178`.
   */
  baseUrl?: string;
  /**
   * Nome do modelo no servidor local. Default: `whisper-1`.
   */
  model?: string;
  /** Idioma (ex.: "pt-BR"). */
  language?: string;
  /**
   * Env var com a API key (caso o servidor local exija). Default: não exige.
   * Mesmo se a env var existir, ela é enviada opcionalmente como
   * `Authorization: Bearer <key>`.
   */
  apiKeyEnv?: string;
  /** Timeout em ms. Default: 60s (Whisper local pode ser mais lento que a nuvem). */
  timeoutMs?: number;
}

/**
 * Provider de STT que fala com um servidor Whisper local (rodando em
 * `localhost`). Usa o `WhisperHttpProvider` por baixo com `apiKeyOptional: true`
 * — a maioria dos servidores locais não exige autenticação.
 *
 * Servidores compatíveis:
 * - [faster-whisper-server](https://github.com/guillaumekln/faster-whisper-server)
 *   (`pip install faster-whisper-server && faster-whisper-server`)
 * - [whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice)
 *   (`docker run ...`)
 * - `whisper.cpp` com flag `--server`
 */
export class WhisperLocalProvider {
  readonly name = "whisper_local";
  private inner: WhisperHttpProvider;

  constructor(config: WhisperLocalProviderConfig = {}) {
    const full: WhisperHttpProviderConfig = {
      baseUrl: config.baseUrl || WHISPER_LOCAL_DEFAULT_URL,
      apiKeyEnv: config.apiKeyEnv || "WHISPER_LOCAL_NO_KEY",
      model: config.model || "whisper-1",
      language: config.language,
      timeoutMs: config.timeoutMs ?? 60_000,
      apiKeyOptional: true,
    };
    this.inner = new WhisperHttpProvider(full);
  }

  getConfig(): WhisperHttpProviderConfig {
    return this.inner.getConfig();
  }

  isReady(): boolean {
    return this.inner.isReady();
  }

  async transcribe(input: Parameters<WhisperHttpProvider["transcribe"]>[0]) {
    return this.inner.transcribe(input);
  }

  cancel(): void {
    // WhisperHttpProvider é stateless (cada chamada é HTTP); nada a cancelar.
  }
}
