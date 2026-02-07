import { describe, expect, it } from "bun:test";

import { DeltaTracker } from "../../../src/streaming/delta-tracker.js";

describe("DeltaTracker", () => {
  it("returns full text for first event", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextText("Hello")).toBe("Hello");
  });

  it("returns delta for appended text", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextText("Hello")).toBe("Hello");
    expect(tracker.nextText("Hello world")).toBe(" world");
  });

  it("returns full text when not a prefix", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextText("Hello")).toBe("Hello");
    expect(tracker.nextText("Hi there")).toBe("Hi there");
  });

  it("handles unicode text", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextText("Hi 😀")).toBe("Hi 😀");
    expect(tracker.nextText("Hi 😀!!")).toBe("!!");
  });

  it("tracks thinking separately", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextThinking("Thought 1")).toBe("Thought 1");
    expect(tracker.nextThinking("Thought 1 + more")).toBe(" + more");
    expect(tracker.nextText("Answer")).toBe("Answer");
  });

  it("resets stored state", () => {
    const tracker = new DeltaTracker();

    expect(tracker.nextText("Hello")).toBe("Hello");
    tracker.reset();
    expect(tracker.nextText("Hello")).toBe("Hello");
  });
});
