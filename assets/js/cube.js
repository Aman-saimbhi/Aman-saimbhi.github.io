/* A six-sided WebGL solid, one face per domain. No library.
 *
 * The domain sections live in index.html as <details> elements; this is an
 * enhancement on top of them. If WebGL is unavailable the canvas removes
 * itself and the list below is the whole experience.
 *
 * The grid is drawn analytically in the fragment shader with fwidth()
 * antialiasing so it stays crisp at any size or angle. Only the labels come
 * from a texture, as an alpha mask, so a theme change needs no repaint.
 */

/* Slot order is load-bearing: these map positionally onto the +X, -X, +Y, -Y,
   +Z, -Z faces built in buildBox(). `idx` is the number shown in the sides list,
   which reads in a different order than the geometry. */
const FACES = [
  { id: 'imaging',     label: 'Medical\nImaging',      idx: '01' },
  { id: 'systems',     label: 'Systems &\nInfra',      idx: '06' },
  { id: 'engineering', label: 'Software\nEngineering', idx: '03' },
  { id: 'ml',          label: 'Machine\nLearning',     idx: '02' },
  { id: 'security',    label: 'Software\nSecurity',    idx: '04' },
  { id: 'safety',      label: 'AI\nSafety',            idx: '05' }
];

/* ---------- tiny math ---------- */
const V = {
  norm: (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0]/l, q[1]/l, q[2]/l, q[3]/l]; },
  mul: (a, b) => [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
  ],
  axis: (x, y, z, r) => { const h = r/2, s = Math.sin(h); return [x*s, y*s, z*s, Math.cos(h)]; },
  slerp: (a, b, t) => {
    let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
    if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
    if (d > 0.9995) return V.norm([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t]);
    const th = Math.acos(d), s = Math.sin(th);
    const wa = Math.sin((1-t)*th)/s, wb = Math.sin(t*th)/s;
    return [a[0]*wa+b[0]*wb, a[1]*wa+b[1]*wb, a[2]*wa+b[2]*wb, a[3]*wa+b[3]*wb];
  },
  mat: (q) => {
    const [x, y, z, w] = q;
    return new Float32Array([
      1-2*(y*y+z*z), 2*(x*y+z*w),   2*(x*z-y*w),   0,
      2*(x*y-z*w),   1-2*(x*x+z*z), 2*(y*z+x*w),   0,
      2*(x*z+y*w),   2*(y*z-x*w),   1-2*(x*x+y*y), 0,
      0, 0, 0, 1
    ]);
  },
  rotVec: (q, v) => {
    const m = V.mat(q);
    return [
      m[0]*v[0] + m[4]*v[1] + m[8]*v[2],
      m[1]*v[0] + m[5]*v[1] + m[9]*v[2],
      m[2]*v[0] + m[6]*v[1] + m[10]*v[2]
    ];
  }
};

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}

const NORMALS = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
const FRONT_Q = [
  V.axis(0, 1, 0, -Math.PI/2),
  V.axis(0, 1, 0,  Math.PI/2),
  V.axis(1, 0, 0,  Math.PI/2),
  V.axis(1, 0, 0, -Math.PI/2),
  [0, 0, 0, 1],
  V.axis(0, 1, 0,  Math.PI)
];

/* ---------- geometry ---------- */
function buildBox() {
  const pos = [], nrm = [], uv = [], fid = [], idx = [];
  /* per-face basis: normal, tangent (u), bitangent (v).
     (t x b) must equal n or the face winds clockwise and gets culled. */
  const B = [
    [[1,0,0],  [0,0,-1], [0,1,0]],
    [[-1,0,0], [0,0,1],  [0,1,0]],
    [[0,1,0],  [1,0,0],  [0,0,-1]],
    [[0,-1,0], [1,0,0],  [0,0,1]],
    [[0,0,1],  [1,0,0],  [0,1,0]],
    [[0,0,-1], [-1,0,0], [0,1,0]]
  ];
  B.forEach(([n, t, b], f) => {
    for (const [su, sv] of [[-1,-1], [1,-1], [1,1], [-1,1]]) {
      pos.push(n[0] + t[0]*su + b[0]*sv, n[1] + t[1]*su + b[1]*sv, n[2] + t[2]*su + b[2]*sv);
      nrm.push(...n);
      uv.push((su + 1) / 2, 1 - (sv + 1) / 2);
      fid.push(f);
    }
    const o = f * 4;
    idx.push(o, o+1, o+2, o, o+2, o+3);
  });
  return {
    pos: new Float32Array(pos), nrm: new Float32Array(nrm),
    uv: new Float32Array(uv), fid: new Float32Array(fid),
    idx: new Uint16Array(idx)
  };
}

/* ---------- label atlas: an alpha mask, nothing else ---------- */
const CELL = 768, COLS = 3, ROWS = 2;

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = CELL * COLS; c.height = CELL * ROWS;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff';

  FACES.forEach((face, i) => {
    const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
    x.save();
    x.translate(ox, oy);

    if ('letterSpacing' in x) x.letterSpacing = '2px';
    x.font = `600 ${Math.round(CELL * 0.052)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    x.textAlign = 'left'; x.textBaseline = 'top';
    x.globalAlpha = 0.5;
    x.fillText(face.idx, CELL * 0.11, CELL * 0.10);
    x.globalAlpha = 1;

    const lines = face.label.toUpperCase().split('\n');
    /* fit to the safe area, the longest label is nearly twice the length of
       the shortest, and a fixed size overflows */
    const MAX_W = CELL * 0.74;
    let size = Math.round(CELL * 0.155);
    if ('letterSpacing' in x) x.letterSpacing = '-1px';
    const setFont = () => { x.font = `800 ${size}px Archivo, Helvetica, Arial, sans-serif`; };
    setFont();
    const widest = Math.max(...lines.map(ln => x.measureText(ln).width));
    if (widest > MAX_W) { size = Math.floor(size * (MAX_W / widest)); setFont(); }

    x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach((ln, k) => {
      x.fillText(ln, CELL / 2, CELL * 0.54 + (k - (lines.length - 1) / 2) * (size * 1.02));
    });

    x.restore();
  });
  return c;
}

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv; in float aFid;
uniform mat4 uProj, uView, uModel;
uniform float uScale;
out vec3 vN; out vec3 vW; out vec3 vLocal; out vec2 vUv; flat out int vFid;
void main(){
  vec3 p = aPos * uScale;
  vec4 wp = uModel * vec4(p, 1.0);
  vN = mat3(uModel) * aNrm;
  vW = wp.xyz;
  vLocal = aPos;
  vUv = aUv;
  vFid = int(aFid);
  gl_Position = uProj * uView * wp;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in vec3 vLocal; in vec2 vUv; flat in int vFid;

uniform sampler2D uAtlas;
uniform float uPulse[6];
uniform float uTime;
uniform vec3 uCubeA, uCubeB, uLabelInk, uBg;
uniform float uAlpha;
uniform float uCamZ;
uniform int uShowLabel;

out vec4 frag;

/* distance to the nearest grid line, measured in pixels, so the line stays one
   pixel wide however close the camera gets */
float grid(vec2 uv, float n, float w){
  vec2 p = uv * n;
  vec2 fw = max(fwidth(p), vec2(1e-5));
  vec2 d = abs(fract(p - 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(0.0, w, min(d.x, d.y));
  /* fade the lines out once a cell approaches pixel size, otherwise they alias
     into shimmer at grazing angles */
  float lod = 1.0 - smoothstep(0.30, 0.85, max(fw.x, fw.y));
  return line * lod;
}

void main(){
  vec3 n = normalize(vN);

  /* gradient runs corner to corner through the volume, fixed to the object, so
     it behaves like a material rather than like lighting */
  float t = clamp((vLocal.x + vLocal.y + vLocal.z) / 6.0 + 0.5, 0.0, 1.0);
  vec3 base = mix(uCubeA, uCubeB, t);

  /* kept shallow on purpose, every multiplicative term below darkens too, and
     they stack into mud fast */
  float lam = max(dot(n, normalize(vec3(-0.35, 0.85, 0.62))), 0.0);
  base *= 0.88 + 0.30 * lam;

  float gMajor = grid(vUv, 6.0,  1.25);
  float gMinor = grid(vUv, 24.0, 1.0);
  /* light lines on a mid-dark body read as a lattice lit from within */
  base = mix(base, base * 1.75 + 0.10, gMajor * 0.42);
  base = mix(base, base * 1.35 + 0.03, gMinor * 0.22);

  /* recess each cell: shade toward one corner and catch light on the other, so
     a cell reads as sunk into the face rather than drawn on top of it */
  vec2 cell = fract(vUv * 6.0);
  float sink = smoothstep(0.0, 0.34, cell.x) * smoothstep(0.0, 0.34, cell.y);
  float lip  = smoothstep(1.0, 0.66, cell.x) * smoothstep(1.0, 0.66, cell.y);
  base *= mix(0.89, 1.0, sink);
  base += 0.045 * (1.0 - lip);

  /* chamfer: a narrow dark band at the face edge with a bright lip just inside
     it reads as a machined bevel */
  vec2 e = min(vUv, 1.0 - vUv);
  float d = min(e.x, e.y);
  base *= mix(0.62, 1.0, smoothstep(0.0, 0.022, d));
  base += vec3(0.16) * (1.0 - smoothstep(0.022, 0.045, d)) * step(0.022, d);

  if (uShowLabel == 1) {
    int col = vFid % 3, row = vFid / 3;
    vec2 uv = (vec2(float(col), float(row)) + vUv) / vec2(3.0, 2.0);
    float lab = texture(uAtlas, uv).a;
    base = mix(base, uLabelInk, lab);
  }

  base += uPulse[vFid] * 0.30;

  vec3 viewDir = normalize(vec3(0.0, 0.0, uCamZ) - vW);
  float facing = dot(n, viewDir);
  float edgeOn = smoothstep(0.0, 0.14, abs(facing));

  /* a specular band that sweeps as the solid turns, so it looks like a material
     catching light rather than a flat-shaded box */
  vec3 key = normalize(vec3(-0.4, 0.85, 0.6));
  vec3 hv = normalize(key + viewDir);
  float spec = pow(max(dot(n, hv), 0.0), 34.0);
  float sweep = 0.5 + 0.5 * sin(dot(vLocal, vec3(1.1, 0.7, 0.9)) * 1.6 + uTime * 0.55);
  base += spec * (0.20 + 0.28 * sweep);

  /* and a lit line right along the silhouette, which is what gives it an edge
     against a near-black page */
  float rim = pow(1.0 - abs(facing), 5.0);
  base += rim * 0.42 * mix(uCubeA, vec3(1.0), 0.45);

  float a = uAlpha * edgeOn;
  frag = vec4(base * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error((type === gl.VERTEX_SHADER ? 'vertex' : 'fragment') + ': ' + gl.getShaderInfoLog(s));
  }
  return s;
}

const hex3 = (h, fallback) => {
  const s = (h || fallback).trim().replace('#', '');
  return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16) / 255);
};

export function mountCube(canvas, onSelect) {
  if (!canvas) return null;
  /* Transparent canvas: composites straight onto the page, so it always agrees
     with the theme and the grain overlay shows through. */
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) { canvas.closest('[data-cube-wrap]')?.remove(); return null; }

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n) || d;
    return {
      a:   hex3(v('--cube-a'), '#4fd8ff'),
      b:   hex3(v('--cube-b'), '#c9f24e'),
      ink: hex3(v('--cube-ink'), '#0a0a0c'),
      bg:  hex3(v('--bg'), '#0a0a0c')
    };
  }
  let theme = readTheme();

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.error('[cube] shader failed, falling back to the list:', err);
    canvas.closest('[data-cube-wrap]')?.remove();
    return null;
  }
  gl.useProgram(prog);

  const g = buildBox();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attrib = (name, data, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  attrib('aPos', g.pos, 3); attrib('aNrm', g.nrm, 3); attrib('aUv', g.uv, 2); attrib('aFid', g.fid, 1);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  function repaintFaces() {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  repaintFaces();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 16);
  /* the first bake can land before Archivo arrives, which silently falls back
     to Helvetica on all six faces */
  document.fonts?.ready.then(repaintFaces);

  const U = n => gl.getUniformLocation(prog, n);
  const uProj = U('uProj'), uView = U('uView'), uModel = U('uModel');
  const uScale = U('uScale'), uAlpha = U('uAlpha'), uShowLabel = U('uShowLabel'), uCamZ = U('uCamZ');
  const uCubeA = U('uCubeA'), uCubeB = U('uCubeB'), uLabelInk = U('uLabelInk'), uBg = U('uBg');
  const uTime = U('uTime');
  const uPulse = Array.from({ length: 6 }, (_, i) => U(`uPulse[${i}]`));

  function pushTheme() {
    gl.useProgram(prog);
    gl.uniform3fv(uCubeA, new Float32Array(theme.a));
    gl.uniform3fv(uCubeB, new Float32Array(theme.b));
    gl.uniform3fv(uLabelInk, new Float32Array(theme.ink));
    gl.uniform3fv(uBg, new Float32Array(theme.bg));
  }
  pushTheme();

  const pulse = new Float32Array(6);
  for (let i = 0; i < 6; i++) gl.uniform1f(uPulse[i], 0);

  /* Convex solid, so back-then-front draw order is enough, no depth buffer
     needed, and the far walls read through the near ones. */
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  /* premultiplied: the only correct way to blend layers into a transparent
     buffer that the browser will then composite over the page */
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const CAM_Z = 6.1, FOV = 0.62;
  gl.uniformMatrix4fv(uView, false,
    new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-CAM_Z,1]));
  gl.uniform1f(uCamZ, CAM_Z);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    theme = readTheme();
    pushTheme();
  });

  /* ---------- state ---------- */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let q = V.mul(V.axis(1, 0, 0, 0.36), V.axis(0, 1, 0, -0.66));
  let vx = 0, vy = 0;
  let dragging = false, moved = 0, lastX = 0, lastY = 0, drift = 0;
  /* how long to hold still after a side has been chosen, before drifting again */
  let hold = 0;
  let snapping = null, snapFrom = null, snapT = 0, lastFront = -1;
  let hoverX = 0, hoverY = 0, tiltX = 0, tiltY = 0;
  let intro = reduced.matches ? 1 : 0, clock = 0;
  let dpr = 1, running = true;

  const HOLD = 2.2;
  const TILT = V.mul(V.axis(1, 0, 0, 0.17), V.axis(0, 1, 0, -0.28));
  const restFor = (i) => V.norm(V.mul(TILT, FRONT_Q[i]));

  /* the small parallax lean lives outside q so it never accumulates */
  const viewQuat = () => {
    /* parallax lean plus a slow bob, applied here rather than folded into q so
       neither can accumulate */
    const bob = reduced.matches ? 0 : Math.sin(drift * 0.55) * 0.055;
    return V.norm(V.mul(V.mul(V.axis(0, 1, 0, tiltX), V.axis(1, 0, 0, tiltY + bob)), q));
  };

  /* the size only changes when the element does; measuring every frame would
     force layout inside the render loop */
  let sizeDirty = true;
  function resize() {
    if (!sizeDirty) return;
    sizeDirty = false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) { sizeDirty = true; return; }
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniformMatrix4fv(uProj, false, perspective(FOV, r.width / r.height, 0.1, 50));
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => { sizeDirty = true; }).observe(canvas);
  addEventListener('resize', () => { sizeDirty = true; }, { passive: true });

  function frontFace(qq) {
    const use = qq || viewQuat();
    let best = 0, bestDot = -2;
    for (let i = 0; i < 6; i++) {
      const n = V.rotVec(use, NORMALS[i]);
      if (n[2] > bestDot) { bestDot = n[2]; best = i; }
    }
    return best;
  }

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((clientY - r.top) / r.height) * 2;
    const t = Math.tan(FOV / 2);
    const d = [nx * t * (r.width / r.height), ny * t, -1];
    const qq = viewQuat();
    const inv = [-qq[0], -qq[1], -qq[2], qq[3]];
    const om = V.rotVec(inv, [0, 0, CAM_Z]);
    const dm = V.rotVec(inv, d);

    let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dm[i]) < 1e-8) {
        if (om[i] < -1 || om[i] > 1) return -1;
        continue;
      }
      const invd = 1 / dm[i];
      let t1 = (-1 - om[i]) * invd, t2 = (1 - om[i]) * invd;
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return axis * 2 + (sign > 0 ? 0 : 1);
  }

  function announce() {
    const f = FACES[frontFace()];
    canvas.setAttribute('aria-label',
      `Six sides. Front side: ${f.label.replace('\n', ' ')}. Use arrow keys to turn, Enter to open.`);
  }

  function beginSnap(target) {
    snapFrom = q;
    snapping = target || restFor(frontFace());
    snapT = 0;
  }

  function draw(dt) {
    resize();

    if (intro < 1) {
      intro = Math.min(1, intro + dt * 1.5);
    }

    if (snapping) {
      snapT = Math.min(1, snapT + dt * (reduced.matches ? 8 : 2.9));
      /* easeOutBack: overshoots the target slightly and settles, which reads as
         weight. slerp extrapolates past 1 perfectly well. */
      const p = snapT - 1;
      const e = 1 + 2.0 * p * p * p + 1.0 * p * p;
      q = V.slerp(snapFrom, snapping, e);
      if (snapT >= 1) { q = snapping; snapping = null; hold = HOLD; }
    } else if (!dragging) {
      const coasting = Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02;
      if (coasting) {
        q = V.mul(V.axis(0, 1, 0, vy * dt), q);
        q = V.mul(V.axis(1, 0, 0, vx * dt), q);
        vx *= 0.92; vy *= 0.92;
      } else if (hold > 0) {
        vx = vy = 0;
        hold -= dt;                    // rest on the chosen side, then carry on
      } else if (!reduced.matches) {
        /* Yaw only. Integrating a second axis lets the orientation random-walk
           into an upside-down label; the vertical movement is a
           non-accumulating bob applied at draw time instead. */
        vx = vy = 0;
        drift += dt;
        q = V.mul(V.axis(0, 1, 0, 0.20 * dt), q);

        /* ease it back upright if a drag left it tipped over */
        const up = V.rotVec(q, [0, 1, 0]);
        const roll = Math.atan2(up[0], up[1]);
        if (Math.abs(roll) > 0.002) q = V.mul(V.axis(0, 0, 1, roll * 0.9 * dt), q);
      }
      q = V.norm(q);
    }

    if (!reduced.matches) {
      tiltX += (hoverX * 0.085 - tiltX) * Math.min(1, dt * 6);
      tiltY += (hoverY * -0.065 - tiltY) * Math.min(1, dt * 6);
    }

    const f = frontFace();
    if (f !== lastFront) { lastFront = f; announce(); }

    let pulsing = false;
    for (let i = 0; i < 6; i++) {
      if (pulse[i] > 0.001) {
        pulse[i] = Math.max(0, pulse[i] - dt * 2.2);
        gl.uniform1f(uPulse[i], pulse[i] * pulse[i]);
        pulsing = true;
      }
    }

    clock += dt;
    gl.uniform1f(uTime, clock);

    const eIntro = 1 - Math.pow(1 - intro, 3);
    gl.uniform1f(uScale, 0.82 + 0.18 * eIntro);
    gl.uniformMatrix4fv(uModel, false, V.mat(viewQuat()));

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);

    // far walls first, seen from the inside
    gl.cullFace(gl.FRONT);
    gl.uniform1f(uAlpha, 0.22 * eIntro);
    gl.uniform1i(uShowLabel, 0);
    gl.drawElements(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_SHORT, 0);

    // then the near walls over them
    gl.cullFace(gl.BACK);
    gl.uniform1f(uAlpha, 0.965 * eIntro);
    gl.uniform1i(uShowLabel, 1);
    gl.drawElements(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_SHORT, 0);

    return pulsing;
  }

  let last = performance.now();
  function loop(t) {
    if (!running) return;
    const dt = Math.min((t - last) / 1000, 0.05); last = t;
    draw(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* pause when off-screen, no point burning a phone battery on a hero the
     visitor has already scrolled past */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
      else running = e.isIntersecting;
    }, { threshold: 0.02 }).observe(canvas);
  }

  /* ---------- pointer ---------- */
  function setHover(e) {
    const r = canvas.getBoundingClientRect();
    hoverX = ((e.clientX - r.left) / r.width) * 2 - 1;
    hoverY = ((e.clientY - r.top) / r.height) * 2 - 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; snapping = null; hold = 0; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    vx = vy = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) { setHover(e); return; }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.0085;
    q = V.norm(V.mul(V.axis(1, 0, 0, dy * k), V.mul(V.axis(0, 1, 0, dx * k), q)));
    vy = dx * k * 8; vx = dy * k * 8;
  });
  canvas.addEventListener('pointerleave', () => { hoverX = 0; hoverY = 0; });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    if (moved < 7) {
      vx = vy = 0;
      const hit = pick(e.clientX, e.clientY);
      const i = hit >= 0 ? hit : frontFace();
      beginSnap(restFor(i));
      if (!reduced.matches) pulse[i] = 1;   // only on a real choice, never on drift
      onSelect?.(FACES[i].id);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* ---------- keyboard ---------- */
  canvas.addEventListener('keydown', (e) => {
    const step = Math.PI / 2;
    let handled = true;
    if (e.key === 'ArrowRight')      q = V.norm(V.mul(V.axis(0, 1, 0,  step), q));
    else if (e.key === 'ArrowLeft')  q = V.norm(V.mul(V.axis(0, 1, 0, -step), q));
    else if (e.key === 'ArrowUp')    q = V.norm(V.mul(V.axis(1, 0, 0, -step), q));
    else if (e.key === 'ArrowDown')  q = V.norm(V.mul(V.axis(1, 0, 0,  step), q));
    else if (e.key === 'Enter' || e.key === ' ') {
      const i = frontFace();
      if (!reduced.matches) pulse[i] = 1;
      onSelect?.(FACES[i].id);
    }
    else handled = false;
    if (handled) { e.preventDefault(); vx = vy = 0; beginSnap(); }
  });

  announce();

  return {
    faces: FACES,
    show(id) {
      const i = FACES.findIndex(f => f.id === id);
      if (i < 0) return;
      vx = vy = 0; beginSnap(restFor(i));
    }
  };
}
