import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// Tipos
// ============================================================

export type WebSpeechStatus = "idle" | "starting" | "listening" | "stopping" | "error";

export interface UseWebSpeechResult {
  status: WebSpeechStatus;
  isLive: boolean;
  error?: string;
  /** Texto provisório (interim) que está sendo reconhecido agora. */
  interim: string;
  /** Versão incrementada a cada resultado final. Use para detectar mudanças. */
  finalVersion: number;
  /** Texto acumulado de todos os resultados finais. */
  finalText: string;
  /** Inicia o reconhecimento (não bloqueia — retorna assim que `start()` for chamado). */
  start: (lang: string) => void;
  /** Para o reconhecimento (definitivamente). */
  stop: () => void;
  /** Limpa o estado (finalText, interim, error). */
  clear: () => void;
  /** Indica se o ambiente tem a API disponível. */
  isSupported: boolean;
}

// ============================================================
// Constantes
// ============================================================

/** Erros transitórios do Web Speech que devem causar auto-restart. */
const TRANSIENT_ERRORS = new Set([
  "no-speech",    // Nenhuma fala detectada
  "aborted",      // Cancelado por outra start()
]);

/** Erros fatais que param o reconhecimento definitivamente. */
const FATAL_ERRORS = new Set([
  "network",          // Falha de rede / Falta de API Key no Chromium (sempre falha no Electron sem chave)
  "not-allowed",      // Permissão negada
  "service-not-allowed",
  "audio-capture",    // Sem microfone
]);

// ============================================================
// Hook
// ============================================================

/**
 * Hook que encapsula `webkitSpeechRecognition` com:
 * - Interim em tempo real (callback + state)
 * - Auto-restart em erros transitórios (ex.: "network" no Electron)
 * - Cleanup automático
 *
 * Inspirado no HTML anexado: não rejeita no primeiro erro, tenta de novo.
 */
export function useWebSpeech(): UseWebSpeechResult {
  const [status, setStatus] = useState<WebSpeechStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [finalVersion, setFinalVersion] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  // Refs (para usar dentro de callbacks sem recriar)
  const recognitionRef = useRef<any | null>(null);
  const isLiveRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLangRef = useRef<string>("pt-BR");
  const restartCountRef = useRef(0);

  // Detectar suporte na montagem
  useEffect(() => {
    if (typeof window === "undefined") {
      setIsSupported(false);
      return;
    }
    const w = window as any;
    setIsSupported(typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function");
  }, []);

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      isLiveRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onstart = null;
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // ============================================================
  // Cria nova instância do recognition
  // ============================================================
  const createRecognition = useCallback((lang: string): any | null => {
    if (typeof window === "undefined") return null;
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = lang;
    return rec;
  }, []);

  // ============================================================
  // Tenta iniciar o recognition
  // ============================================================
  const tryStart = useCallback(() => {
    if (!isLiveRef.current) return;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch {
        // Já está rodando ou erro — recriar
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    }
    const rec = createRecognition(currentLangRef.current);
    if (!rec) {
      setError("Web Speech API não disponível neste ambiente.");
      setStatus("error");
      isLiveRef.current = false;
      setIsLive(false);
      return;
    }
    recognitionRef.current = rec;

    rec.onstart = () => {
      setStatus("listening");
      setError(undefined);
    };

    rec.onresult = (event: any) => {
      let interimText = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || "";
        if (!transcript) continue;
        if (result.isFinal) {
          newFinal = newFinal ? `${newFinal} ${transcript}`.trim() : transcript;
        } else {
          interimText = interimText ? `${interimText} ${transcript}`.trim() : transcript;
        }
      }
      if (interimText) setInterim(interimText);
      if (newFinal) {
        setFinalText((prev) => (prev ? `${prev} ${newFinal}`.trim() : newFinal));
        setFinalVersion((v) => v + 1);
        setInterim("");
      }
    };

    rec.onerror = (event: any) => {
      const code = event?.error || "unknown";
      // Não fazer nada em erros transitórios — deixa o onend re-iniciar
      if (TRANSIENT_ERRORS.has(code)) {
        console.warn(`[WebSpeech] erro transitório "${code}", será reiniciado em onend`);
        return;
      }
      if (FATAL_ERRORS.has(code)) {
        const msg =
          code === "not-allowed"
            ? "Permissão de microfone negada. Permita o acesso no sistema."
            : code === "audio-capture"
            ? "Não foi possível capturar áudio do microfone."
            : `Erro de reconhecimento: ${code}`;
        setError(msg);
        setStatus("error");
        isLiveRef.current = false;
        setIsLive(false);
        return;
      }
      // Outros erros: log silencioso
      console.warn(`[WebSpeech] erro ignorado: ${code}`);
    };

    rec.onend = () => {
      // Se ainda estamos "live", reinicia automaticamente após pequeno delay
      if (isLiveRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        // Backoff exponencial simples para não martelar a API
        const delay = Math.min(2000, 100 + restartCountRef.current * 200);
        restartCountRef.current++;
        restartTimerRef.current = setTimeout(() => {
          if (isLiveRef.current) tryStart();
        }, delay);
      } else {
        setStatus("idle");
      }
    };

    try {
      rec.start();
    } catch (err) {
      console.warn("[WebSpeech] start() falhou:", err);
    }
  }, [createRecognition]);

  // ============================================================
  // API pública
  // ============================================================
  const start = useCallback(
    (lang: string) => {
      if (isLiveRef.current) return;
      if (typeof window === "undefined") return;
      const w = window as any;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!SR) {
        setError("Web Speech API não disponível neste ambiente.");
        setStatus("error");
        return;
      }
      currentLangRef.current = lang;
      restartCountRef.current = 0;
      isLiveRef.current = true;
      setIsLive(true);
      setError(undefined);
      setStatus("starting");
      tryStart();
    },
    [tryStart],
  );

  const stop = useCallback(() => {
    isLiveRef.current = false;
    setIsLive(false);
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onstart = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setStatus("idle");
    setInterim("");
  }, []);

  const clear = useCallback(() => {
    setFinalText("");
    setFinalVersion((v) => v + 1);
    setInterim("");
    setError(undefined);
  }, []);

  return {
    status,
    isLive,
    error,
    interim,
    finalVersion,
    finalText,
    start,
    stop,
    clear,
    isSupported,
  };
}
