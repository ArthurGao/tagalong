import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

// DESIGN §10: every admin sign-in is audited and every admin is alerted (Hobby tier has no MFA).
@Injectable()
export class AdminSignInService {
  constructor(private readonly prisma: PrismaService) {}

  async record(sessionId: string, clerkUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true, email: true, role: true, deletedAt: true },
    });
    if (!user || user.role !== 'ADMIN' || user.deletedAt) return;
    const signedInAt = new Date().toISOString();

    await this.prisma.$transaction(async (tx) => {
      // audit_log_admin_sign_in_session_key makes a Svix redelivery a no-op, even when concurrent.
      const { count } = await tx.auditLog.createMany({
        data: [{ actorUserId: user.id, actorRole: 'ADMIN', action: 'ADMIN_SIGN_IN', targetType: 'session', targetId: sessionId }],
        skipDuplicates: true,
      });
      if (count === 0) return;
      const admins = await tx.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true, email: true } });
      // Sent by outbox.job (M5); the dedupeKey keeps one alert per admin per session.
      await tx.notificationOutbox.createMany({
        data: admins.map((admin) => ({
          type: 'ADMIN_SIGN_IN',
          recipient: admin.email,
          locale: 'en',
          payload: { adminEmail: user.email, sessionId, signedInAt },
          dedupeKey: `ADMIN_SIGN_IN:${sessionId}:${admin.id}`,
        })),
        skipDuplicates: true,
      });
    });
  }
}
