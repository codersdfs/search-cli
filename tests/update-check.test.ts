import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set state dir before importing
const testDir = join(tmpdir(), `ghfind-test-update-${Date.now()}`);
process.env.XDG_STATE_HOME = testDir;

describe("update-check state", () => {
  beforeEach(async () => {
    // Clear module cache to get fresh stateDir per test
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({ ...mod.DEFAULTS });
  });

  afterEach(() => {
    try { unlinkSync(join(testDir, "ghfind", "update-state.json")); } catch {}
  });

  it("returns defaults when no state exists", async () => {
    // Delete the state file to simulate fresh install
    try { unlinkSync(join(testDir, "ghfind", "update-state.json")); } catch {}
    const { readUpdateState, DEFAULTS } = await import("../src/update-check.ts");
    const state = readUpdateState();
    expect(state.lastCheck).toBe(DEFAULTS.lastCheck);
    expect(state.snoozeUntil).toBe(DEFAULTS.snoozeUntil);
    expect(state.suppressed).toBe(DEFAULTS.suppressed);
  });

  it("writes and reads state round-trip", async () => {
    const mod = await import("../src/update-check.ts");
    const state = { lastCheck: 1234567890, snoozeUntil: 0, suppressed: true };
    mod.writeUpdateState(state);
    const read = mod.readUpdateState();
    expect(read.lastCheck).toBe(1234567890);
    expect(read.suppressed).toBe(true);
  });

  it("shouldCheckUpdate returns true when no prior check", async () => {
    try { unlinkSync(join(testDir, "ghfind", "update-state.json")); } catch {}
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(true);
  });

  it("shouldCheckUpdate returns false when suppressed", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({ lastCheck: Date.now(), snoozeUntil: 0, suppressed: true });
    expect(mod.shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns false when snoozed", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now() - 86400000,
      snoozeUntil: Date.now() + 86400000,
      suppressed: false,
    });
    expect(mod.shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns false when checked within 24h", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now() - 1000,
      snoozeUntil: 0,
      suppressed: false,
    });
    expect(mod.shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns true when last check was >24h ago", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now() - 25 * 3600 * 1000,
      snoozeUntil: 0,
      suppressed: false,
    });
    expect(mod.shouldCheckUpdate()).toBe(true);
  });
});

describe("version comparison", () => {
  it("detects newer version", async () => {
    const { isNewerVersion } = await import("../src/update-check.ts");
    expect(isNewerVersion("0.8.2", "0.8.5")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(true);
  });

  it("returns false for same or older version", async () => {
    const { isNewerVersion } = await import("../src/update-check.ts");
    expect(isNewerVersion("0.8.5", "0.8.2")).toBe(false);
    expect(isNewerVersion("0.8.2", "0.8.2")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(false);
  });
});
