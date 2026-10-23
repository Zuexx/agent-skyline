// Renderer for a painted town pack (specs/10-town-pack.md, renderer "painted"): the painted relief
// is rebuilt on the GPU from the pack's depth map, window light per building follows live agent
// state, sprites are lit by the painting's lights. Chosen by measurement (specs/08, 8A); the
// prototype it came from is proto/town-render/web/town.js. Plain three.js, no React here.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { layoutToPixel } from "./townLayout.js";
import { findPath, invert3, makeGrid } from "./townPaths.js";


/**
 * Draw the town pack `pack` (its parsed theme.json; files under the URL `base`, ending in "/") into
 * `container`. `variant`: "night" | "day"; `view`: "pano" | "close" | "priest". `initialState` /
 * setState(): { agents: [{ key, character, building, action }], recent: [building ids] } (see
 * townState.js). opts: { hud: element for an fps line, opacity, dof, edges, size: [w, h], bench: s,
 * onBench(result) }. Resolves to { setState, setSites, fps, dispose }. setSites([{ id, lot: [x, z] }]):
 * folders the painting does not have, drawn as construction sites on the pack's open lots
 * (townLayout.js); agents and effects then treat them like buildings.
 */
export async function createPaintedTown({ container, pack, base, variant = "night", view = "pano", initialState = null, initialSites = [], opts = {} }) {
  const variantName = variant;
  const benchS = Number(opts.bench ?? 0);
  const fixedSize = opts.size ?? null;
  const night = variantName === "night";
  const big = view === "pano"; // agents scaled up so they read in the panorama (user decision, spec 09)

  const WIN = { agent: 4.0, recent: 0.55, rest: 0.0 }; // the user's choice (option 三, "mix")
  const SPILL_MIN = 2.0;
  const CHAR_H = 2.193; // metres; the PoC's hero height
  const BIG = 2.25;
  // Walking: the clips step about 0.7 body heights a second at their own fps; played 1.6x for a brisk
  // walk, the ground speed matches so feet do not slide.
  const WALK_RATE = 1.6;
  const CLIPS_FACING_LEFT = new Set(["mage_walk"]); // the others face right (art pipeline, 2026-10-23)
  const WALK_SPEED_PER_H = 0.7 * WALK_RATE; // body heights per second

  const hud = opts.hud ?? null;
  const showHud = !!hud;
  const V = pack.variants[variantName];
  const t0 = performance.now();

  // ---------------------------------------------------------------- renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.info.autoReset = false;
  // The screen's real pixel density (capped), so a scaled display (150 %) is not stretched soft.
  const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PIXEL_RATIO);
  const size = () => (fixedSize ? { w: fixedSize[0], h: fixedSize[1] } : { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) });
  renderer.setSize(size().w, size().h);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);
  // ?opacity=0.85: the page fades itself; over a transparent window (Tauri, Electron) the desktop shows through
  if (opts.opacity) renderer.domElement.style.opacity = String(opts.opacity);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(night ? "rgb(10,16,34)" : "rgb(150,190,230)");
  const camera = new THREE.PerspectiveCamera(30, size().w / size().h, 0.5, 2000);

  const B = new THREE.Matrix4().makeBasis(...V.basis.map((c) => new THREE.Vector3(...c))); // painting camera -> world
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

  // ---------------------------------------------------------------- textures
  const loader = new THREE.TextureLoader();
  async function tex(file, { srgb = true, nearest = false, flipY = false } = {}) {
    const t = await loader.loadAsync(base + file);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = flipY;
    if (nearest) {
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
    } else {
      t.anisotropy = 4;
    }
    t.needsUpdate = true;
    return t;
  }
  const bgFiles = V.background;
  const [albedoTex, depthTex, readTex, lightTex, haloTex, idTex] = await Promise.all([
    tex(bgFiles.albedo),
    tex(V.depth, { srgb: false, nearest: true }),
    tex(bgFiles.reading, { srgb: false }),
    bgFiles.light ? tex(bgFiles.light) : null,
    bgFiles.halo ? tex(bgFiles.halo, { srgb: false }) : null,
    bgFiles.ids ? tex(bgFiles.ids, { srgb: false, nearest: true }) : null,
  ]);
  const windowsOn = night && !!idTex;

  // ---------------------------------------------------------------- relief from the depth map
  const [DW, DH] = V.depthSize;
  const RELIEF_VS = /* glsl */ `
    uniform sampler2D depthTex;
    uniform vec2 depthRange, principal, dsize;
    uniform float focal, edgeRtol;
    varying vec2 vUv;
    varying float vEdge;
    float dAt(ivec2 p) {
      vec4 c = texelFetch(depthTex, clamp(p, ivec2(0), ivec2(dsize) - 1), 0);
      float code = floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5);
      return code < 0.5 ? -1.0 : depthRange.x + (code - 1.0) / 65534.0 * (depthRange.y - depthRange.x);
    }
    void main() {
      ivec2 p = ivec2(position.xy);
      float z = dAt(p);
      // MoGe's depth_map_edge: drop pixels where the 3x3 neighbourhood spans more than rtol of the depth
      float lo = z, hi = z;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        float n = dAt(p + ivec2(i, j));
        if (n < 0.0) n = 1e3;
        lo = min(lo, n); hi = max(hi, n);
      }
      vEdge = (z < 0.0 || (hi - lo) / max(lo, 1e-3) > edgeRtol) ? 1.0 : 0.0;
      if (z < 0.0) z = 100.0;
      vec2 px = vec2(p) + 0.5;
      vec3 cam = vec3((px.x - principal.x) / focal * z, -(px.y - principal.y) / focal * z, -z);
      vUv = px / dsize;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(cam, 1.0);
    }`;
  const RELIEF_FS = /* glsl */ `
    uniform sampler2D albedo, lightTex, haloTex, idTex, readTex;
    uniform float win[32];
    uniform bool windowsOn;
    uniform float readEnergy, time;
    varying vec2 vUv;
    varying float vEdge;
    float level(float code) {
      int i = int(floor(code * 255.0 / 10.0 + 0.5)) - 1;
      return (i >= 0 && i < 32) ? win[i] : 0.0;
    }
    void main() {
      if (vEdge > 0.001) discard;
      vec3 c = texture2D(albedo, vUv).rgb;
      if (windowsOn) {
        vec4 id = texture2D(idTex, vUv);
        c += texture2D(lightTex, vUv).rgb * level(id.r);
        vec4 h = texture2D(haloTex, vUv);
        c += h.rgb * max(level(id.g) - 1.0, 0.0) * 0.5;
        float wash = h.a * clamp((level(id.b) - 1.0) / 3.0, 0.0, 1.0);
        c += c * vec3(1.6, 1.0, 0.45) * wash * 0.9 + vec3(0.05, 0.025, 0.0) * wash;
      }
      // reading: the library windows glow blue (window_glow.gdshader)
      c += vec3(0.073, 0.38, 1.0) * texture2D(readTex, vUv).r * readEnergy * (0.75 + 0.25 * sin(time * 3.0));
      gl_FragColor = vec4(c, 1.0);
    }`;

  function reliefGeometry() {
    const pos = new Float32Array(DW * DH * 3);
    for (let y = 0, i = 0; y < DH; y++) for (let x = 0; x < DW; x++, i += 3) (pos[i] = x), (pos[i + 1] = y);
    const idx = new Uint32Array((DW - 1) * (DH - 1) * 6);
    let k = 0;
    for (let y = 0; y < DH - 1; y++) {
      for (let x = 0; x < DW - 1; x++) {
        const a = y * DW + x;
        idx[k++] = a; idx[k++] = a + DW; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = a + DW; idx[k++] = a + DW + 1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
  const winLevels = new Array(32).fill(0);
  const reliefMat = new THREE.ShaderMaterial({
    vertexShader: RELIEF_VS,
    fragmentShader: RELIEF_FS,
    side: THREE.DoubleSide,
    uniforms: {
      depthTex: { value: depthTex },
      depthRange: { value: new THREE.Vector2(V.depthNear, V.depthFar) },
      principal: { value: new THREE.Vector2(...V.principal) },
      dsize: { value: new THREE.Vector2(DW, DH) },
      focal: { value: V.focalPx },
      // MoGe's mesh drops triangles across depth jumps (rtol 0.04). The camera here only turns and never
      // moves, so those triangles lie along the view rays and cover exactly the painted pixels; keeping
      // them leaves no gaps for the depth of field to smear. ?edges=1 drops them like the PoC mesh.
      edgeRtol: { value: opts.edges ? 0.04 : 1e9 },
      albedo: { value: albedoTex },
      lightTex: { value: lightTex },
      haloTex: { value: haloTex },
      idTex: { value: idTex },
      readTex: { value: readTex },
      win: { value: winLevels },
      windowsOn: { value: windowsOn },
      readEnergy: { value: 0 },
      time: { value: 0 },
    },
  });
  const stage = new THREE.Group();
  stage.matrixAutoUpdate = false;
  stage.matrix.copy(B);
  scene.add(stage);
  const relief = new THREE.Mesh(reliefGeometry(), reliefMat);
  relief.frustumCulled = false;
  stage.add(relief);

  // the painting far away on the same projection fills the sky MoGe masked out
  {
    const far = 900;
    const [fx, fy] = V.fov.map((d) => THREE.MathUtils.degToRad(d));
    const g = new THREE.PlaneGeometry(2 * far * Math.tan(fx / 2), 2 * far * Math.tan(fy / 2));
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); // pack textures are top-row-first
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: albedoTex }));
    sky.position.set(0, 0, -far);
    stage.add(sky);
  }
  const buildings = new Map(V.buildings.map((b) => [b.id, { ...b, pos: v3(b.world) }]));

  // The depth map on the CPU too: a pixel of the painting -> the 3D point it shows (for placing
  // characters and ground effects on the painted ground).
  const depthPx = await (async () => {
    const bmp = await createImageBitmap(await (await fetch(base + V.depth)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  })();
  function groundAt(px, py) {
    const x = Math.round(THREE.MathUtils.clamp(px, 0, DW - 1));
    const y = Math.round(THREE.MathUtils.clamp(py, 0, DH - 1));
    const i = (y * DW + x) * 4;
    const code = depthPx[i] * 256 + depthPx[i + 1];
    if (!code) return null;
    const z = V.depthNear + ((code - 1) / 65534) * (V.depthFar - V.depthNear);
    const [cx, cy] = V.principal;
    return new THREE.Vector3(((x + 0.5 - cx) / V.focalPx) * z, (-(y + 0.5 - cy) / V.focalPx) * z, -z).applyMatrix4(B);
  }

  // The painting pixel a world point is seen at (the inverse of groundAt's projection).
  const Binv = B.clone().invert();
  const camV = new THREE.Vector3();
  function pixelOf(p) {
    camV.copy(p).applyMatrix4(Binv);
    const z = -camV.z;
    return [(camV.x * V.focalPx) / z + V.principal[0] - 0.5, (-camV.y * V.focalPx) / z + V.principal[1] - 0.5];
  }
  // Layout metres <-> the painted ground, through the pack's homography (null without one).
  const pixelToLayout = V.layoutToPixel ? invert3(V.layoutToPixel) : null;
  const layoutOf = (p) => (pixelToLayout ? layoutToPixel(pixelToLayout, pixelOf(p)) : null);
  const groundOfLayout = (l) => groundAt(...layoutToPixel(V.layoutToPixel, l));

  // ---------------------------------------------------------------- lights (light from the upper left, spec 0.8)
  // three's lights are PI dimmer than Godot's for the same number (diffuse = albedo / PI * irradiance)
  scene.add(new THREE.AmbientLight(new THREE.Color(night ? "rgb(70,80,120)" : "rgb(215,205,170)"), (night ? 0.45 : 0.75) * Math.PI));
  {
    const sun = new THREE.DirectionalLight(new THREE.Color(night ? "rgb(150,175,255)" : "rgb(255,236,205)"), (night ? 0.3 : 1.1) * Math.PI);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(-45), THREE.MathUtils.degToRad(-40), 0, "YXZ"));
    sun.position.copy(dir).multiplyScalar(-100);
    scene.add(sun);
  }
  // Godot omni light (energy, range, attenuation) -> three point light: both fall off as d^-decay inside the
  // range; three's diffuse is PI dimmer
  function omni(color, energy, range, pos, decay = 1.3) {
    const l = new THREE.PointLight(color, energy * Math.PI, range, decay);
    l.position.copy(pos);
    scene.add(l);
    return l;
  }
  if (night) {
    for (const l of V.lights) {
      omni(new THREE.Color("rgb(255,170,90)"), THREE.MathUtils.clamp(l.size / 60, 0.6, 3), THREE.MathUtils.clamp(l.depth * 0.09, 2, 9), v3(l.pos));
    }
  }

  // ---------------------------------------------------------------- magic shaders (magic.gdshaderinc)
  const MAGIC = /* glsl */ `
    float mg_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float mg_rune(vec2 p, float id, float w) {
      if (p.x < 0.12 || p.x > 0.88 || p.y < 0.08 || p.y > 0.92) return 0.0;
      float h1 = mg_hash(vec2(id, 1.3)), h2 = mg_hash(vec2(id, 2.7)), h3 = mg_hash(vec2(id, 3.1)), h4 = mg_hash(vec2(id, 4.9));
      float s = smoothstep(w, 0.0, abs(p.x - 0.5)) * step(0.15, p.y) * step(p.y, 0.85);
      float o = s;
      if (h1 > 0.3) o = max(o, smoothstep(w, 0.0, abs(p.y - 0.22)) * step(abs(p.x - 0.5 - (h1 - 0.65) * 0.6), 0.26));
      if (h2 > 0.45) o = max(o, smoothstep(w, 0.0, abs(p.y - 0.62)) * step(abs(p.x - 0.5 + (h2 - 0.72) * 0.6), 0.22));
      if (h3 > 0.5) o = max(o, smoothstep(w, 0.0, abs((p.y - 0.5) - (p.x - 0.5) * (h3 > 0.75 ? 1.3 : -1.3))) * step(abs(p.x - 0.5), 0.3));
      if (h4 > 0.6) o = max(o, smoothstep(0.09, 0.05, length(p - vec2(h4 > 0.8 ? 0.72 : 0.28, 0.85))));
      return o;
    }
    float mg_tri(vec2 p, float R, float a) {
      float d = 1e9;
      for (int k = 0; k < 3; k++) { float t = a + float(k) * 2.0944; d = min(d, abs(dot(p, vec2(cos(t), sin(t))) + R * 0.5)); }
      return d;
    }
    float mg_circle(vec2 p, float t, float w) {
      float r = length(p);
      if (r > 1.0) return 0.0;
      float ang = atan(p.y, p.x);
      float o = smoothstep(w * 1.6, 0.0, abs(r - 0.97));
      o = max(o, smoothstep(w, 0.0, abs(r - 0.86)));
      if (r > 0.87 && r < 0.96) { float u = (ang / 6.2832 + 0.5) * 40.0 + t * 0.35; o = max(o, mg_rune(vec2(fract(u), (r - 0.87) / 0.09), floor(u), 0.09)); }
      float hex = min(mg_tri(p, 0.84, t * 0.08), mg_tri(p, 0.84, t * 0.08 + 1.0472));
      o = max(o, smoothstep(w, 0.0, hex) * step(r, 0.86));
      o = max(o, smoothstep(w, 0.0, abs(r - 0.42)));
      o = max(o, smoothstep(w, 0.0, abs(r - 0.32)));
      if (r > 0.33 && r < 0.41) { float u = (ang / 6.2832 + 0.5) * 16.0 - t * 0.5; o = max(o, mg_rune(vec2(fract(u), (r - 0.33) / 0.08), floor(u) + 100.0, 0.1)); }
      o = max(o, smoothstep(w * 2.0, 0.0, abs(r - 0.08)));
      return o;
    }`;
  const time = { value: 0 };
  const linear = (css) => new THREE.Color(css); // CSS colours are sRGB; THREE.Color stores linear
  function premul(fs, uniforms, vs) {
    return new THREE.ShaderMaterial({
      uniforms: { time, ...uniforms },
      vertexShader: vs ?? `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: fs,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
  }
  const runesMat = (strength) =>
    premul(
      MAGIC +
        `uniform float time, strength, day, width, spin; uniform vec3 tint, hot; varying vec2 vUv;
         void main() {
           vec2 p = (vUv - 0.5) * 2.0;
           float o = mg_circle(p, time * spin, width * mix(1.0, 1.5, day));
           float halo = smoothstep(1.0, 0.0, length(p)) * 0.10;
           float i = o * (0.85 + 0.15 * sin(time * 2.0)) + halo;
           gl_FragColor = vec4(mix(tint, hot, o * 0.5) * i * strength, clamp(i * mix(0.25, 0.7, day), 0.0, 0.9));
         }`,
      { strength: { value: strength }, day: { value: night ? 0 : 1 }, width: { value: 0.012 }, spin: { value: 1 }, tint: { value: linear("rgb(255,46,61)") }, hot: { value: linear("rgb(255,179,140)") } },
    );
  const curtainMat = (strength, height) =>
    premul(
      MAGIC +
        `uniform float time, strength, day; uniform vec3 tint, hot; varying vec2 vUv; varying float hy;
         void main() {
           float h = hy;
           float fade = pow(max(1.0 - h, 0.0), 2.2);
           float u = vUv.x * 90.0;
           float col_id = floor(u);
           float lane = smoothstep(0.5, 0.0, abs(fract(u) - 0.5)) * step(0.55, mg_hash(vec2(col_id, 7.0)));
           float rise = fract(h * 1.5 - time * (0.25 + 0.3 * mg_hash(vec2(col_id, 3.0))) + mg_hash(vec2(col_id, 1.0)));
           float streak = lane * smoothstep(0.0, 0.35, rise) * smoothstep(1.0, 0.6, rise);
           float back = gl_FrontFacing ? 1.0 : 0.4;
           float i = (mix(0.06, 0.12, day) + streak * mix(0.7, 1.1, day)) * fade * back;
           i += smoothstep(0.06, 0.0, h) * 0.6 * back;
           gl_FragColor = vec4(mix(tint, hot, streak * 0.5) * i * strength, clamp(i * mix(0.15, 0.65, day), 0.0, 0.85));
         }`,
      { strength: { value: strength }, day: { value: night ? 0 : 1 }, height: { value: height }, tint: { value: linear("rgb(255,46,61)") }, hot: { value: linear("rgb(255,179,140)") } },
      `uniform float height; varying vec2 vUv; varying float hy;
       void main() { vUv = uv; hy = clamp(position.y / height + 0.5, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    );
  function glowMat(color, energy, ring, alpha = 1) {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: color }, energy: { value: energy }, ring: { value: ring ? 1 : 0 }, alpha: { value: alpha } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float energy, ring, alpha; varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = ring > 0.5 ? smoothstep(1.0, 0.82, d) * (0.25 + 0.75 * smoothstep(0.55, 0.85, d)) : smoothstep(1.0, 0.2, d);
          gl_FragColor = vec4(color * energy, a * alpha);
        }`,
      transparent: true,
      depthWrite: false,
    });
  }
  const spillMat = (energy) =>
    new THREE.ShaderMaterial({
      uniforms: { color: { value: linear("rgb(255,158,71)") }, energy: { value: energy } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float energy; varying vec2 vUv;
        void main() { float d = length((vUv - 0.5) * 2.0); gl_FragColor = vec4(color * energy * pow(max(1.0 - d, 0.0), 2.2), 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  // MoGe flattens the painted ground, so flat discs are stretched in depth to read as round on screen
  function groundPlane(w, d, mat, pos) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.03, 0));
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- sprites
  const sheetCache = new Map();
  async function sheet(name) {
    if (!sheetCache.has(name)) {
      const meta = pack.sprites[name];
      sheetCache.set(name, Promise.all([tex(meta.albedo, { flipY: true }), tex(meta.normal, { srgb: false, flipY: true })]).then(([map, normal]) => ({ meta, map, normal })));
    }
    return sheetCache.get(name);
  }
  await Promise.all(Object.keys(pack.sprites).map(sheet));

  /** A hand-painted sprite standing on its feet, turned toward the camera about Y, lit by the scene. */
  class Sprite {
    constructor(h) {
      this.h = h;
      this.mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
      this.mesh.renderOrder = 2;
      this.t = Math.random() * 2;
      this.name = null;
      this.flip = false;
      scene.add(this.mesh);
    }
    async set(name, flip = false) {
      if (this.name === name && this.flip === flip) return;
      this.name = name;
      this.flip = flip;
      const s = await sheet(name);
      if (this.name !== name) return;
      const { meta } = s;
      // own texture objects: the frame is the texture's offset/repeat
      this.map = s.map.clone();
      this.normal = s.normal.clone();
      this.mat.map = this.map;
      this.mat.normalMap = this.normal;
      this.mat.normalScale.set(0.7, 0.7);
      this.mat.needsUpdate = true;
      this.meta = meta;
      const H = (this.h * meta.cell[1]) / meta.char_h;
      const W = (H * meta.cell[0]) / meta.cell[1];
      const [px, py] = meta.pivot;
      const g = new THREE.PlaneGeometry(W, H).translate((flip ? px - 0.5 : 0.5 - px) * W, (0.5 - py) * H, 0);
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
      this.frame(0);
    }
    frame(f) {
      const { cols, rows } = this.meta;
      const c = f % cols;
      const r = Math.floor(f / cols);
      for (const t of [this.map, this.normal]) {
        t.repeat.set((this.flip ? -1 : 1) / cols, 1 / rows);
        t.offset.set((this.flip ? c + 1 : c) / cols, 1 - (r + 1) / rows);
      }
    }
    update(dt) {
      if (!this.meta) return;
      this.t += dt * (this.rate ?? 1);
      if (this.meta.frames > 1) {
        // A walk clip starts and ends standing: loop only its stepping frames (loop_range from the
        // art pipeline, else the middle 80 %).
        const walk = this.name?.endsWith("_walk");
        const [a, b] = this.meta.loop_range ?? (walk ? [Math.round(this.meta.frames * 0.1), Math.round(this.meta.frames * 0.9)] : [0, this.meta.frames]);
        this.frame(a + (Math.floor(this.t * this.meta.fps) % (b - a)));
      }
      const p = this.mesh.position;
      this.mesh.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    }
    remove() {
      scene.remove(this.mesh);
    }
  }

  // ---------------------------------------------------------------- sparks (hammer) and motes (reading)
  class Sparks {
    constructor(color, h, amount = 40, up = 1) {
      this.n = amount;
      this.h = h;
      this.up = up;
      this.p = new Float32Array(amount * 3);
      this.v = new Float32Array(amount * 3);
      this.age = new Float32Array(amount).map(() => Math.random() * 0.7);
      this.col = new Float32Array(amount * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(this.p, 3));
      g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
      this.base = color.clone().multiplyScalar(6);
      this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: h * 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.points.frustumCulled = false;
      this.origin = new THREE.Vector3();
      scene.add(this.points);
    }
    update(dt) {
      const { n, p, v, age, col, h, up } = this;
      for (let i = 0; i < n; i++) {
        age[i] += dt;
        if (age[i] > 0.7) {
          age[i] = 0;
          const a = Math.random() * Math.PI * 2;
          const s = THREE.MathUtils.degToRad(55) * Math.random();
          const sp = h * (1.2 + Math.random() * 1.4) * up;
          v[i * 3] = Math.sin(s) * Math.cos(a) * sp;
          v[i * 3 + 1] = Math.cos(s) * sp;
          v[i * 3 + 2] = Math.sin(s) * Math.sin(a) * sp;
          p[i * 3] = this.origin.x;
          p[i * 3 + 1] = this.origin.y;
          p[i * 3 + 2] = this.origin.z;
        }
        v[i * 3 + 1] -= h * 6 * up * dt;
        for (let k = 0; k < 3; k++) p[i * 3 + k] += v[i * 3 + k] * dt;
        const f = 1 - age[i] / 0.7;
        col[i * 3] = this.base.r * f;
        col[i * 3 + 1] = this.base.g * f;
        col[i * 3 + 2] = this.base.b * f;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    remove() {
      scene.remove(this.points);
    }
  }

  // ---------------------------------------------------------------- agents and building states from live state
  const COLORS = { hero: "#ff9a3c", mage: "#b56cff", priest: "#3fe0c8" };
  const CLIP = {
    hero: { write: "hero_hammer", walk: "hero_walk" },
    mage: { read: "mage_read", walk: "mage_walk" },
    priest: { blocked: "priest_bump", walk: "priest_walk" },
  };
  // Where each character stands, as an offset in painting pixels from the building's front-bottom
  // point (the PoC's sample spots); a blocked agent stands outside the barrier.
  const SLOT = { hero: [17, 50], mage: [75, -20], priest: [-40, 45] };
  const BLOCKED_SLOT = [-160, 29];

  function doorSpot(buildingId, character, action) {
    const b = buildings.get(buildingId) ?? buildings.get("(root)");
    const [dx, dy] = action === "blocked" ? BLOCKED_SLOT : SLOT[character] ?? [0, 50];
    return groundAt(b.pixel[0] + dx, b.pixel[1] + dy) ?? b.pos.clone();
  }

  class Agent {
    constructor(a) {
      this.key = a.key;
      this.character = a.character;
      this.h = CHAR_H * (big ? BIG : 1);
      this.color = new THREE.Color(COLORS[a.character] ?? "#ffffff");
      this.pos = doorSpot(a.building, a.character, a.action);
      this.target = this.pos.clone();
      this.path = [];
      this.sprite = new Sprite(this.h);
      this.shadow = groundPlane(this.h * 0.64, this.h * 0.64 * 2.5, glowMat(new THREE.Color(0, 0, 0), 1, false, 0.45), this.pos);
      this.ring = groundPlane(this.h * 0.72, this.h * 0.72 * 2.5, glowMat(this.color, night ? 2.5 : 1.6, true), this.pos);
      this.light = omni(this.color, night ? 0.8 : 0.3, this.h * 1.2, this.pos, 1);
      this.alert = null;
      this.sparks = null;
      this.facingLeft = false;
      this.state = a;
    }
    sync(a) {
      this.state = a;
      const target = doorSpot(a.building, a.character, a.action);
      if (target.distanceTo(this.target) < 0.05) return;
      this.target = target;
      this.path = routeBetween(this.pos, target);
    }
    update(dt) {
      // Walk the route: a fixed ground speed, feet kept on the painted ground.
      let left = WALK_SPEED_PER_H * this.h * dt;
      const before = this.pos.clone();
      while (left > 0 && this.path.length) {
        const d = this.path[0].clone().sub(this.pos);
        const len = d.length();
        if (len <= left) {
          this.pos.copy(this.path.shift());
          left -= len;
        } else {
          this.pos.add(d.setLength(left));
          left = 0;
        }
      }
      const walking = this.path.length > 0;
      if (walking) {
        const [px, py] = pixelOf(this.pos);
        const g = groundAt(px, py);
        if (g) this.pos.copy(g);
        // face the way it moves on screen; ignore tiny sideways changes (walking toward the camera)
        const [bx] = pixelOf(before);
        const dx = px - bx;
        if (Math.abs(dx) > 0.15 * dt * 60) this.facingLeft = dx < 0;
      }
      const clips = CLIP[this.character] ?? {};
      const clip = walking ? clips.walk : clips[this.state.action];
      const name = clip ?? `${this.character}_idle`;
      // mirror when the clip faces the other way than the walk (sheet "faces", else known defaults)
      const facesLeft = (pack.sprites[name]?.faces ?? (CLIPS_FACING_LEFT.has(name) ? "left" : "right")) === "left";
      this.sprite.set(name, walking && this.facingLeft !== facesLeft);
      this.sprite.rate = walking ? WALK_RATE : 1;
      this.sprite.mesh.position.copy(this.pos);
      this.sprite.update(dt);
      const off = new THREE.Vector3(this.h * 0.25, 0.03, this.h * 0.1);
      this.shadow.position.copy(this.pos).add(off);
      this.ring.position.copy(this.pos).add(new THREE.Vector3(0, 0.04, 0));
      this.light.position.copy(this.pos).add(new THREE.Vector3(0, this.h * 0.3, this.h * 0.4));

      const blocked = !walking && this.state.action === "blocked";
      if (blocked && !this.alert) {
        this.alert = new Sprite(this.h * 0.4);
        this.alert.set("alert");
        this.alert.mat.emissive = new THREE.Color(1, 0.2, 0.2);
        this.alert.mat.emissiveIntensity = night ? 0.6 : 0.25;
      } else if (!blocked && this.alert) {
        this.alert.remove();
        this.alert = null;
      }
      if (this.alert) {
        this.alert.mesh.position.copy(this.pos).add(new THREE.Vector3(-this.h * 0.05, this.h * 0.98, 0));
        this.alert.update(dt);
      }
      const hammering = !walking && this.sprite.name === "hero_hammer";
      if (hammering && !this.sparks) this.sparks = new Sparks(new THREE.Color(1, 0.65, 0.2), this.h);
      else if (!hammering && this.sparks) {
        this.sparks.remove();
        this.sparks = null;
      }
      if (this.sparks) {
        this.sparks.origin.copy(this.pos).add(new THREE.Vector3(this.h * 0.05, this.h * 0.28, 0.05));
        this.sparks.update(dt);
      }
    }
    remove() {
      for (const m of [this.shadow, this.ring, this.light]) scene.remove(m);
      this.sprite.remove();
      this.alert?.remove();
      this.sparks?.remove();
    }
  }

  // building effects: barrier (blocked), scaffold (being written), spill light (window level >= 2)
  class BuildingFx {
    constructor() {
      this.barriers = new Map();
      this.scaffolds = new Map();
      this.spills = new Map();
    }
    sync(map, want, make) {
      for (const [id, o] of map) if (!want.has(id)) (o.remove(), map.delete(id));
      for (const id of want) if (!map.has(id) && buildings.has(id)) map.set(id, make(buildings.get(id).pos, buildings.get(id)));
    }
    update(blocked, writing, lit) {
      this.sync(this.barriers, blocked, (pos) => {
        const r = 3.76;
        const parts = [groundPlane(r * 2.5, r * 2.5, runesMat(night ? 3 : 1.6), pos)];
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, r * 2.2, 64, 1, true), curtainMat(night ? 2.8 : 2.6, r * 2.2));
        c.position.copy(pos).add(new THREE.Vector3(0, r * 1.1, 0));
        c.renderOrder = 3;
        scene.add(c);
        parts.push(c);
        parts.push(omni(new THREE.Color("rgb(255,70,80)"), night ? 3 : 1.2, r * 1.8, pos.clone().add(new THREE.Vector3(0, r * 0.5, r * 0.6)), 1));
        return { remove: () => parts.forEach((p) => scene.remove(p)) };
      });
      this.sync(this.scaffolds, writing, (pos) => {
        const s = new Sprite(0);
        const meta = pack.sprites.scaffold;
        const w = 5.47;
        s.h = (w * meta.char_h) / (meta.cell[0] - 12);
        s.set("scaffold");
        s.mesh.position.copy(pos).add(new THREE.Vector3(0, 0, 0.5));
        return { update: (dt) => s.update(dt), remove: () => s.remove() };
      });
      this.sync(this.spills, lit, (pos, b) => {
        const r = pos.length() * 0.07;
        const at = groundAt(b.pixel[0], b.pixel[1] + 20) ?? pos.clone().multiplyScalar(0.985); // in front of the door
        const m = groundPlane(r * 2.2, r * 5, spillMat(0.9), at);
        const l = omni(new THREE.Color("rgb(255,175,100)"), 2, r * 1.6, at.clone().add(new THREE.Vector3(0, r * 0.4, 0)), 1);
        return { remove: () => (scene.remove(m), scene.remove(l)) };
      });
      for (const s of this.scaffolds.values()) s.update(0);
    }
  }

  // ---------------------------------------------------------------- construction sites (folders the painting lacks)
  // Until the art pipeline delivers the "construction" sprite, the scaffold stands in.
  const SITE_SPRITE = pack.sprites.construction ? "construction" : "scaffold";
  const SITE_W = 5.5; // metres across
  const labelLayer = document.createElement("div");
  Object.assign(labelLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  container.appendChild(labelLayer);
  const sites = new Map(); // id -> { sprite, label, pos }
  let grid = null;
  function rebuildGrid() {
    if (!pixelToLayout) return;
    const houses = V.buildings.filter((b) => b.layout).map((b) => b.layout);
    for (const o of sites.values()) houses.push(o.lot);
    grid = makeGrid(houses);
  }
  function setSites(list = []) {
    const want = new Map();
    for (const s of list) {
      if (!s.lot || !V.layoutToPixel) continue;
      const pixel = layoutToPixel(V.layoutToPixel, s.lot);
      const pos = groundAt(pixel[0], pixel[1]);
      if (pos) want.set(s.id, { pixel, pos });
    }
    for (const [id, o] of sites) {
      if (want.has(id) && want.get(id).pixel.every((v, i) => Math.abs(v - o.pixel[i]) < 0.5)) continue;
      o.sprite.remove();
      o.label.remove();
      buildings.delete(id);
      sites.delete(id);
    }
    for (const [id, { pixel, pos }] of want) {
      if (sites.has(id)) continue;
      const meta = pack.sprites[SITE_SPRITE];
      const sprite = new Sprite((SITE_W * meta.char_h) / (meta.cell[0] - 12));
      sprite.set(SITE_SPRITE);
      sprite.mesh.position.copy(pos);
      const label = document.createElement("div");
      label.textContent = id;
      Object.assign(label.style, {
        position: "absolute",
        left: "0",
        top: "0",
        padding: "2px 8px",
        borderRadius: "6px",
        background: "rgba(20,24,40,0.78)",
        border: "1px dashed rgba(255,214,120,0.9)",
        color: "#fff",
        font: "600 12px system-ui, sans-serif",
        whiteSpace: "nowrap",
      });
      labelLayer.appendChild(label);
      sites.set(id, { sprite, label, pos, pixel, lot: list.find((s) => s.id === id).lot, top: pos.clone().add(new THREE.Vector3(0, sprite.h * 1.15, 0)) });
      buildings.set(id, { id, pixel, pos, site: true });
    }
    rebuildGrid();
  }
  const projected = new THREE.Vector3();
  // The route on the painted ground from world point `a` to `b`: world points about a metre apart,
  // along the streets and around houses (townPaths.js); a straight line without a layout.
  function routeBetween(a, b) {
    const la = layoutOf(a);
    const lb = layoutOf(b);
    if (!grid || !la || !lb) return [b.clone()];
    const pts = findPath(grid, la, lb);
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 1));
      for (let k = 1; k <= n; k++) {
        const g = groundOfLayout([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
        if (g) out.push(g);
      }
    }
    out.push(b.clone());
    return out;
  }
  function placeLabels() {
    const { w, h } = size();
    for (const o of sites.values()) {
      projected.copy(o.top).project(camera);
      const hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2;
      o.label.style.display = hidden ? "none" : "block";
      if (!hidden) o.label.style.transform = `translate(${((projected.x + 1) / 2) * w}px, ${((1 - projected.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  const agents = new Map();
  const fx = new BuildingFx();
  let live = { agents: [], recent: [] };
  function setState(next) {
    live = next ?? { agents: [], recent: [] };
    const seen = new Set();
    for (const a of live.agents) {
      if (a.action === "idle" && !agents.has(a.key)) continue;
      seen.add(a.key);
      if (!agents.has(a.key)) agents.set(a.key, new Agent(a));
      else agents.get(a.key).sync(a);
    }
    for (const [k, ag] of agents) if (!seen.has(k)) (ag.remove(), agents.delete(k));

    const at = new Set(live.agents.filter((a) => a.action !== "idle").map((a) => a.building));
    const recent = new Set(live.recent);
    V.buildings.forEach((b, i) => (winLevels[i] = at.has(b.id) ? WIN.agent : recent.has(b.id) ? WIN.recent : WIN.rest));
    const blocked = new Set(live.agents.filter((a) => a.action === "blocked").map((a) => a.building));
    const writing = new Set(live.agents.filter((a) => a.action === "write").map((a) => a.building));
    const lit = new Set(windowsOn ? V.buildings.filter((b, i) => winLevels[i] >= SPILL_MIN).map((b) => b.id) : []);
    fx.update(blocked, writing, lit);
    reliefMat.uniforms.readEnergy.value = live.agents.some((a) => a.action === "read") ? (night ? 2.2 : 1.4) : 0;
  }
  setSites(initialSites);
  setState(initialState);

  // ---------------------------------------------------------------- camera views
  function placeCamera() {
    const [W, H] = V.depthSize;
    const F = V.focalPx;
    const { w, h } = size();
    camera.aspect = w / h;
    if (view === "pano") {
      camera.quaternion.setFromRotationMatrix(B);
      camera.fov = V.fov[1];
    } else {
      const [cx, cy] = view === "close" ? [640, 445] : [1085, 730];
      const d = new THREE.Vector3((cx - W / 2) / F, -(cy - H / 2) / F, -1).applyMatrix4(B);
      camera.position.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(d);
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(360 / 2 / F));
    }
    camera.updateProjectionMatrix();
  }
  placeCamera();

  // ---------------------------------------------------------------- post: depth of field from the real depth, bloom
  function dofBand() {
    if (view === "pano") {
      const ds = V.buildings.map((b) => v3(b.world).length()).sort((a, b) => a - b);
      return { near: ds[0] * 0.9, far: ds[ds.length - 1] * 1.05, amount: 0.06 };
    }
    const subj = view === "close" ? "web/src/city" : "install";
    let dd = buildings.get(subj).pos.length();
    if (view === "close") dd = (dd + buildings.get("specs").pos.length()) / 2;
    return { near: dd * 0.8, far: dd * 1.15, amount: 0.09 };
  }
  const tmpV = new THREE.Vector3();
  class SceneDofPass extends Pass {
    constructor() {
      super();
      this.needsSwap = true;
      this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.rt.depthTexture = new THREE.DepthTexture(1, 1);
      const band = dofBand();
      this.quad = new FullScreenQuad(
        new THREE.ShaderMaterial({
          uniforms: {
            tColor: { value: this.rt.texture },
            tDepth: { value: this.rt.depthTexture },
            cNear: { value: camera.near },
            cFar: { value: camera.far },
            near: { value: band.near },
            nearT: { value: band.near * 0.35 },
            far: { value: band.far },
            farT: { value: band.far * 0.6 },
            maxPx: { value: 0 },
            texel: { value: new THREE.Vector2() },
          },
          vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform sampler2D tColor, tDepth;
            uniform float cNear, cFar, near, nearT, far, farT, maxPx;
            uniform vec2 texel;
            varying vec2 vUv;
            float dist(vec2 uv) {
              float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
              return 2.0 * cNear * cFar / (cFar + cNear - z * (cFar - cNear));
            }
            float coc(float d) {
              return max(smoothstep(near, near - nearT, d), smoothstep(far, far + farT, d));
            }
            // Scatter-as-gather: a sample at distance r (px) covers this pixel if its own blur radius
            // reaches r. Samples behind this pixel may cover it only as far as this pixel is blurred
            // itself, so a blurred background never smears over a sharp foreground, while a blurred
            // foreground does spread over what is behind it.
            void main() {
              vec4 base = texture2D(tColor, vUv);
              if (maxPx < 0.5) { gl_FragColor = base; return; }
              float d0 = dist(vUv);
              float c0 = coc(d0) * maxPx;
              vec3 sum = base.rgb; float wsum = 1.0;
              for (int i = 1; i < 32; i++) {
                float a = float(i) * 2.39996;
                float r = sqrt(float(i) / 32.0) * maxPx;
                vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
                float d = dist(uv);
                float c = coc(d) * maxPx;
                float reach = d < d0 ? c : min(c, c0);
                float w = smoothstep(r - 1.5, r + 1.5, reach);
                sum += texture2D(tColor, uv).rgb * w; wsum += w;
              }
              gl_FragColor = vec4(sum / wsum, 1.0);
            }`,
        }),
      );
      this.amount = band.amount;
      this.band = band;
    }
    // Characters and sites carry the information: the sharp band always reaches the nearest of them
    // (one standing in front of its house would otherwise fall into the blurred foreground).
    keepSharp(points) {
      let near = this.band.near;
      for (const p of points) near = Math.min(near, -tmpV.copy(p).applyMatrix4(camera.matrixWorldInverse).z * 0.85);
      const u = this.quad.material.uniforms;
      u.near.value = near;
      u.nearT.value = near * 0.35;
    }
    setSize(w, h) {
      this.rt.setSize(w, h);
      this.quad.material.uniforms.texel.value.set(1 / w, 1 / h);
      // Godot's dof_blur_amount scales the blur with the viewport; 0.06 ~ 1.4% of the height
      this.quad.material.uniforms.maxPx.value = useDof ? h * this.amount * 0.25 : 0;
    }
    render(renderer, writeBuffer) {
      renderer.setRenderTarget(this.rt);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
    }
  }
  const useDof = opts.dof !== false;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  composer.setPixelRatio(PIXEL_RATIO);
  const dofPass = new SceneDofPass();
  composer.addPass(dofPass);
  const { w: W0, h: H0 } = size();
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W0, H0), night ? 0.28 : 0.12, 0.3, 1.0));
  composer.addPass(new OutputPass());
  composer.setSize(W0, H0);
  const resizer = new ResizeObserver(() => {
    if (fixedSize) return;
    const { w, h } = size();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    placeCamera();
  });
  resizer.observe(container);

  // ---------------------------------------------------------------- loop, bench
  // GPU time per frame (EXT_disjoint_timer_query_webgl2), collected a few frames later
  const gpuTimer = (() => {
    const gl = renderer.getContext();
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const pending = [];
    const samples = [];
    let q = null;
    return {
      samples,
      available: !!ext,
      begin() {
        if (!ext || pending.length > 8) return;
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      },
      end() {
        if (!q) return;
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
        q = null;
        while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
          const r = pending.shift();
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(r);
        }
        if (samples.length > 5000) samples.splice(0, samples.length - 5000);
      },
    };
  })();
  const loadMs = performance.now() - t0;
  let last = performance.now();
  let frames = 0;
  let fpsT = 0;
  let fps = 0;
  const bench = { warm: 2, t: 0, frames: 0, minFps: Infinity, done: false };
  window.__ready = false;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time.value += dt;
    reliefMat.uniforms.time.value = time.value;
    for (const a of agents.values()) a.update(dt);
    for (const o of sites.values()) o.sprite.update(dt);
    placeLabels();
    dofPass.keepSharp([...[...agents.values()].map((a) => a.sprite.mesh.position), ...[...sites.values()].map((o) => o.pos)]);
    renderer.info.reset();
    gpuTimer.begin();
    composer.render(dt);
    gpuTimer.end();
    frames++;
    fpsT += dt;
    if (fpsT >= 0.5) {
      fps = frames / fpsT;
      frames = 0;
      fpsT = 0;
      if (showHud) {
        const list = [...agents.values()].map((a) => `${a.character}: ${a.state.action} @ ${a.state.building}`).join("<br>");
        hud.innerHTML = `${fps.toFixed(0)} fps · load ${(loadMs / 1000).toFixed(1)} s · ${renderer.info.render.triangles.toLocaleString()} tris<br>${list}`;
      }
    }
    if (!window.__ready && time.value > 1.5) window.__ready = true;
    if (benchS > 0 && !bench.done) {
      if (bench.warm > 0) bench.warm -= dt;
      else {
        bench.t += (now - (bench.prev ?? now)) / 1000;
        bench.frames++;
        if (bench.prev) {
          bench.minFps = Math.min(bench.minFps, 1000 / Math.max(now - bench.prev, 1e-3));
          (bench.dts ??= []).push(now - bench.prev);
          if (now - bench.prev > 50) (bench.long ??= []).push({ at: +(bench.t).toFixed(2), ms: +(now - bench.prev).toFixed(1) });
        }
        if (bench.t >= benchS) {
          bench.done = true;
          window.__bench = {
            variant: variantName,
            view,
            size: `${size().w}x${size().h}`,
            avg_fps: +(bench.frames / bench.t).toFixed(1),
            min_fps: +bench.minFps.toFixed(1),
            load_s: +(loadMs / 1000).toFixed(2),
            draw_calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            js_heap_mb: performance.memory ? +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1) : null,
            p99_ms: +[...bench.dts].sort((x, y) => x - y)[Math.floor(bench.dts.length * 0.99)].toFixed(2),
            over_20ms: bench.dts.filter((x) => x > 20).length,
            gpu_ms_avg: gpuTimer.samples.length ? +(gpuTimer.samples.reduce((x, y) => x + y) / gpuTimer.samples.length).toFixed(3) : null,
            gpu_ms_p99: gpuTimer.samples.length ? +[...gpuTimer.samples].sort((x, y) => x - y)[Math.floor(gpuTimer.samples.length * 0.99)].toFixed(3) : null,
            long_frames: (bench.long ?? []).length,
          };
          console.log("BENCH " + JSON.stringify(window.__bench));
          // shells that cannot read the page (Tauri without IPC) get the result through the bridge
          opts.onBench?.(window.__bench);
        }
      }
      bench.prev = now;
    }
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);

  return {
    setState,
    setSites,
    get fps() {
      return fps;
    },
    dispose() {
      cancelAnimationFrame(raf);
      resizer.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material ?? [])) {
          for (const v of Object.values(m.uniforms ?? {})) v.value?.isTexture && v.value.dispose();
          m.map?.dispose();
          m.normalMap?.dispose();
          m.dispose();
        }
      });
      composer.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}
