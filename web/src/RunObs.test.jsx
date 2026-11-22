import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import RunObs, { REREAD_MS } from "./RunObs";
import { mockRecord, realRecord } from "./run-observability/fixtures";

const answer = (mode, runBody) => vi.fn(async (url) => ({
  json: async () => (String(url).startsWith("/api/info") ? { mode, source: mode } : runBody),
}));
const done = () => act(async () => { window.dispatchEvent(new CustomEvent("paad:run-done")); });

describe("RunObs (rule 27 panel under the run)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test("before any run it fetches no record and shows the panel's empty state", async () => {
    const f = answer("mock", { record: mockRecord });
    vi.stubGlobal("fetch", f);
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual(["/api/info"]);
  });

  test("after a run it fetches the record and shows it under the page's mode", async () => {
    vi.stubGlobal("fetch", answer("mock", { record: mockRecord }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeInTheDocument());
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/mock/i);
  });

  test("a real record is shown in real mode", async () => {
    vi.stubGlobal("fetch", answer("real", { record: realRecord }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeInTheDocument());
  });

  test("a record from the other mode is refused on screen, never shown under the wrong label", async () => {
    vi.stubGlobal("fetch", answer("real", { record: mockRecord }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByTestId("ro-mismatch")).toBeInTheDocument());
  });

  test("no run yet: the server's message is shown, not a blank", async () => {
    vi.stubGlobal("fetch", answer("mock", { record: null, message: "No run yet. Send a prompt." }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByTestId("ro-none")).toHaveTextContent("No run yet"));
  });

  test("an error answer and an unreachable server both show as errors", async () => {
    vi.stubGlobal("fetch", answer("mock", { error: "internal_error", message: "The run observability record could not be built." }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be built/));
  });

  test("Reset clears the panel back to its empty state", async () => {
    vi.stubGlobal("fetch", answer("mock", { record: mockRecord }));
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await act(async () => { window.dispatchEvent(new CustomEvent("paad:reset")); });
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("ro-table")).toBeNull();
  });

  test("Real: the run is read once more after the collector's delay, and Re-read logs reads it again; Mock does neither", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = answer("real", { record: realRecord });
      vi.stubGlobal("fetch", f);
      render(<RunObs />);
      await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
      await done();
      const reads = () => f.mock.calls.filter((c) => String(c[0]).startsWith("/api/run-observability")).length;
      await waitFor(() => expect(reads()).toBe(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(REREAD_MS + 50); });
      expect(reads()).toBe(2);
      await act(async () => { screen.getByTestId("ro-reread").click(); });
      await waitFor(() => expect(reads()).toBe(3));
    } finally { vi.useRealTimers(); }
  });

  test("Mock: one read, no timer, no Re-read button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = answer("mock", { record: mockRecord });
      vi.stubGlobal("fetch", f);
      render(<RunObs />);
      await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
      await done();
      await act(async () => { await vi.advanceTimersByTimeAsync(REREAD_MS * 2); });
      expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/run-observability")).length).toBe(1);
      expect(screen.queryByTestId("ro-reread")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  test("switching mode after a run asks again, so a Mock record is not shown under Real", async () => {
    let mode = "mock";
    const f = vi.fn(async (url) => ({ json: async () => (String(url).startsWith("/api/info") ? { mode, source: mode } : (mode === "mock" ? { record: mockRecord } : { record: null, message: "The latest run was in Mock mode." })) }));
    vi.stubGlobal("fetch", f);
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done();
    await waitFor(() => expect(screen.getByTestId("ro-table")).toBeInTheDocument());
    mode = "real";
    await act(async () => { window.dispatchEvent(new CustomEvent("paad:mode", { detail: { mode: "real" } })); });
    await waitFor(() => expect(screen.getByTestId("ro-none")).toHaveTextContent("Mock mode"));
    expect(screen.queryByTestId("ro-table")).toBeNull();
  });

  test("an older read that finishes last cannot overwrite a newer one", async () => {
    const slow = { release: null };
    let n = 0;
    const f = vi.fn((url) => {
      if (String(url).startsWith("/api/info")) return Promise.resolve({ json: async () => ({ mode: "mock", source: "mock" }) });
      n += 1;
      if (n === 1) return new Promise((r) => { slow.release = () => r({ json: async () => ({ record: null, message: "OLD answer" }) }); });
      return Promise.resolve({ json: async () => ({ record: null, message: "NEW answer" }) });
    });
    vi.stubGlobal("fetch", f);
    render(<RunObs />);
    await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
    await done(); // read 1 is slow
    await done(); // read 2 answers at once
    await waitFor(() => expect(screen.getByTestId("ro-none")).toHaveTextContent("NEW answer"));
    await act(async () => { slow.release(); });
    expect(screen.getByTestId("ro-none")).toHaveTextContent("NEW answer");
  });

  test("Reset cancels the pending Real re-read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const f = answer("real", { record: realRecord });
      vi.stubGlobal("fetch", f);
      render(<RunObs />);
      await waitFor(() => expect(screen.getByTestId("ro-empty")).toBeInTheDocument());
      await done();
      await act(async () => { window.dispatchEvent(new CustomEvent("paad:reset")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(REREAD_MS * 2); });
      expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/run-observability")).length).toBe(1);
      expect(screen.getByTestId("ro-empty")).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
});
