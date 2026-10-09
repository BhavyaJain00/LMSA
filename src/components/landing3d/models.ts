import { MeshBuilder, type Mesh } from "./geometry";
import { compose, rotationX, rotationY, rotationZ, scaling, translation, type Vec3 } from "./math";

/**
 * Learning-themed low-poly models, built from primitives at runtime (no model files to download). Each one
 * is roughly 2 units across and centred on the origin. `accent` is the site's brand accent.
 */
export interface ModelPalette {
  accent: Vec3;
}

const INK = "#1e2340";
const PAPER = "#f1f5f9";
const SILVER = "#cbd5e1";
const YELLOW = "#facc15";
const ORANGE = "#fb923c";
const SKY = "#38bdf8";
const VIOLET = "#a78bfa";
const PINK = "#f472b6";
const GREEN = "#34d399";

/** Mortarboard with a hanging tassel. */
export function graduationCap(p: ModelPalette): Mesh {
  const b = new MeshBuilder();
  b.with(translation(0, -0.15, 0), INK, (m) => m.cylinder(0.72, 0.78, 0.55, 20));
  b.with(compose(translation(0, 0.2, 0), rotationY(Math.PI / 4)), p.accent, (m) => m.box(2.1, 0.12, 2.1));
  b.with(translation(0, 0.3, 0), YELLOW, (m) => m.icosphere(0.09, 1));
  // Cord from the button to a corner, then hanging down with the tassel.
  b.with(compose(translation(0.52, 0.29, 0), rotationZ(-0.03)), YELLOW, (m) => m.box(1.04, 0.035, 0.035));
  b.with(translation(1.04, -0.08, 0), YELLOW, (m) => m.box(0.035, 0.72, 0.035));
  b.with(translation(1.04, -0.55, 0), YELLOW, (m) => m.cylinder(0.12, 0.03, 0.3, 8));
  return b.build();
}

/** Two stacked books with page blocks. */
export function books(p: ModelPalette): Mesh {
  const b = new MeshBuilder();
  const book = (y: number, turn: number, cover: Vec3 | string) => {
    b.with(compose(translation(0, y, 0), rotationY(turn)), cover, (m) => m.box(1.7, 0.32, 1.2));
    b.with(compose(translation(0.06, y, 0), rotationY(turn)), PAPER, (m) => m.box(1.62, 0.24, 1.14));
  };
  book(-0.2, 0, p.accent);
  book(0.14, 0.35, ORANGE);
  b.with(compose(translation(-0.5, 0.31, 0.2), rotationY(0.35)), YELLOW, (m) => m.box(0.08, 0.02, 0.5)); // bookmark
  return b.build();
}

/** Hexagonal pencil with eraser and sharpened tip, lying diagonally. */
export function pencil(): Mesh {
  const b = new MeshBuilder();
  const lay = rotationZ(Math.PI / 2.6);
  b.with(compose(lay, translation(0, 0, 0)), YELLOW, (m) => m.cylinder(0.17, 0.17, 2, 6));
  b.with(compose(lay, translation(0, 1.09, 0)), SILVER, (m) => m.cylinder(0.175, 0.175, 0.18, 12));
  b.with(compose(lay, translation(0, 1.28, 0)), PINK, (m) => m.cylinder(0.16, 0.16, 0.22, 12));
  b.with(compose(lay, translation(0, -1.17, 0), rotationX(Math.PI)), "#f5d0a9", (m) => m.cylinder(0.17, 0.05, 0.34, 6));
  b.with(compose(lay, translation(0, -1.38, 0), rotationX(Math.PI)), "#334155", (m) => m.cylinder(0.05, 0, 0.1, 6));
  return b.build();
}

/** Light bulb: glass, screw base and contact. */
export function lightBulb(): Mesh {
  const b = new MeshBuilder();
  b.with(translation(0, 0.25, 0), "#fde68a", (m) => m.icosphere(0.62, 2));
  b.with(translation(0, -0.35, 0), "#fde68a", (m) => m.cylinder(0.28, 0.4, 0.3, 14));
  for (let i = 0; i < 3; i++) b.with(translation(0, -0.58 - i * 0.12, 0), SILVER, (m) => m.cylinder(0.27, 0.27, 0.1, 14));
  b.with(translation(0, -0.97, 0), "#475569", (m) => m.cylinder(0.12, 0.05, 0.12, 10));
  return b.build();
}

/** A 3×3×3 cube of small blocks in alternating colours ("build it yourself"). */
export function blockCube(p: ModelPalette): Mesh {
  const b = new MeshBuilder();
  const colours: (Vec3 | string)[] = [p.accent, SKY, VIOLET, GREEN, ORANGE];
  let n = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        b.with(translation(x * 0.5, y * 0.5, z * 0.5), colours[n++ % colours.length]!, (m) => m.box(0.44, 0.44, 0.44));
      }
    }
  }
  return b.build();
}

/** A "play" triangle prism on a round disc. */
export function playButton(): Mesh {
  const b = new MeshBuilder();
  b.with(rotationX(Math.PI / 2), "#f8fafc", (m) => m.cylinder(0.95, 0.95, 0.16, 28));
  b.with(compose(translation(0.08, 0, 0.18), rotationX(Math.PI / 2), rotationY(Math.PI / 6)), ORANGE, (m) => m.cylinder(0.5, 0.5, 0.22, 3));
  return b.build();
}

/** A planet-like orb with a tilted ring. */
export function ringedOrb(p: ModelPalette): Mesh {
  const b = new MeshBuilder();
  b.with(scaling(1), VIOLET, (m) => m.icosphere(0.7, 1));
  b.with(compose(rotationZ(0.45), rotationX(0.25)), p.accent, (m) => m.torus(1.15, 0.07, 32, 6));
  return b.build();
}

/** Builds one model with the site's colours. */
export type ModelFactory = (p: ModelPalette) => Mesh;

/** Every model, in the order the scene places them down the page. */
export const MODEL_FACTORIES: ModelFactory[] = [graduationCap, books, blockCube, pencil, ringedOrb, lightBulb, playButton];
