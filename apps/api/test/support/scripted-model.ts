import type { InvocationScope, ProviderRuntime } from '@docoo/orchestration';
import type { NormalizedModelRequest, NormalizedModelResponse, ToolCall } from '@docoo/providers';

/**
 * A model that says what a test tells it to, in order, in place of the provider runtime. It records
 * each request and the scope it was made in, so a test can check what the executor asked and for
 * whom. The real runtime and the fake adapter are covered by their own suites; this one is for the
 * behaviour of the live assistant around the model.
 */
export type ScriptedTurn = NormalizedModelResponse | Error;

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  reasoningTokens: null,
  cachedInputTokens: null,
};

export const say = (text: string): NormalizedModelResponse => ({
  provider: 'fake',
  model: 'scripted',
  text,
  json: null,
  toolCalls: [],
  finishReason: 'stop',
  rawFinishReason: null,
  usage,
  providerRequestId: null,
  latencyMs: 1,
});

export const use = (...calls: ToolCall[]): NormalizedModelResponse => ({
  ...say(''),
  finishReason: 'tool_call',
  toolCalls: calls,
});

export const toolCall = (name: string, args: unknown, id = `call-${name}`): ToolCall => ({
  id,
  name,
  arguments: args,
});

export class ScriptedModel {
  readonly requests: NormalizedModelRequest[] = [];
  readonly scopes: InvocationScope[] = [];
  readonly connections: string[] = [];
  /** What each call costs; null is a model with no price on record. */
  costUsd: number | null = 0.01;
  /** Runs while a call is being answered, so a test can act in the middle of a request. */
  during: (() => Promise<void>) | null = null;
  private turns: ScriptedTurn[] = [];

  script(...turns: ScriptedTurn[]): void {
    this.turns = [...turns];
  }

  reset(): void {
    this.requests.length = 0;
    this.scopes.length = 0;
    this.connections.length = 0;
    this.turns = [];
    this.costUsd = 0.01;
    this.during = null;
  }

  get remaining(): number {
    return this.turns.length;
  }

  readonly runtime = {
    invoke: async (
      scope: InvocationScope,
      connectionId: string,
      request: NormalizedModelRequest,
    ) => {
      this.requests.push(request);
      this.scopes.push(scope);
      this.connections.push(connectionId);
      if (this.during) {
        const run = this.during;
        this.during = null;
        await run();
      }
      const next = this.turns.shift();
      if (next === undefined) throw new Error('The scripted model has nothing left to say.');
      if (next instanceof Error) throw next;
      return { response: next, invocationId: 'scripted-invocation', costUsd: this.costUsd };
    },
  } as unknown as ProviderRuntime;
}
