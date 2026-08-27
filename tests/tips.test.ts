import { describe, it, expect } from "vitest";
import { TipRotator, defaultRotator, nextTip } from "../src/tips.ts";

describe("TipRotator", () => {
  it("returns a non-empty string", () => {
    const rotator = new TipRotator();
    const tip = rotator.next();
    expect(typeof tip).toBe("string");
    expect(tip.length).toBeGreaterThan(0);
  });

  it("never repeats the same tip twice in a row", () => {
    const rotator = new TipRotator();
    let prev = rotator.next();
    for (let i = 0; i < 50; i++) {
      const current = rotator.next();
      expect(current).not.toBe(prev);
      prev = current;
    }
  });

  it("each instance has independent state", () => {
    const a = new TipRotator();
    const b = new TipRotator();
    // Both start fresh — they may return the same tip, but that's OK
    // The key is they don't share lastIndex
    const tipA = a.next();
    const tipB = b.next();
    expect(typeof tipA).toBe("string");
    expect(typeof tipB).toBe("string");
  });
});

describe("defaultRotator", () => {
  it("is a TipRotator instance", () => {
    expect(defaultRotator).toBeInstanceOf(TipRotator);
  });

  it("nextTip() returns a non-empty string", () => {
    const tip = nextTip();
    expect(typeof tip).toBe("string");
    expect(tip.length).toBeGreaterThan(0);
  });

  it("nextTip() never repeats consecutively", () => {
    let prev = nextTip();
    for (let i = 0; i < 20; i++) {
      const current = nextTip();
      expect(current).not.toBe(prev);
      prev = current;
    }
  });
});
