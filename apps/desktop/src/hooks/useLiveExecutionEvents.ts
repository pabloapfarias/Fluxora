import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  FluxoraEvent,
  WorkflowEvent,
  WorkflowRun,
  BackgroundWorkflowJob,
} from "@fluxora/shared";
import { normalizeLogText } from "../lib/logFormatting";

export interface OpenCodeResponse {
  id: string;
  workflowRunId: string;
  text: string;
  createdAt: string;
}

export interface UseLiveExecutionEventsResult {
  events: WorkflowEvent[];
  setEvents: Dispatch<SetStateAction<WorkflowEvent[]>>;
  activeRun: WorkflowRun | null;
  setActiveRun: Dispatch<SetStateAction<WorkflowRun | null>>;
  activeJob: BackgroundWorkflowJob | null;
  setActiveJob: Dispatch<SetStateAction<BackgroundWorkflowJob | null>>;
  opencodeResponses: OpenCodeResponse[];
  isExecuting: boolean;
  clearEvents: () => void;
}

function isAfterCutoff(createdAt: string, cutoff: string | null): boolean {
  if (!cutoff) return true;
  return createdAt >= cutoff;
}

function appendEvent(list: WorkflowEvent[], event: WorkflowEvent): WorkflowEvent[] {
  if (list.some((entry) => entry.id === event.id)) return list;
  return [...list, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function appendStreamEvent(
  workflowRunId: string,
  message: string,
  type: string,
  setEvents: Dispatch<SetStateAction<WorkflowEvent[]>>,
): void {
  const normalized = normalizeLogText(message);
  if (!normalized) return;
  const event: WorkflowEvent = {
    id: `stream-${type}-${Date.now()}-${Math.random()}`,
    workflowRunId,
    type,
    message: normalized,
    createdAt: new Date().toISOString(),
  };
  setEvents((current) => appendEvent(current, event).slice(-50));
}

function workflowEventFromFluxora(event: FluxoraEvent): WorkflowEvent | null {
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : null;
  const workflowRunId =
    (typeof payload?.workflowRunId === "string" && payload.workflowRunId) ||
    (typeof event.missionId === "string" && event.missionId) ||
    undefined;
  const message =
    event.message ||
    (typeof payload?.delta === "string" ? payload.delta : undefined) ||
    event.type;
  const normalized = normalizeLogText(message);
  if (!normalized) return null;
  return {
    id: event.id,
    workflowRunId,
    projectId: event.projectId,
    type: event.type,
    message: normalized,
    metadata: payload ? JSON.stringify(payload) : undefined,
    createdAt: event.timestamp,
  };
}

/**
 * Hook that registers IPC listeners for real-time execution events,
 * manages active run/job state, and extracts streaming text responses.
 *
 * @param projectId - When provided, only events belonging to this project are kept.
 */
export function useLiveExecutionEvents(projectId?: string | null): UseLiveExecutionEventsResult {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const [activeJob, setActiveJob] = useState<BackgroundWorkflowJob | null>(null);
  const [opencodeResponses, setOpencodeResponses] = useState<OpenCodeResponse[]>([]);
  const responseCounter = useRef(0);
  const projectIdRef = useRef(projectId);
  const prevProjectIdRef = useRef(projectId);
  const clearedAtRef = useRef<string | null>(null);
  projectIdRef.current = projectId;

  // Filter helper: keep only events that belong to the active project (or all if no project)
  const belongsToProject = useCallback((event: WorkflowEvent) => {
    const pid = projectIdRef.current;
    if (!pid) return true; // no project filter — keep everything
    return event.projectId === pid;
  }, []);

  const shouldKeepEvent = useCallback((event: WorkflowEvent) => {
    return belongsToProject(event) && isAfterCutoff(event.createdAt, clearedAtRef.current);
  }, [belongsToProject]);

  // Clear all state when projectId changes to avoid stale data from previous project
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      clearedAtRef.current = null;
      setEvents([]);
      setOpencodeResponses([]);
      setActiveRun(null);
      setActiveJob(null);
    }
  }, [projectId]);

  // Load initial events on mount (and when projectId changes)
  useEffect(() => {
    let mounted = true;
    window.fluxora.events.list().then((e) => {
      if (mounted) {
        const filtered = e.filter(shouldKeepEvent);
        setEvents(filtered.slice(0, 50));
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [projectId, shouldKeepEvent]);

  // Register all IPC listeners
  useEffect(() => {
    const unsubscribeEvents = window.fluxora.events.onWorkflowEvent((event) => {
      if (!shouldKeepEvent(event)) return;
      setEvents((current) => appendEvent(current, event).slice(-50));
    });

    const unsubscribeJobs = window.fluxora.events.onJobUpdated((job) => {
      setActiveJob((current) => {
        if (["queued", "running"].includes(job.status)) return job;
        if (current?.id === job.id) return null;
        return current;
      });
    });

    const unsubscribeStream = window.fluxora.events.subscribe((event) => {
      const mapped = workflowEventFromFluxora(event);
      if (mapped && shouldKeepEvent(mapped)) {
        setEvents((current) => appendEvent(current, mapped).slice(-50));
      }

      if (event.type !== "agent/step-chunk" && event.type !== "provider/stream-chunk") return;
      const payload = event.payload as Record<string, unknown> | undefined;
      const text = typeof payload?.delta === "string" ? payload.delta.trim() : "";
      const workflowRunId =
        typeof payload?.workflowRunId === "string"
          ? payload.workflowRunId
          : typeof event.missionId === "string"
            ? event.missionId
            : "";
      if (!text || !workflowRunId) return;
      responseCounter.current += 1;
      const response: OpenCodeResponse = {
        id: `stream-resp-${responseCounter.current}-${Date.now()}`,
        workflowRunId,
        text,
        createdAt: new Date().toISOString(),
      };
      setOpencodeResponses((prev) => [...prev, response]);
    });

    return () => {
      unsubscribeEvents();
      unsubscribeJobs();
      unsubscribeStream();
    };
  }, [shouldKeepEvent]);

  // Poll events periodically as a fallback
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const e = await window.fluxora.events.list();
        const filtered = e.filter(shouldKeepEvent);
        setEvents(filtered.slice(0, 50));
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [projectId, shouldKeepEvent]);

  const isExecuting = Boolean(
    activeJob && ["queued", "running"].includes(activeJob.status)
  );

  const clearEvents = useCallback(() => {
    clearedAtRef.current = new Date().toISOString();
    setEvents([]);
    setOpencodeResponses([]);
    setActiveRun(null);
    setActiveJob(null);
  }, []);

  return {
    events,
    setEvents,
    activeRun,
    setActiveRun,
    activeJob,
    setActiveJob,
    opencodeResponses,
    isExecuting,
    clearEvents,
  };
}
