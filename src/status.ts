/**
 * Status bar state machine with spinner animation.
 */
export type StatusType = "idle" | "searching" | "loading" | "success" | "error";

const SEARCH_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOADING_SPINNER = ["▰▱▱▱▱", "▰▰▱▱▱", "▰▰▰▱▱", "▰▰▰▰▱", "▰▰▰▰▰"];

export class StatusManager {
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerIndex = 0;
  private type: StatusType = "idle";
  private message = "";
  private onUpdate: (text: string) => void;
  private disposed = false;

  constructor(onUpdate: (text: string) => void) {
    this.onUpdate = onUpdate;
  }

  set(type: StatusType, message: string): void {
    // Late async continuations (a search resolving after quit) can call
    // set() long after the UI is gone; a disposed manager is inert.
    if (this.disposed) return;
    this.stopSpinner();
    this.type = type;
    this.message = message;

    if (type === "searching" || type === "loading") {
      this.startSpinner(
        type === "searching" ? SEARCH_SPINNER : LOADING_SPINNER,
      );
    } else {
      this.emit();
    }
  }

  private startSpinner(frames: string[]): void {
    if (this.disposed) return;
    this.spinnerIndex = 0;
    this.emit(frames[0]);
    this.spinnerInterval = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % frames.length;
      this.emit(frames[this.spinnerIndex]);
    }, 120);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  private emit(spinner?: string): void {
    // A tick can already be queued when dispose() clears the interval.
    if (this.disposed) return;
    const icon =
      this.type === "searching"
        ? "🔍"
        : this.type === "loading"
          ? "📦"
          : this.type === "success"
            ? "✓"
            : this.type === "error"
              ? "⚠"
              : " ";
    const prefix = spinner ?? "";
    this.onUpdate(`${icon} ${this.message}  ${prefix}`.trim());
  }

  dispose(): void {
    this.disposed = true;
    this.stopSpinner();
  }
}

/**
 * The status-bar renderable, narrowed to what the manager needs. TextRenderable
 * satisfies this structurally (isDestroyed is a public getter on Renderable).
 */
export interface StatusBarTarget {
  readonly isDestroyed: boolean;
  // Accessor pair, not `content: string`: TextRenderable's getter widens to
  // StyledText while its setter accepts a plain string. `unknown` on the read
  // side keeps the renderable assignable; we only ever write strings.
  get content(): unknown;
  set content(value: string);
}

/**
 * Build a StatusManager wired to a status bar, plus a hook to request a frame.
 *
 * Writes are dropped once the renderable is destroyed. The renderer tears its
 * tree down on Ctrl+C / SIGTERM / terminal close but leaves the event loop
 * running, so an unguarded spinner tick would assign to a destroyed TextBuffer
 * and throw out of a timer callback, taking the whole process with it.
 */
export function createStatusManager(
  bar: StatusBarTarget,
  onFrame: () => void,
): StatusManager {
  return new StatusManager((text) => {
    if (bar.isDestroyed) return;
    bar.content = ` ${text}`;
    onFrame();
  });
}
