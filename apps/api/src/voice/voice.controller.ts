import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { voiceBrands, voiceConversationKinds, voicePreferencesSchema } from '@docoo/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission, UsesAi } from '../auth/auth.authorization.js';
import { badRequest, unprocessable } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { MAX_AUDIO_BYTES } from './audio-body.js';
import { audioMimeOf, VoiceService } from './voice.service.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const scopeFields = {
  conversationKind: z.enum(voiceConversationKinds).optional(),
  conversationId: uuid.optional(),
  messageId: uuid.optional(),
};
const bothOrNeither = (value: { conversationKind?: unknown; conversationId?: unknown }) =>
  (value.conversationKind === undefined) === (value.conversationId === undefined);

const transcribeQuery = z
  .object({
    locale: z.enum(['fa', 'en']).default('fa'),
    durationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
    ...scopeFields,
  })
  .strict()
  .refine(bothOrNeither);
const speakBody = z
  .object({ text: z.string().min(1).max(50_000), ...scopeFields })
  .strict()
  .refine(bothOrNeither);
const previewBody = z
  .object({
    text: z.string().trim().min(1).max(300),
    voiceId: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    speed: z.number().min(0.7).max(1.25).optional(),
  })
  .strict();
const catalogQuery = z.object({ provider: z.enum(voiceBrands).optional() }).strict();
const attachBody = z.object({ messageId: uuid }).strict();
const audioQuery = z
  .object({
    conversationKind: z.enum(voiceConversationKinds).optional(),
    conversationId: uuid.optional(),
  })
  .strict()
  .refine(bothOrNeither);
const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }).strict();
const priceBody = z
  .object({
    provider: z.enum(voiceBrands),
    model: z.string().trim().min(1).max(200),
    kind: z.enum(['stt', 'tts']),
    perMinute: z.number().min(0).max(1000).optional(),
    per1kCharacters: z.number().min(0).max(1000).optional(),
    inputPerMillion: z.number().min(0).max(10_000).optional(),
    outputPerMillion: z.number().min(0).max(10_000).optional(),
    effectiveFrom: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((value) =>
    [value.perMinute, value.per1kCharacters, value.inputPerMillion, value.outputPerMillion].some(
      (x) => x !== undefined,
    ),
  );

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw badRequest('VOICE_INVALID_REQUEST', 'Provide a valid voice request.');
  return parsed.data;
}

function idOf(raw: string): string {
  if (!isUuid(raw)) throw badRequest('VOICE_INVALID_REQUEST', 'Provide a valid voice request.');
  return raw.toLowerCase();
}

/** Voice conversation (ADR-0046): speech to text and text to speech around the text chat. */
@ApiTags('voice')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether voice can be used and with which limits (no secrets)' })
  @RequireWorkspacePermission('voice.use')
  config(@Req() request: FastifyRequest) {
    return this.voice.clientConfig(workspaceContext(request));
  }

  @Get('preferences')
  @ApiOperation({ summary: 'How the caller speaks and hears Docoo by default' })
  @RequireWorkspacePermission('voice.use')
  preferences(@Req() request: FastifyRequest) {
    return this.voice.preferences(workspaceContext(request));
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Save the caller default voice mode, auto-send and volume' })
  @RequireWorkspacePermission('voice.use')
  setPreferences(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.voice.setPreferences(
      workspaceContext(request),
      parse(voicePreferencesSchema, body),
    );
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Live models and voices of the speech provider' })
  @RequireWorkspacePermission('voice.manage')
  catalog(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.voice.catalog(workspaceContext(request), parse(catalogQuery, query).provider);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Hear a sample of a voice before saving it' })
  @UsesAi()
  @RequireWorkspacePermission('voice.manage')
  async preview(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const out = await this.voice.preview(workspaceContext(request), parse(previewBody, body));
    reply.header('content-type', out.mimeType).header('cache-control', 'no-store');
    return Buffer.from(out.audio);
  }

  @Post('transcribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn a recording (raw audio body) into text' })
  @UsesAi()
  @RequireWorkspacePermission('voice.use')
  async transcribe(@Req() request: FastifyRequest, @Query() query: unknown) {
    const input = parse(transcribeQuery, query);
    const mimeType = audioMimeOf(request.headers['content-type']);
    const body = request.body;
    if (!mimeType || !Buffer.isBuffer(body))
      throw unprocessable(
        'VOICE_AUDIO_INVALID',
        'Send the recording as the request body with an audio content type.',
      );
    if (body.byteLength > MAX_AUDIO_BYTES)
      throw unprocessable('VOICE_AUDIO_TOO_LARGE', 'The recording is too large.');
    return this.voice.transcribe(workspaceContext(request), {
      audio: body,
      mimeType,
      locale: input.locale,
      durationMs: input.durationMs,
      scope: {
        conversationKind: input.conversationKind,
        conversationId: input.conversationId,
        messageId: input.messageId,
      },
    });
  }

  @Post('speak')
  @HttpCode(200)
  @ApiOperation({ summary: 'Read a text aloud in the chosen voice' })
  @UsesAi()
  @RequireWorkspacePermission('voice.use')
  async speak(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(speakBody, body);
    const out = await this.voice.speak(workspaceContext(request), {
      text: input.text,
      scope: {
        conversationKind: input.conversationKind,
        conversationId: input.conversationId,
        messageId: input.messageId,
      },
    });
    reply
      .header('content-type', out.mimeType)
      .header('cache-control', 'no-store')
      .header('x-voice-truncated', out.truncated ? '1' : '0');
    return Buffer.from(out.audio);
  }

  @Get('audio')
  @ApiOperation({ summary: 'Own stored recordings (metadata only)' })
  @RequireWorkspacePermission('voice.use')
  listAudio(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.voice.listAudio(workspaceContext(request), parse(audioQuery, query));
  }

  @Get('audio/:audioId')
  @ApiOperation({ summary: 'Play an own stored recording' })
  @RequireWorkspacePermission('voice.use')
  async audio(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('audioId') raw: string,
  ) {
    const out = await this.voice.audioBytes(workspaceContext(request), idOf(raw));
    reply.header('content-type', out.mime).header('cache-control', 'no-store');
    return Buffer.from(out.bytes);
  }

  @Post('audio/:audioId/attach')
  @HttpCode(200)
  @ApiOperation({ summary: 'Link a stored recording to the message it became' })
  @RequireWorkspacePermission('voice.use')
  async attach(
    @Req() request: FastifyRequest,
    @Param('audioId') raw: string,
    @Body() body: unknown,
  ) {
    await this.voice.attachAudio(
      workspaceContext(request),
      idOf(raw),
      parse(attachBody, body).messageId,
    );
    return { attached: true };
  }

  @Delete('audio/:audioId')
  @ApiOperation({ summary: 'Delete one own stored recording' })
  @RequireWorkspacePermission('voice.use')
  deleteOne(@Req() request: FastifyRequest, @Param('audioId') raw: string) {
    return this.voice.deleteAudio(workspaceContext(request), { kind: 'one', id: idOf(raw) });
  }

  @Delete('audio')
  @ApiOperation({ summary: 'Delete own recordings of one conversation, or all of them' })
  @RequireWorkspacePermission('voice.use')
  deleteMany(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { conversationKind, conversationId } = parse(audioQuery, query);
    return this.voice.deleteAudio(
      workspaceContext(request),
      conversationKind && conversationId
        ? { kind: 'conversation', conversationKind, conversationId }
        : { kind: 'mine' },
    );
  }

  @Delete('workspace-audio')
  @ApiOperation({ summary: 'Owner: delete every stored recording of the workspace' })
  @RequireWorkspacePermission('voice.manage')
  deleteWorkspace(@Req() request: FastifyRequest) {
    return this.voice.deleteAudio(workspaceContext(request), { kind: 'workspace' });
  }

  @Post('workspace-audio/purge-expired')
  @HttpCode(200)
  @ApiOperation({ summary: 'Owner: delete recordings whose retention ended' })
  @RequireWorkspacePermission('voice.manage')
  purgeExpired(@Req() request: FastifyRequest) {
    return this.voice.deleteAudio(workspaceContext(request), { kind: 'expired' });
  }

  @Get('usage')
  @ApiOperation({ summary: 'Own voice usage, apart from the text model cost' })
  @RequireWorkspacePermission('voice.use')
  usage(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.voice.usage(workspaceContext(request), {
      all: false,
      days: parse(usageQuery, query).days,
    });
  }

  @Get('usage/all')
  @ApiOperation({ summary: 'Owner: voice usage of every account' })
  @RequireWorkspacePermission('voice.manage')
  usageAll(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.voice.usage(workspaceContext(request), {
      all: true,
      days: parse(usageQuery, query).days,
    });
  }

  @Get('prices')
  @ApiOperation({ summary: 'Owner: prices of voice models' })
  @RequireWorkspacePermission('voice.manage')
  prices(@Req() request: FastifyRequest) {
    return this.voice.listPrices(workspaceContext(request));
  }

  @Post('prices')
  @HttpCode(201)
  @ApiOperation({ summary: 'Owner: add a price for a voice model' })
  @RequireWorkspacePermission('voice.manage')
  addPrice(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.voice.addPrice(workspaceContext(request), parse(priceBody, body));
  }
}
