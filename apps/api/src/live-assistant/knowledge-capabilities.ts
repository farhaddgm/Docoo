import { z } from 'zod';

import type { KnowledgeService } from '../knowledge/knowledge.service.js';
import { defineCapability, type LiveCapability, type LiveLocale } from './capabilities.js';
import { CAPABILITY_TOOLS } from './capability-tools.js';

/**
 * The live assistant's reads of the knowledge base (ADR-0055 §4-3). Knowledge belongs to the whole
 * back office, not to one project, so it is within reach only when the owner gave the assistant the
 * back office. Only the list of items comes back (title, kind, state), never their text: that can
 * be long-form content written by others.
 */

const t = (locale: LiveLocale, fa: string, en: string): string => (locale === 'fa' ? fa : en);

export function knowledgeCapabilities(services: {
  readonly knowledge: KnowledgeService;
}): LiveCapability[] {
  const { knowledge } = services;

  const search = defineCapability({
    meta: { name: 'knowledge.search', klass: 'T0', area: 'backoffice', write: false },
    tool: CAPABILITY_TOOLS['knowledge.search'],
    params: z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    describe: (params, locale) => ({
      summary: params.q
        ? t(locale, `جست‌وجو در دانش («${params.q}»)`, `Search the knowledge base ("${params.q}")`)
        : t(locale, 'فهرست دانش', 'Knowledge list'),
    }),
    execute: async ({ context }, params) => {
      const page = await knowledge.list(context, {
        limit: params.limit,
        ...(params.q ? { q: params.q } : {}),
      });
      return {
        items: page.items.map((item) => ({
          id: item.id,
          title: item.title,
          sourceType: item.sourceType,
          status: item.status,
          versionNo: item.versionNo,
          validUntil: item.validUntil,
          claims: item.claimCount,
          openConflicts: item.openConflicts,
        })),
        more: page.nextCursor !== null,
      };
    },
  });

  return [search];
}
