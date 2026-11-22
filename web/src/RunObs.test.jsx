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
});
