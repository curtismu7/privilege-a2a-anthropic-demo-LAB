// The shell bar island: the shared TopMenu wired to the lab's server (rule 19 mode switch, theme, text size, shelf, Reset).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Shell, { FONT_KEY, REAL_HINT, SETUP_URL, THEME_KEY } from "./Shell.jsx";

// Node can expose a half-working global localStorage that shadows jsdom's; a plain in-memory one keeps the tests honest.
const store = new Map();
const memoryStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake server: info = what GET /api/info says; modeAnswer(body) = what POST /api/mode answers. */
function serve({ info = { source: "mock", realAvailable: true }, shelf = { shelfUrl: null }, modeAnswer = (b) => json(200, { ok: true, mode: b.source }) } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/info") return json(200, info);
    if (url === "/api/shelf") return json(200, shelf);
    if (url === "/api/mode") return modeAnswer(JSON.parse(init.body));
    return json(404, {});
  });
  return calls;
}

const modeEvents = [];
const onMode = (e) => modeEvents.push(e.detail.mode);

beforeEach(() => {
  store.clear();
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("--fs");
  modeEvents.length = 0;
  window.addEventListener("paad:mode", onMode);
});
afterEach(() => { cleanup(); window.removeEventListener("paad:mode", onMode); });

describe("mode dropdown (rule 19)", () => {
  it("is a Mock/Real select showing the server's current mode, and tells the page script", async () => {
    serve({ info: { source: "real", mode: "real", realAvailable: true } });
    render(<Shell />);
    const select = screen.getByTestId("mode-select");
    expect(select.tagName).toBe("SELECT");
    await waitFor(() => expect(select.value).toBe("real"));
    expect(modeEvents).toEqual(["real"]);
    expect(screen.queryByRole("button", { name: /^Mock$/ })).toBeNull(); // no longer a pair of pressed buttons
  });

  it("switches both ways through POST /api/mode with exactly {source}, and announces each result", async () => {
    const calls = serve({ info: { source: "real", realAvailable: true } });
    render(<Shell />);
    const select = screen.getByTestId("mode-select");
    await waitFor(() => expect(select.value).toBe("real"));
    fireEvent.change(select, { target: { value: "mock" } });
    await waitFor(() => expect(select.value).toBe("mock"));
    fireEvent.change(select, { target: { value: "real" } });
    await waitFor(() => expect(select.value).toBe("real"));
    expect(calls.filter((c) => c.url === "/api/mode")).toEqual([
      { url: "/api/mode", method: "POST", body: { source: "mock" } },
      { url: "/api/mode", method: "POST", body: { source: "real" } },
    ]);
    expect(modeEvents).toEqual(["real", "mock", "real"]);
  });

  it("disables Real with the how-to hint while Real is not configured", async () => {
    serve({ info: { source: "mock", realAvailable: false } });
    render(<Shell />);
    const real = screen.getByTestId("mode-real");
    await waitFor(() => expect(real.disabled).toBe(true));
    expect(real.title).toBe(REAL_HINT);
    expect(screen.getByTestId("mode-select").value).toBe("mock");
  });

  it("links to the setup guide exactly while Real is unavailable (never while it is available or not yet known)", async () => {
    serve({ info: { source: "mock", realAvailable: false } });
    render(<Shell />);
    const link = await screen.findByTestId("setup-link");
    expect(link.getAttribute("href")).toBe(SETUP_URL);
    expect(link.textContent).toBe("How to set up Real");
    expect(link.getAttribute("rel")).toBe("noopener");
    cleanup();
    serve({ info: { source: "mock", realAvailable: true } });
    render(<Shell />);
    await waitFor(() => expect(modeEvents.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("setup-link")).toBeNull();
    cleanup();
    globalThis.fetch = vi.fn(() => new Promise(() => {})); // /api/info never answers: availability unknown
    render(<Shell />);
    expect(screen.queryByTestId("setup-link")).toBeNull();
  });

  it("on a 409 keeps the old value, shows the server's reason, and does not announce a change", async () => {
    serve({ info: { source: "mock", realAvailable: true }, modeAnswer: () => json(409, { error: "real_not_available", message: "Real needs a model provider. Mock works offline." }) });
    render(<Shell />);
    const select = screen.getByTestId("mode-select");
    await waitFor(() => expect(modeEvents).toEqual(["mock"]));
    fireEvent.change(select, { target: { value: "real" } });
    expect((await screen.findByTestId("mode-note")).textContent).toBe("Real needs a model provider. Mock works offline.");
    expect(select.value).toBe("mock");
    expect(modeEvents).toEqual(["mock"]);
    await waitFor(() => expect(screen.getByTestId("mode-real").disabled).toBe(true)); // Real is now known to be unavailable
  });

  it("on a 409 with no message falls back to the realHint, and a dead server keeps the old value too", async () => {
    serve({ modeAnswer: () => json(409, {}) });
    render(<Shell />);
    const select = screen.getByTestId("mode-select");
    await waitFor(() => expect(modeEvents.length).toBe(1));
    fireEvent.change(select, { target: { value: "real" } });
    expect((await screen.findByTestId("mode-note")).textContent).toBe(REAL_HINT);
    cleanup();
    serve({ modeAnswer: () => { throw new Error("connection refused"); } });
    render(<Shell />);
    fireEvent.change(screen.getByTestId("mode-select"), { target: { value: "real" } });
    expect((await screen.findByTestId("mode-note")).textContent).toMatch(/Could not switch mode: connection refused/);
    expect(screen.getByTestId("mode-select").value).toBe("mock");
  });
});

describe("theme and text size", () => {
  it("applies the stored theme and keeps data-theme and the paad.theme key as the page always did", async () => {
    store.set(THEME_KEY, "dark");
    serve();
    render(<Shell />);
    const theme = screen.getByTestId("theme-select");
    expect(theme.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.change(theme, { target: { value: "light" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(store.get(THEME_KEY)).toBe("light");
    fireEvent.change(theme, { target: { value: "auto" } });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(store.get(THEME_KEY)).toBe("auto");
  });

  it("sets --fs from S/M/L and A-/A+, and persists it under pa2a.font", async () => {
    store.set(FONT_KEY, "L");
    serve();
    render(<Shell />);
    expect(screen.getByTestId("font-select").value).toBe("L");
    expect(document.documentElement.style.getPropertyValue("--fs")).toBe("18px");
    fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    expect(document.documentElement.style.getPropertyValue("--fs")).toBe("16px");
    fireEvent.click(screen.getByRole("button", { name: "Smaller text" }));
    expect(document.documentElement.style.getPropertyValue("--fs")).toBe("14px");
    expect(store.get(FONT_KEY)).toBe("S");
    fireEvent.change(screen.getByTestId("font-select"), { target: { value: "M" } });
    expect(document.documentElement.style.getPropertyValue("--fs")).toBe("16px");
    expect(store.get(FONT_KEY)).toBe("M");
  });

  it("falls back to Auto and M when the stored values are junk", () => {
    store.set(THEME_KEY, "neon");
    store.set(FONT_KEY, "XL");
    serve();
    render(<Shell />);
    expect(screen.getByTestId("theme-select").value).toBe("auto");
    expect(screen.getByTestId("font-select").value).toBe("M");
  });
});

describe("shelf, Reset and the controls this lab does not have", () => {
  it("renders the Shelf link only when /api/shelf has a URL", async () => {
    serve({ shelf: { shelfUrl: "https://shelf.example:8443" } });
    render(<Shell />);
    const link = await screen.findByTestId("shelf-link");
    expect(link.getAttribute("href")).toBe("https://shelf.example:8443");
    cleanup();
    serve({ shelf: { shelfUrl: null } });
    render(<Shell />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/shelf", expect.anything()));
    expect(screen.queryByTestId("shelf-link")).toBeNull();
  });

  it("Reset sends paad:reset to the page script", () => {
    serve();
    const seen = vi.fn();
    window.addEventListener("paad:reset", seen);
    render(<Shell />);
    fireEvent.click(screen.getByTestId("reset"));
    window.removeEventListener("paad:reset", seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("has no Help, Version, Present, Talk track, Vertical or Sign in control (never a control that does nothing)", () => {
    serve();
    render(<Shell />);
    for (const id of ["help-link", "version", "presenter", "talk-track-toggle", "vertical-select", "sign-in"]) expect(screen.queryByTestId(id)).toBeNull();
  });
});
