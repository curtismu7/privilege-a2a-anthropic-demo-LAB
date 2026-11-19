import express, { type Express, type Request, type Response } from 'express';

/**
 * A local stand-in for an AWS agent (an Amazon Bedrock AgentCore runtime serving A2A), so the Custodian to AWS agent tab works
 * with no AWS account. It follows AgentCore's documented A2A contract (docs.aws.amazon.com/bedrock-agentcore/latest/devguide/
 * runtime-a2a-protocol-contract.html): JSON-RPC 2.0 `message/send` at the root, the reply as `result.artifacts[]`, the Agent Card at
 * /.well-known/agent-card.json, GET /ping, a real HTTP status on errors with the JSON-RPC error body, and 401 with a
 * WWW-Authenticate header when OAuth is required. Every reply says it is simulated. It calls nothing, anywhere.
 */

export interface AwsMockOptions {
  /** Refuse a request that carries no Authorization: Bearer, like an OAuth-configured runtime. */
  requireBearer?: boolean;
  /** The address the card advertises. */
  publicUrl?: string;
}

const MAX_QUESTION_ECHO = 200;
// "Introduce yourself: which agent are you, and where do you run?" and its near neighbours.
const INTRODUCTION = /\b(introduce yourself|who are you|which agent are you|where do you run)\b/i;

export function createAwsAgentMockApp(options: AwsMockOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/ping', (_req: Request, res: Response) => res.json({ status: 'Healthy' }));

  const requireAuth = (req: Request, res: Response): boolean => {
    if (!options.requireBearer || /^Bearer\s+\S+/i.test(req.header('authorization') ?? '')) return true;
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Bearer authentication required' });
    return false;
  };

  app.get('/.well-known/agent-card.json', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    res.json({
      name: 'Cloud Access Agent (simulated)',
      description: 'A local stand-in for an agent hosted on AWS. It reviews sample cloud entitlements; nothing in AWS is called.',
      version: '1.0.0',
      url: options.publicUrl ?? 'http://127.0.0.1:6885/',
      protocolVersion: '0.3.0',
      preferredTransport: 'JSONRPC',
      capabilities: { streaming: false },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: [{ id: 'cloud-access-review', name: 'Cloud access review', description: 'Reviews who and what holds access to cloud resources (sample data).', tags: ['aws', 'entitlements'] }],
    });
  });

  app.post('/', (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const body = req.body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { message?: { parts?: unknown } } };
    const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null;
    const parts = Array.isArray(body.params?.message?.parts) ? body.params.message.parts as Array<{ kind?: unknown; text?: unknown }> : [];
    const question = parts.flatMap((part) => (part.kind === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('\n').trim();
    if (body.jsonrpc !== '2.0' || body.method !== 'message/send' || !question) {
      // AgentCore's documented mapping: a ValidationException is HTTP 400 with JSON-RPC code -32052.
      res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32052, message: 'Validation error - Invalid request data' } });
      return;
    }
    const echoed = question.length > MAX_QUESTION_ECHO ? `${question.slice(0, MAX_QUESTION_ECHO)}…` : question;
    const answer = INTRODUCTION.test(question) ? [
      'SIMULATED reply from the AWS agent. This is a local stand-in; no AWS account or runtime was called.',
      '',
      'I am the Cloud Access Agent. I review who and what holds access to cloud resources, and I speak A2A (JSON-RPC message/send).',
      'In a live run I would be the agent hosted in AWS on Amazon Bedrock AgentCore, reached through your Privilege gateway; here I am running as a small local process so the demo works offline.',
    ].join('\n') : [
      'SIMULATED reply from the AWS agent. This is a local stand-in; no AWS account or runtime was called.',
      '',
      `You asked: "${echoed}"`,
      '',
      'Cloud access review (sample data):',
      '- Role example-data-reader: unused for 94 days, still attached to 2 service accounts.',
      '- Role example-deploy-admin: broad permissions, last used 3 days ago.',
      '- Bucket example-audit-logs: public access blocked.',
    ].join('\n');
    res.json({ jsonrpc: '2.0', id, result: { artifacts: [{ artifactId: 'sim-artifact-1', name: 'agent_response', parts: [{ kind: 'text', text: answer }] }] } });
  });

  return app;
}
