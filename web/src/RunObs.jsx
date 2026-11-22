import React, { useEffect, useRef, useState } from "react";
import RunObservability from "./run-observability/RunObservability";

// Rule 27: where this lab's own logs live and where they stream (the README says the same).
export const RUN_OBS_STREAMS = [
  { product: "This lab's main agent (stdout)", lives: "the container's stdout: one timestamped line per decision (run id, actor, target, outcome; never a token or a message body)", streams: "the family log collector to demo-logs-privilege-a2a-lab, then a SIEM, when the collector watches this container" },
  { product: "PingFederate", lives: "its audit log, in the PingFederate container", streams: "not shipped by the collector yet (only server.log reaches stdout), so sign-in and token events read as not logged" },
  { product: "Privilege agent gateway and console", lives: "the hosted gateway: the SIEM index ping-siem-events-v2 and the console Activity Logs (only allowed calls appear there); a local gateway: cyonproxy.log", streams: "the Privilege SIEM export; the local gateway file through the collector to ping-logs-privilege-gateway" },
  { product: "MCP server (this lab)", lives: "the MCP container's stdout", streams: "the collector to demo-logs-mcp-server" },
];

const jsonOrNull = (r) => r.json().catch(() => null);
/** The collector ships lines with a delay, so a Real run is read again once after this long (and on the Re-read logs button). */
export const REREAD_MS = 5000;

/**
 * What each layer logged for the latest run (rule 27), under the Run. The page script announces two events: paad:mode
 * (the mode, which the panel needs as `source`) and paad:run-done (a run finished, fetch its record). Nothing is fetched
 * before a run: the panel's own empty state says so.
 */
export default function RunObs() {
  const [mode, setMode] = useState(null);
  const [ran, setRan] = useState(false);
  const [state, setState] = useState(null); // null = nothing asked, { pending } while fetching, { record, message }
  const reload = useRef(() => {});
  const timer = useRef(null);
  const modeRef = useRef(null);

  useEffect(() => {
    let live = true;
    fetch("/api/info", { headers: { Accept: "application/json" } })
      .then(jsonOrNull)
      .then((info) => { if (live && info) setMode((info.source || info.mode) === "real" ? "real" : "mock"); })
      .catch(() => { /* the paad:mode event still sets it */ });
    const onMode = (e) => setMode(e.detail && e.detail.mode === "real" ? "real" : "mock");
    const onReset = () => { setRan(false); setState(null); };
    const load = () => {
      setState((s) => ({ ...(s || {}), pending: true }));
      return fetch("/api/run-observability", { headers: { Accept: "application/json" } })
        .then(jsonOrNull)
        .then((b) => { if (live) setState(b && "record" in b ? { record: b.record, message: b.message } : { record: b || { error: "unreachable", message: "The server answered with something that is not JSON." } }); })
        .catch(() => { if (live) setState({ record: { error: "unreachable", message: "Could not reach the server." } }); });
    };
    reload.current = load;
    const onDone = () => {
      setRan(true);
      clearTimeout(timer.current);
      load();
      // Real only: the logs arrive late, so read once more after a few seconds (Mock rows are computed, nothing to wait for).
      if (modeRef.current === "real") timer.current = setTimeout(load, REREAD_MS);
    };
    window.addEventListener("paad:mode", onMode);
    window.addEventListener("paad:reset", onReset);
    window.addEventListener("paad:run-done", onDone);
    return () => { live = false; clearTimeout(timer.current); window.removeEventListener("paad:mode", onMode); window.removeEventListener("paad:reset", onReset); window.removeEventListener("paad:run-done", onDone); };
  }, []);

  modeRef.current = mode;
  if (!mode) return null; // the mode is the panel's required `source`; until it is known nothing is claimed
  if (ran && state && state.pending && !state.record) return <p className="ro-muted" data-testid="ro-loading">Collecting this run's logs...</p>;
  if (ran && state && !state.record && state.message) return <p className="ro-muted" data-testid="ro-none">{state.message}</p>;
  return (
    <>
      <RunObservability record={ran && state ? state.record : null} source={mode} streams={RUN_OBS_STREAMS} />
      <p className="ro-muted" data-testid="ro-gateway-note">The Agent gateway lane also carries this lab's own decision lines (what the lab saw the gateway do), read from the lab's log under its own name. Real runs read the logs from 2 s before to 2 s after the run; a line found only by its time says so.</p>
      {mode === "real" && ran && <button type="button" className="ro-reread" data-testid="ro-reread" onClick={() => reload.current()}>Re-read logs</button>}
    </>
  );
}
