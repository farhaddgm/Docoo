import { Injectable, Logger } from '@nestjs/common';

export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

export interface PasswordResetMessage {
  readonly email: string;
  /** Link with the token in the URL fragment so it never reaches server logs. */
  readonly resetUrl: string;
}

export interface PasswordResetDelivery {
  deliver(message: PasswordResetMessage): Promise<void>;
}

/**
 * Default delivery until a mail adapter is configured: the request is accepted and
 * audited, and the operator issues a link with `pnpm admin:reset-link`. The token is
 * never logged.
 */
@Injectable()
export class OperatorResetDelivery implements PasswordResetDelivery {
  private readonly logger = new Logger('PasswordReset');

  deliver(): Promise<void> {
    this.logger.log('Password reset requested; no mail adapter configured (use admin:reset-link).');
    return Promise.resolve();
  }
}

export function resetUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/$/, '')}/fa/reset-password#token=${encodeURIComponent(token)}`;
}
