import type { components } from '@/lib/api/schema';

export type Listing = components['schemas']['ListingDto'];
export type FormFieldInput = components['schemas']['FormFieldDto'];

export interface StepProps {
  listing: Listing;
  onSaved: (listing: Listing) => void;
}
