// The Story script: one entry per caption key, in the order the recorded video walks the lab (video/take.py). Pure data, no DOM: the page wiring turns each
// entry into an engine step (a selector, a pop-out, a live line). The wording is in video/captions.md; test/story.test.ts checks the two agree, and that the order,
// the numbered-bubble counts and the fixed holds equal take.py's.
//
//   target   a CSS selector | { frame, root } a reel frame by its title | { last, fallback, only } the last match of a selector (only: 'blocked' = if the trace says blocked)
//            | { selector, unless, check, open } `open` is a <details> the step opens first (the panel under the run).
//            | { selector, unless, check } an element unless it has that class (an answer box that holds an error is not an answer) and only when the named check holds on the page
//            | { lastMessage: 'agent' } the chat's newest message, only when it is an agent answer (a failed run leaves an error message there, not an answer)
//            check: 'sum1' | 'sum2' (live runs: the answer holds the expected sum, as take.py requires), 'refusal' (the answer is HTTP 401 and the gateway refused it). Mock skips the sum checks.
//            The Bedrock checks ('bedrockOwn', 'bedrockDenied', 'bedrockFailClosed', 'bedrockUninspected') read the flow nodes, so a result left by an earlier scenario never passes for this one.
//            A bubble whose target is not there is skipped.
//   popout   { root, frame, section, scrollAfter }  open that reel frame's pop-out and point the bubble at one section of it
//   prompt   { text } fill the question and the viewer presses Send | { press } the viewer (or Play) presses that existing button
//   lines    the name of a live value the page reads for the bubble's fact lines (the page wiring, slice 2)
//   when     'awsLive': shown only when the Custodian to AWS agent tab says LIVE route (the video's own condition for the token and sign-in-metadata frames)
//   modes    ['real'] or ['mock']: shown only there. sampleKey: the Mock wording key.
// Hold times for Play for me are not here: they come from the wording and the shared hold.js (the video's own formulas), except `fixedSecs`.

export const P1_Q1 = 'What can Bob Reyes reach?';
export const P1_Q2 = 'Review access on passenger-records-db';
export const P2_Q1 = 'Use add_numbers to add 987654321 and 123456789. Show the exact tool call you made and the value it returned.';
export const P2_Q2 = 'Add 48,213 and 9,787, then say whether the result is even or odd.';
export const P2_SUM = '1111111110';   // the video's own answer checks (take.py): a live answer is only called right when it holds the sum
export const P2_SUM2 = '58000';

const REVIEW = 'review';
const AWS = 'aws';
const BEDROCK = 'bedrock';
const FRAME_WAIT = 60000;   // an AWS frame appears while the call is in flight: the video waits up to 60 s

export const STEPS = [
  { key: 'sample_note', type: 'slide', trigger: 'load', modes: ['mock'] },   // the simulated run says so first
  { key: 'opening', type: 'slide', trigger: 'load' },

  // ---- Part 1: our two agents (the "A2A with remote agents" tab)
  { key: 'p1_intro', type: 'bubble', tab: REVIEW, trigger: 'load', target: '#chat', prefer: 'right', sampleKey: 'sample_p1_intro' },
  { key: 'p1_prompt', type: 'bubble', tab: REVIEW, trigger: 'load', target: '#input', prefer: 'above', prompt: { text: P1_Q1 }, fixedSecs: 4.5, askLine: `asks: ${P1_Q1}` },
  { key: 'p1_handoff', type: 'bubble', trigger: 'run-done', target: '#who .who-hop', place: 'bl', sampleKey: 'sample_p1_handoff' },   // only when a handoff happened: a run that failed before it shows no hop
  { key: 'p1_message', type: 'bubble', trigger: 'frame', popout: { root: '#reel-review', frame: 'Send the message', section: 'The call' }, prefer: 'right', sampleKey: 'sample_p1_message' },
  { key: 'p1_mcp', type: 'bubble', trigger: 'frame', target: { frame: 'Call the tool', root: '#reel-review' }, prefer: 'below', sampleKey: 'sample_p1_mcp' },
  { key: 'p1_redacted', type: 'bubble', trigger: 'frame', popout: { root: '#reel-review', frame: 'Tool result', section: 'What came back' }, prefer: 'right', lines: 'redacted', sampleKey: 'sample_p1_redacted' },
  { key: 'p1_answer', type: 'bubble', trigger: 'load', target: { lastMessage: 'agent' }, prefer: 'right', lines: 'answer1', sampleKey: 'sample_p1_answer' },
  { key: 'p1_refuse_prompt', type: 'bubble', trigger: 'load', target: '#input', prefer: 'above', prompt: { text: P1_Q2 }, fixedSecs: 4.5, askLine: `asks: ${P1_Q2}` },
  { key: 'p1_blocked', type: 'bubble', trigger: 'run-done', target: { last: '#trace .trace.error', fallback: '#reel-review .reel__frame', only: 'blocked' }, prefer: 'left', sampleKey: 'sample_p1_blocked' },   // only when the trace says the gateway blocked it (the video's own test)

  // ---- Part 2: an agent in AWS (the "Custodian to AWS agent" tab)
  { key: 'part2', type: 'slide', trigger: 'load' },
  { key: 'intro', type: 'bubble', tab: AWS, trigger: 'load', target: '#panel-aws h2', prefer: 'below' },
  { key: 'custodian', type: 'bubble', trigger: 'load', target: '#aws-n-custodian', prefer: 'below' },
  { key: 'main_agent', type: 'bubble', trigger: 'load', target: '#aws-n-main', prefer: 'below' },
  { key: 'gateway', type: 'bubble', trigger: 'load', target: '#aws-n-gateway', prefer: 'below' },
  { key: 'aws_agent', type: 'bubble', trigger: 'load', target: '#aws-n-aws', prefer: 'below' },
  { key: 'live_banner', type: 'bubble', trigger: 'load', target: '#aws-mode', prefer: 'below', modes: ['mock'], sampleKey: 'sample_live_banner', lines: 'routeMode' },
  { key: 'config_app', type: 'slide', trigger: 'load' },
  { key: 'config_agent', type: 'slide', trigger: 'load' },
  { key: 'config_policy', type: 'slide', trigger: 'load' },
  { key: 'spec', type: 'slide', trigger: 'load' },
  { key: 'rfcs', type: 'slide', trigger: 'load' },
  { key: 'pick_prompt', type: 'bubble', tab: AWS, trigger: 'load', target: '#aws-input', prefer: 'below', prompt: { text: P2_Q1 }, fixedSecs: 5.0, askLine: 'asks: add 987654321 and 123456789' },
  { key: 'token_frame', type: 'bubble', trigger: 'frame', frameTimeoutMs: FRAME_WAIT, modes: ['real'], when: 'awsLive', target: { frame: 'Get a token', root: '#aws-reel' }, prefer: 'below' },
  { key: 'token_popout', type: 'bubble', trigger: 'frame', modes: ['real'], when: 'awsLive', popout: { root: '#aws-reel', frame: 'Get a token', section: 'The token', scrollAfter: 6.0 }, prefer: 'right' },
  { key: 'card_frame', type: 'bubble', trigger: 'frame', frameTimeoutMs: FRAME_WAIT, target: { frame: 'Read the Agent Card', root: '#aws-reel' }, prefer: 'below' },
  { key: 'message_popout', type: 'bubble', trigger: 'frame', frameTimeoutMs: FRAME_WAIT, popout: { root: '#aws-reel', frame: 'Send the message', section: 'The call' }, prefer: 'right' },
  { key: 'result', type: 'bubble', trigger: 'run-done', target: { selector: '#aws-trace li[data-kind=result]', check: 'sum1' }, prefer: 'left', lines: 'answeredIn' },
  { key: 'answer', type: 'bubble', trigger: 'load', target: { selector: '#aws-answer', unless: 'is-error', check: 'sum1' }, prefer: 'below', lines: 'flowStates' },
  { key: 'second_prompt', type: 'bubble', trigger: 'load', target: '#aws-input', prefer: 'below', prompt: { text: P2_Q2 }, fixedSecs: 5.0, askLine: 'asks: add 48,213 and 9,787; even or odd?' },
  { key: 'second_answer', type: 'bubble', trigger: 'run-done', target: { selector: '#aws-answer', unless: 'is-error', check: 'sum2' }, prefer: 'below', lines: 'answer2' },
  { key: 'refuse_intro', type: 'bubble', trigger: 'load', target: '#aws-refuse', prefer: 'below', prompt: { press: '#aws-refuse' } },   // no fixed hold: the video holds it for its wording (take.py gives it no secs)
  { key: 'refused_states', type: 'bubble', trigger: 'run-done', target: { selector: 'ol.aws__flow', check: 'refusal' }, prefer: 'below', sampleKey: 'sample_refused_states', lines: 'flowStates' },
  { key: 'refused_popout', type: 'bubble', trigger: 'frame', popout: { root: '#aws-reel', frame: 'Refused', section: 'The challenge' }, prefer: 'right' },
  { key: 'refused_metadata', type: 'bubble', trigger: 'frame', modes: ['real'], when: 'awsLive', target: { frame: 'Read the sign-in metadata', root: '#aws-reel' }, prefer: 'below' },
  // Story only (the video shows a captured-evidence slide instead): the lab's live Run observability panel, opened. Skipped when the panel has no record.
  { key: 'observability_panel', type: 'bubble', trigger: 'load', target: { selector: '[data-testid=ro-table]', open: '#run-obs-drawer' }, prefer: 'above', sampleKey: 'sample_observability_panel' },

  // ---- Part 3 (Story only, SIMULATED in every mode): the gateway signs the Bedrock call with an IAM role (the "Gateway to Bedrock (IAM)" tab). Each scenario is a
  // button the viewer (or Play) presses; each result bubble points at something that exists only when the page shows that result.
  { key: 'part3', type: 'slide', trigger: 'load' },
  { key: 'b_intro', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#panel-bedrock h2', prefer: 'below' },
  { key: 'b_key', type: 'bubble', trigger: 'load', target: '#bedrock-key', prefer: 'below' },
  { key: 'b_own', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-own', prefer: 'below', prompt: { press: '#bedrock-sc-own' } },
  { key: 'b_own_done', type: 'bubble', trigger: 'run-done', target: { selector: '#bedrock-n-sts', check: 'bedrockOwn' }, prefer: 'below' },
  { key: 'b_cross', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-cross', prefer: 'below', prompt: { press: '#bedrock-sc-cross' } },
  { key: 'b_assume', type: 'bubble', trigger: 'run-done', popout: { root: '#bedrock-reel', frame: 'Assume the role', section: 'The call' }, prefer: 'right' },
  { key: 'b_wrong', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-wrong-ext', prefer: 'below', prompt: { press: '#bedrock-sc-wrong-ext' } },
  { key: 'b_wrong_refused', type: 'bubble', trigger: 'run-done', target: '#bedrock-n-sts[data-state=refused]', prefer: 'below' },
  { key: 'b_wrong_502', type: 'bubble', trigger: 'frame', popout: { root: '#bedrock-reel', frame: 'Refused', section: 'What came back' }, prefer: 'right' },
  { key: 'b_denied', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-denied', prefer: 'below', prompt: { press: '#bedrock-sc-denied' } },
  { key: 'b_denied_blocked', type: 'bubble', trigger: 'run-done', target: { selector: '#bedrock-answer.is-blocked', check: 'bedrockDenied' }, prefer: 'below' },
  { key: 'b_fail_closed', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-fail-closed', prefer: 'below', prompt: { press: '#bedrock-sc-fail-closed' } },
  { key: 'b_fail_closed_blocked', type: 'bubble', trigger: 'run-done', target: { selector: '#bedrock-n-guard', check: 'bedrockFailClosed' }, prefer: 'below' },
  { key: 'b_fail_open', type: 'bubble', tab: BEDROCK, trigger: 'load', target: '#bedrock-sc-fail-open', prefer: 'below', prompt: { press: '#bedrock-sc-fail-open' } },
  { key: 'b_fail_open_passed', type: 'bubble', trigger: 'run-done', target: { selector: '#bedrock-n-guard', check: 'bedrockUninspected' }, prefer: 'below' },
  { key: 'b_iam', type: 'bubble', tab: BEDROCK, trigger: 'load', target: { selector: '#bedrock-iam', open: '#bedrock-iam' }, prefer: 'above', lines: 'bedrockPerms' },   // names only the permission rows the page shows

  // ---- the end
  { key: 'protect', type: 'slide', trigger: 'load' },
  { key: 'closing', type: 'slide', trigger: 'load' },
];

// Mock wording the script uses that is not a step of its own: the closing slide's two replaced lines (the simulated run never claims a live one).
export const EXTRA_SAMPLE_KEYS = ['sample_closing_lead', 'sample_closing_bullet'];

// Bubbles only Story has (the video has no such scene): the numbered counts and the order checks against take.py leave them out. The Part 3 Bedrock
// bubbles (b_*) are all here: the video's Part 3 comes later.
export const STORY_ONLY = ['observability_panel', ...STEPS.filter((s) => s.type === 'bubble' && s.key.startsWith('b_')).map((s) => s.key)];
// Wording only the video uses: the captured-evidence slide (Story shows the live panel instead) and an unused intro.
export const VIDEO_ONLY = ['observability', 'sample_intro'];

// What the parity test hands to captions.js parity(): the caption keys this script needs.
export function scriptKeys() {
  return {
    steps: STEPS.filter((s) => s.type === 'bubble').map((s) => s.key),
    slides: STEPS.filter((s) => s.type === 'slide').map((s) => s.key),
    sampleKeys: [...STEPS.map((s) => s.sampleKey).filter(Boolean), ...EXTRA_SAMPLE_KEYS],
  };
}
