/**
 * The reference table behind the API call reel: each spec section the reel names, with a plain-English line in our own words.
 * Section numbers were checked against the RFC text (rfc-editor.org) and the A2A 1.0.0 specification; the AgentCore lines come
 * from AWS's A2A protocol contract page. Nothing here is quoted. The page gets this table as data and writes it with textContent.
 */

export interface Ref {
  label: string;
  says: string;
}

export const REEL_REFS: Readonly<Record<string, Ref>> = {
  'rfc6749-4.4': {
    label: 'RFC 6749 section 4.4',
    says: 'The client credentials grant: an app that acts for itself, not for a user, authenticates itself at the token endpoint and gets an access token. Only confidential clients may use it.',
  },
  'rfc6749-5.1': {
    label: 'RFC 6749 section 5.1',
    says: 'A successful token reply is JSON holding the access_token and its token_type, usually with expires_in, the number of seconds the token stays valid.',
  },
  'rfc6750-2.1': {
    label: 'RFC 6750 section 2.1',
    says: 'A client presents a bearer token in the Authorization header: the word Bearer, a space, then the token.',
  },
  'rfc6750-3': {
    label: 'RFC 6750 section 3',
    says: 'When a request has no usable token, the server answers with a WWW-Authenticate header using the Bearer scheme, optionally adding realm, scope and error details.',
  },
  'rfc6750-3.1': {
    label: 'RFC 6750 section 3.1',
    says: 'The error parameter says why access was refused: invalid_request (usually HTTP 400), invalid_token for an expired, revoked or malformed token (usually 401), insufficient_scope (usually 403).',
  },
  'rfc9110-15.5.2': {
    label: 'RFC 9110 section 15.5.2',
    says: 'A 401 means the request lacked valid credentials, and the server must send a WWW-Authenticate header saying how to authenticate. RFC 9110 replaces the older RFC 7235 here.',
  },
  'rfc9728-2': {
    label: 'RFC 9728 section 2',
    says: 'A protected resource can publish a small JSON document about itself, including which authorization servers issue tokens for it.',
  },
  'rfc9728-3': {
    label: 'RFC 9728 section 3',
    says: 'That document is found by default at /.well-known/oauth-protected-resource on the resource host, with any resource path added after it.',
  },
  'rfc9728-5.1': {
    label: 'RFC 9728 section 5.1',
    says: 'A 401 challenge can carry a resource_metadata parameter: the address of that document, so the client learns where to get a token.',
  },
  'rfc7519-4.1.1': { label: 'RFC 7519 section 4.1.1', says: 'iss names who issued the token.' },
  'rfc7519-4.1.2': { label: 'RFC 7519 section 4.1.2', says: 'sub names who or what the token is about.' },
  'rfc7519-4.1.3': {
    label: 'RFC 7519 section 4.1.3',
    says: 'aud names who the token is meant for; when it is present, a service that is not listed there must refuse the token.',
  },
  'rfc7519-4.1.4': {
    label: 'RFC 7519 section 4.1.4',
    says: 'exp is the moment on or after which the token must not be accepted.',
  },
  'rfc7519-4.1.5': { label: 'RFC 7519 section 4.1.5', says: 'nbf is the moment before which the token must not be accepted.' },
  'rfc7519-4.1.6': { label: 'RFC 7519 section 4.1.6', says: 'iat is when the token was issued, so its age can be worked out.' },
  'rfc7519-4.1.7': {
    label: 'RFC 7519 section 4.1.7',
    says: 'jti is a unique id for this one token, which a service can use to spot a replay.',
  },
  'rfc7515-4.1.1': { label: 'RFC 7515 section 4.1.1', says: 'alg names the algorithm the token was signed with.' },
  'rfc7515-4.1.4': { label: 'RFC 7515 section 4.1.4', says: 'kid hints which key signed the token, so the checker picks the right public key.' },
  'rfc7515-4.1.9': { label: 'RFC 7515 section 4.1.9', says: 'typ declares what kind of object the token is.' },
  'rfc9068-2.1': {
    label: 'RFC 9068 section 2.1',
    says: 'A JWT access token must declare its type in the header (at+jwt is the short form), so a resource server can tell it apart from an ID token.',
  },
  'rfc9068-2.2': {
    label: 'RFC 9068 section 2.2',
    says: 'A JWT access token must carry iss, exp, aud, sub, client_id, iat and jti; client_id is the OAuth client that requested the token.',
  },
  'rfc9068-2.2.3': {
    label: 'RFC 9068 section 2.2.3',
    says: 'The scope claim lists the scopes associated with the token, and each scope must mean something for the service named in aud.',
  },
  'rfc8693-4.1': {
    label: 'RFC 8693 section 4.1',
    says: 'The act claim says another party is acting on the subject\'s behalf; acts nested inside acts form the chain, the outermost being the current actor.',
  },
  'a2a-8.1': {
    label: 'A2A spec 1.0.0 section 8.1',
    says: 'Every A2A server must make an Agent Card available: a description of who the agent is, what it can do and what it needs from callers.',
  },
  'a2a-8.2': {
    label: 'A2A spec 1.0.0 section 8.2',
    says: 'A client can find the card at the well-known path /.well-known/agent-card.json, in a registry, or by being handed it directly.',
  },
  'a2a-7.3': {
    label: 'A2A spec 1.0.0 section 7.3',
    says: 'The card tells a client which sign-in the server wants; the client gets its credentials outside A2A and sends them on every request.',
  },
  'a2a-7.4': {
    label: 'A2A spec 1.0.0 section 7.4',
    says: 'The server must authenticate every request, and should put challenge information in its error replies.',
  },
  'a2a-5.3': {
    label: 'A2A spec 1.0.0 section 5.3',
    says: 'The operation that hands a message to an agent is called SendMessage in the 1.0.0 spec. AgentCore\'s documented form is message/send.',
  },
  'a2a-9.4.1': {
    label: 'A2A spec 1.0.0 section 9.4.1',
    says: 'Over JSON-RPC, sending a message returns either a Task, when the agent tracks the work, or a direct Message.',
  },
  'a2a-4.1.1': {
    label: 'A2A spec 1.0.0 section 4.1.1',
    says: 'A Task is the unit of work the agent tracks: an id, a status, and optionally its output artifacts and history.',
  },
  'a2a-4.1.7': {
    label: 'A2A spec 1.0.0 section 4.1.7',
    says: 'An Artifact is an output of a task: an id and one or more parts, which is where reply text normally sits.',
  },
  'a2a-b': {
    label: 'A2A spec 1.0.0 appendix B',
    says: 'A2A is how independent agents talk to each other as peers; MCP is how one agent uses tools and data. The two work together.',
  },
  'agentcore-contract': {
    label: 'AgentCore A2A contract',
    says: 'AgentCore runs A2A as JSON-RPC 2.0 over HTTP: messages are POSTed to the root path and the Agent Card is served at /.well-known/agent-card.json.',
  },
  'agentcore-401': {
    label: 'AgentCore OAuth responses',
    says: 'For an OAuth-protected runtime, a call without a credential gets HTTP 401 with a Bearer challenge that points at a resource_metadata address. A runtime set up for SigV4 answers 403 with no challenge.',
  },
  'agentcore-errors': {
    label: 'AgentCore error handling',
    says: 'AgentCore maps runtime errors to real HTTP statuses (such as 404, 400, 429 and 500) with a JSON-RPC error body; authentication and authorization failures come back as plain HTTP errors, not JSON-RPC.',
  },
};

/** The refs a frame shows when the event names none. */
export const KIND_REFS: Readonly<Record<string, readonly string[]>> = {
  token: ['rfc6749-4.4', 'rfc6749-5.1'],
  card: ['a2a-8.1', 'a2a-8.2'],
  delegate: ['a2a-5.3', 'a2a-9.4.1', 'rfc6750-2.1', 'a2a-7.3'],
  result: ['a2a-9.4.1', 'a2a-4.1.1', 'a2a-4.1.7'],
  error: ['a2a-7.4'],
  metadata: ['rfc9728-2', 'rfc9728-3', 'rfc9728-5.1'],
  'mcp-call': ['a2a-b'],
  'mcp-result': ['a2a-b'],
};

/** What the AWS run adds on top of the defaults. */
export const AWS_CARD_REFS: readonly string[] = [...(KIND_REFS.card ?? []), 'agentcore-contract'];
export const AWS_DELEGATE_REFS: readonly string[] = [...(KIND_REFS.delegate ?? []), 'agentcore-contract'];
export const REFUSED_REFS: readonly string[] = ['rfc9110-15.5.2', 'rfc6750-3', 'rfc6750-3.1', 'a2a-7.4', 'agentcore-401'];
export const ERROR_REFS: readonly string[] = ['agentcore-errors', 'a2a-7.4'];
export const TOKEN_REFS: readonly string[] = ['rfc6749-4.4', 'rfc6749-5.1'];
export const METADATA_REFS: readonly string[] = ['rfc9728-2', 'rfc9728-3', 'rfc9728-5.1'];

/** The JWT claims the reel explains: a one-line meaning and the reference that governs it. */
export const CLAIM_INFO: Readonly<Record<string, { says: string; ref: string }>> = {
  iss: { says: 'who issued the token', ref: 'rfc7519-4.1.1' },
  sub: { says: 'who or what the token is about', ref: 'rfc7519-4.1.2' },
  aud: { says: 'who the token is meant for', ref: 'rfc7519-4.1.3' },
  exp: { says: 'when the token stops being accepted', ref: 'rfc7519-4.1.4' },
  nbf: { says: 'the token is not accepted before this time', ref: 'rfc7519-4.1.5' },
  iat: { says: 'when the token was issued', ref: 'rfc7519-4.1.6' },
  jti: { says: 'a unique id for this token', ref: 'rfc7519-4.1.7' },
  client_id: { says: 'the OAuth client that requested the token', ref: 'rfc9068-2.2' },
  scope: { says: 'the scopes associated with the token', ref: 'rfc9068-2.2.3' },
  act: { says: 'who is acting on the subject\'s behalf', ref: 'rfc8693-4.1' },
};

export const HEADER_INFO: Readonly<Record<string, { says: string; ref: string }>> = {
  alg: { says: 'how the token is signed', ref: 'rfc7515-4.1.1' },
  kid: { says: 'which key signed it', ref: 'rfc7515-4.1.4' },
  typ: { says: 'what kind of token it is', ref: 'rfc9068-2.1' },
};

/** The parts of a WWW-Authenticate challenge the reel explains. */
export const CHALLENGE_INFO: Readonly<Record<string, { says: string; ref: string }>> = {
  scheme: { says: 'the kind of sign-in the server wants: Bearer means an access token', ref: 'rfc6750-3' },
  realm: { says: 'the protection space the sign-in applies to', ref: 'rfc6750-3' },
  scope: { says: 'the scope the server needs the token to carry', ref: 'rfc6750-3' },
  error: { says: 'why the token was refused', ref: 'rfc6750-3.1' },
  error_description: { says: 'a human-readable reason', ref: 'rfc6750-3' },
  error_uri: { says: 'a page that explains the error', ref: 'rfc6750-3' },
  resource_metadata: { says: 'where to read this service\'s sign-in metadata', ref: 'rfc9728-5.1' },
};

/** Every reference id the code names, so a test can prove each one resolves. */
export function usedRefIds(): string[] {
  const ids = new Set<string>();
  for (const list of Object.values(KIND_REFS)) list.forEach((id) => ids.add(id));
  for (const list of [AWS_CARD_REFS, AWS_DELEGATE_REFS, REFUSED_REFS, ERROR_REFS, TOKEN_REFS, METADATA_REFS]) list.forEach((id) => ids.add(id));
  for (const table of [CLAIM_INFO, HEADER_INFO, CHALLENGE_INFO]) Object.values(table).forEach((entry) => ids.add(entry.ref));
  return [...ids];
}
