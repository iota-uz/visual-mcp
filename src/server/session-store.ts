/**
 * Session-id -> Session bookkeeping for the MCP server process.
 *
 * The sandbox module (see src/sandbox/index.ts) intentionally works in
 * terms of `Session` objects, not bare `session_id` strings — it leaves
 * request-level session lookup/validation to whoever owns the MCP tool
 * surface. This module is that piece: a simple in-memory
 * `Map<string, Session>` that lives for the lifetime of the server
 * process. There is no persistence across restarts by design — sessions
 * are workspaces on disk (see SESSIONS_ROOT) plus this process-local index
 * of which ids are currently "known" to this server instance.
 */

import type { Session } from "../types.js";

/** Thrown when a tool call references a `session_id` this process has no record of. */
export class UnknownSessionError extends Error {
  constructor(sessionId: string) {
    super(
      `Unknown session_id: ${JSON.stringify(sessionId)}. Call create_visual_session first, ` +
        "or check that this session_id belongs to the current server process.",
    );
    this.name = "UnknownSessionError";
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  /** Registers a newly-created session so later tool calls can look it up by id. */
  add(session: Session): void {
    this.sessions.set(session.session_id, session);
  }

  /** @throws {UnknownSessionError} if no session with this id is registered. */
  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new UnknownSessionError(sessionId);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }
}
