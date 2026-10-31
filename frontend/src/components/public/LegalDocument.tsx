import { getTranslations } from 'next-intl/server';
import { Section } from './Section';

export const LEGAL_DOCS = ['terms', 'privacy'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

// The terms and privacy pages (DESIGN §10, §11): text and its date from the message catalog, with a draft banner until
// a lawyer signs it off (DESIGN §16-7).
export async function LegalDocument({ doc }: { doc: LegalDoc }) {
  const t = await getTranslations('public.legal');
  const sections = t.raw(`${doc}.sections`) as { heading: string; paragraphs: string[] }[];
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 py-8">
      <p role="note" className="rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-sm font-semibold">
        {t('draft')}
      </p>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[28px] font-bold">{t(`${doc}.title`)}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', { date: new Date(t(`${doc}.updated`)) })}</p>
      </header>
      {sections.map((s) => (
        <Section key={s.heading} title={s.heading}>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </Section>
      ))}
      <p className="text-sm text-muted-foreground">{t('contact')}</p>
    </main>
  );
}
