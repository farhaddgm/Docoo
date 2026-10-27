import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ProviderRuntime } from '@docoo/orchestration';
import type { JsonSchema } from '@docoo/providers';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { ConfigService } from '../config/config.service.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';

@Injectable()
export class PatternRuntimeService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}
  async invoke(
    context: WorkspaceRequestContext,
    projectId: string | null,
    schema: JsonSchema,
    userInput: string,
    instructions: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (userInput.length > 80000)
      throw new ServiceUnavailableException({ code: 'PATTERN_AI_CONTEXT_TOO_LARGE' });
    const selected = await this.database.run(context, async (client) => {
      const settings = await this.config.resolve(
        client,
        context,
        projectId ? 'project' : 'workspace',
        projectId ?? context.workspaceId,
      );
      const connectionId = settings.values['ai.connection_id'];
      const model = settings.values['ai.model'];
      if (typeof connectionId !== 'string' || !connectionId || typeof model !== 'string' || !model)
        throw new ServiceUnavailableException({ code: 'PATTERN_AI_NOT_CONFIGURED' });
      return { connectionId, model };
    });
    const result = await this.runtime.invoke(
      {
        workspaceId: context.workspaceId,
        ...(projectId ? { actorId: context.actorId } : {}),
        correlationId: context.correlationId,
        onBehalfOf: context.actorId,
        projectId,
        stageRunId: null,
        attemptId: null,
        purpose: projectId ? 'meeting_preparation' : 'pattern_authoring',
        retryNo: 0,
      },
      selected.connectionId,
      {
        model: selected.model,
        instructions,
        messages: [{ role: 'user', content: userInput }],
        responseSchema: { name: 'docoo_pattern_response', schema },
        maxOutputTokens: 8000,
        timeoutMs: 25000,
      },
    );
    signal.throwIfAborted();
    if (result.response.finishReason !== 'stop')
      throw new ServiceUnavailableException({ code: 'PATTERN_AI_INCOMPLETE' });
    const content = result.response.json ?? (JSON.parse(result.response.text) as unknown);
    return {
      content,
      metadata: {
        provider: result.response.provider,
        modelId: result.response.model,
        usage: result.response.usage,
        invocationId: result.invocationId,
        costUsd: result.costUsd,
      },
    };
  }
}
