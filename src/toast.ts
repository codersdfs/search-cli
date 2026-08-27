/** Toast popup — absolute-positioned card pinned top-right, auto-hides. */
import { BoxRenderable, TextRenderable } from "@opentui/core";

/** Only the color keys the toast reads (lazily, so runtime theme swaps apply). */
export interface ToastColors {
  green: string;
  yellow: string;
  text: string;
  surfaceDim: string;
}

export function createToast(
  renderer: Parameters<BoxRenderable["constructor"]>[0],
  root: { add(child: unknown): unknown },
  colors: ToastColors,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const box = new BoxRenderable(renderer, {
    visible: false,
    position: "absolute",
    top: 1,
    right: 2,
    height: 3,
    border: true,
    borderStyle: "rounded",
    borderColor: colors.green,
    backgroundColor: colors.surfaceDim,
    zIndex: 100,
  });
  const text = new TextRenderable(renderer, {
    content: "",
    color: colors.text,
    backgroundColor: colors.surfaceDim,
    height: 1,
  });
  box.add(text);
  root.add(box);

  return {
    /** Show a message; accent picks the border color. Re-showing resets the timer. */
    show(msg: string, ms = 2000, accent?: string): void {
      text.content = msg;
      box.borderColor = accent ?? colors.green;
      // Message + paddingX(2) + side borders(2)
      box.width = msg.length + 4;
      box.visible = true;
      renderer.requestRender();
      clearTimeout(timer);
      timer = setTimeout(() => {
        box.visible = false;
        renderer.requestRender();
      }, ms);
    },
    hide(): void {
      clearTimeout(timer);
      if (!box.visible) return;
      box.visible = false;
      renderer.requestRender();
    },
    get visible(): boolean {
      return box.visible;
    },
    get borderColor(): string {
      return box.borderColor as string;
    },
  };
}

export type Toast = ReturnType<typeof createToast>;
