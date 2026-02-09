import { describe, expect, it } from "bun:test";
import { createProviderBoundary } from "../../src/provider/boundary";
import {
  handleToolLoopEventLegacy,
  handleToolLoopEventV1,
  handleToolLoopEventWithFallback,
} from "../../src/provider/runtime-interception";

type EventOptions = Parameters<typeof handleToolLoopEventLegacy>[0];

function createBaseOptions(overrides: Partial<EventOptions> = {}): EventOptions {
  const updates: any[] = [];
  const toolResults: any[] = [];
  const intercepted: any[] = [];

  const event: any = {
    type: "tool_call",
    call_id: "c1",
    tool_call: {
      readToolCall: {
        args: { path: "foo.txt" },
      },
    },
  };

  const base: EventOptions = {
    event,
    toolLoopMode: "opencode",
    allowedToolNames: new Set(["read"]),
    toolMapper: {
      mapCursorEventToAcp: async () => updates,
    } as any,
    toolSessionId: "session-1",
    shouldEmitToolUpdates: false,
    proxyExecuteToolCalls: false,
    suppressConverterToolEvents: false,
    responseMeta: { id: "resp-1", created: 123, model: "auto" },
    onToolUpdate: async (update) => {
      updates.push(update);
    },
    onToolResult: async (toolResult) => {
      toolResults.push(toolResult);
    },
    onInterceptedToolCall: async (toolCall) => {
      intercepted.push(toolCall);
    },
  };

  return { ...base, ...overrides };
}

describe("provider runtime interception parity", () => {
  it("produces equivalent interception results for legacy and v1 in opencode mode", async () => {
    const legacyOptions = createBaseOptions();
    const v1Options = {
      ...createBaseOptions(),
      boundary: createProviderBoundary("v1", "cursor-acp"),
    };

    const legacyResult = await handleToolLoopEventLegacy(legacyOptions);
    const v1Result = await handleToolLoopEventV1(v1Options);

    expect(legacyResult).toEqual({ intercepted: true, skipConverter: true });
    expect(v1Result).toEqual(legacyResult);
  });

  it("produces equivalent proxy-exec passthrough behavior in legacy and v1", async () => {
    const updatesLegacy: any[] = [];
    const updatesV1: any[] = [];
    const resultsLegacy: any[] = [];
    const resultsV1: any[] = [];
    const toolResult = { id: "tool-result" };

    const event: any = {
      type: "tool_call",
      call_id: "c2",
      tool_call: {
        bashToolCall: {
          args: { command: "echo ok" },
        },
      },
    };

    const createOptions = (updates: any[], results: any[]): EventOptions => ({
      event,
      toolLoopMode: "proxy-exec",
      allowedToolNames: new Set(["read"]),
      toolMapper: {
        mapCursorEventToAcp: async () => [{ toolCallId: "u1", status: "pending" }],
      } as any,
      toolSessionId: "session-2",
      shouldEmitToolUpdates: true,
      proxyExecuteToolCalls: true,
      suppressConverterToolEvents: true,
      toolRouter: {
        handleToolCall: async () => toolResult,
      } as any,
      responseMeta: { id: "resp-2", created: 456, model: "auto" },
      onToolUpdate: async (update) => {
        updates.push(update);
      },
      onToolResult: async (result) => {
        results.push(result);
      },
      onInterceptedToolCall: async () => {
        throw new Error("should not intercept");
      },
    });

    const legacyResult = await handleToolLoopEventLegacy(createOptions(updatesLegacy, resultsLegacy));
    const v1Result = await handleToolLoopEventV1({
      ...createOptions(updatesV1, resultsV1),
      boundary: createProviderBoundary("v1", "cursor-acp"),
    });

    expect(legacyResult).toEqual({ intercepted: false, skipConverter: true });
    expect(v1Result).toEqual(legacyResult);
    expect(updatesLegacy.length).toBe(1);
    expect(updatesV1.length).toBe(1);
    expect(resultsLegacy).toEqual([toolResult]);
    expect(resultsV1).toEqual([toolResult]);
  });
});

describe("provider runtime interception fallback", () => {
  it("falls back from v1 to legacy when boundary extraction throws", async () => {
    let fallbackCalled = false;
    let mapperCalls = 0;
    let interceptedName = "";

    const boundary = createProviderBoundary("v1", "cursor-acp");
    const brokenBoundary = {
      ...boundary,
      maybeExtractToolCall() {
        throw new Error("boundary extraction failed");
      },
    };

    const result = await handleToolLoopEventWithFallback({
      ...createBaseOptions({
        toolMapper: {
          mapCursorEventToAcp: async () => {
            mapperCalls += 1;
            return [];
          },
        } as any,
        onInterceptedToolCall: async (toolCall) => {
          interceptedName = toolCall.function.name;
        },
      }),
      boundary: brokenBoundary as any,
      boundaryMode: "v1",
      autoFallbackToLegacy: true,
      onFallbackToLegacy: () => {
        fallbackCalled = true;
      },
    });

    expect(fallbackCalled).toBe(true);
    expect(mapperCalls).toBe(1);
    expect(interceptedName).toBe("read");
    expect(result).toEqual({ intercepted: true, skipConverter: true });
  });

  it("does not fallback for non-boundary errors", async () => {
    let fallbackCalled = false;
    const promise = handleToolLoopEventWithFallback({
      ...createBaseOptions({
        toolLoopMode: "proxy-exec",
        toolMapper: {
          mapCursorEventToAcp: async () => {
            throw new Error("mapper failure");
          },
        } as any,
      }),
      boundary: createProviderBoundary("v1", "cursor-acp"),
      boundaryMode: "v1",
      autoFallbackToLegacy: true,
      onFallbackToLegacy: () => {
        fallbackCalled = true;
      },
    });

    await expect(promise).rejects.toThrow("mapper failure");
    expect(fallbackCalled).toBe(false);
  });

  it("uses legacy path directly when boundary mode is legacy", async () => {
    const result = await handleToolLoopEventWithFallback({
      ...createBaseOptions(),
      boundary: createProviderBoundary("legacy", "cursor-acp"),
      boundaryMode: "legacy",
      autoFallbackToLegacy: true,
    });

    expect(result).toEqual({ intercepted: true, skipConverter: true });
  });
});
