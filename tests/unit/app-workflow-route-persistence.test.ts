import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedDependencies = vi.hoisted(() => {
  const account = {
    id: "acct_test",
    displayName: "Avery",
    email: "avery@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    workflowId: "wf_test",
  };
  const workflow = {
    workflowId: account.workflowId,
    accountId: account.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stage: "profile",
    profile: null,
    confirmedRequest: null,
    research: null,
    ranking: null,
    quotes: null,
    recommendedQuoteId: null,
    handoff: null,
    negotiation: null,
  };
  const snapshot = { workflowId: workflow.workflowId, stage: workflow.stage };
  const events: string[] = [];
  let resolveSaveWorkflow: (() => void) | null = null;
  let saveWorkflowPromise = Promise.resolve();

  const requireContext = vi.fn();
  const jsonOk = vi.fn();
  const appErrorResponse = vi.fn();
  const runResearch = vi.fn();
  const collectQuotes = vi.fn();
  const negotiate = vi.fn();
  const startNegotiationCall = vi.fn();
  const attachConversation = vi.fn();
  const recordNegotiationEvent = vi.fn();
  const pollNegotiation = vi.fn();
  const toClientSnapshot = vi.fn();
  const reserveLiveCallStart = vi.fn();
  const saveWorkflow = vi.fn();

  function finishSaving(): void {
    resolveSaveWorkflow?.();
  }

  function reset(): void {
    events.splice(0, events.length);
    saveWorkflowPromise = new Promise<void>((resolve) => {
      resolveSaveWorkflow = resolve;
    });
    for (const mock of [
      requireContext,
      jsonOk,
      appErrorResponse,
      runResearch,
      collectQuotes,
      negotiate,
      startNegotiationCall,
      attachConversation,
      recordNegotiationEvent,
      pollNegotiation,
      reserveLiveCallStart,
      toClientSnapshot,
      saveWorkflow,
    ]) {
      mock.mockReset();
    }

    requireContext.mockResolvedValue({ account, workflow });
    jsonOk.mockImplementation((body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    appErrorResponse.mockImplementation((error: unknown) =>
      new Response(JSON.stringify({ error: String(error) }), { status: 500 }),
    );
    runResearch.mockImplementation(async () => events.push("runResearch"));
    collectQuotes.mockImplementation(async () => events.push("collectQuotes"));
    negotiate.mockImplementation(() => events.push("negotiate"));
    startNegotiationCall.mockImplementation(async () => {
      events.push("startNegotiationCall");
      return { credential: { token: "credential" }, dynamicVariables: {} };
    });
    attachConversation.mockImplementation(() => events.push("attachConversation"));
    recordNegotiationEvent.mockImplementation(() => events.push("recordNegotiationEvent"));
    pollNegotiation.mockImplementation(async () => {
      events.push("pollNegotiation");
      return true;
    });
    toClientSnapshot.mockReturnValue(snapshot);
    reserveLiveCallStart.mockResolvedValue(undefined);
    saveWorkflow.mockImplementation(async () => {
      events.push("saveWorkflow");
      await saveWorkflowPromise;
    });
  }

  return {
    account,
    appErrorResponse,
    attachConversation,
    collectQuotes,
    events,
    finishSaving,
    jsonOk,
    negotiate,
    pollNegotiation,
    reserveLiveCallStart,
    recordNegotiationEvent,
    requireContext,
    reset,
    runResearch,
    saveWorkflow,
    snapshot,
    startNegotiationCall,
    toClientSnapshot,
    workflow,
  };
});

vi.mock("@/app/api/app/_lib", () => ({
  requireContext: mockedDependencies.requireContext,
  jsonOk: mockedDependencies.jsonOk,
  appErrorResponse: mockedDependencies.appErrorResponse,
}));

vi.mock("@/backend/app/orchestrator", () => ({
  attachConversation: mockedDependencies.attachConversation,
  collectQuotes: mockedDependencies.collectQuotes,
  negotiate: mockedDependencies.negotiate,
  pollNegotiation: mockedDependencies.pollNegotiation,
  recordNegotiationEvent: mockedDependencies.recordNegotiationEvent,
  runResearch: mockedDependencies.runResearch,
  startNegotiationCall: mockedDependencies.startNegotiationCall,
  toClientSnapshot: mockedDependencies.toClientSnapshot,
}));

vi.mock("@/backend/app/store", () => ({
  reserveLiveCallStart: mockedDependencies.reserveLiveCallStart,
  saveWorkflow: mockedDependencies.saveWorkflow,
}));

type RouteModule = { POST: (request: Request) => Promise<Response> };

function jsonRequest(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/app/workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeCases: Array<{
  operation: { mock: { calls: unknown[][] } };
  operationName: string;
  request: () => Request;
  route: () => Promise<RouteModule>;
}> = [
  {
    operation: mockedDependencies.runResearch,
    operationName: "runResearch",
    request: () =>
      jsonRequest({ year: 2024, make: "Honda", model: "Civic", state: "MA", zipCode: "02139" }),
    route: () => import("@/app/api/app/research/route"),
  },
  {
    operation: mockedDependencies.collectQuotes,
    operationName: "collectQuotes",
    request: jsonRequest,
    route: () => import("@/app/api/app/quotes/route"),
  },
  {
    operation: mockedDependencies.negotiate,
    operationName: "negotiate",
    request: () => jsonRequest({ targetAmountCents: 125_000, selectedQuoteId: "quote_1" }),
    route: () => import("@/app/api/app/negotiate/route"),
  },
  {
    operation: mockedDependencies.startNegotiationCall,
    operationName: "startNegotiationCall",
    request: () => jsonRequest({ targetAmountCents: 125_000, selectedQuoteId: "quote_1" }),
    route: () => import("@/app/api/app/negotiate/call/start/route"),
  },
  {
    operation: mockedDependencies.attachConversation,
    operationName: "attachConversation",
    request: () => jsonRequest({ conversationId: "conversation_1" }),
    route: () => import("@/app/api/app/negotiate/call/connected/route"),
  },
  {
    operation: mockedDependencies.recordNegotiationEvent,
    operationName: "recordNegotiationEvent",
    request: () => jsonRequest({ finalCostCents: 120_000, providerResponse: "Approved" }),
    route: () => import("@/app/api/app/negotiate/call/event/route"),
  },
  {
    operation: mockedDependencies.pollNegotiation,
    operationName: "pollNegotiation",
    request: jsonRequest,
    route: () => import("@/app/api/app/negotiate/poll/route"),
  },
];

describe("app workflow route persistence", () => {
  beforeEach(() => {
    mockedDependencies.reset();
  });

  it.each(routeCases)("persists the workflow after $operationName succeeds", async (routeCase) => {
    const { POST } = await routeCase.route();
    let responseReturned = false;

    const responsePromise = POST(routeCase.request()).then((response) => {
      responseReturned = true;
      return response;
    });

    await vi.waitFor(() => expect(mockedDependencies.saveWorkflow).toHaveBeenCalledTimes(1));
    expect(responseReturned).toBe(false);
    mockedDependencies.finishSaving();

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ snapshot: mockedDependencies.snapshot });
    expect(routeCase.operation.mock.calls).toHaveLength(1);
    expect(mockedDependencies.saveWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedDependencies.saveWorkflow).toHaveBeenCalledWith(mockedDependencies.workflow);
    expect(mockedDependencies.events).toEqual([routeCase.operationName, "saveWorkflow"]);
  });
});
