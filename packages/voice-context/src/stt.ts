import type { AudioTranscriptionResult, AudioTranscriptionInput } from "@fluxora/shared";

export interface TranscriptSegment {
  text: string;
  confidence?: number;
  startMs?: number;
  endMs?: number;
}

export interface TranscriptionInput {
  audio: ArrayBuffer | Uint8Array | string;
  mimeType: string;
  language?: string;
  segments?: TranscriptSegment[];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
  provider: string;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class ManualTranscriptProvider implements SpeechToTextProvider {
  readonly name = "manual";
  async transcribe(): Promise<TranscriptionResult> {
    return { text: "", provider: this.name };
  }
}

export class CompositeTranscriptProvider implements SpeechToTextProvider {
  readonly name: string;
  constructor(private providers: SpeechToTextProvider[]) {
    this.name = providers.map((p) => p.name).join("+") || "composite";
  }
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        return await p.transcribe(input);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Nenhum provider de STT disponível");
  }
}

export function normalizeTranscriptInput(input: AudioTranscriptionInput): TranscriptionInput {
  return {
    audio: input.audio,
    mimeType: input.mimeType,
    language: input.language,
  };
}

export function toSharedResult(result: TranscriptionResult): AudioTranscriptionResult {
  return {
    text: result.text,
    language: result.language,
    durationMs: result.durationMs,
    provider: result.provider,
  };
}
