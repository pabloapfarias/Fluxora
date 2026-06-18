export { buildVoiceContext } from "./builder";
export type { SpeechToTextProvider, TranscriptionInput, TranscriptionResult, TranscriptSegment } from "./stt";
export { ManualTranscriptProvider, CompositeTranscriptProvider } from "./stt";
export { WhisperHttpProvider, WhisperHttpProviderError } from "./providers/whisper-http-provider";
export type { WhisperHttpProviderConfig, WhisperHttpEnvReader } from "./providers/whisper-http-provider";
export { WebSpeechProvider, WebSpeechProviderError } from "./providers/web-speech-provider";
export type {
  WebSpeechProviderConfig,
  SpeechRecognitionFactory,
  SpeechRecognitionLike,
  SpeechRecognitionResultLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionErrorLike,
} from "./providers/web-speech-provider";
export { WhisperLocalProvider, WHISPER_LOCAL_DEFAULT_URL } from "./providers/whisper-local-provider";
export type { WhisperLocalProviderConfig } from "./providers/whisper-local-provider";
