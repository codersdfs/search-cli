#!/usr/bin/env bun
/**
 * tui-runner.mjs — passive TUI dashboard (Phase 1, non-interactive).
 *
 * Reads JSONL from a file (piped live by the /tui extension) and renders
 * a two-pane dashboard using @opentui/core:
 *   Left:  scrollable conversation (assistant messages + tool results)
 *   Right: live tool-call trace
 *
 * This is a *watch* process — it renders but does not feed input back to the
 * agent. Press Ctrl+C / Esc to exit.
 *
 * Usage: bun tui-runner.mts <jsonl-path>
 *
 * NOTE: Must be run with `bun` — the @opentui/core native FFI only loads
 * under Bun's runtime, not stock Node.js.
 */
import { createCliRenderer } from "@opentui/core";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";

const jsonlPath = process.argv[2];
if (!jsonlPath) {
	console.error("Usage: bun tui-runner.mts <jsonl-path>");
	process.exit(1);
}

interface Entry {
	type: "message" | "tool_call" | "tool_result" | "thinking";
	role?: "assistant" | "user";
	content: string;
	timestamp: number;
}

let rows: Entry[] = [];
let scrollIndex = 0;
let showTrace = true;
let showTools = true;

async function refresh(): Promise<void> {
	try {
		const text = await readFile(jsonlPath, "utf-8");
		rows = text
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => {
				try {
					return JSON.parse(l) as Entry;
				} catch {
					return null;
				}
			})
			.filter((r): r is Entry => r !== null);
	} catch {
		rows = [];
	}
}

await refresh();
watch(jsonlPath, { interval: 100 }).on("change", async () => {
	await refresh();
	renderer.requestRender();
});

const renderer = await createCliRenderer({
	screen: { mode: "alternate-screen" },
});

function getVisible(): Entry[] {
	if (showTools) return rows;
	return rows.filter((r) => r.type !== "tool_call" && r.type !== "tool_result");
}

function getTrace(): Entry[] {
	return rows.filter((r) => r.type === "tool_call" || r.type === "tool_result");
}

function formatRow(row: Entry, width: number): string {
	let prefix = "";
	if (row.type === "tool_call") prefix = "→ ";
	else if (row.type === "tool_result") prefix = "← ";
	else if (row.role === "assistant") prefix = "🤖 ";
	else prefix = "👤 ";
	return `${prefix}${(row.content || "").slice(0, Math.max(0, width - 4))}`;
}

function renderLines(width: number, height: number): string[] {
	const splitCol = Math.floor(width * 0.6);
	const usable = height - 3;
	const visible = getVisible();
	const trace = getTrace();
	const maxScroll = Math.max(0, visible.length - usable);
	const si = Math.min(scrollIndex, maxScroll);

	const lines: string[] = [];
	for (let i = 0; i < usable; i++) {
		const rowIdx = i + si;
		const left = visible[rowIdx];
		const right = showTrace ? trace[rowIdx] : null;

		const leftLine = left ? formatRow(left, splitCol - 1) : " ".repeat(splitCol - 1);
		const rightLine = right
			? formatRow(right, width - splitCol - 2)
			: showTrace
				? " ".repeat(width - splitCol - 2)
				: "";
		lines.push(leftLine + "│" + rightLine);
	}

	lines.push(
		` Ctrl+O toggle trace · Ctrl+B/F scroll · Ctrl+T toggle tools · Ctrl+C quit `.slice(0, width),
	);
	lines.push(
		` entries=${rows.length} scroll=${si}/${maxScroll} trace=${showTrace} tools=${showTools} `.slice(
			0,
			width,
		),
	);
	return lines;
}

renderer.on("keypress", (data: string) => {
	if (data === "\x0f") {
		// Ctrl+O
		showTrace = !showTrace;
		renderer.requestRender();
	} else if (data === "\x02") {
		// Ctrl+B
		scrollIndex = Math.max(0, scrollIndex - 3);
		renderer.requestRender();
	} else if (data === "\x06") {
		// Ctrl+F
		const max = Math.max(0, getVisible().length - 30);
		scrollIndex = Math.min(scrollIndex + 3, max);
		renderer.requestRender();
	} else if (data === "\x14") {
		// Ctrl+T
		showTools = !showTools;
		scrollIndex = 0;
		renderer.requestRender();
	} else if (data === "\x1b" || data === "\x03") {
		// Esc or Ctrl+C
		renderer.destroy();
		process.exit(0);
	}
});

renderer.on("frame", () => {
	const { width, height } = renderer;
	const lines = renderLines(width, height);
	renderer.clearRect(0, 0, width, height);
	for (let i = 0; i < lines.length; i++) {
		renderer.drawText(i, lines[i]);
	}
});

renderer.requestRender();
