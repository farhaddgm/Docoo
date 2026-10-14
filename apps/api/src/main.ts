import 'reflect-metadata';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseEnvironment } from '@docoo/config';
import type { IncomingMessage } from 'node:http';
import { correlationRecord, logCorrelation, withCorrelation } from '@docoo/observability';

import { AppModule } from './app.module.js';
import { isUuid } from './common/request-context.js';
import { requestCorrelation, RequestCorrelationInterceptor } from './common/request-correlation.js';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const config = parseEnvironment(process.env);

const adapter = new FastifyAdapter({
  // Behind the TLS proxy, trust exactly that many hops of X-Forwarded-For so rate limits see
  // the real client; with 0 (default) the header is ignored and cannot be spoofed.
  trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
  disableRequestLogging: true,
  logger: {
    level: config.LOG_LEVEL,
    hooks: {
      logMethod(_args, method) {
        const record = correlationRecord('api.runtime', { service: 'api' });
        delete record['level'];
        method.call(this, record, 'api.runtime');
      },
    },
    serializers: {
      req: (request: { method: string; url: string; id: string }) => ({
        method: request.method,
        id: request.id,
      }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        '*.password',
        '*.token',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
  requestIdHeader: false,
  genReqId: (request: IncomingMessage) => {
    const id = request.headers['x-request-id'];
    return isUuid(id) ? id.toLowerCase() : randomUUID();
  },
});

const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
  bufferLogs: true,
});
app.useLogger({
  log: () => logCorrelation('api.lifecycle', { service: 'api' }),
  error: () => logCorrelation('api.lifecycle.failed', { service: 'api' }),
  warn: () => logCorrelation('api.lifecycle', { service: 'api', logLevel: 'warn' }),
  debug: () => logCorrelation('api.lifecycle', { service: 'api', logLevel: 'debug' }),
  verbose: () => logCorrelation('api.lifecycle', { service: 'api', logLevel: 'debug' }),
});
app.useGlobalInterceptors(new RequestCorrelationInterceptor());
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    done();
  });
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onResponse', (request, reply, done) => {
    withCorrelation(requestCorrelation(request), () =>
      logCorrelation('api.request.completed', {
        service: 'api',
        method: request.method,
        httpStatus: reply.statusCode,
        durationMs: reply.elapsedTime,
      }),
    );
    done();
  });

await app.register(cookie, { secret: config.SESSION_PEPPER });
await app.register(
  helmet,
  config.NODE_ENV === 'production' ? {} : { contentSecurityPolicy: false },
);
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    const sensitiveAuthRoute = [
      '/auth/login',
      '/auth/google',
      '/auth/google/callback',
      '/auth/password/reset-request',
      '/auth/password/reset',
    ].some((suffix) => routeOptions.url.endsWith(suffix));
    if (
      sensitiveAuthRoute &&
      (methods.includes('POST') || routeOptions.url.includes('/auth/google'))
    ) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
      };
    }
  });
await app.register(rateLimit, {
  max: config.API_RATE_LIMIT_PER_MINUTE,
  timeWindow: '1 minute',
  ban: 3,
  errorResponseBuilder: (_request, context) =>
    new HttpException(
      {
        status: context.statusCode,
        title: context.ban ? 'Forbidden' : 'Too Many Requests',
        code: 'AUTH_RATE_LIMITED',
        detail: 'Please wait before trying again.',
      },
      context.statusCode,
    ),
});

app.enableCors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
app.enableShutdownHooks();
app.setGlobalPrefix('v1');
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);

if (config.NODE_ENV !== 'production') {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Docoo API')
    .setDescription('Private Docoo control-plane API')
    .setVersion('0.1.0')
    .addCookieAuth('docoo_session')
    .build();
  SwaggerModule.setup('v1/openapi', app, SwaggerModule.createDocument(app, swaggerConfig));
}

await app.listen(config.API_PORT, config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
