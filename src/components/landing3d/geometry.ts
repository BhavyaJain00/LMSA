import { compose, cross, identity, normalize, sub, transformPoint, type Mat4, type Vec3 } from "./math";

/** Flat-shaded triangle soup: three floats per vertex for position, normal and colour. */
export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  vertexCount: number;
}

/** "#rrggbb" → [r, g, b] in 0–1. */
export function hexColor(hex: string): Vec3 {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Builds a model from primitives. Every primitive is drawn with the current colour and transform, and each
 * triangle gets its own face normal (flat shading: the crisp low-poly look). Normals are computed after the
 * transform, so any rotation, translation or scale is lit correctly.
 */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private transform: Mat4 = identity();
  private color: Vec3 = [1, 1, 1];

  /** Run `draw` with `matrix` applied on top of the current transform and `color` as the colour. */
  with(matrix: Mat4, color: Vec3 | string, draw: (b: MeshBuilder) => void): this {
    const prevTransform = this.transform;
    const prevColor = this.color;
    this.transform = compose(prevTransform, matrix);
    this.color = typeof color === "string" ? hexColor(color) : color;
    draw(this);
    this.transform = prevTransform;
    this.color = prevColor;
    return this;
  }

  triangle(a: Vec3, b: Vec3, c: Vec3): this {
    const pa = transformPoint(this.transform, a);
    const pb = transformPoint(this.transform, b);
    const pc = transformPoint(this.transform, c);
    const n = normalize(cross(sub(pb, pa), sub(pc, pa)));
    for (const p of [pa, pb, pc]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(this.color[0], this.color[1], this.color[2]);
    }
    return this;
  }

  /** Quad a-b-c-d, counter-clockwise when seen from outside. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): this {
    return this.triangle(a, b, c).triangle(a, c, d);
  }

  /** Axis-aligned box centred on the origin. */
  box(w: number, h: number, d: number): this {
    const x = w / 2;
    const y = h / 2;
    const z = d / 2;
    this.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]); // front
    this.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]); // back
    this.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]); // top
    this.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]); // bottom
    this.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]); // right
    this.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]); // left
    return this;
  }

  /**
   * Cylinder along Y centred on the origin; `rTop` 0 makes a cone, 3 or 6 segments make a prism. Caps are
   * drawn unless the matching radius is 0.
   */
  cylinder(rBottom: number, rTop: number, h: number, segments = 16): this {
    const y0 = -h / 2;
    const y1 = h / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const b0: Vec3 = [Math.cos(a0) * rBottom, y0, Math.sin(a0) * rBottom];
      const b1: Vec3 = [Math.cos(a1) * rBottom, y0, Math.sin(a1) * rBottom];
      const t0: Vec3 = [Math.cos(a0) * rTop, y1, Math.sin(a0) * rTop];
      const t1: Vec3 = [Math.cos(a1) * rTop, y1, Math.sin(a1) * rTop];
      if (rTop > 0) this.quad(b1, b0, t0, t1);
      else this.triangle(b1, b0, t0);
      if (rTop > 0) this.triangle([0, y1, 0], t1, t0);
      if (rBottom > 0) this.triangle([0, y0, 0], b0, b1);
    }
    return this;
  }

  /** Low-poly sphere: an icosahedron subdivided `detail` times. */
  icosphere(r: number, detail = 1): this {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts: Vec3[] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map((v) => normalize(v as Vec3));
    let faces: [number, number, number][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let level = 0; level < detail; level++) {
      const next: [number, number, number][] = [];
      const cache = new Map<string, number>();
      const mid = (a: number, b: number) => {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        const va = verts[a]!;
        const vb = verts[b]!;
        verts = [...verts, normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])];
        cache.set(key, verts.length - 1);
        return verts.length - 1;
      };
      for (const [a, b, c] of faces) {
        const ab = mid(a, b);
        const bc = mid(b, c);
        const ca = mid(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    for (const [a, b, c] of faces) {
      const s = (v: Vec3): Vec3 => [v[0] * r, v[1] * r, v[2] * r];
      this.triangle(s(verts[a]!), s(verts[b]!), s(verts[c]!));
    }
    return this;
  }

  /** Torus in the XZ plane: ring radius `R`, tube radius `r`. */
  torus(R: number, r: number, segments = 24, sides = 8): this {
    const point = (u: number, v: number): Vec3 => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      return [(R + r * cv) * cu, r * sv, (R + r * cv) * su];
    };
    for (let i = 0; i < segments; i++) {
      const u0 = (i / segments) * Math.PI * 2;
      const u1 = ((i + 1) / segments) * Math.PI * 2;
      for (let j = 0; j < sides; j++) {
        const v0 = (j / sides) * Math.PI * 2;
        const v1 = ((j + 1) / sides) * Math.PI * 2;
        this.quad(point(u0, v0), point(u0, v1), point(u1, v1), point(u1, v0));
      }
    }
    return this;
  }

  build(): Mesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      vertexCount: this.positions.length / 3,
    };
  }
}
