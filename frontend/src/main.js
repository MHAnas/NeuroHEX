/* ============================================================
   NeuroHEX — main.js
   ============================================================ */
   
import './main.css'
import GUI from 'lil-gui'
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Chart from 'chart.js/auto';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

gsap.registerPlugin(ScrollTrigger);

/* ─── GLOBALS ────────────────────────────────────────────── */
const isMobile = () => window.innerWidth < 768;



/* ═══════════════════════════════════════════════════════════════════════════
   OUTER SHELL — shatter / explode shards
   ═══════════════════════════════════════════════════════════════════════════ */
const outerVertexShader = /* glsl */`
  attribute vec3  aCentroid;
  attribute vec3  aExplodeDir;
  attribute float aPhase;

  uniform float uTime;
  uniform vec3  uMouse;
  uniform float uMouseRadius;
  uniform float uExplosionStrength;
  uniform float uWindStrength;
  uniform float uTurbulenceStrength;
  uniform float uShrinkStart;
  uniform float uShrinkEnd;
  uniform float uSpinMultiplier;

  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vExplode;
  varying float vFresnel;
  varying float vShardDist;   // distance from this shard to mouse, normalised

  vec3 getTurbulence(vec3 p, float t) {
    return vec3(
      sin(p.y * 5.0 + t * 2.0) * cos(p.z * 4.0 + t),
      cos(p.x * 5.0 + t * 1.5) * sin(p.z * 5.0 + t * 2.0),
      sin(p.x * 4.0 + t * 3.0) * cos(p.y * 6.0 + t)
    ) * uTurbulenceStrength;
  }

  void main() {
    vec3 shardWorld = (modelMatrix * vec4(aCentroid, 1.0)).xyz;
    vec2 diff2D     = shardWorld.xy - uMouse.xy;
    float mouseDist = length(diff2D);
    vShardDist      = clamp(mouseDist / uMouseRadius, 0.0, 1.0);

    // Shockwave-style explosion curve
    float localBreak   = 1.0 - smoothstep(uMouseRadius * 0.2, uMouseRadius, mouseDist);
    float threshold    = aPhase * 0.15;
    float shardExplode = smoothstep(threshold, threshold + 0.45, localBreak);
    vExplode = shardExplode;

    float travel = shardExplode * uExplosionStrength;
    float spin   = shardExplode * (1.0 + aPhase * 4.0) * uSpinMultiplier;

    vec3 localPos = position - aCentroid;

    // Shrink shard as it travels away
    float scaleFactor = 1.0 - smoothstep(uShrinkStart, uShrinkEnd, shardExplode);
    localPos *= scaleFactor;

    // Rodrigues rotation around a jittered axis
    vec3 axis = normalize(aExplodeDir + vec3(
      sin(aPhase * 12.3),
      cos(aPhase *  7.4),
      sin(aPhase * 23.1)
    ));
    float cosA = cos(spin), sinA = sin(spin);
    localPos = localPos * cosA
             + cross(axis, localPos) * sinA
             + axis * dot(axis, localPos) * (1.0 - cosA);

    vec3 windDirection = vec3(0.4, 0.6, 0.9);
    vec3 turbulence    = getTurbulence(aCentroid, uTime * 2.5) * shardExplode;

    vec3 displacement = (aExplodeDir * 0.5 + windDirection * uWindStrength) * travel + turbulence;
    vec3 displaced    = aCentroid + localPos + displacement;

    vec4 worldPos4 = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos4.xyz;

    vec3 worldNorm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vNormal = worldNorm;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vFresnel = pow(1.0 - max(dot(worldNorm, viewDir), 0.0), 2.5);

    gl_Position = projectionMatrix * viewMatrix * worldPos4;
  }
`;

const outerFragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uCrackGlowIntensity;
  uniform float uEdgeGlowIntensity;
  uniform float uScanlineOpacity;
  uniform float uAlphaFadeStart;
  uniform float uAlphaFadeEnd;
  uniform vec3  uShardBaseColor;
  uniform vec3  uCrackColor;

  varying vec3  vNormal;
  varying vec3  vWorldPos;
  varying float vExplode;
  varying float vFresnel;
  varying float vShardDist;

  void main() {
    float ao      = 0.6 + 0.4 * max(vNormal.y, 0.0);
    vec3  edgeGlow = uCrackColor * vFresnel * uEdgeGlowIntensity;

    // Crack glow intensifies as shards break away — exposes the glowing seam
    float crackGlow = vFresnel * vExplode * uCrackGlowIntensity;
    vec3  crackCol  = mix(uCrackColor, vec3(1.0, 1.0, 1.0), crackGlow * 0.5);

    float scan = fract(vWorldPos.y * 14.0 + uTime * 0.3);
    scan = smoothstep(0.0, 0.05, scan) * smoothstep(0.18, 0.10, scan) * uScanlineOpacity;

    vec3 col = uShardBaseColor * ao + edgeGlow + crackCol * crackGlow + scan;

    float alpha = 1.0 - smoothstep(uAlphaFadeStart, uAlphaFadeEnd, vExplode);
    alpha = mix(alpha, alpha * 1.4, vFresnel);
    alpha = clamp(alpha, 0.0, 1.0);

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

/* ═══════════════════════════════════════════════════════════════════════════
   INNER BRAIN — emissive metallic with spatial reveal mask
   ═══════════════════════════════════════════════════════════════════════════ */
const innerVertexShader = /* glsl */`
  uniform float uTime;
  uniform float uBreatheSpeed;
  uniform float uBreatheAmplitude;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    float breathe  = sin(uTime * uBreatheSpeed + position.y * 3.0) * uBreatheAmplitude;
    vec3  pos      = position + normal * breathe;
    vec4  worldPos4 = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos4.xyz;
    vNormal   = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vViewDir  = normalize(cameraPosition - vWorldPos);
    gl_Position = projectionMatrix * viewMatrix * worldPos4;
  }
`;

const innerFragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uReveal;
  uniform vec3  uMouse;
  uniform float uMouseRadius;

  // Tunable inner brain params
  uniform float uSpotlightRadius;
  uniform float uSpotlightIntensity;
  uniform float uVeinSpeed;
  uniform float uVeinContrast;
  uniform float uVeinBrightness;
  uniform float uFresnelPower;
  uniform float uMetallicSheen;
  uniform float uPulseSpeed;
  uniform float uPulseDepth;
  uniform vec3  uMetalBase;
  uniform vec3  uMetalSheen;
  uniform vec3  uVeinColorA;
  uniform vec3  uVeinColorB;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    vec3  N     = normalize(vNormal);
    vec3  V     = normalize(vViewDir);
    float NdotV = max(dot(N, V), 0.0);

    // ── Fresnel rim ──
    float fresnel = pow(1.0 - NdotV, uFresnelPower);
    vec3  col     = mix(uMetalBase, uMetalSheen, fresnel);

    // ── 3-light metallic specular ──
    vec3 L0 = normalize(vec3( 0.8,  1.2,  1.0));
    vec3 L1 = normalize(vec3(-1.2,  0.4,  0.6));
    vec3 L2 = normalize(vec3( 0.2, -0.8,  1.4));
    vec3 H0  = normalize(V + L0);
    vec3 H1  = normalize(V + L1);
    vec3 H2  = normalize(V + L2);
    col += vec3(1.00, 1.00, 1.00) * pow(max(dot(N, H0), 0.0), 96.0) * 1.2;
    col += vec3(0.00, 0.88, 1.00) * pow(max(dot(N, H1), 0.0), 96.0) * 0.5;
    col += vec3(0.80, 0.40, 1.00) * pow(max(dot(N, H2), 0.0), 96.0) * 0.5;

    // ── Pulsing core veins ──
    float vein = sin(vWorldPos.x * 8.0 + uTime * uVeinSpeed)
               * cos(vWorldPos.y * 6.0 + uTime * uVeinSpeed * 0.625)
               * sin(vWorldPos.z * 10.0 + uTime * uVeinSpeed * 0.375);
    vein = smoothstep(uVeinContrast, 0.95, vein);
    col += mix(uVeinColorA, uVeinColorB, vein * 0.4) * vein * uVeinBrightness;
    col += uMetalSheen * uMetallicSheen + vec3(0.0, 0.05, 0.10);

    float flop = sin(NdotV * 8.0 + uTime * uPulseSpeed) * 0.5 + 0.5;
    col += mix(vec3(0.0, 0.6, 1.0), vec3(1.0, 0.2, 0.8), flop) * uPulseDepth;

    // ── SPATIAL SPOTLIGHT — torch reveal under the cursor ──
    // Project mouse onto the plane at z=0 (same as model centre)
    vec2  toMouse2D = vWorldPos.xy - uMouse.xy;
    float spotDist  = length(toMouse2D);
    // Inner hot-spot that falls off gracefully
    float spotlight = 1.0 - smoothstep(0.0, uMouseRadius * uSpotlightRadius, spotDist);
    spotlight = pow(max(spotlight, 0.0), 1.4); // sharpen edge

    // Additive glow at cursor position — colour shifts to white-hot at centre
    vec3 hotColor = mix(uMetalSheen * 1.8, vec3(1.0, 1.0, 1.0), spotlight * 0.5);
    col += hotColor * spotlight * uSpotlightIntensity;

    // ── ALPHA — combination of global reveal + local spotlight ──
    // Base alpha fades in globally as reveal progresses
    float baseAlpha = mix(0.88, 1.0, fresnel) * uReveal;
    // Spotlight gives additional alpha so inner brain peeks through even at partial reveal
    float spotAlpha = spotlight * uSpotlightIntensity * 0.7;
    float alpha     = clamp(baseAlpha + spotAlpha, 0.0, 1.0);

    if (alpha < 0.005) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER — split geometry into independent per-triangle shards
   ═══════════════════════════════════════════════════════════════════════════ */
function fragmentGeometry(geo) {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  nonIndexed.computeVertexNormals();

  const pos      = nonIndexed.attributes.position;
  const norm     = nonIndexed.attributes.normal;
  const triCount = Math.floor(pos.count / 3);

  const centroids   = new Float32Array(pos.count * 3);
  const explodeDirs = new Float32Array(pos.count * 3);
  const phases      = new Float32Array(pos.count);

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;

    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;

    const nx = (norm.getX(i0) + norm.getX(i1) + norm.getX(i2)) / 3;
    const ny = (norm.getY(i0) + norm.getY(i1) + norm.getY(i2)) / 3;
    const nz = (norm.getZ(i0) + norm.getZ(i1) + norm.getZ(i2)) / 3;
    const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;

    const phase = Math.random();

    for (let v = 0; v < 3; v++) {
      const vi = t * 3 + v;
      centroids[vi*3]       = cx;
      centroids[vi*3 + 1]   = cy;
      centroids[vi*3 + 2]   = cz;
      explodeDirs[vi*3]     = nx / nl;
      explodeDirs[vi*3 + 1] = ny / nl;
      explodeDirs[vi*3 + 2] = nz / nl;
      phases[vi] = phase;
    }
  }

  nonIndexed.setAttribute('aCentroid',   new THREE.BufferAttribute(centroids,   3));
  nonIndexed.setAttribute('aExplodeDir', new THREE.BufferAttribute(explodeDirs, 3));
  nonIndexed.setAttribute('aPhase',      new THREE.BufferAttribute(phases,      1));

  return nonIndexed;
}

/* ═══════════════════════════════════════════════════════════════════════════
   initBrain()
   ═══════════════════════════════════════════════════════════════════════════ */
export function initBrain() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas) return;

  const mobile = window.innerWidth < 768;

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;

    const scene  = new THREE.Scene();

    function getCanvasSize() {
      const wrap = canvas.parentElement;
      return { w: wrap.clientWidth, h: wrap.clientHeight };
    }

    const { w: initW, h: initH } = getCanvasSize();
    renderer.setSize(initW, initH);
    const camera = new THREE.PerspectiveCamera(45, initW / initH, 0.1, 100);
    camera.position.set(0, 0, 4.5);

    /* ── Mouse ── */
    const mouseNDC      = new THREE.Vector2(-10, -10);
    const mouse3D       = new THREE.Vector3(999, 999, 999);
    const smoothedMouse = new THREE.Vector3(999, 999, 999);
    const raycaster     = new THREE.Raycaster();
    let   mouseOver     = false;

    window.addEventListener('mousemove', e => {
      mouseNDC.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      mouseOver  = true;
    });
    window.addEventListener('mouseleave', () => {
      mouseOver = false;
      mouse3D.set(999, 999, 999);
    });

    function updateMouse3D() {
      raycaster.setFromCamera(mouseNDC, camera);
      const t = -raycaster.ray.origin.z / raycaster.ray.direction.z;
      mouse3D.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, t);
    }
    const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;        // enables smooth inertial movement
controls.dampingFactor = 0.05;        // lower = more inertia (optional, default 0.05)
controls.autoRotate = false;          // we don't want auto-rotate because we removed manual rotation
controls.enableZoom = true;
controls.zoomSpeed = 1.2;
controls.rotateSpeed = 1.0;
controls.enablePan = false;           // optional, keeps the model centered
controls.target.set(0, 0, 0); 

    /* ══════════════════════════════════════════════════════════════════════
       PARAM OBJECT  — single source of truth for GUI + uniforms
       ══════════════════════════════════════════════════════════════════════ */
   const P = {
      /* ── Interaction ── */
      mouseRadius:          mobile ? 0.55 : 1.0,
      mouseLerpSpeed:       10.0,
      mouseHideLerpSpeed:   3.0,

      /* ── Outer Shard Explosion ── */
      explosionStrength:    0.50,
      windStrength:         1.70,
      turbulenceStrength:   0.02,
      spinMultiplier:       3.5,
      shrinkStart:          0.35,
      shrinkEnd:            0.95,

      /* ── Outer Shard Shading ── */
      shardBaseColorHex:    '#ffffff',
      crackColorHex:        '#33e7ff',
      crackGlowIntensity:   2.5,
      edgeGlowIntensity:    0.9,
      scanlineOpacity:      0.12,
      alphaFadeStart:       0.25,
      alphaFadeEnd:         0.90,

      /* ── Inner Brain — Breathe ── */
      breatheSpeed:         1.4,
      breatheAmplitude:     0.008,

      /* ── Inner Brain — Material ── */
      metalBaseHex:         '#0a1924',
      metalSheenHex:        '#00b8e6',
      fresnelPower:         3.2,
      metallicSheen:        0.08,

      /* ── Inner Brain — Veins ── */
      veinSpeed:            0.8,
      veinContrast:         0.3,
      veinBrightness:       0.35,
      veinColorAHex:        '#00ccff',
      veinColorBHex:        '#ffffff',

      /* ── Inner Brain — Pulse ── */
      pulseSpeed:           0.2,
      pulseDepth:           0.06,

      /* ── Inner Brain — Spotlight Reveal ── */
      spotlightRadius:      0.85,
      spotlightIntensity:   1.2,

      /* ── Rotation ── */
      rotationSpeed:        0.05,

      /* ── Reveal ── */
      revealLerpSpeed:      5.0,
    };

    /* ── Helper: hex → THREE.Color → vec3 array ── */
    const hexToVec3 = hex => {
      const c = new THREE.Color(hex);
      return new THREE.Vector3(c.r, c.g, c.b);
    };

    /* ── Uniforms ── */
    const uTime        = { value: 0.0 };
    const uMouse       = { value: smoothedMouse };
    const uMouseRadius = { value: P.mouseRadius };
    const uReveal      = { value: 0.0 };

    /* Outer uniforms */
    const uExplosionStrength  = { value: P.explosionStrength };
    const uWindStrength       = { value: P.windStrength };
    const uTurbulenceStrength = { value: P.turbulenceStrength };
    const uSpinMultiplier     = { value: P.spinMultiplier };
    const uShrinkStart        = { value: P.shrinkStart };
    const uShrinkEnd          = { value: P.shrinkEnd };
    const uCrackGlowIntensity = { value: P.crackGlowIntensity };
    const uEdgeGlowIntensity  = { value: P.edgeGlowIntensity };
    const uScanlineOpacity    = { value: P.scanlineOpacity };
    const uAlphaFadeStart     = { value: P.alphaFadeStart };
    const uAlphaFadeEnd       = { value: P.alphaFadeEnd };
    const uShardBaseColor     = { value: hexToVec3(P.shardBaseColorHex) };
    const uCrackColor         = { value: hexToVec3(P.crackColorHex) };

    /* Inner uniforms */
    const uBreatheSpeed       = { value: P.breatheSpeed };
    const uBreatheAmplitude   = { value: P.breatheAmplitude };
    const uMetalBase          = { value: hexToVec3(P.metalBaseHex) };
    const uMetalSheen         = { value: hexToVec3(P.metalSheenHex) };
    const uFresnelPower       = { value: P.fresnelPower };
    const uMetallicSheen      = { value: P.metallicSheen };
    const uVeinSpeed          = { value: P.veinSpeed };
    const uVeinContrast       = { value: P.veinContrast };
    const uVeinBrightness     = { value: P.veinBrightness };
    const uVeinColorA         = { value: hexToVec3(P.veinColorAHex) };
    const uVeinColorB         = { value: hexToVec3(P.veinColorBHex) };
    const uPulseSpeed         = { value: P.pulseSpeed };
    const uPulseDepth         = { value: P.pulseDepth };
    const uSpotlightRadius    = { value: P.spotlightRadius };
    const uSpotlightIntensity = { value: P.spotlightIntensity };

    /* ── Materials ── */
    const outerMat = new THREE.ShaderMaterial({
      vertexShader:   outerVertexShader,
      fragmentShader: outerFragmentShader,
      transparent:    true,
      depthWrite:     true,
      side:           THREE.FrontSide,
      uniforms: {
        uTime,
        uMouse,
        uMouseRadius,
        uExplosionStrength,
        uWindStrength,
        uTurbulenceStrength,
        uSpinMultiplier,
        uShrinkStart,
        uShrinkEnd,
        uCrackGlowIntensity,
        uEdgeGlowIntensity,
        uScanlineOpacity,
        uAlphaFadeStart,
        uAlphaFadeEnd,
        uShardBaseColor,
        uCrackColor,
      }
    });

    const innerMat = new THREE.ShaderMaterial({
      vertexShader:   innerVertexShader,
      fragmentShader: innerFragmentShader,
      transparent:    true,
      depthWrite:     true,
      side:           THREE.DoubleSide,
      uniforms: {
        uTime,
        uReveal,
        uMouse,
        uMouseRadius,
        uBreatheSpeed,
        uBreatheAmplitude,
        uMetalBase,
        uMetalSheen,
        uFresnelPower,
        uMetallicSheen,
        uVeinSpeed,
        uVeinContrast,
        uVeinBrightness,
        uVeinColorA,
        uVeinColorB,
        uPulseSpeed,
        uPulseDepth,
        uSpotlightRadius,
        uSpotlightIntensity,
      }
    });

    /* ── Load GLB ── */
    const loader = new GLTFLoader();
    loader.load('./models/brain.glb', gltf => {

      const fullBox = new THREE.Box3();
      gltf.scene.traverse(child => {
        if (child.isMesh) {
          child.updateWorldMatrix(true, false);
          fullBox.union(new THREE.Box3().setFromObject(child));
        }
      });

      const centre      = new THREE.Vector3();
      fullBox.getCenter(centre);
      const size        = new THREE.Vector3();
      fullBox.getSize(size);
      const scaleFactor = 3.0 / Math.max(size.x, size.y, size.z);

      const allPos = [], allNorm = [], allIdx = [];
      let offset = 0;

      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        const g = child.geometry.clone();
        g.applyMatrix4(child.matrixWorld);
        if (!g.attributes.normal) g.computeVertexNormals();

        const p = g.attributes.position;
        const n = g.attributes.normal;

        for (let i = 0; i < p.count; i++) {
          allPos.push(
            (p.getX(i) - centre.x) * scaleFactor,
            (p.getY(i) - centre.y) * scaleFactor,
            (p.getZ(i) - centre.z) * scaleFactor,
          );
          allNorm.push(n.getX(i), n.getY(i), n.getZ(i));
        }

        if (g.index) {
          g.index.array.forEach(v => allIdx.push(v + offset));
        } else {
          for (let i = 0; i < p.count; i++) allIdx.push(i + offset);
        }
        offset += p.count;
        g.dispose();
      });

      if (!allPos.length) { console.warn('NeuroHEX: no geometry'); return; }

      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos,  3));
      baseGeo.setAttribute('normal',   new THREE.Float32BufferAttribute(allNorm, 3));
      baseGeo.setIndex(allIdx);

      const shardGeo = fragmentGeometry(baseGeo);
      baseGeo.dispose();

      /* Inner mesh */
      const innerMesh = new THREE.Mesh(shardGeo.clone(), innerMat);
      innerMesh.scale.setScalar(0.90);
      innerMesh.renderOrder = 0;
      scene.add(innerMesh);

      /* Outer shell */
      const outerMesh = new THREE.Mesh(shardGeo, outerMat);
      outerMesh.renderOrder = 1;
      scene.add(outerMesh);

      canvas.classList.add('loaded');


      /* ── Animation loop ── */
      let prevTime  = performance.now();
      let startTime = performance.now();

      function animate(now) {
        requestAnimationFrame(animate);

        const dt      = Math.min((now - prevTime) / 1000, 0.05);
        prevTime      = now;
        const elapsed = (now - startTime) / 1000;

        uTime.value = elapsed;

        if (mouseOver) {
          updateMouse3D();
          smoothedMouse.lerp(mouse3D, dt * P.mouseLerpSpeed);
        } else {
          const targetHide = new THREE.Vector3(999, 999, 999);
          smoothedMouse.lerp(targetHide, dt * P.mouseHideLerpSpeed);
        }

        const targetReveal = mouseOver ? 1.0 : 0.0;
        uReveal.value += (targetReveal - uReveal.value) * dt * P.revealLerpSpeed;

        const rotY    = elapsed * P.rotationSpeed * (Math.PI * 2);
        const breathe = Math.sin(elapsed * 0.7) * 0.003;
        outerMesh.rotation.set(breathe, rotY, 0);
        innerMesh.rotation.set(breathe, rotY, 0);
        
        renderer.render(scene, camera);
        controls.update();
      }

      animate(performance.now());

    }, undefined, err => {
      console.error('NeuroHEX: brain.glb failed', err);
      canvas.style.display = 'none';
      const fb = document.querySelector('.webgl-fallback');
      if (fb) fb.style.display = 'block';
    });

    window.addEventListener('resize', () => {
      const { w, h } = getCanvasSize();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
  } catch (err) {
    console.warn('WebGL init failed, CSS fallback.', err);
    canvas.style.display = 'none';
    const fb = document.querySelector('.webgl-fallback');
    if (fb) fb.style.display = 'block';
  }
}

/* ─── PAGE LOAD SEQUENCE ─────────────────────────────────── */
function initHeroAnimations() {
  const tl = gsap.timeline({ delay: 0.2 });

  // 1. Nav
  tl.to('#nav', {
    y: 0, opacity: 1, duration: 0.7, ease: 'expo.out'
  });

  // 3. Stat callout
  tl.to('.hero-stat-callout', {
    y: 0, opacity: 1, duration: 0.6, ease: 'expo.out'
  }, '-=0.3');


  // 5. Sub
  tl.to('.hero-sub', {
    y: 0, opacity: 1, duration: 0.8, ease: 'power2.out'
  }, '-=0.6');

  // 6. CTAs
  tl.to('.hero-ctas', {
    scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.7)'
  }, '-=0.4');

  // 7. Stats row
  tl.to('.hero-stats', {
    opacity: 1, duration: 0.5
  }, '-=0.2');

  // 8. Animate counters
  const counters = [
    { el: '#stat-regions',  end: 32,   suffix: '' },
    { el: '#stat-cloud',    end: 0,    suffix: '' },
    { el: '#stat-models',   end: 3,    suffix: '' }
  ];

  counters.forEach(({ el, end, suffix }) => {
    const elem = document.querySelector(el);
    if (!elem) return;
    const obj = { val: 0 };
    gsap.to(obj, {
      val: end, duration: 2, delay: 1.2, ease: 'power2.out',
      onUpdate() { elem.textContent = Math.round(obj.val) + suffix; }
    });
  });
}

/* ─── SCROLL ANIMATIONS ──────────────────────────────────── */
function initScrollAnimations() {
  // Feature cards
  gsap.utils.toArray('.feature-card').forEach((card, i) => {
    gsap.to(card, {
      y: 0, opacity: 1, duration: 0.7, ease: 'power3.out',
      scrollTrigger: {
        trigger: card, start: 'top 82%',
        once: true
      },
      delay: (i % 3) * 0.12
    });
  });

  // Pipeline steps — alternating left/right
  gsap.utils.toArray('.pipeline-step').forEach((step, i) => {
    const dir = i % 2 === 0 ? -80 : 80;
    step.style.transform = `translateX(${dir}px)`;
    gsap.to(step, {
      x: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
      scrollTrigger: {
        trigger: step, start: 'top 82%',
        once: true
      },
      delay: i * 0.15
    });
  });

  // Stat cards
  gsap.utils.toArray('.stat-card').forEach((card, i) => {
    gsap.to(card, {
      y: 0, opacity: 1, duration: 0.7, ease: 'power3.out',
      scrollTrigger: {
        trigger: card, start: 'top 82%', once: true
      },
      delay: i * 0.18
    });
  });

  // Persona cards
  gsap.utils.toArray('.persona-card').forEach((card, i) => {
    gsap.to(card, {
      y: 0, opacity: 1, duration: 0.7, ease: 'power3.out',
      scrollTrigger: {
        trigger: card, start: 'top 85%', once: true
      },
      delay: i * 0.14
    });
  });

  // Metrics — count up on scroll
  const metrics = [
    { el: '#metric-regions',  end: 32,  suffix: '' },
    { el: '#metric-models',   end: 5,   suffix: '' },
    { el: '#metric-cloud',    end: 0,   suffix: '' }
  ];

  gsap.utils.toArray('.metric').forEach((el, i) => {
    gsap.to(el, {
      y: 0, opacity: 1, duration: 0.6,
      scrollTrigger: { trigger: el, start: 'top 80%', once: true },
      delay: i * 0.18
    });
  });

  const metricSection = document.querySelector('#metrics');
  if (metricSection) {
    ScrollTrigger.create({
      trigger: metricSection,
      start: 'top 70%',
      once: true,
      onEnter() {
        metrics.forEach(({ el, end, suffix }) => {
          const elem = document.querySelector(el);
          if (!elem) return;
          const obj = { val: 0 };
          gsap.to(obj, {
            val: end, duration: 2.2, ease: 'power2.out',
            onUpdate() { elem.textContent = Math.round(obj.val) + suffix; }
          });
        });
      }
    });
  }

  // Final CTA
  gsap.to('.cta-inner', {
    scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out',
    scrollTrigger: { trigger: '.cta-inner', start: 'top 80%', once: true }
  });

  // Nav shrink on scroll
  ScrollTrigger.create({
    start: 80,
    onUpdate(self) {
      const scrolled = self.progress > 0;
      gsap.to('#nav', {
        padding: scrolled ? '0 clamp(1.5rem,4vw,3rem)' : undefined,
        duration: 0.3,
        ease: 'power2.out'
      });
    }
  });
}

/* ─── HAMBURGER NAV ──────────────────────────────────────── */
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.querySelector('.nav-links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
    const bars = toggle.querySelectorAll('span');
    if (links.classList.contains('open')) {
      bars[0].style.transform = 'translateY(5.5px) rotate(45deg)';
      bars[1].style.opacity   = '0';
      bars[2].style.transform = 'translateY(-5.5px) rotate(-45deg)';
    } else {
      bars.forEach(b => { b.style.transform = ''; b.style.opacity = ''; });
    }
  });

  // Close on link click
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.querySelectorAll('span').forEach(b => { b.style.transform = ''; b.style.opacity = ''; });
    });
  });
}

/* ─── CHART.JS — Before/After comparison chart ───────────── */
function initCharts() {
  const ctx = document.getElementById('comparison-chart');
  if (!ctx) return;

  const rootStyles = getComputedStyle(document.documentElement);
  const cyan  = '#00e5ff';
  const red   = '#ff3355';
  const green = '#39ff6e';

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Speed (inverse)', 'Region coverage', 'AI features', 'Privacy score'],
      datasets: [
        {
          label: 'Manual / Status Quo',
          data: [100, 0, 0, 30],
          backgroundColor: 'rgba(255,51,85,0.25)',
          borderColor: red,
          borderWidth: 1.5,
          borderRadius: 0
        },
        {
          label: 'NeuroHEX',
          data: [2, 100, 100, 100],
          backgroundColor: 'rgba(57,255,110,0.2)',
          borderColor: green,
          borderWidth: 1.5,
          borderRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 1400, easing: 'easeInOutQuart' },
      plugins: {
        legend: {
          display: true,
          labels: {
            font: { family: "'Space Mono', monospace", size: 9 },
            color: '#4a7a8a',
            boxWidth: 10,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: '#04111a',
          titleFont: { family: "'Space Mono', monospace", size: 9 },
          bodyFont: { family: "'Space Mono', monospace", size: 9 },
          borderColor: 'rgba(0,229,255,0.2)',
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              const val = ctx.raw;
              if (ctx.datasetIndex === 0) {
                return ctx.label === 'Analysis Time'
                  ? ` ~45 min (manual)`
                  : ` None`;
              }
              if (ctx.label === 'Analysis Time') return ` ~60 sec (AI)`;
              return ` Included`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            font: { family: "'Space Mono', monospace", size: 8 },
            color: '#4a7a8a'
          },
          grid: { color: 'rgba(0,229,255,0.05)' },
          border: { color: 'rgba(0,229,255,0.1)' }
        },
        y: {
          beginAtZero: true,
          max: 110,
          title: { display: true, text: 'Relative score (0–100)',
      font: { family: "'Space Mono', monospace", size: 8 },
      color: '#4a7a8a' },
    ticks: { display: false },
          grid: { color: 'rgba(0,229,255,0.04)' },
          border: { color: 'rgba(0,229,255,0.08)' }
        }
      }
    }
  });

  // Animate chart in on scroll
  ScrollTrigger.create({
    trigger: '#comparison-chart',
    start: 'top 85%',
    once: true,
    onEnter() {
      if (ctx.chart) ctx.chart.update();
    }
  });
}

/* ─── WORD SPLITTER for H1 ───────────────────────────────── */
function splitHeroWords() {
  const h1 = document.querySelector('.hero-title');
  if (!h1) return;
  // Only split top-level text nodes, preserve child elements
  h1.childNodes.forEach(node => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent.trim();
    if (!text) return;
    const frag = document.createDocumentFragment();
    text.split(/\s+/).forEach((word, i, arr) => {
      if (!word) return;
      const span = document.createElement('span');
      span.className = 'word';
      span.style.cssText = 'opacity:0;transform:translateY(80px);display:inline-block;margin-right:0.22em;';
      span.textContent = word;
      frag.appendChild(span);
      if (i < arr.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    node.replaceWith(frag);
  });
}

/* ─── TICKER ─────────────────────────────────────────────── */
function initTicker() {
  const track = document.querySelector('.ticker-track');
  if (!track) return;
  // Pause first to prevent flash before duplication
  track.style.animationPlayState = 'paused';
  track.innerHTML += track.innerHTML;
  // Resume after duplication
  requestAnimationFrame(() => {
    track.style.animationPlayState = 'running';
  });
}

/* ─── ENTRY POINT ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  splitHeroWords();
  initBrain();
  initHeroAnimations();
  initScrollAnimations();
  initMobileNav();
  initCharts();
  initTicker();
});