/**
 * The deliberately invalid credential the "refused call" demo sends. It is not a secret: it is a fixed string that no
 * gateway or runtime will ever accept, so the run shows a real refusal. The local stand-in rejects it too.
 */
export const REFUSAL_DEMO_CREDENTIAL = 'refused-demo-not-a-valid-credential';
