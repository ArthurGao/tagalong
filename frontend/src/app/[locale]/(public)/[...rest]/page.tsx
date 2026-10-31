import { notFound } from 'next/navigation';

// Any other path under a locale: the public 404 above instead of Next's bare default page.
export default function UnknownPage() {
  notFound();
}
