import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mock } from "bun:test";

// Set state dir before importing. mkdtempSync keeps concurrent test processes
// from sharing one state dir (a `Date.now()` name collides in the same ms).
const testDir = mkdtempSync(join(tmpdir(), "ghfind-test-update-"));
process.env.XDG_STATE_HOME = testDir;

describe("update-check state", () => {
  beforeEach(async () => {
    // Clear module cache to get fresh stateDir per test
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({ ...mod.DEFAULTS });
  });

  afterEach(() => {
    try {
      unlinkSync(join(testDir, "ghfind", "update-state.json"));
    } catch {}
  });

  it("returns defaults when no state exists", async () => {
    // Delete the state file to simulate fresh install
    try {
      unlinkSync(join(testDir, "ghfind", "update-state.json"));
    } catch {}
    const { readUpdateState, DEFAULTS } =
      await import("../src/update-check.ts");
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
    try {
      unlinkSync(join(testDir, "ghfind", "update-state.json"));
    } catch {}
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(true);
  });

  it("shouldCheckUpdate returns false when suppressed", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now(),
      snoozeUntil: 0,
      suppressed: true,
    });
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns false when snoozed", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now(),
      snoozeUntil: Date.now() + 86400000,
      suppressed: false,
    });
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns false when checked within 24h", async () => {
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now(),
      snoozeUntil: 0,
      suppressed: false,
    });
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(false);
  });

  it("shouldCheckUpdate returns true when last check was >24h ago", async () => {
    try {
      unlinkSync(join(testDir, "ghfind", "update-state.json"));
    } catch {}
    const mod = await import("../src/update-check.ts");
    mod.writeUpdateState({
      lastCheck: Date.now() - 86400001,
      snoozeUntil: 0,
      suppressed: false,
    });
    const { shouldCheckUpdate } = await import("../src/update-check.ts");
    expect(shouldCheckUpdate()).toBe(true);
  });

  it("markUpdateChecked updates lastCheck timestamp", async () => {
    const mod = await import("../src/update-check.ts");
    mod.markUpdateChecked("0.9.0");
    const state = mod.readUpdateState();
    expect(state.lastCheck).toBeGreaterThan(0);
    expect(state.latestVersion).toBe("0.9.0");
  });

  it("markUpdateChecked with undefined clears latestVersion", async () => {
    const mod = await import("../src/update-check.ts");
    mod.markUpdateChecked("0.9.0");
    mod.markUpdateChecked();
    const state = mod.readUpdateState();
    expect(state.latestVersion).toBeUndefined();
  });

  it("snoozeUpdateNotices sets snoozeUntil in the future", async () => {
    const mod = await import("../src/update-check.ts");
    mod.snoozeUpdateNotices(7);
    const state = mod.readUpdateState();
    expect(state.snoozeUntil).toBeGreaterThan(Date.now());
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
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(true);
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("returns latest version when newer version available", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({ version: "0.9.0" }),
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBe("0.9.0");

    globalThis.fetch = origFetch;
  });

  it("returns null when registry version is same", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({ version: "0.8.2" }),
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();

    globalThis.fetch = origFetch;
  });

  it("returns null when registry version is older", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({ version: "0.7.0" }),
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();

    globalThis.fetch = origFetch;
  });

  it("returns null on HTTP error", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.resolve({
        ok: false,
        status: 500,
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();

    globalThis.fetch = origFetch;
  });

  it("returns null on malformed registry response", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({ unexpected: "format" }),
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();

    globalThis.fetch = origFetch;
  });

  it("returns null on network failure", async () => {
    const mockFetch = mock((_url: string) => {
      return Promise.reject(new Error("ECONNREFUSED"));
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;

    const { checkForUpdate } = await import("../src/update-check.ts");
    expect(await checkForUpdate("0.8.2")).toBeNull();

    globalThis.fetch = origFetch;
  });
});

describe("update install targeting", () => {
  const PKG = "github-search-cli";

  it("detects an npm Windows install and targets its prefix", async () => {
    const { detectInstallLocation, buildUpdateCommand } =
      await import("../src/update-check.ts");
    const loc = detectInstallLocation(
      "C:/Users/frank/AppData/Roaming/npm/node_modules/github-search-cli",
    );
    expect(loc).toEqual({
      channel: "npm",
      prefix: "C:/Users/frank/AppData/Roaming/npm",
    });
    expect(buildUpdateCommand(loc!)).toEqual([
      "npm",
      "install",
      "-g",
      "--prefix",
      "C:/Users/frank/AppData/Roaming/npm",
      PKG,
    ]);
  });

  it("detects an npm Unix install (<prefix>/lib/node_modules) and targets its prefix", async () => {
    const { detectInstallLocation, buildUpdateCommand } =
      await import("../src/update-check.ts");
    const loc = detectInstallLocation(
      "/usr/local/lib/node_modules/github-search-cli",
    );
    expect(loc).toEqual({ channel: "npm", prefix: "/usr/local" });
    expect(buildUpdateCommand(loc!)).toEqual([
      "npm",
      "install",
      "-g",
      "--prefix",
      "/usr/local",
      PKG,
    ]);
  });

  it("detects a bun global install and uses bun, not npm", async () => {
    const { detectInstallLocation, buildUpdateCommand } =
      await import("../src/update-check.ts");
    const loc = detectInstallLocation(
      "/home/frank/.bun/install/global/node_modules/github-search-cli",
    );
    expect(loc).toEqual({ channel: "bun" });
    expect(buildUpdateCommand(loc!)).toEqual(["bun", "install", "-g", PKG]);
  });

  it("returns null for a compiled binary (no node_modules ancestor)", async () => {
    const { detectInstallLocation } = await import("../src/update-check.ts");
    expect(detectInstallLocation("/$bunfs/root/github-search-cli")).toBeNull();
  });

  it("npm command without a detected prefix falls back to npm's configured prefix", async () => {
    const { buildUpdateCommand } = await import("../src/update-check.ts");
    expect(buildUpdateCommand({ channel: "npm" })).toEqual([
      "npm",
      "install",
      "-g",
      PKG,
    ]);
  });

  it("performUpdate refuses to spawn when the install channel is unknown", async () => {
    const { performUpdate } = await import("../src/update-check.ts");
    // A compiled binary / dev checkout must not npm-install a copy the user
    // isn't running — it should fail honestly instead.
    expect(await performUpdate(null)).toBe(false);
  });
});
