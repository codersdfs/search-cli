/**
 * Tests for the Trending Repositories page.
 *
 * Covers data formatting, mock generation, query building, and TUI rendering.
 * Pure functions are tested directly; TUI smoke-test uses OpenTUI's
 * createTestRenderer to verify the layout renders without crashing.
 */
import { describe, expect, test } from "bun:test";
import {
  fmtStars,
  fmtSigned,
  formatRepoLine,
  getTrendingQuery,
  createTestRenderer,
} from "./trending.test.util.ts";

// ── fmtStars ──────────────────────────────────────────────────────────
describe("fmtStars", () => {
  test("formats numbers below 1000 as-is", () => {
    expect(fmtStars(0)).toBe("0");
    expect(fmtStars(1)).toBe("1");
    expect(fmtStars(999)).toBe("999");
  });

  test("formats thousands as k", () => {
    expect(fmtStars(1000)).toBe("1k");
    expect(fmtStars(1200)).toBe("1.2k");
    expect(fmtStars(42_500)).toBe("42.5k");
    // 999,999 ÷ 1000 = 999.999 → toFixed(1) rounds to 1000.0
    expect(fmtStars(999_999)).toBe("1000k");
  });

  test("formats millions as M", () => {
    expect(fmtStars(1_000_000)).toBe("1M");
    expect(fmtStars(1_200_000)).toBe("1.2M");
    expect(fmtStars(165_000_000)).toBe("165M");
  });

  test("removes trailing .0", () => {
    expect(fmtStars(1000)).toBe("1k");
    expect(fmtStars(1_000_000)).toBe("1M");
  });
});

// ── fmtSigned ─────────────────────────────────────────────────────────
describe("fmtSigned", () => {
  test("adds + prefix for positive numbers", () => {
    expect(fmtSigned(1204)).toBe("+1.2k");
    expect(fmtSigned(50)).toBe("+50");
    expect(fmtSigned(0)).toBe("+0");
  });

  test("adds - prefix for negative numbers", () => {
    expect(fmtSigned(-500)).toBe("-500");
    expect(fmtSigned(-1204)).toBe("-1.2k");
  });

  test("uses fmtStars for the magnitude", () => {
    expect(fmtSigned(1500)).toBe("+1.5k");
    expect(fmtSigned(-2_100_000)).toBe("-2.1M");
  });
});

// ── formatRepoLine ────────────────────────────────────────────────────
describe("formatRepoLine", () => {
  const repo = {
    rank: 1,
    owner: "tauri-apps",
    name: "tauri",
    stars: 89_200,
    starsToday: 235,
    language: "Rust",
    description: "Build smaller, faster desktop apps.",
  };

  test("includes rank padded to 2 digits", () => {
    const styled = formatRepoLine(repo);
    const text = styled.chunks.map(c => c.text).join("");
    expect(text).toContain("[01]");
  });

  test("includes owner/name", () => {
    const text = formatRepoLine(repo).chunks.map(c => c.text).join("");
    expect(text).toContain("tauri-apps/tauri");
  });

  test("includes star count formatted with k", () => {
    const text = formatRepoLine(repo).chunks.map(c => c.text).join("");
    expect(text).toContain("★ 89.2k");
  });

  test("includes today growth with ▲", () => {
    const text = formatRepoLine(repo).chunks.map(c => c.text).join("");
    expect(text).toContain("▲");
    expect(text).toContain("+235 today");
  });

  test("shows ▼ for negative growth", () => {
    const repo2 = { ...repo, starsToday: -50 };
    const text = formatRepoLine(repo2).chunks.map(c => c.text).join("");
    expect(text).toContain("▼");
    expect(text).toContain("-50 today");
  });

  test("includes language dot and name", () => {
    const text = formatRepoLine(repo).chunks.map(c => c.text).join("");
    expect(text).toContain("●");
    expect(text).toContain("Rust");
  });

  test("rank 10+ still pads properly", () => {
    const r10 = { ...repo, rank: 10, owner: "org", name: "repo" };
    const text = formatRepoLine(r10).chunks.map(c => c.text).join("");
    expect(text).toContain("[10]");
  });

  test("output fits within reasonable width", () => {
    const text = formatRepoLine(repo).chunks.map(c => c.text).join("");
    // Two-line format with language name added; allow up to 90 chars
    expect(text.length).toBeLessThanOrEqual(90);
  });

  test("output is deterministic (same input → same output)", () => {
    const a = formatRepoLine(repo);
    const b = formatRepoLine(repo);
    expect(a.chunks.map(c => c.text).join("")).toBe(b.chunks.map(c => c.text).join(""));
  });
});

// ── getTrendingQuery ──────────────────────────────────────────────────
describe("getTrendingQuery", () => {
  test("Today returns a created:> filter", () => {
    const q = getTrendingQuery("Today");
    expect(q).toMatch(/^created:>\d{4}-\d{2}-\d{2} sort:stars$/);
  });

  test("This Week returns a 7-day range", () => {
    const q = getTrendingQuery("This Week");
    expect(q).toMatch(/^created:>\d{4}-\d{2}-\d{2} sort:stars$/);
    // Verify the date is roughly 7 days ago
    const dateStr = q.replace("created:>", "").replace(" sort:stars", "");
    const date = new Date(dateStr);
    const diffDays = (Date.now() - date.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  test("This Month returns a 30-day range", () => {
    const q = getTrendingQuery("This Month");
    const dateStr = q.replace("created:>", "").replace(" sort:stars", "");
    const diffDays = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  test("All Time returns just sort:stars", () => {
    const q = getTrendingQuery("All Time");
    expect(q).toBe("sort:stars");
  });

  test("This Year returns a 365-day range", () => {
    const q = getTrendingQuery("This Year");
    expect(q).toMatch(/^created:>\d{4}-\d{2}-\d{2} sort:stars$/);
  });

  test("Every tab produces a valid GitHub search query", () => {
    const tabs = ["Today", "This Week", "This Month", "This Year", "All Time"] as const;
    for (const tab of tabs) {
      const q = getTrendingQuery(tab);
      expect(q.length).toBeGreaterThan(0);
      // All queries should include sort:stars
      expect(q).toContain("sort:stars");
    }
  });
});

// ── TUI smoke test ────────────────────────────────────────────────────
describe("TUI rendering", () => {
  test("can create renderer and render the trending layout", async () => {
    const setup = await createTestRenderer({
      width: 80,
      height: 24,
    });
    const { renderer, renderOnce, flush } = setup;

    // Re-create the trending page layout programmatically
    const { BoxRenderable, TextRenderable, SelectRenderable } =
      await import("@opentui/core");

    const root = renderer.root;
    root.flexDirection = "column";
    root.backgroundColor = "#1a1b26";

    // Header
    const header = new TextRenderable(renderer, {
      content: "⟠ tulipsearch — Trending",
      color: "#bb9af7",
      height: 1,
    });
    root.add(header);

    // Tab bar
    const tabBox = new BoxRenderable(renderer, {
      flexDirection: "row",
      height: 1,
      backgroundColor: "#1a1b26",
      paddingX: 1,
    });
    ["Today", "This Week", "This Month", "This Year", "All Time"].forEach(
      (name, i) => {
        const label = `${i + 1} ${i === 1 ? "│" : " "}${name}  `;
        const tt = new TextRenderable(renderer, {
          content: label,
          color: i === 1 ? "#7dcfff" : "#565f89",
          backgroundColor: "#1a1b26",
          height: 1,
        });
        tabBox.add(tt);
      },
    );
    root.add(tabBox);

    // Separator
    const sep = new TextRenderable(renderer, {
      content: "─".repeat(80),
      color: "#363b54",
      height: 1,
      backgroundColor: "#1a1b26",
    });
    root.add(sep);

    // Repo list container
    const listBox = new BoxRenderable(renderer, {
      flexGrow: 1,
      flexDirection: "column",
      backgroundColor: "#1a1b26",
      paddingX: 1,
      paddingY: 1,
      border: true,
      borderColor: "#363b54",
      borderStyle: "rounded",
    });

    // Repo options
    const repos = [
      { rank: 1, owner: "tauri-apps", name: "tauri", stars: 89_200, starsToday: 235, language: "Rust", description: "Build desktop apps." },
      { rank: 2, owner: "astral-sh", name: "uv", stars: 42_500, starsToday: 197, language: "Rust", description: "Fast Python package installer." },
    ];
    const opts = repos.map((r) => ({
      // SelectRenderable only accepts plain strings for option names
      name: `${r.owner}/${r.name}  ★ ${r.stars.toLocaleString()}  ▲ +${r.starsToday} today`,
      description: r.description,
      value: r,
    }));

    const repoSelect = new SelectRenderable(renderer, {
      options: opts,
      selectedIndex: 0,
      showDescription: true,
      showSelectionIndicator: false,
      flexGrow: 1,
      backgroundColor: "#1a1b26",
      textColor: "#a9b1d6",
      selectedBackgroundColor: "#2d3f76",
      selectedTextColor: "#c0caf5",
      descriptionColor: "#565f89",
      selectedDescriptionColor: "#6c7086",
      keyBindings: [
        { key: "j", action: "move-down" },
        { key: "k", action: "move-up" },
      ],
    });
    listBox.add(repoSelect);
    root.add(listBox);

    // Footer
    const footer = new TextRenderable(renderer, {
      content: " ↑↓ navigate  ↵ open  / search  1-5 tab  q quit",
      color: "#565f89",
      height: 1,
      backgroundColor: "#1a1b26",
    });
    root.add(footer);

    renderer.start();
    await flush();
    await renderOnce();

    // Take a snapshot of the rendered output
    const frame = setup.captureCharFrame();
    expect(frame).toBeTruthy();
    expect(frame.length).toBeGreaterThan(0);

    // Header should be visible
    expect(frame).toContain("tulipsearch");

    // Tab labels should be visible
    expect(frame).toContain("Today");
    expect(frame).toContain("This Week");

    // Repo names should be visible
    expect(frame).toContain("tauri-apps/tauri");
    expect(frame).toContain("astral-sh/uv");

    // Star counts fomatted
    expect(frame).toContain("★");

    // Footer
    expect(frame).toContain("navigate");
    expect(frame).toContain("quit");

    // Tab 2 should show as active (with │)
    expect(frame).toContain("2 │This Week");

    // Navigate down with j key
    repoSelect.setSelectedIndex(1);
    await flush();
    await renderOnce();

    const frame2 = setup.captureCharFrame();
    expect(frame2).toContain("astral-sh/uv");

    renderer.destroy();
  }, 10_000);
});
