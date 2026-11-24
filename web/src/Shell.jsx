import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import StoryToggle, { storyKey } from "./story/StoryToggle.jsx";

// Story mode is loaded only when the viewer switches it on, so the page in Demo mode does not pay for it.
const StoryRoot = lazy(() => import("./StoryRoot.jsx"));
export const STORY_PREFIX = "a2a";

// If the Story chunk cannot load (the lab was rebuilt, a stale file name, the network) the shell bar must survive: Demo mode is never taken down by Story.
export class StoryBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="story-bar" role="alert" data-testid="story-error">
        <span className="story-msg">Story could not load. Reload the page and try again.</span>
        <button type="button" onClick={this.props.onExit}>Exit</button>
      </div>
    );
  }
}

// The shell bar's controls for the lab page. The page itself stays server-rendered with its own vanilla script; this island
// renders only the shared TopMenu and talks to that script through three window events and nothing else:
//   paad:mode   (detail.mode = "mock" | "real")  the current mode, sent once it is known and after every switch
//   paad:reset  the Reset button was pressed; the page script clears the chat and the trace
// The page script keeps window.__uiMode() and reads the mode from paad:mode, so the chat code is unchanged.

export const THEME_KEY = "paad.theme"; // the keys the page already used
export const FONT_KEY = "pa2a.font";
export const REAL_HINT = "Real needs a model provider: set ANTHROPIC_API_KEY (or a Groq/llama.cpp config) and restart. Mock (heuristics) works offline.";

const FONT_STEPS = ["S", "M", "L"];
const THEMES = ["auto", "light", "dark"];

const readStore = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const writeStore = (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* storage blocked: the choice just does not persist */ } };

const announceMode = (mode) => window.dispatchEvent(new CustomEvent("paad:mode", { detail: { mode } }));

// "auto" leaves data-theme off so the OS setting decides, as the page always did.
const applyTheme = (theme) => {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
};

export default function Shell() {
  const [mode, setMode] = useState("mock");
  const [realAvailable, setRealAvailable] = useState(null); // null until /api/info answers
  const [note, setNote] = useState("");
  const [shelfUrl, setShelfUrl] = useState(null);
  const [theme, setTheme] = useState(() => (THEMES.includes(readStore(THEME_KEY)) ? readStore(THEME_KEY) : "auto"));
  const [fontStep, setFontStep] = useState(() => (FONT_STEPS.includes(readStore(FONT_KEY)) ? readStore(FONT_KEY) : "M"));
  const [storyOn, setStoryOn] = useState(false);
  const [modeKnown, setModeKnown] = useState(false); // Story waits for the server's mode: it must not start in the wrong one
  const [toggleKey, setToggleKey] = useState(0);

  // Rule 19: the mode shown is the server's current mode (GET /api/info `source`), never the launch mode.
  useEffect(() => {
    let live = true;
    fetch("/api/info", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((info) => {
        if (!live) return;
        const current = (info.source || info.mode) === "real" ? "real" : "mock";
        setMode(current);
        setRealAvailable(info.realAvailable !== false);
        announceMode(current);
        setModeKnown(true);
      })
      .catch(() => { if (live) setModeKnown(true); /* the select stays on Mock, which is what the page script assumes too */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/shelf", { credentials: "omit", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && d.shelfUrl) setShelfUrl(d.shelfUrl); })
      .catch(() => { /* no shelf configured or unreachable: no button */ });
    return () => { live = false; };
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyFontSize(fontStep); }, [fontStep]);

  const changeMode = useCallback(async (next) => {
    setNote("");
    try {
      const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: next }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const current = body.mode === "real" ? "real" : "mock";
        setMode(current);
        announceMode(current);
        return;
      }
      // Not switched (409 when Real is not configured): the select keeps its old value and the reason shows next to it.
      if (res.status === 409) setRealAvailable(false);
      setNote(res.status === 409 ? body.message || REAL_HINT : body.message || body.error || "The mode was not changed.");
    } catch (error) {
      setNote(`Could not switch mode: ${error.message}`);
    }
  }, []);

  const changeTheme = (next) => { setTheme(next); writeStore(THEME_KEY, next); };
  const changeFont = (next) => { setFontStep(next); writeStore(FONT_KEY, next); };
  const reset = () => window.dispatchEvent(new CustomEvent("paad:reset"));
  const onView = useCallback((on) => setStoryOn(on), []);
  // Exit in the Story bar: back to Demo, remembered, and ?story=1 dropped from the address so a reload stays in Demo.
  const leaveStory = useCallback(() => {
    writeStore(storyKey(STORY_PREFIX), "demo");
    try { const u = new URL(window.location.href); if (u.searchParams.has("story")) { u.searchParams.delete("story"); window.history.replaceState(null, "", u); } } catch { /* no address to tidy */ }
    setToggleKey((k) => k + 1);
  }, []);

  return (
    <>
    <TopMenu
      mode={{ value: mode, onChange: changeMode, realAvailable, realHint: REAL_HINT }}
      theme={{ value: theme, onChange: changeTheme }}
      fontSize={{ value: fontStep, onChange: changeFont }}
      shelfUrl={shelfUrl || undefined}
      onReset={reset}
      extra={<>{note ? <span className="shell-note" role="alert" data-testid="mode-note">{note}</span> : null}<StoryToggle key={toggleKey} prefix={STORY_PREFIX} onChange={onView} /></>}
    />
    {storyOn ? <StoryBoundary onExit={leaveStory}><Suspense fallback={null}><StoryRoot mode={mode} ready={modeKnown} onExit={leaveStory} prefix={STORY_PREFIX} /></Suspense></StoryBoundary> : null}
    </>
  );
}
