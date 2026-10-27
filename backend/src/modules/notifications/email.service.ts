import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

// DESIGN §12: business code never sends mail; only outbox.job calls this. Tests swap the token for a fake.
export abstract class EmailService {
  abstract send(email: OutgoingEmail): Promise<void>;
}

/** Local development: Mailpit's SMTP port (docker compose), viewed at http://localhost:8026. */
@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({ from: this.env.EMAIL_FROM || 'TagAlong <no-reply@tagalong.test>', ...email });
  }
}

/** Production: Resend's HTTP API (no SDK needed for one call). */
@Injectable()
export class ResendEmailService extends EmailService {
  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  async send(email: OutgoingEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        // Resend takes attachment content as base64.
        attachments: email.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64'), content_type: a.contentType })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  }
}
