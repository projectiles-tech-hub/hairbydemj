// Sample catalogue for the design preview. These names and prices are
// placeholders, not decisions. Real data comes from the API (modules 4 to 9).

export interface Product {
  id: string;
  name: string;
  details: string;
  /** Price in kobo (minor units), as the money convention requires. */
  priceMinor: number;
  badge?: string;
  category: string;
}

const BASE: Array<Omit<Product, 'id'>> = [
  { name: 'Bone straight wig', details: '22 inches, 180% density', priceMinor: 28500000, badge: 'Best-seller', category: 'Wigs' },
  { name: 'Body wave bundles', details: 'Set of 3, 20 inches', priceMinor: 16500000, category: 'Bundles' },
  { name: 'HD lace closure 5×5', details: '18 inches', priceMinor: 7800000, category: 'Closures and frontals' },
  { name: 'Deep wave frontal wig', details: '24 inches, 200% density', priceMinor: 34000000, category: 'Wigs' },
  { name: 'Kinky curly bundles', details: 'Set of 3, 18 inches', priceMinor: 15000000, badge: 'New', category: 'Bundles' },
  { name: 'Lace frontal 13×4', details: '20 inches, HD lace', priceMinor: 9500000, category: 'Closures and frontals' },
  { name: 'Silk bonnet', details: 'One size', priceMinor: 850000, category: 'Accessories' },
  { name: 'Wig care set', details: 'Shampoo, conditioner, serum', priceMinor: 2200000, category: 'Accessories' },
];

/** A catalogue of the given size, made by repeating the base products. */
export function sampleProducts(count: number): Product[] {
  const list: Product[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = BASE[i % BASE.length] as Omit<Product, 'id'>;
    list.push({ ...base, id: `p${i + 1}`, badge: i < BASE.length ? base.badge : undefined });
  }
  return list;
}

/** Format kobo as naira, for example 28500000 becomes ₦285,000. */
export function naira(minor: number): string {
  return '₦' + Math.round(minor / 100).toLocaleString('en-NG');
}

export const CATEGORIES = ['Wigs', 'Bundles', 'Closures and frontals', 'Accessories'] as const;
