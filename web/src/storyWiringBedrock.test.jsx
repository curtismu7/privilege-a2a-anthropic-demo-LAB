// Story's Part 3 on the Gateway to Bedrock (IAM) tab: the host sends and presses on that tab, and every result bubble's target exists only when the page shows
// that result (a result left on the page by an earlier scenario does not count).
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHost, buildSteps } from "./storyWiring.js";
import { STEPS, STORY_ONLY } from "./storyScript.js";
import { parseCaptions } from "../../server/src/story/captions.js";
import { BEDROCK_PANEL_HTML } from "../../src/main-agent/bedrockTab.ts";

const captionsFile = ["../video/captions.md", "video/captions.md"].find((f) => existsSync(f));
const captions = parseCaptions(readFileSync(captionsFile, "utf8"));
const $ = (id) => document.getElementById(id);
const set = (id, state, word) => { $(`bedrock-n-${id}`).dataset.state = state; $(`bedrock-s-${id}`).textContent = word; };

afterEach(() => { document.body.innerHTML = ""; });

describe("host on the Bedrock tab", () => {
  test("send presses #bedrock-send for a bedrock step, and for a step with no tab while the Bedrock panel is the one shown", () => {
    document.body.innerHTML = `<section id="panel-aws" hidden><button id="aws-send">a</button></section><button id="send">r</button>${BEDROCK_PANEL_HTML.replace(' hidden data-testid="bedrock-panel"', ' data-testid="bedrock-panel"')}`;
    const host = createHost({}); const clicked = vi.fn(); $("bedrock-send").addEventListener("click", clicked);
    host.send({ tab: "bedrock", prompt: { text: "x" } }); host.send({ prompt: { text: "x" } });
    expect(clicked).toHaveBeenCalledTimes(2);
    const own = vi.fn(); $("bedrock-sc-own").addEventListener("click", own);
    host.send({ prompt: { press: "#bedrock-sc-own" } }); expect(own).toHaveBeenCalledTimes(1);
    $("bedrock-sc-own").disabled = true;
    expect(() => host.send({ prompt: { press: "#bedrock-sc-own" } })).toThrow(/not available/);   // a run in flight: Play stops with a message
    host.dispose();
  });

  test("switchTab opens the Bedrock tab", () => {
    document.body.innerHTML = '<button id="tab-review" aria-selected="true"></button><button id="tab-bedrock" aria-selected="false"></button>';
    const host = createHost({}); const b = vi.fn(); $("tab-bedrock").addEventListener("click", b);
    host.switchTab("bedrock"); expect(b).toHaveBeenCalledTimes(1); host.dispose();
  });
});

describe("Part 3 steps", () => {
  const host = createHost({});
  const by = () => Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));

  test("every Part 3 step is built, on the Bedrock tab, Story only", () => {
    const steps = buildSteps({ captions, host });
    const part3 = steps.filter((s) => s.key === "part3" || s.key.startsWith("b_"));
    expect(part3.filter((s) => s.type === "bubble").every((s) => s.tab === "bedrock" && STORY_ONLY.includes(s.key))).toBe(true);
    expect(part3.filter((s) => s.type === "bubble").every((s) => captions.steps[s.key])).toBe(true);
    expect(captions.slides.part3.title).toMatch(/^Part 3/);
    expect(STEPS.filter((s) => s.key.startsWith("b_")).length).toBe(part3.length - 1);
  });

  test("the result targets exist only for their own result", () => {
    document.body.innerHTML = BEDROCK_PANEL_HTML;
    const s = by();
    const results = ["b_own_done", "b_wrong_refused", "b_denied_blocked", "b_fail_closed_blocked", "b_fail_open_passed"];
    const shown = () => results.filter((k) => { const t = s[k].target; return typeof t === "function" ? !!t() : !!document.querySelector(t); });
    expect(shown()).toEqual([]);   // a fresh tab shows no result
    // own role answered
    set("sts", "skipped", "not used (own role)"); set("guard", "skipped", "off"); set("model", "ok", "answered");
    expect(shown()).toEqual(["b_own_done"]);
    // the stored-key run: STS not used for another reason, so it is not the own-role result
    set("sts", "skipped", "not used (stored key)"); expect(shown()).toEqual([]);
    // wrong External ID
    set("sts", "refused", "refused (AccessDenied)"); set("model", "skipped", "not reached"); expect(shown()).toEqual(["b_wrong_refused"]);
    // denied topic: blocked answer and the guard says so
    set("sts", "skipped", "not used (own role)"); set("guard", "blocked", "blocked (denied topic)"); set("model", "skipped", "not called");
    $("bedrock-answer").className = "aws__answer is-blocked";
    expect(shown()).toEqual(["b_denied_blocked"]);   // not the fail-closed result
    // fail closed: also a blocked answer, but not the denied-topic result
    set("guard", "blocked", "unreachable: blocked (Fail closed)");
    expect(shown()).toEqual(["b_fail_closed_blocked"]);
    // fail open
    $("bedrock-answer").className = "aws__answer"; set("guard", "skipped", "not inspected (warning)"); set("model", "ok", "answered");
    expect(shown()).toEqual(["b_fail_open_passed"]);
  });

  test("the pop-outs point at the Assume the role and Refused frames of the Bedrock reel only, and are skipped when the run has none", () => {
    document.body.innerHTML = BEDROCK_PANEL_HTML;
    const s = by();
    expect(s.b_assume.target()).toBeNull(); expect(s.b_wrong_502.target()).toBeNull();
    $("bedrock-reel").innerHTML = '<li><button class="reel__frame"><span class="reel__title">Assume the role</span></button></li>';
    expect(s.b_assume.target().textContent).toBe("Assume the role"); expect(s.b_wrong_502.target()).toBeNull();
  });

  test("the IAM bubble claims only the permission rows the page shows: its wording names none, and its fact line lists the visible rows (review, PR #64)", () => {
    expect(captions.steps.b_iam.text).not.toMatch(/InvokeModel|CreateInference|DeleteInference|ApplyGuardrail|AssumeRole|CountTokens/);
    expect(captions.steps.b_iam.text).toMatch(/same or another account/);
    document.body.innerHTML = BEDROCK_PANEL_HTML;
    // the settings after b_fail_open: Runtime, Role ARN blank, guardrail on (what the tab script's sync() shows)
    for (const li of document.querySelectorAll("#bedrock-perms li")) li.hidden = !["runtime", "guard"].includes(li.getAttribute("data-for"));
    const lines = by().b_iam.lines();
    expect(lines).toEqual(["shown now: bedrock:InvokeModel, bedrock:InvokeModelWithResponseStream, bedrock:CountTokens, bedrock:ApplyGuardrail"]);
    for (const li of document.querySelectorAll("#bedrock-perms li")) li.hidden = li.getAttribute("data-for") !== "mantle";
    expect(by().b_iam.lines()[0]).toBe("shown now: bedrock-mantle:CreateInference, bedrock-mantle:DeleteInference, bedrock-mantle:CountTokens");
  });

  test("the IAM step opens the details first", async () => {
    document.body.innerHTML = BEDROCK_PANEL_HTML;
    const s = by(); expect($("bedrock-iam").open).toBeFalsy();
    await s.b_iam.before(); expect($("bedrock-iam").open).toBe(true); expect(s.b_iam.target()).toBe($("bedrock-iam")); expect(s.b_iam.target().tagName).toBe("DETAILS");
  });
});
