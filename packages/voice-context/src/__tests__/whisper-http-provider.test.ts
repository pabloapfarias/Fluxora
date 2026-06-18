import { describe, it, expect, vi } from "vitest";
import { WhisperHttpProvider, WhisperHttpProviderError, type WhisperHttpProviderConfig } from "../providers/whisper-http-provider";

const validConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  model: "whisper-1",
}

function makeProvider(opts: Partial<WhisperHttpProviderConfig> = {}, overrides: Partial<WhisperHttpProviderConfig> = {}) {
  const cfg: WhisperHttpProviderConfig = { ...validConfig, ...opts }
  return new WhisperHttpProvider({
    ...cfg,
    ...overrides,
  })
}

describe("WhisperHttpProvider — configuração", () => {
  it("expõe nome e config", () => {
    const p = makeProvider()
    expect(p.name).toBe("whisper_http")
    expect(p.getConfig().model).toBe("whisper-1")
  })
})

describe("WhisperHttpProvider — erros amigáveis", () => {
  it("retorna erro amigável sem API key", async () => {
    const p = makeProvider({}, { envReader: () => undefined })
    await expect(p.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" }))
      .rejects.toBeInstanceOf(WhisperHttpProviderError)
    try {
      await p.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" })
    } catch (err: any) {
      expect(err.code).toBe("missing_api_key")
      expect(err.message).toMatch(/OPENAI_API_KEY/)
    }
  })

  it("retorna erro se baseUrl vazia", async () => {
    const p = makeProvider({ baseUrl: "" }, { envReader: () => "sk-test" })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toThrow(/baseUrl/)
  })

  it("retorna erro se model vazio", async () => {
    const p = makeProvider({ model: "" }, { envReader: () => "sk-test" })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toThrow(/model/)
  })
})

describe("WhisperHttpProvider — request", () => {
  it("monta request multipart corretamente e envia Authorization Bearer", async () => {
    const fetchMock: any = vi.fn(async () => {
      return new Response(JSON.stringify({ text: "olá mundo" }), { status: 200 })
    })
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    const result = await p.transcribe({ audio: new Uint8Array([1, 2, 3, 4]), mimeType: "audio/webm" })
    expect(result.text).toBe("olá mundo")
    expect(result.provider).toBe("whisper_http")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions")
    expect(init.method).toBe("POST")
    expect((init.headers as any).Authorization).toBe("Bearer sk-test")
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get("model")).toBe("whisper-1")
    expect(form.get("response_format")).toBe("json")
    const file = form.get("file") as File
    expect(file).toBeTruthy()
    expect(file.name).toMatch(/^audio\./)
  })

  it("envia language se configurado", async () => {
    const fetchMock: any = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }))
    const p = makeProvider({ language: "pt" }, { envReader: () => "sk-test", fetcher: fetchMock })
    await p.transcribe({ audio: new Uint8Array([1, 2]), mimeType: "audio/webm" })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    const form = call[1].body as FormData
    expect(form.get("language")).toBe("pt")
  })

  it("usa baseUrl customizada (OpenAI-compatible)", async () => {
    const fetchMock: any = vi.fn(async () => new Response(JSON.stringify({ text: "x" }), { status: 200 }))
    const p = makeProvider(
      { baseUrl: "https://api.example.com/v1/" },
      { envReader: () => "sk-custom", fetcher: fetchMock }
    )
    await p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/ogg" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe("https://api.example.com/v1/audio/transcriptions")
  })
})

describe("WhisperHttpProvider — erros HTTP", () => {
  it("trata HTTP 401 com mensagem clara", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    try {
      await p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" })
      expect.fail("deveria ter lançado")
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhisperHttpProviderError)
      expect(err.code).toBe("http_401")
      expect(err.message).toMatch(/401/)
    }
  })

  it("trata HTTP 500", async () => {
    const fetchMock = vi.fn(async () => new Response("internal error", { status: 500 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "http_500" })
  })

  it("trata resposta JSON inválida", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "invalid_response" })
  })

  it("trata transcrição vazia", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "" }), { status: 200 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "empty_transcript" })
  })

  it("trata timeout (AbortError)", async () => {
    const fetchMock = vi.fn(async (_url, init: any) => {
      // Quando o AbortController for acionado, rejeita com AbortError
      return await new Promise<Response>((_, reject) => {
        const onAbort = () => {
          const e: any = new Error("aborted")
          e.name = "AbortError"
          reject(e)
        }
        if (init.signal.aborted) {
          onAbort()
        } else {
          init.signal.addEventListener("abort", onAbort, { once: true })
        }
      })
    })
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock, timeoutMs: 10 })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "timeout" })
  })

  it("trata erro de rede", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    await expect(p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" }))
      .rejects.toMatchObject({ code: "network_error" })
  })
})

describe("WhisperHttpProvider — formatos de áudio", () => {
  it("aceita ArrayBuffer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    const ab = new ArrayBuffer(4)
    await p.transcribe({ audio: ab, mimeType: "audio/webm" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("infere extensão do arquivo a partir do mime type", async () => {
    const fetchMock: any = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }))
    const p = makeProvider({}, { envReader: () => "sk-test", fetcher: fetchMock })
    await p.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/ogg;codecs=opus" })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    const form = call[1].body as FormData
    const file = form.get("file") as File
    expect(file.name).toMatch(/\.ogg$/)
  })
})
