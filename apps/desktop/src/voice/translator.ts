/**
 * Tradutor multi-idioma via MyMemory API.
 *
 * MyMemory é um serviço gratuito de tradução automática que não requer
 * API key para uso moderado (até 5000 palavras/dia anônimo, 50000/dia
 * com email registrado).
 *
 * Cache local em localStorage para evitar requests repetidos.
 */
const CACHE_PREFIX = "fluxora.translation.";

interface TranslationCacheEntry {
  text: string;
  from: string;
  to: string;
  result: string;
  cachedAt: string;
}

function makeCacheKey(text: string, from: string, to: string): string {
  // Hash simples para evitar chaves muito longas (textos grandes)
  const hash = text.length > 80 ? text.slice(0, 40) + text.length + text.slice(-20) : text;
  return `${CACHE_PREFIX}${from}|${to}|${hash}`;
}

function getCached(text: string, from: string, to: string): string | null {
  try {
    const raw = localStorage.getItem(makeCacheKey(text, from, to));
    if (raw) {
      const entry = JSON.parse(raw) as TranslationCacheEntry;
      if (entry.text === text && entry.from === from && entry.to === to) {
        return entry.result;
      }
    }
  } catch {
    // Cache corrompido, ignorar
  }
  return null;
}

function setCache(text: string, from: string, to: string, result: string): void {
  try {
    const entry: TranslationCacheEntry = {
      text,
      from,
      to,
      result,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(makeCacheKey(text, from, to), JSON.stringify(entry));
  } catch {
    // localStorage cheio ou indisponível, ignorar silenciosamente
  }
}

// Fila de tradução para evitar rate-limit do MyMemory
let translationQueue: Array<{
  text: string;
  from: string;
  to: string;
  resolve: (result: string) => void;
  reject: (err: unknown) => void;
}> = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing || translationQueue.length === 0) return;
  processing = true;

  while (translationQueue.length > 0) {
    const item = translationQueue.shift()!;

    // Verifica cache primeiro
    const cached = getCached(item.text, item.from, item.to);
    if (cached !== null) {
      item.resolve(cached);
      continue;
    }

    try {
      const result = await doTranslate(item.text, item.from, item.to);
      setCache(item.text, item.from, item.to, result);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }

    // Delay de 200ms entre requests para não rate-limitar
    await new Promise((r) => setTimeout(r, 200));
  }

  processing = false;
}

async function doTranslate(text: string, from: string, to: string): Promise<string> {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", `${from}|${to}`);
  url.searchParams.set("de", "fluxora@example.com");

  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`MyMemory retornou ${res.status}`);
    }

    const data = await res.json();

    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }

    // Se a API retornou mas sem tradução, retorna o texto original
    if (data.responseStatus === 403) {
      console.warn("[translator] MyMemory rate limit atingido, retornando texto original");
    }

    return text;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timeout ao traduzir");
    }
    throw err;
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Traduz um texto do idioma `from` para o idioma `to`.
 *
 * Usa fila interna para evitar rate-limit do MyMemory.
 * Cache em localStorage para evitar requests repetidos.
 *
 * @param text Texto a ser traduzido
 * @param from Código do idioma fonte (ex: "pt", "en", "es")
 * @param to Código do idioma alvo (ex: "en", "es")
 * @returns Promise com o texto traduzido ou o texto original em caso de erro
 */
export function translate(text: string, from: string, to: string): Promise<string> {
  // Se o texto estiver vazio, retorna imediatamente
  if (!text || !text.trim()) {
    return Promise.resolve(text);
  }

  // Verifica cache síncrono
  const cached = getCached(text, from, to);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  // Enfileira e processa
  return new Promise<string>((resolve, reject) => {
    translationQueue.push({ text, from, to, resolve, reject });
    void processQueue();
  });
}

/**
 * Limpa o cache de traduções do localStorage.
 */
export function clearTranslationCache(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

/**
 * Mapeia códigos ISO de idioma para os formatos que o MyMemory aceita.
 */
export const LANGUAGE_MAP: Record<string, string> = {
  "pt-BR": "pt",
  "pt-PT": "pt",
  "en-US": "en",
  "en-GB": "en",
  "es-ES": "es",
  "fr-FR": "fr",
  "de-DE": "de",
  "ja-JP": "ja",
  "zh-CN": "zh",
  "it-IT": "it",
  "nl-NL": "nl",
  "ko-KR": "ko",
  "ru-RU": "ru",
  "ar-SA": "ar",
};

/**
 * Normaliza um código de idioma para o formato que o MyMemory aceita.
 * Ex: "pt-BR" → "pt", "en-US" → "en"
 */
export function normalizeLang(lang: string): string {
  return LANGUAGE_MAP[lang] || lang.split("-")[0] || lang;
}
