/**
 * Self-update regressions.
 *
 * Two bugs pinned here:
 *  1. The post-upgrade panel's trigger is `lastInstalledVersion !== current`,
 *     and nothing ever cleared `lastInstalledVersion` — so the panel reappeared
 *     on EVERY launch after a single upgrade, including after the user
 *     dismissed it with "later" or "never".
 *  2. The Node/compiled fallback in `isNewerVersion` treated `9.9.0-beta.1` as
 *     newer than `9.9.0`, offering a downgrade.
 *
 * `bun:test` cannot run these, so this suite uses vitest and drives the real
 * exported functions against a temp state dir.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must be set before importing the module under test (stateDir() reads it).
const stateHome = mkdtempSync(join(tmpdir(), "ghfind-update-"));
process.env.XDG_STATE_HOME = stateHome;

import {
  readUpdateState,
  writeUpdateState,
  recordPreUpdateState,
  markPostUpgradeSeen,
  DEFAULTS,
  isNewerVersion,
  fetchReleaseNotes,
} from "../src/update-check.ts";

/**
 * The exact guard from `checkPostUpgradePanel` in src/tui.ts, mirrored so the
 * real decision logic is what the tests assert on.
 */
function postUpgradePanelFires(
  state: { suppressed: boolean; lastInstalledVersion?: string },
  currentVersion: string,
): boolean {
  if (state.suppressed) return false;
  if (!state.lastInstalledVersion) return false;
  return state.lastInstalledVersion !== currentVersion;
}

describe("post-upgrade panel fires exactly once", () => {
  beforeEach(() => {
    writeUpdateState({ ...DEFAULTS });
  });

  it("does not reappear on later launches after one upgrade", () => {
    const current = "9.9.0";
    // The user is on 9.8.3 and clicks "Update now".
    recordPreUpdateState("9.8.3");
    expect(postUpgradePanelFires(readUpdateState(), current)).toBe(true);

    // First launch after the upgrade shows the panel — and acknowledges it.
    const beforeAck = readUpdateState();
    if (postUpgradePanelFires(beforeAck, current)) {
      markPostUpgradeSeen(current);
    }

    // Every subsequent launch must stay quiet.
    for (let launch = 2; launch <= 5; launch++) {
      expect(
        postUpgradePanelFires(readUpdateState(), current),
        `panel reappeared on launch ${launch}`,
      ).toBe(false);
    }
  });

  it("stays dismissed after the user picks 'later' (snooze)", () => {
    const current = "9.9.0";
    recordPreUpdateState("9.8.3");
    markPostUpgradeSeen(current);
    // snoozeUpdateNotices must not resurrect the panel.
    writeUpdateState({
      ...readUpdateState(),
      snoozeUntil: Date.now() + 3 * 24 * 60 * 60 * 1000,
    });
    expect(postUpgradePanelFires(readUpdateState(), current)).toBe(false);
  });

  it("stays dismissed after the user picks 'never' (suppress)", () => {
    const current = "9.9.0";
    recordPreUpdateState("9.8.3");
    markPostUpgradeSeen(current);
    writeUpdateState({ ...readUpdateState(), suppressed: true });
    expect(postUpgradePanelFires(readUpdateState(), current)).toBe(false);
  });

  it("still reports a genuine later upgrade", () => {
    // Acknowledge 9.9.0, then the user updates again to 9.10.0.
    recordPreUpdateState("9.8.3");
    markPostUpgradeSeen("9.9.0");
    recordPreUpdateState("9.9.0");
    expect(postUpgradePanelFires(readUpdateState(), "9.10.0")).toBe(true);
  });

  it("does not acknowledge a downgrade", () => {
    // Install was rolled back (9.10.0 -> 9.8.3). The recorded version is
    // NEWER than what now runs, so acking it would erase the only signal that
    // something changed.
    recordPreUpdateState("9.10.0");
    markPostUpgradeSeen("9.8.3");
    expect(readUpdateState().lastInstalledVersion).toBe("9.10.0");
    expect(postUpgradePanelFires(readUpdateState(), "9.8.3")).toBe(true);
  });

  it("acknowledges a genuine newer version", () => {
    // The normal case: an update landed while the panel was open, so the
    // in-session version is already ahead of what was recorded.
    recordPreUpdateState("9.8.3");
    markPostUpgradeSeen("9.10.0");
    expect(readUpdateState().lastInstalledVersion).toBe("9.10.0");
    expect(postUpgradePanelFires(readUpdateState(), "9.10.0")).toBe(false);
  });

  it("leaves state untouched when there was no upgrade", () => {
    recordPreUpdateState("9.9.0");
    markPostUpgradeSeen("9.9.0");
    expect(readUpdateState().lastInstalledVersion).toBe("9.9.0");
    expect(postUpgradePanelFires(readUpdateState(), "9.9.0")).toBe(false);
  });
});

describe("isNewerVersion", () => {
  it("detects a newer release", () => {
    expect(isNewerVersion("9.8.3", "9.9.0")).toBe(true);
    expect(isNewerVersion("9.9.0", "10.0.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(true);
  });

  it("does not report the same or an older version as an update", () => {
    expect(isNewerVersion("9.9.0", "9.9.0")).toBe(false);
    expect(isNewerVersion("9.9.1", "9.9.0")).toBe(false);
    expect(isNewerVersion("10.0.0", "9.9.0")).toBe(false);
  });

  it("does not offer a prerelease of the running version as an upgrade", () => {
    // npm: 9.9.0-beta.1 is OLDER than 9.9.0. Offering it is a downgrade.
    expect(isNewerVersion("9.9.0", "9.9.0-beta.1")).toBe(false);
    expect(isNewerVersion("9.9.0", "9.9.0-rc.1")).toBe(false);
  });

  it("does offer a prerelease of a genuinely newer version", () => {
    expect(isNewerVersion("9.8.3", "9.9.0-beta.1")).toBe(true);
  });

  it("tolerates a leading v", () => {
    expect(isNewerVersion("v9.8.3", "v9.9.0")).toBe(true);
    expect(isNewerVersion("v9.9.0", "v9.9.0")).toBe(false);
  });

  it("ignores build metadata", () => {
    expect(isNewerVersion("9.9.0", "9.9.0+build.5")).toBe(false);
    expect(isNewerVersion("9.9.0", "9.9.0-beta.1+build.5")).toBe(false);
  });
});

describe("fetchReleaseNotes", () => {
  it("finds the notes for the current release version", () => {
    // 9.9.0 notes ship in the tarball, so this must resolve from disk.
    expect(fetchReleaseNotes("9.9.0")).toContain("v9.9.0");
  });

  it("returns null for a version with no notes", () => {
    expect(fetchReleaseNotes("0.0.0-nonexistent")).toBeNull();
  });
});
