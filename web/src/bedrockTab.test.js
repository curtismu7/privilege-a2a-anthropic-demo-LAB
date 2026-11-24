// The Gateway to Bedrock (IAM) tab in a real DOM: the three-tab bar, and the tab's own script driven by the same SSE stream POST /bedrock sends
// (the server's simulator, serialised here as the route does). The page's markup and scripts are imported as they are served.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AWS_TABS_HTML, TABS_SCRIPT } from "../../src/main-agent/awsTab.ts";
import { BEDROCK_DATA_SCRIPT, BEDROCK_PANEL_HTML, BEDROCK_TAB_SCRIPT } from "../../src/main-agent/bedrockTab.ts";
import { REEL_DATA_SCRIPT, REEL_SCRIPT } from "../../src/main-agent/reelUi.ts";
import { parseBedrockBody, simulateBedrock } from "../../src/bedrockSim.ts";

const run = (src) => new Function(src)();
const $ = (id) => document.getElementById(id);
const flush = () => new Promise((r) => setTimeout(r, 0));
const events = [];
const record = (e) => events.push([e.type, e.detail]);

/** A fetch that answers POST /bedrock with the simulator's SSE stream for the body it was sent; `hold` keeps the stream open until released. */
function sseFetch({ hold = false } = {}) {
  let release;
  const gate = hold ? new Promise((r) => { release = r; }) : Promise.resolve();
  const fn = vi.fn(async (_url, init) => {
    const parsed = parseBedrockBody(JSON.parse(init.body));
    if (!parsed.ok) return { ok: false, status: 400, body: null, json: async () => ({ error: parsed.error }) };
    const r = simulateBedrock(parsed.input);
    const frames = r.events.map((e, i) => `event: trace\ndata: ${JSON.stringify({ ...e, at: `${i}.0s` })}\n\n`);
    frames.push(r.answer !== undefined ? `event: token\ndata: ${JSON.stringify({ text: r.answer })}\n\nevent: done\ndata: {}\n\n` : `event: error\ndata: ${JSON.stringify({ error: r.error, ...(r.outcome === "blocked" ? { blocked: true } : {}) })}\n\n`);
    const enc = new TextEncoder();
    let i = 0;
    return {
      ok: true, status: 200,
      body: { getReader: () => ({ read: async () => {
        if (i === 1) await Promise.race([gate, new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))]);
        if (init.signal?.aborted) throw new Error("aborted");
        return i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true };
      } }) },
    };
  });
  return { fn, release: () => release && release() };
}

async function settle() { for (let k = 0; k < 20; k += 1) await flush(); }

beforeEach(() => {
  events.length = 0;
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = `${AWS_TABS_HTML}<main id="panel-review" role="tabpanel"><p id="review-trace"></p></main><section id="panel-aws" role="tabpanel" hidden></section>${BEDROCK_PANEL_HTML}`;
  for (const t of ["paad:run-start", "paad:run-end", "paad:run-done"]) window.addEventListener(t, record);
});
afterEach(() => {
  for (const t of ["paad:run-start", "paad:run-end", "paad:run-done"]) window.removeEventListener(t, record);
  vi.unstubAllGlobals(); delete window.Reel; delete window.REEL_DATA; delete window.BEDROCK_SCENARIOS;
});

describe("the tab bar, over three tabs", () => {
  const selected = () => ["review", "aws", "bedrock"].filter((k) => $(`tab-${k}`).getAttribute("aria-selected") === "true");
  const visible = () => ["review", "aws", "bedrock"].filter((k) => !$(`panel-${k}`).hidden);
  const key = (k, which) => $(`tab-${k}`).dispatchEvent(new KeyboardEvent("keydown", { key: which, bubbles: true }));

  test("a click selects the Bedrock tab, shows only its panel, moves the tab stop and sets #bedrock", () => {
    run(TABS_SCRIPT);
    $("tab-bedrock").click();
    expect(selected()).toEqual(["bedrock"]); expect(visible()).toEqual(["bedrock"]);
    expect($("tab-bedrock").tabIndex).toBe(0); expect($("tab-review").tabIndex).toBe(-1);
    expect(window.location.hash).toBe("#bedrock");
    $("tab-review").click();
    expect(window.location.hash).toBe(""); expect(visible()).toEqual(["review"]);
  });

  test("the arrows move one tab and wrap both ways; Home and End go to the ends; focus follows", () => {
    run(TABS_SCRIPT);
    key("review", "ArrowRight"); expect(selected()).toEqual(["aws"]); expect(document.activeElement).toBe($("tab-aws"));
    key("aws", "ArrowRight"); expect(selected()).toEqual(["bedrock"]);
    key("bedrock", "ArrowRight"); expect(selected()).toEqual(["review"]);
    key("review", "ArrowLeft"); expect(selected()).toEqual(["bedrock"]); expect(document.activeElement).toBe($("tab-bedrock"));
    key("bedrock", "ArrowLeft"); expect(selected()).toEqual(["aws"]);
    key("aws", "Home"); expect(selected()).toEqual(["review"]);
    key("review", "End"); expect(selected()).toEqual(["bedrock"]); expect(window.location.hash).toBe("#bedrock");
  });

  test("a page opened at #bedrock or #aws starts on that tab; any other hash stays on the first", () => {
    window.history.replaceState(null, "", "/#bedrock"); run(TABS_SCRIPT); expect(selected()).toEqual(["bedrock"]);
    document.body.innerHTML = document.body.innerHTML.replace(/aria-selected="true"/g, 'aria-selected="false"');
    window.history.replaceState(null, "", "/#aws"); run(TABS_SCRIPT); expect(selected()).toEqual(["aws"]);
    window.history.replaceState(null, "", "/#nope"); run(TABS_SCRIPT); expect(visible()).toContain("aws");
  });
});

describe("the Bedrock tab's script", () => {
  const start = (fetchStub) => { vi.stubGlobal("fetch", fetchStub); run(REEL_DATA_SCRIPT); run(REEL_SCRIPT); run(BEDROCK_DATA_SCRIPT); run(BEDROCK_TAB_SCRIPT); };
  const node = (id) => [$(`bedrock-n-${id}`).dataset.state, $(`bedrock-s-${id}`).textContent];
  const frames = () => [...document.querySelectorAll("#bedrock-reel .reel__title")].map((e) => e.textContent);

  test("a scenario button sets the settings, sends them, and the page shows the refusal: STS refused, a 502 the caller cannot read, the frames", async () => {
    const { fn } = sseFetch(); start(fn);
    $("bedrock-sc-wrong-ext").click(); await settle();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ message: expect.any(String), provider: "runtime", iam: true, identity: "cross", externalId: "wrong", sessionName: "privilege-ai-gateway", guard: { on: false, failClosed: true, reachable: true } });
    expect($("bedrock-role").value).toBe("cross"); expect($("bedrock-ext").value).toBe("wrong");
    expect(node("sts")).toEqual(["refused", "refused (AccessDenied)"]); expect(node("model")).toEqual(["skipped", "not reached"]);
    expect(frames()).toEqual(["Send the prompt", "Assume the role", "Refused"]);
    expect($("bedrock-answer").className).toBe("aws__answer is-error");
    expect($("bedrock-answer").textContent).toMatch(/^HTTP 502 · \{"error":"upstream_unreachable"\}/);
    expect(events.map((e) => e[0])).toEqual(["paad:run-start", "paad:run-end", "paad:run-done"]);
    expect(events[1][1]).toEqual({ ok: true });
  });

  test("blocked runs carry is-blocked; the guardrail node says why; an answered run is plain", async () => {
    const { fn } = sseFetch(); start(fn);
    $("bedrock-sc-denied").click(); await settle();
    expect($("bedrock-answer").className).toBe("aws__answer is-blocked"); expect(node("guard")).toEqual(["blocked", "blocked (denied topic)"]);
    $("bedrock-sc-fail-closed").click(); await settle();
    expect(node("guard")).toEqual(["blocked", "unreachable: blocked (Fail closed)"]); expect(frames()).toEqual(["Send the prompt", "Check the guardrail", "Blocked"]);
    $("bedrock-sc-fail-open").click(); await settle();
    expect($("bedrock-answer").className).toBe("aws__answer"); expect(node("guard")).toEqual(["skipped", "not inspected (warning)"]); expect(node("model")).toEqual(["ok", "answered"]);
    $("bedrock-sc-apikey").click(); await settle();
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body).iam).toBe(false); expect(node("sts")).toEqual(["skipped", "not used (stored key)"]);
    expect($("bedrock-role").disabled).toBe(true); expect($("bedrock-ext").disabled).toBe(true); expect($("bedrock-session").disabled).toBe(true);
    $("bedrock-sc-mantle").click(); await settle();
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body).provider).toBe("mantle");
    expect([...document.querySelectorAll("#bedrock-reel .reel__line")].at(-1).textContent).toBe("POST CreateInference + DeleteInference → 200");
  });

  test("the permissions shown follow the Provider, the guardrail and the Role ARN", () => {
    start(sseFetch().fn);
    const shown = () => [...document.querySelectorAll("#bedrock-perms li")].filter((li) => !li.hidden).map((li) => li.getAttribute("data-for"));
    expect(shown()).toEqual(["runtime", "runtime", "runtime"]);
    $("bedrock-provider").value = "mantle"; $("bedrock-provider").dispatchEvent(new Event("change"));
    expect(shown()).toEqual(["mantle", "mantle", "mantle"]);
    $("bedrock-role").value = "same"; $("bedrock-role").dispatchEvent(new Event("change"));
    $("bedrock-guard").checked = true; $("bedrock-guard").dispatchEvent(new Event("change"));
    expect(shown()).toEqual(["mantle", "mantle", "mantle", "guard", "role"]);
    expect($("bedrock-ext").disabled).toBe(false);
  });

  test("remote text is written as text: a question with markup shows as characters, and no element is made from it", async () => {
    const { fn } = sseFetch(); start(fn);
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    $("bedrock-input").value = evil; $("bedrock-form").dispatchEvent(new Event("submit", { cancelable: true })); await settle();
    expect(fn).toHaveBeenCalledTimes(1);
    expect($("panel-bedrock").querySelector("img")).toBeNull();
    expect([...$("panel-bedrock").querySelectorAll("b")].some((b) => b.textContent === "bold")).toBe(false);
    expect($("bedrock-trace").textContent).toContain("<img src=x onerror="); expect($("bedrock-trace").textContent).toContain("<b>bold</b>"); expect($("bedrock-answer").textContent).toContain("<img src=x");
    expect(window.__pwned).toBeUndefined();
  });

  test("an empty or blank question sends nothing and leaves Send enabled", async () => {
    const { fn } = sseFetch(); start(fn);
    for (const v of ["", "   "]) { $("bedrock-input").value = v; $("bedrock-form").dispatchEvent(new Event("submit", { cancelable: true })); }
    await settle();
    expect(fn).not.toHaveBeenCalled(); expect($("bedrock-send").disabled).toBe(false); expect(events).toEqual([]);
  });

  test("one run at a time: a double click sends once, and the buttons are off until the run ends; its events stay on its own tab", async () => {
    const { fn, release } = sseFetch({ hold: true }); start(fn); run(TABS_SCRIPT);
    $("bedrock-sc-own").click(); $("bedrock-sc-own").click(); $("bedrock-sc-cross").click(); await settle();
    expect(fn).toHaveBeenCalledTimes(1);
    expect($("bedrock-send").disabled).toBe(true); expect([...document.querySelectorAll("[data-scenario]")].every((b) => b.disabled)).toBe(true);
    $("tab-review").click();   // the viewer leaves mid-run
    release(); await settle();
    expect($("bedrock-send").disabled).toBe(false); expect(node("model")).toEqual(["ok", "answered"]);
    expect($("review-trace").textContent).toBe(""); expect($("bedrock-trace").querySelectorAll("li.aws__step").length).toBe(3);
  });

  test("Reset aborts a run in flight and empties the tab: nodes waiting, no answer, no frames, the empty-trace line back, buttons on", async () => {
    const { fn } = sseFetch({ hold: true }); start(fn);
    $("bedrock-sc-cross").click(); await settle();
    expect($("bedrock-trace").querySelectorAll("li.aws__step").length).toBe(1);
    window.dispatchEvent(new CustomEvent("paad:reset")); await settle();
    expect($("bedrock-trace").textContent).toMatch(/^Pick a scenario or send a question/);
    expect($("bedrock-answer").textContent).toBe(""); expect(frames()).toEqual([]);
    expect(["main", "gateway", "sts", "guard", "model"].map((id) => node(id)[0])).toEqual(["idle", "idle", "idle", "idle", "idle"]);
    expect($("bedrock-send").disabled).toBe(false);
    expect(events.find((e) => e[0] === "paad:run-end")[1]).toEqual({ ok: false });
    expect(events.some((e) => e[0] === "paad:run-done")).toBe(false);
  });

  test("a refused body shows the server's reason, and the run is announced as failed", async () => {
    const { fn } = sseFetch(); start(fn);
    $("bedrock-role").value = "same"; $("bedrock-role").dispatchEvent(new Event("change"));
    $("bedrock-session").value = "has space";
    $("bedrock-input").value = "hi"; $("bedrock-form").dispatchEvent(new Event("submit", { cancelable: true })); await settle();
    expect($("bedrock-answer").textContent).toBe("Request failed: HTTP 400: sessionName must be 2 to 64 of letters, digits and _+=,.@-");
    expect(node("main")).toEqual(["error", "stopped"]);
    expect(events.find((e) => e[0] === "paad:run-end")[1]).toEqual({ ok: false });
  });
});
