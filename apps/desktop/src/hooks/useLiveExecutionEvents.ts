import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
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

/**
 * Hook that registers IPC listeners for real-time execution events,
 * manages active run/job state, and extracts OpenCode text responses.
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

    const unsubscribeStdout = window.fluxora.events.onOpenCodeStdout((payload) => {
      appendStreamEvent(payload.workflowRunId, `STDOUT: ${payload.chunk}`, "opencode.stdout", setEvents);
    });

    const unsubscribeStderr = window.fluxora.events.onOpenCodeStderr((payload) => {
      appendStreamEvent(payload.workflowRunId, `STDERR: ${payload.chunk}`, "opencode.stderr", setEvents);
    });

    const unsubscribeJson = window.fluxora.events.onOpenCodeJsonEvent((payload) => {
      appendStreamEvent(payload.workflowRunId, JSON.stringify(payload.event), "opencode.json_event", setEvents);

      // Extract text responses from OpenCode json events
      const evt = payload.event as Record<string, unknown> | undefined;
      if (evt && typeof evt === "object" && evt.type === "text" && typeof evt.text === "string") {
        const text = evt.text.trim();
        if (text) {
          responseCounter.current += 1;
          const response: OpenCodeResponse = {
            id: `oc-resp-${responseCounter.current}-${Date.now()}`,
            workflowRunId: payload.workflowRunId,
            text,
            createdAt: new Date().toISOString(),
          };
          setOpencodeResponses((prev) => [...prev, response]);
        }
      }
    });

    return () => {
      unsubscribeEvents();
      unsubscribeJobs();
      unsubscribeStdout();
      unsubscribeStderr();
      unsubscribeJson();
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
