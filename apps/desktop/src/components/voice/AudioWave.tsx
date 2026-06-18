import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mic } from "lucide-react";

interface AudioWaveProps {
  isRecording: boolean;
  isProcessing: boolean;
  elapsedSeconds?: number;
  audioSaved?: boolean;
  /**
   * Se `false`, o estado idle mostra "STT indisponível" em vez de "Pronto".
   */
  providerReady?: boolean;
  /**
   * Stream de áudio ativo. Quando fornecido, o componente usa um AnalyserNode
   * real para renderizar o waveform (FFT em tempo real).
   */
  stream?: MediaStream | null;
  /**
   * Se `true`, mostra um "pulsing live dot" em vez de timer.
   */
  isListening?: boolean;
}

const formatTime = (s: number) => {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
};

const BAR_COUNT = 48;
const FFT_SIZE = 256;

/**
 * Visual waveform component — renders animated bars based on real FFT data
 * (via AnalyserNode) when a MediaStream is available. Falls back to simulated
 * animation when no stream is provided.
 */
export function AudioWave({
  isRecording,
  isProcessing,
  elapsedSeconds = 0,
  audioSaved = false,
  providerReady = true,
  stream,
  isListening = false,
}: AudioWaveProps) {
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, (_, i) => 0.1 + Math.sin((i / BAR_COUNT) * Math.PI * 2) * 0.05),
  );
  const [volPercent, setVolPercent] = useState(0);

  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const phaseRef = useRef(0);

  // ============================================================
  // Set up AnalyserNode when stream becomes available
  // ============================================================
  useEffect(() => {
    if (!isRecording || !stream) {
      // Cleanup analyser
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch { /* ignore */ }
        sourceRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
      freqDataRef.current = null;
      timeDataRef.current = null;
      return;
    }

    if (typeof window === "undefined") return;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;

    try {
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(analyser.fftSize);
    } catch (err) {
      console.warn("[AudioWave] Falha ao criar AnalyserNode:", err);
    }

    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch { /* ignore */ }
        sourceRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
      freqDataRef.current = null;
      timeDataRef.current = null;
    };
  }, [isRecording, stream]);

  // ============================================================
  // Animation loop
  // ============================================================
  useEffect(() => {
    if (!isRecording) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setVolPercent(0);
      // Reset to idle shape
      setBars(
        Array.from({ length: BAR_COUNT }, (_, i) => 0.1 + Math.sin((i / BAR_COUNT) * Math.PI * 2) * 0.05),
      );
      return;
    }

    const tick = () => {
      phaseRef.current += 0.05;
      const analyser = analyserRef.current;
      const freqData = freqDataRef.current;
      const timeData = timeDataRef.current;

      if (analyser && freqData) {
        // Real FFT
        analyser.getByteFrequencyData(freqData);
        const newBars: number[] = new Array(BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          // Sample from low to high frequencies (speech energy is in low freq)
          const bin = Math.floor((i / BAR_COUNT) * freqData.length);
          const v = (freqData[bin] || 0) / 255;
          newBars[i] = Math.max(0.04, v);
        }
        setBars(newBars);

        // Volume from time-domain data
        if (timeData) {
          analyser.getByteTimeDomainData(timeData);
          let sum = 0;
          for (let i = 0; i < timeData.length; i++) {
            const v = (timeData[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeData.length);
          setVolPercent(Math.min(100, rms * 350));
        }
      } else {
        // Fallback: simulação pseudo-aleatória
        const simVol = 0.3 + Math.sin(phaseRef.current * 3) * 0.15 + Math.random() * 0.25;
        setVolPercent(Math.min(100, simVol * 100));
        const newBars: number[] = new Array(BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          const position = i / BAR_COUNT;
          const wave = 0.3 + Math.sin(position * Math.PI * 4 + phaseRef.current * 2) * 0.25;
          const freqWeight = 1.0 - position * 0.5;
          newBars[i] = Math.min(1, Math.max(0.04, wave * simVol * freqWeight * 1.6));
        }
        setBars(newBars);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isRecording]);

  // ============================================================
  // Render
  // ============================================================

  if (isProcessing) {
    return (
      <div className="flex items-center justify-center gap-2 h-12 text-[12px] text-text-secondary">
        <Loader2 size={14} className="animate-spin text-accent" />
        <span>Processando...</span>
      </div>
    );
  }

  if (audioSaved) {
    return (
      <div className="flex items-center justify-center gap-2 h-12 text-[12px] text-success">
        <CheckCircle2 size={14} />
        <span>Áudio salvo para auditoria.</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-2 h-12 w-full px-3">
        {/* Live dot */}
        {isListening && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error"></span>
            </span>
            <span className="text-[10px] uppercase tracking-wider text-error font-medium">Ao vivo</span>
          </div>
        )}
        {/* Waveform bars */}
        <div className="flex items-center gap-[2px] flex-1 justify-center h-full">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-full transition-all duration-75 ${
                isListening ? "bg-error" : "bg-accent"
              }`}
              style={{
                height: `${Math.max(8, h * 100)}%`,
                opacity: 0.4 + h * 0.6,
              }}
            />
          ))}
        </div>
        {/* Volume bar (small) */}
        <div className="flex-shrink-0 w-[50px] hidden sm:block">
          <div className="h-[2px] bg-text-muted/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-error rounded-full transition-all duration-75"
              style={{ width: `${volPercent}%` }}
            />
          </div>
        </div>
        {/* Timer */}
        <span className="flex-shrink-0 tabular-nums text-[11.5px] text-text-muted ml-1">
          {formatTime(elapsedSeconds)}
        </span>
      </div>
    );
  }

  // Idle state
  return (
    <div className="flex items-center justify-center gap-2 h-12 w-full px-3">
      <div className="flex items-center gap-[2px] flex-1 justify-center h-full">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-text-muted/30"
            style={{
              height: `${12 + Math.sin((i / BAR_COUNT) * Math.PI * 2) * 8}%`,
            }}
          />
        ))}
      </div>
      <span
        className={`flex-shrink-0 text-[11.5px] ml-2 ${
          providerReady ? "text-text-muted" : "text-warning"
        }`}
        data-testid="audio-wave-state"
      >
        {providerReady ? (
          <span className="flex items-center gap-1">
            <Mic size={11} />
            Pronto
          </span>
        ) : (
          "STT indisponível"
        )}
      </span>
    </div>
  );
}
