import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Eraser, Loader2, Mic, Send, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AudioProviderSettings } from "@fluxora/shared";
import { useMicCapture } from "../../hooks/useMicCapture";
import { convertToWav } from "../../voice/audio-utils";
import { describeProviderType, isProviderReadyForStt } from "../../voice/sttProvider";
import { AudioWave } from "./AudioWave";

interface VoiceTranscriptionPanelProps {
  initialText?: string;
  onSubmit: (text: string) => void | Promise<void>;
  onClose?: () => void;
  onRecordingChange?: (recording: boolean) => void;
  submitError?: string;
  onClearSubmitError?: () => void;
  audioSettings?: AudioProviderSettings | null;
}

type VoiceFlowState = "idle" | "recording" | "transcribing" | "ready" | "error";

const SOURCE_LANGUAGES = [
  { value: "pt-BR", label: "Português (BR)" },
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español" },
  { value: "auto", label: "Auto" },
];

export function VoiceTranscriptionPanel({
  initialText = "",
  onSubmit,
  onRecordingChange,
  submitError,
  onClearSubmitError,
  audioSettings: audioSettingsProp,
}: VoiceTranscriptionPanelProps) {
  const mic = useMicCapture();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pushToTalkActiveRef = useRef(false);
  const [transcript, setTranscript] = useState(initialText);
  const [flowState, setFlowState] = useState<VoiceFlowState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [audioSettings, setAudioSettings] = useState<AudioProviderSettings | null>(audioSettingsProp ?? null);
  const [sourceLang, setSourceLang] = useState(audioSettingsProp?.language || "pt-BR");
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const isTranscribing = flowState === "transcribing";

  useEffect(() => {
    if (audioSettingsProp !== undefined) {
      setAudioSettings(audioSettingsProp);
      setSourceLang(audioSettingsProp?.language || "pt-BR");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await window.fluxora.settings.getAudioProvider();
        if (!cancelled) {
          setAudioSettings(settings);
          setSourceLang(settings.language || "pt-BR");
        }
      } catch {
        if (!cancelled) setAudioSettings(null);
      }
    })();
    return () => { cancelled = true; };
  }, [audioSettingsProp]);

  useEffect(() => {
    const recording = mic.state === "recording";
    setFlowState((current) => recording ? "recording" : current === "recording" ? "idle" : current);
    onRecordingChange?.(recording);
  }, [mic.state, onRecordingChange]);

  const handleStartStop = useCallback(async () => {
    setError(undefined);
    if (mic.state === "recording") {
      const blob = await mic.stop();
      if (!blob || blob.size === 0) {
        setFlowState("error");
        setError("Gravação vazia. Tente novamente falando mais perto do microfone.");
        return;
      }
      if (!audioSettings || !isProviderReadyForStt(audioSettings)) {
        setFlowState("ready");
        setError("Provider de voz não configurado. Você ainda pode editar/digitar manualmente.");
        return;
      }

      setFlowState("transcribing");
      try {
        const wavBlob = await convertToWav(blob, 16000);
        const bytes = await wavBlob.arrayBuffer();
        const result = await window.fluxora.voice.transcribe({
          audio: bytes,
          mimeType: wavBlob.type || "audio/wav",
          language: sourceLang === "auto" ? undefined : sourceLang,
          providerType: audioSettings.type,
        });
        setTranscript((prev) => (prev.trim() ? `${prev.trim()}\n${result.text}` : result.text));
        setFlowState("ready");
        setTimeout(() => textareaRef.current?.focus(), 0);
      } catch (err) {
        setFlowState("error");
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (!audioSettings || audioSettings.type === "manual") {
      setFlowState("error");
      setError("Selecione Whisper local offline ou nuvem nas Configurações, ou digite a missão manualmente.");
      return;
    }

    await mic.start();
    setFlowState("recording");
  }, [audioSettings, mic, sourceLang]);

  useEffect(() => {
    const isPushToTalk = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTranscribing || !isPushToTalk(event)) return;
      event.preventDefault();
      if (mic.state !== "recording") {
        pushToTalkActiveRef.current = true;
        void handleStartStop();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!pushToTalkActiveRef.current || !(event.key === " " || event.code === "Space")) return;
      event.preventDefault();
      pushToTalkActiveRef.current = false;
      if (mic.state === "recording") void handleStartStop();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleStartStop, isTranscribing, mic.state]);

  const handleClear = () => {
    setTranscript("");
    setError(undefined);
    setFlowState("idle");
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleCopy = async () => {
    if (!transcript.trim()) return;
    try {
      await navigator.clipboard?.writeText(transcript);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }
    setTimeout(() => setCopyFeedback("idle"), 1500);
  };

  const handleSubmit = () => {
    const text = transcript.trim();
    if (!text || flowState === "transcribing") return;
    void onSubmit(text);
  };

  const hasText = Boolean(transcript.trim());
  const isRecording = mic.state === "recording";
  const providerReady = audioSettings ? isProviderReadyForStt(audioSettings) : false;

  return (
    <div className="flex flex-col gap-3 h-full">
      <AudioWave
        isRecording={isRecording}
        isProcessing={mic.state === "requesting" || isTranscribing}
        elapsedSeconds={mic.elapsed}
        audioSaved={flowState === "ready" && hasText}
        providerReady={providerReady}
        stream={mic.stream}
        isListening={isRecording}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] text-text-muted">
          Provider: <span className="text-text-secondary">{describeProviderType(audioSettings)}</span>
        </div>
        <select
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
          className="flux-input text-[11px] py-1 px-2 max-w-[180px]"
          disabled={isRecording || isTranscribing}
          data-testid="language-selector"
        >
          {SOURCE_LANGUAGES.map((lang) => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
        </select>
      </div>

      {audioSettings?.type === "whisper_local_managed" && !audioSettings.model && (
        <div className="flex items-start gap-2 text-[11px] text-warning rounded-lg border border-warning/20 bg-warning/5 p-2.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>Nenhum modelo local selecionado. Vá em Configurações → Áudio e baixe/selecione um modelo Whisper.</span>
        </div>
      )}

      {(error || mic.error) && (
        <div className="flex items-start gap-2 text-[11px] text-warning rounded-lg border border-warning/20 bg-warning/5 p-2.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span>{error || mic.error}</span>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-2 text-[11px] text-error rounded-lg border border-error/20 bg-error/5 p-2.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{submitError}</span>
          {onClearSubmitError && <button onClick={onClearSubmitError}>✕</button>}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="A transcrição aparecerá aqui. Revise/edite antes de enviar ao Orquestrador..."
        className="flux-input resize-none text-[13px] leading-relaxed min-h-[150px] flex-1"
        data-testid="transcript-textarea"
      />

      {isTranscribing && (
        <div className="flex items-center gap-2 text-[11px] text-accent">
          <Loader2 size={13} className="animate-spin" />
          Transcrevendo localmente/por provider configurado...
        </div>
      )}

      {flowState === "ready" && hasText && (
        <div className="flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 size={12} />
          Texto pronto para revisão e confirmação.
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleStartStop}
            disabled={mic.state === "requesting" || isTranscribing}
            data-testid="record-button"
            className={`no-drag inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all ${
              isRecording ? "bg-error hover:bg-error/90 text-white" : providerReady ? "bg-accent hover:bg-accent-hover text-white" : "bg-bg-input text-text-muted cursor-not-allowed"
            }`}
          >
            <Mic size={14} className={isRecording ? "animate-pulse" : ""} />
            {isRecording ? "Parar" : "Gravar"}
          </button>

          {hasText && (
            <button onClick={handleCopy} title="Copiar transcrição" className="no-drag flux-btn-ghost h-8 w-8 p-0 flex items-center justify-center">
              {copyFeedback === "copied" ? <CheckCircle2 size={13} /> : <ClipboardCopy size={13} />}
            </button>
          )}

          {hasText && (
            <button onClick={handleClear} title="Limpar" className="no-drag flux-btn-ghost h-8 w-8 p-0 flex items-center justify-center">
              <Eraser size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate("/settings")} title="Configurações de áudio" className="no-drag flux-btn-ghost h-8 px-2 flex items-center gap-1 text-[11px]">
            <SettingsIcon size={12} />
            Áudio
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasText || isTranscribing}
            data-testid="submit-button"
            className="no-drag inline-flex items-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 px-3.5 py-2 rounded-lg text-[12px] font-medium transition-colors"
          >
            <Send size={13} />
            Enviar ao Orquestrador
          </button>
        </div>
      </div>
    </div>
  );
}
