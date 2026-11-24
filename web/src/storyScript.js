// The Story script: one entry per caption key, in the order the recorded video walks the lab (video/take.py). Pure data, no DOM: the page wiring turns each
// entry into an engine step (a selector, a pop-out, a live line). The wording is in video/captions.md; test/story.test.ts checks the two agree, and that the order,
// the numbered-bubble counts and the fixed holds equal take.py's.
//
//   target   a CSS selector | { frame, root } a reel frame by its title | { last, fallback } the last match of a selector
//   popout   { root, frame, section, scrollAfter }  open that reel frame's pop-out and point the bubble at one section of it
//   prompt   { text } fill the question and the viewer presses Send | { press } the viewer (or Play) presses that existing button
//   lines    the name of a live value the page reads for the bubble's fact lines (the page wiring, slice 2)
//   when     'awsLive': shown only when the Custodian to AWS agent tab says LIVE route (the video's own condition for the token and sign-in-metadata frames)
//   modes    ['real'] or ['mock']: shown only there. sampleKey: the Mock wording key.
// Hold times for Play for me are not here: they come from the wording and the shared hold.js (the video's own formulas), except `fixedSecs`.

export const P1_Q1 = 'What can Bob Reyes reach?';
export const P1_Q2 = 'Review access on prod-db-primary';
export const P2_Q1 = 'Use add_numbers to add 987654321 and 123456789. Show the exact tool call you made and the value it returned.';
export const P2_Q2 = 'Add 48,213 and 9,787, then say whether the result is even or odd.';

const REVIEW = 'review';
const AWS = 'aws';
const FRAME_WAIT = 60000;   // an AWS frame appears while the call is in flight: the video waits up to 60 s

export const STEPS = [
  { key: 'sample_note', type: 'slide', trigger: 'load', modes: ['mock'] },   // the simulated run says so first
  { key: 'opening', type: 'slide', trigger: 'load' },

  // ---- Part 1: our two agents (the "A2A with remote agents" tab)
  { key: 'p1_intro', type: 'bubble', tab: REVIEW, trigger: 'load', target: '#chat', prefer: 'right' },
  { key: 'p1_prompt', type: 'bubble', tab: REVIEW, trigger: 'load', target: '#input', prefer: 'above', prompt: { text: P1_Q1 }, fixedSecs: 4.5, askLine: `asks: ${P1_Q1}` },
  { key: 'p1_handoff', type: 'bubble', trigger: 'run-done', target: '#who', place: 'bl' },
  { key: 'p1_message', type: 'bubble', trigger: 'frame', popout: { root: '#reel-review', frame: 'Send the message', section: 'The call' }, prefer: 'right' },
  { key: 'p1_mcp', type: 'bubble', trigger: 'frame', target: { frame: 'Call the tool', root: '#reel-review' }, prefer: 'below' },
  { key: 'p1_redacted', type: 'bubble', trigger: 'frame', popout: { root: '#reel-review', frame: 'Tool result', section: 'What came back' }, prefer: 'right', lines: 'redacted' },
  { key: 'p1_answer', type: 'bubble', trigger: 'load', target: { last: '#messages .message.agent' }, prefer: 'right', lines: 'answer1' },
  { key: 'p1_refuse_prompt', type: 'bubble', trigger: 'load', target: '#input', prefer: 'above', prompt: { text: P1_Q2 }, fixedSecs: 4.5, askLine: `asks: ${P1_Q2}` },
  { key: 'p1_blocked', type: 'bubble', trigger: 'run-done', target: { last: '#trace .trace.error', fallback: '#reel-review .reel__frame' }, prefer: 'left' },

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
  { key: 'result', type: 'bubble', trigger: 'run-done', target: '#aws-trace li[data-kind=result]', prefer: 'left', lines: 'answeredIn' },
  { key: 'answer', type: 'bubble', trigger: 'load', target: '#aws-answer', prefer: 'below', lines: 'flowStates' },
  { key: 'second_prompt', type: 'bubble', trigger: 'load', target: '#aws-input', prefer: 'below', prompt: { text: P2_Q2 }, fixedSecs: 5.0, askLine: 'asks: add 48,213 and 9,787; even or odd?' },
  { key: 'second_answer', type: 'bubble', trigger: 'run-done', target: '#aws-answer', prefer: 'below', lines: 'answer2' },
  { key: 'refuse_intro', type: 'bubble', trigger: 'load', target: '#aws-refuse', prefer: 'below', prompt: { press: '#aws-refuse' } },   // no fixed hold: the video holds it for its wording (take.py gives it no secs)
  { key: 'refused_states', type: 'bubble', trigger: 'run-done', target: 'ol.aws__flow', prefer: 'below', sampleKey: 'sample_refused_states', lines: 'flowStates' },
  { key: 'refused_popout', type: 'bubble', trigger: 'frame', popout: { root: '#aws-reel', frame: 'Refused', section: 'The challenge' }, prefer: 'right' },
  { key: 'refused_metadata', type: 'bubble', trigger: 'frame', modes: ['real'], when: 'awsLive', target: { frame: 'Read the sign-in metadata', root: '#aws-reel' }, prefer: 'below' },

  // ---- the end
  { key: 'protect', type: 'slide', trigger: 'load' },
  { key: 'observability', type: 'slide', trigger: 'load' },   // the run's own logs: the lab's live Run Observability panel, not a captured image
  { key: 'closing', type: 'slide', trigger: 'load' },
];

// Mock wording the script uses that is not a step of its own: the closing slide's two replaced lines (the simulated run never claims a live one).
export const EXTRA_SAMPLE_KEYS = ['sample_closing_lead', 'sample_closing_bullet'];

// What the parity test hands to captions.js parity(): the caption keys this script needs.
export function scriptKeys() {
  return {
    steps: STEPS.filter((s) => s.type === 'bubble').map((s) => s.key),
    slides: STEPS.filter((s) => s.type === 'slide').map((s) => s.key),
    sampleKeys: [...STEPS.map((s) => s.sampleKey).filter(Boolean), ...EXTRA_SAMPLE_KEYS],
  };
}
