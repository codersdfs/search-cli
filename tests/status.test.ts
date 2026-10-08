// The status bar's spinner runs on a plain setInterval that outlives the
// renderer: OpenTUI tears its renderables down on Ctrl+C / SIGTERM / terminal
// close but leaves the event loop running, so an unguarded tick assigns to a
// destroyed TextBuffer and throws "TextBuffer is destroyed" out of a timer
// callback. These tests use real timers and a fake bar that throws the way
// TextRenderable does once destroyed, so a regression fails here rather than in
// a crash report.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  StatusManager,
  createStatusManager,
  type StatusBarTarget,
} from "../src/status";

/** Stands in for TextRenderable: throws on any write after destruction. */
class FakeBar implements StatusBarTarget {
  isDestroyed = false;
  private _content = "";
  /** Throws the way TextRenderable does once its TextBuffer is torn down. */
  set content(value: string) {
    if (this.isDestroyed) throw new Error("TextBuffer is destroyed");
    this._content = value;
  }
  get content(): string {
    return this._content;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusManager spinner", () => {
  it("animates while a spinner type is active", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const mgr = new StatusManager((t) => seen.push(t));
    mgr.set("searching", "Searching for x");
    vi.advanceTimersByTime(400);
    expect(seen.length).toBeGreaterThan(1);
    mgr.dispose();
  });

  it("stops ticking after dispose()", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const mgr = new StatusManager(() => ticks++);
    mgr.set("loading", "Loading");
    vi.advanceTimersByTime(200);
    const atDispose = ticks;
    mgr.dispose();
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(atDispose);
  });

  it("is inert after dispose(), so late async set() calls are dropped", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const mgr = new StatusManager(() => ticks++);
    mgr.dispose();
    mgr.set("success", "done");
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(0);
  });
});

describe("createStatusManager teardown", () => {
  it("does not throw when a spinner tick lands after the bar is destroyed", () => {
    vi.useFakeTimers();
    const bar = new FakeBar();
    const mgr = createStatusManager(bar, () => {});
    mgr.set("searching", "Searching for x");
    bar.isDestroyed = true;
    // The exact crash: renderer teardown happened, but the interval is still
    // ticking. Previously this threw from inside the timer callback.
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    mgr.dispose();
  });

  it("stops the interval when the renderer emits destroy", () => {
    vi.useFakeTimers();
    const bar = new FakeBar();
    let frames = 0;
    const mgr = createStatusManager(bar, () => frames++);
    // Stands in for renderer.on("destroy", () => mgr.dispose()).
    const onDestroy = () => mgr.dispose();
    mgr.set("searching", "Searching for x");
    bar.isDestroyed = true;
    onDestroy();
    const atDestroy = frames;
    vi.advanceTimersByTime(1000);
    expect(frames).toBe(atDestroy);
  });

  it("still writes and requests a frame while the bar is alive", () => {
    const bar = new FakeBar();
    let frames = 0;
    const mgr = createStatusManager(bar, () => frames++);
    mgr.set("error", "boom");
    expect(bar.content).toBe(" ⚠ boom");
    expect(frames).toBe(1);
    mgr.dispose();
  });
});
