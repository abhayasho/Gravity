import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const DEBUG = true;
const log = (...args) => DEBUG && console.log('[Gravity]', ...args);
const time = (label) => DEBUG && console.time('[Gravity] ' + label);
const timeEnd = (label) => DEBUG && console.timeEnd('[Gravity] ' + label);

log('module loaded, Three.js version:', THREE.REVISION);

const EARTH_RADIUS_KM = 6371;
const MOON_DISTANCE_KM = 384400;
const MU_KM = 398600.4418; // km^3/s^2

function getObjectType(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('MOON')) return 'Natural satellite';
  if (n.includes(' DEB') || n.includes('DEBRIS') || n.includes(' DEB ')) return 'Space debris';
  if (n.includes('ISS') || n.includes('TIANHE') || n.includes('CSS') || n.includes('STATION')) return 'Space station';
  if (n.includes('STARLINK') || n.includes('DRAGON') || n.includes('PROGRESS') || n.includes('SOYUZ') || n.includes('SHENZHOU') || n.includes('CYGNUS') || n.includes('HTV')) return 'Satellite / spacecraft';
  return 'Satellite';
}

function orbitPositionFromElements(el, t) {
  const revPerDay = el.meanMotion || el.MEAN_MOTION;
  const inc = (el.inclination ?? el.INCLINATION) * Math.PI / 180;
  const raan = (el.raan ?? el.RA_OF_ASC_NODE) * Math.PI / 180;
  const argPeri = (el.argPerigee ?? el.ARG_OF_PERICENTER) * Math.PI / 180;
  const e = el.eccentricity ?? el.ECCENTRICITY ?? 0;
  let M = (el.meanAnomaly ?? el.MEAN_ANOMALY) * Math.PI / 180;
  const periodSec = 86400 / revPerDay;
  const a_km = Math.pow(MU_KM * (periodSec / (2 * Math.PI)) ** 2, 1 / 3);
  M += (2 * Math.PI * t) / periodSec;
  const E = e < 0.001 ? M : solveKepler(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const x_p = a_km * (cosE - e);
  const y_p = a_km * Math.sqrt(1 - e * e) * sinE;
  const px = x_p * (Math.cos(argPeri) * Math.cos(raan) - Math.sin(argPeri) * Math.sin(raan) * Math.cos(inc))
    - y_p * (Math.sin(argPeri) * Math.cos(raan) + Math.cos(argPeri) * Math.sin(raan) * Math.cos(inc));
  const py = x_p * (Math.cos(argPeri) * Math.sin(raan) + Math.sin(argPeri) * Math.cos(raan) * Math.cos(inc))
    + y_p * (Math.cos(argPeri) * Math.cos(raan) * Math.cos(inc) - Math.sin(argPeri) * Math.sin(raan));
  const pz = x_p * Math.sin(argPeri) * Math.sin(inc) + y_p * Math.cos(argPeri) * Math.sin(inc);
  return { x: px, y: py, z: pz, a: a_km };
}

function solveKepler(M, e, maxIter = 12) {
  let E = M;
  for (let i = 0; i < maxIter; i++) {
    const d = E - e * Math.sin(E) - M;
    if (Math.abs(d) < 1e-10) return E;
    E -= d / (1 - e * Math.cos(E));
  }
  return E;
}

function scaleToScene(radiusKm) {
  const minR = EARTH_RADIUS_KM + 200;
  const maxR = MOON_DISTANCE_KM;
  const r = Math.max(radiusKm, minR);
  const t = (r - minR) / (maxR - minR);
  return 1.05 + 6.45 * Math.pow(t, 0.45);
}

const SEED = 12345;
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOrbit(rng) {
  const alt = 250 + rng() * 3500;
  const a_km = EARTH_RADIUS_KM + alt;
  const periodSec = 2 * Math.PI * Math.sqrt((a_km * a_km * a_km) / MU_KM);
  const meanMotion = 86400 / periodSec;
  const incl = [0.1, 28.5, 51.6, 55, 97.8, 98.2, 99, 120][Math.floor(rng() * 8)] + (rng() - 0.5) * 4;
  return {
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: Math.min(0.001 + rng() * 0.08, 0.99),
    INCLINATION: incl,
    RA_OF_ASC_NODE: rng() * 360,
    ARG_OF_PERICENTER: rng() * 360,
    MEAN_ANOMALY: rng() * 360,
  };
}

const NAME_POOLS = {
  satellite: ['Starlink', 'OneWeb', 'Iridium', 'GPS', 'GOES', 'Sentinel', 'Landsat', 'Terra', 'Aqua', 'ISS (ZARYA)', 'Hubble', 'Tiangong', 'NOAA', 'Meteosat', 'Galileo', 'BeiDou', 'GLONASS', 'Cosmos', 'USA', 'DMSP', 'SBIRS', 'WorldView', 'Planet', 'Spire'],
  debris: ['DEB', 'R/B', 'Debris', 'Frag', 'MLI', 'SRM', 'Payload', 'Fairing', 'Rocket body'],
};
function randomNameAndType(rng) {
  const p = rng();
  if (p < 0.28) {
    const base = NAME_POOLS.satellite[Math.floor(rng() * NAME_POOLS.satellite.length)];
    const id = base === 'Starlink' || base === 'OneWeb' ? Math.floor(1000 + rng() * 5000) : (Math.floor(rng() * 999) + 1);
    return { name: base + '-' + id, type: base.includes('ISS') || base.includes('Tiangong') ? 'Space station' : 'Satellite' };
  }
  if (p < 0.88) {
    const base = NAME_POOLS.debris[Math.floor(rng() * NAME_POOLS.debris.length)];
    const id = Math.floor(rng() * 99999);
    return { name: base + ' ' + id, type: 'Space debris' };
  }
  return { name: 'Rocket body ' + Math.floor(rng() * 9000), type: 'Rocket body' };
}

function buildMoonItem() {
  const moon = {
    meanMotion: 0.0366,
    inclination: 5.15,
    raan: 125.08,
    argPerigee: 318.15,
    meanAnomaly: 135.27,
  };
  const moonPos = (t) => {
    const periodSec = 86400 / moon.meanMotion;
    const a = MOON_DISTANCE_KM;
    const M = (moon.meanAnomaly * Math.PI / 180) + (2 * Math.PI * t) / periodSec;
    const inc = moon.inclination * Math.PI / 180;
    const raan = moon.raan * Math.PI / 180;
    const x = a * Math.cos(M);
    const y = a * Math.sin(M);
    const px = x * Math.cos(raan) - y * Math.cos(inc) * Math.sin(raan);
    const py = x * Math.sin(raan) + y * Math.cos(inc) * Math.cos(raan);
    const pz = y * Math.sin(inc);
    return { x: px, y: py, z: pz, a };
  };
  return { name: 'Moon', type: 'Natural satellite', orbit: moonPos, a: MOON_DISTANCE_KM };
}

const N_SYNTHETIC = 5200;
function loadOrbitalDataSync() {
  time('loadOrbitalDataSync');
  const items = [buildMoonItem()];
  const rng = mulberry32(SEED);

  const named = [
    { OBJECT_NAME: 'ISS (ZARYA)', MEAN_MOTION: 15.48, ECCENTRICITY: 0.00083, INCLINATION: 51.63, RA_OF_ASC_NODE: 132.25, ARG_OF_PERICENTER: 132.43, MEAN_ANOMALY: 227.74 },
    { OBJECT_NAME: 'CSS (TIANHE)', MEAN_MOTION: 15.60, ECCENTRICITY: 0.00057, INCLINATION: 41.47, RA_OF_ASC_NODE: 283.52, ARG_OF_PERICENTER: 192.44, MEAN_ANOMALY: 167.63 },
    { OBJECT_NAME: 'HUBBLE', MEAN_MOTION: 14.58, ECCENTRICITY: 0.00028, INCLINATION: 28.47, RA_OF_ASC_NODE: 80.0, ARG_OF_PERICENTER: 50.0, MEAN_ANOMALY: 100 },
  ];
  named.forEach((o) => {
    const orbit = (t) => orbitPositionFromElements(o, t);
    const a = Math.pow(MU_KM * (86400 / o.MEAN_MOTION / (2 * Math.PI)) ** 2, 1 / 3);
    items.push({ name: o.OBJECT_NAME, type: getObjectType(o.OBJECT_NAME), orbit, a });
  });

  for (let i = 0; i < N_SYNTHETIC; i++) {
    const el = randomOrbit(rng);
    const orbit = (t) => orbitPositionFromElements(el, t);
    const a = Math.pow(MU_KM * (86400 / el.MEAN_MOTION / (2 * Math.PI)) ** 2, 1 / 3);
    const { name, type } = randomNameAndType(rng);
    items.push({ name, type, orbit, a });
  }
  timeEnd('loadOrbitalDataSync');
  log('orbital data: %d objects (Moon + %d named + %d synthetic)', items.length, named.length, N_SYNTHETIC);
  return items;
}

function loadOrbitalData() {
  return loadOrbitalDataSync();
}

function createEarth(scene) {
  time('createEarth');
  const geo = new THREE.IcosahedronGeometry(1, 5);

  const coreRadius = 0.44;
  const coreGeo = new THREE.IcosahedronGeometry(coreRadius, 5);
  const earthCoreMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      glowColor: { value: new THREE.Color(0x8b5a20) },
      innerColor: { value: new THREE.Color(0x4a2810) },
      glowPower: { value: 2.2 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform vec3 innerColor;
      uniform float glowPower;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), glowPower);
        float alpha = 0.4 + 0.45 * fresnel;
        vec3 col = mix(innerColor, glowColor, fresnel);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const earthCore = new THREE.Mesh(coreGeo, earthCoreMat);
  scene.add(earthCore);
  const coreWireGeo = new THREE.WireframeGeometry(coreGeo.clone());
  const coreWire = new THREE.LineSegments(coreWireGeo, new THREE.LineBasicMaterial({
    color: 0x6b4420,
    transparent: true,
    opacity: 0.45,
  }));
  scene.add(coreWire);

  // Hollow, translucent sphere with fresnel rim glow (shader)
  const earthMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      glowColor: { value: new THREE.Color(0xffcc66) },
      innerColor: { value: new THREE.Color(0xe8a030) },
      glowPower: { value: 2.5 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform vec3 innerColor;
      uniform float glowPower;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), glowPower);
        float alpha = 0.05 + 0.32 * fresnel;
        vec3 col = mix(innerColor, glowColor, fresnel);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const earth = new THREE.Mesh(geo, earthMat);
  scene.add(earth);

  // Wireframe so the geometric facets are visible (hollow, made of shapes)
  const wireGeo = new THREE.WireframeGeometry(geo.clone());
  const wireMat = new THREE.LineBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.52,
    linewidth: 1,
  });
  const wireframe = new THREE.LineSegments(wireGeo, wireMat);
  scene.add(wireframe);

  // Shader glow halo layers (soft, not solid)
  const innerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffdd88,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    })
  );
  scene.add(innerGlow);

  const glowGeo = new THREE.SphereGeometry(1.35, 32, 32);
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    color: 0xff9922,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
  }));
  scene.add(glow);

  const outerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff7722,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    })
  );
  scene.add(outerGlow);

  const farGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.95, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xcc5522,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
    })
  );
  scene.add(farGlow);

  timeEnd('createEarth');
  return { earth, earthCore, coreWire, glow, innerGlow, outerGlow, farGlow, wireframe };
}

function createParticles(items, scene) {
  time('createParticles');
  const count = items.length;
  log('createParticles: %d points', count);
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const rand = () => 0.8 + 0.5 * Math.random();
  const isNatural = (item) => (item && item.type) === 'Natural satellite';
  const isMoon = (name) => (name || '').toUpperCase() === 'MOON';
  for (let i = 0; i < count; i++) {
    pos[i * 3] = 0;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = 0;
    sizes[i] = isMoon(items[i].name) ? 0.06 : 0.09 * rand();
    if (isNatural(items[i])) {
      // Natural objects (currently just the Moon) stay white
      colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
    } else {
      // Man-made objects back to warm white/yellow glow
      colors[i * 3] = 1; colors[i * 3 + 1] = 0.96; colors[i * 3 + 2] = 0.82;
    }
  }
  const baseColors = new Float32Array(colors.length);
  baseColors.set(colors);

  const scaleMultiplier = new Float32Array(count);
  const selectedFlag = new Float32Array(count);
  for (let i = 0; i < count; i++) { scaleMultiplier[i] = 1; selectedFlag[i] = 0; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('pointScale', new THREE.BufferAttribute(scaleMultiplier, 1));
  geo.setAttribute('selected', new THREE.BufferAttribute(selectedFlag, 1));
  geo.userData.itemsRef = items;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(255,240,220,0.7)');
  g.addColorStop(1, 'rgba(200,180,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      attribute float pointScale;
      attribute float selected;
      varying vec3 vColor;
      varying float vSelected;
      void main() {
        vColor = color;
        vSelected = selected;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pointScale * (820.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vSelected;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        if (length(uv) > 1.0) discard;
        float a = texture2D(map, gl_PointCoord).a;
        vec3 col;
        if (vSelected > 0.5) {
          col = vColor;
          a = 1.0;
        } else {
          col = vColor + vec3(0.014, 0.01, 0.006);
          a = 0.68 * a;
        }
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  timeEnd('createParticles');
  return { points, items, geo, baseColors, scaleMultiplier };
}

function createMoonMesh(scene, items) {
  const moonIndex = items.findIndex((it) => (it.name || '').toUpperCase() === 'MOON');
  if (moonIndex < 0) return null;
  const radius = 0.14;
  const coreRadius = 0.0425;
  const coreGeo = new THREE.IcosahedronGeometry(coreRadius, 3);
  const moonCoreMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      glowColor: { value: new THREE.Color(0x9090a0) },
      innerColor: { value: new THREE.Color(0x404050) },
      glowPower: { value: 2.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform vec3 innerColor;
      uniform float glowPower;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), glowPower);
        float alpha = 0.45 + 0.4 * fresnel;
        vec3 col = mix(innerColor, glowColor, fresnel);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const moonCore = new THREE.Mesh(coreGeo, moonCoreMat);
  const moonCoreWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(coreGeo.clone()),
    new THREE.LineBasicMaterial({ color: 0x606070, transparent: true, opacity: 0.4 })
  );
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      glowColor: { value: new THREE.Color(0xeeeeff) },
      innerColor: { value: new THREE.Color(0xccd0e0) },
      glowPower: { value: 2.2 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform vec3 innerColor;
      uniform float glowPower;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), glowPower);
        float alpha = 0.06 + 0.35 * fresnel;
        vec3 col = mix(innerColor, glowColor, fresnel);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const wireGeo = new THREE.WireframeGeometry(geo.clone());
  const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
    color: 0xddddff,
    transparent: true,
    opacity: 0.5,
  }));
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.35, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xeeeeff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    })
  );
  const group = new THREE.Group();
  group.add(moonCore);
  group.add(moonCoreWire);
  group.add(mesh);
  group.add(wire);
  group.add(glow);
  group.userData.moonIndex = moonIndex;
  scene.add(group);
  return group;
}

function createOrbitTrails(items, scene) {
  const TRAIL_SAMPLE = 180;
  const SEGMENTS = 48;
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xffdd99,
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < items.length; i += TRAIL_SAMPLE) {
    const item = items[i];
    if ((item.name || '').toUpperCase() === 'MOON') continue;
    const a = item.a;
    const periodSec = 2 * Math.PI * Math.sqrt((a * a * a) / MU_KM);
    const scale = scaleToScene(a);
    const f = scale / a;
    const pts = [];
    for (let s = 0; s <= SEGMENTS; s++) {
      const t = (s / SEGMENTS) * periodSec;
      const pos = item.orbit(t);
      pts.push(new THREE.Vector3(pos.x * f, pos.y * f, pos.z * f));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, material));
  }
  scene.add(group);
  return group;
}

function createOrbitRings(items, scene) {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.08,
  });
  items.forEach((item, i) => {
    if (item.name === 'Moon') return;
    const segments = 64;
    const positions = [];
    for (let s = 0; s <= segments; s++) {
      const t = (s / segments) * (86400 / (item.a ? 0 : 1));
      const pos = item.orbit ? item.orbit(t) : { x: 0, y: 0, z: 0, a: item.a };
      const scale = scaleToScene(pos.a || item.a);
      positions.push(pos.x / EARTH_RADIUS_KM * (scale / (pos.a || item.a) * (pos.a || item.a) / EARTH_RADIUS_KM));
    }
    const scale = scaleToScene(item.a);
    const geo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: segments + 1 }, (_, s) => {
        const t = (s / segments) * 1;
        const pos = item.orbit(t);
        const r = scaleToScene(pos.a || item.a);
        return new THREE.Vector3(
          (pos.x / EARTH_RADIUS_KM) * (r / (pos.a || item.a)) * (pos.a || item.a) / EARTH_RADIUS_KM,
          (pos.y / EARTH_RADIUS_KM) * (r / (pos.a || item.a)) * (pos.a || item.a) / EARTH_RADIUS_KM,
          (pos.z / EARTH_RADIUS_KM) * (r / (pos.a || item.a)) * (pos.a || item.a) / EARTH_RADIUS_KM
        );
      })
    );
    const line = new THREE.Line(geo, material);
    group.add(line);
  });
  scene.add(group);
  return group;
}

(() => {
  log('init start');
  const loadingEl = document.getElementById('loading');
  try {
  time('init total');
  const container = document.getElementById('canvas-container');
  if (!container) log('warn: #canvas-container not found');
  const scene = new THREE.Scene();
  log('scene created');
  scene.background = new THREE.Color(0x050508);
  scene.fog = new THREE.FogExp2(0x050508, 0.016);

  const pointLight = new THREE.PointLight(0xffcc88, 0.45, 20);
  pointLight.position.set(0, 0, 0);
  scene.add(pointLight);
  const ambLight = new THREE.AmbientLight(0x221810, 0.18);
  scene.add(ambLight);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 5.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  log('renderer attached');

  // Sun/planet glow + spark aesthetic: (1) additive blending on particles,
  // (2) soft radial sprites, (3) bloom so bright areas bleed, (4) tone mapping.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomResolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const bloomPass = new UnrealBloomPass(bloomResolution, 0.6, 0.4, 0.52);
  composer.addPass(bloomPass);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2;
  controls.maxDistance = 14;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;

  createEarth(scene);
  const items = loadOrbitalData();
  const { points, geo, baseColors, scaleMultiplier } = createParticles(items, scene);
  const moonMesh = createMoonMesh(scene, items);
  createOrbitTrails(items, scene);

  const tooltip = document.getElementById('tooltip');
  const tooltipName = tooltip.querySelector('.name');
  const tooltipType = tooltip.querySelector('.type');
  const tooltipDetail = tooltip.querySelector('.detail');
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.06 };
  const mouse = new THREE.Vector2();
  const tempVec3 = new THREE.Vector3();
  const tempVec2 = new THREE.Vector2();
  const cameraInverse = new THREE.Matrix4();
  const CLICK_PIXEL_RADIUS_SQ = 10 * 10;
  let selectedIndex = -1;

  function getObjectUnderPoint(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const pointHits = raycaster.intersectObject(points);
    const moonHit = moonMesh ? raycaster.intersectObject(moonMesh, true) : [];
    if (moonHit.length > 0 && (pointHits.length === 0 || moonHit[0].distance < pointHits[0].distance))
      return moonMesh.userData.moonIndex;
    if (pointHits.length > 0) return pointHits[0].index;
    const cursorX = (ndcX * 0.5 + 0.5) * window.innerWidth;
    const cursorY = (-ndcY * 0.5 + 0.5) * window.innerHeight;
    const posAttr = geo.getAttribute('position');
    const arr = posAttr.array;
    cameraInverse.copy(camera.matrixWorld).invert();
    let bestDistSq = Infinity;
    let bestDepth = -Infinity;
    let hit = -1;
    for (let i = 0; i < items.length; i++) {
      tempVec3.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      tempVec3.applyMatrix4(cameraInverse);
      if (tempVec3.z >= 0) continue;
      const depth = tempVec3.z;
      tempVec3.project(camera);
      const sx = (tempVec3.x + 1) * 0.5 * window.innerWidth;
      const sy = (1 - tempVec3.y) * 0.5 * window.innerHeight;
      const dSq = (sx - cursorX) ** 2 + (sy - cursorY) ** 2;
      if (dSq > CLICK_PIXEL_RADIUS_SQ) continue;
      if (dSq < bestDistSq || (dSq <= bestDistSq + 0.5 && depth > bestDepth)) {
        bestDistSq = dSq;
        bestDepth = depth;
        hit = i;
      }
    }
    return hit;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    const idx = getObjectUnderPoint(mouse.x, mouse.y);
    selectedIndex = idx >= 0 ? idx : -1;
    if (idx >= 0) event.stopPropagation();
  }
  container.addEventListener('pointerdown', onPointerDown, true);

  const posAttr = geo.getAttribute('position');
  const colorAttr = geo.getAttribute('color');
  const clock = new THREE.Clock();
  let firstFrame = true;

  function animate() {
    requestAnimationFrame(animate);
    if (firstFrame) {
      log('first frame rendered');
      timeEnd('init total');
      firstFrame = false;
    }
    const t = clock.getElapsedTime();
    const arr = posAttr.array;

    for (let i = 0; i < items.length; i++) {
      const pos = items[i].orbit(t);
      const a = pos.a || items[i].a;
      const scale = scaleToScene(a);
      const f = scale / a;
      arr[i * 3] = pos.x * f;
      arr[i * 3 + 1] = pos.y * f;
      arr[i * 3 + 2] = pos.z * f;
    }
    posAttr.needsUpdate = true;

    if (moonMesh && moonMesh.userData.moonIndex !== undefined) {
      const mi = moonMesh.userData.moonIndex;
      moonMesh.position.set(arr[mi * 3], arr[mi * 3 + 1], arr[mi * 3 + 2]);
    }

    const colorArr = colorAttr.array;
    const scaleAttr = geo.getAttribute('pointScale');
    const scaleArr = scaleAttr ? scaleAttr.array : null;
    const selectedAttr = geo.getAttribute('selected');
    const selectedArr = selectedAttr ? selectedAttr.array : null;
    for (let i = 0; i < items.length; i++) {
      colorArr[i * 3] = baseColors[i * 3];
      colorArr[i * 3 + 1] = baseColors[i * 3 + 1];
      colorArr[i * 3 + 2] = baseColors[i * 3 + 2];
      if (scaleArr) scaleArr[i] = i === selectedIndex ? 2.1 : 1;
      if (selectedArr) selectedArr[i] = i === selectedIndex ? 1 : 0;
    }
    if (selectedIndex >= 0) {
      colorArr[selectedIndex * 3] = 0.1;
      colorArr[selectedIndex * 3 + 1] = 0.32;
      colorArr[selectedIndex * 3 + 2] = 1;
    }
    colorAttr.needsUpdate = true;
    if (scaleAttr) scaleAttr.needsUpdate = true;
    if (selectedAttr) selectedAttr.needsUpdate = true;

    if (selectedIndex >= 0) {
      const obj = items[selectedIndex];
      tooltipName.textContent = obj.name;
      tooltipType.textContent = obj.type;
      tooltipDetail.textContent = obj.type === 'Natural satellite' ? 'Orbiting Earth • Natural satellite' : `Orbiting Earth • Catalogued object`;
      tooltip.classList.add('visible');
      tooltip.style.left = `${window.innerWidth - 336}px`;
      tooltip.style.top = `${window.innerHeight - 120}px`;
    } else {
      tooltip.classList.remove('visible');
    }

    controls.update();
    composer.render();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.passes[1].resolution.set(window.innerWidth, window.innerHeight);
  });

  log('hiding loading overlay, starting animate loop');
  if (loadingEl) loadingEl.classList.add('hidden');
  animate();
  } catch (err) {
    if (loadingEl) loadingEl.classList.add('hidden');
    console.error('[Gravity] init error', err);
    document.body.innerHTML += '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#f88;font-family:sans-serif;text-align:center;z-index:9999;">Failed to load. Check console.<br><small>' + (err && err.message) + '</small></div>';
  }
})();
