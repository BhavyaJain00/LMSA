import type { Vec3 } from "./math";

/** Camera distance and vertical field of view shared by the layout and the renderer. */
export const CAMERA_Z = 14;
export const FOV_Y = (40 * Math.PI) / 180;

/** Height of the visible world at depth 0. */
export const VIEW_HEIGHT = 2 * CAMERA_Z * Math.tan(FOV_Y / 2);

/** How fast the camera travels compared with the page (below 1 = objects drift slower than the text: depth). */
export const SCROLL_FACTOR = 0.75;

/** Where one model floats, how big it is and how it moves. */
export interface Placement {
  model: number;
  position: Vec3;
  scale: number;
  rotation: Vec3;
  /** Y: radians per second (a steady turn); X and Z: rocking speed (they sway, never flip over). */
  spin: Vec3;
  bobSpeed: number;
  bobAmount: number;
  phase: number;
}

/** Small deterministic random generator, so the scene looks the same on every visit and render. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** World distance the camera travels from the top of the page to the bottom. */
export function scrollDistance(pageViewports: number): number {
  return Math.max(0, pageViewports - 1) * VIEW_HEIGHT * SCROLL_FACTOR;
}

/**
 * Place the models down the whole page, alternating left and right of the centre column so text stays
 * readable. The first two frame the hero. Narrow (phone) screens get smaller models pushed to the edges.
 */
export function buildLayout(aspect: number, pageViewports: number, modelCount: number, seed = 7): Placement[] {
  const random = seededRandom(seed);
  const range = (min: number, max: number) => min + random() * (max - min);
  const halfWidth = (VIEW_HEIGHT * aspect) / 2;
  const narrow = aspect < 0.85;
  const spacing = narrow ? 3.4 : 3.1;
  const travel = scrollDistance(pageViewports);
  const count = Math.min(18, Math.max(4, Math.ceil((travel + VIEW_HEIGHT) / spacing) + 1));

  const placements: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const hero = i < 2;
    // Phones: models peek in from the edges so they never sit on the text.
    const edge = narrow ? range(0.95, 1.12) : hero ? range(0.7, 0.8) : range(0.62, 0.88);
    const y = hero ? (i === 0 ? 1.4 : -1.9) : 1.2 - i * spacing + range(-0.6, 0.6);
    const z = hero ? range(-0.5, 1) : range(-5, 1.5);
    const scale = (narrow ? 0.58 : 1) * (hero ? 1.25 : range(0.8, 1.1));
    placements.push({
      model: i % modelCount,
      position: [side * halfWidth * edge, y, z],
      scale,
      // Tipped towards the camera so the tops of the models show; they turn around Y and only rock on X/Z.
      rotation: [range(0.3, 0.65), range(0, Math.PI * 2), range(-0.25, 0.25)],
      spin: [range(0.15, 0.25), range(0.15, 0.35) * (random() < 0.5 ? -1 : 1), range(0.1, 0.2)],
      bobSpeed: range(0.6, 1.1),
      bobAmount: range(0.12, 0.24),
      phase: range(0, Math.PI * 2),
    });
  }
  return placements;
}
