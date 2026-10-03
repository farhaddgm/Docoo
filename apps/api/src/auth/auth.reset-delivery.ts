import { Injectable, Logger, type Provider } from '@nestjs/common';
import type { Environment } from '@docoo/config';
import { createTransport, type Transporter } from 'nodemailer';

import { API_CONFIG } from '../tokens.js';

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

/** Bilingual plain-text message; the link carries the token in the fragment only. */
export function resetMail(message: PasswordResetMessage): { subject: string; text: string } {
  return {
    subject: 'بازنشانی گذرواژهٔ Docoo / Docoo password reset',
    text: [
      'برای تعیین گذرواژهٔ جدید روی پیوند زیر بزنید. پیوند یک‌بارمصرف است و پس از مدت کوتاهی منقضی می‌شود.',
      'اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.',
      '',
      'Open the link below to choose a new password. It works once and expires soon.',
      'If you did not ask for this, ignore this message.',
      '',
      message.resetUrl,
    ].join('\n'),
  };
}

/** Sends the reset link by SMTP when `SMTP_URL` is set. Failures are logged without the link. */
export class SmtpResetDelivery implements PasswordResetDelivery {
  private readonly logger = new Logger('PasswordReset');

  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  async deliver(message: PasswordResetMessage): Promise<void> {
    const mail = resetMail(message);
    try {
      await this.transport.sendMail({ from: this.from, to: message.email, ...mail });
    } catch (error) {
      // The API answers the same either way, so a mail outage never reveals whether an account exists.
      this.logger.error(
        `Password reset mail could not be sent (${error instanceof Error ? error.name : 'error'}).`,
      );
    }
  }
}

export const resetDeliveryProvider: Provider = {
  provide: PASSWORD_RESET_DELIVERY,
  inject: [API_CONFIG],
  useFactory: (config: Environment): PasswordResetDelivery =>
    config.SMTP_URL
      ? new SmtpResetDelivery(createTransport(config.SMTP_URL), config.MAIL_FROM)
      : new OperatorResetDelivery(),
};
