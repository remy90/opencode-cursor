import { describe, expect, it } from "bun:test";
import {
  createToolLoopGuard,
  parseToolLoopMaxRepeat,
} from "../../src/provider/tool-loop-guard";

describe("tool loop guard", () => {
  it("parses max repeat env with default fallback", () => {
    expect(parseToolLoopMaxRepeat(undefined)).toEqual({ value: 3, valid: true });
    expect(parseToolLoopMaxRepeat("4")).toEqual({ value: 4, valid: true });
    expect(parseToolLoopMaxRepeat("0")).toEqual({ value: 3, valid: false });
    expect(parseToolLoopMaxRepeat("abc")).toEqual({ value: 3, valid: false });
  });

  it("tracks repeated failures using fingerprint and triggers after threshold", () => {
    const guard = createToolLoopGuard(
      [
        {
          role: "tool",
          tool_call_id: "c1",
          content: "Invalid arguments: missing required field path",
        },
      ],
      2,
    );

    const call = {
      id: "c1",
      type: "function" as const,
      function: {
        name: "read",
        arguments: JSON.stringify({ path: "foo.txt" }),
      },
    };

    const first = guard.evaluate(call);
    const second = guard.evaluate(call);
    const third = guard.evaluate(call);

    expect(first.triggered).toBe(false);
    expect(second.triggered).toBe(false);
    expect(third.triggered).toBe(true);
    expect(third.repeatCount).toBe(3);
  });

  it("triggers on repeated failures even when argument shapes vary", () => {
    const guard = createToolLoopGuard(
      [
        {
          role: "tool",
          tool_call_id: "seed",
          content: "Invalid arguments: missing required field path",
        },
      ],
      2,
    );

    const first = guard.evaluate({
      id: "c2",
      type: "function",
      function: {
        name: "edit",
        arguments: JSON.stringify({ path: "TODO.md", content: "rewrite" }),
      },
    });
    const second = guard.evaluate({
      id: "c3",
      type: "function",
      function: {
        name: "edit",
        arguments: JSON.stringify({ path: "TODO.md", old_string: "A", new_string: "B" }),
      },
    });
    const third = guard.evaluate({
      id: "c4",
      type: "function",
      function: {
        name: "edit",
        arguments: JSON.stringify({ path: "TODO.md", streamContent: "rewrite again" }),
      },
    });

    expect(first.triggered).toBe(false);
    expect(second.triggered).toBe(false);
    expect(third.triggered).toBe(true);
    expect(third.fingerprint).toBe("edit|validation");
    expect(third.repeatCount).toBe(3);
  });

  it("does not track successful tool results", () => {
    const guard = createToolLoopGuard(
      [
        {
          role: "tool",
          tool_call_id: "c1",
          content: "{\"success\":true}",
        },
      ],
      2,
    );

    const decision = guard.evaluate({
      id: "c1",
      type: "function",
      function: {
        name: "read",
        arguments: JSON.stringify({ path: "foo.txt" }),
      },
    });

    expect(decision.tracked).toBe(false);
    expect(decision.triggered).toBe(false);
  });

  it("resets fingerprint counts", () => {
    const guard = createToolLoopGuard(
      [
        {
          role: "tool",
          content: "invalid schema",
        },
      ],
      1,
    );

    const call = {
      id: "cx",
      type: "function" as const,
      function: {
        name: "edit",
        arguments: JSON.stringify({ path: "foo.txt", content: "bar" }),
      },
    };

    const first = guard.evaluate(call);
    const second = guard.evaluate(call);
    expect(second.triggered).toBe(true);

    guard.resetFingerprint(first.fingerprint);
    const third = guard.evaluate(call);
    expect(third.triggered).toBe(false);
  });

  it("tracks repeated schema-validation failures independent of tool result parsing", () => {
    const guard = createToolLoopGuard([], 2);
    const call = {
      id: "e1",
      type: "function" as const,
      function: {
        name: "edit",
        arguments: JSON.stringify({ path: "TODO.md", content: "rewrite" }),
      },
    };

    const first = guard.evaluateValidation(call, "missing:old_string,new_string");
    const second = guard.evaluateValidation(call, "missing:old_string,new_string");
    const third = guard.evaluateValidation(call, "missing:old_string,new_string");

    expect(first.triggered).toBe(false);
    expect(second.triggered).toBe(false);
    expect(third.triggered).toBe(true);
    expect(third.errorClass).toBe("validation");
  });

  it("seeds validation guard history for repeated malformed edit calls", () => {
    const guard = createToolLoopGuard(
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "prev-edit",
              type: "function",
              function: {
                name: "edit",
                arguments: "{\"path\":\"TODO.md\",\"content\":\"full rewrite\"}",
              },
            },
          ],
        },
      ],
      1,
    );

    const decision = guard.evaluateValidation(
      {
        id: "next-edit",
        type: "function",
        function: {
          name: "edit",
          arguments: "{\"path\":\"TODO.md\",\"content\":\"rewrite again\"}",
        },
      },
      "missing:old_string,new_string",
    );

    expect(decision.triggered).toBe(true);
    expect(decision.errorClass).toBe("validation");
  });
});
