import React, { useEffect, useRef, useState } from "react";
import { createOverlay } from "./story/overlay.js";
import { createStory } from "./story/engine.js";
import StoryBar from "./story/StoryBar.jsx";
import { createHost, buildSteps } from "./storyWiring.js";

// Story mode, loaded only when the viewer turns Story on (the shell lazy-loads this file, so Demo mode never pays for it). It fetches the wording, builds the
// engine from the script and the page host, starts the walk-through, and tears everything down when it is switched off. Changing Mock/Real mid-story
// restarts the story (the steps and the wording differ between the two).

const storage = () => { try { return window.localStorage; } catch { return null; } };

export default function StoryRoot({ mode, onExit, prefix = "a2a" }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState("");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const first = useRef(true);

  useEffect(() => {
    let live = true;
    let parts = null;
    fetch("/api/story", { headers: { Accept: "application/json" } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      })
      .then((captions) => {
        if (!live) return;
        const host = createHost({ mode: () => modeRef.current });
        const overlay = createOverlay();
        const s = createStory({ steps: buildSteps({ captions, host }), captions, overlay, host, store: storage(), prefix });
        let wasActive = false;
        s.subscribe((st) => { if (wasActive && !st.active && live) onExit(); wasActive = st.active; });
        parts = { host, overlay, s };
        setStory(s);
        s.start();
      })
      .catch((e) => { if (live) setError(e.message || "The Story wording could not be loaded."); });
    return () => {
      live = false;
      if (parts) { parts.s.destroy(); parts.host.dispose(); parts.overlay.destroy(); }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one story per time Story is switched on

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (story) story.restart();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- a mode switch restarts the walk-through

  if (error) {
    return (
      <div className="story-bar" role="alert" data-testid="story-error">
        <span className="story-msg">Story could not start: {error}</span>
        <button type="button" onClick={onExit}>Exit</button>
      </div>
    );
  }
  return story ? <StoryBar story={story} mock={mode === "mock"} /> : null;
}
