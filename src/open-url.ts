/**
 * Open a URL in the user's default browser — platform- and runtime-aware.
 *
 * Windows note: `explorer.exe` is used instead of the classic
 * `cmd /c start "" <url>` idiom. cmd splits the URL at the first unquoted
 * `&` (a query-string separator) and executes the rest as a command, which
 * truncated every URL with query params. explorer.exe receives the URL as a
 * single CreateProcess argument, so `&` is never interpreted.
 */
import { spawn } from "node:child_process";

export function openUrl(url: string): void {
  try {
    const p = process.platform;
    const cmd =
      p === "win32" ? "explorer" : p === "darwin" ? "open" : "xdg-open";
    if (typeof Bun !== "undefined") {
      Bun.spawn([cmd, url]);
      return;
    }
    // Node fallback — detached so the child survives our exit.
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // non-critical — user can copy the URL manually
  }
}
