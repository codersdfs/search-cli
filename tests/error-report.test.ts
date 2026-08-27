// Tests for the error-report helper
import { describe, it, expect } from "vitest";
import { buildIssueUrl, formatErrorBody } from "../src/error-report.ts";

describe("error-report", () => {
  it("builds a GitHub issues/new URL with prefilled title and body", () => {
    const err = new Error("oh no something broke");
    const url = buildIssueUrl(err, { command: "ghfind", argv: ["search", "rust"] });
    expect(url).toMatch(/^https:\/\/github\.com\/codersdfs\/search-cli\/issues\/new\?/);
    expect(url).toContain("title=");
    expect(url).toContain("body=");
    // URLSearchParams uses form encoding: spaces are "+" not "%20"
    expect(url).toContain("search+rust");
    // decode and look for the error message as a free-form string in the body
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("oh no something broke");
  });

  it("truncates long error messages in the title", () => {
    const err = new Error("x".repeat(500));
    const url = buildIssueUrl(err, { command: "ghfind", argv: [] });
    // 80 char title + "[bug] " prefix; URLSearchParams encodes the rest
    const m = url.match(/title=([^&]+)/);
    expect(m).not.toBeNull();
    const decoded = decodeURIComponent(m![1]);
    expect(decoded.length).toBeLessThanOrEqual("[bug] ".length + 80);
  });

  it("strips ANSI escape codes from the body stack", () => {
    const err = new Error("test");
    err.stack = "\u001b[31mError: test\u001b[0m\n    at foo";
    const body = formatErrorBody(err, { command: "ghfind", argv: [] });
    expect(body).not.toContain("\u001b[31m");
    expect(body).toContain("Error: test");
  });

  it("handles non-Error throwables", () => {
    const url = buildIssueUrl("plain string", { command: "ghfind", argv: [] });
    expect(url).toMatch(/^https:\/\/github\.com\/codersdfs\/search-cli\/issues\/new\?/);
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    expect(decoded).toContain("plain string");
  });

  it("includes environment info in the body", () => {
    const err = new Error("test");
    const body = formatErrorBody(err, { command: "ghfind", argv: ["x"] });
    expect(body).toContain("## Environment");
    expect(body).toMatch(/ghfind: v\d+\.\d+\.\d+/);
    expect(body).toMatch(/runtime: (Bun|Node)/);
    expect(body).toMatch(/platform: (win32|darwin|linux)/);
  });

  it("includes the command and argv in the body", () => {
    const err = new Error("test");
    const body = formatErrorBody(err, { command: "ghfind", argv: ["--json", "rust"] });
    expect(body).toContain("## Command");
    expect(body).toContain("ghfind --json rust");
  });
});
