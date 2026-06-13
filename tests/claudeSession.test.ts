// tests/claudeSession.test.ts
import { MessageStream, type SdkUserMessage } from "../src/claudeSession.js";

function userMsg(content: string): SdkUserMessage {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}

describe("MessageStream", () => {
  test("yields pushed messages in order", async () => {
    const stream = new MessageStream();
    stream.push(userMsg("a"));
    stream.push(userMsg("b"));
    stream.end();
    const seen: string[] = [];
    for await (const m of stream) seen.push(m.message.content);
    expect(seen).toEqual(["a", "b"]);
  });

  test("waits for messages pushed after iteration starts", async () => {
    const stream = new MessageStream();
    const collected = (async () => {
      const seen: string[] = [];
      for await (const m of stream) seen.push(m.message.content);
      return seen;
    })();
    stream.push(userMsg("late"));
    stream.end();
    await expect(collected).resolves.toEqual(["late"]);
  });

  test("push after end throws", () => {
    const stream = new MessageStream();
    stream.end();
    expect(() => stream.push(userMsg("x"))).toThrow("closed");
  });
});
