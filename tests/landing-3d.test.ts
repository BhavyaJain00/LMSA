import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compose, identity, lookAt, multiply, perspective, rotationY, transformPoint, translation, type Vec3 } from "@/components/landing3d/math";
import { hexColor, MeshBuilder } from "@/components/landing3d/geometry";
import { MODEL_FACTORIES } from "@/components/landing3d/models";
import { buildLayout, scrollDistance, seededRandom, VIEW_HEIGHT } from "@/components/landing3d/layout";

const close = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

describe("landing 3D maths", () => {
  it("multiplies by the identity without change and composes in written order", () => {
    const t = translation(1, 2, 3);
    assert.deepEqual([...multiply(identity(), t)], [...t]);
    // Rotate a quarter turn, then move: (1,0,0) → (0,0,-1) → (5,0,-1).
    const p = transformPoint(compose(translation(5, 0, 0), rotationY(Math.PI / 2)), [1, 0, 0]);
    assert.ok(close(p[0], 5) && close(p[1], 0) && close(p[2], -1), `got ${p}`);
  });

  it("projects a point on the view axis to the centre of the screen", () => {
    const view = lookAt([0, 0, 10], [0, 0, 0]);
    const proj = perspective(Math.PI / 4, 1, 0.1, 100);
    const m = multiply(proj, view);
    const x = m[12]!;
    const y = m[13]!;
    const w = m[15]!;
    assert.ok(close(x / w, 0) && close(y / w, 0));
  });
});

describe("landing 3D geometry", () => {
  it("builds a box from 12 triangles with unit normals", () => {
    const mesh = new MeshBuilder().box(1, 2, 3).build();
    assert.equal(mesh.vertexCount, 36);
    for (let i = 0; i < mesh.normals.length; i += 3) {
      assert.ok(close(Math.hypot(mesh.normals[i]!, mesh.normals[i + 1]!, mesh.normals[i + 2]!), 1));
    }
  });

  it("applies the transform and colour of `with`, then restores them", () => {
    const b = new MeshBuilder();
    b.with(translation(10, 0, 0), "#ff0000", (m) => m.triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]));
    b.triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const mesh = b.build();
    assert.equal(mesh.positions[0], 10);
    assert.deepEqual([...mesh.colors.slice(0, 3)], [1, 0, 0]);
    assert.equal(mesh.positions[9], 0, "the second triangle is not moved");
    assert.deepEqual([...mesh.colors.slice(9, 12)], [1, 1, 1]);
  });

  it("parses short and long hex colours", () => {
    assert.deepEqual(hexColor("#fff"), [1, 1, 1]);
    assert.deepEqual(hexColor("#000000"), [0, 0, 0]);
  });
});

describe("landing 3D models", () => {
  it("builds every model with finite, reasonably sized geometry", () => {
    const accent: Vec3 = [0.4, 0.5, 0.9];
    for (const factory of MODEL_FACTORIES) {
      const mesh = factory({ accent });
      assert.ok(mesh.vertexCount > 0 && mesh.vertexCount % 3 === 0, factory.name);
      assert.ok(mesh.vertexCount < 20_000, `${factory.name} stays light`);
      for (const value of mesh.positions) {
        assert.ok(Number.isFinite(value), factory.name);
        assert.ok(Math.abs(value) < 2.5, `${factory.name} fits in about 2 units`);
      }
    }
  });
});

describe("landing 3D layout", () => {
  it("is deterministic", () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
    assert.deepEqual(buildLayout(1.6, 5, 7), buildLayout(1.6, 5, 7));
  });

  it("alternates sides, keeps the centre column clear on desktop and covers the whole page", () => {
    const aspect = 1.6;
    const placements = buildLayout(aspect, 5, 7);
    const halfWidth = (VIEW_HEIGHT * aspect) / 2;
    placements.forEach((p, i) => {
      assert.equal(Math.sign(p.position[0]), i % 2 === 0 ? 1 : -1);
      assert.ok(Math.abs(p.position[0]) > halfWidth * 0.5, "outside the text column");
      assert.ok(p.model >= 0 && p.model < 7);
    });
    const lowest = Math.min(...placements.map((p) => p.position[1]));
    assert.ok(lowest < -scrollDistance(5) + VIEW_HEIGHT / 2, "models reach the bottom of the page");
  });

  it("makes phone models smaller and pushes them to the edges", () => {
    const phone = buildLayout(0.46, 8, 7);
    const desktop = buildLayout(1.6, 8, 7);
    assert.ok(phone[2]!.scale < desktop[2]!.scale);
    const halfWidth = (VIEW_HEIGHT * 0.46) / 2;
    for (const p of phone) assert.ok(Math.abs(p.position[0]) >= halfWidth * 0.95 - 1e-9);
  });

  it("does not move the camera on a page that fits the screen", () => {
    assert.equal(scrollDistance(1), 0);
    assert.equal(scrollDistance(0.5), 0);
    assert.ok(scrollDistance(3) > 0);
  });
});
