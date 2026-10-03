import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { resetMail, resetUrl, SmtpResetDelivery } from '../src/auth/auth.reset-delivery.js';

const link = resetUrl('https://docoo.example', 'secret-token+/=');

describe('password reset mail (AUTH-002)', () => {
  it('sends a bilingual message with the link only in the URL fragment', async () => {
    const sent: { envelope: { to: string[] }; message: string }[] = [];
    const transport = createTransport({ jsonTransport: true });
    const delivery = new SmtpResetDelivery(
      {
        sendMail: async (mail) => {
          const info = (await transport.sendMail(mail)) as unknown as {
            envelope: { to: string[] };
            message: string;
          };
          sent.push(info);
          return info as never;
        },
      },
      'Docoo <no-reply@docoo.example>',
    );
    await delivery.deliver({ email: 'admin@docoo.example', resetUrl: link });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.envelope.to).toEqual(['admin@docoo.example']);
    const body = JSON.parse(sent[0]!.message) as {
      subject: string;
      text: string;
      from: { address: string };
    };
    expect(body.from.address).toBe('no-reply@docoo.example');
    expect(body.subject).toContain('password reset');
    expect(body.text).toContain('گذرواژهٔ جدید');
    expect(body.text).toContain(
      'https://docoo.example/fa/reset-password#token=secret-token%2B%2F%3D',
    );
  });

  it('never throws or leaks the link when the mail server fails', async () => {
    const delivery = new SmtpResetDelivery(
      { sendMail: () => Promise.reject(new Error(`connection refused while sending ${link}`)) },
      'Docoo <no-reply@docoo.example>',
    );
    await expect(
      delivery.deliver({ email: 'admin@docoo.example', resetUrl: link }),
    ).resolves.toBeUndefined();
  });

  it('keeps the subject and text free of the raw token', () => {
    const mail = resetMail({ email: 'a@b.c', resetUrl: link });
    expect(mail.subject).not.toContain('secret-token');
    expect(mail.text.match(/secret-token/gu)).toHaveLength(1);
  });
});
