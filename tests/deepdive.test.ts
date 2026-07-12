import { describe, it, expect } from "bun:test";
import { buildDeepDiveText } from "../src/deepdive.ts";
import type { DeepDiveData } from "../src/deepdive.ts";

describe("deepdive", () => {
  const sampleData: DeepDiveData = {
    summary: " owner/repo\n ★ 1,234  ◆ 56  TypeScript\n A test repo\n topics: cli, rust\n https://github.com/owner/repo",
    languages: "  TypeScript       ████████████████░░ 78.3%\n  Rust             ██████░░░░░░░░  15.1%",
    contributors: "  ▲ user1               247 commits\n  ▲ user2               103 commits",
    readme: "  # Test\n  This is a test README.\n  ## Usage\n  Run the CLI.",
  };

  it("builds formatted deep-dive text with all sections", () => {
    const text = buildDeepDiveText(sampleData);
    expect(text).toContain("── Summary ───");
    expect(text).toContain("── Languages ───");
    expect(text).toContain("── Top Contributors ───");
    expect(text).toContain("── README ───");
    expect(text).toContain("owner/repo");
    expect(text).toContain("TypeScript");
    expect(text).toContain("user1");
  });

  it("handles empty language data", () => {
    const data: DeepDiveData = { ...sampleData, languages: "  (no language data)" };
    const text = buildDeepDiveText(data);
    expect(text).toContain("(no language data)");
  });

  it("handles empty contributors", () => {
    const data: DeepDiveData = { ...sampleData, contributors: "  (no contributor data)" };
    const text = buildDeepDiveText(data);
    expect(text).toContain("(no contributor data)");
  });

  it("handles empty readme", () => {
    const data: DeepDiveData = { ...sampleData, readme: "  (no README)" };
    const text = buildDeepDiveText(data);
    expect(text).toContain("(no README)");
  });
});
