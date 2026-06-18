import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Download, Copy, FileText, Code } from "lucide-react";

// Types
interface TrLine {
  id: number;
  original: string;
  en: string | null;
  es: string | null;
}

const TARGETS = [
  { key: "en", code: "en-US", api: "en", name: "English", role: "en" },
  { key: "es", code: "es-ES", api: "es", name: "Español", role: "es" },
];

const LANGS: Record<string, { name: string; short: string; api: string }> = {
  "pt-BR": { name: "Português (BR)", short: "PT", api: "pt-BR" },
  "en-US": { name: "English", short: "EN", api: "en" },
  "es-ES": { name: "Español", short: "ES", api: "es" },
  "fr-FR": { name: "Français", short: "FR", api: "fr" },
  "de-DE": { name: "Deutsch", short: "DE", api: "de" },
  "ja-JP": { name: "日本語", short: "JA", api: "ja" },
  "zh-CN": { name: "中文", short: "ZH", api: "zh-CN" },
};

function fmt(s: number) {
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

export function RealTimeTranslatorPage() {
  const [sourceLangCode, setSourceLangCode] = useState("pt-BR");
  const [isLive, setIsLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lines, setLines] = useState<TrLine[]>([]);
  const [interimText, setInterimText] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [hasMediaSupport, setHasMediaSupport] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<HTMLDivElement>(null);

  // Mutable refs for active state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerIntRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const volFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Queue state
  const transCacheRef = useRef<Map<string, string>>(new Map());
  const transQueueRef = useRef<{ id: number; text: string }[]>([]);
  const processingQueueRef = useRef(false);

  // Expose current live state for callbacks
  const liveRef = useRef(isLive);
  useEffect(() => {
    liveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    const hasMedia = !!(navigator.mediaDevices && window.MediaRecorder);
    if (!hasMedia) {
      setHasMediaSupport(false);
    }
    drawOfflineViz();
    return () => {
      stopAll();
    };
  }, []);

  const showToast = (m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(""), 2200);
  };

  const drawOfflineViz = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    const bars = 48,
      bw = r.width / bars,
      gap = 2,
      h = r.height;
    ctx.clearRect(0, 0, r.width, r.height);
    for (let i = 0; i < bars; i++) {
      ctx.fillStyle = "rgba(196,245,66,.1)";
      ctx.beginPath();
      ctx.roundRect(
        i * bw + gap / 2,
        (h - (2 + Math.sin(i * 0.35) * 0.8)) / 2,
        bw - gap,
        2 + Math.sin(i * 0.35) * 0.8,
        2
      );
      ctx.fill();
    }
  };

  const setupViz = (stream: MediaStream) => {
    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new ACtx();
    analyserRef.current = audioCtxRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    analyserRef.current.smoothingTimeConstant = 0.8;
    audioCtxRef.current.createMediaStreamSource(stream).connect(analyserRef.current);
    drawViz();
  };

  const drawViz = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.scale(dpr, dpr);
    const buf = analyser.frequencyBinCount;
    const data = new Uint8Array(buf);
    const w = r.width;
    const h = r.height;

    const loop = () => {
      animFrameRef.current = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, w, h);
      const bars = 48,
        bw = w / bars,
        gap = 2;
      for (let i = 0; i < bars; i++) {
        const v = data[Math.floor((i * buf) / bars)] / 255;
        const bh = Math.max(2, v * h * 0.88);
        const a = 0.1 + v * 0.9;
        ctx.fillStyle = liveRef.current
          ? `rgba(255,77,77,${a})`
          : `rgba(196,245,66,${a * 0.35})`;
        ctx.beginPath();
        ctx.roundRect(i * bw + gap / 2, (h - bh) / 2, bw - gap, bh, Math.min((bw - gap) / 2, 3));
        ctx.fill();
      }
    };
    loop();
  };

  const stopViz = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (volFrameRef.current) cancelAnimationFrame(volFrameRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    drawOfflineViz();
  };

  const translateText = async (text: string, from: string, to: string) => {
    const key = `${from}|${to}|${text}`;
    if (transCacheRef.current.has(key)) return transCacheRef.current.get(key)!;
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${from}|${to}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        let t = data.responseData.translatedText;
        if (t.toUpperCase() === text.toUpperCase()) {
          transCacheRef.current.set(key, text);
          return text;
        }
        transCacheRef.current.set(key, t);
        return t;
      }
    } catch (e) {
      console.warn("Translation error:", e);
    }
    return text;
  };

  const processTransQueue = async () => {
    processingQueueRef.current = true;
    while (transQueueRef.current.length > 0) {
      const item = transQueueRef.current.shift();
      if (!item) continue;
      const { id, text } = item;
      const srcApi = LANGS[sourceLangCode]?.api || "pt-BR";

      const results = await Promise.all(TARGETS.map((t) => translateText(text, srcApi, t.api)));

      setLines((prev) => {
        const next = [...prev];
        const idx = next.findIndex((l) => l.id === id);
        if (idx > -1) {
          next[idx] = { ...next[idx], en: results[0], es: results[1] };
        }
        return next;
      });

      if (transQueueRef.current.length > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    processingQueueRef.current = false;
  };

  const addFinalLine = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInterimText("");
    
    setLines((prev) => {
      const id = prev.length;
      const newLine: TrLine = { id, original: trimmed, en: null, es: null };
      transQueueRef.current.push({ id, text: trimmed });
      if (!processingQueueRef.current) {
        Promise.resolve().then(processTransQueue);
      }
      return [...prev, newLine];
    });
  };

  const showInterim = (text: string) => {
    setInterimText(text);
  };

  const startAll = async () => {
    if (!hasMediaSupport) {
      showToast("Navegador não suportado.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: mime });
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach((t) => t.stop());

        // Process transcription via Fluxora API
        showInterim("Transcrevendo com IA...");
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const res = await (window as any).fluxora.voice.transcribe({
            audio: arrayBuffer,
            mimeType: blob.type,
            language: sourceLangCode,
          });
          if (res && res.text) {
            addFinalLine(res.text);
          } else {
            setInterimText("");
          }
        } catch (err) {
          console.error("Transcription error:", err);
          setInterimText("");
          showToast("Erro ao transcrever áudio");
        }
      };
      mediaRecorderRef.current.start(200);

      setupViz(stream);

      setIsLive(true);
      setAudioUrl(null);
      setSeconds(0);
      if (timerIntRef.current) clearInterval(timerIntRef.current);
      timerIntRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error(e);
      showToast("Erro ao acessar microfone");
    }
  };

  const stopAll = () => {
    setIsLive(false);
    if (timerIntRef.current) clearInterval(timerIntRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    stopViz();
  };

  const handleClear = () => {
    setLines([]);
    setInterimText("");
    setSeconds(0);
    setAudioUrl(null);
    showToast("Tudo limpo");
  };

  // Auto-scroll panels when lines or interim change
  useEffect(() => {
    const scrollBottom = (ref: React.RefObject<HTMLDivElement | null>) => {
      if (ref.current) {
        ref.current.scrollTop = ref.current.scrollHeight;
      }
    };
    scrollBottom(sourceRef);
    scrollBottom(enRef);
    scrollBottom(esRef);
  }, [lines, interimText]);

  const handleLangChange = (code: string) => {
    setSourceLangCode(code);
    if (isLive) {
      stopAll();
      showToast(`Idioma: ${LANGS[code]?.name}`);
    }
  };

  const dlBlob = (blob: Blob, name: string) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    URL.revokeObjectURL(u);
  };

  const handleCopy = () => {
    const t = lines.map((l) => l.original).join("\n");
    if (!t) {
      showToast("Nada para copiar");
      return;
    }
    navigator.clipboard.writeText(t).then(() => showToast("Original copiado"));
  };

  const handleExportTxt = () => {
    if (!lines.length) {
      showToast("Nada para exportar");
      return;
    }
    const srcName = LANGS[sourceLangCode]?.name || "Original";
    let txt = `=== Transcrição MiMo Voice ===\nFonte: ${srcName} | Duração: ${fmt(
      seconds
    )}\n${"─".repeat(36)}\n\n`;
    lines.forEach((l) => {
      txt += `[${srcName}] ${l.original}\n`;
      if (l.en) txt += `[English] ${l.en}\n`;
      if (l.es) txt += `[Español] ${l.es}\n`;
      txt += "\n";
    });
    dlBlob(new Blob([txt], { type: "text/plain;charset=utf-8" }), `transcricao-${Date.now()}.txt`);
    showToast("Arquivo .txt baixado");
  };

  const handleExportJson = () => {
    if (!lines.length) {
      showToast("Nada para exportar");
      return;
    }
    const data = {
      source: sourceLangCode,
      duration: fmt(seconds),
      timestamp: new Date().toISOString(),
      lines: lines.map((l) => ({
        original: l.original,
        english: l.en,
        espanol: l.es,
      })),
    };
    dlBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `transcricao-${Date.now()}.json`
    );
    showToast("Arquivo .json baixado");
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `mimo-${Date.now()}.webm`;
    a.click();
    showToast("Áudio baixado");
  };

  return (
    <div className="flex flex-col h-full bg-bg-deep text-text-primary p-6 gap-5 overflow-hidden w-full max-h-screen">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <div className="w-4 h-4 bg-accent rounded-sm shadow-[0_0_10px_rgba(196,245,66,0.3)]"></div>
          MiMo Voice <span className="text-sm font-medium text-text-muted">/ Fluxora</span>
        </h1>
        <select
          value={sourceLangCode}
          onChange={(e) => handleLangChange(e.target.value)}
          className="flux-input py-1.5 px-3 text-sm rounded-full bg-bg-card border-border-subtle hover:border-border transition-colors outline-none"
        >
          {Object.entries(LANGS).map(([code, l]) => (
            <option key={code} value={code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {!hasMediaSupport && (
        <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg text-sm shrink-0">
          Seu navegador não suporta Gravação de Áudio nativa (MediaRecorder API).
        </div>
      )}

      {/* Control Panel */}
      <div className="grid grid-cols-[300px_1fr] gap-4 shrink-0">
        <div className="bg-bg-card border border-border rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-text-muted font-bold">
              Sinal
            </span>
            {isLive && (
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-error font-bold">
                <span className="w-1.5 h-1.5 bg-error rounded-full animate-pulse"></span>
                Ao Vivo
              </span>
            )}
          </div>
          <canvas ref={canvasRef} className="w-full h-[60px]" />
          <div className="flex items-center justify-between mt-auto">
            <div className="font-mono text-3xl font-light tracking-wide text-text-primary">{fmt(seconds)}</div>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                title="Limpar"
                className="w-10 h-10 rounded-full bg-bg-input border border-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => (isLive ? stopAll() : startAll())}
                disabled={!hasMediaSupport}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-bg-deep transition-transform active:scale-95 ${
                  isLive
                    ? "bg-error shadow-[0_0_20px_rgba(255,77,77,0.4)]"
                    : "bg-accent shadow-[0_0_20px_rgba(196,245,66,0.2)] hover:scale-105"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isLive ? <Square fill="currentColor" size={20} /> : <Mic fill="currentColor" size={24} />}
              </button>
              <button
                onClick={handleDownloadAudio}
                disabled={!audioUrl}
                title="Baixar áudio"
                className="w-10 h-10 rounded-full bg-bg-input border border-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Download size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-end justify-end gap-3 pb-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-bg-card border border-border rounded-full text-xs font-mono text-text-secondary hover:text-text-primary hover:border-border-subtle transition-colors"
          >
            <Copy size={12} /> Copiar tudo
          </button>
          <button
            onClick={handleExportTxt}
            className="flex items-center gap-2 px-4 py-2 bg-bg-card border border-border rounded-full text-xs font-mono text-text-secondary hover:text-text-primary hover:border-border-subtle transition-colors"
          >
            <FileText size={12} /> .txt
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-2 px-4 py-2 bg-bg-card border border-border rounded-full text-xs font-mono text-text-secondary hover:text-text-primary hover:border-border-subtle transition-colors"
          >
            <Code size={12} /> .json
          </button>
        </div>
      </div>

      {/* Translation Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Source Panel */}
        <div className="bg-bg-card border border-success/30 flex flex-col rounded-xl overflow-hidden min-h-0 shadow-sm">
          <div className="px-4 py-3 border-b border-success/20 flex items-center justify-between bg-success/5 shrink-0">
            <div className="flex items-center gap-2 font-semibold text-sm text-text-primary">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              {LANGS[sourceLangCode]?.name || "Original"}
            </div>
            <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-mono tracking-wider font-bold">
              ORIGINAL
            </span>
          </div>
          <div ref={sourceRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {lines.length === 0 && !interimText && (
              <div className="h-full flex flex-col items-center justify-center text-text-muted/50 gap-2 font-serif italic text-sm">
                <Mic size={20} className="opacity-50" /> Aguardando áudio...
              </div>
            )}
            {lines.map((l) => (
              <div key={`s-${l.id}`} className="p-3 rounded-lg bg-bg-deep border-l-2 border-success shadow-sm">
                <div className="text-[10px] text-text-muted mb-1 font-mono">{fmt(seconds)}</div>
                <div className="text-sm leading-relaxed text-text-secondary">{l.original}</div>
              </div>
            ))}
            {interimText && (
              <div className="px-3 py-2 border-l-2 border-text-muted/40">
                <div className="text-[10px] text-text-muted mb-1 font-mono uppercase tracking-wider">Agora</div>
                <div className="text-sm leading-relaxed text-text-muted italic flex items-center flex-wrap">
                  {interimText}
                  <span className={`inline-block w-1.5 h-3 ml-1.5 rounded-sm ${isLive ? "bg-error animate-pulse" : "bg-accent"}`}></span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* English Panel */}
        <div className="bg-bg-card border border-info/30 flex flex-col rounded-xl overflow-hidden min-h-0 shadow-sm">
          <div className="px-4 py-3 border-b border-info/20 flex items-center justify-between bg-info/5 shrink-0">
            <div className="flex items-center gap-2 font-semibold text-sm text-text-primary">
              <span className="w-2 h-2 rounded-full bg-info"></span>
              English
            </div>
            <span className="px-2 py-0.5 rounded-full bg-info/10 text-info text-[10px] font-mono tracking-wider font-bold">
              TRADUÇÃO
            </span>
          </div>
          <div ref={enRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {lines.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-text-muted/50 gap-2 font-serif italic text-sm">
                Aguardando áudio...
              </div>
            )}
            {lines.map((l) => (
              <div key={`en-${l.id}`} className="p-3 rounded-lg bg-bg-deep border-l-2 border-info shadow-sm">
                <div className="text-[10px] text-text-muted mb-1 font-mono">{fmt(seconds)}</div>
                <div className="text-sm leading-relaxed text-text-secondary">
                  {l.en ? l.en : <span className="animate-pulse text-info/50 text-xl leading-none">...</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Spanish Panel */}
        <div className="bg-bg-card border border-warning/30 flex flex-col rounded-xl overflow-hidden min-h-0 shadow-sm">
          <div className="px-4 py-3 border-b border-warning/20 flex items-center justify-between bg-warning/5 shrink-0">
            <div className="flex items-center gap-2 font-semibold text-sm text-text-primary">
              <span className="w-2 h-2 rounded-full bg-warning"></span>
              Español
            </div>
            <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-mono tracking-wider font-bold">
              TRADUÇÃO
            </span>
          </div>
          <div ref={esRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {lines.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-text-muted/50 gap-2 font-serif italic text-sm">
                Aguardando áudio...
              </div>
            )}
            {lines.map((l) => (
              <div key={`es-${l.id}`} className="p-3 rounded-lg bg-bg-deep border-l-2 border-warning shadow-sm">
                <div className="text-[10px] text-text-muted mb-1 font-mono">{fmt(seconds)}</div>
                <div className="text-sm leading-relaxed text-text-secondary">
                  {l.es ? l.es : <span className="animate-pulse text-warning/50 text-xl leading-none">...</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-text-primary text-bg-deep px-5 py-2.5 rounded-full text-xs font-mono font-bold shadow-2xl animate-in fade-in slide-in-from-bottom-4 z-50 transition-all">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
