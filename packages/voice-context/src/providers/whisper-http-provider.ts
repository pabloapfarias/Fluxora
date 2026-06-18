import type { SpeechToTextProvider, TranscriptionInput, TranscriptionResult } from "../stt";

export type WhisperHttpEnvReader = (key: string) => string | undefined;

export interface WhisperHttpProviderConfig {
  baseUrl: string
  apiKeyEnv: string
  model: string
  language?: string
  /**
   * Injetável para testes. Default: `process.env`.
   */
  envReader?: WhisperHttpEnvReader
  /**
   * Injetável para testes. Default: `fetch` global.
   */
  fetcher?: typeof fetch
  /**
   * Timeout em ms. Default: 30s.
   */
  timeoutMs?: number
  /**
   * Quando `true`, a API key não é obrigatória. Use para servidores locais
   * (`whisper_local`) que normalmente não exigem autenticação. Mesmo assim,
   * se a env var existir, ela é enviada como `Authorization: Bearer <key>`.
   * Default: `false`.
   */
  apiKeyOptional?: boolean
}

export class WhisperHttpProviderError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = "WhisperHttpProviderError"
  }
}

/**
 * Provider de Speech-to-Text HTTP compatível com a API OpenAI Whisper
 * (`POST /v1/audio/transcriptions`).
 *
 * Aceita qualquer baseUrl que implemente o mesmo contrato:
 *   - POST {baseUrl}/audio/transcriptions
 *   - Authorization: Bearer <apiKey>
 *   - multipart/form-data com campo `file` e demais params
 *   - resposta JSON: { "text": "..." }
 */
export class WhisperHttpProvider implements SpeechToTextProvider {
  readonly name = "whisper_http"
  private config: WhisperHttpProviderConfig
  private envReader: WhisperHttpEnvReader
  private fetcher: typeof fetch
  private timeoutMs: number

  constructor(config: WhisperHttpProviderConfig) {
    this.config = config
    this.envReader = config.envReader || ((k: string) => process.env[k])
    this.fetcher = config.fetcher || this.defaultFetcher()
    this.timeoutMs = config.timeoutMs ?? 30_000
  }

  getConfig(): WhisperHttpProviderConfig {
    return { ...this.config }
  }

  /**
   * Indica se o provider está pronto para transcrever (config válida).
   * Útil para o painel decidir se mostra o botão de mic.
   */
  isReady(): boolean {
    if (!this.config.baseUrl) return false
    if (!this.config.model) return false
    if (this.config.apiKeyOptional) {
      return true
    }
    const hasEnv = Boolean(this.envReader(this.config.apiKeyEnv))
    const hasRawKey = Boolean(this.config.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(this.config.apiKeyEnv))
    return hasEnv || hasRawKey
  }

  private defaultFetcher(): typeof fetch {
    if (typeof fetch !== "undefined") {
      return fetch.bind(globalThis)
    }
    return (() => {
      throw new WhisperHttpProviderError("no_fetcher", "fetch indisponível no ambiente")
    }) as unknown as typeof fetch
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    // Se a string começar com sk-, ela é a própria chave, não o nome da variável
    let apiKey = this.envReader(this.config.apiKeyEnv)
    if (!apiKey && this.config.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(this.config.apiKeyEnv)) {
      apiKey = this.config.apiKeyEnv;
    }
    
    if (!apiKey && !this.config.apiKeyOptional) {
      throw new WhisperHttpProviderError(
        "missing_api_key",
        `A chave da API OpenAI (ou Variável de Ambiente "${this.config.apiKeyEnv}") não foi encontrada no app. Configure a chave nas opções.`
      )
    }
    if (!this.config.baseUrl) {
      throw new WhisperHttpProviderError("missing_base_url", "baseUrl é obrigatório")
    }
    if (!this.config.model) {
      throw new WhisperHttpProviderError("missing_model", "model é obrigatório")
    }

    const fileBytes = await toUint8Array(input.audio)
    const fileName = `audio.${guessExt(input.mimeType)}`

    const form = new FormData()
    // Garante que o tipo do Buffer subjacente é ArrayBuffer (não SharedArrayBuffer)
    const ab = new ArrayBuffer(fileBytes.byteLength)
    new Uint8Array(ab).set(fileBytes)
    form.append("file", new Blob([ab], { type: input.mimeType || "audio/webm" }), fileName)
    form.append("model", this.config.model)
    if (this.config.language || input.language) {
      form.append("language", this.config.language || input.language || "")
    }
    form.append("response_format", "json")

    const url = joinUrl(this.config.baseUrl, "/audio/transcriptions")
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    let res: Response
    try {
      res = await this.fetcher(url, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      })
    } catch (err) {
      if ((err as any)?.name === "AbortError") {
        throw new WhisperHttpProviderError("timeout", `Whisper HTTP timeout após ${this.timeoutMs}ms`)
      }
      throw new WhisperHttpProviderError(
        "network_error",
        `Falha de rede ao chamar Whisper: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      clearTimeout(timeoutHandle)
    }

    if (!res.ok) {
      const text = await safeReadText(res)
      throw new WhisperHttpProviderError(
        `http_${res.status}`,
        `Whisper HTTP retornou ${res.status}: ${text.slice(0, 500)}`
      )
    }

    let data: any
    try {
      data = await res.json()
    } catch (err) {
      throw new WhisperHttpProviderError(
        "invalid_response",
        `Resposta inválida do Whisper: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const text = typeof data?.text === "string" ? data.text : ""
    if (!text.trim()) {
      throw new WhisperHttpProviderError("empty_transcript", "Whisper retornou transcrição vazia")
    }

    return {
      text: text.trim(),
      language: this.config.language || input.language,
      provider: this.name,
    }
  }
}

async function toUint8Array(audio: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (typeof audio === "string") {
    return new TextEncoder().encode(audio)
  }
  if (audio instanceof Uint8Array) return audio
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio)
  // Node Buffer ou outro
  return new Uint8Array((audio as any).buffer || audio)
}

function guessExt(mime: string | undefined): string {
  if (!mime) return "webm"
  const m = mime.toLowerCase()
  if (m.includes("webm")) return "webm"
  if (m.includes("ogg")) return "ogg"
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "m4a"
  if (m.includes("wav")) return "wav"
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3"
  return "webm"
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${b}${p}`
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ""
  }
}
