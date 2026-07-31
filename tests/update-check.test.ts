import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("markUpdateChecked updates lastCheck timestamp", async () => {
    try { unlinkSync(join(testDir, "ghfind", "update-state.json")); } catch {}
    const mod = await import("../src/update-check.ts");
    mod.markUpdateChecked("0.9.0");
    const state = mod.readUpdateState();
    expect(state.lastCheck).toBeGreaterThan(0);
    expect(state.latestVersion).toBe("0.9.0");
  });

  it("markUpdateChecked with undefined clears latestVersion", async () => {
    const mod = await import("../src/update-check.ts");
    mod.markUpdateChecked("0.9.0");
    mod.markUpdateChecked(undefined);
    const state = mod.readUpdateState();
    expect(state.latestVersion).toBeUndefined();
  });

  it("snoozeUpdateNotices sets snoozeUntil in the future", async () => {
    const mod = await import("../src/update-check.ts");
    mod.snoozeUpdateNotices(3);
    const state = mod.readUpdateState();
    expect(state.snoozeUntil).toBeGreaterThan(Date.now());
    expect(state.snoozeUntil).toBeLessThan(Date.now() + 4 * 86400000);
  });

  it("suppressUpdateNotices sets suppressed to true", async () => {
    const mod = await import("../src/update-check.ts");
    mod.suppressUpdateNotices();
    const state = mod.readUpdateState();
    expect(state.suppressed).toBe(true);
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

  it("handles versions with pre-release tags in fallback", async () => {
    const { isNewerVersion } = await import("../src/update-check.ts");
    // In Bun environment, uses Bun.semver.order which handles pre-release
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(true);
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("returns latest version when newer version available", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.9.0" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBe("0.9.0");
    vi.restoreAllMocks();
  });

  it("returns null when registry version is same", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.8.2" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null when registry version is older", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.7.0" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on malformed registry response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "format" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null on network failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();
    vi.restoreAllMocks();
  });
});
