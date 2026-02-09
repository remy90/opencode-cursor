import type { ToolUpdate, ToolMapper } from "../acp/tools.js";
import { extractOpenAiToolCall, type OpenAiToolCall } from "../proxy/tool-loop.js";
import type { StreamJsonToolCallEvent } from "../streaming/types.js";
import type { ToolRouter } from "../tools/router.js";
import type { ProviderBoundaryMode, ToolLoopMode } from "./boundary.js";
import type { ProviderBoundary } from "./boundary.js";

interface HandleToolLoopEventBaseOptions {
  event: StreamJsonToolCallEvent;
  toolLoopMode: ToolLoopMode;
  allowedToolNames: Set<string>;
  toolMapper: ToolMapper;
  toolSessionId: string;
  shouldEmitToolUpdates: boolean;
  proxyExecuteToolCalls: boolean;
  suppressConverterToolEvents: boolean;
  toolRouter?: ToolRouter;
  responseMeta: { id: string; created: number; model: string };
  onToolUpdate: (update: ToolUpdate) => Promise<void> | void;
  onToolResult: (toolResult: any) => Promise<void> | void;
  onInterceptedToolCall: (toolCall: OpenAiToolCall) => Promise<void> | void;
}

export interface HandleToolLoopEventLegacyOptions extends HandleToolLoopEventBaseOptions {}

export interface HandleToolLoopEventV1Options extends HandleToolLoopEventBaseOptions {
  boundary: ProviderBoundary;
}

export interface HandleToolLoopEventWithFallbackOptions
  extends HandleToolLoopEventV1Options {
  boundaryMode: ProviderBoundaryMode;
  autoFallbackToLegacy: boolean;
  onFallbackToLegacy?: (error: unknown) => void;
}

export interface HandleToolLoopEventResult {
  intercepted: boolean;
  skipConverter: boolean;
}

export class ToolBoundaryExtractionError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ToolBoundaryExtractionError";
    this.cause = cause;
  }
}

export async function handleToolLoopEventLegacy(
  options: HandleToolLoopEventLegacyOptions,
): Promise<HandleToolLoopEventResult> {
  const {
    event,
    toolLoopMode,
    allowedToolNames,
    toolMapper,
    toolSessionId,
    shouldEmitToolUpdates,
    proxyExecuteToolCalls,
    suppressConverterToolEvents,
    toolRouter,
    responseMeta,
    onToolUpdate,
    onToolResult,
    onInterceptedToolCall,
  } = options;

  const updates = await toolMapper.mapCursorEventToAcp(
    event,
    event.session_id ?? toolSessionId,
  );

  if (shouldEmitToolUpdates) {
    for (const update of updates) {
      await onToolUpdate(update);
    }
  }

  const interceptedToolCall =
    toolLoopMode === "opencode"
      ? extractOpenAiToolCall(event as any, allowedToolNames)
      : null;
  if (interceptedToolCall) {
    await onInterceptedToolCall(interceptedToolCall);
    return { intercepted: true, skipConverter: true };
  }

  if (toolRouter && proxyExecuteToolCalls) {
    const toolResult = await toolRouter.handleToolCall(event as any, responseMeta);
    if (toolResult) {
      await onToolResult(toolResult);
    }
  }

  return {
    intercepted: false,
    skipConverter: suppressConverterToolEvents,
  };
}

export async function handleToolLoopEventV1(
  options: HandleToolLoopEventV1Options,
): Promise<HandleToolLoopEventResult> {
  const {
    event,
    boundary,
    toolLoopMode,
    allowedToolNames,
    toolMapper,
    toolSessionId,
    shouldEmitToolUpdates,
    proxyExecuteToolCalls,
    suppressConverterToolEvents,
    toolRouter,
    responseMeta,
    onToolUpdate,
    onToolResult,
    onInterceptedToolCall,
  } = options;

  let interceptedToolCall: OpenAiToolCall | null;
  try {
    interceptedToolCall = boundary.maybeExtractToolCall(
      event,
      allowedToolNames,
      toolLoopMode,
    );
  } catch (error) {
    throw new ToolBoundaryExtractionError("Boundary tool extraction failed", error);
  }
  if (interceptedToolCall) {
    await onInterceptedToolCall(interceptedToolCall);
    return { intercepted: true, skipConverter: true };
  }

  const updates = await toolMapper.mapCursorEventToAcp(
    event,
    event.session_id ?? toolSessionId,
  );

  if (shouldEmitToolUpdates) {
    for (const update of updates) {
      await onToolUpdate(update);
    }
  }

  if (toolRouter && proxyExecuteToolCalls) {
    const toolResult = await toolRouter.handleToolCall(event as any, responseMeta);
    if (toolResult) {
      await onToolResult(toolResult);
    }
  }

  return {
    intercepted: false,
    skipConverter: suppressConverterToolEvents,
  };
}

export async function handleToolLoopEventWithFallback(
  options: HandleToolLoopEventWithFallbackOptions,
): Promise<HandleToolLoopEventResult> {
  const {
    boundaryMode,
    autoFallbackToLegacy,
    onFallbackToLegacy,
    ...shared
  } = options;

  if (boundaryMode === "legacy") {
    return handleToolLoopEventLegacy(shared);
  }

  try {
    return await handleToolLoopEventV1(shared);
  } catch (error) {
    if (
      !autoFallbackToLegacy
      || boundaryMode !== "v1"
      || !(error instanceof ToolBoundaryExtractionError)
    ) {
      throw error;
    }
    onFallbackToLegacy?.(error.cause ?? error);
    return handleToolLoopEventLegacy(shared);
  }
}
