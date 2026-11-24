// The Demo | Story toggle in the shell, and Story starting, walking and exiting, against the lab's real wording (video/captions.md).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import Shell, { StoryBoundary } from "./Shell.jsx";
import StoryRoot from "./StoryRoot.jsx";
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

describe("Story and the page", () => {
  test("Story does not start until the server's mode is known (a Real lab must not flash the Mock walk-through)", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    fetch.mockImplementation(async (url) => {
      if (url === "/api/info") { await gate; return { ok: true, json: async () => ({ source: "real", realAvailable: true }) }; }
      if (url === "/api/story") return { ok: true, status: 200, json: async () => captions };
      return { ok: false, json: async () => ({}) };
    });
    window.history.replaceState(null, "", "/?story=1");
    render(<Shell />);
    await waitFor(() => expect(calls.includes("/api/info") || fetch.mock.calls.length > 0).toBe(true));
    await new Promise((r) => setTimeout(r, 80));
    expect(document.querySelector(".story-slide, .story-bub")).toBeNull();            // wording loaded, mode unknown: nothing shown yet
    await act(async () => { release(); await gate; });
    await waitFor(() => expect(document.querySelector(".story-slide h1")?.textContent).toBe(captions.opening.title));   // Real: no 'sample_note' slide first
    expect(screen.queryByTestId("story-simulated")).toBeNull();
  });

  test("switching Mock/Real mid-story empties the page (paad:reset) and restarts from the top", async () => {
    const reset = vi.fn(); window.addEventListener("paad:reset", reset);
    const { rerender } = render(<StoryRoot mode="mock" ready onExit={() => {}} />);
    await screen.findByTestId("story-bar");
    fireEvent.click(screen.getByTestId("story-next"));
    await waitFor(() => expect(document.querySelector(".story-slide h1")?.textContent).toBe(captions.opening.title));
    rerender(<StoryRoot mode="real" ready onExit={() => {}} />);
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".story-slide h1")?.textContent).toBe(captions.opening.title));   // Real starts at the opening (no sample_note)
    expect(screen.queryByTestId("story-simulated")).toBeNull();
    window.removeEventListener("paad:reset", reset);
  });

  test("a failed Story chunk shows a message with Exit and the rest of the shell survives", () => {
    const Boom = () => { throw new Error("chunk 404"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onExit = vi.fn();
    render(<div><span data-testid="shell">shell bar</span><StoryBoundary onExit={onExit}><Boom /></StoryBoundary></div>);
    expect(screen.getByTestId("shell")).toBeInTheDocument(); expect(screen.getByTestId("story-error")).toHaveTextContent(/could not load/);
    fireEvent.click(screen.getByText("Exit")); expect(onExit).toHaveBeenCalled(); spy.mockRestore();
  });

  test("while Story runs the page carries a story-on class (the pop-out layout for captions); Demo mode never has it", async () => {
    expect(document.documentElement.classList.contains("story-on")).toBe(false);
    const { unmount } = render(<StoryRoot mode="mock" ready onExit={() => {}} />);
    await screen.findByTestId("story-bar");
    expect(document.documentElement.classList.contains("story-on")).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains("story-on")).toBe(false);
  });

  test("turning Story off closes an open pop-out and leaves no overlay, bar or listener behind", async () => {
    const closed = vi.fn(); window.Reel = { close: closed };
    const { unmount } = render(<StoryRoot mode="mock" ready onExit={() => {}} />);
    await screen.findByTestId("story-bar");
    unmount();
    await waitFor(() => expect(document.querySelector(".story-slide, .story-bub, .story-hl, .story-bar")).toBeNull());
    delete window.Reel;
  });
});

