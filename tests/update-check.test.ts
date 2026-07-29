import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  compareVersions,
  checkForUpdate,
  fetchLatestVersion,
} from "../src/update-check";

describe("update-check", () => {
  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("returns positive when first is newer", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0);
      expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    });

    it("returns negative when first is older", () => {
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
      expect(compareVersions("0.9.0", "1.0.0")).toBeLessThan(0);
    });

    it("handles different segment counts", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    });

    it("handles non-numeric segments gracefully", () => {
      expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    });
  });

  describe("checkForUpdate", () => {
    const origFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    it("returns info when a newer version is available", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      }) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.error).toBeNull();
      expect(result.info).not.toBeNull();
      expect(result.info!.hasUpdate).toBe(true);
      expect(result.info!.current).toBe("0.8.2");
      expect(result.info!.latest).toBe("1.0.0");
      expect(result.info!.url).toContain("github.com");
    });

    it("returns null info when already on latest", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.8.2" }),
      }) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.error).toBeNull();
      expect(result.info).toBeNull();
    });

    it("returns null info when current is newer than registry", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.7.0" }),
      }) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.error).toBeNull();
      expect(result.info).toBeNull();
    });

    it("returns network error on fetch failure", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("network down")) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.info).toBeNull();
      expect(result.error).toBe("network");
    });

    it("returns network error on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.info).toBeNull();
      expect(result.error).toBe("network");
    });

    it("returns network error on timeout/abort", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      globalThis.fetch = vi.fn().mockRejectedValue(abortError) as any;

      const result = await checkForUpdate("0.8.2", { skipCache: true });
      expect(result.info).toBeNull();
      expect(result.error).toBe("network");
    });
  });

  describe("fetchLatestVersion", () => {
    const origFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    it("returns version string on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      }) as any;

      const version = await fetchLatestVersion(1000);
      expect(version).toBe("2.0.0");
    });

    it("returns null when version field is missing", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as any;

      const version = await fetchLatestVersion(1000);
      expect(version).toBeNull();
    });

    it("returns null on fetch error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail")) as any;

      const version = await fetchLatestVersion(1000);
      expect(version).toBeNull();
    });
  });
});
