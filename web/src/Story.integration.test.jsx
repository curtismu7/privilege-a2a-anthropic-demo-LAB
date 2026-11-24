// The Demo | Story toggle in the shell, and Story starting, walking and exiting, against the lab's real wording (video/captions.md).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import Shell from "./Shell.jsx";
import { storyKey } from "./story/StoryToggle.jsx";
import { parseCaptions } from "../../server/src/story/captions.js";

import { existsSync } from "node:fs";
// vitest runs from web/ (npm test -w web) or the repo root; the wording file is the lab's own video/captions.md
const captionsFile = ["../video/captions.md", "video/captions.md"].find((f) => existsSync(f));
const captions = parseCaptions(readFileSync(captionsFile, "utf8"));
const calls = [];

beforeEach(() => {
  localStorage.clear(); calls.length = 0; document.body.innerHTML = ""; window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    calls.push(String(url));
    if (url === "/api/info") return { ok: true, json: async () => ({ source: "mock", realAvailable: true }) };
    if (url === "/api/shelf") return { ok: false, json: async () => ({}) };
    if (url === "/api/story") return { ok: true, status: 200, json: async () => captions };
    return { ok: false, json: async () => ({}) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the toggle", () => {
  test("Demo is the default: no Story code is requested and no bar is shown", async () => {
    render(<Shell />);
    expect(await screen.findByTestId("story-toggle-demo")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("story-bar")).toBeNull(); expect(calls).not.toContain("/api/story");
  });

  test("choosing Story fetches the wording and starts the walk-through (Mock: simulated, then the opening slide)", async () => {
    render(<Shell />);
    fireEvent.click(await screen.findByTestId("story-toggle-story"));
    expect(await screen.findByTestId("story-bar")).toBeInTheDocument();
    expect(calls).toContain("/api/story");
    expect(screen.getByTestId("story-simulated")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".story-slide h1")?.textContent).toBe(captions.slides.sample_note.title));   // Mock says so first
    fireEvent.click(screen.getByTestId("story-next"));
    await waitFor(() => expect(document.querySelector(".story-slide h1")?.textContent).toBe(captions.opening.title));
  });

  test("?story=1 turns Story on at load", async () => {
    window.history.replaceState(null, "", "/?story=1");
    render(<Shell />);
    expect(await screen.findByTestId("story-bar")).toBeInTheDocument();
  });

  test("Exit leaves Story: back to Demo, remembered, ?story=1 dropped, no overlay left behind", async () => {
    window.history.replaceState(null, "", "/?story=1");
    render(<Shell />);
    fireEvent.click(await screen.findByTestId("story-exit"));
    await waitFor(() => expect(screen.queryByTestId("story-bar")).toBeNull());
    expect(screen.getByTestId("story-toggle-demo")).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(storyKey("a2a"))).toBe("demo"); expect(window.location.search).toBe("");
    expect(document.querySelector(".story-slide, .story-bub, .story-hl")).toBeNull();
  });

  test("switching back to Demo with the toggle tears Story down", async () => {
    render(<Shell />);
    fireEvent.click(await screen.findByTestId("story-toggle-story")); await screen.findByTestId("story-bar");
    fireEvent.click(screen.getByTestId("story-toggle-demo"));
    await waitFor(() => expect(screen.queryByTestId("story-bar")).toBeNull());
    expect(document.querySelector(".story-slide, .story-bub, .story-hl")).toBeNull();
  });

  test("if the wording cannot be loaded the bar says so and Exit gets out; the page is not left half in Story", async () => {
    fetch.mockImplementation(async (url) => (url === "/api/story" ? { ok: false, status: 500, json: async () => ({ error: "Story wording could not be read: captions.md: no \"# Opening Slide\" section found" }) } : url === "/api/info" ? { ok: true, json: async () => ({ source: "mock" }) } : { ok: false, json: async () => ({}) }));
    render(<Shell />);
    fireEvent.click(await screen.findByTestId("story-toggle-story"));
    expect(await screen.findByTestId("story-error")).toHaveTextContent(/Opening Slide/);
    fireEvent.click(screen.getByText("Exit"));
    await waitFor(() => expect(screen.queryByTestId("story-error")).toBeNull());
  });
});
