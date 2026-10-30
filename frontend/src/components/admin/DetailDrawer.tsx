'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * The right-hand detail drawer (UI-STYLE §4: a row opens it, the list stays). The selection lives in the URL (?id=),
 * so the page reloads its data on the server and closing goes back to the list's own address.
 */
export function DetailDrawer({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const t = useTranslations('admin.drawer');
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => !open && router.push(closeHref, { scroll: false })}>
      <DialogContent
        closeLabel={t('close')}
        aria-describedby={undefined}
        className="top-0 right-0 left-auto h-full max-h-none w-full max-w-xl translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none border-l bg-card sm:max-w-xl"
      >
        <DialogTitle className="pr-8 text-base font-semibold">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
