import {
  WhisperHttpProvider,
  ManualTranscriptProvider,
  WHISPER_LOCAL_DEFAULT_URL,
} from "@fluxora/voice-context";
import type { AudioProviderSettings, AudioTranscriptionResult } from "@fluxora/shared";

// Re-exporta para manter compatibilidade com consumers que importam daqui.
export { WHISPER_LOCAL_DEFAULT_URL };

/**
 * Provider de STT disponível no renderer.
 */
export type LocalSttProvider =
  | { kind: "whisper_local_managed"; settings: AudioProviderSettings }
  | { kind: "whisper_local"; provider: WhisperHttpProvider; settings: AudioProviderSettings }
  | { kind: "whisper_http"; provider: WhisperHttpProvider; settings: AudioProviderSettings }
  | { kind: "manual"; provider: ManualTranscriptProvider };

export interface BuildLocalSttProviderOptions {
  settings: AudioProviderSettings;
  speechRecognitionFactory?: () => unknown;
}

/**
 * Constrói o provider principal configurado pelo usuário.
 */
export function buildLocalSttProvider(
  options: BuildLocalSttProviderOptions
): LocalSttProvider {
  const { settings } = options;
  switch (settings.type) {
    case "whisper_local_managed":
      return { kind: "whisper_local_managed", settings };
    case "whisper_local": {
      const localLang = settings.language ? settings.language.split("-")[0] : undefined;
      const provider = new WhisperHttpProvider({
        baseUrl: settings.baseUrl || WHISPER_LOCAL_DEFAULT_URL,
        apiKeyEnv: "_local_no_key",
        model: settings.model || "whisper-1",
        language: localLang,
        apiKeyOptional: true,
      });
      return { kind: "whisper_local", provider, settings };
    }
    case "whisper_http":
    case "openai_whisper": {
      const provider = new WhisperHttpProvider({
        baseUrl: settings.baseUrl || "https://api.openai.com/v1",
        apiKeyEnv: settings.apiKeyEnv || "OPENAI_API_KEY",
        model: settings.model || "whisper-1",
        language: settings.language,
      });
      return { kind: "whisper_http", provider, settings };
    }
    case "manual":
    default: {
      return { kind: "manual", provider: new ManualTranscriptProvider() };
    }
  }
}

/**
 * Indica se o provider atual consegue transcrever áudio automaticamente.
 * `manual` retorna `false` — o usuário precisa digitar.
 */
export function isProviderReadyForStt(
  settings: AudioProviderSettings | null | undefined
): boolean {
  if (!settings) return false;
  return (
    settings.type === "whisper_local_managed" ||
    settings.type === "whisper_local" ||
    settings.type === "whisper_http" ||
    settings.type === "openai_whisper"
  );
}

/**
 * Label amigável para o tipo de provider, usado na UI.
 */
export function describeProviderType(
  settings: AudioProviderSettings | null | undefined
): string {
  if (!settings) return "não configurado";
  switch (settings.type) {
    case "whisper_local_managed":
      return "Whisper local offline (recomendado)";
    case "whisper_local":
      return "Whisper local (servidor em localhost)";
    case "whisper_http":
      return "Whisper HTTP (OpenAI-compatible)";
    case "openai_whisper":
      return "OpenAI Whisper (legado)";
    case "manual":
      return "Manual (sem captura)";
    default:
      return "desconhecido";
  }
}

// (probeWhisperLocal removido na PR 013 — não há mais bundled server para probe)
