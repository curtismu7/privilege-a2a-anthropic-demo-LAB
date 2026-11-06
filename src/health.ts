import { anthropicBaseUrl, geminiBaseUrl, providerOf, type AgentName } from './config.js';

const DEMO = { id: 'privilege-a2a-anthropic-demo', name: 'Privilege A2A Anthropic Demo', version: '1.0.0' };

const value = (name: string): string => process.env[name]?.trim() || '';

/**
 * True when the MAIN_AGENT has a model provider configured: an API key for its
 * provider, or (through the gateway) a base URL plus its agent access key.
 */
export function realAvailable(agent: AgentName = 'MAIN_AGENT'): boolean {
  const provider = providerOf(agent);
  if (provider === 'groq') return Boolean(value(`${agent}_GROQ_KEY`) || value('GROQ_API_KEY'));
  if (provider === 'llamacpp') return Boolean(value(`${agent}_LLAMACPP_KEY`) || value('LLAMACPP_API_KEY'));
  if (provider === 'google') {
    const baseUrl = geminiBaseUrl();
    return Boolean(baseUrl ? value(`${agent}_KEY`) : value(`${agent}_GEMINI_KEY`) || value('GEMINI_API_KEY'));
  }
  const baseUrl = anthropicBaseUrl();
  return Boolean(baseUrl ? value(`${agent}_KEY`) || value('ANTHROPIC_AUTH_TOKEN') : value(`${agent}_ANTHROPIC_API_KEY`) || value('ANTHROPIC_API_KEY'));
}

/** The mode-toggle contract (STANDALONE-RULES rule 19): what the UI asks before offering Real. */
export function infoDocument(agent: AgentName = 'MAIN_AGENT'): { source: 'mock' | 'real'; realAvailable: boolean } {
  const realAvailableResult = realAvailable(agent);
  return { source: realAvailableResult ? 'real' : 'mock', realAvailable: realAvailableResult };
}

/** demo-health/1 (demo-shelf-LAB docs/health-contract.md): public, small, no secrets. */
export function healthDocument(agent: AgentName = 'MAIN_AGENT'): {
  schema: 'demo-health/1';
  at: string;
  state: 'ready' | 'needs-setup';
  runtime: 'live' | 'offline';
  demo: { id: string; name: string; version: string };
} {
  const available = realAvailable(agent);
  return {
    schema: 'demo-health/1',
    at: new Date().toISOString(),
    state: available ? 'ready' : 'needs-setup',
    runtime: available ? 'live' : 'offline',
    demo: DEMO,
  };
}
