import type { Agent, InitializeRequest, InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse, CancelNotification, SetSessionModeRequest, SetSessionModeResponse } from "@agentclientprotocol/sdk";

export interface SessionState {
  id: string;
  cwd?: string;
  modeId: "default" | "plan";
  cancelled: boolean;
  resumeId?: string;
  createdAt: number;
  lastActivity: number;
}

export interface RetryContext {
  operation: "prompt" | "tool" | "auth";
  sessionId?: string;
}

export interface AcpToolUpdate {
  sessionId: string;
  toolCallId: string;
  title?: string;
  kind?: "read" | "edit" | "search" | "execute" | "other";
  status: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: string;
  rawOutput?: string;
  locations?: Array<{ path: string; line?: number }>;
  content?: Array<{ type: "content" | "diff"; content?: any }>;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
}

export interface CursorUsageStats {
  totalPrompts: number;
  totalTokens: number;
  totalDuration: number;
  modelBreakdown: Record<string, { count: number; tokens: number }>;
}

export interface CursorAgentStatus {
  healthy: boolean;
  version?: string;
  logged_in: boolean;
}

export interface CursorModel {
  id: string;
  name: string;
  description?: string;
}

export interface PromptMetrics {
  sessionId: string;
  model: string;
  promptTokens: number;
  toolCalls: number;
  duration: number;
  timestamp: number;
}

export interface AggregateMetrics {
  totalPrompts: number;
  totalToolCalls: number;
  totalDuration: number;
  avgDuration: number;
}
