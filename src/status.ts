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

  constructor(onUpdate: (text: string) => void) {
    this.onUpdate = onUpdate;
  }

  set(type: StatusType, message: string): void {
    this.stopSpinner();
    this.type = type;
    this.message = message;

    if (type === "searching" || type === "loading") {
      this.startSpinner(type === "searching" ? SEARCH_SPINNER : LOADING_SPINNER);
    } else {
      this.emit();
    }
  }

  private startSpinner(frames: string[]): void {
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
    const icon = this.type === "searching" ? "🔍"
      : this.type === "loading" ? "📦"
      : this.type === "success" ? "✓"
      : this.type === "error" ? "⚠"
      : " ";
    const prefix = spinner ?? "";
    this.onUpdate(`${icon} ${this.message}  ${prefix}`.trim());
  }

  dispose(): void {
    this.stopSpinner();
  }
}
