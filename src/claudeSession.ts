// src/claudeSession.ts
import { ForgeDb } from "./db.js";
import type { LiveEventFn } from "./agents/base.js";
import { isBlockedCommand } from "./safety.js";

// Minimal structural view of the Agent SDK surface. The SDK is loaded via
// dynamic import (loadSdkQuery) and injected everywhere else, so unit tests
// never touch the real package and the SDK contact surface stays in one file.
export type SdkMessage = Record<string, unknown>;

export interface SdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<void>;
}

export type SdkQueryFn = (params: {
  prompt: AsyncIterable<SdkUserMessage>;
  options: Record<string, unknown>;
}) => SdkQuery;

export async function loadSdkQuery(): Promise<SdkQueryFn> {
  const mod = await import("@anthropic-ai/claude-agent-sdk");
  return mod.query as unknown as SdkQueryFn;
}

/** Pushable AsyncIterable bridging ClaudeSession.send() to the SDK's streaming prompt input. */
export class MessageStream implements AsyncIterable<SdkUserMessage> {
  private queue: SdkUserMessage[] = [];
  private waiters: ((r: IteratorResult<SdkUserMessage>) => void)[] = [];
  private closed = false;

  push(msg: SdkUserMessage): void {
    if (this.closed) throw new Error("MessageStream is closed");
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: msg, done: false });
    else this.queue.push(msg);
  }

  end(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SdkUserMessage> {
    return {
      next: (): Promise<IteratorResult<SdkUserMessage>> => {
        if (this.queue.length) return Promise.resolve({ value: this.queue.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
