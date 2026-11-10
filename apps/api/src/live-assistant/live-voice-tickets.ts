import { createHash, randomBytes } from 'node:crypto';
import { LIVE_VOICE_TICKET_TTL_MS } from '@docoo/contracts';

import type { WorkspaceRequestContext } from '../common/request-context.js';

/**
 * One-time tickets for opening the voice link. A WebSocket cannot be protected like an ordinary
 * request (the page cannot set headers, and the browser sends cookies on a cross-site upgrade), so
 * the page first asks, with its normal authenticated request, for a ticket tied to one of its own
 * live sessions; the ticket then opens the link once, within seconds. Only a hash of it is kept,
 * and it is never written to disk or to the logs.
 */
export interface VoiceTicketEntry {
  readonly context: WorkspaceRequestContext;
  readonly sessionId: string;
}

const MAX_OPEN_TICKETS = 200;

export class VoiceTickets {
  private readonly open = new Map<string, VoiceTicketEntry & { expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = LIVE_VOICE_TICKET_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private static hash(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
  }

  private sweep(): void {
    const at = this.now();
    for (const [key, value] of this.open) if (value.expiresAt <= at) this.open.delete(key);
  }

  issue(entry: VoiceTicketEntry): string {
    this.sweep();
    // Past the limit the oldest go first: a flood of tickets cannot grow memory without bound.
    while (this.open.size >= MAX_OPEN_TICKETS) {
      const oldest = this.open.keys().next().value;
      if (oldest === undefined) break;
      this.open.delete(oldest);
    }
    const ticket = randomBytes(32).toString('base64url');
    this.open.set(VoiceTickets.hash(ticket), { ...entry, expiresAt: this.now() + this.ttlMs });
    return ticket;
  }

  /** Spends a ticket: it works once, and only for the session it was issued for. */
  take(ticket: string, sessionId: string): VoiceTicketEntry | null {
    if (ticket.length < 16 || ticket.length > 200) return null;
    const key = VoiceTickets.hash(ticket);
    const found = this.open.get(key);
    if (!found) return null;
    this.open.delete(key);
    if (found.expiresAt <= this.now() || found.sessionId !== sessionId) return null;
    return { context: found.context, sessionId: found.sessionId };
  }
}
