import { Bricolage_Grotesque, Figtree } from 'next/font/google';

// The public surface's typefaces (UI-STYLE §2), shared by the public layout and the merchant's preview of a listing.
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-bricolage' });
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-figtree' });

export const publicFontVariables = `${bricolage.variable} ${figtree.variable}`;
