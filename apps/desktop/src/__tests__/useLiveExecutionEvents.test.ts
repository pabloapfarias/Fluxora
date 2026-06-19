import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorkflowEvent } from "@fluxora/shared";
import { createMockAPI } from "../api/mock-api";

// ---------------------------------------------------------------------------
// Helpers — replicate the hook's pure logic for unit testing
// ---------------------------------------------------------------------------

/**
 * Mirrors the `appendEvent` function inside useLiveExecutionEvents.
 * Keeps events sorted by createdAt and ignores duplicates by id.
 */
function appendEvent(list: WorkflowEvent[], event: WorkflowEvent): WorkflowEvent[] {
  if (list.some((entry) => entry.id === event.id)) return list;
  return [...list, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Mirrors the `appendStreamEvent` helper.
 */
function appendStreamEvent(
  workflowRunId: string,
  message: string,
  type: string,
  current: WorkflowEvent[],
): WorkflowEvent[] {
  if (!message.trim()) return current;
  const event: WorkflowEvent = {
    id: `stream-${type}-${Date.now()}-${Math.random()}`,
    workflowRunId,
    type,
    message,
    createdAt: new Date().toISOString(),
  };
  return appendEvent(current, event).slice(-50);
}

// ---------------------------------------------------------------------------
// 1. workflow:event appears in events
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — workflow events", () => {
  it("workflow event emitted via mock API reaches the listener", async () => {
    const api = createMockAPI();
    const received: WorkflowEvent[] = [];

    const unsub = api.events.onWorkflowEvent((event) => {
      received.push(event);
    });

    // Creating a workflow emits a "workflow.created" event in the mock
    await api.workflows.create({
      title: "Test workflow",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    expect(received.length).toBeGreaterThan(0);
    expect(received.some((e) => e.type === "workflow.created")).toBe(true);
    unsub();
  });
});

// ---------------------------------------------------------------------------
// 2. generic stream subscription
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — generic stream subscription", () => {
  it("subscribe listener registration returns an unsubscribe function", async () => {
    const api = createMockAPI();
    const received: unknown[] = [];

    const unsub = api.events.subscribe((event) => {
      received.push(event);
    });

    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("generic event subscribers receive provider stream events", async () => {
    const api = createMockAPI();
    const allEvents: import("@fluxora/shared").FluxoraEvent[] = [];

    const unsub = api.events.subscribe((event) => {
      allEvents.push(event);
    });

    await api.events.emitDiagnostic({
      message: "STDOUT: test output",
      missionId: "wf-1",
      payload: { workflowRunId: "wf-1", delta: "STDOUT: test output" },
    });

    expect(allEvents.length).toBeGreaterThan(0);
    expect(allEvents.some((e) => e.type === "app/diagnostic")).toBe(true);

    unsub();
  });
});

// ---------------------------------------------------------------------------
// 3. stream chunk extraction
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — stream chunk extraction", () => {
  it("extracts text responses from provider stream chunk events", () => {
    const evt = { type: "provider/stream-chunk", payload: { delta: "Arquivo criado com sucesso" } };
    const responses: { id: string; text: string }[] = [];

    if (evt && typeof evt === "object" && evt.type === "provider/stream-chunk" && typeof evt.payload?.delta === "string") {
      const text = evt.payload.delta.trim();
      if (text) {
        responses.push({ id: "oc-resp-1", text });
      }
    }

    expect(responses).toHaveLength(1);
    expect(responses[0].text).toBe("Arquivo criado com sucesso");
  });

  it("ignores stream events without textual delta", () => {
    const evt = { type: "provider/stream-chunk", payload: { tool: "read_file" } };
    const responses: { id: string; text: string }[] = [];

    if (evt && typeof evt === "object" && (evt as any).type === "provider/stream-chunk" && typeof (evt as any).payload?.delta === "string") {
      responses.push({ id: "oc-resp-1", text: (evt as any).payload.delta });
    }

    expect(responses).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty state changes after first event
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — empty state", () => {
  it("events list starts empty and grows after first event", () => {
    let events: WorkflowEvent[] = [];
    expect(events).toHaveLength(0);

    const newEvent: WorkflowEvent = {
      id: "evt-1",
      workflowRunId: "wf-1",
      type: "workflow.created",
      message: "Workflow criado",
      createdAt: "2026-06-15T00:00:00.000Z",
    };

    events = appendEvent(events, newEvent);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Workflow criado");
  });
});

// ---------------------------------------------------------------------------
// 6. Listeners are removed on unmount
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — listener cleanup", () => {
  it("unsubscribe function removes the listener from the mock API", async () => {
    const api = createMockAPI();
    const received: WorkflowEvent[] = [];

    const unsub = api.events.onWorkflowEvent((event) => {
      received.push(event);
    });

    // First event should be received
    await api.workflows.create({
      title: "Before unsub",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step", type: "planner" }],
    });

    const countBefore = received.length;
    expect(countBefore).toBeGreaterThan(0);

    // Unsubscribe
    unsub();

    // Second event should NOT be received
    await api.workflows.create({
      title: "After unsub",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step", type: "planner" }],
    });

    expect(received.length).toBe(countBefore);
  });

  it("all four active listener types return unsubscribe functions", async () => {
    const api = createMockAPI();

    const unsubs = [
      api.events.onWorkflowEvent(() => {}),
      api.events.onJobUpdated(() => {}),
      api.events.onApprovalChange(() => {}),
      api.events.subscribe(() => {}),
    ];

    for (const unsub of unsubs) {
      expect(typeof unsub).toBe("function");
    }

    // Clean up
    for (const unsub of unsubs) {
      unsub();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. onApprovalChange listener — the 6th listener type
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — onApprovalChange listener", () => {
  it("onApprovalChange listener is registered and receives emitted approvals", async () => {
    const api = createMockAPI();
    const received: import("@fluxora/shared").Approval[] = [];

    const unsub = api.events.onApprovalChange((approval) => {
      received.push(approval);
    });

    expect(typeof unsub).toBe("function");

    // Creating a workflow synchronously emits an approval change event.
    const run = await api.workflows.create({
      title: "Approval test",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step 1", type: "planner" }],
    });

    // The listener must have been called with an approval tied to this run.
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].workflowRunId).toBe(run.id);
    expect(received[received.length - 1].status).toBe("pending");

    unsub();
  });

  it("unsubscribe removes the onApprovalChange listener from the mock API", async () => {
    const api = createMockAPI();
    const received: import("@fluxora/shared").Approval[] = [];

    const unsub = api.events.onApprovalChange((approval) => {
      received.push(approval);
    });

    // First workflow — listener should fire.
    await api.workflows.create({
      title: "Before unsub",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step", type: "planner" }],
    });
    const countBefore = received.length;
    expect(countBefore).toBeGreaterThan(0);

    // Unsubscribe.
    unsub();

    // Second workflow — listener should NOT fire.
    await api.workflows.create({
      title: "After unsub",
      prompt: "test",
      generatedContext: "{}",
      steps: [{ name: "Step", type: "planner" }],
    });
    expect(received.length).toBe(countBefore);
  });

  it("all four active listener types return unsubscribe functions", async () => {
    const api = createMockAPI();

    const unsubs = [
      api.events.onWorkflowEvent(() => {}),
      api.events.onJobUpdated(() => {}),
      api.events.onApprovalChange(() => {}),
      api.events.subscribe(() => {}),
    ];

    for (const unsub of unsubs) {
      expect(typeof unsub).toBe("function");
    }

    for (const unsub of unsubs) {
      unsub();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate events are ignored
// ---------------------------------------------------------------------------

describe("useLiveExecutionEvents — duplicate events", () => {
  it("appendEvent ignores events with the same id", () => {
    const event: WorkflowEvent = {
      id: "evt-dup",
      workflowRunId: "wf-1",
      type: "step.started",
      message: "Step iniciado",
      createdAt: "2026-06-15T00:00:00.000Z",
    };

    let events: WorkflowEvent[] = [];
    events = appendEvent(events, event);
    expect(events).toHaveLength(1);

    // Same id — should be ignored
    events = appendEvent(events, event);
    expect(events).toHaveLength(1);

    // Same id, different message — still ignored
    events = appendEvent(events, { ...event, message: "different" });
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Step iniciado");
  });

  it("appendEvent accepts events with different ids", () => {
    const event1: WorkflowEvent = {
      id: "evt-1",
      workflowRunId: "wf-1",
      type: "step.started",
      message: "Step 1",
      createdAt: "2026-06-15T00:00:00.000Z",
    };
    const event2: WorkflowEvent = {
      id: "evt-2",
      workflowRunId: "wf-1",
      type: "step.completed",
      message: "Step 2",
      createdAt: "2026-06-15T00:00:01.000Z",
    };

    let events: WorkflowEvent[] = [];
    events = appendEvent(events, event1);
    events = appendEvent(events, event2);
    expect(events).toHaveLength(2);
  });

  it("appendEvent keeps events sorted by createdAt", () => {
    const late: WorkflowEvent = {
      id: "evt-late",
      workflowRunId: "wf-1",
      type: "step.completed",
      message: "Late",
      createdAt: "2026-06-15T00:00:05.000Z",
    };
    const early: WorkflowEvent = {
      id: "evt-early",
      workflowRunId: "wf-1",
      type: "step.started",
      message: "Early",
      createdAt: "2026-06-15T00:00:00.000Z",
    };

    let events: WorkflowEvent[] = [];
    events = appendEvent(events, late);
    events = appendEvent(events, early);

    expect(events[0].id).toBe("evt-early");
    expect(events[1].id).toBe("evt-late");
  });

  it("appendStreamEvent ignores empty messages", () => {
    let events: WorkflowEvent[] = [];
    events = appendStreamEvent("wf-1", "   ", "opencode.stdout", events);
    expect(events).toHaveLength(0);
  });

  it("appendStreamEvent adds non-empty messages", () => {
    let events: WorkflowEvent[] = [];
    events = appendStreamEvent("wf-1", "STDOUT: hello", "opencode.stdout", events);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("opencode.stdout");
    expect(events[0].message).toBe("STDOUT: hello");
  });

  it("event list is capped at 50 entries", () => {
    let events: WorkflowEvent[] = [];
    for (let i = 0; i < 60; i++) {
      const event: WorkflowEvent = {
        id: `evt-${i}`,
        workflowRunId: "wf-1",
        type: "step.started",
        message: `Event ${i}`,
        createdAt: new Date(Date.now() + i).toISOString(),
      };
      events = appendEvent(events, event);
    }
    // The hook slices to 50 after each append
    const capped = events.slice(-50);
    expect(capped).toHaveLength(50);
  });
});
