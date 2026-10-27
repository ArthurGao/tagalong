import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { EmailService, ResendEmailService, SmtpEmailService } from './email.service.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxJob } from './outbox.job.js';

@Module({
  providers: [
    NotificationsService,
    OutboxJob,
    {
      provide: EmailService,
      inject: [ENV],
      useFactory: (env: Env): EmailService =>
        env.EMAIL_PROVIDER === 'resend' ? new ResendEmailService(env) : new SmtpEmailService(env),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
