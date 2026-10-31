import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminAuditQueryDto, AuditPageDto } from './admin.dto.js';
import { PAGE, page } from './paging.js';

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/audit-log?actor=&action=&targetId=&cursor= (DESIGN §9): newest first, 50 a page. Append-only: no writes. */
  async list(query: AdminAuditQueryDto): Promise<AuditPageDto> {
    const actor = query.actor && normalizeEmail(query.actor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(actor && { actor: { email: actor } }), // stored normalised (common/email.ts)
        ...(query.action && { action: query.action }),
        ...(query.targetId && { targetId: query.targetId.trim() }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      include: { actor: { select: { email: true } } },
    });
    return page(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorRole: r.actorRole,
        actorEmail: r.actor?.email ?? null,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        metadata: r.metadata as Record<string, unknown>,
        ip: r.ip,
        createdAt: r.createdAt,
      })),
    );
  }
}
