// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { VISUAL_THEMES, followSystemTheme, useTheme } from "../src/app/theme";

function stubThemeMedia(matches = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media as unknown as MediaQueryList),
  );
  return { listeners, media };
}

describe("system theme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.visualTheme;
    window.localStorage.clear();
    useTheme.setState({ preference: "system", theme: "light", visualTheme: "editorial" });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows the initial system preference and later changes", () => {
    const { listeners } = stubThemeMedia();

    const stop = followSystemTheme();
    expect(document.documentElement.dataset.theme).toBe("light");

    for (const listener of listeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
    expect(document.documentElement.dataset.theme).toBe("dark");

    stop();
    expect(listeners).toHaveLength(0);
  });

  it("toggles to the opposite theme and then restores system following", () => {
    const { listeners } = stubThemeMedia();
    const stop = followSystemTheme();

    useTheme.getState().toggleTheme();
    expect(useTheme.getState()).toMatchObject({
      preference: "dark",
      theme: "dark",
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    for (const listener of listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }
    expect(document.documentElement.dataset.theme).toBe("dark");

    useTheme.getState().toggleTheme();
    expect(useTheme.getState()).toMatchObject({
      preference: "system",
      theme: "light",
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.length).toBe(0);

    stop();
  });

  it("offers the new authored visual directions and persists a selection", () => {
    expect(VISUAL_THEMES.map((option) => option.id)).toEqual([
      "editorial",
      "publisher",
      "typewriter",
      "lacquer",
      "lighthouse",
      "observatory",
      "night",
      "forest",
      "indigo",
      "amber",
    ]);

    useTheme.getState().setVisualTheme("typewriter");
    expect(document.documentElement.dataset.visualTheme).toBe("typewriter");
    expect(window.localStorage.getItem("narralume:visual-theme")).toBe("typewriter");
  });
});
