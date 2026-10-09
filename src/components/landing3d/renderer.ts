import type { Mesh } from "./geometry";
import { buildLayout, CAMERA_Z, FOV_Y, scrollDistance, type Placement } from "./layout";
import { compose, lookAt, normalMatrix, perspective, rotationX, rotationY, rotationZ, scaling, translation, type Vec3 } from "./math";
import { MODEL_FACTORIES, type ModelPalette } from "./models";

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormal;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vec4 view = uView * world;
  vWorld = world.xyz;
  vNormal = uNormal * aNormal;
  vColor = aColor;
  vDepth = -view.z;
  gl_Position = uProjection * view;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uCamera;
uniform vec3 uKeyLight;
uniform vec3 uFillLight;
uniform vec3 uRim;
uniform float uAmbient;
uniform vec2 uFog;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec3 n = normalize(vNormal);
  // Lit from whichever side faces the camera, so every face shades correctly.
  if (!gl_FrontFacing) n = -n;
  vec3 toCamera = normalize(uCamera - vWorld);
  float key = max(dot(n, uKeyLight), 0.0);
  float fill = max(dot(n, uFillLight), 0.0) * 0.35;
  float rim = pow(1.0 - max(dot(n, toCamera), 0.0), 2.5) * 0.55;
  float spec = pow(max(dot(reflect(-uKeyLight, n), toCamera), 0.0), 28.0) * 0.35;
  vec3 color = vColor * (uAmbient + key * 0.8 + fill) + uRim * rim + vec3(spec);
  float fog = clamp((vDepth - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  float alpha = (1.0 - fog * 0.8) * uOpacity;
  gl_FragColor = vec4(color * alpha, alpha);
}`;

interface GpuMesh {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  color: WebGLBuffer;
  count: number;
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The landing page's 3D scene: floating learning-themed models down the whole page. The camera follows the
 * page scroll (slower than the text, for depth) and leans towards the pointer; models spin and bob. Draws on
 * a transparent canvas, so the page background and theme show through. With reduced motion it renders only
 * when the scroll position or size changes, without spinning or easing.
 */
export class LandingScene {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private meshes: GpuMesh[] = [];
  private placements: Placement[] = [];
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private attr = { position: -1, normal: -1, color: -1 };
  private frame = 0;
  private running = false;
  private start = performance.now();
  private width = 1;
  private height = 1;
  private pageViewports = 1;
  private progress = 0;
  private cameraY = 0;
  private pointer: [number, number] = [0, 0];
  private pointerEased: [number, number] = [0, 0];
  private dark = true;
  private accent: Vec3 = [0.41, 0.55, 0.9];

  constructor(
    private canvas: HTMLCanvasElement,
    private reducedMotion: boolean,
  ) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.program = this.createProgram();
    for (const name of ["uProjection", "uView", "uModel", "uNormal", "uCamera", "uKeyLight", "uFillLight", "uRim", "uAmbient", "uFog", "uOpacity"]) {
      this.loc[name] = gl.getUniformLocation(this.program, name);
    }
    this.attr = {
      position: gl.getAttribLocation(this.program, "aPosition"),
      normal: gl.getAttribLocation(this.program, "aNormal"),
      color: gl.getAttribLocation(this.program, "aColor"),
    };
    this.uploadMeshes();
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader error");
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link error");
    return program;
  }

  private uploadMeshes() {
    const gl = this.gl;
    for (const buffer of this.meshes.flatMap((m) => [m.position, m.normal, m.color])) gl.deleteBuffer(buffer);
    const palette: ModelPalette = { accent: this.accent };
    const upload = (data: Float32Array) => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buffer;
    };
    this.meshes = MODEL_FACTORIES.map((factory) => {
      const mesh: Mesh = factory(palette);
      return { position: upload(mesh.positions), normal: upload(mesh.normals), color: upload(mesh.colors), count: mesh.vertexCount };
    });
  }

  /** Brand accent and theme (the models use the accent; lighting is a little brighter in light mode). */
  setTheme(accent: Vec3, dark: boolean) {
    const changed = accent.some((c, i) => Math.abs(c - this.accent[i]!) > 0.01);
    this.accent = accent;
    this.dark = dark;
    if (changed) this.uploadMeshes();
    this.invalidate();
  }

  resize(width: number, height: number, pageViewports: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.pageViewports = pageViewports;
    // Cheap to rebuild, and the page length or shape may have changed.
    this.placements = buildLayout(this.width / this.height, pageViewports, this.meshes.length);
    this.invalidate();
  }

  /** Page scroll progress, 0 at the top and 1 at the bottom. */
  setScroll(progress: number) {
    this.progress = Math.min(1, Math.max(0, progress));
    this.invalidate();
  }

  /** Pointer position, -1 to 1 on both axes (ignored with reduced motion). */
  setPointer(x: number, y: number) {
    if (this.reducedMotion) return;
    this.pointer = [x, y];
  }

  play() {
    if (this.running) return;
    this.running = true;
    this.frame = requestAnimationFrame(this.tick);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  destroy() {
    this.pause();
    const gl = this.gl;
    for (const buffer of this.meshes.flatMap((m) => [m.position, m.normal, m.color])) gl.deleteBuffer(buffer);
    gl.deleteProgram(this.program);
  }

  /** Reduced motion: draw one frame now (there is no animation loop). */
  private invalidate() {
    if (this.reducedMotion) {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.draw(0));
    }
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.draw((now - this.start) / 1000);
    this.frame = requestAnimationFrame(this.tick);
  };

  private bindAttribute(location: number, buffer: WebGLBuffer) {
    if (location < 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  private draw(time: number) {
    const gl = this.gl;
    const animate = !this.reducedMotion;
    const targetY = -this.progress * scrollDistance(this.pageViewports);
    this.cameraY = animate ? this.cameraY + (targetY - this.cameraY) * 0.12 : targetY;
    this.pointerEased = animate
      ? [this.pointerEased[0] + (this.pointer[0] - this.pointerEased[0]) * 0.06, this.pointerEased[1] + (this.pointer[1] - this.pointerEased[1]) * 0.06]
      : [0, 0];
    const [px, py] = this.pointerEased;

    const eye: Vec3 = [px * 0.9, this.cameraY - py * 0.6, CAMERA_Z];
    const view = lookAt(eye, [0, this.cameraY, 0]);
    const projection = perspective(FOV_Y, this.width / this.height, 0.1, 80);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);

    gl.uniformMatrix4fv(this.loc.uProjection!, false, projection);
    gl.uniformMatrix4fv(this.loc.uView!, false, view);
    gl.uniform3fv(this.loc.uCamera!, eye);
    gl.uniform3fv(this.loc.uKeyLight!, normalizeVec([-0.45, 0.8, 0.6]));
    gl.uniform3fv(this.loc.uFillLight!, normalizeVec([0.8, -0.3, 0.45]));
    gl.uniform3fv(this.loc.uRim!, this.accent.map((c) => c * (this.dark ? 0.75 : 0.45)) as Vec3);
    gl.uniform1f(this.loc.uAmbient!, this.dark ? 0.4 : 0.55);
    gl.uniform2f(this.loc.uFog!, CAMERA_Z + 1, CAMERA_Z + 14);
    gl.uniform1f(this.loc.uOpacity!, this.width < 640 ? 0.8 : 1);

    for (const p of this.placements) {
      const mesh = this.meshes[p.model];
      if (!mesh) continue;
      // Skip models far outside the visible band (cheap culling).
      if (Math.abs(p.position[1] - this.cameraY) > 12) continue;
      const t = animate ? time : 0;
      const bob = Math.sin(t * p.bobSpeed + p.phase) * p.bobAmount;
      // Turn around the model's own Y axis first, then tip it towards the camera (world X), so the tilt
      // always shows the model's top whatever its turn.
      const model = compose(
        translation(p.position[0], p.position[1] + bob, p.position[2]),
        rotationX(p.rotation[0] + Math.sin(t * p.spin[0] * 2 + p.phase) * 0.18 - py * 0.25),
        rotationZ(p.rotation[2] + Math.sin(t * p.spin[2] * 2 + p.phase) * 0.12),
        rotationY(p.rotation[1] + t * p.spin[1] + px * 0.35),
        scaling(p.scale),
      );
      gl.uniformMatrix4fv(this.loc.uModel!, false, model);
      gl.uniformMatrix3fv(this.loc.uNormal!, false, normalMatrix(model));
      this.bindAttribute(this.attr.position, mesh.position);
      this.bindAttribute(this.attr.normal, mesh.normal);
      this.bindAttribute(this.attr.color, mesh.color);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
  }
}
