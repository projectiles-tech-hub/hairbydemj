// Turning what is in the cart into parcels a carrier can price: total weight,
// and which of our boxes (package sizes, set by staff) it goes in.

export interface PackageSize {
  id: number;
  name: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  emptyWeightGrams: number;
}

export interface Item {
  quantity: number;
  /** Weight of one. */
  weightGrams: number;
  /** The item's own size, when staff entered it. */
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  /** The box this product normally ships in, when staff chose one. */
  packageSizeId: number | null;
}

export interface Parcel {
  packageSizeId: number | null;
  name: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** Used when staff have not set up any boxes yet: a medium mailer box. */
export const DEFAULT_BOX: PackageSize = { id: 0, name: 'Standard box', lengthMm: 350, widthMm: 250, heightMm: 120, emptyWeightGrams: 250 };

/** Carriers' usual most for one express parcel, kept well under to leave room. */
export const MAX_PARCEL_GRAMS = 30_000;

const volume = (l: number, w: number, h: number): number => l * w * h;
const sorted = (l: number, w: number, h: number): number[] => [l, w, h].sort((a, b) => b - a);

/** Room each item takes: its own size if known, else its usual box, else a small share of the default box. */
function itemVolume(item: Item, boxes: Map<number, PackageSize>): { volume: number; loose: number; dims: number[] } {
  // An item that comes in its own box needs exactly that room; loose items need a little spare.
  const box = item.packageSizeId === null ? undefined : boxes.get(item.packageSizeId);
  if (box) {
    const v = volume(box.lengthMm, box.widthMm, box.heightMm);
    return { volume: v, loose: 0, dims: sorted(box.lengthMm, box.widthMm, box.heightMm) };
  }
  if (item.lengthMm && item.widthMm && item.heightMm) {
    const v = volume(item.lengthMm, item.widthMm, item.heightMm);
    return { volume: v, loose: v, dims: sorted(item.lengthMm, item.widthMm, item.heightMm) };
  }
  // A bundle of hair packs small: about a sixth of the standard box.
  const v = volume(DEFAULT_BOX.lengthMm, DEFAULT_BOX.widthMm, DEFAULT_BOX.heightMm) / 6;
  return { volume: v, loose: v, dims: [0, 0, 0] };
}

/**
 * Pack the items into as few boxes as possible. Each box is the smallest that
 * holds the room the items need (with a little to spare) and the biggest
 * single item, and stays under the weight limit. Nothing clever: hair packs
 * soft, so room and weight are what matter.
 */
export function packItems(items: Item[], sizes: PackageSize[]): Parcel[] {
  const units = items.filter((i) => i.quantity > 0);
  if (units.length === 0) return [];
  const boxes = new Map(sizes.map((s) => [s.id, s]));
  const choices = (sizes.length ? sizes : [DEFAULT_BOX]).slice().sort((a, b) => volume(a.lengthMm, a.widthMm, a.heightMm) - volume(b.lengthMm, b.widthMm, b.heightMm));
  const largest = choices[choices.length - 1] as PackageSize;

  // One entry per single item, heaviest and biggest first.
  const singles = units.flatMap((i) => Array.from({ length: i.quantity }, () => ({ weight: i.weightGrams, ...itemVolume(i, boxes) })));
  singles.sort((a, b) => b.volume - a.volume || b.weight - a.weight);

  const parcels: Parcel[] = [];
  type Need = { volume: number; loose: number; weight: number; dims: number[] };
  let open: Need | null = null;
  const fits = (box: PackageSize, need: Need): boolean => {
    const d = sorted(box.lengthMm, box.widthMm, box.heightMm);
    return volume(box.lengthMm, box.widthMm, box.heightMm) >= need.volume + need.loose * 0.15 && need.dims.every((x, k) => x <= (d[k] ?? 0)) && need.weight + box.emptyWeightGrams <= MAX_PARCEL_GRAMS;
  };
  const close = (need: Need): void => {
    const box = choices.find((b) => fits(b, need)) ?? largest;
    parcels.push({ packageSizeId: box.id === 0 ? null : box.id, name: box.name, weightGrams: Math.max(1, Math.round(need.weight + box.emptyWeightGrams)), lengthMm: box.lengthMm, widthMm: box.widthMm, heightMm: box.heightMm });
  };
  for (const s of singles) {
    const next: Need = open
      ? { volume: open.volume + s.volume, loose: open.loose + s.loose, weight: open.weight + s.weight, dims: open.dims.map((x, k) => Math.max(x, s.dims[k] ?? 0)) }
      : { volume: s.volume, loose: s.loose, weight: s.weight, dims: s.dims };
    if (open && !fits(largest, next)) {
      close(open);
      open = { volume: s.volume, loose: s.loose, weight: s.weight, dims: s.dims };
    } else {
      open = next;
    }
  }
  if (open) close(open);
  return parcels;
}

export const totalWeight = (parcels: Parcel[]): number => parcels.reduce((sum, p) => sum + p.weightGrams, 0);
