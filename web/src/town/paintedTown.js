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
import { prioritize } from "./townState.js";


/**
 * Draw the town pack `pack` (its parsed theme.json; files under the URL `base`, ending in "/") into
 * `container`. `variant`: "night" | "day"; `view`: "pano" | "close" | "priest". `initialState` /
 * setState(): { agents: [{ key, character, building, action, name?, prompt? }], recent: [building
 * ids] } (see townState.js); `name` is the agent's name tag ("Claude 1"), `prompt` { text, at: ms }
 * its latest prompt, shown in a speech bubble for a few seconds after it arrives. opts: { hud: element for an fps line, opacity, dof, edges, size: [w, h], bench: s,
 * onBench(result) }. `rootName`: the sign on the town hall (the repo's name). Resolves to
 * { setState, setSites, setSelected, pick, fps, dispose }. pick(clientX, clientY): the building id
 * under that page point, or null; setSelected(id | null) marks one building's sign. setSites([{ id, lot: [x, z] }]):
 * folders the painting does not have, drawn as construction sites on the pack's open lots
 * (townLayout.js); agents and effects then treat them like buildings.
 */
export async function createPaintedTown({ container, pack, base, variant = "night", view = "pano", initialState = null, initialSites = [], rootName = "", opts = {} }) {
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
  const [albedoTex, depthTex, readTex, lightTex, haloTex, idTex, ambientTex, areasTex] = await Promise.all([
    tex(bgFiles.albedo),
    tex(V.depth, { srgb: false, nearest: true }),
    tex(bgFiles.reading, { srgb: false }),
    bgFiles.light ? tex(bgFiles.light) : null,
    bgFiles.halo ? tex(bgFiles.halo, { srgb: false }) : null,
    bgFiles.ids ? tex(bgFiles.ids, { srgb: false, nearest: true }) : null,
    bgFiles.ambient ? tex(bgFiles.ambient, { srgb: false }) : null,
    // optional: each building's outline, R = building index + 1 (spec 10); else derived below
    bgFiles.areas ? tex(bgFiles.areas, { srgb: false, nearest: true }) : null,
  ]);
  // Scenery motion (spec 09 §9): off with "reduce motion" in the OS.
  const ambientOn = !!ambientTex && !matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
    uniform sampler2D albedo, lightTex, haloTex, idTex, readTex, ambientTex, areaTex;
    uniform float win[32];
    uniform bool windowsOn, ambientOn;
    uniform float readEnergy, time;
    // map modes (spec 09 §5), per building area (areaTex: building index + 1) and for the ground
    uniform float areaFog[32], areaSketch[32], areaTintA[32];
    uniform vec3 areaTint[32];
    uniform float groundFog, groundSketch;
    uniform vec3 fogCol, paperCol, inkCol;
    uniform vec2 albedoTexel;
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    varying vec2 vUv;
    varying float vEdge;
    float level(float code) {
      int i = int(floor(code * 255.0 / 10.0 + 0.5)) - 1;
      return (i >= 0 && i < 32) ? win[i] : 0.0;
    }
    void main() {
      if (vEdge > 0.001) discard;
      // Scenery motion from the ambient mask: R fire flicker, G tree sway, B flag wave.
      vec2 uv = vUv;
      vec3 am = vec3(0.0);
      if (ambientOn) {
        am = texture2D(ambientTex, vUv).rgb;
        uv.x += am.g * (0.0011 * sin(time * 1.1 + vUv.x * 55.0 + vUv.y * 17.0) + 0.0005 * sin(time * 2.7 + vUv.y * 140.0));
        uv += am.b * vec2(0.0016 * sin(time * 6.5 - vUv.x * 420.0), 0.0012 * sin(time * 7.3 - vUv.x * 300.0));
      }
      vec3 c = texture2D(albedo, uv).rgb;
      if (am.r > 0.0) {
        // each fire flickers on its own: the phase comes from where it is
        float ph = fract(sin(dot(floor(vUv * vec2(96.0, 48.0)), vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
        float f = 0.5 + 0.22 * sin(time * 11.0 + ph) + 0.16 * sin(time * 23.0 + ph * 1.7) + 0.12 * sin(time * 5.3 + ph * 0.6);
        c *= 1.0 + am.r * (f - 0.5) * 0.9;
        c += am.r * vec3(0.10, 0.04, 0.0) * f;
      }
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
      int ai = int(floor(texture2D(areaTex, vUv).r * 255.0 + 0.5)) - 1;
      float fog = groundFog, sk = groundSketch, ta = 0.0;
      vec3 tc = vec3(0.0);
      if (ai >= 0 && ai < 32) { fog = areaFog[ai]; sk = areaSketch[ai]; ta = areaTintA[ai]; tc = areaTint[ai]; }
      // role: a wash of the role's colour over the house
      if (ta > 0.001) c = mix(c, tc * (0.35 + 1.3 * lum(c)), ta);
      // diff: what did not change turns into a pale line drawing
      if (sk > 0.001) {
        vec2 o = albedoTexel * 1.5;
        float gx = lum(texture2D(albedo, uv + vec2(o.x, 0.0)).rgb) - lum(texture2D(albedo, uv - vec2(o.x, 0.0)).rgb);
        float gy = lum(texture2D(albedo, uv + vec2(0.0, o.y)).rgb) - lum(texture2D(albedo, uv - vec2(0.0, o.y)).rgb);
        float e = smoothstep(0.05, 0.25, length(vec2(gx, gy)));
        c = mix(c, mix(paperCol, inkCol, e), sk * 0.92);
      }
      // this session: fog of war over what was not touched, drifting slowly
      if (fog > 0.001) {
        float n = vnoise(vUv * vec2(14.0, 7.0) + vec2(time * 0.05, time * 0.02)) * 0.6 + vnoise(vUv * vec2(37.0, 19.0) - vec2(time * 0.03, 0.0)) * 0.4;
        vec3 fc = fogCol * (0.8 + 0.4 * n);
        c = mix(c, mix(vec3(lum(c)) * 0.6, fc, 0.8), fog * 0.85);
      }
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
      ambientTex: { value: ambientTex },
      ambientOn: { value: ambientOn },
      readEnergy: { value: 0 },
      time: { value: 0 },
      areaTex: { value: null },
      areaFog: { value: new Array(32).fill(0) },
      areaSketch: { value: new Array(32).fill(0) },
      areaTintA: { value: new Array(32).fill(0) },
      areaTint: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
      groundFog: { value: 0 },
      groundSketch: { value: 0 },
      fogCol: { value: night ? new THREE.Vector3(0.1, 0.12, 0.19) : new THREE.Vector3(0.72, 0.75, 0.8) },
      paperCol: { value: night ? new THREE.Vector3(0.07, 0.08, 0.12) : new THREE.Vector3(0.86, 0.84, 0.78) },
      inkCol: { value: night ? new THREE.Vector3(0.34, 0.4, 0.52) : new THREE.Vector3(0.3, 0.27, 0.24) },
      albedoTexel: { value: new THREE.Vector2(1 / albedoTex.image.width, 1 / albedoTex.image.height) },
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
  const flickering = []; // night lights: fires flicker hard, lamps barely
  if (night) {
    for (const l of V.lights) {
      const light = omni(new THREE.Color("rgb(255,170,90)"), THREE.MathUtils.clamp(l.size / 60, 0.6, 3), THREE.MathUtils.clamp(l.depth * 0.09, 2, 9), v3(l.pos));
      flickering.push({ light, base: light.intensity, amp: l.kind === "fire" ? 0.35 : 0.05, ph: Math.random() * 6.283 });
    }
  }
  function flickerLights(t) {
    if (!ambientOn) return;
    for (const f of flickering) {
      const n = Math.sin(t * 11 + f.ph) * 0.45 + Math.sin(t * 23 + f.ph * 1.7) * 0.33 + Math.sin(t * 5.3 + f.ph * 0.6) * 0.22;
      f.light.intensity = f.base * (1 + f.amp * n);
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
          float a = ring > 0.5 ? smoothstep(1.0, 0.82, d) * (0.25 + 0.75 * smoothstep(0.55, 0.85, d)) : pow(clamp(1.0 - d, 0.0, 1.0), 1.8);
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
  // The ring and shadow under a character: an ellipse facing the camera, standing just in front of
  // the feet. A flat disc on the painted relief got cut by the ground behind the feet and stretched
  // on slopes; this keeps one shape everywhere, while things in front (a bush) still cover it.
  const FOOT_ASPECT = 0.36; // about how a circle on the ground looks from the painting's ~26 degree pitch
  function footEllipse(width, mat) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * FOOT_ASPECT), mat);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }
  const toCam = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  function placeAtFeet(m, feet, right) {
    toCam.copy(camera.position).sub(feet).normalize();
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    m.position.copy(feet).addScaledVector(toCam, 2.0).addScaledVector(camRight, right);
    m.quaternion.copy(camera.quaternion);
  }
  // MoGe flattens the painted ground, so flat discs are stretched in depth to read as round on screen
  function groundPlane(w, d, mat, pos) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.03, 0));
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- sprites
  const IS_CHARACTER = /^(hero|mage|priest)_/;
  const sheetCache = new Map();
  const loaded = new Set(); // sheets whose textures are in
  async function sheet(name) {
    if (!sheetCache.has(name)) {
      const meta = pack.sprites[name];
      // Characters are drawn with their painted shading only (see Sprite.set): no normal map to load.
      const normal = IS_CHARACTER.test(name) ? null : tex(meta.normal, { srgb: false, flipY: true });
      sheetCache.set(name, Promise.all([tex(meta.albedo, { flipY: true }), normal]).then(([map, normal]) => (loaded.add(name), { meta, map, normal })));
    }
    return sheetCache.get(name);
  }
  // The extra idle clips (<character>_idle_<what>) are only played now and then: load them after
  // the town is up, so they do not hold up the first picture.
  const EXTRA_IDLE = /_idle_/;
  await Promise.all(Object.keys(pack.sprites).filter((k) => !EXTRA_IDLE.test(k)).map(sheet));

  const MAP_FRAGMENT_SHARP = THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture2D( map, vMapUv, -1.0 )");
  /** A hand-painted sprite standing on its feet, turned toward the camera about Y, lit by the scene. */
  class Sprite {
    constructor(h) {
      this.h = h;
      this.mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
      // Drawn smaller than painted, the default mip choice smudges eyes and mouths; lean toward
      // the sharper level.
      this.mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", MAP_FRAGMENT_SHARP);
      };
      this.mat.customProgramCacheKey = () => "sprite-sharp";
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
      this.normal = s.normal?.clone() ?? null;
      this.mat.map = this.map;
      this.mat.normalMap = this.normal;
      // Characters keep the shading painted into them: the generated normal map has no eyes or
      // mouth, and relit faces grew a shaded snout (checked 2026-10-23). Props keep the relief.
      const n = IS_CHARACTER.test(name) ? 0 : 0.7;
      this.mat.normalScale.set(n, n);
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
        if (!t) continue;
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

  // ---------------------------------------------------------------- event effects (spec 09 §3.2, §4)
  /** Glowing points: emit() one at a time, each fades out over its own life. Additive. */
  class Particles {
    constructor(cap, size, { gravity = 0, drag = 0 } = {}) {
      Object.assign(this, { cap, gravity, drag, next: 0 });
      this.p = new Float32Array(cap * 3);
      this.v = new Float32Array(cap * 3);
      this.base = new Float32Array(cap * 3);
      this.col = new Float32Array(cap * 3);
      this.age = new Float32Array(cap).fill(1);
      this.life = new Float32Array(cap).fill(1);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(this.p, 3));
      g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
      // soft round glows, `size` metres across (a square PointsMaterial dot was a few pixels in the panorama)
      this.points = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          uniforms: { size: { value: size }, scale: pointScale },
          vertexShader: `attribute vec3 color; uniform float size, scale; varying vec3 vCol;
            void main() { vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = max(2.0, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `varying vec3 vCol;
            void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d);
              gl_FragColor = vec4(vCol * (a * a + 0.6 * smoothstep(0.35, 0.0, d)), 1.0); }`,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.points.frustumCulled = false;
      this.points.renderOrder = 3;
      scene.add(this.points);
    }
    emit(at, vx, vy, vz, color, life) {
      const i = this.next++ % this.cap;
      this.p.set([at.x, at.y, at.z], i * 3);
      this.v.set([vx, vy, vz], i * 3);
      this.base.set([color.r, color.g, color.b], i * 3);
      this.age[i] = 0;
      this.life[i] = life;
    }
    update(dt) {
      const { p, v, base, col, age, life } = this;
      const keep = Math.max(0, 1 - this.drag * dt);
      for (let i = 0; i < this.cap; i++) {
        if (age[i] >= life[i]) {
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
          continue;
        }
        age[i] += dt;
        v[i * 3 + 1] -= this.gravity * dt;
        for (let k = 0; k < 3; k++) (v[i * 3 + k] *= keep), (p[i * 3 + k] += v[i * 3 + k] * dt);
        const f = Math.max(0, 1 - age[i] / life[i]);
        for (let k = 0; k < 3; k++) col[i * 3 + k] = base[i * 3 + k] * f * f;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    remove() {
      scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
  }
  // pixels per metre at one metre from the camera, for point sizes (kept current in the loop)
  const pointScale = { value: 1 };
  const effects = new Set(); // one-shot effects: { update(dt) -> still running?, remove() }
  // Effect lights come from a fixed pool made up front: adding a light to the scene makes three.js
  // rebuild the shader of every lit material, which stalled the frame for seconds (checked 2026-10-24).
  const fxLights = Array.from({ length: 16 }, () => Object.assign(omni(new THREE.Color(0, 0, 0), 0, 1, new THREE.Vector3(), 1), { free: true }));
  const spareLight = new THREE.PointLight(); // handed out when the pool is used up: lights nothing
  /** A pooled light at `pos`, intensity 0 until the caller sets it; release() gives it back. */
  function fxLight(color, range, pos) {
    const l = fxLights.find((x) => x.free) ?? spareLight;
    l.free = false;
    l.color.copy(color);
    l.distance = range;
    l.position.copy(pos);
    l.intensity = 0;
    l.release = () => ((l.intensity = 0), (l.free = true));
    return l;
  }
  const HEAD = CHAR_H * (big ? BIG : 1); // a character's height in this view
  const rand = (a, b) => a + Math.random() * (b - a);
  function sphereDir() {
    const u = rand(-1, 1);
    const a = rand(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    return [s * Math.cos(a), u, s * Math.sin(a)];
  }

  /** Task done (Stop after a turn with writes): three small fireworks over the agent. */
  function fireworks(at, color) {
    const ps = new Particles(420, HEAD * 0.13, { gravity: HEAD * 0.45, drag: 1.1 });
    const colors = [new THREE.Color("#5dff8a"), new THREE.Color("#ffd75e"), color.clone()].map((c) => c.multiplyScalar(night ? 5 : 3.5));
    const shells = [0.35, 0.8, 1.25].map((t, i) => ({ t, color: colors[i], fired: false }));
    const light = fxLight(new THREE.Color("#ffe6a0"), HEAD * 3, at);
    let t = 0;
    return {
      update(dt) {
        t += dt;
        for (const s of shells) {
          if (s.fired || t < s.t) continue;
          s.fired = true;
          const c = at.clone().add(new THREE.Vector3(rand(-0.35, 0.35) * HEAD, HEAD * rand(1.6, 2.0), 0));
          for (let k = 0; k < 110; k++) {
            const [x, y, z] = sphereDir();
            const sp = HEAD * rand(1.3, 1.6);
            ps.emit(c, x * sp, y * sp, z * sp, s.color, rand(1.0, 1.5));
          }
          light.position.copy(c);
          light.color.copy(s.color).multiplyScalar(1 / 4);
          light.intensity = (night ? 4 : 1.5) * Math.PI;
        }
        // the rising trail of the next shell
        for (const s of shells) {
          const k = (t - (s.t - 0.35)) / 0.35;
          if (!s.fired && k > 0 && k < 1) ps.emit(at.clone().add(new THREE.Vector3(0, HEAD * (0.9 + k), 0)), 0, 0, 0, s.color, 0.25);
        }
        light.intensity *= Math.max(0, 1 - dt * 5);
        ps.update(dt);
        return t < 3;
      },
      remove() {
        ps.remove();
        light.release();
      },
    };
  }

  // A soft upright column of light facing the camera (searched buildings flash with it).
  const beamMat = (color) =>
    new THREE.ShaderMaterial({
      uniforms: { color: { value: color }, env: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float env; varying vec2 vUv;
        void main() {
          float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float a = x * x * pow(max(1.0 - vUv.y, 0.0), 1.4) * smoothstep(0.0, 0.08, vUv.y);
          gl_FragColor = vec4(color * a * env, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  /** Search: the buildings searched flash blue one after another, left to right (spec 09 §3.2). */
  function searchFlash(ids) {
    const list = ids.map((id) => buildings.get(id)).filter(Boolean).sort((a, b) => a.pixel[0] - b.pixel[0]).slice(0, 24);
    if (!list.length) return null;
    const STEP = Math.min(0.12, 1.6 / list.length);
    const ON = 0.55;
    const blue = linear("rgb(90,160,255)");
    const flashes = list.map((b, i) => {
      const r = b.pos.length() * 0.07;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.5, r * 3.2).translate(0, r * 1.6, 0), beamMat(blue.clone().multiplyScalar(night ? 2.2 : 1.6)));
      m.position.copy(frontOf(b));
      m.quaternion.copy(camera.quaternion);
      m.renderOrder = 3;
      scene.add(m);
      const l = fxLight(blue, r * 2, b.pos.clone().add(new THREE.Vector3(0, r * 0.8, r * 0.5)));
      return { m, l, start: i * STEP };
    });
    let t = 0;
    return {
      update(dt) {
        t += dt;
        for (const f of flashes) {
          const k = THREE.MathUtils.clamp((t - f.start) / ON, 0, 1);
          const env = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
          f.m.material.uniforms.env.value = env;
          f.l.intensity = env * (night ? 3 : 1.2) * Math.PI;
        }
        return t < flashes[flashes.length - 1].start + ON;
      },
      remove() {
        for (const f of flashes) (scene.remove(f.m), f.l.release(), f.m.geometry.dispose(), f.m.material.dispose());
      },
    };
  }

  /** Tests passed: green motes rise around the building for a moment. */
  function passSparkle(at) {
    const ps = new Particles(160, HEAD * 0.1, { gravity: -HEAD * 0.15, drag: 0.6 });
    const green = new THREE.Color("#5dff8a").multiplyScalar(night ? 4 : 3);
    const light = fxLight(new THREE.Color("#5dff8a"), HEAD * 3, at.clone().add(new THREE.Vector3(0, HEAD, 0)));
    let t = 0;
    let acc = 0;
    return {
      update(dt) {
        t += dt;
        acc += dt;
        while (t < 1.8 && acc > 0.02) {
          acc -= 0.02;
          const p = at.clone().add(new THREE.Vector3(rand(-0.9, 0.9) * HEAD, rand(0, 0.6) * HEAD, rand(-0.3, 0.3) * HEAD));
          ps.emit(p, 0, HEAD * rand(0.4, 0.8), 0, green, rand(0.9, 1.4));
        }
        light.intensity = Math.max(0, Math.sin(Math.min(t / 2.4, 1) * Math.PI)) * (night ? 2.5 : 1) * Math.PI;
        ps.update(dt);
        return t < 3.2;
      },
      remove() {
        ps.remove();
        light.release();
      },
    };
  }

  /** Two agents wrote the same file: sparks clash over the building's door (spec 09 §3.2, 5 s). */
  function clash(at) {
    const ps = new Particles(300, HEAD * 0.09, { gravity: HEAD * 2.2, drag: 0.8 });
    const hot = [new THREE.Color("#ff5a3c"), new THREE.Color("#ffb347")].map((c) => c.multiplyScalar(night ? 6 : 4));
    const mid = at.clone().add(new THREE.Vector3(0, HEAD * 1.1, 0.4));
    const light = fxLight(new THREE.Color("#ff7040"), HEAD * 2.5, mid);
    // the bright flash where the blades meet (the painting itself takes no scene light)
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(HEAD * 1.1, HEAD * 1.1), glowMat(linear("rgb(255,190,120)"), night ? 3 : 2.2, false, 0));
    flash.position.copy(mid);
    flash.quaternion.copy(camera.quaternion);
    flash.renderOrder = 3;
    scene.add(flash);
    let t = 0;
    let acc = 0;
    return {
      update(dt) {
        t += dt;
        acc += dt;
        // bursts a few times a second, as if two blades meet
        const beat = Math.sin(t * 9) > 0.6;
        while (t < 5 && acc > 0.006) {
          acc -= 0.006;
          if (!beat) continue;
          const side = Math.random() < 0.5 ? -1 : 1;
          const [x, y, z] = sphereDir();
          const sp = HEAD * rand(0.8, 1.6);
          ps.emit(mid, (x * 0.6 - side * 0.5) * sp, Math.abs(y) * sp + HEAD * 0.4, z * 0.4 * sp, hot[(Math.random() * 2) | 0], rand(0.4, 0.8));
        }
        light.intensity = (beat && t < 5 ? 1 : 0.2) * (night ? 3 : 1.2) * Math.PI;
        flash.material.uniforms.alpha.value = t < 5 ? Math.max(0, Math.sin(t * 9) - 0.3) * 1.3 : 0;
        ps.update(dt);
        return t < 5.7;
      },
      remove() {
        ps.remove();
        light.release();
        scene.remove(flash);
        flash.geometry.dispose();
        flash.material.dispose();
      },
    };
  }

  // A magic circle under a casting agent, in the agent's colour (spec 09 §3.2: exec).
  const castMat = (color) =>
    premul(
      MAGIC +
        `uniform float time, fade, day; uniform vec3 tint; varying vec2 vUv;
         void main() {
           vec2 p = (vUv - 0.5) * 2.0;
           float o = mg_circle(p, time * 2.5, 0.03 * mix(1.0, 1.4, day));
           float halo = smoothstep(1.0, 0.0, length(p)) * 0.18;
           float i = (o * (0.85 + 0.15 * sin(time * 6.0)) + halo) * fade;
           gl_FragColor = vec4(mix(tint, vec3(1.0), o * 0.4) * i * mix(2.4, 1.6, day), clamp(i * mix(0.4, 0.85, day), 0.0, 0.95));
         }`,
      { fade: { value: 0 }, day: { value: night ? 0 : 1 }, tint: { value: color.clone() } },
    );
  const CAST_S = 2.5; // the circle shows this long after each command
  const WARN_SHOW_MS = 8000; // the "？" over an agent after an out-of-scope write
  const CHEER_FRESH_MS = 4000; // a Stop older than this when it arrives gets no fireworks (replays, page loads)
  const FOOT_LIFE = 3.5; // seconds a footprint glows
  const footGeo = new THREE.PlaneGeometry(1, FOOT_ASPECT * 1.3);

  // ---------------------------------------------------------------- agents and building states from live state
  const COLORS = { hero: "#ff9a3c", mage: "#b56cff", priest: "#3fe0c8" };
  // Which clip plays for an action: the pack's sprite named <character>_<verb> when it has one
  // (art batches plug in by name), else the idle clips.
  const VERB = { write: "hammer", read: "read", blocked: "bump", walk: "walk" };
  const clipFor = (character, action) => {
    const name = VERB[action] && `${character}_${VERB[action]}`;
    return name && pack.sprites[name] ? name : undefined;
  };
  // Where each character stands, as an offset in painting pixels from the building's front-bottom
  // point (the PoC's sample spots); a blocked agent stands outside the barrier.
  const SLOT = { hero: [17, 50], mage: [75, -20], priest: [-40, 45] };
  const BLOCKED_SLOT = [-160, 29];

  // A subagent stands beside its main agent's spot, a little in front; several side by side.
  const SUB_SCALE = 0.62;
  const subOffset = (i) => [34 + 24 * i, 14];
  function doorSpot(buildingId, character, action, extra = [0, 0]) {
    const b = buildings.get(buildingId) ?? buildings.get("(root)");
    const [dx, dy] = action === "blocked" ? BLOCKED_SLOT : SLOT[character] ?? [0, 50];
    return groundAt(b.pixel[0] + dx + extra[0], b.pixel[1] + dy + extra[1]) ?? b.pos.clone();
  }
  /** Where agent state `a` stands. An idle subagent waits beside its main agent. */
  function spotOf(a) {
    if (!a.parent) return doorSpot(a.building, a.character, a.action);
    const [ox, oy] = subOffset(a.subIndex ?? 0);
    const main = agents.get(a.parent);
    if ((a.action === "idle" || a.action === "wait") && main) {
      const [px, py] = pixelOf(main.target);
      return groundAt(px + ox, py + oy) ?? main.target.clone();
    }
    return doorSpot(a.building, a.character, a.action, [ox, oy]);
  }

  class Agent {
    constructor(a) {
      this.key = a.key;
      this.character = a.character;
      this.sub = !!a.parent; // a subagent: the main agent's character, smaller (spec 09 §3.1)
      this.h = CHAR_H * (big ? BIG : 1) * (this.sub ? SUB_SCALE : 1);
      this.color = new THREE.Color(COLORS[a.character] ?? "#ffffff");
      this.pos = spotOf(a);
      this.target = this.pos.clone();
      this.path = [];
      this.sprite = new Sprite(this.h);
      this.shadow = footEllipse(this.h * 0.5, glowMat(new THREE.Color(0, 0, 0), 1, false, 0.4));
      // a soft pool of the agent's colour (the user's choice over a bright ring, 2026-10-23)
      this.ring = footEllipse(this.h * 0.75, glowMat(this.color, night ? 1.4 : 1.1, false, night ? 0.75 : 0.65));
      this.light = omni(this.color, night ? 0.8 : 0.3, this.h * 1.2, this.pos, 1);
      this.alert = null;
      this.sparks = null;
      this.facingLeft = false;
      this.tag = makeAgentTag(this.color);
      this.tagAt = this.pos.clone();
      this.circle = footEllipse(this.h * 1.25, castMat(this.color));
      this.circle.visible = false;
      this.stride = 0;
      this.footSide = 1;
      this.fade = 1; // 1 while in town; down to 0 as it leaves
      this.state = a;
      // effects that were already over when the agent appeared do not replay
      this.cheered = a.cheer;
      this.searched = a.search?.at ?? null;
    }
    // Standing about: the plain idle most of the time, now and then another idle clip from the pack
    // (any sprite named <character>_idle_*), each played through once before the next is picked.
    idleClip(dt) {
      const base = `${this.character}_idle`;
      // only clips already loaded (the extras arrive in the background), so a clip starts at once
      const pool = Object.keys(pack.sprites).filter((k) => k.startsWith(base + "_") && loaded.has(k));
      if (!pool.length) return base;
      this.idleLeft = (this.idleLeft ?? 0) - dt;
      if (this.idleLeft <= 0 || !this.idleName) {
        this.idleName = Math.random() < 0.55 ? base : pool[Math.floor(Math.random() * pool.length)];
        const m = pack.sprites[this.idleName];
        const once = m.frames / m.fps;
        this.sprite.t = 0; // start the new clip at its first frame
        // the plain idle runs a few loops; the others once
        this.idleLeft = this.idleName === base ? once * (2 + Math.floor(Math.random() * 3)) : once;
      }
      return this.idleName;
    }
    sync(a) {
      this.state = a;
      const target = spotOf(a);
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
      // Safety net: a walker that makes no progress for a second skips to its next route point.
      if (this.path.length && this.pos.distanceToSquared(before) < 1e-8) {
        this.stuckT = (this.stuckT ?? 0) + dt;
        if (this.stuckT > 1) (this.pos.copy(this.path.shift()), (this.stuckT = 0));
      } else this.stuckT = 0;
      const walking = this.path.length > 0;
      if (walking) {
        // The route points lie on the painted ground about a metre apart, so moving between them
        // keeps the feet down. (Snapping to the depth map here rounded to whole pixels: far from
        // the camera a pixel is longer than a frame's step, and the walker never got anywhere.)
        const [px] = pixelOf(this.pos);
        // face the way it moves on screen; ignore tiny sideways changes (walking toward the camera)
        const [bx] = pixelOf(before);
        const dx = px - bx;
        if (Math.abs(dx) > 0.15 * dt * 60) this.facingLeft = dx < 0;
      }
      if (walking) this.dropPrints(this.pos.distanceTo(before));

      // waiting for the person: dozing, when the character has a dozing clip (bench and sitting come with art)
      const doze = `${this.character}_idle_doze`;
      const clip = walking ? clipFor(this.character, "walk") : clipFor(this.character, this.state.action) ?? (this.state.action === "wait" && loaded.has(doze) ? doze : undefined);
      const name = clip ?? this.idleClip(dt);
      // mirror when the clip faces the other way than the walk (sheet "faces", else known defaults)
      const facesLeft = (pack.sprites[name]?.faces ?? (CLIPS_FACING_LEFT.has(name) ? "left" : "right")) === "left";
      this.sprite.set(name, walking && this.facingLeft !== facesLeft);
      this.sprite.rate = walking ? WALK_RATE : 1;
      this.sprite.mesh.position.copy(this.pos);
      this.sprite.update(dt);
      placeAtFeet(this.ring, this.pos, 0);
      placeAtFeet(this.shadow, this.pos, this.h * 0.06); // the sun is upper left: shadow a little right
      this.light.position.copy(this.pos).add(new THREE.Vector3(0, this.h * 0.3, this.h * 0.4));
      this.updateTag();

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
      // the art draws no sparks (decided 2026-10-24): every hammering clip gets the code's sparks
      const hammering = !walking && !!this.sprite.name?.endsWith("_hammer");
      if (hammering && !this.sparks) this.sparks = new Sparks(new THREE.Color(1, 0.65, 0.2), this.h);
      else if (!hammering && this.sparks) {
        this.sparks.remove();
        this.sparks = null;
      }
      if (this.sparks) {
        this.sparks.origin.copy(this.pos).add(new THREE.Vector3(this.h * 0.05, this.h * 0.28, 0.05));
        this.sparks.update(dt);
      }
      this.updateEvents();
    }
    // Effects tied to the times in the agent's state (townState.js): circle, fireworks, search flashes.
    updateEvents() {
      const { cast, cheer, search } = this.state;
      const nowMs = Date.now();
      const since = cast == null ? Infinity : (nowMs - cast) / 1000;
      const k = this.fade * (since < 0.25 ? since / 0.25 : since < CAST_S ? 1 : since < CAST_S + 0.5 ? 1 - (since - CAST_S) / 0.5 : 0);
      this.circle.visible = k > 0.001 && this.path.length === 0;
      if (this.circle.visible) {
        this.circle.material.uniforms.fade.value = Math.max(0, k);
        placeAtFeet(this.circle, this.pos, 0);
        this.circle.position.y -= this.h * 0.02;
      }
      if (cheer != null && cheer !== this.cheered) {
        this.cheered = cheer;
        if (nowMs - cheer < CHEER_FRESH_MS) effects.add(fireworks(this.pos.clone(), this.color));
      }
      if (search && search.at !== this.searched) {
        this.searched = search.at;
        const e = nowMs - search.at < CHEER_FRESH_MS ? searchFlash(search.buildings) : null;
        if (e) effects.add(e);
      }
      this.tag.zzz.style.display = this.state.action === "wait" && !this.path.length ? "block" : "none";
      const huh = this.state.warnAt != null && nowMs - this.state.warnAt < WARN_SHOW_MS;
      if ((this.tag.huh.style.display === "block") !== huh) this.tag.huh.style.display = huh ? "block" : "none";
    }
    // Glowing footprints in the agent's colour, left and right, fading after a few seconds.
    dropPrints(moved) {
      this.stride += moved;
      if (this.stride < this.h * 0.26) return;
      this.stride = 0;
      this.footSide = -this.footSide;
      const m = new THREE.Mesh(footGeo, glowMat(this.color, night ? 2.2 : 1.6, false, 0.9));
      m.scale.setScalar(this.h * 0.11);
      m.renderOrder = 1;
      placeAtFeet(m, this.pos, this.footSide * this.h * 0.05);
      scene.add(m);
      let t = 0;
      effects.add({
        update(dt) {
          t += dt;
          m.material.uniforms.alpha.value = 0.9 * Math.max(0, 1 - t / FOOT_LIFE) ** 1.5;
          return t < FOOT_LIFE;
        },
        remove() {
          scene.remove(m);
          m.material.dispose();
        },
      });
    }
    // Leaving the town (10 minutes quiet, spec 09 §3.2): everything fades with `f` (1 -> 0).
    setFade(f) {
      this.fade = f;
      this.sprite.mat.opacity = f;
      this.shadow.material.uniforms.alpha.value = 0.4 * f;
      this.ring.material.uniforms.alpha.value = (night ? 0.75 : 0.65) * f;
      this.light.intensity = (night ? 0.8 : 0.3) * Math.PI * f;
      this.tag.el.style.opacity = String(f);
    }
    updateTag() {
      const { name, prompt } = this.state;
      if (this.tag.name.textContent !== (name ?? "")) this.tag.name.textContent = name ?? "";
      this.tag.name.style.display = name ? "block" : "none";
      const say = prompt?.text && Date.now() - prompt.at < BUBBLE_MS ? prompt.text : null;
      if (say !== this.tag.said) {
        this.tag.said = say;
        const chars = [...(say ?? "").replace(/\s+/g, " ").trim()];
        this.tag.bubble.textContent = chars.length > BUBBLE_CHARS ? chars.slice(0, BUBBLE_CHARS).join("") + "…" : chars.join("");
        this.tag.bubble.style.display = say ? "block" : "none";
      }
      this.tagAt.copy(this.pos).y += this.h * 1.02;
    }
    remove() {
      this.tag.remove();
      for (const m of [this.shadow, this.ring, this.light, this.circle]) scene.remove(m);
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
      this.scopes = new Map();
      this.failing = new Map(); // tests failed: black smoke and a small fire until the next run
      this.passShown = new Map(); // building -> the passed run already celebrated
      this.clashShown = new Set();
    }
    // Test and build results (spec 09 §4): failed = black smoke with embers until the next run;
    // passed = a moment of green. The green / white flags come with the art.
    updateTests(tests = {}) {
      const failed = new Set(Object.keys(tests).filter((b) => tests[b].outcome === "failed"));
      this.sync(this.failing, failed, (pos, b) => {
        // a little toward the camera, so the painted roof does not hide it
        const roof = roofOf(b);
        const cloud = smokeCloud([roof], { tint: night ? new THREE.Color(0.3, 0.26, 0.25) : new THREE.Color(0.07, 0.06, 0.06), alpha: night ? 0.85 : 0.8, per: 32, life: 3.5, rise: 4.5, scale: 2.4, drift: 1.4 });
        const embers = new Particles(60, HEAD * 0.07, { gravity: -HEAD * 0.3, drag: 0.5 });
        const ember = new THREE.Color("#ff6a2a").multiplyScalar(night ? 5 : 3);
        // the painting is not lit by scene lights: the small fire is a flickering glow in front of the roof
        const fire = new THREE.Mesh(new THREE.PlaneGeometry(HEAD * 0.9, HEAD * 0.9), glowMat(linear("rgb(255,120,40)"), night ? 2.4 : 1.8, false, 0.9));
        fire.position.copy(roof);
        fire.quaternion.copy(camera.quaternion);
        fire.renderOrder = 3;
        scene.add(fire);
        let acc = 0;
        let t = 0;
        return {
          tick(dt) {
            t += dt;
            acc += dt;
            while (acc > 0.08) {
              acc -= 0.08;
              embers.emit(roof.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.3, 0.3))), rand(-0.2, 0.6), HEAD * rand(0.3, 0.7), 0, ember, rand(0.8, 1.6));
            }
            fire.material.uniforms.alpha.value = 0.55 + 0.35 * Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3));
            cloud.update(dt);
            embers.update(dt);
          },
          remove: () => (cloud.remove(), embers.remove(), scene.remove(fire), fire.geometry.dispose(), fire.material.dispose()),
        };
      });
      for (const [b, r] of Object.entries(tests)) {
        if (r.outcome !== "passed" || this.passShown.get(b) === r.at) continue;
        this.passShown.set(b, r.at);
        const at = buildings.has(b) ? frontOf(buildings.get(b)) : null;
        if (at && r.at != null && Date.now() - r.at < CHEER_FRESH_MS) effects.add(passSparkle(at));
      }
    }
    updateConflicts(list = []) {
      for (const c of list) {
        const k = `${c.building}@${c.at}`;
        if (this.clashShown.has(k)) continue;
        this.clashShown.add(k);
        const at = buildings.has(c.building) ? frontOf(buildings.get(c.building)) : null;
        if (at && Date.now() - c.at < 5000) effects.add(clash(at));
      }
    }
    tick(dt) {
      for (const f of this.failing.values()) f.tick(dt);
    }
    sync(map, want, make) {
      for (const [id, o] of map) if (!want.has(id)) (o.remove(), map.delete(id));
      for (const id of want) if (!map.has(id) && buildings.has(id)) map.set(id, make(buildings.get(id).pos, buildings.get(id)));
    }
    update(blocked, scaffold, lit, scoped) {
      this.sync(this.barriers, blocked, (pos) => {
        const r = 3.76;
        const parts = [groundPlane(r * 2.5, r * 2.5, runesMat(night ? 3 : 1.6), pos)];
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, r * 2.2, 64, 1, true), curtainMat(night ? 2.8 : 2.6, r * 2.2));
        c.position.copy(pos).add(new THREE.Vector3(0, r * 1.1, 0));
        c.renderOrder = 3;
        scene.add(c);
        parts.push(c);
        const l = fxLight(new THREE.Color("rgb(255,70,80)"), r * 1.8, pos.clone().add(new THREE.Vector3(0, r * 0.5, r * 0.6)));
        l.intensity = (night ? 3 : 1.2) * Math.PI;
        return { remove: () => (parts.forEach((p) => scene.remove(p)), l.release()) };
      });
      // the scaffold's level: 1 small (1-2 files), 2 full (3-9), 3 a second storey on top (10 or more)
      for (const [id, o] of this.scaffolds) if (scaffold.get(id) !== o.level) (o.remove(), this.scaffolds.delete(id));
      for (const [id, level] of scaffold) {
        if (this.scaffolds.has(id) || !buildings.has(id)) continue;
        // a step toward the camera: a low scaffold at the house's own point sank into the painted walls
        const pos = frontOf(buildings.get(id));
        const meta = pack.sprites.scaffold;
        const w = 5.47;
        const h = (w * meta.char_h) / (meta.cell[0] - 12);
        const H = (h * meta.cell[1]) / meta.char_h; // the sprite's height in metres
        const parts = [];
        const add = (scale, y) => {
          const s = new Sprite(h * scale);
          s.set("scaffold");
          s.mesh.position.copy(pos).add(new THREE.Vector3(0, y, parts.length * 0.05));
          parts.push(s);
        };
        add(level === 1 ? 0.8 : 1, 0);
        if (level === 3) add(0.85, H * 0.78);
        this.scaffolds.set(id, { level, parts, update: (dt) => parts.forEach((s) => s.update(dt)), remove: () => parts.forEach((s) => s.remove()) });
      }
      this.sync(this.spills, lit, (pos, b) => {
        const r = pos.length() * 0.07;
        const at = groundAt(b.pixel[0], b.pixel[1] + 20) ?? pos.clone().multiplyScalar(0.985); // in front of the door
        const m = groundPlane(r * 2.2, r * 5, spillMat(0.9), at);
        const l = fxLight(new THREE.Color("rgb(255,175,100)"), r * 1.6, at.clone().add(new THREE.Vector3(0, r * 0.4, 0)));
        l.intensity = 2 * Math.PI;
        return { remove: () => (scene.remove(m), l.release()) };
      });
      for (const s of this.scaffolds.values()) s.update(0);
      // the task scope: a pale green ring on the ground (spec 09 §4), calm, no motion
      // An ellipse facing the camera in front of the door, as wide as the house (a flat disc under the
      // house was hidden by the painted walls).
      this.sync(this.scopes, scoped ?? new Set(), (pos, b) => {
        const at = frontOf(b);
        const wPx = b.box ? b.box[2] - b.box[0] : 120;
        const m = footEllipse((wPx * 0.7 * at.length()) / V.focalPx, glowMat(linear("rgb(110,255,150)"), night ? 1.5 : 1.2, true, night ? 0.7 : 0.6));
        m.position.copy(at);
        m.quaternion.copy(camera.quaternion);
        return { remove: () => (scene.remove(m), m.material.dispose()) };
      });
    }
  }

  // ---------------------------------------------------------------- smoke (chimneys; failed tests)
  /**
   * Puffs rising from each of `sources` (world points), drifting right with a light wind.
   * { tint, alpha, per: puffs per source, life: s, rise: m, scale, drift: m } -> { update, remove }.
   */
  function smokeCloud(sources, { tint, alpha = 0.42, per = 18, life: LIFE_S = 5, rise = 4.5, scale: grow = 0.9, drift = 1.6 }) {
    const n = sources.length * per;
    const pos = new Float32Array(n * 3);
    const life = new Float32Array(n); // 0..1 through each puff's rise
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) (life[i] = (i % per) / per), (seed[i] = Math.random());
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("life", new THREE.BufferAttribute(life, 1));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { tint: { value: tint }, scale: { value: 1 }, alpha: { value: alpha } },
      vertexShader: `attribute float life, seed; uniform float scale; varying float vLife, vSeed;
        void main() { vLife = life; vSeed = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = scale * (0.6 + 2.6 * life) / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 tint; uniform float alpha; varying float vLife, vSeed;
        void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0;
          float a = smoothstep(1.0, 0.2, d) * smoothstep(0.0, 0.12, vLife) * (1.0 - vLife) * alpha;
          gl_FragColor = vec4(tint, a); }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
    return {
      update(dt) {
        mat.uniforms.scale.value = size().h * PIXEL_RATIO * grow;
        for (let i = 0; i < n; i++) {
          life[i] += dt / LIFE_S;
          if (life[i] >= 1) (life[i] -= 1), (seed[i] = Math.random());
          const src = sources[Math.floor(i / per)];
          const t = life[i];
          pos[i * 3] = src.x + t * drift + Math.sin(t * 6 + seed[i] * 6.28) * 0.25 * t;
          pos[i * 3 + 1] = src.y + t * rise;
          pos[i * 3 + 2] = src.z + Math.cos(t * 5 + seed[i] * 6.28) * 0.2 * t;
        }
        g.attributes.position.needsUpdate = true;
        g.attributes.life.needsUpdate = true;
      },
      remove() {
        scene.remove(pts);
        g.dispose();
        mat.dispose();
      },
      hide: () => (pts.visible = false),
    };
  }
  // chimney smoke: only where the painting shows a smoking chimney (pack "chimneys": painting pixels)
  const smoke = (() => {
    const sources = ambientOn ? (V.chimneys ?? []).map((p) => groundAt(p[0], p[1])).filter(Boolean) : [];
    if (!sources.length) return null;
    return smokeCloud(sources, { tint: night ? new THREE.Color(0.32, 0.34, 0.42) : new THREE.Color(0.92, 0.9, 0.86) });
  })();

  // Where effects on a building stand: its front-bottom point, a step toward the camera. The point
  // itself lies inside the painted house, which hid anything put there; the painting's ground just
  // below the door can belong to a house in front (docs behind the town hall).
  // So the distance is measured: the median painted depth over the upper middle of the building's
  // box (the house's own front; a house in front covers the lower part), and the point goes just in front of it along the line of sight to the
  // building's point. The relief keeps long triangles along each house's outline, so anything
  // behind the front face is covered; a fixed step forward was right for some houses only.
  const fronts = new Map();
  const frontDists = new Map();
  /** The median painted distance over the upper middle of the building's box: its own front. */
  function frontDistance(b) {
    if (!frontDists.has(b.id)) {
      const ds = [];
      const box = b.box ?? (b.site ? siteBox(b.id) : null);
      if (box) {
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const g = groundAt(box[0] + (box[2] - box[0]) * (0.35 + 0.075 * i), box[1] + (box[3] - box[1]) * (0.2 + 0.08 * j));
            if (g) ds.push(g.length());
          }
        }
      }
      ds.sort((x, y) => x - y);
      frontDists.set(b.id, ds.length ? Math.min(ds[ds.length >> 1], b.pos.length()) : b.pos.length());
    }
    return frontDists.get(b.id);
  }
  function frontOf(b) {
    if (!fronts.has(b.id)) {
      const ds = [];
      const box = b.box ?? (b.site ? siteBox(b.id) : null);
      if (box) {
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const g = groundAt(box[0] + (box[2] - box[0]) * (0.35 + 0.075 * i), box[1] + (box[3] - box[1]) * (0.2 + 0.08 * j));
            if (g) ds.push(g.length());
          }
        }
      }
      ds.sort((x, y) => x - y);
      const d = ds.length ? Math.min(ds[ds.length >> 1], b.pos.length()) : b.pos.length();
      // along the line of sight through the house's base: the building's own pixel across, the
      // bottom of its box down (the building's own point is not always at the base; docs' sits
      // halfway up the house)
      const base = box ? rayAt(b.pixel[0], Math.max(b.pixel[1], box[3] - 10)) : b.pos.clone().normalize();
      fronts.set(b.id, base.multiplyScalar(d - 2.5));
    }
    return fronts.get(b.id).clone();
  }
  /** The unit direction from the camera through painting pixel (px, py). */
  function rayAt(px, py) {
    const [cx, cy] = V.principal;
    return new THREE.Vector3((px + 0.5 - cx) / V.focalPx, -(py + 0.5 - cy) / V.focalPx, -1).applyMatrix4(B).normalize();
  }
  // Up in front of the roof: as high as the building's picking box reaches on screen (the painting's
  // pixel at the top often shows something nearer, so its depth cannot be used), or the site's top.
  function roofOf(b) {
    const f = frontOf(b);
    if (b.site) return f.add(new THREE.Vector3(0, (sites.get(b.id)?.sprite.h ?? 5) * 0.7, 0));
    if (b.box) return f.add(new THREE.Vector3(0, ((b.pixel[1] - b.box[1]) * 0.6 * f.length()) / V.focalPx, 0));
    return f.add(new THREE.Vector3(0, 4, 0));
  }

  // ---------------------------------------------------------------- signs and name tags (page text over the canvas, spec 09 §7)
  const tagLayer = document.createElement("div");
  Object.assign(tagLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  container.appendChild(tagLayer);
  {
    const style = document.createElement("style");
    style.textContent = `
      .town-zzz span { position: absolute; left: 12px; bottom: 0; opacity: 0; animation: town-zzz 1.8s linear infinite; }
      .town-zzz span:nth-child(2) { font-size: 15px; }
      @keyframes town-zzz {
        0% { transform: translate(0, 0); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(16px, -22px); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) { .town-zzz span { animation: none; opacity: 1; position: static; } }`;
    tagLayer.appendChild(style);
  }
  // pixel font (index.html), drawn at its own 12 px so the strokes stay on whole pixels
  const TAG_FONT = "400 12px/1.25 'Fusion Pixel 12', 'Segoe UI', sans-serif";
  // A wooden board on a post in front of each building, with the folder's name; dashed when the
  // building is still a construction site.
  const signs = new Map(); // id -> { el, board, at }
  let selectedId = null;
  function makeSign(id, at, site = false) {
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", left: "0", top: "0", display: "flex", flexDirection: "column", alignItems: "center" });
    const board = document.createElement("div");
    board.textContent = id === "(root)" ? rootName || "(root)" : id;
    Object.assign(board.style, {
      padding: "1px 7px 2px",
      borderRadius: "3px",
      background: "linear-gradient(#7a5332, #5b3b20)",
      border: site ? "1.5px dashed #f3cf7a" : "1.5px solid #2c1a0c",
      boxShadow: "inset 0 1px 0 rgba(255,225,170,0.35), 0 2px 4px rgba(0,0,0,0.45)",
      color: "#fff3d6",
      font: TAG_FONT,
      textShadow: "0 1px 0 #2c1a0c",
      whiteSpace: "nowrap",
    });
    const post = document.createElement("div");
    Object.assign(post.style, { width: "3px", height: "9px", background: "#3d2614", boxShadow: "0 1px 2px rgba(0,0,0,0.5)" });
    // chips over the board: states folded away by the two-effect limit, and the out-of-scope mark
    const chips = document.createElement("div");
    Object.assign(chips.style, { display: "flex", gap: "3px", marginBottom: "2px" });
    el.append(chips, board, post);
    tagLayer.appendChild(el);
    const sign = { el, board, chips, chipKey: "", at: at.clone(), remove: () => el.remove() };
    styleSign(id, sign);
    return sign;
  }
  function styleSign(id, s) {
    const on = id === selectedId;
    s.board.style.outline = on ? "2px solid #ffd75e" : "none";
    s.board.style.outlineOffset = "1px";
    s.el.style.zIndex = on ? "2" : "1";
  }
  const CHIP_COLORS = {
    blocked: "#ff6b6b",
    failed: "#ff8a4c",
    scaffold: "#ffc266",
    warn: "#ffd23f",
    scope: "#86f5a4",
    added: "#7dff9a",
    deleted: "#ff6b6b",
    "role-code": "#ff9f43",
    "role-test": "#3fd8c2",
    "role-doc": "#b39bff",
    "role-config": "#ffd95e",
    "role-asset": "#ff7eb6",
  };
  /** Chips on a building's sign: [{ text, kind, title? }]; redrawn only when they change. */
  function setChips(id, list) {
    const sign = signs.get(id);
    if (!sign) return;
    const key = JSON.stringify(list);
    if (key === sign.chipKey) return;
    sign.chipKey = key;
    sign.chips.replaceChildren(
      ...list.map((c) => {
        const el = document.createElement("div");
        el.textContent = c.text;
        if (c.title) el.title = c.title;
        const color = CHIP_COLORS[c.kind] ?? "#fff";
        Object.assign(el.style, {
          padding: c.big ? "0 5px" : "0 4px",
          borderRadius: "3px",
          background: "rgba(12,14,30,0.85)",
          border: `1.5px solid ${color}`,
          color,
          font: c.big ? "400 18px/1.1 'Fusion Pixel 12', 'Segoe UI', sans-serif" : TAG_FONT,
          whiteSpace: "nowrap",
        });
        return el;
      }),
    );
  }
  function setSelected(id) {
    selectedId = id ?? null;
    for (const [k, s] of signs) styleSign(k, s);
  }
  // The sign hangs on the building's front above head height: standing at the door it covered the
  // characters working there (checked 2026-10-24).
  const SIGN_UP = new THREE.Vector3(0, CHAR_H * (big ? BIG : 1) * 1.05, 0);
  for (const b of V.buildings) signs.set(b.id, makeSign(b.id, v3(b.world).add(SIGN_UP)));

  /** The name tag over an agent's head and the speech bubble with its prompt. */
  function makeAgentTag(color) {
    const css = `#${color.getHexString(THREE.SRGBColorSpace)}`;
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", left: "0", top: "0", display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", zIndex: "3" });
    const bubble = document.createElement("div");
    Object.assign(bubble.style, {
      display: "none",
      maxWidth: "240px",
      padding: "4px 9px",
      borderRadius: "8px",
      background: "rgba(12,14,30,0.92)",
      border: "2px solid #f4f1e6",
      color: "#fff",
      font: TAG_FONT,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    });
    const name = document.createElement("div");
    Object.assign(name.style, {
      padding: "0 6px",
      borderRadius: "4px",
      background: "rgba(12,14,30,0.78)",
      border: `1.5px solid ${css}`,
      color: css,
      font: TAG_FONT,
      whiteSpace: "nowrap",
    });
    // waiting for the person: "z z z" drifting up (spec 09 §3.2)
    const zzz = document.createElement("div");
    zzz.className = "town-zzz";
    for (const [i, c] of ["z", "Z", "z"].entries()) {
      const s = document.createElement("span");
      s.textContent = c;
      s.style.animationDelay = `${i * 0.6}s`;
      zzz.appendChild(s);
    }
    Object.assign(zzz.style, { display: "none", height: "26px", width: "40px", position: "relative", color: "#dfe8ff", font: TAG_FONT, textShadow: "0 1px 0 #10142a, 0 0 4px #10142a" });
    // wrote somewhere that looked out of place: a yellow "？" (spec 09 §3.2)
    const huh = document.createElement("div");
    huh.textContent = "?";
    Object.assign(huh.style, {
      display: "none",
      color: "#ffd23f",
      font: "400 36px/1 'Fusion Pixel 12', 'Segoe UI', sans-serif", // 3x the pixel font: whole pixels
      textShadow: "2px 0 #3a2a00, -2px 0 #3a2a00, 0 2px #3a2a00, 0 -2px #3a2a00, 0 0 8px rgba(255,210,63,0.6)",
    });
    el.append(bubble, zzz, huh, name);
    tagLayer.appendChild(el);
    return { el, bubble, zzz, huh, name, said: null, remove: () => el.remove() };
  }
  const BUBBLE_MS = 6000; // how long a new prompt shows over the agent's head
  const BUBBLE_CHARS = 20; // spec 09 §3.2: the first 20 characters

  // ---------------------------------------------------------------- construction sites (folders the painting lacks)
  // Until the art pipeline delivers the "construction" sprite, the scaffold stands in.
  const SITE_SPRITE = pack.sprites.construction ? "construction" : "scaffold";
  const SITE_W = 5.5; // metres across
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
      scene.remove(o.shadow);
      o.sign.remove();
      signs.delete(id);
      buildings.delete(id);
      fronts.delete(id);
      frontDists.delete(id);
      sites.delete(id);
    }
    for (const [id, { pixel, pos }] of want) {
      if (sites.has(id)) continue;
      const meta = pack.sprites[SITE_SPRITE];
      const sprite = new Sprite((SITE_W * meta.char_h) / (meta.cell[0] - 12));
      sprite.set(SITE_SPRITE);
      sprite.mesh.position.copy(pos);
      // the art has no cast shadow: a soft contact shadow on the ground under it
      const shadow = groundPlane(SITE_W * 1.25, SITE_W * 1.25 * 2.2, glowMat(new THREE.Color(0, 0, 0), 1, false, 0.45), pos);
      const sign = makeSign(id, pos.clone().add(SIGN_UP), true);
      signs.set(id, sign);
      sites.set(id, { sprite, shadow, sign, pos, pixel, lot: list.find((s) => s.id === id).lot, top: pos.clone().add(new THREE.Vector3(0, sprite.h * 0.8, 0)) });
      buildings.set(id, { id, pixel, pos, site: true });
    }
    rebuildGrid();
  }
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
  // Clicks: the painting pixel under a page point (the camera sits at the painting's eye), then the
  // building whose area holds it; where areas overlap, the one standing nearer the camera.
  const ray = new THREE.Vector3();
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ray.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
    const [x, y] = pixelOf(ray);
    let best = null;
    for (const b of buildings.values()) {
      const box = b.site ? siteBox(b.id) : b.box;
      if (!box || x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
      if (!best || b.pixel[1] > best.pixel[1]) best = b;
    }
    if (best) return best.id;
    // between houses: the nearest front door within reach
    let near = null;
    let nd = 60;
    for (const b of buildings.values()) {
      const d = Math.hypot(b.pixel[0] - x, b.pixel[1] - 30 - y);
      if (d < nd) (nd = d), (near = b);
    }
    return near?.id ?? null;
  }
  function siteBox(id) {
    const o = sites.get(id);
    if (!o) return null;
    const top = pixelOf(o.top);
    const half = (o.pixel[1] - top[1]) * 0.75;
    return [o.pixel[0] - half, top[1], o.pixel[0] + half, o.pixel[1] + 10];
  }

  const projected = new THREE.Vector3();
  function placeTags() {
    const { w, h } = size();
    const put = (el, at) => {
      projected.copy(at).project(camera);
      const hidden = projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2;
      el.style.display = hidden ? "none" : "flex";
      if (!hidden) el.style.transform = `translate(${((projected.x + 1) / 2) * w}px, ${((1 - projected.y) / 2) * h}px) translate(-50%, -100%)`;
    };
    for (const s of signs.values()) put(s.el, s.at);
    for (const a of [...agents.values(), ...leaving]) put(a.tag.el, a.tagAt);
  }

  const agents = new Map();
  const leaving = new Set(); // agents fading out of the town
  const fx = new BuildingFx();
  let live = { agents: [], recent: [] };
  function setState(next) {
    live = next ?? { agents: [], recent: [] };
    const seen = new Set();
    // main agents first, so a subagent can stand beside where its main agent is going; siblings
    // numbered for their places side by side
    const siblings = new Map();
    const ordered = live.agents.map((a) => ({ ...a })).sort((x, y) => (x.parent ? 1 : 0) - (y.parent ? 1 : 0));
    for (const a of ordered) {
      if (!a.parent) continue;
      const n = siblings.get(a.parent) ?? 0;
      siblings.set(a.parent, n + 1);
      a.subIndex = n;
    }
    for (const a of ordered) {
      if (a.action === "idle" && !agents.has(a.key)) continue;
      seen.add(a.key);
      if (!agents.has(a.key)) agents.set(a.key, new Agent(a));
      else agents.get(a.key).sync(a);
    }
    for (const [k, ag] of agents) if (!seen.has(k)) (leaving.add(ag), agents.delete(k));

    const at = new Set(live.agents.filter((a) => a.action !== "idle").map((a) => a.building));
    const recent = new Set(live.recent);
    const mode = live.mode ?? "folder";
    const modeInfo = live.modes ?? {};
    setModeTargets(mode, modeInfo);
    // this session: the houses changed in it keep their lights on
    if (mode === "touched") for (const [id, m] of Object.entries(modeInfo)) if (m.touched === "written") recent.add(id);
    V.buildings.forEach((b, i) => (winLevels[i] = at.has(b.id) ? WIN.agent : recent.has(b.id) ? WIN.recent : WIN.rest));
    // What stands on the houses (spec 09 §4): barriers on locked folders (always, spec §4 note 3) and
    // where an agent was just stopped; scaffolds as high as the uncommitted changes go (at least
    // the lowest while an agent writes there); rings on the folders of the declared task scope.
    const houses = live.houses ?? {};
    const tests = live.tests ?? {};
    const stopped = new Set(live.agents.filter((a) => a.action === "blocked").map((a) => a.building));
    const scaffoldAll = new Map(Object.entries(houses).filter(([, h]) => h.level > 0).map(([id, h]) => [id, h.level]));
    for (const a of live.agents) if (a.action === "write" && !scaffoldAll.has(a.building)) scaffoldAll.set(a.building, 1);
    // At most two effects per building, the most important first (spec 09 §4); the rest become
    // chips on its sign. The barrier of a locked folder always shows and does not count.
    const blocked = new Set();
    const scaffold = new Map();
    const scoped = new Set();
    const shownTests = {};
    for (const id of buildings.keys()) {
      const h = houses[id];
      const kinds = [];
      if (stopped.has(id) && !h?.locked) kinds.push("blocked");
      if (tests[id]?.outcome === "failed") kinds.push("failed");
      if (scaffoldAll.has(id)) kinds.push("scaffold");
      if (h?.warn) kinds.push("warn");
      if (h?.scope) kinds.push("scope");
      const { show, folded } = prioritize(kinds);
      if (h?.locked || show.includes("blocked")) blocked.add(id);
      if (show.includes("scaffold")) scaffold.set(id, scaffoldAll.get(id));
      if (show.includes("scope")) scoped.add(id);
      if (tests[id] && (tests[id].outcome !== "failed" || show.includes("failed"))) shownTests[id] = tests[id];
      const L = live.labels ?? {};
      const chips = [];
      // mode marks first: the role (stand-in for the guild flag), the branch's new and deleted files
      const m = modeInfo[id];
      if (mode === "role" && m?.role) chips.push({ kind: `role-${m.role}`, text: L.role?.[m.role] ?? m.role });
      if (mode === "diff" && m?.added) chips.push({ kind: "added", text: L.added?.(m.added) ?? `+${m.added}` });
      if (mode === "diff" && m?.deleted) chips.push({ kind: "deleted", text: L.deleted?.(m.deleted) ?? `-${m.deleted}` });
      // the yellow flag's stand-in until its art arrives: "？" and how many files are unreviewed
      if (show.includes("warn")) chips.push({ kind: "warn", text: `？${h.warn}`, big: true, title: L.warnHint?.(h.warn) });
      for (const k of folded) chips.push({ kind: k, text: k === "warn" ? `${L.warn ?? "?"} ${h.warn}` : (L[k] ?? k), title: k === "warn" ? L.warnHint?.(h.warn) : undefined });
      setChips(id, chips);
    }
    const lit = new Set(windowsOn ? V.buildings.filter((b, i) => winLevels[i] >= SPILL_MIN).map((b) => b.id) : []);
    fx.update(blocked, scaffold, lit, scoped);
    fx.updateTests(shownTests);
    fx.updateConflicts(live.conflicts);
    reliefMat.uniforms.readEnergy.value = live.agents.some((a) => a.action === "read") ? (night ? 2.2 : 1.4) : 0;
  }
  // ---------------------------------------------------------------- map modes (spec 09 §5)
  // Which painted pixels belong to which house: inside each box (grown up over the roof and a
  // little sideways), the pixels at about the house's own distance that stand above its base;
  // where two houses claim one pixel, the nearer wins. The ground behind a house lies much farther,
  // the ground beside it at its base height: both stay out. Built once from the depth map (the
  // pack has no outline mask of its own). A pack's own mask (background.areas) is used instead.
  if (areasTex) reliefMat.uniforms.areaTex.value = areasTex;
  else {
    const data = new Uint8Array(DW * DH);
    const owner = new Float32Array(DW * DH).fill(Infinity);
    const [cx, cy] = V.principal;
    const e = B.elements; // world y of a camera point: row 1 of the basis
    V.buildings.forEach((b, i) => {
      if (!b.box || i >= 32) return;
      const f = frontDistance(buildings.get(b.id));
      const floor = frontOf(buildings.get(b.id)).y + 0.35;
      const lo = f - 5;
      const hi = f + 4 + f * 0.03;
      const [bx0, by0, bx1, by1] = b.box;
      const w = bx1 - bx0;
      const h = by1 - by0;
      const x0 = Math.max(0, Math.floor(bx0 - w * 0.1));
      const x1 = Math.min(DW - 1, Math.ceil(bx1 + w * 0.1));
      const y0 = Math.max(0, Math.floor(by0 - h * 0.7));
      const y1 = Math.min(DH - 1, Math.ceil(by1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = y * DW + x;
          const code = depthPx[k * 4] * 256 + depthPx[k * 4 + 1];
          if (!code) continue;
          const z = V.depthNear + ((code - 1) / 65534) * (V.depthFar - V.depthNear);
          const rx = (x + 0.5 - cx) / V.focalPx;
          const ry = (y + 0.5 - cy) / V.focalPx;
          const d = z * Math.sqrt(rx * rx + ry * ry + 1);
          if (d < lo || d > hi || f >= owner[k]) continue;
          // the ground climbs behind the houses (the town is on a slope): what lies farther than the
          // front must stand higher too
          if (e[1] * rx * z - e[5] * ry * z - e[9] * z < floor + Math.max(0, d - f) * 0.45) continue;
          owner[k] = f;
          data[k] = i + 1;
        }
      }
    });
    const t = new THREE.DataTexture(data, DW, DH, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    reliefMat.uniforms.areaTex.value = t;
  }
  // targets per building for the current mode; the uniforms move toward them over MODE_S
  const MODE_S = 0.6;
  const ROLE_TINT = { code: "#ff9f43", test: "#3fd8c2", doc: "#b39bff", config: "#ffd95e", asset: "#ff7eb6" };
  const modeTarget = { fog: new Array(32).fill(0), sketch: new Array(32).fill(0), tintA: new Array(32).fill(0), groundFog: 0, groundSketch: 0 };
  function setModeTargets(mode, info = {}) {
    const u = reliefMat.uniforms;
    V.buildings.forEach((b, i) => {
      if (i >= 32) return;
      const m = info[b.id] ?? {};
      modeTarget.fog[i] = mode === "touched" && !m.touched ? 1 : 0;
      modeTarget.sketch[i] = mode === "diff" && !(m.added || m.modified || m.deleted) ? 1 : 0;
      modeTarget.tintA[i] = mode === "role" && m.role ? 0.32 : 0;
      if (mode === "role" && m.role) {
        const c = new THREE.Color(ROLE_TINT[m.role] ?? "#ffffff");
        u.areaTint.value[i].set(c.r, c.g, c.b);
      }
    });
    modeTarget.groundFog = mode === "touched" ? 0.8 : 0;
    modeTarget.groundSketch = mode === "diff" ? 0.85 : 0;
  }
  function stepMode(dt) {
    const u = reliefMat.uniforms;
    const k = dt / MODE_S;
    const toward = (v, t) => v + THREE.MathUtils.clamp(t - v, -k, k);
    for (let i = 0; i < 32; i++) {
      u.areaFog.value[i] = toward(u.areaFog.value[i], modeTarget.fog[i]);
      u.areaSketch.value[i] = toward(u.areaSketch.value[i], modeTarget.sketch[i]);
      u.areaTintA.value[i] = toward(u.areaTintA.value[i], modeTarget.tintA[i]);
    }
    u.groundFog.value = toward(u.groundFog.value, modeTarget.groundFog);
    u.groundSketch.value = toward(u.groundSketch.value, modeTarget.groundSketch);
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
    for (const a of leaving) {
      a.update(dt);
      a.setFade(a.fade - dt / 1.5);
      if (a.fade <= 0) (a.remove(), leaving.delete(a));
    }
    for (const e of effects) if (!e.update(dt)) (e.remove(), effects.delete(e));
    fx.tick(dt);
    stepMode(dt);
    flickerLights(time.value);
    smoke?.update(dt);
    for (const o of sites.values()) o.sprite.update(dt);
    pointScale.value = (size().h * PIXEL_RATIO) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    placeTags();
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
  // Warm-up: one frame with a copy of each event effect, so their shaders are built during loading
  // and not when the first effect shows (that stalled the frame for about a second). The copies stay,
  // hidden, which keeps three.js from throwing the built shaders away.
  {
    const at = buildings.get("(root)")?.pos ?? new THREE.Vector3(0, 0, -50);
    const off = new THREE.Color(0, 0, 0);
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), beamMat(off));
    beam.position.copy(at);
    scene.add(beam);
    const ps = new Particles(2, 0.01);
    ps.emit(at, 0, 0, 0, off, 1);
    ps.update(0);
    const circle = footEllipse(0.01, castMat(off));
    circle.position.copy(at);
    const cloud = smokeCloud([at], { tint: off, alpha: 0, per: 1 });
    cloud.update(0);
    composer.render(0);
    beam.visible = ps.points.visible = circle.visible = false;
    cloud.hide();
  }
  let raf = requestAnimationFrame(frame);
  // now the extra idle clips, one at a time so the first seconds stay smooth
  (async () => {
    for (const k of Object.keys(pack.sprites).filter((k) => EXTRA_IDLE.test(k))) await sheet(k).catch(() => {});
  })();

  return {
    setState,
    setSites,
    setSelected,
    pick,
    /** for checks: where each agent stands and what it plays */
    debugAgents: () => [...agents.values(), ...leaving].map((a) => ({ key: a.key, pos: a.pos.toArray(), clip: a.sprite.name, path: a.path.length, fade: a.fade, circle: a.circle.visible && +a.circle.material.uniforms.fade.value.toFixed(2) })),
    debugFx: () => ({ effects: effects.size, failing: [...fx.failing.keys()], lightsUsed: fxLights.filter((l) => !l.free).length, scaffolds: [...fx.scaffolds].map(([id, o]) => [id, o.level, o.parts?.map((s) => [s.name, s.mesh.visible, ...pixelOf(s.mesh.position).map(Math.round)])]) }),
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
      tagLayer.remove();
    },
  };
}
