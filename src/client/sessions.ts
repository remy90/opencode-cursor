import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { SessionState } from "./types.js";

interface PersistedSession {
  id: string;
  cwd?: string;
  modeId: "default" | "plan";
  resumeId?: string;
  createdAt: number;
  lastActivity: number;
}

class SessionStorage {
  private storageDir: string;

  constructor() {
    const homeDir = os.homedir();
    this.storageDir = path.join(homeDir, ".opencode", "sessions");
    fs.mkdir(this.storageDir, { recursive: true }).catch(() => {});
  }

  async save(session: PersistedSession): Promise<void> {
    const filePath = path.join(this.storageDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2));
  }

  async load(sessionId: string): Promise<PersistedSession | null> {
    const filePath = path.join(this.storageDir, `${sessionId}.json`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = path.join(this.storageDir, `${sessionId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  async loadAll(): Promise<PersistedSession[]> {
    try {
      const files = await fs.readdir(this.storageDir);
      const sessions: PersistedSession[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = path.join(this.storageDir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          sessions.push(JSON.parse(content));
        } catch {
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  async cleanupStale(retentionDays: number): Promise<void> {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const sessions = await this.loadAll();

    for (const session of sessions) {
      if (session.lastActivity < cutoff) {
        await this.delete(session.id);
      }
    }
  }
}

export class SessionManager {
  private sessions: Map<string, SessionState>;
  private storage: SessionStorage;

  constructor() {
    this.sessions = new Map();
    this.storage = new SessionStorage();
  }

  async initialize(): Promise<void> {
    const persisted = await this.storage.loadAll();
    for (const session of persisted) {
      this.sessions.set(session.id, {
        ...session,
        cancelled: false
      });
    }
  }

  async createSession(params: { cwd?: string; modeId?: "default" | "plan" }): Promise<SessionState> {
    const id = crypto.randomUUID();
    const state: SessionState = {
      id,
      cwd: params.cwd,
      modeId: params.modeId || "default",
      resumeId: undefined,
      cancelled: false,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(id, state);
    await this.storage.save(state);
    return state;
  }

  async getSession(id: string): Promise<SessionState | null> {
    return this.sessions.get(id) || null;
  }

  async updateSession(id: string, updates: Partial<SessionState>): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    const updated = { ...session, ...updates, lastActivity: Date.now() };
    this.sessions.set(id, updated);
    await this.storage.save(updated as PersistedSession);
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    await this.storage.delete(id);
  }

  async cleanupStale(retentionDays: number = 7): Promise<void> {
    await this.storage.cleanupStale(retentionDays);
    for (const [id, session] of this.sessions.entries()) {
      const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      if (session.lastActivity < cutoff) {
        this.sessions.delete(id);
      }
    }
  }

  canResume(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!(session?.resumeId);
  }

  setResumeId(sessionId: string, resumeId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.resumeId = resumeId;
    }
  }

  markCancelled(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cancelled = true;
    }
  }

  isCancelled(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.cancelled || false;
  }
}

export { SessionStorage };
