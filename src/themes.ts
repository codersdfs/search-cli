/**
 * Theme system — 3 built-in palettes. Apply theme to TUI colors.
 */
export interface Theme {
  name: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  blue: string;
  green: string;
  yellow: string;
  red: string;
  teal: string;
  purple: string;
  orange: string;
  border: string;
  selectionBg: string;
  selectionText: string;
}

const THEMES: Record<string, Theme> = {
  "tokyo-night": {
    name: "tokyo-night",
    bg: "#1e1e2e", surface: "#181825", text: "#cdd6f4", muted: "#6c7086",
    blue: "#89b4fa", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
    teal: "#94e2d5", purple: "#cba6f7", orange: "#fab387",
    border: "#45475a", selectionBg: "#2d5bcf", selectionText: "#ffffff",
  },
  dracula: {
    name: "dracula",
    bg: "#282a36", surface: "#21222c", text: "#f8f8f2", muted: "#6272a4",
    blue: "#8be9fd", green: "#50fa7b", yellow: "#f1fa8c", red: "#ff5555",
    teal: "#50fa7b", purple: "#bd93f9", orange: "#ffb86c",
    border: "#44475a", selectionBg: "#bd93f9", selectionText: "#282a36",
  },
  monokai: {
    name: "monokai",
    bg: "#272822", surface: "#1e1f1c", text: "#f8f8f2", muted: "#75715e",
    blue: "#66d9ef", green: "#a6e22e", yellow: "#e6db74", red: "#f92672",
    teal: "#a6e22e", purple: "#ae81ff", orange: "#fd971f",
    border: "#49483e", selectionBg: "#e6db74", selectionText: "#272822",
  },
};

export function loadTheme(name: string): Theme {
  return THEMES[name] ?? THEMES["tokyo-night"];
}

export function listThemes(): string[] {
  return Object.keys(THEMES);
}
