// The lab's Story glue: the host (run events, prompts, tabs), the script turned into engine steps, the pop-out hooks and the live fact lines.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHost, buildSteps, firstSentence, NOT_YET } from "./storyWiring.js";
import { STEPS } from "./storyScript.js";
import { parseCaptions } from "../../server/src/story/captions.js";

import { existsSync } from "node:fs";
// vitest runs from web/ (npm test -w web) or the repo root; the wording file is the lab's own video/captions.md
const captionsFile = ["../video/captions.md", "video/captions.md"].find((f) => existsSync(f));
const captions = parseCaptions(readFileSync(captionsFile, "utf8"));
const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); delete window.Reel; });

describe("firstSentence", () => {
  test("cuts at the first full stop, takes the first line, and never cuts mid-word", () => {
    expect(firstSentence("Bob can reach three systems. The rest is detail.")).toBe("Bob can reach three systems.");
    expect(firstSentence("one\ntwo")).toBe("one");
    expect(firstSentence("word ".repeat(60), 20)).toBe("word word word word...");
    expect(firstSentence(null)).toBe("");
  });
});

describe("host: runs", () => {
  test("waitForRun resolves when a run ends after the mark; a run that ended before the mark does not count", async () => {
    const host = createHost({});
    fire("paad:run-start"); fire("paad:run-end", { ok: true });
    const m = host.mark();
    const p = host.waitForRun(m, 5000);
    fire("paad:run-start"); expect(host.runStarted(m)).toBe(true);
    fire("paad:run-end", { ok: true });
    await expect(p).resolves.toEqual({ ok: true });
    host.dispose();
  });

  test("a run that finished between the mark and the wait resolves at once; a failed request is not ok; a run that never ends times out", async () => {
    const host = createHost({});
    const m = host.mark(); fire("paad:run-end", { ok: false });
    await expect(host.waitForRun(m, 5000)).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/failed/) });
    vi.useFakeTimers();
    const p = host.waitForRun(host.mark(), 1000); vi.advanceTimersByTime(1001);
    await expect(p).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/did not finish in time/) });
    host.dispose();
  });

  test("a Reset while a step waits for a run tells it so (it is not reported as a failed run)", async () => {
    const host = createHost({});
    const p = host.waitForRun(host.mark(), 5000);
    fire("paad:reset");
    await expect(p).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/page was reset/) });
    fire("paad:run-end", { ok: false });   // the aborted run's own end follows: nobody is waiting, nothing throws
    host.dispose();
  });

  test("dispose clears the wait timers (a torn-down Story leaves nothing running)", () => {
    vi.useFakeTimers(); const host = createHost({}); host.waitForRun(host.mark(), 180000);
    expect(vi.getTimerCount()).toBe(1); host.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  test("after dispose the host no longer counts runs", () => {
    const host = createHost({}); host.dispose();
    const m = host.mark(); fire("paad:run-start"); expect(host.runStarted(m)).toBe(false);
  });
});

describe("host: the page", () => {
  test("prefill puts the exact question in the box and tells the page; send presses the page's own button with a script-made event", () => {
    document.body.innerHTML = '<input id="input"><button id="send">Send</button>';
    const host = createHost({}); const onInput = vi.fn(); const onClick = vi.fn((e) => { expect(e.isTrusted).toBe(false); });
    document.getElementById("input").addEventListener("input", onInput); document.getElementById("send").addEventListener("click", onClick);
    const step = { key: "p1_prompt", target: "#input", tab: "review", prompt: { text: "What can Bob Reyes reach?" } };
    host.prefill(step); expect(document.getElementById("input").value).toBe("What can Bob Reyes reach?"); expect(onInput).toHaveBeenCalled();
    host.send(step); expect(onClick).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test("send throws when the button is busy or missing (Play stops with a message), and a 'press' step clicks that button", () => {
    document.body.innerHTML = '<button id="send" disabled>Send</button><button id="aws-refuse">Try a refused call</button>';
    const host = createHost({}); const pressed = vi.fn(); document.getElementById("aws-refuse").addEventListener("click", pressed);
    expect(() => host.send({ tab: "review", prompt: { text: "x" }, target: "#input" })).toThrow(/not available/);
    expect(() => host.send({ tab: "aws", prompt: { text: "x" }, target: "#aws-input" })).toThrow(/not available/);
    host.send({ prompt: { press: "#aws-refuse" } }); expect(pressed).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test("switchTab clicks a tab only when it is not already selected", () => {
    document.body.innerHTML = '<button id="tab-review" aria-selected="true"></button><button id="tab-aws" aria-selected="false"></button>';
    const host = createHost({}); const a = vi.fn(); const r = vi.fn();
    document.getElementById("tab-aws").addEventListener("click", a); document.getElementById("tab-review").addEventListener("click", r);
    host.switchTab("review"); host.switchTab("aws"); expect(r).not.toHaveBeenCalled(); expect(a).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test("no screenshot is ever offered: slides are text-only", () => { expect(createHost({}).assetUrl("x.jpg")).toBeNull(); });
});

describe("buildSteps", () => {
  const host = createHost({});
  const bubbles = (steps, mode, awsLive) => steps.filter((s) => s.type === "bubble" && (!s.modes || s.modes.includes(mode)) && (!s.when || awsLive || s.when() !== false));

  test("every step of the script is built except the ones held back for the next slice", () => {
    const steps = buildSteps({ captions, host });
    expect(steps.map((s) => s.key)).toEqual(STEPS.map((s) => s.key).filter((k) => !NOT_YET.includes(k)));
    expect(NOT_YET).toEqual(["observability"]);
  });

  test("Real with a live route has the video's 27 bubbles; Mock has its 25; a stand-in AWS route drops the three live-only frames", () => {
    document.body.innerHTML = '<p id="aws-mode">LIVE route: the call goes to your gateway.</p>';
    const steps = buildSteps({ captions, host });
    expect(steps.filter((s) => s.type === "bubble" && (!s.modes || s.modes.includes("real")) && (!s.when || s.when())).length).toBe(27);
    expect(steps.filter((s) => s.type === "bubble" && (!s.modes || s.modes.includes("mock"))).length).toBe(25);
    document.getElementById("aws-mode").textContent = "SIMULATED: no Privilege gateway.";
    expect(steps.filter((s) => s.type === "bubble" && (!s.modes || s.modes.includes("real")) && (!s.when || s.when())).length).toBe(24);
  });

  test("targets: a plain selector, a reel frame by its title, and the last match with a fallback", () => {
    document.body.innerHTML = `<div id="chat"></div><div id="aws-reel"><div class="reel__frame"><span class="reel__title">Get a token</span></div><div class="reel__frame"><span class="reel__title">Read the Agent Card</span></div></div>
      <div id="messages"><div class="message agent">first</div><div class="message agent">second</div></div><div id="reel-review"><div class="reel__frame" id="lastframe"></div></div><div id="trace"></div>`;
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    expect(by.p1_intro.target).toBe("#chat");
    expect(by.card_frame.target().textContent).toBe("Read the Agent Card");
    expect(by.token_frame.target().textContent).toBe("Get a token");
    expect(by.p1_answer.target().textContent).toBe("second");
    document.getElementById("messages").insertAdjacentHTML("beforeend", '<div class="message error">Request failed: HTTP 500</div>');
    expect(by.p1_answer.target()).toBeNull();                            // the run failed: the newest message is an error, not an answer (and an older answer is not quoted)
    expect(by.p1_answer.lines()).toEqual([""]);
    expect(by.p1_blocked.target()).toBeNull();                          // nothing in the trace says blocked: a failed run is not called a block
    document.getElementById("trace").innerHTML = '<div class="trace error" id="err">Agent request failed: Model not configured</div>';
    expect(by.p1_blocked.target()).toBeNull();                          // an ordinary error is not a block either
    document.getElementById("trace").innerHTML = '<div class="trace error" id="err">{"error":{"code":"content_blocked"}}</div>';
    expect(by.p1_blocked.target().id).toBe("err");
    document.getElementById("err").remove(); document.getElementById("trace").textContent = "content_blocked";
    expect(by.p1_blocked.target().id).toBe("lastframe");                // blocked, no error line: the last frame
    expect(by.custodian.target).toBe("#aws-n-custodian");
  });

  test("a bubble that claims something is skipped when the page shows otherwise: no handoff hop, an error in the answer box", () => {
    document.body.innerHTML = '<div id="who"><p class="who-empty">appear here once the main agent hands off</p></div><div id="aws-answer" class="aws__answer is-error">Request failed</div>';
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    expect(document.querySelector(by.p1_handoff.target)).toBeNull();     // '#who .who-hop' is not there
    expect(by.answer.target()).toBeNull(); expect(by.second_answer.target()).toBeNull();
    document.getElementById("aws-answer").className = "aws__answer"; document.getElementById("who").innerHTML = '<div class="who-hop"></div>';
    expect(by.answer.target().id).toBe("aws-answer"); expect(document.querySelector(by.p1_handoff.target)).not.toBeNull();
  });

  // The page's Reel builds its dialog once and only hides it on close: this mirrors that, so "a dialog is in the DOM" is not mistaken for "a pop-out is open".
  const realReel = () => {
    document.body.insertAdjacentHTML("beforeend", '<div class="reel-backdrop" hidden><div class="reel-dialog"><div class="reel-dialog__body"><div class="reel-sec"><h4>The call</h4></div></div></div></div>');
    const backdrop = document.querySelector(".reel-backdrop");
    window.Reel = { close: vi.fn(() => { backdrop.hidden = true; }) };
    return backdrop;
  };

  test("a pop-out: the step waits on its frame, opens it, points at one section of the open dialog, and closes it again", async () => {
    document.body.innerHTML = '<div id="reel-review"><div class="reel__frame"><span class="reel__title">Send the message</span></div></div>';
    const backdrop = realReel();
    const frame = document.querySelector(".reel__frame"); frame.scrollIntoView = () => {}; frame.addEventListener("click", () => { backdrop.hidden = false; });
    const h = createHost({ settleMs: 0 });
    const step = buildSteps({ captions, host: h }).find((s) => s.key === "p1_message");
    expect(step.target()).toBe(frame);                                  // before it opens: the frame, so the engine's wait for the step ends at once (not after the 60 s timeout)
    await step.before();
    expect(step.target().querySelector("h4").textContent).toBe("The call");
    step.after(); expect(window.Reel.close).toHaveBeenCalled(); expect(backdrop.hidden).toBe(true);
    h.dispose();
  });

  test("regression: a frame this run does not have is skipped even though the Reel's hidden dialog is still in the page", async () => {
    document.body.innerHTML = '<div id="reel-review"></div>';
    realReel();                                                          // an earlier pop-out left the dialog behind (hidden)
    const h = createHost({ settleMs: 0 });
    const step = buildSteps({ captions, host: h }).find((s) => s.key === "refused_popout");
    await expect(step.before()).resolves.toBeUndefined(); expect(step.target()).toBeNull();
    h.dispose();
  });

  test("the live fact lines are read from the page, and are empty rather than invented when the page has nothing", () => {
    document.body.innerHTML = `<div id="trace">email: [REDACTED:pii]</div><div id="messages"><div class="message agent">Bob reaches three systems. More detail.</div></div>
      <p id="aws-mode">LIVE route: the call goes to your Privilege gateway, which forwards it. Second sentence.</p>
      <span id="aws-s-custodian">acting</span><span id="aws-s-main">sent</span><span id="aws-s-gateway">passed</span><span id="aws-s-aws">replied</span>
      <ul id="aws-trace"><li data-kind="result"><span class="aws__at">1.2 s</span></li></ul><div id="aws-answer">The sum is 58,000, which is even. Done.</div>`;
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    expect(by.p1_redacted.lines()).toEqual(["the email came back as [REDACTED:pii]"]);
    expect(by.p1_answer.lines()).toEqual(["Bob reaches three systems."]);
    expect(by.live_banner.lines()[0]).toMatch(/^LIVE route:/);
    expect(by.result.lines()).toEqual(["answered in 1.2 s"]);
    expect(by.answer.lines()).toEqual(["custodian: acting · main: sent · gateway: passed · aws: replied"]);
    expect(by.second_answer.lines()).toEqual(["The sum is 58,000, which is even."]);
    expect(by.p1_prompt.lines()).toEqual(["asks: What can Bob Reyes reach?"]);
    document.body.innerHTML = '<div id="trace">nothing here</div><ul id="aws-trace"></ul>';
    expect(by.p1_redacted.lines()).toEqual([]); expect(by.result.lines()).toEqual([]);
  });

  test("the results a bubble claims are checked on the page as take.py checks them (live: the sum, the 401 refusal; Mock skips the sums)", () => {
    document.body.innerHTML = `<div id="aws-answer" class="aws__answer">The sum is 1,111,111,110.</div><ul id="aws-trace"><li data-kind="result"></li></ul><ol class="aws__flow"></ol>
      <span id="aws-s-gateway">passed</span><span id="aws-s-aws">replied</span>`;
    let mode = "real"; const h = createHost({ mode: () => mode });
    const by = Object.fromEntries(buildSteps({ captions, host: h }).map((s) => [s.key, s]));
    expect(by.answer.target().id).toBe("aws-answer"); expect(by.result.target()).not.toBeNull();       // the right sum
    document.getElementById("aws-answer").textContent = "The sum is 42.";
    expect(by.answer.target()).toBeNull(); expect(by.result.target()).toBeNull();                       // a wrong answer is not celebrated
    expect(by.second_answer.target()).toBeNull();
    document.getElementById("aws-answer").textContent = "48,213 + 9,787 = 58,000, which is even.";
    expect(by.second_answer.target()).not.toBeNull();
    expect(by.refused_states.target()).toBeNull();                                                      // not a refusal yet
    document.getElementById("aws-answer").textContent = "HTTP 401: unauthorized"; document.getElementById("aws-s-gateway").textContent = "unreachable";
    expect(by.refused_states.target()).toBeNull();                                                      // a 401 text but the gateway did not refuse it
    document.getElementById("aws-s-gateway").textContent = "refused (HTTP 401)"; document.getElementById("aws-s-aws").textContent = "not reached";
    expect(by.refused_states.target()).not.toBeNull();
    mode = "mock"; document.getElementById("aws-answer").textContent = "SIMULATED reply";                // Mock's stand-in answers in its own words
    expect(by.answer.target()).not.toBeNull(); expect(by.second_answer.target()).not.toBeNull();
    document.getElementById("aws-answer").textContent = "HTTP 401: x"; document.getElementById("aws-s-aws").textContent = "stopped (HTTP 401)";
    expect(by.refused_states.target()).not.toBeNull();
    h.dispose();
  });

  test("regression: every step names the tab it belongs to (the last tab named before it), so Back never lands on a hidden panel", () => {
    const steps = buildSteps({ captions, host });
    const tab = Object.fromEntries(steps.map((s) => [s.key, s.tab]));
    for (const k of ["p1_intro", "p1_handoff", "p1_message", "p1_redacted", "p1_answer", "p1_refuse_prompt", "p1_blocked"]) expect(tab[k]).toBe("review");
    for (const k of ["intro", "custodian", "card_frame", "message_popout", "result", "refuse_intro", "refused_popout"]) expect(tab[k]).toBe("aws");
    expect(tab.sample_note).toBeUndefined(); expect(tab.opening).toBeUndefined();
  });

  test("the Mock closing slide swaps in the simulated wording and never claims a live run; Real keeps the slide as written", () => {
    const closing = buildSteps({ captions, host }).find((s) => s.key === "closing");
    const mock = closing.transform(captions.closing, "mock"); const real = closing.transform(captions.closing, "real");
    expect(mock.lead).toBe(captions.steps.sample_closing_lead.text); expect(mock.colA.lines[0]).toBe(captions.steps.sample_closing_bullet.text);
    expect(mock.colA.lines.slice(1)).toEqual(captions.closing.col_a_lines ? captions.closing.col_a_lines.slice(1) : captions.closing.colA.lines.slice(1));
    expect(real).toBe(captions.closing);
  });
});
