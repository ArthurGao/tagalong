import type { EmailService, OutgoingEmail } from '../../../src/modules/notifications/email.service.js';

export class FakeEmailService implements EmailService {
  readonly sent: OutgoingEmail[] = [];
  /** While true, every send throws, like a provider outage. */
  failing = false;

  reset(): void {
    this.sent.length = 0;
    this.failing = false;
  }

  async send(email: OutgoingEmail): Promise<void> {
    if (this.failing) throw new Error('email provider down');
    this.sent.push(email);
  }
}
