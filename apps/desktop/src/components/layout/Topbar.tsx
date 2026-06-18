import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Keyboard, Mic, Sliders, UserCircle2, X, Menu, Zap, Minus, Square, Loader2 } from "lucide-react";
import { HintTooltip } from "../help/HintTooltip";
import { isProviderReadyForStt } from "../../voice/sttProvider";
import type { AudioProviderSettings } from "@fluxora/shared";
import logoIcon from "../../assets/logo-icon-transparent.png";
import { useMicCapture } from "../../hooks/useMicCapture";
import { convertToWav } from "../../voice/audio-utils";

const formatTime = (s: number) => {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
};

export function Topbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [audioSettings, setAudioSettings] = useState<AudioProviderSettings | null>(null);
  const navigate = useNavigate();
  const mic = useMicCapture();
  const pushToTalkActiveRef = useRef(false);

  const handleSubmit = async (text: string) => {
    setSubmitError(undefined);
    try {
      navigate("/overview", {
        state: {
          prefillCommand: text,
        },
      });
      setTranscript("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`Falha ao enviar comando: ${msg}`);
    }
  };

  const handleStartStopRecording = useCallback(async () => {
    setSubmitError(undefined);

    if (mic.state === "recording") {
      const blob = await mic.stop();
      if (!blob || blob.size === 0) {
        setSubmitError("Gravação vazia. Tente falar mais perto do microfone.");
        return;
      }
      if (!audioSettings || !isProviderReadyForStt(audioSettings)) {
        setSubmitError("Provider de voz não configurado nas configurações.");
        return;
      }

      setIsTranscribing(true);
      try {
        const wavBlob = await convertToWav(blob, 16000);
        const bytes = await wavBlob.arrayBuffer();
        const sourceLang = audioSettings.language || "pt-BR";
        const result = await window.fluxora.voice.transcribe({
          audio: bytes,
          mimeType: wavBlob.type || "audio/wav",
          language: sourceLang === "auto" ? undefined : sourceLang,
          providerType: audioSettings.type,
        });
        setIsTranscribing(false);
        if (result.text.trim()) {
          await handleSubmit(result.text.trim());
        }
      } catch (err) {
        setIsTranscribing(false);
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (!audioSettings || audioSettings.type === "manual") {
      setSubmitError("Selecione Whisper local offline ou nuvem nas Configurações.");
      return;
    }

    await mic.start();
  }, [audioSettings, mic]);

  // Push to talk effect
  useEffect(() => {
    const isPushToTalk = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && (event.key === " " || event.code === "Space");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTranscribing || !isPushToTalk(event)) return;
      event.preventDefault();
      if (mic.state !== "recording") {
        pushToTalkActiveRef.current = true;
        void handleStartStopRecording();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!pushToTalkActiveRef.current || !(event.key === " " || event.code === "Space")) return;
      event.preventDefault();
      pushToTalkActiveRef.current = false;
      if (mic.state === "recording") void handleStartStopRecording();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleStartStopRecording, isTranscribing, mic.state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await window.fluxora.settings.getAudioProvider();
        if (!cancelled) setAudioSettings(s);
      } catch {
        if (!cancelled) setAudioSettings(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [audioBars, setAudioBars] = useState<number[]>(new Array(13).fill(0));

  // Audio Analyser for Real-Time Waveform
  useEffect(() => {
    if (!mic.stream || mic.state !== "recording") {
      setAudioBars(new Array(13).fill(0));
      return;
    }

    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;

    let audioCtx: AudioContext;
    let analyser: AnalyserNode;
    let source: MediaStreamAudioSourceNode;
    let freqData: Uint8Array<ArrayBuffer>;
    let rafId: number;

    try {
      audioCtx = new Ctor();
      source = audioCtx.createMediaStreamSource(mic.stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // Small FFT size
      analyser.smoothingTimeConstant = 0.5; // Faster reaction
      source.connect(analyser);
      
      freqData = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        analyser.getByteFrequencyData(freqData);
        const newBars = new Array(13);
        // Map lower frequencies (where voice mostly resides)
        for (let i = 0; i < 13; i++) {
           const val1 = freqData[i * 2] || 0;
           const val2 = freqData[i * 2 + 1] || 0;
           const avg = (val1 + val2) / 2;
           newBars[i] = avg / 255;
        }
        setAudioBars(newBars);
        rafId = requestAnimationFrame(update);
      };
      
      update();
    } catch (err) {
      console.warn("Falha ao criar AnalyserNode:", err);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (source) {
        try { source.disconnect(); } catch { /* ignore */ }
      }
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {});
      }
    };
  }, [mic.stream, mic.state]);

  const providerReady = isProviderReadyForStt(audioSettings);
  const isRecording = mic.state === "recording";

  return (
    <>
      <div className="drag-region h-[80px] flex-shrink-0 bg-bg-deep border-b border-border flex items-center px-5 gap-6 justify-between">
        
        {/* Left Section: Logo & Menu */}
        <div className="flex items-center gap-6 min-w-[240px]">
          <div className="flex items-center gap-3.5">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <img 
                src={logoIcon} 
                alt="Fluxora Icon" 
                className="w-full h-full object-contain"
                style={{ filter: "drop-shadow(0px 0px 6px rgba(124,91,245,0.4))" }}
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-success border-[2.5px] border-bg-deep" />
            </div>
            <div className="leading-tight">
              <div className="text-[18px] font-bold text-text-primary tracking-tight">Fluxora</div>
              <div className="text-[12px] text-text-muted font-medium">Cockpit de Missões</div>
            </div>
          </div>
          <button 
            className="no-drag p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-card transition-colors"
            onClick={onToggleSidebar}
          >
            <Menu size={22} />
          </button>
        </div>

        {/* Center Section: Voice Command Pill */}
        <div className="flex-1 max-w-3xl flex items-center no-drag">
          <div 
            className={`w-full h-[52px] bg-[#1A1A24] border ${submitError ? 'border-error/50' : 'border-[#2A2A35]'} rounded-md flex items-center px-3 pr-1.5 gap-3 cursor-text transition-all focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/50`}
          >
            <div className={`w-10 h-10 rounded-md bg-[#242438] flex items-center justify-center flex-shrink-0 ml-1 transition-colors ${isRecording ? 'text-error' : 'text-accent'}`}>
              <Mic size={18} className={isRecording ? 'animate-pulse' : ''} />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-center pt-0.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && transcript.trim()) await handleSubmit(transcript.trim());
                  }}
                  placeholder={submitError || (isTranscribing ? "Transcrevendo..." : "Fale com o Orquestrador...")}
                  className={`w-full bg-transparent text-[15px] ${submitError ? 'text-error placeholder:text-error' : 'text-text-primary placeholder:text-text-muted'} outline-none`}
                  disabled={isRecording || isTranscribing}
                />
              </div>
              <div className="text-[11.5px] text-text-muted leading-tight mt-0.5">
                Clique ou pressione <kbd className="font-semibold text-text-secondary">Ctrl+Espaço</kbd> e fale
              </div>
            </div>

            {isTranscribing && (
              <Loader2 size={16} className="text-accent animate-spin mr-3" />
            )}

            {/* Audio Waveform / Timer */}
            <div className="flex items-center gap-[3.5px] h-7 px-3">
              {[4, 8, 5, 12, 6, 14, 8, 5, 10, 6, 12, 7, 4].map((baseH, i) => {
                const liveH = audioBars[i] || 0;
                // Idle uses baseH. Recording dynamically responds up to 24px.
                const h = isRecording ? Math.max(3, liveH * 24) : baseH * 1.6;
                return (
                  <div 
                    key={i} 
                    className={`w-[3px] rounded-full transition-all duration-75 ${isRecording ? 'bg-accent' : 'bg-[#8B8BF5] opacity-30'}`} 
                    style={{ height: `${h}px` }} 
                  />
                );
              })}
            </div>

            <div className={`text-[14px] font-medium font-mono px-3 ${isRecording ? 'text-accent' : 'text-text-muted'}`}>
              {formatTime(mic.elapsed)}
            </div>

            <button
              onClick={handleStartStopRecording}
              disabled={isTranscribing}
              className={`flex-shrink-0 w-11 h-11 rounded-md flex items-center justify-center transition-colors ${
                isRecording
                  ? "bg-error text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                  : providerReady
                  ? "bg-accent text-white hover:bg-accent-hover shadow-[0_0_10px_rgba(124,91,245,0.3)]"
                  : "bg-bg-input text-text-muted opacity-60"
              }`}
            >
              <Mic size={20} className={isRecording ? 'animate-pulse' : ''} />
            </button>
          </div>
        </div>

        {/* Right Section: Status & Controls */}
        <div className="flex items-center gap-5 min-w-[240px] justify-end no-drag">
          <div className="flex items-center gap-3 px-3.5 h-11 rounded-md border border-border-subtle bg-bg-base/30">
            <span className="w-2.5 h-2.5 rounded-full bg-success flux-pulse-dot" />
            <div className="leading-tight">
              <div className="text-[13.5px] text-text-primary font-medium">Orquestrador Ativo</div>
              <div className="text-[11.5px] text-text-muted">Pronto para receber comandos</div>
            </div>
            <button className="text-text-muted hover:text-text-primary pl-2.5 border-l border-border-subtle ml-1.5">
              <Sliders size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button className="w-10 h-10 rounded-md bg-bg-card flex items-center justify-center text-text-secondary hover:text-text-primary border border-border-subtle">
              <UserCircle2 size={20} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
