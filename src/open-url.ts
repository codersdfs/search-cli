/**
 * Open a URL in the user's default browser — platform-aware.
 *
 * ponytail: three platforms, no abstraction. Add more browsers/flags
 * only if the open/xdg-open pattern fails somewhere.
 */

export function openUrl(url: string): void {
  try {
    const p = process.platform;
    if (p === "win32") Bun.spawn(["cmd", "/c", "start", "", url]);
    else if (p === "darwin") Bun.spawn(["open", url]);
    else Bun.spawn(["xdg-open", url]);
  } catch {
    // non-critical — user can copy the URL manually
  }
}
