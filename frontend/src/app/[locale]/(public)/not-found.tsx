import { NotFoundView } from '@/components/public/NotFoundView';

// notFound() on a public page (an unknown listing, order or merchant) renders here, inside the public layout.
export default function PublicNotFound() {
  return <NotFoundView />;
}
