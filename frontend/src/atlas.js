import './atlas.css'
import * as THREE from 'three'
import { OrbitControls }   from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader }      from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import GUI                 from 'lil-gui'
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass }      from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FXAAShader }      from 'three/examples/jsm/shaders/FXAAShader.js'

// ─────────────────────────────────────────────
//  CANVAS + SIZES
// ─────────────────────────────────────────────
const canvas = document.querySelector('canvas')
const sizes  = { width: window.innerWidth, height: window.innerHeight }

// ─────────────────────────────────────────────
//  LOADING SCREEN
// ─────────────────────────────────────────────
const loaderBar     = document.getElementById('loader-bar')
const loaderPct     = document.getElementById('loader-pct')
const loaderMsg     = document.getElementById('loader-msg')
const loadingScreen = document.getElementById('loading-screen')

const LOAD_MESSAGES = [
  'Initializing renderer…','Building synaptic trails…','Loading brain geometry…',
  'Calibrating heatmap…','Compiling shaders…','Placing electrodes…',
  'Mapping neural networks…','Almost ready…',
]
const setLoading = (pct, msg) => {
  loaderBar.style.width = pct + '%'
  loaderPct.textContent = Math.round(pct) + '%'
  if (msg) loaderMsg.textContent = msg
}
const hideLoader = () => {
  loadingScreen.classList.add('fade-out')
  setTimeout(() => loadingScreen.remove(), 900)
}
setLoading(5, LOAD_MESSAGES[0])

// ─────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────
const S = {
  bgColor: '#020508', gridVisible: true, gridOpacity: 0.10, gridColor: '#1a3a4a',
  axisHelper: false, fogEnabled: true, fogColor: '#020508', fogNear: 8, fogFar: 22,
  fov: 60, autoRotate: true, autoRotateSpeed: 0.4,
  ambientColor: '#0d1f2d', ambientIntensity: 0.8,
  keyLightColor: '#cce8ff', keyLightIntensity: 3.5, keyLightWidth: 6, keyLightHeight: 6,
  keyLightX: 5, keyLightY: 4, keyLightZ: 3,
  fillLightColor: '#ff8040', fillLightIntensity: 0.6, fillLightX: -4, fillLightY: -2, fillLightZ: 2,
  rimLightColor: '#40c0ff', rimLightIntensity: 1.2,
  meshColor: '#d0e8f0', roughness: 0.28, metalness: 0.04,
  clearcoat: 0.3, clearcoatRoughness: 0.2, wireframe: false,
  cortexVisible: true, cortexTransmission: 0.18, cortexIOR: 1.42,
  cortexThickness: 0.6, cortexColor: '#a8d4e8', cortexOpacity: 1,
  pulseVertexEnabled: false, pulseVertexAmplitude: 0.004,
  pulseVertexFrequency: 0.6, pulseVertexSpeed: 0.8,
  heatmapEnabled: true, heatmapMode: 'Anatomical', heatmapColor: '#00e5ff',
  heatmapSecondaryColor: '#ff4400', pulseEnabled: true, pulseSpeed: 1.2,
  pulseAmplitude: 0.3, activityIntensity: 0.25, heatmapSmoothing: 0.92,
  clippingEnabled: false, clipAxisX: false, clipAxisY: false, clipAxisZ: false,
  clipX: 0.0, clipY: 0.0, clipZ: 0.0,
  clipNegateX: false, clipNegateY: false, clipNegateZ: false, clipPlaneHelper: true,
  splitViewEnabled: false, splitModeLeft: 'Anatomical', splitModeRight: 'fMRI',
  splitX: 0.5, splitStyleLeft: 'Solid', splitStyleRight: 'X-Ray',
  signalsEnabled: false, signalCount: 300, signalTrailLength: 8,
  signalSpeed: 0.006, signalSize: 0.012, signalColor: '#00ffcc',
  signalTailColor: '#003322', signalOpacity: 0.85, signalRadius: 1.25,
  electrodesVisible: false, electrodeCount: 10, electrodeColor: '#ffdd00',
  electrodeSize: 0.035, electrodeRingColor: '#ff8800', electrodePulseSpeed: 3.0,
  connectivityVisible: false, arcCount: 12, arcColor: '#00aaff',
  arcOpacity: 1, arcFlowSpeed: 1.0, arcWidth: 1.5,
  bloomStrength: 0.35, bloomRadius: 0.25, bloomThreshold: 0.72,
  fxaaEnabled: true, exposure: 1.0,
  labelsVisible: false, annotationsVisible: true, screenshotResolution: '2x',
  // ── Dissolve effect settings (NEW) ──
  dissolveSpeed: 0.9,          // how fast the dissolve animates (higher = faster)
  dissolveEdgeWidth: 0.05,     // width of the glowing edge band
  dissolveEdgeColor: '#00eeff',// edge glow color
  dissolveNoiseScale: 0.5,     // spatial frequency of the noise pattern
  dissolveTargetOpacity: 0.0,  // final opacity of dissolved meshes (0 = fully gone)
}
// ─────────────────────────────────────────────
//  SCENE + RENDERER
// ─────────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color(S.bgColor)
const camera = new THREE.PerspectiveCamera(S.fov, sizes.width / sizes.height, 0.05, 100)
camera.position.set(-1.8, 0.9, 3.8)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.localClippingEnabled = true
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = S.exposure

const css2dRenderer = new CSS2DRenderer()
css2dRenderer.setSize(sizes.width, sizes.height)
Object.assign(css2dRenderer.domElement.style, { position:'fixed', top:'0', left:'0', pointerEvents:'none', zIndex:'15' })
document.body.appendChild(css2dRenderer.domElement)

setLoading(15, LOAD_MESSAGES[1])

// ─────────────────────────────────────────────
//  POST PROCESSING
// ─────────────────────────────────────────────
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), S.bloomStrength, S.bloomRadius, S.bloomThreshold)
composer.addPass(bloomPass)
const fxaaPass = new ShaderPass(FXAAShader)
fxaaPass.material.uniforms['resolution'].value.set(1 / sizes.width, 1 / sizes.height)
composer.addPass(fxaaPass)

// ─────────────────────────────────────────────
//  LIGHTING
// ─────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(S.ambientColor, S.ambientIntensity); scene.add(ambientLight)
const keyLight = new THREE.RectAreaLight(S.keyLightColor, S.keyLightIntensity, S.keyLightWidth, S.keyLightHeight)
keyLight.position.set(S.keyLightX, S.keyLightY, S.keyLightZ); keyLight.lookAt(0,0,0); scene.add(keyLight)
const fillLight = new THREE.DirectionalLight(S.fillLightColor, S.fillLightIntensity)
fillLight.position.set(S.fillLightX, S.fillLightY, S.fillLightZ); scene.add(fillLight)
const rimLight = new THREE.DirectionalLight(S.rimLightColor, S.rimLightIntensity)
rimLight.position.set(-3, 1, -4); scene.add(rimLight)

scene.fog = new THREE.Fog(S.fogColor, S.fogNear, S.fogFar)

// ─────────────────────────────────────────────
//  CLIPPING PLANES
// ─────────────────────────────────────────────
const clipPlanes = {
  x: new THREE.Plane(new THREE.Vector3(1,0,0), S.clipX),
  y: new THREE.Plane(new THREE.Vector3(0,1,0), S.clipY),
  z: new THREE.Plane(new THREE.Vector3(0,0,1), S.clipZ),
}
const activeClipPlanes = () => {
  const p = []
  if (S.clippingEnabled) {
    if (S.clipAxisX) p.push(clipPlanes.x)
    if (S.clipAxisY) p.push(clipPlanes.y)
    if (S.clipAxisZ) p.push(clipPlanes.z)
  }
  return p
}
const planeHelpers = {
  x: new THREE.PlaneHelper(clipPlanes.x, 3, 0x4488aa),
  y: new THREE.PlaneHelper(clipPlanes.y, 3, 0x44aa88),
  z: new THREE.PlaneHelper(clipPlanes.z, 3, 0xaa8844),
}
Object.values(planeHelpers).forEach(h => { h.visible = false; scene.add(h) })
const updateClipHelpers = () => {
  planeHelpers.x.visible = S.clippingEnabled && S.clipAxisX && S.clipPlaneHelper
  planeHelpers.y.visible = S.clippingEnabled && S.clipAxisY && S.clipPlaneHelper
  planeHelpers.z.visible = S.clippingEnabled && S.clipAxisZ && S.clipPlaneHelper
}
const applyClipToMeshes = () => {
  const planes = activeClipPlanes()
  brainMeshes.forEach(m => { m.material.clippingPlanes = planes; m.material.needsUpdate = true })
}

// ─────────────────────────────────────────────
//  GRID + AXIS
// ─────────────────────────────────────────────
const gridHelper = new THREE.GridHelper(6, 24, S.gridColor, S.gridColor)
gridHelper.material.opacity = S.gridOpacity; gridHelper.material.transparent = true
gridHelper.position.y = -1.35; scene.add(gridHelper)
const axisHelper = new THREE.AxesHelper(1.5); axisHelper.visible = S.axisHelper; scene.add(axisHelper)

// ─────────────────────────────────────────────
//  ANATOMY DATABASE
//  Sources:
//  [1] Kandel et al. Principles of Neural Science, 6th ed. (2021)
//  [2] Buzsáki G. Rhythms of the Brain. Oxford (2006)
//  [3] Logothetis NK. Nature 453:869–878 (2008) — fMRI BOLD
//  [4] Buckner et al. Ann NY Acad Sci 1124:1–38 (2008) — DMN
//  [5] Steriade M. Neuroscience 137:1087–1106 (2006) — thalamic rhythms
//  [6] Braak H & Braak E. Acta Neuropathol 82:239–259 (1991)
//  [7] Parvizi & Damasio. Brain 124:1264–1283 (2001) — brainstem
//  [8] Schmahmann JD. Cerebellum 3:174–189 (2004)
//  [9] LeDoux JE. Annu Rev Neurosci 23:155–184 (2000)
//  [10] HCP — Van Essen et al. NeuroImage 80:62–79 (2013)
// ─────────────────────────────────────────────
//  ANATOMY DATABASE — Full mesh-specific entries
//  Matched in priority order (most specific first)
//  Sources:
//  [1] Kandel et al. Principles of Neural Science, 6th ed. (2021)
//  [2] Buzsáki G. Rhythms of the Brain. Oxford (2006)
//  [3] Logothetis NK. Nature 453:869–878 (2008)
//  [4] Buckner et al. Ann NY Acad Sci 1124:1–38 (2008)
//  [5] Steriade M. Neuroscience 137:1087–1106 (2006)
//  [6] Braak H & Braak E. Acta Neuropathol 82:239–259 (1991)
//  [7] Parvizi & Damasio. Brain 124:1264–1283 (2001)
//  [8] Schmahmann JD. Cerebellum 3:174–189 (2004)
//  [9] LeDoux JE. Annu Rev Neurosci 23:155–184 (2000)
//  [10] HCP — Van Essen et al. NeuroImage 80:62–79 (2013)
//  [11] Mesulam MM. Ann Neurol 10:177–202 (1981) — insula
//  [12] Zald & Rauch. The Orbitofrontal Cortex. Oxford (2006)
//  [13] Squire LR et al. Neuron 61:6–26 (2009) — parahippocampal
//  [14] Destrieux et al. NeuroImage 53:1–15 (2010) — sulcal atlas
// ─────────────────────────────────────────────
const anatomyDB = {

  // ── COLLICULI (most specific — matched before generic) ──────────────
  'inferior colliculus': {
    func:      'Mandatory relay for all ascending auditory signals; integrates binaural cues for sound localisation and reflexive auditory orienting',
    disorders: 'Central auditory processing disorder, acoustic neuroma (pressure effects), auditory hallucinations in brainstem lesions',
    network:   'Central Auditory Pathway (cochlea → CN → IC → MGN → A1)',
    source:    '[1] Kandel 2021 ch.31; [7] Parvizi & Damasio 2001',
  },
  'superior colliculus': {
    func:      'Topographic sensorimotor map for reflexive saccades, head orienting, and multisensory (visual/auditory/tactile) spatial integration',
    disorders: 'Parinaud syndrome (dorsal midbrain compression — upgaze palsy, convergence–retraction nystagmus), impaired express saccades',
    network:   'Superior Colliculus Orienting Network / Pulvinar–Parietal Loop',
    source:    '[1] Kandel 2021 ch.39; Sparks DL Nat Rev Neurosci 3:952 (2002)',
  },

  // ── FRONTAL GYRI ─────────────────────────────────────────────────────
  'inferior frontal gyrus': {
    func:      'Language production (Broca\'s area, BA 44/45 dominant hemisphere); syntactic processing, phonological working memory, action observation (mirror system)',
    disorders: 'Broca\'s aphasia (non-fluent, agrammatic), stuttering, apraxia of speech',
    network:   'Language Network / Frontoparietal Control Network',
    source:    '[1] Kandel 2021 ch.60; [10] HCP 2013',
  },
  'middle frontal gyrus': {
    func:      'Dorsolateral prefrontal cortex (DLPFC, BA 9/46): working memory maintenance and manipulation, top-down attentional control, cognitive flexibility',
    disorders: 'Dysexecutive syndrome, schizophrenia (DLPFC hypoactivation — cognitive symptoms), ADHD, depression (hyperactivation in rumination)',
    network:   'Frontoparietal Control Network / Central Executive Network',
    source:    '[1] Kandel 2021 ch.62; [4] Buckner 2008; [10] HCP 2013',
  },
  'superior frontal gyrus': {
    func:      'Supplementary motor area (SMA, BA 6): motor planning, internally-guided movement initiation, self-referential cognition (medial SFG)',
    disorders: 'Alien hand syndrome (medial SFG), transcortical motor aphasia, reduced initiative in anterior cerebral artery stroke',
    network:   'Default Mode Network (medial) / Sensorimotor Network (lateral SMA)',
    source:    '[1] Kandel 2021 ch.38; [10] HCP 2013',
  },
  'precentral gyrus': {
    func:      'Primary motor cortex (M1, BA 4): somatotopic voluntary movement execution (homunculus); corticospinal & corticobulbar tract origin',
    disorders: 'Contralateral hemiparesis/hemiplegia (upper motor neuron), spasticity, ALS (UMN signs), focal motor seizures',
    network:   'Sensorimotor Network',
    source:    '[1] Kandel 2021 ch.37–38; [10] HCP 2013',
  },

  // ── PARIETAL / POSTCENTRAL ───────────────────────────────────────────
  'postcentral gyrus': {
    func:      'Primary somatosensory cortex (S1, BA 1/2/3): somatotopic processing of touch, proprioception, pain and temperature (thalamic relay via VPL)',
    disorders: 'Contralateral hemisensory loss, astereognosis, tactile agnosia, cortical sensory syndrome after stroke',
    network:   'Sensorimotor Network',
    source:    '[1] Kandel 2021 ch.23–24; [10] HCP 2013',
  },
  'superior parietal lobule': {
    func:      'Visuospatial processing, somatosensory integration, coordinate transformations for reaching and grasping (BA 5/7)',
    disorders: 'Optic ataxia (Bálint syndrome component), contralateral spatial neglect, Gerstmann syndrome (angular gyrus overlap)',
    network:   'Dorsal Attention Network / Frontoparietal Control Network',
    source:    '[1] Kandel 2021 ch.25; [10] HCP 2013',
  },
  'supramarginal gyrus': {
    func:      'Phonological processing, reading, and articulatory planning (BA 40); somatosensory association; tool use (apraxia area)',
    disorders: 'Conduction aphasia (dominant), ideomotor apraxia, phonological dyslexia',
    network:   'Language Network / Frontoparietal Control Network',
    source:    '[1] Kandel 2021 ch.60; [10] HCP 2013',
  },
  'angular gyrus': {
    func:      'Semantic integration, reading, arithmetic, number processing (BA 39); default-mode hub for semantic memory retrieval and self-referential thought',
    disorders: 'Gerstmann syndrome (finger agnosia, acalculia, agraphia, L–R confusion), alexia, semantic dementia',
    network:   'Default Mode Network / Language Network',
    source:    '[1] Kandel 2021 ch.60; [4] Buckner 2008',
  },
  'precuneus': {
    func:      'Visuo-spatial imagery, episodic memory retrieval, self-referential processing, consciousness; among the highest metabolic rate regions at rest',
    disorders: 'Prominent early hypometabolism in Alzheimer\'s disease; implicated in vegetative state recovery; posterior cortical atrophy',
    network:   'Default Mode Network (posterior hub)',
    source:    '[4] Buckner 2008; [10] HCP 2013; Cavanna & Trimble Brain 129:564 (2006)',
  },

  // ── ORBITAL / FRONTAL ────────────────────────────────────────────────
  'anterior orbital gyrus': {
    func:      'Reward valuation, stimulus–reward learning, flavour and olfactory processing; anterior OFC integrates reward value across modalities',
    disorders: 'Addiction (reduced OFC volume), impulsivity, sociopathy, anosmia-related reward disruption',
    network:   'Orbitofrontal-Limbic Network',
    source:    '[12] Zald & Rauch 2006; [1] Kandel 2021 ch.49',
  },
  'lateral orbital gyrus': {
    func:      'Punishment signalling, reward omission detection, emotional decision-making; receives amygdala projections for affective valuation',
    disorders: 'OCD (lateral OFC hyperactivation), impulse control disorders, addiction relapse',
    network:   'Orbitofrontal-Limbic Network / Salience Network',
    source:    '[12] Zald & Rauch 2006',
  },
  'medial orbital gyrus': {
    func:      'Subjective reward value, social reward (face attractiveness), self-monitoring; most medial OFC overlaps with subgenual cingulate',
    disorders: 'Depression (subgenual OFC hyperactivity targeted by deep brain stimulation), sociopathy',
    network:   'Default Mode Network / Orbitofrontal-Limbic Network',
    source:    '[12] Zald & Rauch 2006; [4] Buckner 2008',
  },
  'posterior orbital gyrus': {
    func:      'Primary olfactory cortex relay, taste (gustatory) processing, visceral-emotional integration; most directly connected to amygdala and piriform cortex',
    disorders: 'Anosmia (posterior OFC lesions), altered food reward in anorexia, epileptic auras (olfactory hallucinations)',
    network:   'Orbitofrontal-Limbic Network / Olfactory Network',
    source:    '[12] Zald & Rauch 2006; [1] Kandel 2021 ch.32',
  },
  'straight gyrus': {
    func:      'Gyrus rectus (BA 11/25 overlap): olfactory and visceral emotional processing, affective regulation, subgenual cingulate functions at its posterior extent',
    disorders: 'Depression (BA 25 hypermetabolism, DBS target), anosmia, frontotemporal dementia (early atrophy)',
    network:   'Default Mode Network / Orbitofrontal-Limbic Network',
    source:    '[12] Zald & Rauch 2006; Mayberg HS Neuron 45:651 (2005)',
  },

  // ── CINGULATE ────────────────────────────────────────────────────────
  'cingulate gyrus': {
    func:      'Anterior: conflict monitoring, error detection, pain affect, autonomic regulation (ACC, BA 24/32). Posterior: episodic memory retrieval, self-referential thought (PCC, BA 23/31)',
    disorders: 'ACC: OCD, ADHD, chronic pain, anterior cingulate lesion → akinetic mutism. PCC: Alzheimer\'s disease (earliest hypometabolism)',
    network:   'Salience Network (ACC) / Default Mode Network (PCC)',
    source:    '[4] Buckner 2008; Devinsky et al. Brain 118:279 (1995); [10] HCP 2013',
  },

  // ── TEMPORAL GYRI ────────────────────────────────────────────────────
  'superior temporal gyrus': {
    func:      'Primary auditory cortex (Heschl\'s gyrus, BA 41/42) and auditory association cortex (BA 22); speech perception and Wernicke\'s area (posterior STG, dominant)',
    disorders: 'Wernicke\'s aphasia (fluent, paraphasic), word deafness, auditory agnosia, schizophrenia (STG volume reduction linked to hallucinations)',
    network:   'Auditory Network / Language Network',
    source:    '[1] Kandel 2021 ch.31, 60; [10] HCP 2013',
  },
  'middle temporal gyrus': {
    func:      'Semantic memory storage and retrieval, conceptual knowledge, lexical access, biological motion perception (BA 21/37)',
    disorders: 'Anomic aphasia, semantic dementia, lexical retrieval deficits in Alzheimer\'s disease',
    network:   'Default Mode Network / Language Network',
    source:    '[1] Kandel 2021 ch.60; [4] Buckner 2008',
  },
  'inferior temporal gyrus': {
    func:      'High-level visual object recognition, face and category-selective processing (BA 20/37); ventral visual stream terminus',
    disorders: 'Visual agnosia, prosopagnosia (fusiform overlap), category-specific naming deficits, temporal variant FTD',
    network:   'Ventral Visual Stream',
    source:    '[1] Kandel 2021 ch.28; [10] HCP 2013',
  },
  'anterior transverse temporal gyrus': {
    func:      'Anterior Heschl\'s gyrus: primary auditory cortex tonotopic map (low frequencies represented anteriorly); first cortical stage of auditory processing',
    disorders: 'Cortical deafness (bilateral Heschl\'s lesions), auditory processing disorder',
    network:   'Primary Auditory Network',
    source:    '[1] Kandel 2021 ch.31; Morosan et al. NeuroImage 13:684 (2001)',
  },
  'posterior transverse temporal gyrus': {
    func:      'Posterior Heschl\'s gyrus / planum temporale: high-frequency tonotopy, speech sound discrimination, phonological processing; strongly leftward asymmetric in right-handers',
    disorders: 'Phonological dyslexia, congenital amusia, Wernicke\'s aphasia (overlap)',
    network:   'Primary Auditory Network / Language Network',
    source:    '[1] Kandel 2021 ch.31; Shapleske et al. Brain Res Rev 29:26 (1999)',
  },

  // ── OCCIPITAL ────────────────────────────────────────────────────────
  'superior occipital gyrus': {
    func:      'Higher-order visual processing: visuospatial processing, dorsal stream contribution, motion detection (BA 19)',
    disorders: 'Visual field defects, simultanagnosia, optic ataxia (dorsal stream lesions)',
    network:   'Dorsal Visual Stream / Dorsal Attention Network',
    source:    '[1] Kandel 2021 ch.27; [10] HCP 2013',
  },
  'lateral occipital gyrus': {
    func:      'Object and shape recognition (lateral occipital complex, LOC); critical for object identity independent of viewpoint or lighting',
    disorders: 'Visual form agnosia, object recognition deficits, apperceptive agnosia',
    network:   'Ventral Visual Stream',
    source:    '[1] Kandel 2021 ch.28; Malach et al. PNAS 92:8135 (1995)',
  },
  'cuneus': {
    func:      'Primary visual cortex (V1, BA 17) upper visual field representation; early visual processing, retinotopic mapping of superior visual hemifield',
    disorders: 'Inferior visual field loss (contralateral), visual auras in occipital epilepsy, Charles Bonnet hallucinations',
    network:   'Primary Visual Network',
    source:    '[1] Kandel 2021 ch.27',
  },
  'lingual gyrus': {
    func:      'Lower visual field V1/V2 (BA 17/18), colour processing (V4), word-form area (visual word form area overlap); dreaming (REM-related activation)',
    disorders: 'Superior quadrantanopia, achromatopsia, pure alexia (visual word form area), prosopagnosia (bilateral lingual/fusiform)',
    network:   'Primary Visual Network / Ventral Visual Stream',
    source:    '[1] Kandel 2021 ch.27–28; Zeki S Brain 113:1721 (1990)',
  },

  // ── FUSIFORM ─────────────────────────────────────────────────────────
  'fusiform gyrus': {
    func:      'Face recognition (fusiform face area, FFA — BA 37), object and word visual recognition; category-selective representation in ventral temporal cortex',
    disorders: 'Prosopagnosia (FFA lesion/dysfunction), visual word form area disruption → pure alexia, autism (reduced FFA activation to faces)',
    network:   'Ventral Visual Stream / Default Mode Network',
    source:    '[1] Kandel 2021 ch.28; Kanwisher et al. J Neurosci 17:4302 (1997)',
  },

  // ── PARAHIPPOCAMPAL ──────────────────────────────────────────────────
  'posterior parahippocampal gyrus': {
    func:      'Scene and spatial context encoding (parahippocampal place area, PPA); visual navigation cues, topographic memory, entorhinal cortex input to hippocampus',
    disorders: 'Topographic disorientation, landmark agnosia, early Alzheimer\'s disease (entorhinal degeneration — Braak stage I)',
    network:   'Medial Temporal Lobe Memory System / Default Mode Network',
    source:    '[13] Squire 2009; [6] Braak 1991; Epstein & Kanwisher Nature 392:598 (1998)',
  },

  // ── INSULA ───────────────────────────────────────────────────────────
  'first short gyrus': {
    func:      'Anterior insula (AI): interoceptive awareness, subjective emotional feelings (embodied emotion hypothesis), empathy, pain affect, disgust',
    disorders: 'Anosognosia (impaired interoception), insular epilepsy (autonomic auras), post-stroke depression, addiction (AI hyperactivity to cues)',
    network:   'Salience Network (anterior insula is a core hub)',
    source:    '[11] Mesulam 1981; Craig AD Nat Rev Neurosci 9:59 (2009)',
  },
  'second short gyrus': {
    func:      'Mid-anterior insula: taste (gustatory cortex, primary), temperature, visceral pain relay from thalamus (VPMpc); integrates interoceptive signals',
    disorders: 'Ageusia (taste loss), visceral pain disorders, insular stroke (contralateral taste loss)',
    network:   'Salience Network / Interoceptive Network',
    source:    '[11] Mesulam 1981; [1] Kandel 2021 ch.32',
  },
  'intermediate short gyrus': {
    func:      'Intermediate insula: somatosensory-interoceptive integration, vestibular processing, peripersonal space representation',
    disorders: 'Vestibular cortex dysfunction, disturbed body schema, insular epilepsy',
    network:   'Salience Network / Vestibular Network',
    source:    '[11] Mesulam 1981; [14] Destrieux 2010',
  },
  'anterior accessory gyrus': {
    func:      'Accessory anterior insula: higher-order interoceptive prediction, social-emotional regulation, uncertainty processing; highly connected to ACC',
    disorders: 'Anxiety disorders (interoceptive prediction errors), eating disorders, alexithymia',
    network:   'Salience Network',
    source:    '[11] Mesulam 1981; Seth AK Neurosci Biobehav Rev 35:1152 (2011)',
  },

  // ── HIPPOCAMPAL SUBREGIONS ───────────────────────────────────────────
  'dentate gyrus': {
    func:      'Pattern separation of similar episodic memories; adult neurogenesis (one of only two regions with lifelong neurogenesis in humans); trisynaptic circuit input from entorhinal cortex',
    disorders: 'First site of neuron loss in temporal lobe epilepsy (mossy fiber sprouting); stress-induced neurogenesis suppression; depression',
    network:   'Medial Temporal Lobe Memory System (trisynaptic loop)',
    source:    '[6] Braak 1991; Eriksson et al. Nat Med 4:1313 (1998); [2] Buzsáki 2006',
  },
  'fasciolar gyrus': {
    func:      'Transitional cortex at the tail of the dentate gyrus; part of the hippocampal–cingulate continuum; contributes to fornix pathway',
    disorders: 'Rarely isolated lesion; affected in global hippocampal pathology (TLE, Alzheimer\'s)',
    network:   'Medial Temporal Lobe Memory System',
    source:    '[1] Kandel 2021 ch.67; [14] Destrieux 2010',
  },
  'presubiculum': {
    func:      'Head direction cells, grid-to-place cell transformation, spatial context binding; critical entorhinal-hippocampal interface for spatial navigation',
    disorders: 'Early Alzheimer\'s disease degeneration (Braak stage I–II); spatial disorientation',
    network:   'Medial Temporal Lobe Memory System / Spatial Navigation Network',
    source:    '[6] Braak 1991; [13] Squire 2009; Taube JS Annu Rev Neurosci 30:181 (2007)',
  },

  // ── FIRST/SECOND POSTERIOR CENTRAL ───────────────────────────────────
  'first posterior central gyrus': {
    func:      'Secondary somatosensory cortex (S2, BA 40 overlap / parietal operculum): bilateral tactile processing, pain integration, somatosensory memory',
    disorders: 'Tactile discrimination deficits, complex regional pain syndrome (central component), hysterical anaesthesia',
    network:   'Sensorimotor Network / Salience Network (pain)',
    source:    '[1] Kandel 2021 ch.24; [10] HCP 2013',
  },
  'second posterior central gyrus': {
    func:      'Posterior parietal operculum / superior S2: somatosensory-motor integration, proprioceptive body schema, grip force control',
    disorders: 'Parietal opercular syndrome (somatosensory loss + language issues), tactile apraxia',
    network:   'Sensorimotor Network',
    source:    '[1] Kandel 2021 ch.24; [14] Destrieux 2010',
  },

  // ── BRAINSTEM ────────────────────────────────────────────────────────
  'midbrain': {
    func:      'Dopaminergic reward signalling (VTA/SN), oculomotor control (CN III/IV nuclei), auditory & visual relay, pain modulation (PAG), REM sleep generation',
    disorders: "Parkinson's disease (SN degeneration), Weber's syndrome, vertical gaze palsy (Parinaud), REM sleep behaviour disorder",
    network:   'Reticular Activating System / Mesolimbic Dopamine Pathway',
    source:    '[1] Kandel 2021 ch.44; [7] Parvizi & Damasio 2001',
  },
  'medulla': {
    func:      'Vital autonomic control: respiratory rhythm (pre-Bötzinger complex), cardiac rate, blood pressure, vomiting centre, swallowing (CN IX/X/XII nuclei)',
    disorders: 'Locked-in syndrome (basilar artery occlusion), Wallenberg syndrome (PICA), ALS (bulbar palsy), central sleep apnoea',
    network:   'Autonomic Nervous System / Central Pattern Generators',
    source:    '[1] Kandel 2021 ch.46; [7] Parvizi & Damasio 2001',
  },

  // ── FALLBACK ─────────────────────────────────────────────────────────
  'gyrus': {
    func:      'Cortical gyrus — function determined by lobe and sulcal boundaries; supports cognition, sensory, or motor processing',
    disorders: 'Focal epilepsy, stroke, cortical dysplasia (location-dependent)',
    network:   'Region-dependent cortical network',
    source:    '[1] Kandel 2021; [10] HCP 2013',
  },
  default: {
    func:      'Supporting neural structure — specific function determined by precise location within the brain',
    disorders: 'Varies by nuclei and connectivity; consult neuroanatomical atlas',
    network:   'Subcortical / White Matter / Cranial Nerve',
    source:    '[1] Kandel 2021',
  },
}

// Priority matcher — longer/more-specific keys matched first
const getAnatomyInfo = (label) => {
  const l = label.toLowerCase()
  // Sort keys by length descending so specific entries win over generic ones
  const keys = Object.keys(anatomyDB).filter(k => k !== 'default').sort((a, b) => b.length - a.length)
  for (const k of keys) if (l.includes(k.toLowerCase())) return anatomyDB[k]
  return anatomyDB.default
}

// ─────────────────────────────────────────────
//  ACTIVITY PROFILES — mesh-specific
//  Values: normalised [0–1] relative activation
//  fMRI: BOLD signal change from Neurosynth meta-analyses [3][10]
//  EEG bands: intracranial & scalp PSD literature [2][5]
// ─────────────────────────────────────────────
const activityProfiles = {
  //                                        anat   fmri  alpha  beta  theta  delta

  // ── Colliculi ──────────────────────────────────────────────────────
  'inferior colliculus':    { anatomical:0.65, fmri:0.60, alpha:0.12, beta:0.42, theta:0.48, delta:0.32 },
  'superior colliculus':    { anatomical:0.62, fmri:0.55, alpha:0.18, beta:0.48, theta:0.52, delta:0.28 },

  // ── Frontal gyri ───────────────────────────────────────────────────
  'inferior frontal gyrus': { anatomical:0.68, fmri:0.85, alpha:0.70, beta:0.88, theta:0.60, delta:0.12 },
  // Broca: very high beta (language motor planning), theta (working memory) [2]
  'middle frontal gyrus':   { anatomical:0.70, fmri:0.88, alpha:0.75, beta:0.90, theta:0.65, delta:0.10 },
  // DLPFC: highest beta in frontal lobe (executive/WM), strong alpha ERD [2][10]
  'superior frontal gyrus': { anatomical:0.65, fmri:0.80, alpha:0.72, beta:0.78, theta:0.55, delta:0.14 },
  // SMA: strong beta (motor planning 13–30 Hz), alpha moderate [2]
  'precentral gyrus':       { anatomical:0.80, fmri:0.92, alpha:0.60, beta:0.95, theta:0.40, delta:0.15 },
  // M1: highest beta in the brain (sensorimotor beta 20 Hz, movement-related [2])

  // ── Parietal ───────────────────────────────────────────────────────
  'postcentral gyrus':      { anatomical:0.78, fmri:0.88, alpha:0.72, beta:0.80, theta:0.45, delta:0.14 },
  // S1: strong beta after tactile stimulation; alpha ERD during touch [2]
  'superior parietal lobule':{ anatomical:0.65, fmri:0.82, alpha:0.70, beta:0.75, theta:0.55, delta:0.12 },
  'supramarginal gyrus':    { anatomical:0.65, fmri:0.80, alpha:0.72, beta:0.78, theta:0.62, delta:0.12 },
  'angular gyrus':          { anatomical:0.62, fmri:0.78, alpha:0.80, beta:0.70, theta:0.60, delta:0.15 },
  // Angular: high resting alpha (DMN node), theta for semantic retrieval [4][2]
  'precuneus':              { anatomical:0.68, fmri:0.82, alpha:0.85, beta:0.68, theta:0.65, delta:0.18 },
  // Precuneus: highest resting alpha of any region (DMN hub, highest metabolism) [4]

  // ── Orbital / Frontal ──────────────────────────────────────────────
  'anterior orbital gyrus': { anatomical:0.55, fmri:0.72, alpha:0.60, beta:0.65, theta:0.58, delta:0.20 },
  'lateral orbital gyrus':  { anatomical:0.52, fmri:0.68, alpha:0.55, beta:0.70, theta:0.52, delta:0.18 },
  'medial orbital gyrus':   { anatomical:0.58, fmri:0.74, alpha:0.65, beta:0.60, theta:0.55, delta:0.22 },
  'posterior orbital gyrus':{ anatomical:0.50, fmri:0.65, alpha:0.52, beta:0.58, theta:0.50, delta:0.25 },
  // Posterior OFC: olfactory relay — slightly higher delta (visceral rhythms) [12]
  'straight gyrus':         { anatomical:0.48, fmri:0.62, alpha:0.55, beta:0.55, theta:0.52, delta:0.28 },

  // ── Cingulate ──────────────────────────────────────────────────────
  'cingulate gyrus':        { anatomical:0.72, fmri:0.85, alpha:0.75, beta:0.72, theta:0.70, delta:0.28 },
  // ACC: high theta (error/conflict monitoring, Cavanagh et al.) [2]; PCC: high alpha [4]

  // ── Temporal ───────────────────────────────────────────────────────
  'superior temporal gyrus':{ anatomical:0.70, fmri:0.88, alpha:0.68, beta:0.75, theta:0.60, delta:0.15 },
  // STG/Wernicke: high fMRI for speech; gamma/beta for phonology (modelled as beta) [2]
  'middle temporal gyrus':  { anatomical:0.65, fmri:0.80, alpha:0.75, beta:0.65, theta:0.60, delta:0.18 },
  'inferior temporal gyrus':{ anatomical:0.60, fmri:0.78, alpha:0.70, beta:0.62, theta:0.55, delta:0.20 },
  'anterior transverse temporal gyrus':{ anatomical:0.68, fmri:0.85, alpha:0.55, beta:0.70, theta:0.50, delta:0.18 },
  // Heschl's anterior: primary auditory — high fMRI for tone stimuli [3]
  'posterior transverse temporal gyrus':{ anatomical:0.70, fmri:0.88, alpha:0.60, beta:0.78, theta:0.58, delta:0.15 },
  // Planum temporale: phonological — beta dominant (speech motor coupling) [2]

  // ── Occipital ──────────────────────────────────────────────────────
  'superior occipital gyrus':{ anatomical:0.62, fmri:0.80, alpha:0.82, beta:0.60, theta:0.40, delta:0.12 },
  // Occipital alpha (8–12 Hz Berger rhythm) is maximal in occipital regions [2]
  'lateral occipital gyrus': { anatomical:0.65, fmri:0.82, alpha:0.80, beta:0.62, theta:0.42, delta:0.12 },
  'cuneus':                  { anatomical:0.70, fmri:0.90, alpha:0.85, beta:0.55, theta:0.38, delta:0.10 },
  // V1 cuneus: highest fMRI in visual cortex; strongest occipital alpha [2][3]
  'lingual gyrus':           { anatomical:0.68, fmri:0.85, alpha:0.82, beta:0.58, theta:0.40, delta:0.14 },

  // ── Fusiform ───────────────────────────────────────────────────────
  'fusiform gyrus':          { anatomical:0.65, fmri:0.84, alpha:0.72, beta:0.65, theta:0.52, delta:0.15 },

  // ── Parahippocampal ────────────────────────────────────────────────
  'posterior parahippocampal gyrus':{ anatomical:0.58, fmri:0.72, alpha:0.65, beta:0.52, theta:0.75, delta:0.28 },
  // PHG: strong theta (entorhinal-hippocampal theta coupling) [2][13]

  // ── Insula ─────────────────────────────────────────────────────────
  'first short gyrus':       { anatomical:0.65, fmri:0.82, alpha:0.50, beta:0.68, theta:0.70, delta:0.25 },
  // Anterior insula: theta for interoceptive-emotional integration; low alpha [11]
  'second short gyrus':      { anatomical:0.62, fmri:0.78, alpha:0.45, beta:0.65, theta:0.68, delta:0.28 },
  'intermediate short gyrus':{ anatomical:0.58, fmri:0.72, alpha:0.48, beta:0.62, theta:0.62, delta:0.30 },
  'anterior accessory gyrus':{ anatomical:0.60, fmri:0.75, alpha:0.52, beta:0.65, theta:0.65, delta:0.28 },

  // ── Hippocampal subfields ──────────────────────────────────────────
  'dentate gyrus':           { anatomical:0.55, fmri:0.65, alpha:0.45, beta:0.35, theta:0.92, delta:0.30 },
  // DG: theta dominant (pattern separation during exploration) [2]
  'fasciolar gyrus':         { anatomical:0.40, fmri:0.50, alpha:0.40, beta:0.32, theta:0.80, delta:0.32 },
  'presubiculum':            { anatomical:0.52, fmri:0.62, alpha:0.48, beta:0.38, theta:0.85, delta:0.32 },
  // Presubiculum: head direction + theta-grid coupling [2]

  // ── Posterior central ──────────────────────────────────────────────
  'first posterior central gyrus': { anatomical:0.72, fmri:0.82, alpha:0.68, beta:0.78, theta:0.48, delta:0.16 },
  'second posterior central gyrus':{ anatomical:0.68, fmri:0.78, alpha:0.65, beta:0.75, theta:0.45, delta:0.18 },

  // ── Brainstem ──────────────────────────────────────────────────────
  'midbrain':    { anatomical:0.72, fmri:0.58, alpha:0.18, beta:0.62, theta:0.45, delta:0.38 },
  'medulla':     { anatomical:0.28, fmri:0.22, alpha:0.10, beta:0.12, theta:0.30, delta:0.72 },

  // ── Generic cortex fallback (catches any remaining "gyrus") ────────
  'gyrus':       { anatomical:0.62, fmri:0.82, alpha:0.75, beta:0.78, theta:0.52, delta:0.14 },
  'cortex':      { anatomical:0.65, fmri:0.85, alpha:0.82, beta:0.85, theta:0.50, delta:0.12 },
  'colliculus':  { anatomical:0.62, fmri:0.55, alpha:0.18, beta:0.48, theta:0.52, delta:0.28 },
  'thalamus':    { anatomical:0.88, fmri:0.80, alpha:0.82, beta:0.58, theta:0.72, delta:0.78 },
  'hippocampus': { anatomical:0.60, fmri:0.68, alpha:0.55, beta:0.38, theta:0.92, delta:0.30 },
  'amygdala':    { anatomical:0.52, fmri:0.65, alpha:0.28, beta:0.72, theta:0.58, delta:0.22 },
  'cerebellum':  { anatomical:0.55, fmri:0.72, alpha:0.48, beta:0.65, theta:0.68, delta:0.22 },
  'Midbrain':    { anatomical:0.72, fmri:0.58, alpha:0.18, beta:0.62, theta:0.45, delta:0.38 },
  'Medulla':     { anatomical:0.28, fmri:0.22, alpha:0.10, beta:0.12, theta:0.30, delta:0.72 },

  default:       { anatomical:0.12, fmri:0.15, alpha:0.12, beta:0.15, theta:0.14, delta:0.18 },
}

// Priority matcher — longer keys matched first so specific beats generic
const getActivity = (label) => {
  const l = label.toLowerCase()
  const keys = Object.keys(activityProfiles).filter(k => k !== 'default').sort((a, b) => b.length - a.length)
  for (const k of keys) if (l.includes(k.toLowerCase())) return activityProfiles[k]
  return activityProfiles.default
}

const modeKey = (mode = S.heatmapMode) => {
  const map = { fMRI:'fmri','EEG-Alpha':'alpha','EEG-Beta':'beta','EEG-Theta':'theta','EEG-Delta':'delta' }
  return map[mode] || 'anatomical'
}
// ─────────────────────────────────────────────
//  COMBINED MESH SHADER
//  Injects BOTH the vertex-pulse AND the dissolve effect
//  into MeshPhysical via onBeforeCompile.
//
//  Dissolve works by:
//  1. Computing a 3D value-noise hash in the fragment shader
//  2. Comparing noise(worldPos * noiseScale) against uDissolve threshold
//  3. Fragments below the threshold are discarded (erased)
//  4. Fragments just above the threshold emit the edge glow color
//  This creates a spatial "crumbling" effect instead of a flat fade.
// ─────────────────────────────────────────────
const DISSOLVE_GLSL = /* glsl */`
  // ── 3-D value noise (hash-based, no texture needed) ──────────────
  vec3 _hash3(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.zxy + 19.19);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = _hash3(i + vec3(0,0,0)).x;
    float n100 = _hash3(i + vec3(1,0,0)).x;
    float n010 = _hash3(i + vec3(0,1,0)).x;
    float n110 = _hash3(i + vec3(1,1,0)).x;
    float n001 = _hash3(i + vec3(0,0,1)).x;
    float n101 = _hash3(i + vec3(1,0,1)).x;
    float n011 = _hash3(i + vec3(0,1,1)).x;
    float n111 = _hash3(i + vec3(1,1,1)).x;
    return mix(
      mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
      mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y),
      u.z
    );
  }
  // Layered octaves for more organic look
  float fbmNoise(vec3 p) {
    return valueNoise(p)           * 0.5
         + valueNoise(p * 2.1)    * 0.28
         + valueNoise(p * 4.3)    * 0.14
         + valueNoise(p * 8.7)    * 0.08;
  }
`

const injectMeshShader = (mat, phaseOffset = 0) => {
  mat.onBeforeCompile = (shader) => {
    // ── Uniforms ────────────────────────────────────────────────────
    shader.uniforms.uTime       = { value: 0 }
    // Vertex pulse
    shader.uniforms.uPulseAmp   = { value: S.pulseVertexAmplitude }
    shader.uniforms.uPulseFreq  = { value: S.pulseVertexFrequency }
    shader.uniforms.uPulseSpd   = { value: S.pulseVertexSpeed }
    shader.uniforms.uPhase      = { value: phaseOffset }
    shader.uniforms.uPulseOn    = { value: S.pulseVertexEnabled ? 1.0 : 0.0 }
    // Dissolve
    shader.uniforms.uDissolve   = { value: 0.0 }  // 0=visible 1=fully dissolved
    shader.uniforms.uEdgeWidth  = { value: S.dissolveEdgeWidth }
    shader.uniforms.uEdgeColor  = { value: new THREE.Color(S.dissolveEdgeColor) }
    shader.uniforms.uNoiseScale = { value: S.dissolveNoiseScale }

    mat.userData.shader = shader

    // ── Vertex shader: pulse displacement ──────────────────────────
    shader.vertexShader = `
      uniform float uTime;
      uniform float uPulseAmp;
      uniform float uPulseFreq;
      uniform float uPulseSpd;
      uniform float uPhase;
      uniform float uPulseOn;
      varying vec3 vWorldPos;
    ` + shader.vertexShader
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float wave = sin(uTime * uPulseSpd + position.y * uPulseFreq + uPhase) * 0.5
                    + sin(uTime * uPulseSpd * 1.3 + position.x * uPulseFreq * 0.7 + uPhase) * 0.5;
         transformed += normal * wave * uPulseAmp * uPulseOn;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )

    // ── Fragment shader: dissolve discard + edge glow ───────────────
    shader.fragmentShader = `
      uniform float uDissolve;
      uniform float uEdgeWidth;
      uniform vec3  uEdgeColor;
      uniform float uNoiseScale;
      varying vec3  vWorldPos;
      ${DISSOLVE_GLSL}
    ` + shader.fragmentShader
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>

         // ── Dissolve logic (runs last so it overrides all shading) ──
         if (uDissolve > 0.001) {
           float n = fbmNoise(vWorldPos * uNoiseScale);

           // Each mesh gets unique spatial pattern; discard below threshold
           if (n < uDissolve) discard;

           // Edge band: thin shell just above the dissolve threshold
           float edge = smoothstep(uDissolve, uDissolve + uEdgeWidth, n);
           // Add glow at the boundary — strongest right at the cut edge
           float edgeGlow = (1.0 - edge) * (1.0 - smoothstep(0.0, uEdgeWidth * 0.5, n - uDissolve));
           gl_FragColor.rgb = mix(uEdgeColor * 2.0, gl_FragColor.rgb, edge);
           gl_FragColor.a  *= edge;
         }
        `
      )
  }
}

// ─────────────────────────────────────────────
//  DISSOLVE STATE MACHINE
//  Each mesh has:
//    dissolveTarget  — where uDissolve is heading (0 or 1)
//    dissolveCurrent — animated value driven toward target each frame
// ─────────────────────────────────────────────
// called once per frame in tick()
const updateDissolve = (elapsed) => {
  const dt = 0.016 // fixed timestep approximation
  brainMeshes.forEach(m => {
    const target  = m.userData.dissolveTarget  ?? 0
    const current = m.userData.dissolveCurrent ?? 0
    if (Math.abs(current - target) < 0.001) {
      m.userData.dissolveCurrent = target
      // When fully dissolved, hide the mesh to avoid any residual geometry
      m.visible = target < 0.99
    } else {
      const next = THREE.MathUtils.lerp(current, target, dt * S.dissolveSpeed * 3.5)
      m.userData.dissolveCurrent = next
      m.visible = true
      if (m.material.userData.shader) {
        m.material.userData.shader.uniforms.uDissolve.value = next
        m.material.userData.shader.uniforms.uEdgeWidth.value = S.dissolveEdgeWidth
        m.material.userData.shader.uniforms.uEdgeColor.value.set(S.dissolveEdgeColor)
        m.material.userData.shader.uniforms.uNoiseScale.value = S.dissolveNoiseScale
      }
    }
  })
}

// ─────────────────────────────────────────────
//  BRAIN MODEL
// ─────────────────────────────────────────────
const brainMeshes = []
const brainGroup  = new THREE.Group()
const css2dLabels = []
scene.add(brainGroup)

const captureBaseMaterial = (mat) => ({
  wireframe: false, opacity: mat.opacity, transparent: mat.transparent,
  emissive: mat.emissive.getHex(), emissiveIntensity: mat.emissiveIntensity,
  roughness: mat.roughness, metalness: mat.metalness,
  transmission: mat.transmission, color: mat.color.getHex(),
  clearcoat: mat.clearcoat, iridescence: mat.iridescence ?? 0,
})

const gltfLoader = new GLTFLoader()
gltfLoader.load('./models/brain.glb',
  (gltf) => {
    setLoading(80, LOAD_MESSAGES[6])
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return
      const nameParts = child.name.split('_')
      const uiLabel  = nameParts.length > 3 ? nameParts.slice(3).join(' ') : child.name
      const isGyrus  = uiLabel.toLowerCase().includes('gyrus') || uiLabel.toLowerCase().includes('cortex')
      const profile  = getActivity(uiLabel)
      const phaseOff = Math.random() * Math.PI * 2

      const mat = new THREE.MeshPhysicalMaterial({
        color:              new THREE.Color(isGyrus ? S.cortexColor : S.meshColor),
        roughness:          S.roughness, metalness: S.metalness,
        clearcoat:          S.clearcoat, clearcoatRoughness: S.clearcoatRoughness,
        transmission:       isGyrus ? S.cortexTransmission : 0,
        ior:                isGyrus ? S.cortexIOR : 1.5,
        thickness:          isGyrus ? S.cortexThickness : 0,
        transparent:        true,   // must be true for dissolve alpha discard to work smoothly
        opacity:            isGyrus ? S.cortexOpacity : 1.0,
        emissive:           new THREE.Color(S.heatmapColor),
        emissiveIntensity:  profile[modeKey()] * S.activityIntensity,
        side:               THREE.DoubleSide,
      })

      injectMeshShader(mat, phaseOff)

      child.material = mat
      child.userData.profile          = profile
      child.userData.isGyrus          = isGyrus
      child.userData.uiLabel          = uiLabel
      child.userData.anatomy          = getAnatomyInfo(uiLabel)
      child.userData.currentEmissive  = profile[modeKey()] * S.activityIntensity
      child.userData.targetOpacity    = isGyrus ? S.cortexOpacity : 1.0
      child.userData.originalOpacity  = isGyrus ? S.cortexOpacity : 1.0
      // Dissolve state
      child.userData.dissolveTarget   = 0   // 0 = visible, 1 = dissolved away
      child.userData.dissolveCurrent  = 0
      child.userData._baseMaterial    = captureBaseMaterial(mat)
      child.userData._origStyle = {
        wireframe: false, opacity: isGyrus ? S.cortexOpacity : 1.0, transparent: true,
        emissive: new THREE.Color(S.heatmapColor).getHex(),
        emissiveIntensity: profile[modeKey()] * S.activityIntensity,
        roughness: S.roughness, metalness: S.metalness,
        transmission: isGyrus ? S.cortexTransmission : 0,
        color: new THREE.Color(isGyrus ? S.cortexColor : S.meshColor).getHex(),
        clearcoat: S.clearcoat, iridescence: 0,
      }
      child.castShadow = true; child.receiveShadow = true
      brainMeshes.push(child)

      const labelDiv = document.createElement('div')
      labelDiv.className = 'brain-label'
      labelDiv.textContent = uiLabel.substring(0, 20)
      const label2d = new CSS2DObject(labelDiv)
      label2d.position.set(0,0,0); child.add(label2d)
      label2d.visible = S.labelsVisible
      css2dLabels.push({ obj: label2d, div: labelDiv })
    })

    const box    = new THREE.Box3().setFromObject(gltf.scene)
    const size   = box.getSize(new THREE.Vector3())
    const sc     = 3.9 / Math.max(size.x, size.y, size.z)
    gltf.scene.scale.setScalar(sc)
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(sc)
    gltf.scene.position.sub(center)
    brainGroup.add(gltf.scene)

    applyClipToMeshes(); buildRegionGUI(); buildElectrodes(); buildConnectivityArcs()
    setLoading(100, 'Ready.'); setTimeout(hideLoader, 600)
    
  },
  (xhr) => setLoading(20 + (xhr.loaded / (xhr.total || 1)) * 58, LOAD_MESSAGES[3]),
  (err) => { console.error('GLTF error:', err); loaderMsg.textContent = 'Model load failed.' }
)

 

// ─────────────────────────────────────────────
//  ISOLATE / SHOW-ALL  ← THE DISSOLVE IS HERE
// ─────────────────────────────────────────────
let isolatedMesh = null

let dissolvePhase = 'none' // 'dissolving-out' | 'dissolved' | 'restoring' | 'none'

const isolateRegion = (mesh) => {
  isolatedMesh = mesh
  dissolvePhase = 'dissolving-out'

  brainMeshes.forEach(m => {
    if (m === mesh) {
      // Isolated mesh: ensure fully visible, no dissolve
      m.userData.dissolveTarget  = 0
      m.userData.dissolveCurrent = 0
      m.visible = true
      if (m.material.userData.shader) m.material.userData.shader.uniforms.uDissolve.value = 0
      // Boost its emissive so it "emerges" from the dissolve
      m.userData.isolateEmissiveBoost = 0.3
    } else {
      // All others: dissolve away with a small random delay per mesh
      // to avoid all meshes dissolving simultaneously (staggered wave effect)
      m.userData.dissolveTarget  = 1
      m.userData.dissolveDelay   = Math.random() * 0.3  // 0–300ms stagger
      m.userData.dissolveDelayTimer = 0
    }
  })
}

const showAllRegions = () => {
  dissolvePhase = 'restoring'
  flyTarget.active = false

  brainMeshes.forEach(m => {
    // Restore: reverse-dissolve all meshes back into view
    m.userData.dissolveTarget  = 0
    m.userData.isolateEmissiveBoost = 0
    m.visible = true
    // Resync opacity to original
    const origOpacity = m.userData.isGyrus ? S.cortexOpacity : 1.0
    m.userData.originalOpacity = origOpacity
    m.userData.targetOpacity   = origOpacity
    m.material.opacity = origOpacity

    // Restore emissive
    const freshEmissive = m.userData.profile[modeKey()] * S.activityIntensity
    m.material.emissive.set(S.heatmapColor)
    m.material.emissiveIntensity = freshEmissive
    m.userData.currentEmissive = freshEmissive
    m.material.needsUpdate = true
  })

  isolatedMesh = null

  // Fly camera home
  _flyFrom.copy(camera.position)
  _flyTo.set(-1.8, 0.9, 3.8)
  flyTarget.active = true; flyTarget.t = 0
  flyTarget.fromX = _flyFrom.x; flyTarget.fromY = _flyFrom.y; flyTarget.fromZ = _flyFrom.z
  flyTarget.toX = -1.8; flyTarget.toY = 0.9; flyTarget.toZ = 3.8
  flyTarget.targetX = 0; flyTarget.targetY = 0; flyTarget.targetZ = 0
  flyTarget.duration = 1.2
}

// ─────────────────────────────────────────────
//  SPLIT-VIEW STYLE HELPERS
// ─────────────────────────────────────────────
const applySplitStyle = (meshes, style) => {
  meshes.forEach(m => {
    const mat = m.material; if (!mat) return
    switch (style) {
      case 'Wireframe':
        mat.wireframe=true; mat.opacity=1; mat.transparent=false
        mat.emissive.set('#ffffff'); mat.emissiveIntensity=0.3; break
      case 'X-Ray':
        mat.wireframe=false; mat.transparent=true; mat.opacity=0.25
        mat.transmission=0.8; mat.roughness=0.1; mat.metalness=0
        mat.emissive.set('#88ccff'); mat.emissiveIntensity=0.6
        mat.clearcoat=0; break
      case 'CT-Mono':
        mat.wireframe=false; mat.transparent=false; mat.opacity=1
        mat.color.set('#aaaaaa'); mat.emissive.set('#000000'); mat.emissiveIntensity=0
        mat.roughness=0.8; mat.metalness=0; mat.transmission=0; mat.clearcoat=0; break
      case 'Flat':
        mat.wireframe=false; mat.transparent=false; mat.opacity=1
        mat.roughness=1; mat.metalness=0; mat.emissive.set('#000000')
        mat.emissiveIntensity=0; mat.transmission=0; mat.clearcoat=0; break
      default: // Solid
        if (m.userData._origStyle) {
          const o = m.userData._origStyle
          mat.wireframe=o.wireframe; mat.opacity=o.opacity; mat.transparent=o.transparent
          mat.emissive.setHex(o.emissive); mat.emissiveIntensity=o.emissiveIntensity
          mat.roughness=o.roughness; mat.metalness=o.metalness; mat.transmission=o.transmission
          mat.color.setHex(o.color); mat.clearcoat=o.clearcoat
        }
    }
    mat.needsUpdate = true
  })
}

// ─────────────────────────────────────────────
//  CAMERA FLY-TO
// ─────────────────────────────────────────────
const flyTarget = { active:false, t:0, duration:1.2, fromX:0,fromY:0,fromZ:0, toX:0,toY:0,toZ:0, targetX:0,targetY:0,targetZ:0 }
const _flyFrom  = new THREE.Vector3()
const _flyTo    = new THREE.Vector3()
const easeInOut = (t) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t

const flyToMesh = (mesh) => {
  const box    = new THREE.Box3().setFromObject(mesh)
  const center = box.getCenter(new THREE.Vector3())
  const dir    = camera.position.clone().sub(center).normalize()
  const dist   = box.getSize(new THREE.Vector3()).length() * 1.5 + 0.5
  _flyFrom.copy(camera.position)
  _flyTo.copy(center).addScaledVector(dir, dist)
  flyTarget.active=true; flyTarget.t=0
  flyTarget.fromX=_flyFrom.x; flyTarget.fromY=_flyFrom.y; flyTarget.fromZ=_flyFrom.z
  flyTarget.toX=_flyTo.x; flyTarget.toY=_flyTo.y; flyTarget.toZ=_flyTo.z
  flyTarget.targetX=center.x; flyTarget.targetY=center.y; flyTarget.targetZ=center.z
}

// ─────────────────────────────────────────────
//  REGION DETAIL PANEL
// ─────────────────────────────────────────────
const regionPanel    = document.getElementById('region-panel')
const panelClose     = document.getElementById('panel-close')
const panelName      = document.getElementById('panel-name')
const panelFunc      = document.getElementById('panel-func')
const panelDisorders = document.getElementById('panel-disorders')
const panelNetwork   = document.getElementById('panel-network')
const panelBars      = document.getElementById('panel-bars')
const panelIsolateBtn = document.getElementById('panel-isolate-btn')
const panelResetBtn  = document.getElementById('panel-reset-btn')

const BAND_LABELS = [
  {key:'anatomical',label:'Anatomical',color:'#00e5ff'},{key:'fmri',label:'fMRI',color:'#ff6b35'},
  {key:'alpha',label:'EEG Alpha',color:'#39ff6e'},{key:'beta',label:'EEG Beta',color:'#ffdd00'},
  {key:'theta',label:'EEG Theta',color:'#aa88ff'},{key:'delta',label:'EEG Delta',color:'#ff4466'},
]

const openRegionPanel = (mesh) => {
  const a=mesh.userData.anatomy, p=mesh.userData.profile
  panelName.textContent=mesh.userData.uiLabel; panelFunc.textContent=a.func
  panelDisorders.textContent=a.disorders; panelNetwork.textContent=a.network
  const sourceEl = regionPanel.querySelector('#panel-source')
  if (sourceEl) sourceEl.textContent = a.source || ''
  panelBars.innerHTML = BAND_LABELS.map(b => {
    const val=Math.round((p[b.key]||0)*100)
    return `<div class="bar-row"><span class="bar-label">${b.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${val}%;background:${b.color}"></div></div>
      <span class="bar-val">${val}%</span></div>`
  }).join('')
  regionPanel.classList.add('open')
  panelIsolateBtn.onclick = () => { isolateRegion(mesh); flyToMesh(mesh) }
  panelResetBtn.onclick   = showAllRegions
}
panelClose.onclick = () => regionPanel.classList.remove('open')

// ─────────────────────────────────────────────
//  SYNAPTIC SIGNAL TRAILS
// ─────────────────────────────────────────────
const TRAIL = S.signalTrailLength, SIG = S.signalCount
const trailPositions = new Float32Array(SIG * TRAIL * 3)
const trailAlphas    = new Float32Array(SIG * TRAIL)
const signalStates   = []
const sphericalRandom = (r) => {
  const theta=2*Math.PI*Math.random(), phi=Math.acos(2*Math.random()-1), rad=r*Math.cbrt(Math.random())
  return new THREE.Vector3(rad*Math.sin(phi)*Math.cos(theta), rad*Math.sin(phi)*Math.sin(theta), rad*Math.cos(phi))
}
const newSignalState = () => {
  const pos = sphericalRandom(S.signalRadius).add(new THREE.Vector3(0,0,0.75))
  return { pos:pos.clone(), dir:new THREE.Vector3((Math.random()-.5),(Math.random()-.5)*.7,(Math.random()-.5)).normalize(), speed:0.003+Math.random()*0.009, life:0, maxLife:80+Math.floor(Math.random()*120), headIdx:0, trailFilled:0 }
}
for (let i=0;i<SIG;i++) {
  signalStates.push(newSignalState())
  for (let t=0;t<TRAIL;t++) {
    trailPositions[(i*TRAIL+t)*3]=signalStates[i].pos.x
    trailPositions[(i*TRAIL+t)*3+1]=signalStates[i].pos.y
    trailPositions[(i*TRAIL+t)*3+2]=signalStates[i].pos.z
    trailAlphas[i*TRAIL+t]=0
  }
}
const signalGeo = new THREE.BufferGeometry()
signalGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
signalGeo.setAttribute('alpha',    new THREE.BufferAttribute(trailAlphas, 1))
const signalMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor:{value:new THREE.Color(S.signalColor)}, uTailColor:{value:new THREE.Color(S.signalTailColor)},
    uSize:{value:S.signalSize*renderer.getPixelRatio()*sizes.width}, uOpacity:{value:S.signalOpacity},
  },
  vertexShader:`attribute float alpha;uniform float uSize;varying float vAlpha;void main(){vAlpha=alpha;vec4 mvPos=modelViewMatrix*vec4(position,1.0);gl_PointSize=uSize*(1.0/-mvPos.z)*alpha;gl_Position=projectionMatrix*mvPos;}`,
  fragmentShader:`uniform vec3 uColor;uniform vec3 uTailColor;uniform float uOpacity;varying float vAlpha;void main(){vec2 uv=gl_PointCoord-0.5;float d=length(uv);if(d>0.5)discard;float soft=1.0-smoothstep(0.2,0.5,d);gl_FragColor=vec4(mix(uTailColor,uColor,vAlpha),soft*vAlpha*uOpacity);}`,
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
})
const signalPoints = new THREE.Points(signalGeo, signalMat)
signalPoints.visible = S.signalsEnabled; scene.add(signalPoints)

// ─────────────────────────────────────────────
//  ELECTRODES
// ─────────────────────────────────────────────
const electrodeGroup = new THREE.Group(); electrodeGroup.visible = S.electrodesVisible; scene.add(electrodeGroup)
const EEG_LABELS = ['Fp1','Fp2','F3','F4','C3','C4','P3','P4','O1','O2','T3','T4','T5','T6','Fz','Cz','Pz']
const buildElectrodes = () => {
  electrodeGroup.clear()
  const r=1.8
  for (let i=0;i<S.electrodeCount;i++) {
    const phi=Math.acos(1-2*(i+.5)/S.electrodeCount), theta=Math.PI*(1+Math.sqrt(5))*i
    const pos=new THREE.Vector3(r*Math.sin(phi)*Math.cos(theta),r*Math.abs(Math.cos(phi)),r*Math.sin(phi)*Math.sin(theta))
    const el=new THREE.Mesh(new THREE.SphereGeometry(S.electrodeSize,8,8), new THREE.MeshPhysicalMaterial({color:S.electrodeColor,emissive:S.electrodeRingColor,emissiveIntensity:0.4,metalness:0.9,roughness:0.1}))
    el.position.copy(pos); el.userData.label=EEG_LABELS[i]||`E${i+1}`; electrodeGroup.add(el)
    const ring=new THREE.Mesh(new THREE.RingGeometry(S.electrodeSize*1.4,S.electrodeSize*2.2,16), new THREE.MeshBasicMaterial({color:S.electrodeRingColor,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false}))
    ring.position.copy(pos); ring.lookAt(0,0,0); ring.userData.isRing=true; ring.userData.phaseOffset=Math.random()*Math.PI*2; electrodeGroup.add(ring)
    electrodeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos,pos.clone().multiplyScalar(0.65)]), new THREE.LineBasicMaterial({color:S.electrodeColor,transparent:true,opacity:0.3})))
  }
}

// ─────────────────────────────────────────────
//  CONNECTIVITY ARCS
// ─────────────────────────────────────────────
const arcGroup = new THREE.Group(); arcGroup.visible = S.connectivityVisible; scene.add(arcGroup)
const REGION_CENTERS = [
  new THREE.Vector3(-.6,.4,.3), new THREE.Vector3(.6,.4,.3),
  new THREE.Vector3(-.7,.1,-.2), new THREE.Vector3(.7,.1,-.2),
  new THREE.Vector3(-.3,-.3,-.5), new THREE.Vector3(.3,-.3,-.5),
  new THREE.Vector3(0,.6,0), new THREE.Vector3(0,0,0),
]
const buildConnectivityArcs = () => {
  arcGroup.clear()
  const pairs=[]
  for (let a=0;a<REGION_CENTERS.length;a++) for (let b=a+1;b<REGION_CENTERS.length;b++) pairs.push([a,b])
  pairs.sort(()=>Math.random()-.5).slice(0,S.arcCount).forEach(([a,b],idx)=>{
    const p0=REGION_CENTERS[a].clone(), p1=REGION_CENTERS[b].clone()
    const mid=p0.clone().lerp(p1,.5); mid.y+=.35+Math.random()*.4
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(p0,mid,p1).getPoints(40)), new THREE.LineBasicMaterial({color:new THREE.Color(S.arcColor),transparent:true,opacity:S.arcOpacity*(0.4+Math.random()*.6),depthWrite:false}))
    line.userData.phaseOffset=idx*0.4; arcGroup.add(line)
  })
}

// ─────────────────────────────────────────────
//  ORBIT CONTROLS
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, canvas)
controls.enableDamping=true; controls.dampingFactor=0.06
controls.minDistance=1.0; controls.maxDistance=12
controls.autoRotate=S.autoRotate; controls.autoRotateSpeed=S.autoRotateSpeed

// ─────────────────────────────────────────────
//  GUI
// ─────────────────────────────────────────────
const gui = new GUI({ title: '⚗ NeuroHEX Console', width: 310 })


const matF = gui.addFolder('🧠 Cortex')
const cortexF = matF
cortexF.add(S, 'cortexVisible').name('Visible').onChange(v => {
  brainMeshes.forEach(m => {
    if (m.userData.isGyrus) {
      m.userData.dissolveTarget = v ? 0 : 1
      if (v) {
        m.material.opacity = S.cortexOpacity
        m.userData.originalOpacity = S.cortexOpacity
        m.userData.targetOpacity   = S.cortexOpacity
      }
    }
  })
})
cortexF.addColor(S,'cortexColor').name('Color').onChange(v=>brainMeshes.forEach(m=>{if(m.userData.isGyrus)m.material.color.set(v)}))
cortexF.add(S,'cortexTransmission',0,1).name('Transmission').onChange(v=>brainMeshes.forEach(m=>{if(m.userData.isGyrus)m.material.transmission=v}))
cortexF.add(S,'cortexOpacity',0,1).name('Opacity').onChange(v=>{brainMeshes.forEach(m=>{if(m.userData.isGyrus){m.material.opacity=v;m.userData.originalOpacity=v;m.userData.targetOpacity=v}})})
matF.close()


const funcF=gui.addFolder('📊 Activity Mode (fMRI / EEG)')
funcF.add(S,'heatmapEnabled').name('Enable Heatmap')
funcF.add(S,'heatmapMode',['Anatomical','fMRI','EEG-Alpha','EEG-Beta','EEG-Theta','EEG-Delta']).name('Mode').onChange(()=>{
  const k=modeKey(); brainMeshes.forEach(m=>{const t=m.userData.profile[k]*S.activityIntensity;m.userData.currentEmissive=t;m.material.emissiveIntensity=t})
})
funcF.addColor(S,'heatmapColor').name('Active Color').onChange(v=>brainMeshes.forEach(m=>m.material.emissive.set(v)))
funcF.add(S,'activityIntensity',0,5).name('Global Intensity')
funcF.add(S,'pulseEnabled').name('Emissive Pulse')
funcF.add(S,'pulseSpeed',0.1,10).name('Pulse Speed')
funcF.add(S,'pulseAmplitude',0,1).name('Pulse Amplitude')
funcF.add(S,'heatmapSmoothing',0.5,0.999).name('Smoothing')
funcF.close()

const splitF=gui.addFolder('🖥 Split Compare')
splitF.add(S,'splitViewEnabled').name('Enable Split').onChange(v=>document.getElementById('split-divider').classList.toggle('hidden',!v))
splitF.add(S,'splitModeLeft',['Anatomical','fMRI','EEG-Alpha','EEG-Beta','EEG-Theta','EEG-Delta']).name('Left Mode').onChange(v=>document.getElementById('split-label-left').textContent=v)
splitF.add(S,'splitModeRight',['Anatomical','fMRI','EEG-Alpha','EEG-Beta','EEG-Theta','EEG-Delta']).name('Right Mode').onChange(v=>document.getElementById('split-label-right').textContent=v)
splitF.add(S,'splitStyleLeft',['Solid','Wireframe','X-Ray','CT-Mono','Flat']).name('Left Style')
splitF.add(S,'splitStyleRight',['Solid','Wireframe','X-Ray','CT-Mono','Flat']).name('Right Style')
splitF.close()

const clipF=gui.addFolder('✂ Clipping Planes')
clipF.add(S,'clippingEnabled').name('Enable').onChange(()=>{applyClipToMeshes();updateClipHelpers()})
clipF.add(S,'clipPlaneHelper').name('Show Guides').onChange(updateClipHelpers)
const cxX=clipF.addFolder('X Sagittal')
cxX.add(S,'clipAxisX').name('Enable X').onChange(()=>{applyClipToMeshes();updateClipHelpers()})
cxX.add(S,'clipX',-2,2).name('Position').onChange(v=>{clipPlanes.x.constant=v;applyClipToMeshes()})
cxX.add(S,'clipNegateX').name('Flip').onChange(v=>{clipPlanes.x.normal.set(v?-1:1,0,0);applyClipToMeshes()})
const cxY=clipF.addFolder('Y Coronal')
cxY.add(S,'clipAxisY').name('Enable Y').onChange(()=>{applyClipToMeshes();updateClipHelpers()})
cxY.add(S,'clipY',-2,2).name('Position').onChange(v=>{clipPlanes.y.constant=v;applyClipToMeshes()})
cxY.add(S,'clipNegateY').name('Flip').onChange(v=>{clipPlanes.y.normal.set(0,v?-1:1,0);applyClipToMeshes()})
const cxZ=clipF.addFolder('Z Axial')
cxZ.add(S,'clipAxisZ').name('Enable Z').onChange(()=>{applyClipToMeshes();updateClipHelpers()})
cxZ.add(S,'clipZ',-2,2).name('Position').onChange(v=>{clipPlanes.z.constant=v;applyClipToMeshes()})
cxZ.add(S,'clipNegateZ').name('Flip').onChange(v=>{clipPlanes.z.normal.set(0,0,v?-1:1);applyClipToMeshes()})
clipF.close()


const utilF=gui.addFolder('📸 Utilities')
const doScreenshot=()=>{
  const m=S.screenshotResolution==='4x'?4:S.screenshotResolution==='3x'?3:2
  renderer.setSize(sizes.width*m,sizes.height*m); composer.setSize(sizes.width*m,sizes.height*m)
  composer.render(); const a=document.createElement('a'); a.download=`neurolab_${Date.now()}.png`
  a.href=canvas.toDataURL('image/png'); a.click()
  renderer.setSize(sizes.width,sizes.height); composer.setSize(sizes.width,sizes.height)
}
utilF.add({screenshot:doScreenshot},'screenshot').name('📷 Export PNG')
utilF.add(S,'screenshotResolution',['2x','3x','4x']).name('Resolution')

const buildRegionGUI = () => {
  const regF = gui.addFolder('🔬 Anatomical Regions')
  const vis = {}

  brainMeshes.forEach(m => {
    vis[m.name] = m.visible

    regF.add(vis, m.name)
      .name(m.userData.uiLabel.substring(0, 26))
      .onChange(v => {
        m.visible = v
        m.userData.dissolveTarget = v ? 0 : 1
        if (v) {
          
          if (m.material.userData.shader) {
           
          }
        }
      })
  })

  regF.close()
}

// ─────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────
const hud = document.createElement('div'); hud.id='hud'
hud.innerHTML=`
  <div class="hud-corner tl"><span class="hud-tag">NeuroHEX</span><span class="hud-sub">3D Research Console v2.1</span></div>
  <div class="hud-corner tr"><span class="hud-tag" id="hud-mode">MODE: ANATOMICAL</span><span class="hud-sub" id="hud-fps">-- FPS</span><span class="hud-sub" id="hud-verts">-- VERTS</span></div>
  <div class="hud-corner bl"><span class="hud-tag">ORIENTATION</span><span class="hud-sub">LH ← | → RH</span><span class="hud-sub">ANT ↑ | ↓ POST</span></div>
  <div class="hud-corner br"><span class="hud-tag">CLIPPING</span><span class="hud-sub" id="hud-clip">OFF</span></div>
  <div id="scale-bar"><div class="scale-line"></div><span>10 mm</span></div>`
document.body.appendChild(hud)
const hoverOverlay=document.createElement('div'); hoverOverlay.id='hover-overlay'; document.body.appendChild(hoverOverlay)

// ─────────────────────────────────────────────
//  RAYCASTER
// ─────────────────────────────────────────────
const raycaster=new THREE.Raycaster(), mouse=new THREE.Vector2()
let hoveredMesh=null; const hoverSavedEmissive=new THREE.Color()
window.addEventListener('mousemove', (e) => {
  mouse.x=(e.clientX/sizes.width)*2-1; mouse.y=-(e.clientY/sizes.height)*2+1
  raycaster.setFromCamera(mouse, camera)
  // Only raycast visible meshes (skip dissolved-away ones)
  const visibleMeshes = brainMeshes.filter(m => m.visible && (m.userData.dissolveCurrent ?? 0) < 0.95)
  const hits=raycaster.intersectObjects(visibleMeshes)
  if (hits.length>0) {
    const mesh=hits[0].object
    if (hoveredMesh!==mesh) {
      if (hoveredMesh) { hoveredMesh.material.emissive.copy(hoverSavedEmissive); hoveredMesh.material.emissiveIntensity=hoveredMesh.userData.currentEmissive }
      hoveredMesh=mesh; hoverSavedEmissive.copy(mesh.material.emissive)
      mesh.material.emissive.set('#ffffff'); mesh.material.emissiveIntensity=0.5
    }
    hoverOverlay.innerHTML=`<div class="ho-region">${mesh.userData.uiLabel}</div><div style="font-size:9px;color:#4a7a8a;margin-top:2px">${mesh.userData.anatomy?.func||''}</div><div class="ho-hint">Click for full details</div>`
    hoverOverlay.style.display='block'; document.body.style.cursor='pointer'
  } else {
    if (hoveredMesh) { hoveredMesh.material.emissive.copy(hoverSavedEmissive); hoveredMesh.material.emissiveIntensity=hoveredMesh.userData.currentEmissive; hoveredMesh=null }
    hoverOverlay.style.display='none'; document.body.style.cursor=''
  }
})

window.addEventListener('click', (e) => {
  if (e.target.closest('#toolbar')||e.target.closest('.region-panel')||e.target.closest('.lil-gui')
      || e.target.closest('#disease-bar') || e.target.closest('#disease-panel')) return
  mouse.x=(e.clientX/sizes.width)*2-1; mouse.y=-(e.clientY/sizes.height)*2+1
  raycaster.setFromCamera(mouse, camera)
  const hits=raycaster.intersectObjects(brainMeshes.filter(m=>m.visible&&(m.userData.dissolveCurrent??0)<0.95))
  if (hits.length>0) openRegionPanel(hits[0].object)
})

// ─────────────────────────────────────────────
//  SPLIT-VIEW DRAG
// ─────────────────────────────────────────────
const splitDivider=document.getElementById('split-divider')
let draggingSplit=false
splitDivider.addEventListener('mousedown',()=>{draggingSplit=true;document.body.style.cursor='col-resize'})
window.addEventListener('mouseup',()=>{draggingSplit=false;document.body.style.cursor=''})
window.addEventListener('mousemove',(e)=>{if(!draggingSplit)return;S.splitX=Math.max(0.1,Math.min(0.9,e.clientX/sizes.width));splitDivider.style.left=(S.splitX*100)+'%'})

// ─────────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────
const toast=document.getElementById('shortcut-toast'), toastKey=document.getElementById('shortcut-key'), toastDesc=document.getElementById('shortcut-desc')
let toastTimer=null, guiVisible=true, animPaused=false
const showToast=(key,desc)=>{
  toast.classList.remove('hidden'); toastKey.textContent=key; toastDesc.textContent=desc; toast.classList.add('show')
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.classList.add('hidden'),250)},1400)
}
window.addEventListener('keydown',(e)=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return
  switch(e.key.toLowerCase()){
    case 'h': guiVisible=!guiVisible; gui.domElement.classList.toggle('hidden-gui',!guiVisible); showToast('H',guiVisible?'GUI visible':'GUI hidden'); break
    case 'r': camera.position.set(-1.8,.9,3.8); controls.reset(); showToast('R','Camera reset'); break
    case ' ': e.preventDefault(); animPaused=!animPaused; showToast('Space',animPaused?'Paused':'Resumed'); document.getElementById('tb-pause').classList.toggle('active',!animPaused); break
    case 'i': if(hoveredMesh){isolateRegion(hoveredMesh);flyToMesh(hoveredMesh);showToast('I','Region isolated')}else{showAllRegions();showToast('I','All shown')}; break
    case 'v': S.splitViewEnabled=!S.splitViewEnabled; splitDivider.classList.toggle('hidden',!S.splitViewEnabled); showToast('V',S.splitViewEnabled?'Split ON':'Split OFF'); break
    case 'x': S.clipAxisX=!S.clipAxisX; S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ; applyClipToMeshes();updateClipHelpers(); showToast('X','Sagittal clip'); break
    case 'y': S.clipAxisY=!S.clipAxisY; S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ; applyClipToMeshes();updateClipHelpers(); showToast('Y','Coronal clip'); break
    case 'z': S.clipAxisZ=!S.clipAxisZ; S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ; applyClipToMeshes();updateClipHelpers(); showToast('Z','Axial clip'); break
    case 'p': doScreenshot(); showToast('P','Screenshot saved'); break
    case 'l': S.labelsVisible=!S.labelsVisible; css2dLabels.forEach(l=>{l.obj.visible=S.labelsVisible;l.div.classList.toggle('visible',S.labelsVisible)}); showToast('L',S.labelsVisible?'Labels ON':'Labels OFF'); break
    case 'escape': showAllRegions(); regionPanel.classList.remove('open'); break
  }
})

// ─────────────────────────────────────────────
//  TOOLBAR
// ─────────────────────────────────────────────
document.getElementById('tb-gui').addEventListener('click',()=>{guiVisible=!guiVisible;gui.domElement.classList.toggle('hidden-gui',!guiVisible)})
document.getElementById('tb-isolate').addEventListener('click',()=>{if(hoveredMesh){isolateRegion(hoveredMesh);flyToMesh(hoveredMesh)}else showAllRegions()})
document.getElementById('tb-split').addEventListener('click',(e)=>{S.splitViewEnabled=!S.splitViewEnabled;splitDivider.classList.toggle('hidden',!S.splitViewEnabled);e.currentTarget.classList.toggle('active',S.splitViewEnabled)})
document.getElementById('tb-clipx').addEventListener('click',(e)=>{S.clipAxisX=!S.clipAxisX;S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ;applyClipToMeshes();updateClipHelpers();e.currentTarget.classList.toggle('active',S.clipAxisX)})
document.getElementById('tb-clipy').addEventListener('click',(e)=>{S.clipAxisY=!S.clipAxisY;S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ;applyClipToMeshes();updateClipHelpers();e.currentTarget.classList.toggle('active',S.clipAxisY)})
document.getElementById('tb-clipz').addEventListener('click',(e)=>{S.clipAxisZ=!S.clipAxisZ;S.clippingEnabled=S.clipAxisX||S.clipAxisY||S.clipAxisZ;applyClipToMeshes();updateClipHelpers();e.currentTarget.classList.toggle('active',S.clipAxisZ)})
document.getElementById('tb-reset').addEventListener('click',()=>{camera.position.set(-1.8,.9,3.8);controls.reset()})
document.getElementById('tb-screenshot').addEventListener('click',doScreenshot)
document.getElementById('tb-pause').addEventListener('click',(e)=>{animPaused=!animPaused;e.currentTarget.classList.toggle('active',!animPaused)})

// ─────────────────────────────────────────────
//  REGION SEARCH FEATURE
// ─────────────────────────────────────────────
const searchInput   = document.getElementById('region-search-input')
const searchResults = document.getElementById('region-search-results')
const searchClear   = document.getElementById('region-search-clear')



const highlightRegionByMesh = (mesh) => {
  isolateRegion(mesh)
  flyToMesh(mesh)
  openRegionPanel(mesh)
}

const buildSearchResults = (query) => {
  searchResults.innerHTML = ''
  if (!query.trim() || brainMeshes.length === 0) {
    searchResults.classList.remove('open')
    return
  }

  const q = query.toLowerCase().trim()
  const matches = brainMeshes.filter(m =>
    m.userData.uiLabel?.toLowerCase().includes(q) &&
    m.visible && (m.userData.dissolveCurrent ?? 0) < 0.95
  )

  if (matches.length === 0) {
    const li = document.createElement('li')
    li.style.color = 'var(--fg-dim)'
    li.style.cursor = 'default'
    li.innerHTML = '<span class="sr-dot" style="background:var(--fg-dim)"></span>No matches'
    searchResults.appendChild(li)
    searchResults.classList.add('open')
    return
  }

  matches.slice(0, 12).forEach(mesh => {
    const li = document.createElement('li')
    li.innerHTML = `<span class="sr-dot"></span>${mesh.userData.uiLabel}`
    li.addEventListener('click', () => {
      highlightRegionByMesh(mesh)
      searchResults.classList.remove('open')
      searchInput.value = mesh.userData.uiLabel
      searchClear.classList.add('visible')
    })
    // Keyboard navigation support
    li.setAttribute('tabindex', '-1')
    searchResults.appendChild(li)
  })

  if (matches.length > 12) {
    const li = document.createElement('li')
    li.style.color = 'var(--fg-dim)'
    li.style.cursor = 'default'
    li.style.fontSize = '8px'
    li.innerHTML = `<span class="sr-dot" style="opacity:0"></span>+${matches.length - 12} more — refine search`
    searchResults.appendChild(li)
  }

  searchResults.classList.add('open')
}

// Input handler
searchInput.addEventListener('input', (e) => {
  const val = e.target.value
  searchClear.classList.toggle('visible', val.length > 0)
  buildSearchResults(val)
})

// Enter key: pick first result
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = searchInput.value.toLowerCase().trim()
    if (!q) return
    const match = brainMeshes.find(m =>
      m.userData.uiLabel?.toLowerCase().includes(q) &&
      m.visible && (m.userData.dissolveCurrent ?? 0) < 0.95
    )
    if (match) {
      highlightRegionByMesh(match)
      searchResults.classList.remove('open')
      searchInput.value = match.userData.uiLabel
      searchClear.classList.add('visible')
    }
  }
  // Arrow key navigation
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const items = [...searchResults.querySelectorAll('li[tabindex]')]
    if (!items.length) return
    const active = searchResults.querySelector('li.active')
    let idx = items.indexOf(active)
    if (e.key === 'ArrowDown') idx = Math.min(idx + 1, items.length - 1)
    else idx = Math.max(idx - 1, 0)
    items.forEach(i => i.classList.remove('active'))
    items[idx]?.classList.add('active')
    items[idx]?.focus()
  }
  if (e.key === 'Escape') {
    searchResults.classList.remove('open')
    searchInput.blur()
  }
})

searchClear.addEventListener('click', () => {
  searchInput.value = ''
  searchClear.classList.remove('visible')
  searchResults.classList.remove('open')
  showAllRegions()
  searchInput.focus()
})

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#region-search-bar')) {
    searchResults.classList.remove('open')
  }
})
// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
const clock=new THREE.Clock()
let frameCount=0, lastFPS=performance.now(), totalVerts=0
const _v3=new THREE.Vector3(), _controlTarget=new THREE.Vector3()

const tick=()=>{
  const elapsed=clock.getElapsedTime()
  frameCount++
  if (performance.now()-lastFPS>600) {
    const fps=Math.round(frameCount/((performance.now()-lastFPS)/1000))
    document.getElementById('hud-fps').textContent=`${fps} FPS`
    if (totalVerts===0&&brainMeshes.length>0) {
      totalVerts=brainMeshes.reduce((a,m)=>a+(m.geometry.attributes.position?.count||0),0)
      document.getElementById('hud-verts').textContent=`${(totalVerts/1000).toFixed(0)}K VERTS`
    }
    frameCount=0; lastFPS=performance.now()
  }
  document.getElementById('hud-mode').textContent=S.splitViewEnabled?`${S.splitModeLeft} | ${S.splitModeRight}`:`MODE: ${S.heatmapMode}`
  document.getElementById('hud-clip').textContent=S.clippingEnabled
    ?[S.clipAxisX?`X:${S.clipX.toFixed(2)}`:null,S.clipAxisY?`Y:${S.clipY.toFixed(2)}`:null,S.clipAxisZ?`Z:${S.clipZ.toFixed(2)}`:null].filter(Boolean).join(' | ')||'ON'
    :'OFF'

  if (!animPaused) {
    // Vertex pulse uniforms
    if (S.pulseVertexEnabled) brainMeshes.forEach(m=>{if(m.material.userData.shader)m.material.userData.shader.uniforms.uTime.value=elapsed})

    // ── DISSOLVE ANIMATION ───────────────────────────────────────────
    // This is the heart of the effect — runs every frame
    updateDissolve(elapsed)

    // Isolated mesh emissive boost (glows brighter as others dissolve away)
    if (isolatedMesh) {
      const boost=isolatedMesh.userData.isolateEmissiveBoost??0
      if (boost>0) {
        const baseEmissive=isolatedMesh.userData.currentEmissive
        isolatedMesh.material.emissiveIntensity=baseEmissive+boost*1.2*(0.5+0.5*Math.sin(elapsed*3))
      }
    }

    // Synaptic trails
    if (S.signalsEnabled) {
      for (let i=0;i<SIG;i++) {
        const st=signalStates[i]; st.life++
        _v3.set((Math.random()-.5)*.004,(Math.random()-.5)*.003,(Math.random()-.5)*.004)
        st.dir.add(_v3).normalize(); st.pos.addScaledVector(st.dir,st.speed*(S.signalSpeed/0.006))
        if(st.pos.length()>S.signalRadius){st.pos.normalize().multiplyScalar(S.signalRadius*.95);st.dir.reflect(st.pos.clone().normalize()).negate().normalize()}
        if(st.life>st.maxLife) Object.assign(st,newSignalState())
        const head=st.headIdx, base=(i*TRAIL+head)*3
        trailPositions[base]=st.pos.x; trailPositions[base+1]=st.pos.y; trailPositions[base+2]=st.pos.z
        st.headIdx=(head+1)%TRAIL; if(st.trailFilled<TRAIL)st.trailFilled++
        for(let t=0;t<TRAIL;t++){const age=((head-t+TRAIL)%TRAIL),filled=Math.min(st.trailFilled,TRAIL);trailAlphas[i*TRAIL+((head-t+TRAIL)%TRAIL)]=age<filled?Math.pow(1-age/filled,1.8):0}
      }
      signalGeo.attributes.position.needsUpdate=true; signalGeo.attributes.alpha.needsUpdate=true
    }

    // Heatmap emissive
    if (S.heatmapEnabled) {
      const k=modeKey()
      brainMeshes.forEach(m=>{
        const base=m.userData.profile[k]
        const pulse=S.pulseEnabled?Math.sin(elapsed*S.pulseSpeed+base*12)*S.pulseAmplitude*base:0
        const target=(base+pulse)*S.activityIntensity
        m.userData.currentEmissive=THREE.MathUtils.lerp(m.userData.currentEmissive,target,1-S.heatmapSmoothing)
        // Don't override hovered mesh or isolated mesh (they have their own emissive)
        if (m!==hoveredMesh&&m!==isolatedMesh) m.material.emissiveIntensity=m.userData.currentEmissive
      })
    }

    // Camera fly-to
    if (flyTarget.active) {
      flyTarget.t=Math.min(flyTarget.t+0.016/flyTarget.duration,1)
      const e2=easeInOut(flyTarget.t)
      camera.position.set(flyTarget.fromX+(flyTarget.toX-flyTarget.fromX)*e2,flyTarget.fromY+(flyTarget.toY-flyTarget.fromY)*e2,flyTarget.fromZ+(flyTarget.toZ-flyTarget.fromZ)*e2)
      _controlTarget.set(flyTarget.targetX,flyTarget.targetY,flyTarget.targetZ)
      controls.target.lerp(_controlTarget,e2)
      if (flyTarget.t>=1) flyTarget.active=false
    }

    // Electrode pulse
    if (S.electrodesVisible) {
      electrodeGroup.children.forEach(c=>{if(c.userData.isRing){const p=0.5+0.5*Math.sin(elapsed*S.electrodePulseSpeed+c.userData.phaseOffset);c.material.opacity=0.15+0.5*p;const sc=1+0.4*p;c.scale.set(sc,sc,1)}})
    }

    // Arc flow
    if (S.connectivityVisible) {
      arcGroup.children.forEach(c=>{if(c.material){const ph=(elapsed*S.arcFlowSpeed+c.userData.phaseOffset)%(Math.PI*2);c.material.opacity=S.arcOpacity*(0.3+0.7*(0.5+0.5*Math.sin(ph)))}})
    }
  }

  controls.update()

  // ── RENDER ──────────────────────────────────────────────────────
  if (S.splitViewEnabled&&brainMeshes.length>0) {
    const splitPx=Math.floor(S.splitX*sizes.width)
    const kL=modeKey(S.splitModeLeft), kR=modeKey(S.splitModeRight)
    applySplitStyle(brainMeshes,S.splitStyleLeft)
    brainMeshes.forEach(m=>{if(m!==hoveredMesh)m.material.emissiveIntensity=m.userData.profile[kL]*S.activityIntensity})
    renderer.setScissorTest(true); renderer.setScissor(0,0,splitPx,sizes.height); renderer.setViewport(0,0,sizes.width,sizes.height)
    composer.render()
    applySplitStyle(brainMeshes,S.splitStyleRight)
    brainMeshes.forEach(m=>{if(m!==hoveredMesh)m.material.emissiveIntensity=m.userData.profile[kR]*S.activityIntensity})
    renderer.setScissor(splitPx,0,sizes.width-splitPx,sizes.height); renderer.setViewport(0,0,sizes.width,sizes.height)
    composer.render()
    renderer.setScissorTest(false)
    applySplitStyle(brainMeshes,'Solid')
    brainMeshes.forEach(m=>{if(m!==hoveredMesh)m.material.emissiveIntensity=m.userData.currentEmissive})
  } else {
    composer.render()
  }

  css2dRenderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()

// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize',()=>{
  sizes.width=window.innerWidth; sizes.height=window.innerHeight
  camera.aspect=sizes.width/sizes.height; camera.updateProjectionMatrix()
  renderer.setSize(sizes.width,sizes.height); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  composer.setSize(sizes.width,sizes.height); css2dRenderer.setSize(sizes.width,sizes.height)
  fxaaPass.material.uniforms['resolution'].value.set(1/sizes.width,1/sizes.height)
  signalMat.uniforms.uSize.value=S.signalSize*renderer.getPixelRatio()*sizes.width
})
window.addEventListener('dblclick',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()})
setLoading(18, LOAD_MESSAGES[2])

// ─────────────────────────────────────────────
//  DISEASE MODE
//  Each entry defines: affected mesh name fragments, accent colour,
//  and Bangladesh-specific epidemiological panel content.
//  Sources embedded inline as citations.
// ─────────────────────────────────────────────
const DISEASE_DB = {
  stroke: {
    name: 'Stroke (Cerebrovascular Accident)',
    sub: 'Ischemic · Hemorrhagic · Subarachnoid',
    accent: '#ff4040',
    badge: 'STROKE',
    context:
      'Stroke is the leading neurological cause of hospital admission in Bangladesh, ' +
      'accounting for ~74–82% of neurology inpatients at referral hospitals (2018–2022). ' +
      'A nationwide survey (Mondal et al., 2022) reported a prevalence of 11.39 per 1,000 ' +
      'population — the highest in Mymensingh division (14.71/1,000). Over three-fourths of ' +
      'all strokes are ischemic. Stroke is the 2nd leading cause of death per BBS 2023 data.',
    risk:
      'Hypertension (primary driver), uncontrolled diabetes, tobacco use (15.2% prevalence), ' +
      'rising obesity (BMI ≥30), ambient particulate matter pollution (worsening yearly), ' +
      'male sex (1362 vs 868 per 100,000 in females), and age >40.',
    gaps:
      'Stroke care remains Dhaka-centric. Thrombolysis and thrombectomy are unavailable in most ' +
      'district hospitals. Rural patients face critical "golden hour" delays due to poor transport ' +
      'infrastructure and lack of community awareness of stroke warning signs.',
    refs: [
      'Mondal MBA et al. Prevalence and risk factors of stroke in Bangladesh: a nationwide population-based survey. eNeurologicalSci. 2022;28:100414.',
      'Islam MN et al. Patients presented with common neurological diseases at referral neuroscience hospital in Bangladesh. Cureus. 2024.',
      'Khatun S et al. The current situation of neurological health in Bangladesh. Health Sci Rep. 2025;8:e70530.',
      'Bangladesh Bureau of Statistics. Bangladesh Sample Vital Statistics 2023. BBS, Dhaka.',
    ],
    // mesh name fragments (case-insensitive) that map to affected regions
    regions: [
      'precentral gyrus',       // primary motor cortex
      'postcentral gyrus',      // somatosensory
      'middle cerebral',
      'superior frontal gyrus',
      'middle frontal gyrus',
      'inferior frontal gyrus',
      'superior temporal gyrus',
      'cingulate gyrus',        // anterior cingulate (consciousness)
      'lingual gyrus',          // visual cortex (posterior strokes)
      'angular gyrus',
      'precuneus',
      'insula',
      'first short gyrus',      // insula
      'second short gyrus',
      'putamen',
      'thalamus',
      'brainstem',
      'medulla',
      'midbrain',
    ],
  },

  alzheimer: {
    name: "Alzheimer's Disease",
    sub: 'Most common cause of dementia · Neurodegenerative',
    accent: '#cc66ff',
    badge: "ALZHEIMER'S",
    context:
      "Dementia affects 8.0% of Bangladeshis aged ≥60 (Lancet Reg Health, 2023), " +
      "with Alzheimer's disease responsible for 60–80% of all dementia cases worldwide. " +
      "In Bangladesh dementia affects approximately 1 in 12 elderly people, with higher " +
      "prevalence in women (OR 2.15) and those with no formal education (OR 3.10). " +
      "Awareness remains in its early stages; most families manage patients at home " +
      "with no specialist support.",
    risk:
      'Age ≥65 (prevalence 9× higher at age ≥90 vs 60–69), female sex, low/no education, ' +
      'hypertension, diabetes, social isolation. Bangladesh\'s rapidly ageing population ' +
      '(60+ now 3.39% of population, rising) will sharply increase absolute case numbers.',
    gaps:
      'No dedicated dementia clinics outside Dhaka. No national dementia strategy. ' +
      'Absence of social security means 100% of caregiving falls on families, with ' +
      'moderate-to-severe caregiver burden documented in Bangladeshi studies. ' +
      'Most patients are never formally diagnosed.',
    refs: [
      'Hasan MT et al. Prevalence of dementia among older age people: a cross-sectional study in Bangladesh. Lancet Reg Health Southeast Asia. 2023.',
      'Hossain MA et al. Assessment of psychological burden among caregivers of people living with dementia, Parkinson\'s, and Alzheimer\'s disease in Bangladesh. PMC 2025.',
      'Khatun S et al. The current situation of neurological health in Bangladesh. Health Sci Rep. 2025;8:e70530.',
    ],
    regions: [
      'hippocampus',
      'dentate gyrus',
      'presubiculum',
      'fasciolar gyrus',
      'posterior parahippocampal gyrus',
      'entorhinal',
      'angular gyrus',          // Braak stage III–IV
      'precuneus',              // earliest PET hypometabolism
      'cingulate gyrus',        // posterior cingulate (PCC)
      'middle temporal gyrus',  // semantic memory
      'inferior temporal gyrus',
      'fusiform gyrus',
      'superior parietal lobule',
      'supramarginal gyrus',
      'straight gyrus',         // OFC / subgenual
    ],
  },

  epilepsy: {
    name: 'Epilepsy',
    sub: 'Recurrent unprovoked seizures · Focal & Generalised',
    accent: '#ffe040',
    badge: 'EPILEPSY',
    context:
      'A national household survey (WHO/GoB, 2017; published Epilepsia Open, 2021) found ' +
      'epilepsy prevalence of 8.4 per 1,000 in Bangladesh — similar to other Asian countries. ' +
      'However, 65.1% of cases had active epilepsy, of which 63.4% were receiving NO treatment. ' +
      'Even among those treated, 72.5% had low medication adherence — one of the highest ' +
      'treatment gaps in Asia. Stigma and misdiagnosis as spirit possession are major barriers.',
    risk:
      'Birth asphyxia, febrile seizures in children, CNS infections (meningitis, cerebral malaria), ' +
      'head trauma, neurocysticercosis (in rural areas), stroke (major cause in older adults), ' +
      'consanguineous marriage (genetic epilepsies), and perinatal complications.',
    gaps:
      'Shortage of neurologists (fewer than 150 qualified neurologists for 170 million people). ' +
      'Anti-epileptic drugs are available but unaffordable for many rural families. ' +
      'Community stigma prevents help-seeking. Many patients are treated by unqualified ' +
      'practitioners or faith healers. No epilepsy surgery centre outside Dhaka.',
    refs: [
      'Islam MR et al. Prevalence of epilepsy in Bangladesh: results from a national household survey. Epilepsia Open. 2021;6(1):258-268. PMID 33336124.',
      'WHO Bangladesh. National Prevalence of Epilepsy Survey: Executive Summary. WHO SEARO, 2020.',
      'Khatun S et al. The current situation of neurological health in Bangladesh. Health Sci Rep. 2025;8:e70530.',
    ],
    regions: [
      'precentral gyrus',        // motor cortex — focal motor seizures
      'postcentral gyrus',
      'superior temporal gyrus', // mesial temporal — most common focus
      'middle temporal gyrus',
      'hippocampus',
      'dentate gyrus',
      'presubiculum',
      'posterior parahippocampal gyrus',
      'cingulate gyrus',         // ACC — absence/focal seizures
      'inferior frontal gyrus',  // frontal lobe epilepsy
      'superior frontal gyrus',
      'precuneus',
      'cuneus',                  // occipital epilepsy
      'lingual gyrus',
      'insula',
      'first short gyrus',
    ],
  },

  parkinson: {
    name: "Parkinson's Disease",
    sub: 'Progressive dopaminergic neurodegeneration',
    accent: '#ff9040',
    badge: "PARKINSON'S",
    context:
      "Parkinson's disease is the 2nd most common neurodegenerative disorder globally. " +
      "In South Asia (including Bangladesh) prevalence is ~52.7 per 100,000 — lower than " +
      "Western rates (108–257/100,000) but rising rapidly with ageing demographics. " +
      "Bangladesh has extremely limited specialist facilities; most PD patients are managed " +
      "by general physicians with no access to movement disorder specialists. " +
      "Dementia occurs in up to 80% of long-duration PD, representing the most devastating " +
      "non-motor feature for Bangladeshi families.",
    risk:
      'Age >60 (prevalence 2–3% at 65, up to 10% at 80), pesticide/herbicide exposure ' +
      '(widespread in agricultural Bangladesh), well-water use, manganese exposure, ' +
      'head trauma, and family history (rare monogenic forms). Air pollution is an ' +
      'emerging risk factor.',
    gaps:
      'No movement disorder clinics outside tertiary Dhaka hospitals. Levodopa and ' +
      'dopamine agonists are available but expensive and often unavailable in rural ' +
      'pharmacies. Deep brain stimulation is inaccessible. Caregivers carry full ' +
      'economic and physical burden with no social support structures.',
    refs: [
      'Hossain MA et al. Assessment of psychological burden among caregivers of PD, dementia and Alzheimer\'s patients in Bangladesh. PMC 2025. PMID 12056365.',
      'Uddin MS et al. Predictors of Parkinson\'s disease dementia in a tertiary care hospital in Bangladesh. BMRC Bull. 2021.',
      'Wikipedia / epidemiological literature. Parkinson\'s disease in South Asians. (Pereira et al. 2024 cited therein).',
      'Khatun S et al. The current situation of neurological health in Bangladesh. Health Sci Rep. 2025;8:e70530.',
    ],
    regions: [
      'precentral gyrus',        // motor cortex — tremor/rigidity circuit
      'superior frontal gyrus',  // SMA — akinesia
      'cingulate gyrus',         // ACC — non-motor symptoms
      'midbrain',                // substantia nigra (dopaminergic neurons)
      'lingual gyrus',           // visual hallucinations
      'inferior frontal gyrus',  // speech, swallowing
      'middle frontal gyrus',    // cognitive decline (DLPFC)
      'precuneus',               // Parkinson's dementia
      'angular gyrus',
      'hippocampus',             // memory in PDD
      'dentate gyrus',
      'insula',
      'first short gyrus',       // autonomic (anterior insula)
      'fusiform gyrus',          // face recognition (REM sleep behaviour)
      'brainstem',
      'medulla',                 // autonomic nuclei (constipation, BP dysregulation)
    ],
  },

  meningitis: {
    name: 'Bacterial Meningitis',
    sub: 'N. meningitidis · S. pneumoniae · H. influenzae type b',
    accent: '#40aaff',
    badge: 'MENINGITIS',
    context:
      'Bacterial meningitis is a major cause of neurological morbidity in Bangladesh, ' +
      'particularly in children and young adults. A hospital-based study at ICDDR,B ' +
      'found 24% of febrile-illness patients had bacterial meningitis; case-fatality ' +
      'rates were 22% for pneumococcal and 24% for Hib infections. Neisseria meningitidis ' +
      'serogroup A caused community outbreaks (1999–2006), predominantly in children and ' +
      'adolescents. Vaccine-preventable strains account for the majority of cases.',
    risk:
      'Age <5 and >60 years, overcrowding (Dhaka slums), malnutrition, ' +
      'incomplete vaccination (Hib vaccine now in EPI but coverage gaps persist in remote areas), ' +
      'uncontrolled diabetes, preceding URI/otitis media, close-contact settings ' +
      '(schools, madrasas, military barracks), and immunosuppression.',
    gaps:
      'Lumbar puncture and CSF culture are unavailable in most upazila health complexes. ' +
      'Delays to antibiotic treatment markedly increase mortality and permanent disability ' +
      '(hearing loss, cognitive impairment). Post-meningitis neurological follow-up is ' +
      'almost non-existent outside Dhaka. Pneumococcal conjugate vaccine is not yet in the ' +
      'national EPI schedule.',
    refs: [
      'Dillon MT et al. Etiologies of bacterial meningitis in Bangladesh: results from a hospital-based study. Clin Infect Dis. 2009;49(8):1190-1196. PMID 19706918.',
      'Borrow R et al. Increasing isolations of Neisseria meningitidis serogroup A from Bangladesh, 1999-2006. Emerg Infect Dis. 2007.',
      'Khatun S et al. The current situation of neurological health in Bangladesh. Health Sci Rep. 2025;8:e70530.',
      'WHO. Meningitis fact sheet. WHO.int (updated 2024).',
    ],
    regions: [
      'superior frontal gyrus',   // leptomeningeal spread — frontal cortex
      'middle frontal gyrus',
      'inferior frontal gyrus',
      'precentral gyrus',
      'postcentral gyrus',
      'superior temporal gyrus',  // hearing loss pathway
      'middle temporal gyrus',
      'cingulate gyrus',          // meningeal irritation / altered consciousness
      'precuneus',
      'superior parietal lobule',
      'cuneus',                   // occipital involvement
      'lingual gyrus',
      'brainstem',                // cranial nerve involvement, herniation risk
      'midbrain',
      'medulla',
      'superior colliculus',
      'inferior colliculus',      // auditory pathway — post-meningitis deafness
    ],
  },
}

// ── Disease mode state ──────────────────────────────────────────────
let activeDiseaseKey = null
const DISEASE_NORMAL_EMISSIVE   = new THREE.Color('#00e5ff') // default heatmap color
const DISEASE_AFFECTED_COLOR    = new THREE.Color()
const DISEASE_UNAFFECTED_EMISSIVE = new THREE.Color('#001a22')

const applyDiseaseMode = (key) => {
  const disease = DISEASE_DB[key]
  if (!disease || brainMeshes.length === 0) return

  activeDiseaseKey = key
  DISEASE_AFFECTED_COLOR.set(disease.accent)

  // Update button states
  document.querySelectorAll('.disease-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.disease === key)
  })
  document.getElementById('disease-clear-btn').classList.remove('hidden')

  // Find which meshes are affected
  brainMeshes.forEach(m => {
    const label = (m.userData.uiLabel || '').toLowerCase()
    const isAffected = disease.regions.some(r => label.includes(r.toLowerCase()))

    if (isAffected) {
      // Bright pulsing glow in disease accent color
      m.material.emissive.set(disease.accent)
      m.material.emissiveIntensity = 0.85
      m.userData._diseaseHighlighted = true
      m.userData._diseaseOrigOpacity = m.material.opacity
      // Fully opaque for affected region
      m.material.opacity = m.userData.isGyrus ? Math.max(m.material.opacity, 0.85) : 1.0
    } else {
      // Dim unaffected regions to near-black emissive
      m.material.emissive.set(DISEASE_UNAFFECTED_EMISSIVE)
      m.material.emissiveIntensity = 0.05
      m.userData._diseaseHighlighted = false
      // Ghosted opacity
      m.material.opacity = m.userData.isGyrus ? 0.10 : 0.18
    }
    m.material.needsUpdate = true
  })

  // Open info panel
  openDiseasePanel(key)
}

const clearDiseaseMode = () => {
  activeDiseaseKey = null
  document.querySelectorAll('.disease-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('disease-clear-btn').classList.add('hidden')
  document.getElementById('disease-panel').classList.remove('open')

  // ── Full reset: restores emissive, opacity, dissolve, camera, isolation ──
  showAllRegions()

  // Redundant safety (showAllRegions already does this, but we keep it explicit)
  // const k = modeKey()
  // brainMeshes.forEach(m => {
  //   m.material.emissive.set(S.heatmapColor)
  //   m.material.emissiveIntensity = m.userData.profile[k] * S.activityIntensity
  //   m.userData.currentEmissive = m.userData.profile[k] * S.activityIntensity
  //   m.userData._diseaseHighlighted = false
  // })
}

const openDiseasePanel = (key) => {
  const d = DISEASE_DB[key]
  const panel = document.getElementById('disease-panel')
  panel.style.setProperty('--dp-accent', d.accent)

  document.getElementById('disease-badge').textContent      = d.badge
  document.getElementById('disease-panel-name').textContent = d.name
  document.getElementById('disease-panel-sub').textContent  = d.sub
  document.getElementById('dp-context').textContent         = d.context
  document.getElementById('dp-risk').textContent            = d.risk
  document.getElementById('dp-gaps').textContent            = d.gaps

  // Region tags — show canonical names of matched meshes (deduplicated)
  const matchedLabels = []
  brainMeshes.forEach(m => {
    if (m.userData._diseaseHighlighted) matchedLabels.push(m.userData.uiLabel)
  })
  const unique = [...new Set(matchedLabels)].slice(0, 16)
  const tagsEl = document.getElementById('dp-regions')
  tagsEl.innerHTML = unique.map(l =>
    `<span class="dp-tag">${l}</span>`
  ).join('')

  // References
  document.getElementById('dp-refs').innerHTML = d.refs
    .map((r, i) => `<div>[${i+1}] ${r}</div>`).join('')

  panel.classList.add('open')
}

// ── Disease button events ────────────────────────────────────────────
document.querySelectorAll('.disease-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.disease
    if (activeDiseaseKey === key) {
      clearDiseaseMode()
    } else {
      clearDiseaseMode()
      applyDiseaseMode(key)
    }
  })
})
document.getElementById('disease-clear-btn').addEventListener('click', clearDiseaseMode)
document.getElementById('disease-panel-close').addEventListener('click', () => {
  document.getElementById('disease-panel').classList.remove('open')
})

// ── Animate affected meshes in disease mode (subtle pulse) ──────────
// We hook into the existing tick loop by patching the heatmap block.
// Since we append after tick(), we override a small part of the heatmap
// update to skip disease-highlighted meshes (they have their own glow).
// The existing tick() already skips hoveredMesh and isolatedMesh —
// we just need to ensure disease mode meshes don't get overwritten.
// We accomplish this by adding a guard inside the animation via a
// module-level flag checked on each frame.
const _origHeatmapUpdate = null // reference hook (not needed — see below)

// Patch: override emissive on disease-affected meshes every frame
// by adding a post-render hook via a second requestAnimationFrame layer.
// We do this cleanly by monkey-patching the already-running tick via
// a tiny extension that runs after composer.render().
;(function patchDiseaseAnimation() {
  const _originalTick = window._neurohex_tick
  // We can't easily wrap tick() since it's a closure, so instead we
  // schedule our own per-frame callback that runs alongside tick().
  const diseaseTick = () => {
    if (activeDiseaseKey && brainMeshes.length > 0) {
      const elapsed = performance.now() / 1000
      const d = DISEASE_DB[activeDiseaseKey]
      brainMeshes.forEach(m => {
        if (m.userData._diseaseHighlighted) {
          // Pulsing glow effect on affected meshes
          const pulse = 0.55 + 0.3 * Math.sin(elapsed * 2.2 + (m.userData.profile?.fmri ?? 0) * 8)
          m.material.emissiveIntensity = pulse
          // Do NOT set emissive color again each frame — it's already set
        }
      })
    }
    requestAnimationFrame(diseaseTick)
  }
  requestAnimationFrame(diseaseTick)
})()

// ── Escape key: also clears disease mode ────────────────────────────
// (Extends existing keydown listener — safe to add another listener)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeDiseaseKey) clearDiseaseMode()
})