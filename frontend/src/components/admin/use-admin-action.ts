'use client';

import { useRouter } from 'next/navigation';
import { useSave } from '@/lib/api/use-save';

/**
 * A drawer's write: through useSave (errors mapped to messages), then a refresh so the server-rendered list and
 * drawer show the new state. `act` answers whether it worked, which is what ConfirmWithReason needs.
 */
export function useAdminAction() {
  const router = useRouter();
  const save = useSave();
  const act = async <T,>(call: () => Promise<{ data?: T; error?: { code?: string; details?: unknown } | string }>) => {
    const done = await save.run(call);
    if (done) router.refresh();
    return done !== null;
  };
  return { act, error: save.error, busy: save.saving };
}
