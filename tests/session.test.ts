// Session sanitization: a session.json is UI state, so a corrupted one (e.g.
// an MCP handshake blob piped in as a "query") must never hijack startup or
// auto-run a garbage search again.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionState } from "../src/types";

const testDir = mkdtempSync(join(tmpdir(), "ghfind-test-session-"));
process.env.XDG_STATE_HOME = testDir;

/** Read a source file with LF endings (Windows CI checks out CRLF). */
function readSource(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const { saveSession, restoreSession, sanitizeQuery, sanitizeSession } =
  await import("../src/session.ts");

const MCP_BLOB =
  '{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"sampling":{}},"clientInfo":{"name":"pi-mcp-ghfind","version":"1.0.0"}},"jsonrpc":"2.0","id":0}';

afterEach(() => {
  try {
    rmSync(join(testDir, "session.json"));
  } catch {
    // already gone
  }
});

describe("sanitizeQuery", () => {
  it("keeps normal queries (trimmed)", () => {
    expect(sanitizeQuery("  rust cli  ")).toBe("rust cli");
    expect(sanitizeQuery("language:Rust stars:>100")).toBe(
      "language:Rust stars:>100",
    );
  });

  it("drops JSON objects and arrays (MCP garbage)", () => {
    expect(sanitizeQuery(MCP_BLOB)).toBeUndefined();
    expect(sanitizeQuery('["a","b"]')).toBeUndefined();
    expect(sanitizeQuery('{"method":"initialize"}')).toBeUndefined();
  });

  it("keeps queries that merely contain braces inside text", () => {
    expect(sanitizeQuery("use {fetch} in examples")).toBe(
      "use {fetch} in examples",
    );
  });

  it("drops empty, whitespace, oversized, and non-string values", () => {
    expect(sanitizeQuery("")).toBeUndefined();
    expect(sanitizeQuery("   ")).toBeUndefined();
    expect(sanitizeQuery("x".repeat(201))).toBeUndefined();
    expect(sanitizeQuery(null)).toBeUndefined();
    expect(sanitizeQuery(42)).toBeUndefined();
    expect(sanitizeQuery(undefined)).toBeUndefined();
  });
});

describe("sanitizeSession", () => {
  it("passes a well-formed session through", () => {
    const s: SessionState = {
      mode: "trending",
      query: "rust",
      sort: "stars",
      limit: 25,
      trendingTab: "Today",
    };
    expect(sanitizeSession(s)).toEqual(s);
  });

  it("nulls out and clamps malformed fields", () => {
    const s = sanitizeSession({
      mode: "bookmarks" as never, // not restorable
      query: MCP_BLOB, // garbage
      sort: 42 as never,
      limit: Number.NaN,
      trendingTab: "",
    });
    expect(s).toEqual({
      mode: "search",
      query: "",
      sort: "best-match",
      limit: 50,
      trendingTab: "This Week",
    });
  });

  it("returns null for null/non-object input", () => {
    expect(sanitizeSession(null)).toBeNull();
    expect(sanitizeSession(undefined)).toBeNull();
    expect(sanitizeSession("nope" as never)).toBeNull();
  });
});

describe("save/restore round-trip", () => {
  it("restores what was saved", () => {
    saveSession({
      mode: "search",
      query: "rust cli",
      sort: "stars",
      limit: 25,
      trendingTab: "This Week",
    });
    expect(restoreSession()).toEqual({
      mode: "search",
      query: "rust cli",
      sort: "stars",
      limit: 25,
      trendingTab: "This Week",
    });
  });

  it("a saved MCP blob comes back as an empty query, not garbage", () => {
    saveSession({
      mode: "search",
      query: MCP_BLOB,
      sort: "best-match",
      limit: 50,
      trendingTab: "This Week",
    });
    const restored = restoreSession();
    expect(restored?.query).toBe("");
  });
});

describe("TUI startup (source contract)", () => {
  it("always shows the landing screen; no session auto-run", () => {
    const src = readSource("src/tui.ts");
    // The old condition gated the landing screen on "no session".
    expect(src).not.toContain("if (!session?.mode) {");
    // The startup block must call showLanding(true) unconditionally and
    // never auto-run a search (the retry key elsewhere may, so scope it).
    const start = src.slice(
      src.indexOf("// ── Start"),
      src.indexOf("// ── Utilities"),
    );
    expect(start).toContain("showLanding(true);");
    expect(start).not.toContain("doSearch");
    // Picking Repo Search prefills the saved query but never runs it.
    const repoCard = src.slice(
      src.indexOf('title: "Repo Search"'),
      src.indexOf("landingSelected = 0"),
    );
    expect(repoCard).toContain("currentQueryInput");
    expect(repoCard).toContain("showSearchMode();");
  });
});
