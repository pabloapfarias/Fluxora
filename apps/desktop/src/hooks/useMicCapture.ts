import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "error";

export interface UseMicCaptureResult {
  state: RecorderState;
  error?: string;
  elapsed: number;
  audioBlob?: Blob;
  audioMimeType?: string;
  /** Stream de mídia ativo durante a gravação. Útil para criar AnalyserNode/visualizer. */
  stream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

export function useMicCapture(): UseMicCaptureResult {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | undefined>();
  const [audioMimeType, setAudioMimeType] = useState<string | undefined>();
  const [stream, setStream] = useState<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "requesting") return;
    setError(undefined);
    setAudioBlob(undefined);
    setAudioMimeType(undefined);
    setElapsed(0);
    chunksRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Captura de áudio não suportada neste ambiente. Use a digitação manual.");
      setState("error");
      return;
    }

    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStream(stream);
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      setAudioMimeType(recorder.mimeType || mimeType || "audio/webm");
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        setAudioBlob(blob);
        setState("idle");
        cleanup();
      };
      recorder.onerror = (e: any) => {
        setError(e?.error?.message || "Erro no MediaRecorder");
        setState("error");
        cleanup();
      };
      startTimeRef.current = Date.now();
      recorder.start(250);
      setState("recording");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Não foi possível acessar o microfone: ${msg}`);
      setState("error");
      cleanup();
    }
  }, [state, cleanup]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const rec = mediaRecorderRef.current;
    if (!rec) return null;
    return await new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setAudioBlob(blob);
        setState("idle");
        cleanup();
        resolve(blob);
      };
      try { rec.stop(); } catch { resolve(null); }
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* noop */ }
    }
    cleanup();
    setState("idle");
    setAudioBlob(undefined);
    setElapsed(0);
    chunksRef.current = [];
  }, [cleanup]);

  return { state, error, elapsed, audioBlob, audioMimeType, stream, start, stop, cancel };
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* noop */ }
  }
  return "";
}
