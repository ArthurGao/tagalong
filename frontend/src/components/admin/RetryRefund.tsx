'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';
import { formatCents } from '@/lib/money';
import { ConfirmWithReason } from './ConfirmWithReason';
import { useAdminAction } from './use-admin-action';

/** Puts one FAILED refund of a bulk refund back in the queue (POST /admin/refund-tasks/:id/retry). */
export function RetryRefund({ taskId, publicCode, amountCents }: { taskId: string; publicCode: string; amountCents: number }) {
  const t = useTranslations('admin.cancellations');
  const action = useAdminAction();
  return (
    <ConfirmWithReason
      label={t('retry')}
      title={t('retryTitle', { amount: formatCents(amountCents), code: publicCode })}
      body={t('retryBody')}
      error={action.error}
      busy={action.busy}
      onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/refund-tasks/{id}/retry', { params: { path: { id: taskId } }, body: { reason } }))}
    />
  );
}
