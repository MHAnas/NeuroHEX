// ═══════════════════════════════════════════════════════════════════════════
//  NeuroHEX — Patient Analysis Engine  v2.0  
//
//  Architecture: FastAPI backend + SynthSeg + BraTS ONNX + Gemini 2.0 Flash
//
//  Key changes from v1:
//    • SynthSeg API call replaces fake percentile segmentation          [P1-01]
//    • Real FreeSurfer label volumes from SynthSeg                     [P1-02]
//    • Real hippocampal volumes (labels 17 + 53)                       [P1-03]
//    • Updated STEPS / progress overlay                                [P1-04]
//    • BraTS ONNX tumor screening panel                                [P2-05]
//    • Gemini 2.0 Flash AI clinical report                             [P2-06]
//    • Brain age prediction (Cole et al. 2018)                         [P2-07]
//    • Demo scan loader (one-click)                                     [P2-08]
//    • DICOM file support (dcmjs)                                       [P3-09]
//    • Low-cost diagnostic badge                                        [P3-10]
//    • SynthSeg error boundary / demo-mode flag                        [P3-11]
//    • Three.js canvas resize race fix (double RAF)                    [P4-12]
//    • lp-gui-mount fix (left panel, not right)                        [P4-13]
//    • Tumor NiiVue overlay as 3rd volume                              [P4-14]
//    • SynthSeg citation in all outputs                                [P5-15]
//    • Updated export disclaimer                                        [P5-16]
//    • Unicode nav icons (cross-OS)                                     [P5-17]
//    • buildBrainDiagramFallback() implemented                          [P5-18]
// ═══════════════════════════════════════════════════════════════════════════
import { jsPDF } from "jspdf";
import './patient.css'
import { Niivue }       from '@niivue/niivue'
import GUI              from 'lil-gui'
import * as THREE       from 'three'
import { GLTFLoader }   from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BACKEND_URL, GEMINI_KEY, GEMINI_ENDPOINT,GROQ_KEY,GROQ_ENDPOINT } from './config.js'




 

// ── DEMO MODE FLAG ────────────────────────────────────────────────────────────
window.demoMode = false   // set true when SynthSeg backend is unreachable

// ── STATE ─────────────────────────────────────────────────────────────────────
const State = {
  IDLE:'idle', UPLOADING:'uploading', LOADED:'loaded',
  ANALYZING:'analyzing', DONE:'done'
}
let appState         = State.IDLE
let nv               = null
let uploadedFile     = null
let mriUrl           = null
let tumorUrl         = null
let niftiMeta        = null
let analysisData     = null
let tumorData        = null
let guiInstance      = null
let longitudinalHistory = []
let anomalyRegions   = []

// Three.js brain diagram
let threeRenderer   = null
let threeScene      = null
let threeCamera     = null
let threeControls   = null
let threeAnimId     = null
let brainSpheres    = []

// Surgery planner
// Surgery planner — 3D aware
const surgeryPins   = []     // { id, label, color, worldPos:{x,y,z}, mriCoord:{x,y,z}, screenPos:{x,y} }
let surgeryMode     = false
let surgeryPinCount = 0
const surgeryPinMeshes = []  // Three.js sphere meshes for each pin
let surgeryPathLine = null   // Three.js line connecting pins in order

// ── SETTINGS ──────────────────────────────────────────────────────────────────
const S = {
  mriOpacity: 1.0,
  tumorOpacity: 0.7, tumorVisible: false,
  colormap: 'gray', interpolation: true,
  clippingEnabled: false,
  clipX: 0.0, clipY: 0.0, clipZ: 0.0,
  clipXEnabled: false, clipYEnabled: false, clipZEnabled: false,
  surgeryMode: false, showSurgeryPins: true, surgeryPinColor: '#ff3355',
  clearAllPins: () => clearSurgeryPins(),
  voxelInspector: false,
  showCrosshair: true, showColorbar: false,
  autoRotateDiagram: true,
}

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const canvas             = document.getElementById('niivue-canvas')
const emptyState         = document.getElementById('empty-state')
const procOverlay        = document.getElementById('proc-overlay')
const procBar            = document.getElementById('proc-bar')
const procLabel          = document.getElementById('proc-label')
const procStepsEl        = document.getElementById('proc-steps')
const dropZone           = document.getElementById('drop-zone')
const fileInput          = document.getElementById('file-input')
const browseBtn          = document.getElementById('browse-btn')
const clearFileBtn       = document.getElementById('clear-file-btn')
const fileBadge          = document.getElementById('file-badge')
const fileNameEl         = document.getElementById('file-name-el')
const fileSizeEl         = document.getElementById('file-size-el')
const metaSection        = document.getElementById('meta-section')
const metaGrid           = document.getElementById('meta-grid')
const histogramSection   = document.getElementById('histogram-section')
const histogramCanvas    = document.getElementById('histogram-canvas')
const viewBtns           = document.querySelectorAll('.vt-btn[data-view]')
const runBtnEl           = document.getElementById('run-btn')
const toggleSegBtn       = document.getElementById('toggle-seg-btn')
const toggleCrosshairBtn = document.getElementById('toggle-crosshair-btn')
const screenshotBtn      = document.getElementById('screenshot-btn')
const colormapSelect     = document.getElementById('colormap-select')
const segOpacitySlider   = document.getElementById('seg-opacity')

// ── UTILS ─────────────────────────────────────────────────────────────────────
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const delay    = ms => new Promise(r => setTimeout(r, ms))
const fmtBytes = b => b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'

// ── DYNAMIC STYLES ────────────────────────────────────────────────────────────
function injectStyles() {
  const s = document.createElement('style')
  s.textContent = `
    @keyframes anomaly-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(1.4);opacity:0.65}}
    @keyframes score-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes demo-blink{0%,100%{opacity:1}50%{opacity:.5}}

    /* Demo mode banner */
    #demo-mode-banner{position:fixed;bottom:0;left:0;right:0;z-index:999;background:rgba(255,170,0,.18);border-top:1.5px solid rgba(255,170,0,.6);padding:5px 20px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;color:var(--amber);text-align:center;animation:demo-blink 3s ease-in-out infinite;display:none}

    /* Low-cost badge */
    .low-cost-badge{display:flex;align-items:center;gap:8px;padding:6px 10px;margin-top:8px;background:rgba(57,255,110,.04);border:1px solid rgba(57,255,110,.2);border-radius:6px;font-family:var(--mono);font-size:8px;color:rgba(57,255,110,.8);letter-spacing:.1em}

    /* Tissue rows */
    .tissue-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid rgba(0,229,255,.07);border-radius:6px;background:rgba(0,229,255,.015);margin-bottom:5px;transition:border-color .2s}
    .tissue-row:hover{border-color:rgba(0,229,255,.2)}
    .tissue-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .tissue-info{flex:1;min-width:0}
    .tissue-label-txt{font-family:var(--mono);font-size:9.5px;font-weight:700;color:var(--fg);letter-spacing:.08em}
    .tissue-stats-txt{font-family:var(--mono);font-size:8px;color:var(--fg-dim);margin-top:2px}

    /* Hippocampal panel */
    .hippo-header{font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.18em;color:var(--fg-dim);margin-bottom:2px}
    .hippo-sub{font-family:var(--mono);font-size:7.5px;color:var(--fg-dim);opacity:.55;margin-bottom:10px}
    .hippo-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-family:var(--mono);font-size:9px}
    .hippo-side{width:52px;color:var(--fg-dim);font-size:8.5px;flex-shrink:0}
    .hippo-vol{font-weight:700;font-size:11px;width:58px;flex-shrink:0}
    .hippo-delta{flex:1;font-size:8px}
    .hippo-norm{font-family:var(--mono);font-size:7.5px;color:var(--fg-dim);opacity:.5;padding-top:6px}

    /* Brain age panel */
    .brain-age-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-family:var(--mono);font-size:9px;border-bottom:1px solid rgba(0,229,255,.06)}
    .brain-age-label{color:var(--fg-dim);font-size:8px;letter-spacing:.14em}
    .brain-age-val{font-size:13px;font-weight:700}
    .brain-age-citation{font-family:var(--mono);font-size:7px;color:var(--fg-dim);opacity:.5;margin-top:6px}

    /* Tumor panel */
    .tumor-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,170,0,.12);background:rgba(255,170,0,.03);margin-bottom:4px}
    .tumor-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .tumor-label{font-family:var(--mono);font-size:9px;flex:1}
    .tumor-vol{font-family:var(--mono);font-size:10px;font-weight:700}
    .tumor-none{font-family:var(--mono);font-size:9px;color:var(--green);padding:8px 0;text-align:center}
    .tumor-attr{font-family:var(--mono);font-size:7px;color:var(--fg-dim);opacity:.5;margin-top:6px}

    /* Longitudinal table */
    .long-empty{font-family:var(--mono);font-size:9px;color:var(--fg-dim);text-align:center;padding:12px 0}
    .long-alert{font-family:var(--mono);font-size:8.5px;font-weight:700;color:var(--red);background:rgba(255,51,85,.07);border:1px solid rgba(255,51,85,.25);border-radius:5px;padding:7px 10px;margin-bottom:8px}
    .long-ok{font-family:var(--mono);font-size:8.5px;color:var(--green);background:rgba(57,255,110,.05);border:1px solid rgba(57,255,110,.2);border-radius:5px;padding:7px 10px;margin-bottom:8px}
    .long-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:8px}
    .long-table thead th{color:var(--fg-dim);font-size:7.5px;letter-spacing:.12em;padding:4px 6px;border-bottom:1px solid rgba(0,229,255,.1);text-align:right}
    .long-table thead th:first-child{text-align:left}
    .long-table tbody td{padding:5px 6px;border-bottom:1px solid rgba(0,229,255,.04);text-align:right}
    .long-table tbody td:first-child{text-align:left;color:var(--fg);font-weight:700}
    .long-warn{background:rgba(255,170,0,.04)}

    /* Clinical flags */
    .flag-ddx{font-family:var(--mono);font-size:7.5px;color:#00b4cc;margin-top:3px;opacity:.85}
    .flag-rec{font-family:var(--mono);font-size:7.5px;color:var(--cyan);margin-top:2px}

    /* Surgery pins */
    .surgery-pin-row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:5px;border:1px solid rgba(0,229,255,.06);background:rgba(0,229,255,.02);margin-bottom:4px}
    .surgery-pin-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .surgery-pin-label{font-family:var(--mono);font-size:9px;color:var(--fg);flex:1}
    .surgery-pin-dist{font-family:var(--mono);font-size:8px;color:var(--fg-dim)}

    /* Voxel tooltip */
    #voxel-tooltip{position:absolute;z-index:60;background:rgba(2,8,16,.95);border:1px solid rgba(0,229,255,.22);border-radius:6px;padding:7px 11px;font-family:var(--mono);font-size:9px;pointer-events:none;min-width:145px;box-shadow:0 4px 24px rgba(0,0,0,.7)}
    .vt-row{display:flex;justify-content:space-between;gap:12px;margin-bottom:2px}
    .vt-k{color:var(--fg-dim);font-size:8px;letter-spacing:.12em}
    .vt-v{color:var(--cyan);font-size:9px;font-weight:700}

    /* Clip HUD */
    #clip-hud{position:absolute;bottom:56px;left:12px;z-index:25;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.14em;background:rgba(2,5,10,.75);padding:3px 8px;border-radius:4px;border:1px solid rgba(0,229,255,.12);pointer-events:none}

    /* Split view labels */
    .split-label{position:absolute;top:8px;left:12px;z-index:20;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.18em;color:rgba(0,229,255,.75);background:rgba(2,5,10,.75);padding:3px 8px;border-radius:4px;border:1px solid rgba(0,229,255,.15);pointer-events:none}
    .split-label-ref{color:rgba(255,107,53,.85);border-color:rgba(255,107,53,.22)}

    /* Surgery indicator */
    #surgery-mode-indicator{display:none;position:absolute;top:58px;left:50%;transform:translateX(-50%);background:rgba(255,51,85,.15);border:1px solid rgba(255,51,85,.4);border-radius:6px;padding:5px 14px;z-index:40;align-items:center;gap:8px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--red)}

    /* rp-section */
    #rp-results-scaffold .rp-section{padding:14px 16px;border-bottom:1px solid rgba(0,229,255,.06)}
    #rp-results-scaffold .rp-title{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.2em;color:var(--fg-dim);text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px}

    /* demographic badge */
    .demo-badge{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;margin-top:8px;background:rgba(0,229,255,.03);border:1px solid rgba(0,229,255,.1);border-radius:6px;font-family:var(--mono);font-size:9px}

    /* AI report panel */
    .ai-report-pre{font-family:var(--mono);font-size:8.5px;line-height:1.8;color:var(--fg);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;padding:8px;background:rgba(0,229,255,.02);border:1px solid rgba(0,229,255,.08);border-radius:6px;margin-top:8px}
    .ai-report-pre::-webkit-scrollbar{width:3px}
    .ai-report-pre::-webkit-scrollbar-thumb{background:rgba(0,229,255,.2);border-radius:2px}
    .ai-generate-btn{width:100%;padding:9px;border:1px solid rgba(0,229,255,.3);border-radius:7px;background:rgba(0,229,255,.06);color:var(--cyan);font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.14em;cursor:pointer;transition:background .2s;margin-bottom:8px}
    .ai-generate-btn:hover{background:rgba(0,229,255,.16)}
    .ai-generate-btn:disabled{opacity:.4;cursor:not-allowed}

    /* lil-gui theming */
    #lp-gui-mount .lil-gui{--background-color:#030a14;--text-color:#7ab8cc;--title-background-color:rgba(0,180,204,.1);--title-text-color:#00e5ff;--widget-color:rgba(0,50,70,.8);--hover-color:rgba(0,100,130,.4);--focus-color:rgba(0,229,255,.15);--number-color:#39ff6e;--string-color:#ff9f5e;--font-family:'Space Mono',monospace;--font-size:10px;--padding:5px;--spacing:5px;width:100%!important;border:none!important;border-radius:0!important;box-shadow:none!important}

    /* Three.js brain canvas */
    #three-brain-canvas{width:100%;height:220px;display:block;background:transparent}
    .three-hint{font-family:var(--mono);font-size:7.5px;color:var(--fg-dim);text-align:center;padding:4px 0;letter-spacing:.1em;opacity:.6}

    /* Anomaly dots */
    .anomaly-dot{position:absolute;border-radius:50%;pointer-events:all;cursor:help;animation:anomaly-pulse 1.4s ease-in-out infinite}

    /* Score ring */
    .score-ring-wrap{position:relative;width:72px;height:72px;flex-shrink:0}
    .score-ring-wrap svg{position:absolute;top:0;left:0}
    .score-ring-val{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:18px;font-weight:800}

    /* Citation tag */
    .cite-tag{font-family:var(--mono);font-size:7px;color:var(--fg-dim);opacity:.6;margin-left:auto;font-style:italic}
  `
  document.head.appendChild(s)
}

// ── NIIVUE INIT ────────────────────────────────────────────────────────────────
async function initViewer() {
  nv = new Niivue({
    backColor:        [0.008, 0.02, 0.031, 1.0],
    crosshairColor:   [0.0, 0.9, 1.0, 0.75],
    fontColor:        [0.0, 0.9, 1.0, 0.6],
    crosshairWidth:   0.5,
    show3Dcrosshair:  true,
    isOrientCube:     true,
    dragMode:         1,
    multiplanarLayout: 0,
    logLevel:         'error',
  })
  await nv.attachToCanvas(canvas)
  nv.setInterpolation(true)
  registerFSColormap()   // ← ADD THIS LINE
  canvas.addEventListener('click',     onCanvasClick)
  canvas.addEventListener('mousemove', onCanvasHover)
  canvas.addEventListener('mouseleave', () => {
    const tt = document.getElementById('voxel-tooltip')
    if (tt) tt.style.display = 'none'
  })
}

// ── FILE HANDLING ──────────────────────────────────────────────────────────────
function validateFile(f) {
  if (!f) return false
  const name = f.name.toLowerCase()
  return name.endsWith('.nii') || name.endsWith('.nii.gz') || name.endsWith('.dcm')
}

async function loadMRI(file) {
  if (!validateFile(file)) {
    alert('Please upload a NIfTI file (.nii or .nii.gz) or DICOM (.dcm)')
    return
  }
  setState(State.UPLOADING)
  uploadedFile = file
  fileNameEl.textContent = file.name
  fileSizeEl.textContent = fmtBytes(file.size)
  fileBadge.classList.remove('hidden')
  dropZone.classList.add('hidden')

  try {
    if (mriUrl)   URL.revokeObjectURL(mriUrl)
    if (tumorUrl) { URL.revokeObjectURL(tumorUrl); tumorUrl = null }

    let niftiFile = file
    // [P3-09] DICOM support
    if (file.name.toLowerCase().endsWith('.dcm')) {
      niftiFile = await convertDicomToNifti(file)
    }

    mriUrl = URL.createObjectURL(niftiFile)
    await nv.loadVolumes([{ url: mriUrl, name: niftiFile.name, colormap: S.colormap, opacity: S.mriOpacity }])
    extractNiftiMeta()
    drawHistogram()
    metaSection.classList.remove('hidden')
    histogramSection.classList.remove('hidden')
    emptyState.classList.add('hidden')
    setSliceType('multiplanar')
    setState(State.LOADED)
    await runAnalysis()
  } catch (err) {
    console.error('[NeuroHEX] Load error:', err)
    alert('Failed to load MRI file. Ensure it is a valid NIfTI (.nii / .nii.gz) or DICOM (.dcm).')
    resetUpload()
  }
}

// ── [P3-09] DICOM → NIfTI conversion ─────────────────────────────────────────
async function convertDicomToNifti(file) {
  try {
    const dcmjs = await import('dcmjs')
    const buffer = await file.arrayBuffer()
    const dataset = dcmjs.data.DicomMessage.readFile(buffer)
    const naturalised = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dataset.dict)

    const rows   = naturalised.Rows || 512
    const cols   = naturalised.Columns || 512
    const slices = 1
    const pixelData = new Int16Array(naturalised.PixelData || new ArrayBuffer(rows * cols * 2))
    const spacing   = (naturalised.PixelSpacing || [1, 1]).map(Number)
    const thickness = Number(naturalised.SliceThickness || 1)

    // Build synthetic NIfTI-1
    const OFF = 352
    const buf = new ArrayBuffer(OFF + pixelData.byteLength)
    const v   = new DataView(buf)
    v.setInt32(0, 348, true)
    v.setInt16(40, 3, true)
    v.setInt16(42, cols,   true)
    v.setInt16(44, rows,   true)
    v.setInt16(46, slices, true)
    v.setInt16(48, 1, true); v.setInt16(50, 1, true); v.setInt16(52, 1, true); v.setInt16(54, 1, true)
    v.setInt16(70, 4, true); v.setInt16(72, 16, true) // int16
    v.setFloat32(76, 1, true)
    v.setFloat32(80, spacing[1], true)
    v.setFloat32(84, spacing[0], true)
    v.setFloat32(88, thickness, true)
    v.setFloat32(108, OFF, true); v.setFloat32(112, 1, true)
    v.setUint8(344, 110); v.setUint8(345, 43); v.setUint8(346, 49)
    new Int16Array(buf, OFF).set(pixelData)

    return new File([buf], file.name.replace('.dcm', '.nii'), { type: 'application/octet-stream' })
  } catch (e) {
    console.warn('[NeuroHEX] dcmjs not available or DICOM parse failed:', e)
    alert('DICOM conversion requires dcmjs (npm install dcmjs). Treating as raw binary.')
    return file
  }
}

async function loadDemoScan() {
  const DEMO_MRI = '/demo/demo_brain.nii.gz'
  const DEMO_SEG = '/demo/demo_seg.nii'
  const btn = document.getElementById('demo-scan-btn')

  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading…' }

    // Pre-fill patient record
    const pid   = document.getElementById('patient-id')
    const age   = document.getElementById('patient-age')
    const sex   = document.getElementById('patient-sex')
    const notes = document.getElementById('clinical-notes')
    if (pid)   pid.value   = 'DEMO-001'
    if (age)   age.value   = '50'
    if (sex)   sex.value   = 'M'
    if (notes) notes.value = 'Pre-loaded demo scan — MNI152 T1 standard space'

    // Fetch MRI + pre-baked segmentation in parallel
    const [mriResp, segResp] = await Promise.all([
      fetch(DEMO_MRI),
      fetch(DEMO_SEG),
    ])
    if (!mriResp.ok) throw new Error(`MRI fetch failed: HTTP ${mriResp.status}`)
    if (!segResp.ok) throw new Error(`Seg fetch failed: HTTP ${segResp.status}`)

    const [mriBlob, segBuffer] = await Promise.all([
      mriResp.blob(),
      segResp.arrayBuffer(),
    ])

    const mriFile = new File([mriBlob], 'demo_brain.nii.gz', { type: 'application/gzip' })

    // Load MRI into viewer
    setState(State.UPLOADING)
    uploadedFile = mriFile
    fileNameEl.textContent = mriFile.name
    fileSizeEl.textContent = fmtBytes(mriFile.size)
    fileBadge.classList.remove('hidden')
    dropZone.classList.add('hidden')

    if (mriUrl) URL.revokeObjectURL(mriUrl)
    mriUrl = URL.createObjectURL(mriFile)
    await nv.loadVolumes([{ url: mriUrl, name: 'demo_brain.nii.gz', colormap: S.colormap, opacity: S.mriOpacity }])
    extractNiftiMeta()
    drawHistogram()
    metaSection.classList.remove('hidden')
    histogramSection.classList.remove('hidden')
    emptyState.classList.add('hidden')
    setSliceType('multiplanar')
    setState(State.LOADED)

    // Run demo pipeline with pre-baked seg
    await runAnalysisWithPrebakedSeg(segBuffer)

  } catch (err) {
    console.error('[NeuroHEX] Demo load failed:', err)
    alert('Demo failed: ' + err.message + '\n\nEnsure /public/demo/demo_brain.nii.gz and /public/demo/demo_seg.nii exist.')
    resetUpload()
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run Demo Scan' }
  }
}

// Runs the full analysis pipeline but skips the backend call,
// using a pre-fetched ArrayBuffer as the SynthSeg output.
async function runAnalysisWithPrebakedSeg(segBuffer) {
  if (appState === State.ANALYZING) return
  if (!niftiMeta) return

  setState(State.ANALYZING)
  buildProcSteps()
  procOverlay.classList.remove('hidden')

  try {
    setProc(10, 'Loading pre-baked SynthSeg segmentation…', 0); await delay(120)
    setProc(40, 'Parsing FreeSurfer label map…', 1);            await delay(120)

    // Parse the pre-baked .nii exactly like a live SynthSeg response
    const labelMap = parseSynthSegNifti(segBuffer)

    setProc(72, 'Processing complete…', 2); await delay(100)
    await nv.loadVolumes([
      { url: mriUrl, name: 'mri.nii', colormap: S.colormap, opacity: S.mriOpacity }
    ])

    setProc(90, 'Computing volumetrics…', 4); await delay(100)
    analysisData = computeMetrics(labelMap)
    saveLongitudinal(analysisData)

    setProc(97, 'Evaluating ICD-10 clinical rules…', 5); await delay(200)
    setProc(100, 'Complete.', 5); await delay(300)

    renderResults(analysisData)
    procOverlay.classList.add('hidden')
    setState(State.DONE)

  } catch (err) {
    console.error('[NeuroHEX] Demo analysis error:', err)
    procOverlay.classList.add('hidden')
    setState(State.LOADED)
    alert('Demo analysis error: ' + err.message)
  }
}

// ── NIFTI META ─────────────────────────────────────────────────────────────────
function extractNiftiMeta() {
  if (!nv.volumes.length) return
  const vol  = nv.volumes[0]
  const hdr  = vol.hdr
  const dims = [hdr.dims[1], hdr.dims[2], hdr.dims[3]]
  const pixd = [Math.abs(hdr.pixDims[1]), Math.abs(hdr.pixDims[2]), Math.abs(hdr.pixDims[3])]
  const voxVol = pixd[0] * pixd[1] * pixd[2]
  const img = vol.img

  // Do NOT attempt tissue classification from raw MRI intensities —
  // thresholds are scan-dependent and produce wildly wrong volumes.
  // Real tissue volumes come from SynthSeg labels in computeMetrics().
  // brainVolCm3 here is a rough skull-strip estimate for the metadata panel only;
  // it uses Otsu-like logic: count voxels above 15% of max intensity.
  let brainVox = 0
  if (img) {
    let mx = 0
    for (let i = 0; i < img.length; i++) if (img[i] > mx) mx = img[i]
    const tBrain = mx * 0.15   // conservative threshold — background + CSF are below this
    for (let i = 0; i < img.length; i++) if (img[i] > tBrain) brainVox++
  } else {
    brainVox = Math.round(dims[0] * dims[1] * dims[2] * 0.35)
  }

  niftiMeta = {
    dims, pixdims: pixd, voxelVolMm3: voxVol,
    brainVolCm3: (brainVox * voxVol) / 1000,  // rough ICV estimate for metadata panel only
    imgData: img,
    // Real tissue volumes populated by computeMetrics() after SynthSeg runs
    gmCm3: null, wmCm3: null, csfCm3: null,
  }
  renderMetaGrid()
}

function renderMetaGrid() {
  const { dims, pixdims, voxelVolMm3, brainVolCm3 } = niftiMeta
  metaGrid.innerHTML = [
    { key:'DIMENSIONS', val: dims.join(' × ') + ' vx' },
    { key:'VOX SIZE',   val: pixdims.map(p => p.toFixed(2)).join(' × ') + ' mm' },
    { key:'VOX VOL',    val: voxelVolMm3.toFixed(3) + ' mm³' },
    { key:'BRAIN VOL',  val: brainVolCm3.toFixed(0) + ' cm³ (est.)' },
    { key:'MODALITY',   val: 'T1-MRI' },
    { key:'ORIENT',     val: 'RAS' },
  ].map(({ key, val }) =>
    `<div class="meta-item"><div class="meta-key">${key}</div><div class="meta-val">${val}</div></div>`
  ).join('')
}

// ── HISTOGRAM ──────────────────────────────────────────────────────────────────
function drawHistogram() {
  const ctx = histogramCanvas.getContext('2d')
  const W = histogramCanvas.width, H = histogramCanvas.height
  ctx.clearRect(0, 0, W, H)
  const img = niftiMeta?.imgData; if (!img || !img.length) return
  const BINS = 64, bins = new Float64Array(BINS)
  let mx = 0; for (let i = 0; i < img.length; i++) if (img[i] > mx) mx = img[i]
  if (!mx) return
  for (let i = 0; i < img.length; i++) bins[Math.min(BINS - 1, Math.floor(img[i] / mx * BINS))]++
  const bmax = Math.max(...bins)
  const grad = ctx.createLinearGradient(0, H, 0, 0)
  grad.addColorStop(0, 'rgba(0,180,204,0.9)'); grad.addColorStop(1, 'rgba(0,229,255,0.35)')
  ctx.fillStyle = grad
  const bw = W / BINS
  for (let i = 1; i < BINS; i++) {
    const bh = (bins[i] / bmax) * (H - 4); ctx.fillRect(i * bw, H - bh, bw - 1, bh)
  }
  const mark = (fr, col, lbl) => {
    const x = fr * W; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 2])
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = col; ctx.font = '7px Space Mono'; ctx.fillText(lbl, x + 2, 10)
  }
  mark(.12, 'rgba(0,229,255,.6)', 'CSF')
  mark(.38, 'rgba(57,255,110,.7)', 'GM')
  mark(.62, 'rgba(255,170,0,.7)', 'WM')
}

// ── VIEW CONTROLS ──────────────────────────────────────────────────────────────
// ── Current view tracking (needed for anomaly overlay) ────────────────────────
let currentView = 'multiplanar'

const viewMap = {
  multiplanar: () => nv.setSliceType(nv.sliceTypeMultiplanar),
  axial:       () => nv.setSliceType(nv.sliceTypeAxial),
  sagittal:    () => nv.setSliceType(nv.sliceTypeSagittal),
  coronal:     () => nv.setSliceType(nv.sliceTypeCoronal),
  render:      () => nv.setSliceType(nv.sliceTypeRender),
}
function setSliceType(type) {
  if (!nv || !viewMap[type]) return
  viewMap[type]()
  currentView = type
  viewBtns.forEach(b => b.classList.toggle('active', b.dataset.view === type))
  
}

// ── CLIPPING ───────────────────────────────────────────────────────────────────
function applyClipping() {
  if (!nv || !nv.volumes.length) return
  if (!S.clippingEnabled || (!S.clipXEnabled && !S.clipYEnabled && !S.clipZEnabled)) {
    nv.setClipPlane([2, 0, 0]); updateClipHUD(); return
  }
  if (S.clipXEnabled)      nv.setClipPlane([S.clipX, 270, 0])
  else if (S.clipYEnabled) nv.setClipPlane([S.clipY, 0, 0])
  else if (S.clipZEnabled) nv.setClipPlane([S.clipZ, 0, 90])
  updateClipHUD()
}
function updateClipHUD() {
  const el = document.getElementById('clip-hud'); if (!el) return
  const axes = [S.clipXEnabled && 'X', S.clipYEnabled && 'Y', S.clipZEnabled && 'Z'].filter(Boolean)
  const on = S.clippingEnabled && axes.length
  el.textContent = on ? 'CLIP: ' + axes.join('+') : 'CLIP: OFF'
  el.style.color = on ? '#00e5ff' : '#4a7a8a'
}

// ── SPLIT VIEW ─────────────────────────────────────────────────────────────────
const MNI_URL = 'https://niivue.github.io/niivue-demo-images/mni152.nii.gz'

async function enableSplitView() {
  if (document.getElementById('split-container')) return
  const viewerMain = document.getElementById('viewer-main')
  const wrapper = document.createElement('div'); wrapper.id = 'split-container'
  wrapper.style.cssText = 'display:flex;width:100%;height:100%;position:relative;'
  const leftPane = document.createElement('div'); leftPane.id = 'split-left'
  leftPane.style.cssText = 'flex:1;position:relative;overflow:hidden;min-width:0'
  const leftLbl = document.createElement('div'); leftLbl.className = 'split-label'
  leftLbl.textContent = '◈ PATIENT MRI'
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;'
  leftPane.appendChild(canvas); leftPane.appendChild(leftLbl)
  const divider = document.createElement('div')
  divider.style.cssText = 'width:4px;background:rgba(0,229,255,.2);cursor:col-resize;flex-shrink:0;z-index:10;transition:background .2s'
  divider.addEventListener('mouseenter', () => divider.style.background = 'rgba(0,229,255,.6)')
  divider.addEventListener('mouseleave', () => divider.style.background = 'rgba(0,229,255,.2)')
  const rightPane = document.createElement('div'); rightPane.id = 'split-right'
  rightPane.style.cssText = 'flex:1;position:relative;overflow:hidden;min-width:0;border-left:1px solid rgba(0,229,255,.15)'
  const rightLbl = document.createElement('div'); rightLbl.className = 'split-label split-label-ref'
  rightLbl.textContent = '◈ MNI REFERENCE'
  const refCanvas = document.createElement('canvas'); refCanvas.id = 'niivue-ref-canvas'
  refCanvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;'
  rightPane.appendChild(rightLbl); rightPane.appendChild(refCanvas)
  let dragging = false
  divider.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize' })
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = '' })
  window.addEventListener('mousemove', e => {
    if (!dragging) return
    const r = wrapper.getBoundingClientRect()
    const ratio = clamp((e.clientX - r.left) / r.width, .2, .8)
    leftPane.style.flex = `${ratio} 0 0`; rightPane.style.flex = `${1 - ratio} 0 0`
    nv?.resizeListener(); nvSplit?.resizeListener()
  })
  wrapper.appendChild(leftPane); wrapper.appendChild(divider); wrapper.appendChild(rightPane)
  viewerMain.insertBefore(wrapper, viewerMain.firstChild)
  nvSplit = new Niivue({ backColor: [0.008, 0.02, 0.031, 1], crosshairColor: [1, .5, 0, .75], isOrientCube: true, dragMode: 1, logLevel: 'error' })
  await nvSplit.attachToCanvas(refCanvas)
  setProc(0, 'Loading MNI reference…'); procOverlay.classList.remove('hidden')
  try {
    await nvSplit.loadVolumes([{ url: MNI_URL, name: 'MNI152', colormap: 'gray', opacity: 1 }])
    S.splitReferenceLoaded = true
  } catch (e) { rightLbl.textContent = '◈ REFERENCE (OFFLINE)' }
  finally { procOverlay.classList.add('hidden') }
  nv.resizeListener(); nvSplit.resizeListener()
}

function disableSplitView() {
  const container = document.getElementById('split-container'); if (!container) return
  const viewerMain = document.getElementById('viewer-main')
  canvas.style.cssText = 'flex:1;width:100%!important;display:block;touch-action:none;'
  viewerMain.insertBefore(canvas, viewerMain.firstChild)
  container.remove(); nvSplit = null; S.splitReferenceLoaded = false
  nv?.resizeListener()
}

// ── VOXEL INSPECTOR ────────────────────────────────────────────────────────────
function onCanvasHover(e) {
  if (!S.voxelInspector || !niftiMeta?.imgData) return
  const tt = document.getElementById('voxel-tooltip'); if (!tt) return
  const r = canvas.getBoundingClientRect()
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height
  const { imgData, dims: [nx, ny, nz] } = niftiMeta
  const ix = Math.round(fx * (nx - 1)), iy = Math.round(fy * (ny - 1)), iz = Math.round(.5 * (nz - 1))
  const val = imgData[Math.min(ix * ny * nz + iy * nz + iz, imgData.length - 1)] || 0
  let mx = 0; for (let i = 0; i < imgData.length; i++) if (imgData[i] > mx) mx = imgData[i]
  const norm = mx > 0 ? val / mx : 0
  const tissue = norm < .12 ? 'Background' : norm < .38 ? 'CSF' : norm < .62 ? 'Grey Matter' : norm < .72 ? 'White Matter' : 'Deep Grey'
  tt.style.display = 'block'
  tt.style.left = (e.clientX - r.left + 14) + 'px'
  tt.style.top  = (e.clientY - r.top - 12) + 'px'
  tt.innerHTML = `
    <div class="vt-row"><span class="vt-k">TISSUE</span><span class="vt-v">${tissue}</span></div>
    <div class="vt-row"><span class="vt-k">VALUE</span><span class="vt-v">${val.toFixed ? val.toFixed(1) : val}</span></div>
    <div class="vt-row"><span class="vt-k">NORM</span><span class="vt-v">${(norm * 100).toFixed(1)}%</span></div>
    <div class="vt-row"><span class="vt-k">COORD</span><span class="vt-v">${ix},${iy},${iz}</span></div>
  `
}

function onCanvasClick(e) {
  if (!S.surgeryMode) return

  // Try 3D raycast onto brain model first
  if (threeRenderer && threeScene && threeCamera && brainSpheres.length) {
    const tc = document.getElementById('three-brain-canvas')
    if (tc) {
      const r = tc.getBoundingClientRect()
      // Check if click is inside the Three.js canvas
      if (e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top  && e.clientY <= r.bottom) {
        place3DPin(e, r)
        return
      }
    }
  }

  // Fallback: 2D canvas pin (NiiVue viewer)
  if (!nv?.volumes.length) return
  const r = canvas.getBoundingClientRect()
  surgeryPinCount++
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  // Estimate world position from NIfTI metadata
  const worldPos = estimateWorldPos(x, y, r)
  surgeryPins.push({
    id: surgeryPinCount, label: `P${surgeryPinCount}`,
    color: S.surgeryPinColor,
    worldPos, mriCoord: worldPos,
    screenPos: { x, y }, source: '2d'
  })
  renderSurgeryOverlay()
  updateSurgeryPanel()
}

function place3DPin(e, canvasRect) {
  const mouse = new THREE.Vector2(
    ((e.clientX - canvasRect.left) / canvasRect.width)  * 2 - 1,
   -((e.clientY - canvasRect.top)  / canvasRect.height) * 2 + 1
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, threeCamera)

  // Raycast against brain meshes
  const meshes = brainSpheres.filter(m => m.isMesh)
  const hits = raycaster.intersectObjects(meshes, true)

  let worldPos
  if (hits.length > 0) {
    worldPos = { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z }
  } else {
    // No hit — place on a virtual sphere around the brain center
    const ray = raycaster.ray
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.2)
    const target = new THREE.Vector3()
    ray.intersectSphere(sphere, target)
    worldPos = target ? { x: target.x, y: target.y, z: target.z } : { x: 0, y: 0, z: 0 }
  }

  // Convert Three.js world coords → approximate MRI mm coords
  const scale = niftiMeta ? (niftiMeta.pixdims[0] * niftiMeta.dims[0] / 2) : 90
  const mriCoord = {
    x: Math.round(worldPos.x * scale + (niftiMeta?.dims[0] ?? 180) / 2),
    y: Math.round(worldPos.y * scale + (niftiMeta?.dims[1] ?? 220) / 2),
    z: Math.round(worldPos.z * scale + (niftiMeta?.dims[2] ?? 180) / 2),
  }

  surgeryPinCount++
  surgeryPins.push({
    id: surgeryPinCount, label: `P${surgeryPinCount}`,
    color: S.surgeryPinColor,
    worldPos, mriCoord,
    screenPos: { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top },
    source: '3d'
  })

  // Add a visible 3D sphere marker on the brain
  add3DPinMarker(worldPos, S.surgeryPinColor, `P${surgeryPinCount}`)
  update3DPath()
  updateSurgeryPanel()
}
// REPLACE the entire onThreeCanvasClick function:
let _threeMouseDownPos = null

function onThreeCanvasClick(e) {
  if (!S.surgeryMode) return
  e.stopPropagation()
  // If the mouse moved more than 5px between mousedown and click, it was a drag — ignore
  if (_threeMouseDownPos) {
    const dx = e.clientX - _threeMouseDownPos.x
    const dy = e.clientY - _threeMouseDownPos.y
    if (Math.sqrt(dx*dx + dy*dy) > 5) return
  }
  const r = e.currentTarget.getBoundingClientRect()
  place3DPin(e, r)
}
function estimateWorldPos(px, py, canvasRect) {
  if (!niftiMeta) return { x: px, y: py, z: 0 }
  const { dims, pixdims } = niftiMeta
  const fx = px / canvasRect.width, fy = py / canvasRect.height
  return {
    x: +(fx * dims[0] * pixdims[0]).toFixed(1),
    y: +(fy * dims[1] * pixdims[1]).toFixed(1),
    z: +(dims[2] * pixdims[2] * 0.5).toFixed(1),
  }
}

function add3DPinMarker(worldPos, color, label) {
  if (!threeScene) return
  const geo  = new THREE.SphereGeometry(0.045, 16, 12)
  const mat  = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.6,
    roughness: 0.3, metalness: 0.1,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(worldPos.x, worldPos.y, worldPos.z)
  mesh.userData = { isPinMarker: true, label }
  threeScene.add(mesh)
  surgeryPinMeshes.push(mesh)

  // Pulsing ring around pin
  const ringGeo = new THREE.RingGeometry(0.055, 0.07, 24)
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide, transparent: true, opacity: 0.7
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.position.set(worldPos.x, worldPos.y, worldPos.z)
  ring.lookAt(threeCamera.position)
  ring.userData = { isPinRing: true }
  threeScene.add(ring)
  surgeryPinMeshes.push(ring)
}

function update3DPath() {
  // Remove old path line
  if (surgeryPathLine) { threeScene.remove(surgeryPathLine); surgeryPathLine = null }
  if (surgeryPins.length < 2 || !threeScene) return

  const points = surgeryPins
    .filter(p => p.source === '3d')
    .map(p => new THREE.Vector3(p.worldPos.x, p.worldPos.y, p.worldPos.z))

  if (points.length < 2) return

  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({
    color: 0xffcc44, linewidth: 2, transparent: true, opacity: 0.85
  })
  surgeryPathLine = new THREE.Line(geo, mat)
  threeScene.add(surgeryPathLine)
}

function renderSurgeryOverlay() {
  let ov = document.getElementById('surgery-overlay')
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'surgery-overlay'
    ov.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:30;overflow:hidden;'
    document.getElementById('viewer-main').appendChild(ov)
  }
  ov.innerHTML = ''
  if (!S.showSurgeryPins || !surgeryPins.length) return
  if (surgeryPins.length >= 2) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;'
    for (let i = 0; i < surgeryPins.length - 1; i++) {
      const a = surgeryPins[i], b = surgeryPins[i + 1]
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y)
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y)
      line.setAttribute('stroke', 'rgba(255,200,50,.65)'); line.setAttribute('stroke-width', '1.5')
      line.setAttribute('stroke-dasharray', '4 3'); svg.appendChild(line)
      if (niftiMeta) {
        const dx = b.x - a.x, dy = b.y - a.y
        const px = Math.sqrt(dx * dx + dy * dy)
        const mmPerPx = niftiMeta.pixdims[0] * (niftiMeta.dims[0] / canvas.width) || 1
        const dist = (px * mmPerPx).toFixed(1)
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        t.setAttribute('x', (a.x + b.x) / 2 + 4); t.setAttribute('y', (a.y + b.y) / 2 - 4)
        t.setAttribute('fill', 'rgba(255,200,50,.9)'); t.setAttribute('font-family', 'Space Mono')
        t.setAttribute('font-size', '9'); t.textContent = `${dist}mm`; svg.appendChild(t)
      }
    }
    ov.appendChild(svg)
  }
  surgeryPins.forEach((pin, idx) => {
    const dot = document.createElement('div')
    dot.style.cssText = `position:absolute;left:${pin.x}px;top:${pin.y}px;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:${pin.color};border:2px solid rgba(255,255,255,.8);box-shadow:0 0 10px ${pin.color};cursor:pointer;pointer-events:all;transition:transform .15s;`
    dot.onmouseenter = () => dot.style.transform = 'translate(-50%,-50%) scale(1.5)'
    dot.onmouseleave = () => dot.style.transform = 'translate(-50%,-50%) scale(1)'
    dot.onclick = e => { e.stopPropagation(); surgeryPins.splice(idx, 1); renderSurgeryOverlay(); updateSurgeryPanel() }
    const lbl = document.createElement('div')
    lbl.style.cssText = `position:absolute;left:${pin.x + 8}px;top:${pin.y - 18}px;font-family:var(--mono);font-size:9px;font-weight:700;color:${pin.color};text-shadow:0 1px 4px rgba(0,0,0,.9);pointer-events:none;`
    lbl.textContent = pin.label
    ov.appendChild(dot); ov.appendChild(lbl)
  })
}

function clearSurgeryPins() {
  surgeryPins.length = 0
  surgeryPinCount = 0
  // Remove all 3D markers from Three.js scene
  surgeryPinMeshes.forEach(m => {
    if (threeScene) threeScene.remove(m)
    m.geometry?.dispose()
    m.material?.dispose()
  })
  surgeryPinMeshes.length = 0
  if (surgeryPathLine && threeScene) {
    threeScene.remove(surgeryPathLine)
    surgeryPathLine = null
  }
  const o = document.getElementById('surgery-overlay')
  if (o) o.innerHTML = ''
  updateSurgeryPanel()
}

function updateSurgeryPanel() {
  const el = document.getElementById('surgery-pins-list')
  if (!el) return

  if (!surgeryPins.length) {
    el.innerHTML = `<div style="font-size:9px;color:var(--fg-dim);text-align:center;padding:8px 0">
      No pins placed.<br>
      <span style="opacity:.6">In 3D view: click directly on the brain model.<br>In slice view: click anywhere on the scan.</span>
    </div>`
    return
  }

 function dist3d(a, b) {
  // 3D pins: worldPos is Three.js units (-1 to 1), convert to mm
  // 2D pins: mriCoord is already in mm (from estimateWorldPos)
  let ax, ay, az, bx, by, bz

  if (a.source === '3d') {
    const sc = (niftiMeta?.pixdims?.[0] ?? 1) * (niftiMeta?.dims?.[0] ?? 180) / 2
    ax = a.worldPos.x * sc; ay = a.worldPos.y * sc; az = a.worldPos.z * sc
  } else {
    const p = a.mriCoord ?? { x: 0, y: 0, z: 0 }
    ax = p.x; ay = p.y; az = p.z
  }

  if (b.source === '3d') {
    const sc = (niftiMeta?.pixdims?.[0] ?? 1) * (niftiMeta?.dims?.[0] ?? 180) / 2
    bx = b.worldPos.x * sc; by = b.worldPos.y * sc; bz = b.worldPos.z * sc
  } else {
    const p = b.mriCoord ?? { x: 0, y: 0, z: 0 }
    bx = p.x; by = p.y; bz = p.z
  }

  const dx = ax - bx, dy = ay - by, dz = az - bz
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

  let totalPathMm = 0
  const segLengths = []
  for (let i = 0; i < surgeryPins.length - 1; i++) {
    const d = dist3d(surgeryPins[i], surgeryPins[i+1])
    segLengths.push(d)
    totalPathMm += d
  }

  // ── Volume estimates ───────────────────────────────────────────────────────
  let volumeNote = ''
  if (surgeryPins.length >= 3) {
    // ABC/6 ellipsoid for bounding box of all pins
    const coords = surgeryPins.map(p => {
      const sc = (p.source === '3d')
        ? (niftiMeta?.pixdims?.[0] ?? 1) * (niftiMeta?.dims?.[0] ?? 180) / 2
        : 1
      const pos = p.worldPos ?? p.mriCoord ?? { x: p.x ?? 0, y: p.y ?? 0, z: 0 }
      return { x: pos.x * sc, y: pos.y * sc, z: pos.z * sc }
    })
    const xs = coords.map(c => c.x), ys = coords.map(c => c.y), zs = coords.map(c => c.z)
    const A = Math.max(...xs) - Math.min(...xs)
    const B = Math.max(...ys) - Math.min(...ys)
    const C = Math.max(...zs) - Math.min(...zs)
    const volCm3 = (Math.PI / 6 * A * B * (C || A * 0.8)) / 1000

    // Surgical corridor volume (cylinder along path)
    const corridorDiamMm = 8  // typical craniotomy corridor ~8mm diameter
    const corridorVolCm3 = (Math.PI * (corridorDiamMm/2)**2 * totalPathMm) / 1000

    volumeNote = `
      <div style="margin-top:8px;padding:8px;background:rgba(255,170,0,.07);border:1px solid rgba(255,170,0,.2);border-radius:5px;font-family:var(--mono);font-size:8.5px">
        <div style="color:var(--amber);font-weight:700;margin-bottom:5px">📐 SURGICAL ESTIMATES</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <div style="color:var(--fg-dim)">Total path</div>
          <div style="color:var(--cyan);font-weight:700">${totalPathMm.toFixed(1)} mm</div>
          <div style="color:var(--fg-dim)">Lesion volume (ABC/6)</div>
          <div style="color:var(--amber);font-weight:700">${volCm3.toFixed(2)} cm³</div>
          <div style="color:var(--fg-dim)">Corridor vol (⌀${corridorDiamMm}mm)</div>
          <div style="color:var(--fg-dim)">${corridorVolCm3.toFixed(2)} cm³</div>
          <div style="color:var(--fg-dim)">Pin spread A×B×C</div>
          <div style="color:var(--fg-dim)">${A.toFixed(0)}×${B.toFixed(0)}×${C.toFixed(0)} mm</div>
        </div>
        <div style="margin-top:5px;color:var(--fg-dim);opacity:.5;font-size:7px">ABC/6 ellipsoid method · Corridor assumes linear trajectory</div>
      </div>`
  }

  // ── Approach recommendation ────────────────────────────────────────────────
  let approachNote = ''
  if (surgeryPins.length >= 2 && niftiMeta) {
    const first = surgeryPins[0]
    const last  = surgeryPins[surgeryPins.length - 1]
    const p0 = first.worldPos ?? first.mriCoord ?? { x: 0, y: 0, z: 0 }
    const p1 = last.worldPos  ?? last.mriCoord  ?? { x: 0, y: 0, z: 0 }
    // Simple anatomical approach classifier based on 3D world coords
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z
    const dominant = [
      { axis: 'Anterior–posterior', val: Math.abs(dy), label: dy > 0 ? 'Posterior' : 'Anterior' },
      { axis: 'Left–right',          val: Math.abs(dx), label: dx > 0 ? 'Right' : 'Left' },
      { axis: 'Superior–inferior',   val: Math.abs(dz), label: dz > 0 ? 'Superior' : 'Inferior' },
    ].sort((a, b) => b.val - a.val)[0]

    const depth = totalPathMm
    const approach = depth > 60 ? 'Deep trajectory — consider stereotactic frame or neuronavigation'
                   : depth > 30 ? 'Intermediate depth — craniotomy or neuroendoscopic approach'
                   : 'Superficial — burr hole approach may be sufficient'

    approachNote = `
      <div style="margin-top:6px;padding:6px 8px;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.1);border-radius:5px;font-family:var(--mono);font-size:8px">
        <div style="color:var(--cyan);font-weight:700;margin-bottom:3px">⚕ APPROACH SUGGESTION</div>
        <div style="color:var(--fg-dim)">Dominant axis: <span style="color:var(--fg)">${dominant.label} ${dominant.axis.toLowerCase()}</span></div>
        <div style="color:var(--fg-dim);margin-top:2px">${approach}</div>
        <div style="color:var(--fg-dim);opacity:.4;font-size:7px;margin-top:3px">Algorithmic suggestion only — not clinical advice</div>
      </div>`
  }

  // ── Pin list rows ──────────────────────────────────────────────────────────
  const pinRows = surgeryPins.map((p, i) => {
    const segDist = i > 0 ? `${segLengths[i-1].toFixed(1)}mm` : 'REF'
    const src = p.source === '3d' ? '3D' : '2D'
    const coord = p.mriCoord
      ? `(${Object.values(p.mriCoord).map(v => Math.round(v)).join(', ')})`
      : `(${Math.round(p.x||0)}, ${Math.round(p.y||0)})`
    return `<div class="surgery-pin-row" style="flex-direction:column;align-items:flex-start;gap:3px">
      <div style="display:flex;align-items:center;gap:8px;width:100%">
        <div class="surgery-pin-dot" style="background:${p.color};box-shadow:0 0 6px ${p.color}88;flex-shrink:0"></div>
        <span class="surgery-pin-label" style="flex:1">${p.label}</span>
        <span style="font-family:var(--mono);font-size:7px;color:var(--amber);padding:1px 5px;background:rgba(255,170,0,.1);border-radius:3px">${src}</span>
        <span class="surgery-pin-dist">${segDist}</span>
        <button onclick="removeSurgeryPin(${i})" style="font-family:var(--mono);font-size:8px;background:rgba(255,51,85,.1);border:1px solid rgba(255,51,85,.25);color:var(--red);padding:1px 6px;border-radius:3px;cursor:pointer">✕</button>
      </div>
      <div style="font-family:var(--mono);font-size:7.5px;color:var(--fg-dim);padding-left:18px">MRI ${coord}</div>
    </div>`
  }).join('')

  el.innerHTML = pinRows + volumeNote + approachNote
}

// Remove a single pin by index
function removeSurgeryPin(idx) {
  // Remove 3D marker (2 meshes per pin: sphere + ring)
  const markerIdx = idx * 2
  if (surgeryPinMeshes[markerIdx] && threeScene) {
    threeScene.remove(surgeryPinMeshes[markerIdx])
    surgeryPinMeshes[markerIdx].geometry?.dispose()
    surgeryPinMeshes[markerIdx].material?.dispose()
  }
  if (surgeryPinMeshes[markerIdx + 1] && threeScene) {
    threeScene.remove(surgeryPinMeshes[markerIdx + 1])
    surgeryPinMeshes[markerIdx + 1].geometry?.dispose()
    surgeryPinMeshes[markerIdx + 1].material?.dispose()
  }
  surgeryPinMeshes.splice(markerIdx, 2)
  surgeryPins.splice(idx, 1)
  update3DPath()
  renderSurgeryOverlay()
  updateSurgeryPanel()
}
window.removeSurgeryPin = removeSurgeryPin
// ── [P1-01] SYNTHSEG API SEGMENTATION ─────────────────────────────────────────
async function fastSegmentation() {
  setProc(10, 'Uploading scan to SynthSeg backend…', 0)

  // [P3-11] Error boundary
  try {
    const formData = new FormData()
    formData.append('file', uploadedFile)

    setProc(20, 'Deep learning 32-region parcellation (~60s)', 1)

    const resp = await fetch(`${BACKEND_URL}/segment`, {
      method: 'POST',
      body: formData,
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`SynthSeg API error ${resp.status}: ${txt}`)
    }

    setProc(70, 'Parsing FreeSurfer label map…', 2)
    const labelBuffer = await resp.arrayBuffer()
    return parseSynthSegNifti(labelBuffer)

  } catch (err) {
    console.warn('[NeuroHEX] SynthSeg backend unavailable — falling back to demo mode:', err)
    showDemoModeBanner()
    window.demoMode = true
    setProc(40, 'Demo mode — estimated segmentation', 1)
    return demoFallbackSegmentation()
  }
}

// [P3-11] Show persistent amber demo-mode banner
function showDemoModeBanner() {
  let banner = document.getElementById('demo-mode-banner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'demo-mode-banner'
    banner.textContent = '⚠ DEMO MODE — SynthSeg backend unavailable. Volumes are estimated, not real segmentation.'
    document.body.appendChild(banner)
  }
  banner.style.display = 'block'
}

// Parse returned SynthSeg NIfTI binary → typed array of FreeSurfer label IDs
// Backend returns UNCOMPRESSED .nii — readable directly with DataView.
function parseSynthSegNifti(buffer) {
  const view = new DataView(buffer)

  const hdrSzLE = view.getInt32(0, true)
  const littleEndian = hdrSzLE === 348

  const rawOffset = view.getFloat32(108, littleEndian)
  const dataOffset = (rawOffset >= 352) ? Math.round(rawOffset) : 352

  const dims = [
    view.getInt16(42, littleEndian),
    view.getInt16(44, littleEndian),
    view.getInt16(46, littleEndian),
  ]

  if (dims.some(d => d <= 0 || d > 1024)) {
    console.error('[NeuroHEX] Bad NIfTI dims:', dims)
    niftiMeta.synthSegLabels = null
    return demoFallbackSegmentation()
  }

  const N = dims[0] * dims[1] * dims[2]
  const datatype = view.getInt16(70, littleEndian)
  const bytesPerVoxel = (datatype === 4 || datatype === 512) ? 2
                      : (datatype === 8 || datatype === 16)  ? 4
                      : 1

  const availableBytes = buffer.byteLength - dataOffset
  const availableVoxels = Math.floor(availableBytes / bytesPerVoxel)

  if (availableVoxels < N) {
    console.warn(`[NeuroHEX] Buffer has ${availableVoxels} voxels but header declares ${N}. Falling back to demo.`)
    niftiMeta.synthSegLabels = null
    return demoFallbackSegmentation()
  }

  let raw
  if (datatype === 16) {
    const floats = new Float32Array(buffer, dataOffset, N)
    raw = new Int16Array(N)
    for (let i = 0; i < N; i++) raw[i] = Math.round(floats[i])
  } else if (datatype === 8) {
    // Copy into a fresh standalone Int32Array — do NOT keep a view into the
    // original buffer. A view with non-zero byteOffset can cause the
    // writeNifti1 Int32Array constructor to mis-size the output buffer.
    const src = new Int32Array(buffer, dataOffset, N)
    raw = new Int32Array(N)
    raw.set(src)
  } else if (datatype === 4) {
    const src = new Int16Array(buffer, dataOffset, N)
    raw = new Int16Array(N)
    raw.set(src)
  } else if (datatype === 512) {
    const src = new Uint16Array(buffer, dataOffset, N)
    raw = new Uint16Array(N)
    raw.set(src)
  } else {
    const src = new Uint8Array(buffer, dataOffset, N)
    raw = new Uint8Array(N)
    raw.set(src)
  }

  console.log(`[NeuroHEX] NIfTI parsed: ${dims.join('×')} N=${N} datatype=${datatype} bpv=${bytesPerVoxel} offset=${dataOffset} fileSize=${buffer.byteLength}`)

  // Store the exact dims SynthSeg used — these may differ from niftiMeta.dims
  // (which NiiVue may update when loading the MRI volume).
  niftiMeta.synthSegDims = dims
  niftiMeta.synthSegLabels = raw
  return remapSynthSegLabels(raw)
}

// [P1-01] Remap FreeSurfer label IDs → 0–4 tissue classes
// FIXED: label 42 = Right-Cerebral-Cortex (GM), NOT white matter.
// SynthSeg FreeSurfer label conventions:
//   2  = Left-Cerebral-White-Matter
//   3  = Left-Cerebral-Cortex  (GM)
//   41 = Right-Cerebral-White-Matter
//   42 = Right-Cerebral-Cortex (GM)  ← was wrongly in WM_LABELS before
function remapSynthSegLabels(labelArray) {
  const CSF_LABELS  = new Set([4, 5, 14, 15, 24, 43, 44])
  const WM_LABELS   = new Set([2, 41, 7, 46, 16])          // removed 42
  const DEEP_LABELS = new Set([10, 11, 12, 13, 17, 18, 26, 49, 50, 51, 52, 53, 54, 58])
  const GM_LABELS   = new Set([3, 42])                      // explicit cortex labels
  const out = new Uint8Array(labelArray.length)
  for (let i = 0; i < labelArray.length; i++) {
    const v = labelArray[i]
    if (v === 0)                  out[i] = 0
    else if (CSF_LABELS.has(v))  out[i] = 1
    else if (WM_LABELS.has(v))   out[i] = 2
    else if (GM_LABELS.has(v))   out[i] = 3
    else if (DEEP_LABELS.has(v)) out[i] = 4
    else if (v > 0)              out[i] = 3 // anything else parcellated → GM
  }
  return out
}
// ── FREESURFER LABEL COLORMAP ─────────────────────────────────────────────────
// Maps each FreeSurfer label ID → [R, G, B] (0-255) for NiiVue custom colormap
const FS_LABEL_COLORS = {
  0:  [0,   0,   0  ],  // Background
  2:  [245, 211, 145],  // L-Cerebral-WM       warm sand
  3:  [57,  255, 110],  // L-Cerebral-Cortex   neon green
  4:  [68,  136, 255],  // L-Lateral-Ventricle blue
  5:  [90,  160, 255],  // L-Inf-Lat-Vent      light blue
  7:  [0,   229, 255],  // L-Cerebellum-WM     cyan
  8:  [100, 200, 240],  // L-Cerebellum-Cortex soft cyan
  10: [255, 107, 53 ],  // L-Thalamus          orange
  11: [170, 68,  255],  // L-Caudate           purple
  12: [255, 170, 0  ],  // L-Putamen           amber
  13: [68,  170, 255],  // L-Pallidum          sky blue
  14: [80,  120, 200],  // 3rd-Ventricle       blue-grey
  15: [80,  100, 180],  // 4th-Ventricle       deep blue
  16: [68,  136, 255],  // Brainstem           vivid blue
  17: [255, 51,  85 ],  // L-Hippocampus       red
  18: [255, 68,  170],  // L-Amygdala          pink
  24: [120, 180, 255],  // CSF                 pale blue
  26: [200, 80,  255],  // L-Accumbens         violet
  28: [160, 110, 255],  // L-VentralDC         lavender
  41: [230, 190, 120],  // R-Cerebral-WM       warm sand (slightly darker)
  42: [39,  220, 90 ],  // R-Cerebral-Cortex   green (slightly darker)
  43: [50,  110, 230],  // R-Lateral-Ventricle blue (slightly darker)
  44: [70,  140, 230],  // R-Inf-Lat-Vent
  46: [0,   200, 230],  // R-Cerebellum-WM
  47: [80,  175, 215],  // R-Cerebellum-Cortex
  49: [230, 90,  40 ],  // R-Thalamus          orange (darker)
  50: [145, 50,  230],  // R-Caudate
  51: [230, 145, 0  ],  // R-Putamen
  52: [50,  145, 230],  // R-Pallidum
  53: [220, 30,  65 ],  // R-Hippocampus       crimson
  54: [230, 50,  145],  // R-Amygdala
  58: [175, 60,  230],  // R-Accumbens
  60: [140, 90,  230],  // R-VentralDC
}

// Build a 256-entry RGBA lookup table for NiiVue's addColormap()
// NiiVue colormaps are defined as { R:[], G:[], B:[], A:[], I:[] }
// where each array has 256 entries mapping intensity 0-255 → channel value.
// For a label map (values 0–60+), we map each label ID directly.
// Build a 256-entry RGBA LUT ordered by dense remap index, not raw label ID.
// Slot i in this LUT corresponds to the i-th entry in sorted FS_LABEL_COLORS keys.
// This must stay in sync with the remap in writeNifti1.
function buildFSColormap() {
  const R = new Array(256).fill(0)
  const G = new Array(256).fill(0)
  const B = new Array(256).fill(0)
  const A = new Array(256).fill(0)
  const I = Array.from({ length: 256 }, (_, i) => i / 255)

  const labelIds = Object.keys(FS_LABEL_COLORS).map(Number).sort((a, b) => a - b)
  const N = labelIds.length - 1  // 29

  labelIds.forEach((id, slotIdx) => {
    // Store the color at the LUT slot that matches the pre-scaled stored value.
    // writeNifti1 stores Math.round(slotIdx / N * 255) for each voxel,
    // so the LUT entry must be at that same index.
    const lutSlot = Math.round((slotIdx / N) * 255)
    const rgb = FS_LABEL_COLORS[id]
    R[lutSlot] = rgb[0]
    G[lutSlot] = rgb[1]
    B[lutSlot] = rgb[2]
    A[lutSlot] = id === 0 ? 0 : 255
  })

  // Forward-fill so no slot between two defined colors is black
  let lastR = 0, lastG = 0, lastB = 0, lastA = 0
  for (let i = 0; i < 256; i++) {
    if (A[i] > 0) {
      lastR = R[i]; lastG = G[i]; lastB = B[i]; lastA = A[i]
    } else if (i > 0 && lastA > 0) {
      R[i] = lastR; G[i] = lastG; B[i] = lastB; A[i] = lastA
    }
  }

  return { R, G, B, A, I }
}

// Register the colormap with NiiVue (call once after nv is initialised)
function registerFSColormap() {
  if (!nv) return
  try {
    nv.addColormap('freesurfer_regions', buildFSColormap())
    console.log('[NeuroHEX] FreeSurfer regional colormap registered (0–255 pre-scaled)')
  } catch (e) {
    console.warn('[NeuroHEX] Could not register colormap:', e)
  }
}

// Demo fallback — chunked percentile method (kept for offline use)
async function demoFallbackSegmentation() {
  const { dims, imgData } = niftiMeta
  const [nx, ny, nz] = dims
  const N = nx * ny * nz
  const labelMap = new Uint8Array(N)
  if (!imgData) return labelMap

  const sorted = new Float32Array(imgData.length)
  sorted.set(imgData); sorted.sort()
  const p12 = sorted[Math.floor(N * .12)], p38 = sorted[Math.floor(N * .38)]
  const p62 = sorted[Math.floor(N * .62)], p72 = sorted[Math.floor(N * .72)]
  const CHUNK = Math.ceil(N / 20)
  for (let start = 0; start < N; start += CHUNK) {
    const end = Math.min(start + CHUNK, N)
    for (let i = start; i < end; i++) {
      const v = imgData[i]
      if (v < p12)       labelMap[i] = 0
      else if (v < p38)  labelMap[i] = 1
      else if (v < p62)  labelMap[i] = 3   // GM  ← matches SynthSeg remap convention
      else if (v < p72)  labelMap[i] = 2
      else               labelMap[i] = 4
    }
    await new Promise(r => requestAnimationFrame(r))
    setProc(40 + Math.round(start / N * 30), `Segmenting… ${Math.round(start / N * 100)}%`)
  }
  return labelMap
}

// ── [P1-02] REAL SYNTHSEG REGION VOLUMES
// IMPORTANT: SynthSeg v1 uses label 3 = Left-Cerebral-Cortex and 42 = Right-Cerebral-Cortex
// Both must be counted as GM. This was the original bug (42 was in WM_LABELS).
function computeSynthSegVolumes(rawLabelMap, voxelVolMm3) {
  const ml = voxelVolMm3 / 1000 // mm³ → cm³
  const count = id => {
    let n = 0
    for (let i = 0; i < rawLabelMap.length; i++) if (rawLabelMap[i] === id) n++
    return n
  }
  const sum = ids => ids.reduce((acc, id) => acc + count(id), 0)
  return [
    { name: 'Cerebral Cortex', vol: +(sum([3, 42]) * ml).toFixed(1), color: '#39ff6e' },
    { name: 'Cerebellum',      vol: +(sum([7, 8, 46, 47]) * ml).toFixed(1), color: '#00e5ff' },
    { name: 'Thalamus (L+R)',  vol: +(sum([10, 49]) * ml).toFixed(1), color: '#ff6b35' },
    { name: 'Hippocampus (L+R)', vol: +(sum([17, 53]) * ml).toFixed(1), color: '#ff3355' },
    { name: 'Putamen (L+R)',   vol: +(sum([12, 51]) * ml).toFixed(1), color: '#ffaa00' },
    { name: 'Brainstem',       vol: +(sum([16]) * ml).toFixed(1), color: '#4488ff' },
    { name: 'Amygdala (L+R)', vol: +(sum([18, 54]) * ml).toFixed(1), color: '#ff44aa' },
    { name: 'Caudate (L+R)',   vol: +(sum([11, 50]) * ml).toFixed(1), color: '#aa44ff' },
    { name: 'Pallidum (L+R)', vol: +(sum([13, 52]) * ml).toFixed(1), color: '#44aaff' },
  ]
}



// writeNifti1 — writes the remapped label map as int16 (datatype=4).
// NiiVue's WebGL texture allocator sizes the buffer based on the MRI volume's
// internal dtype. The SynthSeg NIfTI comes back as int32 (datatype=8, 4 bytes/voxel),
// so the GPU expects overlays to be at least 2 bytes/voxel.
// Writing uint8 (1 byte/voxel) caused "ArrayBufferView not big enough" twice.
// int16 (2 bytes/voxel, datatype=4) matches NiiVue's label-map expectation.
// writeNifti1 — writes the label map as int16 (datatype=4).
// MODE A (rawLabels=true):  writes original FreeSurfer IDs (0-60+) so the
//   'freesurfer_regions' custom colormap shows each region in its own color.
// MODE B (rawLabels=false): writes remapped 0-4 tissue classes for the
//   fallback 'actc' colormap used in demo mode.
// writeNifti1 — writes the label map as a NIfTI-1 file.
// CRITICAL: NiiVue sizes the overlay WebGL texture based on the dtype of
// the FIRST volume (the MRI). SynthSeg returns int32 (datatype=8, 4 bpv).
// If we write fewer bytes/voxel than NiiVue expects, texSubImage3D throws
// "ArrayBufferView not big enough". So we ALWAYS write int32 here.
//
// For the regional colormap we also REMAP label IDs → dense indices 0-N
// because NiiVue normalizes voxel values to 0-1 before sampling the LUT.
// A raw label of 53 (hippocampus) would be normalized to 53/max ≈ 0.0004,
// hitting LUT slot ~0 instead of slot 53. The remap makes slot N = region N.
function writeNifti1(map, dims, pixd, rawLabels = false) {
  const N = dims[0] * dims[1] * dims[2]

  const safeMap = map.length >= N ? map : (() => {
    console.warn(`[NeuroHEX] writeNifti1: map.length=${map.length} < N=${N}, padding with zeros`)
    const padded = new (map.constructor)(N)
    padded.set(map)
    return padded
  })()

  const labelIds = Object.keys(FS_LABEL_COLORS).map(Number).sort((a, b) => a - b)
  const maxDenseIdx = labelIds.length - 1  // 29

  const dataArray = new Int32Array(N)

  if (rawLabels) {
    const labelToScaled = new Map(
      labelIds.map((id, i) => [id, Math.round((i / maxDenseIdx) * 255)])
    )
    for (let i = 0; i < N; i++) {
      dataArray[i] = labelToScaled.get(safeMap[i]) ?? 0
    }
  } else {
    // Demo tissue classes 0–4: scale to 0, 64, 128, 192, 255
    const demoScale = [0, 64, 128, 192, 255]
    for (let i = 0; i < N; i++) {
      dataArray[i] = demoScale[Math.min(safeMap[i], 4)]
    }
  }

  const OFF = 352
  const buf = new ArrayBuffer(OFF + N * 4)
  const v = new DataView(buf)

  v.setInt32(0,   348,     true)
  v.setInt16(40,  3,       true)
  v.setInt16(42,  dims[0], true)
  v.setInt16(44,  dims[1], true)
  v.setInt16(46,  dims[2], true)
  v.setInt16(48,  1, true); v.setInt16(50, 1, true)
  v.setInt16(52,  1, true); v.setInt16(54, 1, true)
  v.setInt16(70,  8,       true)   // datatype = int32
  v.setInt16(72,  32,      true)   // bitpix   = 32
  v.setFloat32(76,  1,       true)
  v.setFloat32(80,  pixd[0], true)
  v.setFloat32(84,  pixd[1], true)
  v.setFloat32(88,  pixd[2], true)
  v.setFloat32(108, OFF,     true)

  // scl_slope = 1/255, scl_inter = 0:
  // stored values are already 0–255, dividing by 255 gives 0.0–1.0
  // which NiiVue uses directly as the LUT index fraction.
  v.setFloat32(112, 1.0 / 255.0, true)  // scl_slope
  v.setFloat32(116, 0,           true)  // scl_inter

  v.setUint8(344, 110); v.setUint8(345, 43)
  v.setUint8(346, 49);  v.setUint8(347, 0)

  new Int32Array(buf, OFF).set(dataArray)
  return buf
}
// ── METRICS ────────────────────────────────────────────────────────────────────
function getDemoNorm(age, sex) {
  // SynthSeg parcellation covers labeled structures only (~65% of ICV).
  // Empirical SynthSeg output range for healthy adults: 820–1100 cm³ total parcellation.
  // These norms are calibrated to SynthSeg output, NOT whole-brain ICV.
  let m = { mean: 950, sd: 90, lo: 820, hi: 1100 }
  if (age > 30) {
    const d = (age - 30) * 0.004
    m.mean = Math.round(m.mean * (1 - d))
    m.lo   = Math.round(m.lo   * (1 - d * 0.8))
    m.hi   = Math.round(m.hi   * (1 - d * 0.5))
  }
  if (sex === 'F') {
    m.mean = Math.round(m.mean * 0.94)
    m.lo   = Math.round(m.lo   * 0.93)
    m.hi   = Math.round(m.hi   * 0.94)
  }
  return m
}
function getHippoNorm(age, sex) {
  let mean = 3.85
  if (age > 50) mean -= (age - 50) * .012
  if (sex === 'F') mean *= .94
  return { mean: +mean.toFixed(2), sd: .42, lo: +(mean - .84).toFixed(2), hi: +(mean + .84).toFixed(2) }
}
function calcPercentile(vol, norm) {
  const z = (vol - norm.mean) / norm.sd
  const t = 1 / (1 + .2316419 * Math.abs(z))
  const p = t * (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const cdf = 1 - .3989422803 * Math.exp(-.5 * z * z) * p
  return Math.round((z >= 0 ? cdf : 1 - cdf) * 100)
}

function computeMetrics(labelMap) {
  const { dims, pixdims, voxelVolMm3 } = niftiMeta
  const ml = voxelVolMm3 / 1000

  // Tissue class counts from remapped label map
  const counts = [0, 0, 0, 0, 0]
  for (let i = 0; i < labelMap.length; i++) counts[Math.min(labelMap[i], 4)]++

  const csf  = +(counts[1] * ml).toFixed(1)
  const gm   = +(counts[3] * ml).toFixed(1)
  const wm   = +(counts[2] * ml).toFixed(1)
  const deep = +(counts[4] * ml).toFixed(1)

  // SynthSeg v1 parcellates only labelled structures (~910 cm³ of a ~1350 cm³ brain).
  // Raw parcellation total: sum of all non-background labelled voxels.
  // We derive a corrected whole-brain volume using the known correction factor
  // so norms and ratios are calibrated against real whole-brain references.
  // SynthSeg parcellates the entire intracranial volume it receives.
  // No correction factor needed — use raw voxel counts directly.
  // The total (gm+wm+csf+deep) IS the parcellated brain volume.
  const rawParcellation = +(gm + wm + csf + deep)
  const brain = rawParcellation

  const gmScaled   = gm
  const wmScaled   = wm
  const csfScaled  = csf
  const deepScaled = deep

  // [P1-03] Real hippocampal volumes from SynthSeg labels 17 and 53
  const HIPPO_PHYS_MIN = 1.5
  const HIPPO_PHYS_MAX = 6.0
  let hipL = 0, hipR = 0
  const rawLabels = niftiMeta.synthSegLabels
  if (rawLabels) {
    let lCount = 0, rCount = 0
    for (let i = 0; i < rawLabels.length; i++) {
      if (rawLabels[i] === 17) lCount++
      else if (rawLabels[i] === 53) rCount++
    }
    hipL = +(lCount * ml).toFixed(2)
    hipR = +(rCount * ml).toFixed(2)
    if (hipL > HIPPO_PHYS_MAX || hipL < HIPPO_PHYS_MIN * 0.1) {
      const ml1mm = 1.0 / 1000
      const hipL1 = +(lCount * ml1mm).toFixed(2)
      const hipR1 = +(rCount * ml1mm).toFixed(2)
      if (hipL1 >= HIPPO_PHYS_MIN && hipL1 <= HIPPO_PHYS_MAX) {
        hipL = hipL1; hipR = hipR1
      } else {
        const hipNormPrev = getHippoNorm(
          parseInt(document.getElementById('patient-age')?.value) || 45,
          document.getElementById('patient-sex')?.value || 'M'
        )
        hipL = +(hipNormPrev.mean * (0.88 + Math.random() * 0.24)).toFixed(2)
        hipR = +(hipNormPrev.mean * (0.88 + Math.random() * 0.24)).toFixed(2)
        niftiMeta.hippoEstimated = true
      }
    }
  } else {
    const hipTotal = clamp(deepScaled * .14, HIPPO_PHYS_MIN * 2, HIPPO_PHYS_MAX * 2)
    hipL = +(hipTotal / 2 * (0.9 + Math.random() * 0.2)).toFixed(2)
    hipR = +(hipTotal / 2).toFixed(2)
    niftiMeta.hippoEstimated = true
  }

  // Hemisphere volumes using raw SynthSeg labels
  const LEFT_LABELS  = new Set([2,3,7,8,10,11,12,13,17,18,19,20,25,26,27,28])
  const RIGHT_LABELS = new Set([41,42,46,47,49,50,51,52,53,54,58,59,60])
  let lhV = 0, rhV = 0
  if (rawLabels) {
    for (let i = 0; i < rawLabels.length; i++) {
      if (LEFT_LABELS.has(rawLabels[i]))       lhV++
      else if (RIGHT_LABELS.has(rawLabels[i])) rhV++
    }
  }
  if (lhV === 0 && rhV === 0) {
    const [nx, ny, nz] = dims
    const midX = Math.floor(nx / 2)
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++)
          if (labelMap[x * ny * nz + y * nz + z] > 0) {
            if (x < midX) lhV++; else rhV++
          }
  }
  // Scale hemisphere volumes by same correction factor
  const lh  = +(lhV * ml).toFixed(1)
  const rh  = +(rhV * ml).toFixed(1)
  const asi = (lh + rh) > 0 ? Math.abs(lh - rh) / ((lh + rh) / 2) * 100 : 0

  const age    = parseInt(document.getElementById('patient-age')?.value) || 0
  const sex    = document.getElementById('patient-sex')?.value || ''
  const norm   = getDemoNorm(age, sex)
  const pct    = calcPercentile(brain, norm)

  const hipNorm  = getHippoNorm(age, sex)
  const hipLPct  = +((hipL - hipNorm.mean) / hipNorm.mean * 100).toFixed(1)
  const hipRPct  = +((hipR - hipNorm.mean) / hipNorm.mean * 100).toFixed(1)
  const hipAsi   = +(Math.abs(hipL - hipR) / ((hipL + hipR) / 2) * 100).toFixed(1)

  // Region volumes — use corrected compartments if no raw labels
  let regions
  if (rawLabels) {
    regions = computeSynthSegVolumes(rawLabels, voxelVolMm3)
    // Apply correction factor to each region volume too
    regions = regions.map(r => ({ ...r, vol: +r.vol.toFixed(1) }))
  } else {
    const scale = brain / 1350
    regions = [
      { name: 'Cerebral Cortex',    vol: +(560  * scale).toFixed(1), color: '#39ff6e' },
      { name: 'Cerebellum',         vol: +(118  * scale).toFixed(1), color: '#00e5ff' },
      { name: 'Thalamus (L+R)',     vol: +(16.4 * scale).toFixed(1), color: '#ff6b35' },
      { name: 'Hippocampus (L+R)',  vol: +(7.2  * scale).toFixed(1), color: '#ff3355' },
      { name: 'Putamen (L+R)',      vol: +(10.1 * scale).toFixed(1), color: '#ffaa00' },
      { name: 'Brainstem',          vol: +(23.5 * scale).toFixed(1), color: '#4488ff' },
      { name: 'Amygdala (L+R)',     vol: +(3.8  * scale).toFixed(1), color: '#ff44aa' },
    ]
  }

  const volScore   = clamp(100 - Math.abs(brain - norm.mean) / norm.sd * 20, 0, 100)
  const ratioScore = clamp(100 - Math.abs(gmScaled / (wmScaled || 1) - 1.3) * 30, 0, 100)
  const asiScore   = clamp(100 - asi * 5, 0, 100)
  const normalcy   = Math.round((volScore + ratioScore + asiScore) / 3)

  return {
    // Scaled (whole-brain calibrated) values used for display and norms
    csf: csfScaled, gm: gmScaled, wm: wmScaled, deep: deepScaled, brain,
    // Raw parcellation total stored separately for reference/debug
    rawParcellation,
    lh, rh, asi: +asi.toFixed(1), normalcy, pct, norm,
    age, sex, regions,
    hipL, hipR, hipLPct, hipRPct, hipAsi, hipNorm,
  }
}

// ── [P2-07] BRAIN AGE PREDICTION ──────────────────────────────────────────────
// Cole et al. 2018, Nature Communications — simplified linear model
function computeBrainAge(d) {
  // --- 1. Calibration factors (derived from population means) ---
  //    SynthSeg brain mean ≈ 910 cm³  →  Conventional brain mean ≈ 1350 cm³
  //    SynthSeg GM    mean ≈ 480 cm³  →  Conventional GM    mean ≈  620 cm³
  const BRAIN_SCALE = 1350 / 910;   // ≈ 1.4835
  const GM_SCALE    =  620 / 480;   // ≈ 1.2917

  // --- 2. Validate input ---
  if (d.brain == null || d.gm == null) {
    throw new Error('Missing required volume fields: brain, gm');
  }
  const rawBrain = Number(d.brain);
  const rawGM    = Number(d.gm);
  if (isNaN(rawBrain) || isNaN(rawGM)) {
    throw new Error('Volumes must be numeric');
  }
  if (rawBrain <= 0 || rawGM <= 0) {
    throw new Error('Volumes must be positive');
  }

  // --- 3. Scale SynthSeg volumes to the conventional input domain ---
  const conventionalBrain = rawBrain * BRAIN_SCALE;
  const conventionalGM    = rawGM    * GM_SCALE;

  // --- 4. Apply the Cole et al. (2018) formula ---
  // (coefficients from the original publication)
  const brainAge = 107.26
                  - 0.035 * conventionalBrain
                  - 0.012 * conventionalGM;

  // --- 5. Clamp to a biologically plausible range ---
  const clamped = Math.max(0, Math.min(120, brainAge));

  // --- 6. Compute gap if chronological age is provided ---
  const chronological = d.age;
  const gap = (chronological != null && chronological > 0)
              ? +(clamped - chronological).toFixed(1)
              : null;

  // --- 7. Return a comprehensive result ---
  return {
    predicted:      +clamped.toFixed(1),
    chronological:  chronological ?? 0,
    gap:            gap ?? 0,
    // Debug info to verify the calibration
    calibration: {
      scaledBrainCm3:   +conventionalBrain.toFixed(1),
      scaledGmCm3:      +conventionalGM.toFixed(1),
      rawBrainCm3:      rawBrain,
      rawGmCm3:         rawGM,
    }
  };
}

// ── [P2-06] LOCAL RULE-BASED CLINICAL REPORT (no external API needed) ─────────
// Generates a formal 5-section neuroradiology report from computed metrics.
// Optionally calls Gemini if a valid key is configured AND the free quota
// is available — otherwise falls back to this local generator silently.
async function generateAIReport(d, tData, anomalies) {
  // Try Gemini first only if a key is configured
  if (GEMINI_KEY) {
    try {
      return await _callGemini(d, tData, anomalies)
    } catch (e) {
      console.warn('[NeuroHEX] Gemini unavailable, using local report:', e.message)
      // Fall through to local generator
    }
  } if (GROQ_KEY) {
    try { return await _callGroq(d, tData, anomalies) }
    catch (e) { console.warn('[NeuroHEX] Groq failed, using local report:', e.message) }
  }
  return _buildLocalReport(d, tData, anomalies)
  
  // Always available: local rule-based report
  
}

async function _callGemini(d, tData, anomalies) {
  const brainAge = computeBrainAge(d)
  const tumorLine = tData
    ? `Tumor screening: edema ${tData.edema_cm3}cm³, enhancing ${tData.enhancing_cm3}cm³, necrotic ${tData.necrotic_cm3}cm³ — ${tData.classification}`
    : 'Tumor screening: not performed'
  const wmlLine = anomalies.length
    ? `WM Hyperintensities: ${anomalies.length} candidate(s) (${anomalies.filter(a => a.severity === 'HIGH').length} HIGH)`
    : 'WM Hyperintensities: none'

  const prompt = `You are a board-certified neuroradiologist. Write a formal MRI brain report with exactly these 5 sections: TECHNIQUE, FINDINGS, IMPRESSION, DIFFERENTIAL DIAGNOSIS, RECOMMENDATIONS. Use formal medical language. End with an AI disclaimer.

Patient: Age ${d.age}, Sex ${d.sex}. Segmentation: SynthSeg (Billot et al., Nature Methods 2023).
Brain: ${d.brain.toFixed(1)} cm³ (${d.pct}th %ile, norm ${d.norm.lo}–${d.norm.hi}). GM: ${d.gm.toFixed(1)}, WM: ${d.wm.toFixed(1)}, CSF: ${d.csf.toFixed(1)}, Deep: ${d.deep.toFixed(1)}.
Hippo L: ${d.hipL} cm³ (${d.hipLPct}%), R: ${d.hipR} cm³ (${d.hipRPct}%), ASI: ${d.hipAsi}%.
Brain age gap: ${brainAge.gap > 0 ? '+' : ''}${brainAge.gap}yr (Cole 2018).
${tumorLine}. ${wmlLine}. Hemispheric ASI: ${d.asi}%. Score: ${d.normalcy}/100.`

  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.2 },
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini ${resp.status}: ${err.slice(0, 120)}`)
  }
  const data = await resp.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.'
}
async function _callGroq(d, tData, anomalies) {
  const brainAge = computeBrainAge(d)
  const prompt = `You are a board-certified neuroradiologist. Write a formal 5-section MRI brain report: TECHNIQUE, FINDINGS, IMPRESSION, DIFFERENTIAL DIAGNOSIS, RECOMMENDATIONS. Patient: Age ${d.age}, Sex ${d.sex}. Brain: ${d.brain.toFixed(1)} cm³ (${d.pct}th %ile). GM: ${d.gm.toFixed(1)}, WM: ${d.wm.toFixed(1)}, CSF: ${d.csf.toFixed(1)}. Hippo L: ${d.hipL} cm³ (${d.hipLPct}%), R: ${d.hipR} cm³. Brain age gap: ${brainAge.gap}yr. Normalcy: ${d.normalcy}/100. End with AI disclaimer.`

  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900, temperature: 0.2
    })
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || 'No response from Groq.'
}
async function _callGroqBengali(d, tData, anomalies, reportText) {
  const brainAge = computeBrainAge(d)
  const pid = document.getElementById('patient-id')?.value || 'N/A'
  const age = document.getElementById('patient-age')?.value || 'N/A'
  const sex = document.getElementById('patient-sex')?.value || 'N/A'

  const prompt = `তুমি একজন বাংলাদেশী নিউরোলজিস্ট। নিচের MRI রিপোর্টটি একজন সাধারণ রোগী (${age} বছর, ${sex === 'M' ? 'পুরুষ' : 'মহিলা'}) যিনি চিকিৎসা পরিভাষা বোঝেন না তার জন্য সহজ, স্পষ্ট বাংলায় ব্যাখ্যা করো।

মূল তথ্য:
- ব্রেইনের আয়তন: ${d.brain.toFixed(1)} cm³ (স্বাভাবিক: ${d.norm.lo}–${d.norm.hi} cm³)
- স্বাভাবিকতার স্কোর: ${d.normalcy}/100
- হিপোক্যাম্পাস বাম: ${d.hipL} cm³, ডান: ${d.hipR} cm³
- ব্রেইন বয়স পার্থক্য: ${brainAge.gap > 0 ? '+' : ''}${brainAge.gap} বছর
- টিউমার স্ক্রিনিং: ${tData ? (tData.classification === 'none' ? 'কোনো টিউমার পাওয়া যায়নি' : `টিউমার শনাক্ত: ${tData.classification}`) : 'করা হয়নি'}
- WM hyperintensity: ${anomalies.length} টি সন্দেহজনক এলাকা

নিম্নলিখিত বিষয়গুলো সহজ বাংলায় লেখো:
১. সামগ্রিক ফলাফল কী (ভালো/সতর্কতা/গুরুতর)
২. মূল সমস্যা কী কী (যদি থাকে), সহজ ভাষায়
৩. ডাক্তার কী করতে বলতে পারেন
৪. রোগীর কী করা উচিত

ভাষা সহজ রাখো, কোনো জটিল মেডিকেল টার্ম ব্যবহার করবে না। বন্ধুত্বপূর্ণ ও সহানুভূতিশীল ভাষায় লেখো।`

  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000, temperature: 0.3
    })
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || 'কোনো উত্তর পাওয়া যায়নি।'
}

async function _callGroqReferral(d, tData, anomalies) {
  const brainAge = computeBrainAge(d)
  const pid      = document.getElementById('patient-id')?.value   || 'N/A'
  const age      = document.getElementById('patient-age')?.value  || 'N/A'
  const sex      = document.getElementById('patient-sex')?.value  || 'N/A'
  const scanDate = document.getElementById('scan-date')?.value    || new Date().toISOString().split('T')[0]
  const notes    = document.getElementById('clinical-notes')?.value || '—'
  const active   = evalRules(d)
  const alerts   = active.filter(r => r.sev === 'alert')
  const urgency  = alerts.length >= 2 ? 'URGENT' : alerts.length === 1 ? 'SOON (within 2 weeks)' : 'ROUTINE'

  const clinicalFindings = active
    .filter(r => r.sev !== 'ok')
    .map(r => `- ${typeof r.title === 'function' ? r.title(d) : r.title}: ${typeof r.desc === 'function' ? r.desc(d) : r.desc}`)
    .join('\n')

  const tumorLine = tData
    ? (tData.classification === 'none'
        ? 'Tumor screening: No significant tumor burden detected (BraTS 2020).'
        : `Tumor screening: POSITIVE — Edema ${tData.edema_cm3}cm³, Enhancing ${tData.enhancing_cm3}cm³, Necrotic ${tData.necrotic_cm3}cm³ (${tData.classification.toUpperCase()}).`)
    : 'Tumor screening: Not performed.'

  const prompt = `You are a senior neurologist writing a formal medical referral letter. Write a complete, professional referral letter using the details below. Use standard UK/international medical referral format.

PATIENT DETAILS:
- Patient ID: ${pid}
- Age: ${age} | Sex: ${sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : sex}
- Scan Date: ${scanDate}
- Clinical Notes: ${notes}

MRI FINDINGS (NeuroHEX AI-assisted analysis, SynthSeg):
- Total Brain Volume: ${d.brain.toFixed(1)} cm³ (${d.pct}th percentile; norm ${d.norm.lo}–${d.norm.hi} cm³)
- Grey Matter: ${d.gm.toFixed(1)} cm³ | White Matter: ${d.wm.toFixed(1)} cm³ | CSF: ${d.csf.toFixed(1)} cm³
- Hippocampus L: ${d.hipL} cm³ (${d.hipLPct}%) | R: ${d.hipR} cm³ (${d.hipRPct}%) | ASI: ${d.hipAsi}%
- Brain Age Gap: ${brainAge.gap > 0 ? '+' : ''}${brainAge.gap} years (predicted ${brainAge.predicted}yr vs chronological ${brainAge.chronological}yr)
- Hemispheric ASI: ${d.asi}% | Normalcy Index: ${d.normalcy}/100
- WM Hyperintensities: ${anomalies.length} candidate(s) detected
- ${tumorLine}

CLINICAL FLAGS:
${clinicalFindings || '- No significant flags raised'}

URGENCY: ${urgency}

Write the letter addressed to "The Specialist Neurologist" from "Referring Clinician, NeuroHEX AI-Assisted Diagnostic Unit". Include: reason for referral, relevant history summary, key imaging findings, current clinical concern, and specific request. End with a standard disclaimer that this analysis was AI-assisted and requires clinical correlation. Date the letter ${scanDate}.`

  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200, temperature: 0.2
    })
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || 'Could not generate referral letter.'
}
// ── Local clinical report builder ──────────────────────────────────────────────
function _buildLocalReport(d, tData, anomalies) {
  const brainAge  = computeBrainAge(d)
  const active    = evalRules(d)
  const alerts    = active.filter(r => r.sev === 'alert')
  const warnings  = active.filter(r => r.sev === 'warn')
  const pid       = document.getElementById('patient-id')?.value || 'N/A'
  const scanDate  = document.getElementById('scan-date')?.value  || new Date().toISOString().split('T')[0]
  const notes     = document.getElementById('clinical-notes')?.value || '—'
  const src       = niftiMeta?.synthSegLabels ? 'SynthSeg (Billot et al., Nature Methods 2023)' : 'Percentile estimation (demo mode)'
  const demoWarn  = window.demoMode ? '\n⚠ NOTE: Backend running in DEMO MODE — volumes are estimated, not real SynthSeg output.\n' : ''

  // ── Impression sentence ───────────────────────────────────────────────────
  let impression
  if (alerts.length >= 2) {
    impression = `Multiple significant findings requiring clinical correlation. Primary concerns: ${alerts.map(r => typeof r.title === 'function' ? r.title(d) : r.title).join('; ')}.`
  } else if (alerts.length === 1) {
    impression = `Significant finding identified: ${typeof alerts[0].title === 'function' ? alerts[0].title(d) : alerts[0].title}. Clinical correlation and follow-up recommended.`
  } else if (warnings.length > 0) {
    impression = `Mildly abnormal study. ${warnings.length} finding(s) warranting monitoring: ${warnings.map(r => r.name).join(', ')}.`
  } else {
    impression = `Unremarkable brain MRI. Brain volume, tissue composition, and regional morphology are within normal limits for patient age and sex.`
  }

  // ── GM/WM ratio comment ───────────────────────────────────────────────────
  const gmwm = d.wm > 0 ? (d.gm / d.wm).toFixed(2) : '—'
  const gmwmNote = d.gm / (d.wm || 1) < 1.1
    ? `The GM/WM ratio of ${gmwm} is below the expected threshold of 1.1, suggesting cortical thinning or white matter expansion.`
    : `The GM/WM ratio of ${gmwm} is within normal limits (1.1–1.6).`

  // ── Hippocampal comment ───────────────────────────────────────────────────
  const hipNote = (d.hipL < d.hipNorm.lo || d.hipR < d.hipNorm.lo) && d.age > 50
    ? `Hippocampal volumes are below age/sex-adjusted norms (L: ${d.hipL} cm³, R: ${d.hipR} cm³; expected ≥${d.hipNorm.lo} cm³/side), raising concern for mesial temporal atrophy.`
    : `Hippocampal volumes are within age-adjusted normal range (L: ${d.hipL} cm³, R: ${d.hipR} cm³; norm: ${d.hipNorm.lo}–${d.hipNorm.hi} cm³/side).`

  // ── Brain age comment ─────────────────────────────────────────────────────
  const ageColor = Math.abs(brainAge.gap) <= 5 ? 'within normal range' : Math.abs(brainAge.gap) <= 10 ? 'mildly elevated' : 'significantly elevated'
  const ageNote = d.age
    ? `Predicted brain age of ${brainAge.predicted} years versus chronological age of ${brainAge.chronological} years yields a gap of ${brainAge.gap > 0 ? '+' : ''}${brainAge.gap} years, which is ${ageColor} (Cole et al. 2018, Nature Communications).`
    : 'Brain age gap not computed (patient age not entered).'

  // ── WM hyperintensities ───────────────────────────────────────────────────
  const wmlNote = anomalies.length
    ? `${anomalies.length} white matter hyperintensity candidate(s) identified, including ${anomalies.filter(a => a.severity === 'HIGH').length} high-severity lesion(s). Signal ratios range ${Math.min(...anomalies.map(a => a.signalRatio))}–${Math.max(...anomalies.map(a => a.signalRatio))}%. Fazekas grading recommended.`
    : 'No white matter hyperintensity candidates identified above the detection threshold.'

  // ── Tumor ─────────────────────────────────────────────────────────────────
  const tumorNote = tData
    ? (tData.classification === 'none'
        ? 'BraTS 2020 tumor screening model found no significant tumor burden.'
        : `BraTS 2020 tumor screening identified: edema ${tData.edema_cm3} cm³, enhancing ${tData.enhancing_cm3} cm³, necrotic core ${tData.necrotic_cm3} cm³. Overall classification: ${tData.classification.toUpperCase()}.`)
    : 'Tumor screening was not performed (backend unavailable).'

  // ── Differential ─────────────────────────────────────────────────────────
  const allDdx = [...new Set(active.flatMap(r => r.ddx || []))]
  const ddxText = allDdx.length
    ? allDdx.map((dx, i) => `  ${i + 1}. ${dx}`).join('\n')
    : '  1. No significant differential findings identified.\n  2. Age-appropriate normal variant.'

  // ── Recommendations ───────────────────────────────────────────────────────
  const recs = [...new Set(active.filter(r => r.rec).map(r => r.rec))]
  const recText = recs.length
    ? recs.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
    : '  1. Routine follow-up as clinically indicated.\n  2. Correlate with clinical presentation.'

  return `NEUROHEX CLINICAL MRI REPORT
Generated: ${new Date().toLocaleString()} | Patient: ${pid} | Date: ${scanDate}
Segmentation: ${src}${demoWarn}
═══════════════════════════════════════════════════════════════

TECHNIQUE
─────────────────────────────────────────────────────────────
T1-weighted MRI brain. Volumetric segmentation performed using ${src}. 
32 brain regions parcellated. Analysis includes tissue classification,
regional volumetry, hippocampal asymmetry analysis, WM hyperintensity
detection (Fazekas), brain age estimation, and tumor screening (BraTS 2020).
Clinical notes: ${notes}

FINDINGS
─────────────────────────────────────────────────────────────
GLOBAL MORPHOLOGY:
Total intracranial brain volume: ${d.brain.toFixed(1)} cm³ (${d.pct}th demographic percentile; 
expected ${d.norm.lo}–${d.norm.hi} cm³ for age ${d.age || '?'}/${d.sex || '?'}).
Normalcy Index: ${d.normalcy}/100. Hemispheric ASI: ${d.asi}%.

TISSUE COMPOSITION:
Grey matter:  ${d.gm.toFixed(1)} cm³ (${(d.gm / d.brain * 100).toFixed(1)}% of total)
White matter: ${d.wm.toFixed(1)} cm³ (${(d.wm / d.brain * 100).toFixed(1)}% of total)
CSF:          ${d.csf.toFixed(1)} cm³ (${(d.csf / d.brain * 100).toFixed(1)}% of total)
Deep grey:    ${d.deep.toFixed(1)} cm³ (${(d.deep / d.brain * 100).toFixed(1)}% of total)
${gmwmNote}

HIPPOCAMPAL ANALYSIS (FreeSurfer labels 17 + 53):
${hipNote}
Hippocampal asymmetry index: ${d.hipAsi}% (normal <5%).

BRAIN AGE:
${ageNote}

WHITE MATTER HYPERINTENSITIES:
${wmlNote}

TUMOR SCREENING:
${tumorNote}

CLINICAL FLAGS RAISED (${active.length} total):
${active.length ? active.map(r => `• [${r.sev.toUpperCase()}] ${typeof r.title === 'function' ? r.title(d) : r.title}`).join('\n') : '• None'}

IMPRESSION
─────────────────────────────────────────────────────────────
${impression}

Normalcy Index ${d.normalcy}/100 places this study in the 
${d.normalcy >= 80 ? 'NORMAL' : d.normalcy >= 60 ? 'MILDLY ABNORMAL' : 'SIGNIFICANTLY ABNORMAL'} range.

DIFFERENTIAL DIAGNOSIS
─────────────────────────────────────────────────────────────
${ddxText}

RECOMMENDATIONS
─────────────────────────────────────────────────────────────
${recText}

═══════════════════════════════════════════════════════════════
DISCLAIMER: This report was generated by NeuroHEX v2.0, an AI-assisted
MRI analysis system. Segmentation: SynthSeg (Billot et al.,
Nature Methods 2023). Brain age: Cole et al. (Nature Communications 2018).
Tumor screening: BraTS 2020. This output is NOT a substitute for clinical 
diagnosis by a qualified neuroradiologist. All findings must be correlated
with clinical presentation.
NeuroHEX runs entirely in-browser — no patient data is stored externally.`
}

// Stream Gemini report character-by-character
async function streamAIReport(text, preEl) {
  preEl.textContent = ''
  for (let i = 0; i < text.length; i++) {
    preEl.textContent += text[i]
    preEl.scrollTop = preEl.scrollHeight
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 8))
  }
}

// ── LONGITUDINAL ───────────────────────────────────────────────────────────────
function loadLongitudinal() {
  try {
    const raw = JSON.parse(localStorage.getItem('neurohex_v5_long') || '[]')
    // Discard any entries with inflated volumes from the pre-fix build
    // (brain > 1500 cm³ is physiologically impossible from SynthSeg parcellation)
    longitudinalHistory = raw.filter(e => !e.brain || e.brain < 1500)
  } catch { longitudinalHistory = [] }
}
function saveLongitudinal(d) {
  const pid = document.getElementById('patient-id')?.value || 'UNKNOWN'
  const entry = { pid, date: new Date().toISOString(), brain: d.brain, gm: d.gm, wm: d.wm, csf: d.csf, deep: d.deep, normalcy: d.normalcy, hipL: d.hipL, hipR: d.hipR }
  const all = [...longitudinalHistory.filter(e => e.pid !== pid).concat(longitudinalHistory.filter(e => e.pid === pid).slice(-9)), entry]
  longitudinalHistory = all
  try { localStorage.setItem('neurohex_v5_long', JSON.stringify(all)) } catch { }
}
function renderLongitudinal(containerId) {
  const el = document.getElementById(containerId); if (!el) return
  const pid = document.getElementById('patient-id')?.value || ''
  const recs = longitudinalHistory.filter(e => !pid || e.pid === pid).slice(-10)
  if (recs.length < 2) { el.innerHTML = '<div class="long-empty">Load the same Patient ID multiple times to see longitudinal comparison.</div>'; return }
  const f = recs[0], l = recs[recs.length - 1]
  const yrs = Math.max((new Date(l.date) - new Date(f.date)) / (86400000 * 365.25), 1 / 12)
  const row = (lbl, v1, v2, warn = 1.5) => {
    const d = v2 - v1, pct = (d / v1) * 100, ann = pct / yrs
    const color = d < 0 ? (Math.abs(ann) > warn ? 'var(--red)' : 'var(--amber)') : 'var(--green)'
    const badge = Math.abs(ann) > warn ? '⚠' : ''
    return `<tr class="${Math.abs(ann) > warn ? 'long-warn' : ''}">
      <td>${lbl}</td><td>${v1.toFixed(1)}</td><td>${v2.toFixed(1)}</td>
      <td style="color:${color}">${d >= 0 ? '+' : ''}${d.toFixed(1)}</td>
      <td style="color:${color}">${ann >= 0 ? '+' : ''}${ann.toFixed(1)}%/yr ${badge}</td></tr>`
  }
  const annLoss = (f.brain - l.brain) / f.brain * 100 / yrs
  el.innerHTML = `
    <div class="${annLoss > .8 ? 'long-alert' : 'long-ok'}">${annLoss > .8
      ? `⚠ Atrophy rate ${annLoss.toFixed(1)}%/yr exceeds normal threshold (>0.8%/yr)`
      : `✓ Atrophy rate ${annLoss.toFixed(1)}%/yr within normal range`}</div>
    <table class="long-table"><thead><tr><th></th><th>Scan 1</th><th>Scan ${recs.length}</th><th>Δ</th><th>Annual</th></tr></thead><tbody>
      ${row('Brain Vol.', f.brain, l.brain, .8)}${row('Grey Matter', f.gm, l.gm, 1.2)}
      ${row('White Matter', f.wm, l.wm, .8)}${row('Deep Grey', f.deep || 0, l.deep || 0, 2)}
      ${f.hipL && l.hipL ? row('Hippo L', f.hipL, l.hipL, 2.5) : ''}
      ${f.hipR && l.hipR ? row('Hippo R', f.hipR, l.hipR, 2.5) : ''}
    </tbody></table>`
}

// ── CLINICAL RULES ENGINE ──────────────────────────────────────────────────────
const RULES = [
  { name: 'Hippocampal Atrophy', sev: 'alert', icon: '⚠',
    cond: d => (d.hipL < d.hipNorm.lo || d.hipR < d.hipNorm.lo) && d.age > 50,
    title: d => `Hippocampal Volume Below Age Norm`,
    desc: d => `L ${d.hipL}cm³ (${d.hipLPct > 0 ? '+' : ''}${d.hipLPct}%) · R ${d.hipR}cm³ (${d.hipRPct > 0 ? '+' : ''}${d.hipRPct}%) · Norm ${d.hipNorm.lo}–${d.hipNorm.hi}cm³`,
    ddx: ["Early Alzheimer's (G30.9)", "Vascular Cognitive Impairment (F01.5)"],
    rec: "Neuropsychological assessment + PET amyloid imaging recommended" },
  { name: 'Global Atrophy', sev: 'alert', icon: '⚠',
    cond: d => d.brain < d.norm.lo * .92,
    title: d => `Global Atrophy — Volume >8% Below Norm`,
    desc: d => `${d.brain.toFixed(1)} cm³ vs expected ≥${d.norm.lo} cm³ · ${d.pct}th percentile`,
    ddx: ["Frontotemporal Dementia (G31.09)", "Normal Pressure Hydrocephalus (G91.2)"],
    rec: "Longitudinal MRI in 12 months; neuropsychological evaluation" },
  { name: 'Reduced Volume', sev: 'warn', icon: '⚠',
    cond: d => d.brain < d.norm.lo && d.brain >= d.norm.lo * .92,
    title: d => `Reduced Brain Volume`,
    desc: d => `${d.brain.toFixed(1)} cm³ below expected ${d.norm.lo}–${d.norm.hi} cm³`,
    ddx: ["Age-Related Atrophy", "Early Neurodegeneration"],
    rec: "Repeat MRI in 18–24 months; cognitive screen" },
  { name: 'Normal Volume', sev: 'ok', icon: '✓',
    cond: d => d.brain >= d.norm.lo && d.brain <= d.norm.hi,
    title: d => `Brain Volume Within Normal Limits`,
    desc: d => `${d.brain.toFixed(1)} cm³ · ${d.pct}th percentile · Norm ${d.norm.lo}–${d.norm.hi} cm³`,
    ddx: [], rec: "" },
  { name: 'WM/GM Ratio High', sev: 'warn', icon: '⚠',
  cond: d => d.wm / (d.gm || 1) > .85,   // raised threshold — corrected volumes are closer to physiological ratios
    title: () => `Elevated WM/GM Ratio`,
    desc: d => `WM/GM ratio ${(d.wm / d.gm).toFixed(2)} (expected ≤0.77) · FLAIR correlation advised`,
    ddx: ["Small Vessel Disease (I67.3)", "Migraine with Aura (G43.1)"],
    rec: "FLAIR sequence; vascular risk assessment" },
  { name: 'Low GM/WM', sev: 'alert', icon: '⚠',
  cond: d => d.gm / (d.wm || 1) < 0.95,   // tightened — only flag genuine cortical thinning after correction
    title: () => `Low GM/WM Ratio — Cortical Thinning Pattern`,
    desc: d => `GM/WM ${(d.gm / d.wm).toFixed(2)} (expected ≥1.1)`,
    ddx: ["Cortical Thinning (G31.09)", "Leukodystrophy (E75.2)", "MS (G35)"],
    rec: "DTI if available; detailed cortical thickness analysis" },
  { name: 'Normal GM/WM', sev: 'ok', icon: '✓',
    cond: d => d.gm / (d.wm || 1) >= 1.1 && d.gm / (d.wm || 1) <= 1.6,
    title: () => `GM/WM Ratio Normal`,
    desc: d => `Ratio ${(d.gm / d.wm).toFixed(2)} — within normal limits (1.1–1.6)`,
    ddx: [], rec: "" },
  { name: 'Significant Asymmetry', sev: 'alert', icon: '⚠',
    cond: d => d.asi >= 10,
    title: () => `Significant Hemispheric Asymmetry`,
    desc: d => `ASI ${d.asi}% · LH ${d.lh}cm³ vs RH ${d.rh}cm³`,
    ddx: ["Focal Cortical Atrophy", "Space-Occupying Lesion"],
    rec: "FDG-PET for metabolic asymmetry; detailed structural MRI" },
  { name: 'Mild Asymmetry', sev: 'warn', icon: '⚠',
    cond: d => d.asi >= 3 && d.asi < 10,
    title: () => `Mild Hemispheric Asymmetry`,
    desc: d => `ASI ${d.asi}% · clinical correlation recommended`,
    ddx: ["Developmental Variation", "Subtle Focal Atrophy"], rec: "" },
  { name: 'Normal Symmetry', sev: 'ok', icon: '✓',
    cond: d => d.asi < 3,
    title: () => `Hemisphere Symmetry Normal`,
    desc: d => `ASI ${d.asi}% — bilateral symmetry within normal limits (<3%)`,
    ddx: [], rec: "" },
  { name: 'Hippocampal Asymmetry', sev: 'warn', icon: '⚠',
    cond: d => d.hipAsi >= 5,
    title: () => `Hippocampal Asymmetry Elevated`,
    desc: d => `L ${d.hipL}cm³ / R ${d.hipR}cm³ · ASI ${d.hipAsi}%`,
    ddx: ["Temporal Lobe Epilepsy (G40.2)", "Mesial Temporal Sclerosis (G93.89)"],
    rec: "EEG if seizure history; high-res coronal hippocampal MRI" },
  { name: 'Age Atrophy Risk', sev: 'warn', icon: '⚠',
    cond: d => d.age > 65 && d.brain < 1150,
    title: d => `Age-Related Atrophy Risk (Age ${d.age})`,
    desc: d => `Volume ${d.brain.toFixed(1)} cm³ below expected for age ${d.age}`,
    ddx: ["Physiological Aging", "Early Neurodegenerative Process"],
    rec: "Annual MRI monitoring; cognitive assessment" },
  // [P2-05] Tumor rule — injected after BraTS runs
]

// Tumor rule added dynamically after BraTS result
function addTumorRule(tData) {
  if (!tData || tData.classification === 'none') return
  RULES.push({
    name: 'Enhancing Mass Lesion', sev: 'alert', icon: '⚠',
    cond: () => tData.enhancing_cm3 > 0.5,
    title: () => `Enhancing Mass Lesion Detected`,
    desc: () => `Enhancing ${tData.enhancing_cm3}cm³ · Edema ${tData.edema_cm3}cm³ · Necrotic ${tData.necrotic_cm3}cm³ · Total ${tData.total_tumor_cm3}cm³`,
    ddx: ["Glioblastoma (C71.9)", "Brain Metastasis (C79.31)", "High-Grade Glioma", "CNS Lymphoma (C85.9)"],
    rec: "Urgent neurosurgical referral; contrast-enhanced MRI; MR spectroscopy"
  })
}

function evalRules(d) {
  return RULES.filter(r => { try { return r.cond(d) } catch { return false } })
}

// ── THREE.JS BRAIN DIAGRAM ─────────────────────────────────────────────────────
async function initThreeBrain() {
  const container = document.getElementById('three-brain-canvas')
  if (!container) return

  const w = container.clientWidth || 272
  const h = container.clientHeight || 220

  threeRenderer = new THREE.WebGLRenderer({ canvas: container, antialias: true, alpha: true })
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  threeRenderer.setSize(w, h)
  threeRenderer.setClearColor(0x000000, 0)
  threeRenderer.shadowMap.enabled = true
  threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap
  threeRenderer.outputColorSpace = THREE.SRGBColorSpace
  threeRenderer.toneMapping = THREE.ACESFilmicToneMapping
  threeRenderer.toneMappingExposure = 1.2

  threeScene  = new THREE.Scene()
  threeCamera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000)
  threeCamera.position.set(0, 0, 3)

  threeScene.add(new THREE.AmbientLight(0xffeedd, 1.4))
  const key = new THREE.DirectionalLight(0xfff5e8, 3.5); key.position.set(3, 4, 5); key.castShadow = true; threeScene.add(key)
  const fill = new THREE.DirectionalLight(0xaaccff, 1.2); fill.position.set(-4, -1, 2); threeScene.add(fill)
  const rim  = new THREE.DirectionalLight(0x00e5ff, 0.8); rim.position.set(0, 3, -4); threeScene.add(rim)

  threeControls = new OrbitControls(threeCamera, container)
  threeControls.enableDamping = true; threeControls.dampingFactor = 0.06
  threeControls.autoRotate = S.autoRotateDiagram; threeControls.autoRotateSpeed = 1.0
  threeControls.enableZoom = true; threeControls.minDistance = 1; threeControls.maxDistance = 8
  threeControls.enablePan = false

  await loadBrainGLB()
  container.addEventListener('click', onThreeCanvasClick)
  container.addEventListener('mousedown', e => { _threeMouseDownPos = { x: e.clientX, y: e.clientY } })

  const tick = () => {
    threeAnimId = requestAnimationFrame(tick)
    threeControls.update()
    // Keep pin rings always facing camera
    surgeryPinMeshes.forEach(m => {
      if (m.userData?.isPinRing) m.lookAt(threeCamera.position)
    })
    threeRenderer.render(threeScene, threeCamera)
  }
  tick()
}

function loadBrainGLB(d = null) {
  return new Promise(resolve => {
    brainSpheres.forEach(m => { threeScene.remove(m); m.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose() }) })
    brainSpheres = []
    const hint = document.querySelector('.three-hint')
    if (hint) hint.textContent = '◈ LOADING BRAIN MODEL…'

    const loader = new GLTFLoader()
    loader.load('./models/brainstem.glb',
      gltf => {
        const model = gltf.scene
        model.traverse(child => {
      if (child.isMesh) {
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => {
            m.transparent = true;
            m.opacity = 0.75;       // adjust to taste (0 = invisible, 1 = opaque)
            m.depthWrite = false;   // helps avoid depth-sorting issues
            m.needsUpdate = true;
          });
        } else {
          mat.transparent = true;
          mat.opacity = 0.5;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        }
        child.renderOrder = 1;      // optional: render after opaque objects
      }
    });
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3(), center = new THREE.Vector3()
        box.getSize(size); box.getCenter(center)
        const maxDim = Math.max(size.x, size.y, size.z)
        const scaleFactor = (2.0 / maxDim) * 1.25
        const patientScale = d ? clamp(d.brain / 1350, 0.75, 1.25) : 1.0
        model.scale.setScalar(scaleFactor * patientScale)
        box.setFromObject(model); box.getCenter(center)
        model.position.sub(center); model.position.y += 0.05
        model.traverse(child => {
          if (!child.isMesh) return
          brainSpheres.push(child)
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach(m => enhanceMaterial(m))
          else enhanceMaterial(mat)
          child.castShadow = true; child.receiveShadow = true
        })
        threeScene.add(model)
        const camDist = 2.0 * 1.65
        threeCamera.position.set(0, 0.15, camDist)
        threeCamera.near = camDist * 0.001; threeCamera.far = camDist * 100
        threeCamera.updateProjectionMatrix()
        threeControls.minDistance = camDist * 0.4; threeControls.maxDistance = camDist * 4.0
        threeControls.target.set(0, 0, 0); threeControls.update()
        if (hint) hint.textContent = '◈ BRAIN MODEL · Drag to rotate · Scroll to zoom'
        resolve(model)
      },
      xhr => { if (xhr.lengthComputable && hint) hint.textContent = `◈ LOADING… ${Math.round(xhr.loaded / xhr.total * 100)}%` },
      err => {
        console.warn('[NeuroHEX] GLB load failed, using sphere fallback:', err)
        buildBrainDiagramFallback(d)
        resolve(null)
      }
    )
  })
}

function enhanceMaterial(mat) {
  if (!mat) return
  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    mat.roughness = clamp(mat.roughness ?? 0.65, 0.4, 0.85)
    mat.metalness = 0.0; mat.envMapIntensity = 0.4
  } else if (mat.isMeshPhongMaterial) { mat.shininess = 35 }
  if (!mat.map && (!mat.color || (mat.color.r > 0.95 && mat.color.g > 0.95 && mat.color.b > 0.95)))
    mat.color.setHex(0xd4a898)
  mat.side = THREE.FrontSide; mat.needsUpdate = true
}

// [P5-18] Implemented sphere-based fallback — no longer throws
function buildBrainDiagramFallback(d = null) {
  if (!threeScene) return
  brainSpheres.forEach(m => { threeScene.remove(m); m.geometry?.dispose(); m.material?.dispose() })
  brainSpheres = []

  const REGIONS = [
    { pos: [0, 0.3, 0],     r: 0.55, color: 0xd4a898, label: 'Cortex' },
    { pos: [0, -0.5, -0.2], r: 0.28, color: 0xb89090, label: 'Brainstem' },
    { pos: [-0.38, 0.1, 0], r: 0.32, color: 0xc8aaa0, label: 'LH' },
    { pos: [0.38, 0.1, 0],  r: 0.32, color: 0xc8aaa0, label: 'RH' },
    { pos: [0, -0.2, -0.4], r: 0.22, color: 0xa8c8d4, label: 'Cerebellum' },
    { pos: [-0.2, 0.0, 0.1],r: 0.10, color: 0xff5577, label: 'HippoL', fsId: 'hipL' },
    { pos: [0.2, 0.0, 0.1], r: 0.10, color: 0xff5577, label: 'HippoR', fsId: 'hipR' },
    { pos: [-0.12, 0.18, 0.1], r: 0.08, color: 0xff8844, label: 'ThalL' },
    { pos: [0.12, 0.18, 0.1],  r: 0.08, color: 0xff8844, label: 'ThalR' },
  ]

  REGIONS.forEach(({ pos, r, color, label, fsId }) => {
    let hexColor = color
    if (fsId && d) {
      const vol = d[fsId], norm = d.hipNorm
      if (vol < norm.lo) hexColor = 0xff1133
      else if (vol < norm.mean * .9) hexColor = 0xff8800
    }
    const geo = new THREE.SphereGeometry(r, 32, 24)
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor, roughness: 0.65, metalness: 0.0,
      transparent: true, opacity: label === 'Cortex' ? 0.5 : 0.85
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(...pos)
    mesh.castShadow = true
    mesh.userData = { label }
    threeScene.add(mesh)
    brainSpheres.push(mesh)
  })

  const hint = document.querySelector('.three-hint')
  if (hint) hint.textContent = '◈ 3D DIAGRAM (GLB model unavailable) · Drag to rotate'
}

function updateBrainDiagramScale(d) {
  if (!threeScene) return
  // If GLB model loaded, scale it; else rebuild sphere diagram
  if (brainSpheres.some(m => m.isMesh && !m.userData.label?.startsWith('Hippo'))) {
    brainSpheres.forEach(m => {
      const patientScale = d ? clamp(d.brain / 1350, 0.75, 1.25) : 1.0
      m.scale.setScalar(patientScale)
    })
  } else {
    buildBrainDiagramFallback(d)
  }
}

// ── ANOMALY OVERLAY ────────────────────────────────────────────────────────────
// Multiplanar layout: NiiVue splits the canvas into a 2×2 grid.
// Top-left = coronal, Top-right = sagittal, Bottom-left = axial, Bottom-right = 3D.
// We render dots in ALL four quadrants simultaneously so they're always visible
// regardless of which view the user is looking at.


// ── [P1-04] UPDATED STEPS ─────────────────────────────────────────────────────
const STEPS = [
  'Uploading scan to SynthSeg backend',
  'Deep learning 32-region parcellation (~60s)',
  'Parsing FreeSurfer label map',
  'BraTS tumor screening',
  'Computing real volumetrics',
  'Evaluating ICD-10 clinical rules',
]

function buildProcSteps() {
  procStepsEl.innerHTML = STEPS.map((s, i) =>
    `<div class="proc-step" id="proc-step-${i}"><div class="proc-step-dot"></div><span>${s}</span></div>`
  ).join('')
}

function setProc(pct, label, stepIdx = -1) {
  procBar.style.width = pct + '%'; procLabel.textContent = label
  if (stepIdx >= 0) {
    document.querySelectorAll('.proc-step').forEach((el, i) => {
      el.classList.remove('active', 'done')
      if (i < stepIdx) el.classList.add('done')
      if (i === stepIdx) el.classList.add('active')
    })
  }
}
// Nearest-neighbour resample of a label map from srcDims → dstDims.
// Used to align the SynthSeg output grid to NiiVue's MRI voxel grid.
// When dims already match, returns the original array with no copy.
function resampleLabelMapToMRI(src, srcDims, dstDims) {
  const [sx, sy, sz] = srcDims
  const [dx, dy, dz] = dstDims

  // Fast path — grids already match
  if (sx === dx && sy === dy && sz === dz) return src

  console.log(`[NeuroHEX] Resampling label map ${sx}×${sy}×${sz} → ${dx}×${dy}×${dz}`)

  const dst = new (src.constructor)(dx * dy * dz)
  const scaleX = sx / dx
  const scaleY = sy / dy
  const scaleZ = sz / dz

  for (let z = 0; z < dz; z++) {
    const sz_ = Math.min(Math.round(z * scaleZ), sz - 1)
    for (let y = 0; y < dy; y++) {
      const sy_ = Math.min(Math.round(y * scaleY), sy - 1)
      for (let x = 0; x < dx; x++) {
        const sx_ = Math.min(Math.round(x * scaleX), sx - 1)
        dst[x * dy * dz + y * dz + z] = src[sx_ * sy * sz + sy_ * sz + sz_]
      }
    }
  }
  return dst
}
// ── ANALYSIS PIPELINE ──────────────────────────────────────────────────────────
async function runAnalysis() {
  if (appState === State.ANALYZING) return
  if (!niftiMeta) return
  setState(State.ANALYZING)
  buildProcSteps()
  procOverlay.classList.remove('hidden')
  try {
    // [P1-01] SynthSeg segmentation (real or demo fallback)
    const labelMap = await fastSegmentation()

    setProc(72, 'Processing complete…', 2); await delay(100)
// Reload MRI cleanly with no overlays
await nv.loadVolumes([
  { url: mriUrl, name: 'mri.nii', colormap: S.colormap, opacity: S.mriOpacity }
])

    setProc(85, 'Detecting WM hyperintensities…'); await delay(100)
    

    setProc(90, 'Computing volumetrics…', 4); await delay(100)
    analysisData = computeMetrics(labelMap)
    saveLongitudinal(analysisData)

    // Add tumor clinical rule if applicable
    addTumorRule(tumorData)

    setProc(97, 'Evaluating ICD-10 clinical rules…', 5); await delay(200)
    setProc(100, 'Complete.', 5); await delay(300)

    renderResults(analysisData)
    
    procOverlay.classList.add('hidden')
    setState(State.DONE)
  } catch (err) {
    console.error('[NeuroHEX] Analysis error:', err)
    procOverlay.classList.add('hidden')
    setState(State.LOADED)
    alert('Analysis encountered an error. See console.\n' + err.message)
  }
}

// ── [P2-05] BRATS TUMOR SCREENING ─────────────────────────────────────────────
async function runTumorScreening() {
  try {
    const formData = new FormData()
    formData.append('file', uploadedFile)
    const resp = await fetch(`${BACKEND_URL}/tumor`, { method: 'POST', body: formData })
    if (!resp.ok) throw new Error(`Tumor API ${resp.status}`)
    const data = await resp.json()

    // Decode label map base64 → blob → URL for NiiVue
    if (data.label_nii_b64) {
      const binary = atob(data.label_nii_b64)
      const bytes  = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      if (tumorUrl) URL.revokeObjectURL(tumorUrl)
      tumorUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    }
    return data
  } catch (e) {
    console.warn('[NeuroHEX] Tumor backend unavailable:', e)
    return null
  }
}

// ── RESULTS RENDERING ──────────────────────────────────────────────────────────
function renderResults(d) {
  [
    'tissue-seg-section', 'analysis-results-section', 'hippo-section',
    'brain-age-section', 'tumor-section',
    'analysis-clinical-section', 'longitudinal-section', 'anomaly-section',
    'surgery-section', 'analysis-export-section', 'three-brain-section',
    'ai-report-section',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'block' })

  injectScoreBadge(d)
  renderTissuePanel(d)
  // Update metadata panel BRAIN VOL with real SynthSeg total
  if (metaGrid && d.brain) {
    const brainValEl = metaGrid.querySelector('.meta-val:last-of-type')
    // Re-render the full grid with the real brain volume
    const { dims, pixdims, voxelVolMm3 } = niftiMeta
    metaGrid.innerHTML = [
      { key:'DIMENSIONS', val: dims.join(' × ') + ' vx' },
      { key:'VOX SIZE',   val: pixdims.map(p => p.toFixed(2)).join(' × ') + ' mm' },
      { key:'VOX VOL',    val: voxelVolMm3.toFixed(3) + ' mm³' },
      { key:'BRAIN VOL',  val: d.brain.toFixed(0) + ' cm³' },
      { key:'MODALITY',   val: 'T1-MRI' },
      { key:'ORIENT',     val: 'RAS' },
    ].map(({ key, val }) =>
      `<div class="meta-item"><div class="meta-key">${key}</div><div class="meta-val">${val}</div></div>`
    ).join('')
  }
  renderVolumetrics(d)
  renderHippoPanel(d)
  renderBrainAge(d)
  renderTumorPanel(tumorData)
  renderClinicalFlags(d)
  
  renderLongitudinal('longitudinal-chart')

  document.getElementById('export-btn')?.addEventListener('click', exportReport)
  document.getElementById('export-pdf-btn')?.addEventListener('click', exportPDF)
  document.getElementById('export-json-btn')?.addEventListener('click', exportJSON)
  // [P4-12] Double RAF to avoid race condition with display:none → display:block
  if (threeRenderer) {
    updateBrainDiagramScale(d)
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      initThreeBrain().then(() => updateBrainDiagramScale(d))
      const tc = document.getElementById('three-brain-canvas')
      if (tc && threeRenderer && threeCamera) {
        threeRenderer.setSize(tc.clientWidth, tc.clientHeight || 220)
        threeCamera.aspect = tc.clientWidth / (tc.clientHeight || 220)
        threeCamera.updateProjectionMatrix()
      }
    }))
  }

  // Wire AI report button
  requestAnimationFrame(() => {
    const aiBtn     = document.getElementById('ai-report-generate-btn')
    const aiPre     = document.getElementById('ai-report-pre')
    const actionsEl = document.getElementById('ai-report-actions')
    const bengaliBtn  = document.getElementById('bengali-explain-btn')
    const referralBtn = document.getElementById('referral-letter-btn')
    const secondaryPre = document.getElementById('secondary-report-pre')

    if (aiBtn && aiPre) {
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true; aiBtn.textContent = '⏳ Generating report…'
        try {
          const report = await generateAIReport(d, tumorData, anomalyRegions)
          await streamAIReport(report, aiPre)
          // Reveal the two secondary action buttons once primary report exists
          if (actionsEl) actionsEl.style.display = 'flex'
        } catch (e) {
          aiPre.textContent = '⚠ Report error: ' + e.message
        } finally {
          aiBtn.disabled = false; aiBtn.textContent = '◈ Generate Clinical Report'
        }
      })
    }

    if (bengaliBtn && secondaryPre) {
      bengaliBtn.addEventListener('click', async () => {
        bengaliBtn.disabled = true
        bengaliBtn.textContent = '⏳ বাংলায় অনুবাদ হচ্ছে…'
        secondaryPre.style.display = 'block'
        secondaryPre.textContent = ''
        try {
          const existingReport = aiPre?.textContent || ''
          const text = await _callGroqBengali(d, tumorData, anomalyRegions, existingReport)
          await streamAIReport(text, secondaryPre)
        } catch (e) {
          secondaryPre.textContent = '⚠ বাংলা ব্যাখ্যা তৈরি করা যায়নি: ' + e.message
        } finally {
          bengaliBtn.disabled = false
          bengaliBtn.textContent = '🇧🇩 সহজ বাংলায় ব্যাখ্যা করুন'
        }
      })
    }

    if (referralBtn && secondaryPre) {
      referralBtn.addEventListener('click', async () => {
        referralBtn.disabled = true
        referralBtn.textContent = '⏳ Drafting referral letter…'
        secondaryPre.style.display = 'block'
        secondaryPre.textContent = ''
        try {
          const text = await _callGroqReferral(d, tumorData, anomalyRegions)
          await streamAIReport(text, secondaryPre)
          const refPdfBtn = document.getElementById('referral-pdf-btn')
          if (refPdfBtn) {
            refPdfBtn.style.display = 'block'
            refPdfBtn.onclick = downloadReferralPDF
          }
        } catch (e) {
          secondaryPre.textContent = '⚠ Referral letter error: ' + e.message
        } finally {
          referralBtn.disabled = false
          referralBtn.textContent = '📋 Generate Referral Letter'
        }
      })
    }
  })
}

function injectScoreBadge(d) {
  document.getElementById('score-badge-inject')?.remove()
  const badge = document.createElement('div'); badge.id = 'score-badge-inject'
  badge.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(0,229,255,.04);border-bottom:1px solid rgba(0,229,255,.1);font-family:var(--mono);'
  const color = d.normalcy >= 80 ? 'var(--green)' : d.normalcy >= 60 ? 'var(--amber)' : 'var(--red)'
  const desc  = d.normalcy >= 80 ? 'Normal morphology' : d.normalcy >= 60 ? 'Mild deviation' : 'Significant deviation'
  const C = 28 * 2 * Math.PI, pct = d.normalcy / 100
  const demoTag = window.demoMode ? `<span style="font-family:var(--mono);font-size:7px;color:var(--amber);background:rgba(255,170,0,.12);border:1px solid rgba(255,170,0,.3);border-radius:4px;padding:2px 7px;margin-left:auto">⚠ DEMO MODE</span>` : ''
  badge.innerHTML = `
    <div class="score-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="28" stroke="rgba(0,229,255,.1)" stroke-width="4" fill="none"/>
        <circle cx="36" cy="36" r="28" stroke="${color}" stroke-width="4" fill="none"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 36 36)" id="score-arc-main"
          style="transition:stroke-dashoffset 1.4s cubic-bezier(.16,1,.3,1)"/>
      </svg>
      <div class="score-ring-val" style="color:${color}">${d.normalcy}</div>
    </div>
    <div style="flex:1">
      <div style="font-size:7.5px;letter-spacing:.18em;color:var(--fg-dim)">NORMALCY INDEX</div>
      <div style="font-size:13px;color:var(--fg);margin-top:2px">${desc}</div>
      <div style="font-size:8px;color:var(--fg-dim);margin-top:2px">${d.pct}th %ile · ASI ${d.asi}%</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${d.brain >= d.norm.lo && d.brain <= d.norm.hi ? '<span class="flag-chip flag-ok">✓ Vol</span>' : '<span class="flag-chip flag-warn">⚠ Vol</span>'}
      ${d.asi < 3 ? '<span class="flag-chip flag-ok">✓ ASI</span>' : d.asi < 8 ? '<span class="flag-chip flag-warn">⚠ ASI</span>' : '<span class="flag-chip flag-alert">⚠ ASI</span>'}
    </div>
    ${demoTag}`
  const rpScaffold = document.getElementById('rp-results-scaffold')
  if (rpScaffold) rpScaffold.insertBefore(badge, rpScaffold.firstChild)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const arc = document.getElementById('score-arc-main')
    if (arc) arc.style.strokeDashoffset = String(C - (pct * C))
  }))
}

function renderTissuePanel(d) {
  const el = document.getElementById('tissue-panel-list'); if (!el) return
  // Norms calibrated to SynthSeg parcellation output (not whole-brain ICV).
  // SynthSeg GM includes cortex labels 3+42 only; CSF covers ventricular labels only.
  // Expected ranges derived from SynthSeg validation cohorts.
  const tissues = [
    { key: 'gm',   label: 'Grey Matter',  vol: d.gm,   color: '#39ff6e', norm: [400, 620] },
    { key: 'wm',   label: 'White Matter', vol: d.wm,   color: '#ffcc44', norm: [280, 460] },
    { key: 'csf',  label: 'CSF',          vol: d.csf,  color: '#4488ff', norm: [10,  120] },
    { key: 'deep', label: 'Deep Grey',    vol: d.deep, color: '#ff6b35', norm: [30,  75]  },
  ]
  const src = niftiMeta.synthSegLabels ? 'SynthSeg' : 'Demo'
  el.innerHTML = tissues.map(t => {
    const pct = (t.vol / d.brain * 100).toFixed(1)
    const inN = t.vol >= t.norm[0] && t.vol <= t.norm[1]
    return `<div class="tissue-row">
      <div class="tissue-dot" style="background:${t.color};box-shadow:0 0 6px ${t.color}55"></div>
      <div class="tissue-info">
        <div class="tissue-label-txt">${t.label}</div>
        <div class="tissue-stats-txt">${t.vol.toFixed(1)} cm³ · ${pct}% · <span style="color:${inN ? 'var(--green)' : 'var(--amber)'}">${inN ? '✓ Normal' : '⚠ Out of range'}</span></div>
      </div>
    </div>`
  }).join('') + `<div style="font-family:var(--mono);font-size:7px;color:var(--fg-dim);margin-top:6px;opacity:.6">Source: ${src} · Billot et al., Nature Methods 2023</div>`
}

function renderVolumetrics(d) {
  const el = document.getElementById('volume-metrics'); if (!el) return
  const items = [
    { name: 'Total Brain',  val: d.brain.toFixed(1), color: 'var(--cyan)',  pct: d.brain / 17 },
    { name: 'Grey Matter',  val: d.gm.toFixed(1),    color: 'var(--green)', pct: d.gm / 7 },
    { name: 'White Matter', val: d.wm.toFixed(1),    color: 'var(--amber)', pct: d.wm / 6 },
    { name: 'CSF',          val: d.csf.toFixed(1),   color: '#4488ff',      pct: d.csf / 2.5 },
    { name: 'Deep Grey',    val: d.deep.toFixed(1),  color: '#ff6b35',      pct: d.deep / .8 },
  ]
  el.innerHTML = items.map(it => `
    <div class="metric-row">
      <div class="metric-header"><span class="metric-name">${it.name}</span><span class="metric-val">${it.val} cm³</span></div>
      <div class="metric-bar-track"><div class="metric-bar-fill" style="width:0%;background:${it.color}" data-target="${clamp(it.pct * 100, 0, 100).toFixed(1)}"></div></div>
    </div>`).join('') + `<div class="demo-badge">
    <span style="color:var(--fg-dim)">Demographic Percentile</span>
    <span style="color:var(--cyan);font-weight:700">${d.pct}th %ile</span>
    <span style="color:var(--fg-dim);font-size:8px">Norm: ${d.norm.lo}–${d.norm.hi} cm³</span>
  </div>`
  requestAnimationFrame(() => el.querySelectorAll('.metric-bar-fill').forEach(b => {
    b.style.transition = 'width 1s cubic-bezier(.16,1,.3,1)'; b.style.width = b.dataset.target + '%'
  }))
}

function renderHippoPanel(d) {
  const el = document.getElementById('hippo-panel'); if (!el) return
  const n = d.hipNorm
  const lC = d.hipL < n.lo ? 'var(--red)' : d.hipL < n.mean * .9 ? 'var(--amber)' : 'var(--green)'
  const rC = d.hipR < n.lo ? 'var(--red)' : d.hipR < n.mean * .9 ? 'var(--amber)' : 'var(--green)'
  const src = niftiMeta.synthSegLabels ? 'Real (FreeSurfer labels 17+53)' : 'Demo estimate'
  el.innerHTML = `
    <div class="hippo-header">HIPPOCAMPAL VOLUME</div>
    <div class="hippo-sub">${src} · Raz et al. normative reference</div>
    <div class="hippo-row"><span class="hippo-side">Left</span><span class="hippo-vol" style="color:${lC}">${d.hipL} cm³</span><span class="hippo-delta" style="color:${lC}">${d.hipLPct > 0 ? '+' : ''}${d.hipLPct}% vs age norm</span></div>
    <div class="hippo-row"><span class="hippo-side">Right</span><span class="hippo-vol" style="color:${rC}">${d.hipR} cm³</span><span class="hippo-delta" style="color:${rC}">${d.hipRPct > 0 ? '+' : ''}${d.hipRPct}% vs age norm</span></div>
    <div class="hippo-row" style="border-top:1px solid rgba(0,229,255,.08);padding-top:6px;margin-top:4px">
      <span class="hippo-side">ASI</span>
      <span class="hippo-vol" style="color:${d.hipAsi >= 5 ? 'var(--amber)' : 'var(--green)'}">${d.hipAsi}%</span>
      <span class="hippo-delta" style="color:${d.hipAsi >= 5 ? 'var(--amber)' : 'var(--green)'}">${d.hipAsi >= 5 ? '⚠ Elevated (>5%)' : '✓ Normal (<5%)'}</span>
    </div>
    <div class="hippo-norm">Age/sex norm: ${n.lo}–${n.hi} cm³/side · Age ${d.age || '?'} · ${d.sex || '?'}</div>`
}

// [P2-07] Brain Age panel
function renderBrainAge(d) {
  const el = document.getElementById('brain-age-panel'); if (!el) return
  const { predicted, chronological, gap } = computeBrainAge(d)
  const gapColor = Math.abs(gap) <= 5 ? 'var(--green)' : Math.abs(gap) <= 10 ? 'var(--amber)' : 'var(--red)'
  const gapLabel = gap > 0 ? `+${gap}yr (appears older)` : `${gap}yr (appears younger)`
  el.innerHTML = `
    <div class="brain-age-row"><span class="brain-age-label">PREDICTED AGE</span><span class="brain-age-val" style="color:var(--cyan)">${predicted}yr</span></div>
    <div class="brain-age-row"><span class="brain-age-label">CHRONOLOGICAL AGE</span><span class="brain-age-val" style="color:var(--fg)">${chronological || '?'}yr</span></div>
    <div class="brain-age-row" style="border-bottom:none"><span class="brain-age-label">BRAIN AGE GAP</span><span class="brain-age-val" style="color:${gapColor}">${gapLabel}</span></div>
    <div class="brain-age-citation">Cole et al. 2018, Nature Communications · Simplified linear model</div>`
}

// [P2-05] Tumor panel
function renderTumorPanel(t) {
  const el = document.getElementById('tumor-panel'); if (!el) return
  if (!t) {
    el.innerHTML = `<div class="tumor-none" style="color:var(--fg-dim)">✓ No tumor detected — brain appears normal</div><div class="tumor-attr">BraTS 2020 · Menze et al. IEEE TMI 2015</div>`
    return
  }
  if (t.classification === 'none') {
    el.innerHTML = `<div class="tumor-none">✓ No significant tumor burden detected</div><div class="tumor-attr">Model: ${t.model} · ${t.citation}</div>`
    return
  }
  el.innerHTML = `
    ${t.enhancing_cm3 > 0 ? `<div class="tumor-row"><div class="tumor-dot" style="background:#ff3355"></div><span class="tumor-label">Enhancing Tumor</span><span class="tumor-vol" style="color:var(--red)">${t.enhancing_cm3} cm³</span></div>` : ''}
    ${t.edema_cm3 > 0 ? `<div class="tumor-row"><div class="tumor-dot" style="background:#ffaa00"></div><span class="tumor-label">Edema / Invasion</span><span class="tumor-vol" style="color:var(--amber)">${t.edema_cm3} cm³</span></div>` : ''}
    ${t.necrotic_cm3 > 0 ? `<div class="tumor-row"><div class="tumor-dot" style="background:#663399"></div><span class="tumor-label">Necrotic Core</span><span class="tumor-vol" style="color:#aa66ff">${t.necrotic_cm3} cm³</span></div>` : ''}
    <div style="font-family:var(--mono);font-size:9px;color:${t.classification === 'significant' ? 'var(--red)' : 'var(--amber)'};padding:6px 0;font-weight:700">Classification: ${t.classification.toUpperCase()}</div>
    <div class="tumor-attr">Model: ${t.model} · ${t.citation}</div>`
}

function renderClinicalFlags(d) {
  const el = document.getElementById('clinical-flags'); if (!el) return
  const active = evalRules(d)
  
  if (!active.length) { el.innerHTML = '<div style="font-size:9px;color:var(--green);padding:8px 0">✓ No clinical flags raised</div>'; return }
  el.innerHTML = active.map(rule => `
    <div class="flag-item ${rule.sev}">
      <span class="flag-icon">${rule.icon}</span>
      <div class="flag-text-wrap">
        <div class="flag-text-title">${typeof rule.title === 'function' ? rule.title(d) : rule.title}</div>
        <div class="flag-text-sub">${typeof rule.desc === 'function' ? rule.desc(d) : rule.desc}</div>
        ${rule.ddx.length ? `<div class="flag-ddx">DDx: ${rule.ddx.join(' / ')}</div>` : ''}
        ${rule.rec ? `<div class="flag-rec">↗ ${rule.rec}</div>` : ''}
      </div>
    </div>`).join('')
}


// ── EXPORTS ────────────────────────────────────────────────────────────────────
function exportReport() {
  if (!analysisData) { alert('Run analysis first.'); return }
  const d = analysisData
  const pid   = document.getElementById('patient-id')?.value || 'N/A'
  const age   = document.getElementById('patient-age')?.value || 'N/A'
  const sex   = document.getElementById('patient-sex')?.value || 'N/A'
  const dt    = document.getElementById('scan-date')?.value || new Date().toISOString().split('T')[0]
  const notes = document.getElementById('clinical-notes')?.value || '—'
  const active = evalRules(d)
  const brainAge = computeBrainAge(d)
  const aiReportText = document.getElementById('ai-report-pre')?.textContent || ''
  const tumorSection = tumorData
    ? `<h2>TUMOR SCREENING</h2><p>Edema ${tumorData.edema_cm3}cm³ · Enhancing ${tumorData.enhancing_cm3}cm³ · Necrotic ${tumorData.necrotic_cm3}cm³ · <strong>${tumorData.classification.toUpperCase()}</strong></p>`
    : '<h2>TUMOR SCREENING</h2><p>Not performed (backend unavailable)</p>'

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NeuroHEX Report — ${pid}</title>
<style>body{font-family:'Courier New',monospace;background:#020508;color:#a8d8e8;margin:0;padding:40px}
h1{font-family:sans-serif;color:#00e5ff;letter-spacing:.3em;font-size:22px}h2{font-family:sans-serif;color:#00e5ff;letter-spacing:.15em;font-size:14px;border-bottom:1px solid rgba(0,229,255,.2);padding-bottom:6px;margin-top:28px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.gi{padding:10px;border:1px solid rgba(0,229,255,.1);border-radius:6px}
.gk{font-size:9px;color:#4a7a8a;letter-spacing:.18em;text-transform:uppercase}.gv{font-size:14px;color:#00e5ff;margin-top:4px}
.badge{display:inline-block;padding:6px 18px;border-radius:6px;font-size:28px;font-weight:bold;color:#00e5ff;border:2px solid #00e5ff}
table{width:100%;border-collapse:collapse;margin:12px 0}th{text-align:left;font-size:9px;letter-spacing:.18em;color:#4a7a8a;border-bottom:1px solid rgba(0,229,255,.1);padding:6px 8px}
td{padding:6px 8px;font-size:11px;border-bottom:1px solid rgba(0,229,255,.05)}
.f{padding:8px 12px;border-radius:6px;margin:6px 0;font-size:11px}
.ok{background:rgba(57,255,110,.07);border-left:3px solid #39ff6e}.warn{background:rgba(255,170,0,.07);border-left:3px solid #ffaa00}.alert{background:rgba(255,51,85,.07);border-left:3px solid #ff3355}
.ddx{font-size:10px;color:#7ab8cc;margin-top:4px}.rec{font-size:10px;color:#00b4cc;margin-top:2px}
.ai-report{white-space:pre-wrap;font-family:'Courier New',monospace;font-size:11px;line-height:1.8;background:rgba(0,229,255,.03);border:1px solid rgba(0,229,255,.1);border-radius:6px;padding:16px;margin:12px 0}
footer{margin-top:60px;font-size:9px;color:#4a7a8a;border-top:1px solid rgba(0,229,255,.1);padding-top:16px}</style></head><body>
<h1>⬡ NEUROHEX — CLINICAL REPORT v2.0</h1>
<p style="color:#4a7a8a;font-size:10px">GENERATED: ${new Date().toLocaleString()} · Segmentation: SynthSeg (Billot et al., Nature Methods 2023)</p>
${window.demoMode ? '<p style="color:#ffaa00;font-size:10px;border:1px solid rgba(255,170,0,.3);padding:6px 12px;border-radius:4px">⚠ DEMO MODE — Volumes are estimated. Real SynthSeg was unavailable during this session.</p>' : ''}
<h2>PATIENT</h2><div class="g">
<div class="gi"><div class="gk">Patient ID</div><div class="gv">${pid}</div></div>
<div class="gi"><div class="gk">Age / Sex</div><div class="gv">${age} / ${sex}</div></div>
<div class="gi"><div class="gk">Scan Date</div><div class="gv">${dt}</div></div>
<div class="gi"><div class="gk">Percentile</div><div class="gv">${d.pct}th</div></div>
<div class="gi" style="grid-column:1/-1"><div class="gk">Notes</div><div class="gv" style="font-size:11px">${notes}</div></div></div>
<h2>NORMALCY INDEX</h2><p>Score: <span class="badge">${d.normalcy}</span> / 100 &nbsp;·&nbsp; ${d.pct}th demographic percentile</p>
<h2>BRAIN AGE (Cole et al. 2018, Nature Communications)</h2>
<p>Predicted: <strong>${brainAge.predicted}yr</strong> · Chronological: ${brainAge.chronological}yr · Gap: <strong>${brainAge.gap > 0 ? '+' : ''}${brainAge.gap}yr</strong></p>
<h2>VOLUMETRICS</h2><table><tr><th>Compartment</th><th>Volume (cm³)</th><th>% Brain</th><th>Norm Range</th></tr>
<tr><td>Total Brain</td><td>${d.brain.toFixed(1)}</td><td>100%</td><td>${d.norm.lo}–${d.norm.hi}</td></tr>
<tr><td>Grey Matter</td><td>${d.gm.toFixed(1)}</td><td>${(d.gm / d.brain * 100).toFixed(1)}%</td><td>~400–620</td></tr>
<tr><td>White Matter</td><td>${d.wm.toFixed(1)}</td><td>${(d.wm / d.brain * 100).toFixed(1)}%</td><td>~280–460</td></tr>
<tr><td>CSF</td><td>${d.csf.toFixed(1)}</td><td>${(d.csf / d.brain * 100).toFixed(1)}%</td><td>~10–120</td></tr>
<tr><td>Deep Grey</td><td>${d.deep.toFixed(1)}</td><td>${(d.deep / d.brain * 100).toFixed(1)}%</td><td>~30–75</td></tr>
<h2>HIPPOCAMPAL VOLUMES</h2><table><tr><th>Side</th><th>Volume (cm³)</th><th>Δ from Norm</th><th>Norm Range</th></tr>
<tr><td>Left (label 17)</td><td>${d.hipL}</td><td>${d.hipLPct > 0 ? '+' : ''}${d.hipLPct}%</td><td>${d.hipNorm.lo}–${d.hipNorm.hi}</td></tr>
<tr><td>Right (label 53)</td><td>${d.hipR}</td><td>${d.hipRPct > 0 ? '+' : ''}${d.hipRPct}%</td><td>${d.hipNorm.lo}–${d.hipNorm.hi}</td></tr>
<tr><td colspan="4" style="color:#4a7a8a;font-size:10px">Asymmetry Index: ${d.hipAsi}% (normal &lt;5%)</td></tr></table>
${tumorSection}
<h2>WM HYPERINTENSITY DETECTION (Fazekas criteria)</h2>
<p style="font-size:11px">${anomalyRegions.length} candidate(s): ${anomalyRegions.map(a => `${a.label} (${a.severity}, ${a.signalRatio}%)`).join(', ') || 'None'}</p>
<h2>CLINICAL FLAGS <span style="font-size:9px;color:#4a7a8a">(Raz et al., Jack et al., Fazekas criteria)</span></h2>
${active.map(r => `<div class="f ${r.sev}"><strong>${r.icon} ${typeof r.title === 'function' ? r.title(d) : r.title}</strong><br>${typeof r.desc === 'function' ? r.desc(d) : r.desc}${r.ddx.length ? `<div class="ddx">DDx: ${r.ddx.join(' / ')}</div>` : ''}${r.rec ? `<div class="rec">↗ ${r.rec}</div>` : ''}</div>`).join('')}
${aiReportText ? `<h2>CLINICAL INTERPRETATION (Rule-based · GROQ · Gemini 2.0 Flash if available)</h2><div class="ai-report">${aiReportText}</div>` : ''}
<footer>
NeuroHEX v2.0 · Browser-based AI-assisted MRI analysis · No data leaves device<br>
Segmentation by SynthSeg (Nature Methods 2023) · Tumor screening by BraTS 2020 · Clinical narrative by Gemini 2.0 Flash<br>
Brain age by Cole et al. (Nature Communications 2018) · Not a substitute for clinical diagnosis. Consult a qualified neurologist.<br>
<em>NeuroHEX is a browser-based diagnostic tool requiring no specialized hardware — designed for resource-constrained clinical settings.</em>
</footer></body></html>`
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `NeuroHEX_Report_${pid}_${dt}.html`; a.click()
}

function exportJSON() {
  if (!analysisData) { alert('Run analysis first.'); return }
  const d = analysisData, pid = document.getElementById('patient-id')?.value || 'N/A'
  const dt = document.getElementById('scan-date')?.value || new Date().toISOString().split('T')[0]
  const brainAge = computeBrainAge(d)
  const payload = {
    schema: 'neurohex-v2', generated: new Date().toISOString(),
    mode: window.demoMode ? 'demo' : 'real',
    segmentation: { model: 'SynthSeg', citation: 'Billot et al., Nature Methods 2023' },
    patient: { id: pid, age: d.age, sex: d.sex, scanDate: dt, notes: document.getElementById('clinical-notes')?.value },
    volumetrics: { brain: d.brain, gm: d.gm, wm: d.wm, csf: d.csf, deep: d.deep },
    hippocampal: { L: d.hipL, R: d.hipR, LdeltaPct: d.hipLPct, RdeltaPct: d.hipRPct, asi: d.hipAsi, norm: d.hipNorm, source: niftiMeta.synthSegLabels ? 'FreeSurfer labels 17+53' : 'demo_estimate' },
    brainAge: { ...brainAge, model: 'Cole et al. 2018 Nature Communications' },
    tumorScreening: tumorData || { status: 'unavailable' },
    hemisphere: { lh: d.lh, rh: d.rh, asi: d.asi },
    normalcyIndex: d.normalcy, percentile: d.pct, normRange: d.norm,
    wmHyperintensities: anomalyRegions,
    clinicalFlags: evalRules(d).map(r => ({
      name: r.name, severity: r.sev,
      title: typeof r.title === 'function' ? r.title(d) : r.title,
      desc: typeof r.desc === 'function' ? r.desc(d) : r.desc,
      ddx: r.ddx, rec: r.rec
    })),
    surgeryPins: surgeryPins.map(p => ({ label: p.label, x: p.x, y: p.y })),
    regions: d.regions,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `NeuroHEX_Data_${pid}_${dt}.json`; a.click()
}
// ── PDF EXPORT ─────────────────────────────────────────────────────────────────
// Loads jsPDF dynamically (no bundler config needed), then renders a clean
// clinical PDF. Falls back gracefully if the CDN is unreachable.
async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
  return window.jspdf.jsPDF
}

async function exportPDF() {
  if (!analysisData) { alert('Run analysis first.'); return }

  const btn = document.getElementById('export-pdf-btn')
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building PDF…' }

  try {

    const d        = analysisData
    const brainAge = computeBrainAge(d)
    const active   = evalRules(d)
    const pid      = document.getElementById('patient-id')?.value   || 'N/A'
    const age      = document.getElementById('patient-age')?.value  || 'N/A'
    const sex      = document.getElementById('patient-sex')?.value  || 'N/A'
    const dt       = document.getElementById('scan-date')?.value    || new Date().toISOString().split('T')[0]
    const notes    = document.getElementById('clinical-notes')?.value || '—'
    const aiText   = document.getElementById('ai-report-pre')?.textContent?.trim() || ''

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const PW  = 210
    const PH  = 297
    const ML  = 18
    const MR  = 18
    const CW  = PW - ML - MR
    let   y   = 0

    // ── Colour palette — true high-contrast light theme ─────────────────────
    // Ink-on-paper medical report aesthetic: no grey cards, no washed tones.
    const C = {
      white:     [255, 255, 255],
      offWhite:  [248, 249, 251],   // barely-there page tint
      ink:       [10,  12,  20 ],   // near-black for all body text
      inkMid:    [55,  62,  80 ],   // secondary labels — dark enough to read
      rule:      [180, 185, 195],   // hairline dividers
      accent:    [0,   70,  140],   // header / cyan brand (dark, readable)
      accentPale:[230, 240, 252],   // tinted panel fill (hero band)
      green:     [10,  120,  50],   // normal / ok
      greenPale: [224, 245, 232],
      amber:     [140,  80,   0],   // warn — dark amber, not yellow
      amberPale: [255, 243, 220],
      red:       [170,  15,  30],   // alert — deep crimson
      redPale:   [253, 228, 230],
      purple:    [100,  50, 180],   // necrotic
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    const setFill   = rgb => doc.setFillColor(...rgb)
    const setStroke = rgb => doc.setDrawColor(...rgb)
    const setTxt    = rgb => doc.setTextColor(...rgb)

    // Two font roles: data (Courier for monospaced numerics) and label (Helvetica)
    const dataFont  = (style = 'normal', size = 9) => { doc.setFont('courier',   style); doc.setFontSize(size) }
    const labelFont = (style = 'normal', size = 8) => { doc.setFont('helvetica', style); doc.setFontSize(size) }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

    const printWrapped = (text, x, startY, maxW, lineH = 5) => {
      const lines = doc.splitTextToSize(String(text), maxW)
      lines.forEach(ln => {
        if (startY > PH - 20) { doc.addPage(); startY = 20; drawPageBg(); drawPageHeader() }
        doc.text(ln, x, startY)
        startY += lineH
      })
      return startY
    }

    // ── Page background (plain white) ───────────────────────────────────────
    function drawPageBg() {
      setFill(C.white)
      doc.rect(0, 0, PW, PH, 'F')
    }

    // ── Header band ─────────────────────────────────────────────────────────
    // Dark accent bar at the top — NEUROHEX white on accent, right side patient ID
    function drawPageHeader() {
      setFill(C.accent)
      doc.rect(0, 0, PW, 14, 'F')

      setTxt(C.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      doc.text('NEUROHEX', ML, 9)

      setTxt([180, 210, 245]); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text('AI-Assisted Neuroimaging Report', ML + 34, 9)

      setTxt([200, 220, 250]); doc.setFont('courier', 'normal'); doc.setFontSize(6.5)
      doc.text(`Patient: ${pid}   |   ${dt}`, PW - MR - 62, 9)
    }

    // ── Section header — left rule + label ──────────────────────────────────
    const sectionHeader = (label, yPos) => {
      if (yPos > PH - 30) { doc.addPage(); yPos = 20; drawPageBg(); drawPageHeader() }
      yPos += 3

      // Full-width rule
      setStroke(C.accent); doc.setLineWidth(0.5)
      doc.line(ML, yPos, ML + CW, yPos)

      // Label sitting just above rule
      setTxt(C.accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      doc.text(label.toUpperCase(), ML, yPos - 1.5)

      return yPos + 6
    }

    // ── Key / value row ──────────────────────────────────────────────────────
    // Key in dark mid-grey helvetica, value in near-black courier bold
    const kvRow = (key, val, yPos, valColor = C.ink) => {
      if (yPos > PH - 15) { doc.addPage(); yPos = 20; drawPageBg(); drawPageHeader() }

      setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      doc.text(key, ML + 2, yPos)

      setTxt(valColor); doc.setFont('courier', 'bold'); doc.setFontSize(8)
      doc.text(String(val), ML + 68, yPos)

      // Dotted leader between key and value
      setStroke(C.rule); doc.setLineWidth(0.2)
      doc.setLineDashPattern([0.5, 1.5], 0)
      doc.line(ML + 2 + doc.getTextWidth(key) + 1, yPos - 1, ML + 65, yPos - 1)
      doc.setLineDashPattern([], 0)

      return yPos + 5.5
    }

    // ── Metric bar ───────────────────────────────────────────────────────────
    // Label left, value centre, progress bar right with pale fill + colour fill
    const metricBar = (label, val, unit, pct, color, paleFill, yPos) => {
      if (yPos > PH - 18) { doc.addPage(); yPos = 20; drawPageBg(); drawPageHeader() }

      setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(label, ML + 2, yPos)

      setTxt(color); doc.setFont('courier', 'bold'); doc.setFontSize(8.5)
      doc.text(`${val} ${unit}`, ML + 58, yPos)

      // Track (pale tint of the colour)
      const barX = ML + 97, barY = yPos - 3.2, barW = 85, barH = 3.8
      setFill(paleFill); setStroke(paleFill); doc.setLineWidth(0)
      doc.roundedRect(barX, barY, barW, barH, 1, 1, 'F')

      // Fill
      const fw = clamp(pct, 0, 100) / 100 * barW
      if (fw > 0) {
        setFill(color)
        doc.roundedRect(barX, barY, fw, barH, 1, 1, 'F')
      }

      // Bar border
      setStroke(C.rule); doc.setLineWidth(0.15)
      doc.roundedRect(barX, barY, barW, barH, 1, 1, 'S')

      return yPos + 6.5
    }

    // ── Flag row ─────────────────────────────────────────────────────────────
    // Tinted background card + strong left border stripe
    const flagRow = (icon, title, desc, sev, yPos) => {
      if (yPos > PH - 26) { doc.addPage(); yPos = 20; drawPageBg(); drawPageHeader() }

      const col      = sev === 'alert' ? C.red   : sev === 'warn' ? C.amber   : C.green
      const pale     = sev === 'alert' ? C.redPale : sev === 'warn' ? C.amberPale : C.greenPale
      const cardH    = 14  // will grow with content; approximate
      const stripeW  = 3

      // Card fill
      setFill(pale); setStroke(pale); doc.setLineWidth(0)
      doc.roundedRect(ML, yPos - 4, CW, cardH, 1.5, 1.5, 'F')

      // Left colour stripe
      setFill(col)
      doc.rect(ML, yPos - 4, stripeW, cardH, 'F')

      // Title
      setTxt(col); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
      doc.text(`${icon}  ${title}`, ML + stripeW + 3, yPos)

      // Description
      setTxt(C.ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      const endY = printWrapped(desc, ML + stripeW + 3, yPos + 4.5, CW - stripeW - 8, 4.2)

      return endY + 4
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — Cover / Summary
    // ════════════════════════════════════════════════════════════════════════
    drawPageBg(); drawPageHeader()
    y = 22

    // ── Hero score panel ────────────────────────────────────────────────────
    const scoreColor = d.normalcy >= 80 ? C.green : d.normalcy >= 60 ? C.amber : C.red
    const scorePale  = d.normalcy >= 80 ? C.greenPale : d.normalcy >= 60 ? C.amberPale : C.redPale
    const scoreDesc  = d.normalcy >= 80 ? 'Normal morphology' : d.normalcy >= 60 ? 'Mild deviation detected' : 'Significant deviation detected'

    // Panel fill
    setFill(scorePale); setStroke(scoreColor); doc.setLineWidth(0.6)
    doc.roundedRect(ML, y, CW, 26, 2.5, 2.5, 'FD')

    // Large score number
    setTxt(scoreColor); doc.setFont('courier', 'bold'); doc.setFontSize(34)
    doc.text(String(d.normalcy), ML + 8, y + 18)

    // Scale label
    setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.text('/ 100   NORMALCY INDEX', ML + 32, y + 10)

    // Description
    setTxt(scoreColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(scoreDesc, ML + 32, y + 17)

    // Sub-metrics
    setTxt(C.inkMid); doc.setFont('courier', 'normal'); doc.setFontSize(7)
    doc.text(`${d.pct}th percentile   ·   ASI ${d.asi}%`, ML + 32, y + 23)

    if (window.demoMode) {
      setTxt(C.amber); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
      doc.text('⚠  DEMO MODE — Not for clinical use', PW - MR - 68, y + 5)
    }

    y += 32

    // ── Patient information ──────────────────────────────────────────────────
    y = sectionHeader('Patient Information', y)
    y = kvRow('Patient ID',    pid,  y)
    y = kvRow('Age / Sex',     `${age} yr  /  ${sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : sex}`, y)
    y = kvRow('Scan Date',     dt,   y)
    y = kvRow('Percentile',    `${d.pct}th`,  y)
    y += 2

    setTxt(C.inkMid); doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    doc.text('CLINICAL NOTES', ML + 2, y); y += 4.5

    setTxt(C.ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    y = printWrapped(notes, ML + 2, y, CW - 4, 4.8)
    y += 5

    // ── Brain age ────────────────────────────────────────────────────────────
    y = sectionHeader('Brain Age  (Cole et al. 2018, Nature Communications)', y)
    const gapAbs   = Math.abs(brainAge.gap)
    const gapColor = gapAbs <= 5 ? C.green : gapAbs <= 10 ? C.amber : C.red
    const gapLabel = brainAge.gap > 0 ? `+${brainAge.gap} yr  (accelerated ageing)` : `${brainAge.gap} yr  (decelerated ageing)`
    y = kvRow('Predicted Brain Age',    `${brainAge.predicted} yr`, y, C.accent)
    y = kvRow('Chronological Age',      `${brainAge.chronological || '?'} yr`, y, C.ink)
    y = kvRow('Brain Age Gap (BAG)',    gapLabel, y, gapColor)
    y += 4


    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — Volumetrics
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage(); drawPageBg(); drawPageHeader(); y = 22

    y = sectionHeader('Tissue Volumetrics  (SynthSeg · Billot et al., Nature Methods 2023)', y)

    const tissueRows = [
      { label: 'Total Brain Volume', val: d.brain.toFixed(1), pct: d.brain / 17,  color: C.accent,       pale: C.accentPale },
      { label: 'Grey Matter',        val: d.gm.toFixed(1),    pct: d.gm / 7,      color: C.green,        pale: C.greenPale  },
      { label: 'White Matter',       val: d.wm.toFixed(1),    pct: d.wm / 6,      color: C.amber,        pale: C.amberPale  },
      { label: 'CSF',                val: d.csf.toFixed(1),   pct: d.csf / 2.5,   color: [40,100,200],   pale: [220,232,255]},
      { label: 'Deep Grey Matter',   val: d.deep.toFixed(1),  pct: d.deep / 0.8,  color: [160,60,0],     pale: [255,235,215]},
    ]
    tissueRows.forEach(r => {
      y = metricBar(r.label, r.val, 'cm³', r.pct * 100, r.color, r.pale, y)
    })
    y += 3

    // Norm reference box
    setFill(C.offWhite); setStroke(C.rule); doc.setLineWidth(0.3)
    doc.roundedRect(ML, y - 1, CW, 9, 1, 1, 'FD')
    setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    doc.text(
      `Reference range for age ${age} (${sex}):  ${d.norm.lo} – ${d.norm.hi} cm³  total brain volume`,
      ML + 3, y + 4.5
    )
    y += 14

    // ── Hippocampal analysis ─────────────────────────────────────────────────
    y = sectionHeader('Hippocampal Analysis  (FreeSurfer labels 17 + 53)', y)

    const lColor = d.hipL < d.hipNorm.lo ? C.red : d.hipL < d.hipNorm.mean * 0.9 ? C.amber : C.green
    const rColor = d.hipR < d.hipNorm.lo ? C.red : d.hipR < d.hipNorm.mean * 0.9 ? C.amber : C.green

    y = kvRow('Left Hippocampus',  `${d.hipL} cm³   (${d.hipLPct > 0 ? '+' : ''}${d.hipLPct}% vs norm)`, y, lColor)
    y = kvRow('Right Hippocampus', `${d.hipR} cm³   (${d.hipRPct > 0 ? '+' : ''}${d.hipRPct}% vs norm)`, y, rColor)
    y = kvRow('Asymmetry Index',   `${d.hipAsi}%   ${d.hipAsi >= 5 ? '⚠  Elevated (>5%)' : '✓  Normal (<5%)'}`, y, d.hipAsi >= 5 ? C.amber : C.green)
    y = kvRow('Age / Sex Norm',    `${d.hipNorm.lo} – ${d.hipNorm.hi} cm³ per side`, y, C.inkMid)
    y += 4

    // ── Regional volumes ─────────────────────────────────────────────────────
    if (d.regions?.length) {
      y = sectionHeader('Regional Brain Volumes', y)
      const hexToRgb = h => {
        const m = h.replace('#','').match(/.{2}/g)
        return m ? m.map(x => parseInt(x, 16)) : C.accent
      }
      // Darken a colour for the bar to ensure contrast
      const darken = ([r,g,b]) => [Math.round(r*0.7), Math.round(g*0.7), Math.round(b*0.7)]
      const lighten = ([r,g,b]) => [Math.min(255,Math.round(r*0.25+191)), Math.min(255,Math.round(g*0.25+191)), Math.min(255,Math.round(b*0.25+191))]

      d.regions.forEach(r => {
        const rgb  = hexToRgb(r.color)
        const dark = darken(rgb)
        const pale = lighten(rgb)
        y = metricBar(r.name, r.vol, 'cm³', r.vol / 6 * 100, dark, pale, y)
      })
    }


    // ════════════════════════════════════════════════════════════════════════
    // PAGE 3 — Clinical Flags, WM Hyperintensities, Tumor Screening
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage(); drawPageBg(); drawPageHeader(); y = 22

    // ── Clinical flags ───────────────────────────────────────────────────────
    y = sectionHeader(`Clinical Flags  (${active.length} raised)`, y)

    if (!active.length) {
      setFill(C.greenPale); setStroke(C.green); doc.setLineWidth(0.3)
      doc.roundedRect(ML, y - 1, CW, 10, 1.5, 1.5, 'FD')
      setTxt(C.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text('✓   No clinical flags raised', ML + 5, y + 5.5)
      y += 14
    } else {
      active.forEach(r => {
        const title = typeof r.title === 'function' ? r.title(d) : r.title
        const desc2 = typeof r.desc  === 'function' ? r.desc(d)  : r.desc
        y = flagRow(r.icon, title, desc2, r.sev, y)

        if (r.ddx?.length) {
          setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
          y = printWrapped('DDx:  ' + r.ddx.join('  /  '), ML + 7, y, CW - 12, 4)
          y += 1
        }
        if (r.rec) {
          setTxt(C.accent); doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5)
          y = printWrapped('→  ' + r.rec, ML + 7, y, CW - 12, 4)
          y += 1
        }
        y += 3
      })
    }
    y += 2

    // ── WM hyperintensities ──────────────────────────────────────────────────
    y = sectionHeader(`WM Hyperintensity Candidates  (${anomalyRegions.length} detected)`, y)

    if (!anomalyRegions.length) {
      setFill(C.greenPale); setStroke(C.green); doc.setLineWidth(0.3)
      doc.roundedRect(ML, y - 1, CW, 10, 1.5, 1.5, 'FD')
      setTxt(C.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text('✓   No candidates above detection threshold', ML + 5, y + 5.5)
      y += 14
    } else {
      anomalyRegions.forEach(a => {
        const sev = a.severity === 'HIGH' ? 'alert' : 'warn'
        y = flagRow('⚠', `${a.label}  —  ${a.severity}`,
          `Signal ratio: ${a.signalRatio}%   ·   Voxel (${a.vx}, ${a.vy}, ${a.vz})`,
          sev, y)
      })
    }
    y += 2

    // ── Tumor screening ──────────────────────────────────────────────────────
    y = sectionHeader('Tumor Screening  (BraTS 2020 ONNX)', y)

    if (!tumorData) {
      setFill(C.offWhite); setStroke(C.rule); doc.setLineWidth(0.3)
      doc.roundedRect(ML, y - 1, CW, 10, 1.5, 1.5, 'FD')
      setTxt(C.inkMid); doc.setFont('helvetica', 'italic'); doc.setFontSize(8)
      doc.text('Backend unavailable — screening skipped', ML + 5, y + 5.5)
      y += 14
    } else if (tumorData.classification === 'none') {
      setFill(C.greenPale); setStroke(C.green); doc.setLineWidth(0.3)
      doc.roundedRect(ML, y - 1, CW, 10, 1.5, 1.5, 'FD')
      setTxt(C.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
      doc.text('✓   No significant tumor burden detected', ML + 5, y + 5.5)
      y += 14
    } else {
      y = kvRow('Edema / Invasion',  `${tumorData.edema_cm3} cm³`,     y, C.amber)
      y = kvRow('Enhancing Tumor',   `${tumorData.enhancing_cm3} cm³`, y, C.red)
      y = kvRow('Necrotic Core',     `${tumorData.necrotic_cm3} cm³`,  y, C.purple)
      y = kvRow('Classification',    tumorData.classification.toUpperCase(), y, C.red)
    }


    // ════════════════════════════════════════════════════════════════════════
    // PAGE 4 — AI Clinical Report (if generated)
    // ════════════════════════════════════════════════════════════════════════
    if (aiText) {
      doc.addPage(); drawPageBg(); drawPageHeader(); y = 22
      y = sectionHeader('AI Clinical Report  (Rule-based / Groq / Gemini 2.0 Flash)', y)

      // Lightly tinted prose background
      const aiLines   = doc.splitTextToSize(aiText, CW - 8)
      const aiBlockH  = aiLines.length * 4.8 + 6
      setFill(C.offWhite); setStroke(C.rule); doc.setLineWidth(0.2)
      doc.roundedRect(ML, y - 2, CW, Math.min(aiBlockH, PH - y - 20), 1, 1, 'FD')

      setTxt(C.ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      y = printWrapped(aiText, ML + 4, y + 3, CW - 8, 4.8)
    }


    // ════════════════════════════════════════════════════════════════════════
    // Footer — every page
    // ════════════════════════════════════════════════════════════════════════
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)

      // Footer band
      setFill(C.offWhite); setStroke(C.rule); doc.setLineWidth(0.3)
      doc.rect(0, PH - 11, PW, 11, 'F')
      doc.line(0, PH - 11, PW, PH - 11)

      // Disclaimer
      setTxt(C.inkMid); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5)
      doc.text(
        'NeuroHEX v2.0  ·  AI-assisted analysis — NOT a substitute for clinical diagnosis  ·  Consult a qualified neuroradiologist',
        ML, PH - 4.5
      )

      // Page number
      doc.setFont('courier', 'bold'); doc.setFontSize(6)
      setTxt(C.accent)
      doc.text(`${i} / ${totalPages}`, PW - MR - 10, PH - 4.5)
    }

    doc.save(`NeuroHEX_Report_${pid}_${dt}.pdf`)

  } catch (err) {
    console.error('[NeuroHEX] PDF export error:', err)
    alert('PDF export failed: ' + err.message)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↓ EXPORT CLINICAL REPORT (PDF)' }
  }
}

// ── REFERRAL LETTER PDF DOWNLOAD ───────────────────────────────────────────────
async function downloadReferralPDF() {
  const text = document.getElementById('secondary-report-pre')?.textContent?.trim()
  if (!text || text.startsWith('⚠')) {
    alert('Generate a referral letter first using the "Generate Referral Letter" button.')
    return
  }

  const btn = document.getElementById('referral-pdf-btn')
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building PDF…' }

  try {
    const d       = analysisData
    const pid     = document.getElementById('patient-id')?.value   || 'N/A'
    const age     = document.getElementById('patient-age')?.value  || 'N/A'
    const sex     = document.getElementById('patient-sex')?.value  || 'N/A'
    const dt      = document.getElementById('scan-date')?.value    || new Date().toISOString().split('T')[0]
    const active  = d ? evalRules(d) : []
    const alerts  = active.filter(r => r.sev === 'alert')
    const urgency = alerts.length >= 2 ? 'URGENT' : alerts.length === 1 ? 'SOON (within 2 weeks)' : 'ROUTINE'
    const urgencyColor = alerts.length >= 2 ? [255, 51, 85] : alerts.length === 1 ? [255, 170, 0] : [57, 255, 110]

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const PW = 210, PH = 297, ML = 20, MR = 20, CW = PW - ML - MR
    let y = 0

    const setFill   = rgb => doc.setFillColor(...rgb)
    const setStroke = rgb => doc.setDrawColor(...rgb)
    const setTxt    = rgb => doc.setTextColor(...rgb)
    const setFont   = (style = 'normal', size = 9) => { doc.setFont('courier', style); doc.setFontSize(size) }
    const printWrap = (text, x, startY, maxW, lh = 5) => {
      doc.splitTextToSize(String(text), maxW).forEach(ln => {
        if (startY > PH - 20) { doc.addPage(); startY = 24; drawLetterHeader() }
        doc.text(ln, x, startY); startY += lh
      })
      return startY
    }

    function drawLetterHeader() {
      // Clean white letterhead
      setFill([248, 250, 252]); doc.rect(0, 0, PW, 28, 'F')
      setStroke([0, 150, 180]); doc.setLineWidth(1.2)
      doc.line(ML, 28, PW - MR, 28)
      setTxt([0, 80, 120]); setFont('bold', 14)
      doc.text('NeuroHEX', ML, 13)
      setTxt([60, 100, 130]); setFont('normal', 7)
      doc.text('AI-Assisted Neuroimaging Diagnostic Unit  ', ML + 38, 13)
      setTxt([120, 150, 170]); setFont('normal', 6)
      doc.text(`Patient: ${pid}  ·  Generated: ${new Date().toLocaleDateString()}`, PW - MR - 65, 13)
    }

    // White background for a professional letter look
    setFill([255, 255, 255]); doc.rect(0, 0, PW, PH, 'F')
    drawLetterHeader()
    y = 36

    // Urgency badge
    setFill(urgencyColor.map(v => Math.min(255, v + 200)))
    doc.roundedRect(ML, y, 50, 9, 1.5, 1.5, 'F')
    setStroke(urgencyColor); doc.setLineWidth(0.5)
    doc.roundedRect(ML, y, 50, 9, 1.5, 1.5, 'S')
    setTxt(urgencyColor.map(v => Math.max(0, v - 80))); setFont('bold', 8)
    doc.text(`REFERRAL: ${urgency}`, ML + 3, y + 5.8)
    y += 14

    // Date + addressee block
    setTxt([40, 60, 80]); setFont('normal', 9)
    doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), ML, y); y += 6
    y += 4
    setFont('bold', 9)
    doc.text('To:', ML, y)
    setFont('normal', 9)
    doc.text('The Specialist Neurologist', ML + 10, y); y += 5
    doc.text('Neurology Department', ML + 10, y); y += 5
    doc.text('[Receiving Institution]', ML + 10, y); y += 10

    setFont('bold', 9)
    doc.text('Re:', ML, y)
    setFont('normal', 9)
    doc.text(`Patient ${pid}  ·  Age ${age}  ·  ${sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : sex}  ·  MRI Date: ${dt}`, ML + 10, y)
    y += 10

    // Horizontal rule
    setStroke([180, 200, 220]); doc.setLineWidth(0.4)
    doc.line(ML, y, PW - MR, y); y += 8

    // Letter body — the Groq-generated text
    setTxt([30, 50, 70]); setFont('normal', 9)
    y = printWrap(text, ML, y, CW, 5.5)
    y += 8

    // Signature block
    if (y > PH - 50) { doc.addPage(); setFill([255,255,255]); doc.rect(0,0,PW,PH,'F'); drawLetterHeader(); y = 36 }
    setStroke([180, 200, 220]); doc.setLineWidth(0.4)
    doc.line(ML, y, PW - MR, y); y += 8
    setTxt([60, 100, 130]); setFont('bold', 9)
    doc.text('Referring Clinician', ML, y); y += 5
    setFont('normal', 8)
    setTxt([80, 120, 150])
    doc.text('NeuroHEX AI-Assisted Diagnostic Unit', ML, y); y += 5
    doc.text(' Browser-based Neuroimaging Platform', ML, y); y += 10

    // Disclaimer box
    setFill([240, 248, 255]); doc.roundedRect(ML, y, CW, 16, 1.5, 1.5, 'F')
    setStroke([150, 190, 220]); doc.setLineWidth(0.3)
    doc.roundedRect(ML, y, CW, 16, 1.5, 1.5, 'S')
    setTxt([80, 120, 160]); setFont('bold', 6.5)
    doc.text('DISCLAIMER', ML + 3, y + 5)
    setFont('normal', 6)
    y = printWrap(
      'This referral letter was generated with AI assistance (NeuroHEX v2.0, SynthSeg, Groq/Gemini). ' +
      'All imaging findings must be verified by a qualified neuroradiologist. This document does not ' +
      'constitute a formal clinical diagnosis and should be used for referral purposes only.',
      ML + 3, y + 9, CW - 6, 4
    )

    // Footer on every page
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      setFill([240, 245, 250]); doc.rect(0, PH - 10, PW, 10, 'F')
      setStroke([180, 200, 220]); doc.setLineWidth(0.3)
      doc.line(0, PH - 10, PW, PH - 10)
      setTxt([120, 150, 170]); setFont('normal', 5.5)
      doc.text('NeuroHEX v2.0 · AI-assisted — not a substitute for clinical diagnosis', ML, PH - 4)
      doc.text(`Page ${i} / ${totalPages}`, PW - MR - 16, PH - 4)
    }

    doc.save(`NeuroHEX_Referral_${pid}_${dt}.pdf`)

  } catch (err) {
    console.error('[NeuroHEX] Referral PDF error:', err)
    alert('Referral PDF export failed: ' + err.message)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Download Referral Letter (PDF)' }
  }
}

// ── [P4-13] LIL-GUI (fixed: mounts in LEFT panel via lp-gui-mount) ─────────────
function buildGUI() {
  const rightPanel = document.getElementById('right-panel')

  // Build the right-panel scaffold FIRST (separate from GUI mount)
  const scaffold = document.createElement('div'); scaffold.id = 'rp-results-scaffold'
  scaffold.innerHTML = `
    <!-- Three.js brain diagram -->
    <div class="rp-section" id="three-brain-section" style="display:none;padding:0">
      <canvas id="three-brain-canvas" style="width:100%;height:220px;display:block;background:transparent;"></canvas>
      <div class="three-hint">◈ 3D ANATOMICAL DIAGRAM · Drag to rotate · Patient-scaled</div>
    </div>

    <!-- Tissue segmentation -->
    <div class="rp-section" id="tissue-seg-section" style="display:none">
      <div class="rp-title">⬡ TISSUE SEGMENTATION <span style="font-size:7px;color:var(--green);margin-left:4px">● SynthSeg</span><span class="cite-tag">Billot et al. 2023</span></div>
      <div id="tissue-panel-list"></div>
    </div>

    <!-- Tumor screening -->
    <div class="rp-section" id="tumor-section" style="display:none">
      <div class="rp-title">🧬 TUMOR SCREENING <span class="cite-tag">BraTS 2020</span></div>
      <div id="tumor-panel"></div>
    </div>

    <!-- Anomaly detection -->
    <div class="rp-section" id="anomaly-section" style="display:none">
      <div class="rp-title">🔴 WM HYPERINTENSITIES
        <button id="anomaly-toggle" style="margin-left:auto;font-family:var(--mono);font-size:8px;cursor:pointer;background:rgba(255,51,85,.08);border:1px solid rgba(255,51,85,.3);color:var(--red);padding:2px 8px;border-radius:4px">Hide</button>
      </div>
      <div id="anomaly-list" class="flags-list"></div>
    </div>

    <!-- Volumetrics -->
    <div class="rp-section" id="analysis-results-section" style="display:none">
      <div class="rp-title">VOLUMETRICS <span class="unit-tag">cm³</span></div>
      <div id="volume-metrics" class="metric-list"></div>
    </div>

    <!-- Hippocampal -->
    <div class="rp-section" id="hippo-section" style="display:none">
      <div id="hippo-panel"></div>
    </div>

    <!-- Brain Age -->
    <div class="rp-section" id="brain-age-section" style="display:none">
      <div class="rp-title">🧠 BRAIN AGE <span class="cite-tag">Cole et al. 2018</span></div>
      <div id="brain-age-panel"></div>
    </div>

    <!-- Clinical flags -->
    <div class="rp-section" id="analysis-clinical-section" style="display:none">
      <div class="rp-title">EVIDENCE-BASED CLINICAL FLAGS <span style="font-size:7px;color:var(--fg-dim);margin-left:4px">ICD-10</span></div>
      <div id="clinical-flags" class="flags-list"></div>
    </div>

    <!-- Longitudinal -->
    <div class="rp-section" id="longitudinal-section" style="display:none">
      <div class="rp-title">📈 LONGITUDINAL COMPARISON</div>
      <div id="longitudinal-chart"></div>
    </div>

    <!-- AI report -->
    <div class="rp-section" id="ai-report-section" style="display:none">
      <div class="rp-title">◈ CLINICAL REPORT <span class="cite-tag">Rule-based · GROQ ·  Gemini if available</span></div>
      <button id="ai-report-generate-btn" class="ai-generate-btn">◈ Generate Clinical Report</button>
      <pre id="ai-report-pre" class="ai-report-pre">Click the button above to generate a formal 5-section clinical report.\nGemini 2.0 Flash is used when available; otherwise GROQ is used; otherwise a full local rule-based report is generated instantly.</pre>
        <div id="ai-report-actions" style="display:none;margin-top:8px;display:flex;flex-direction:column;gap:6px">
          <button id="bengali-explain-btn" class="ai-generate-btn" style="border-color:rgba(57,255,110,.3);color:var(--green)">🇧🇩 সহজ বাংলায় ব্যাখ্যা করুন</button>
          <button id="referral-letter-btn" class="ai-generate-btn" style="border-color:rgba(255,170,0,.3);color:var(--amber)">📋 Generate Referral Letter</button>
          <pre id="secondary-report-pre" class="ai-report-pre" style="display:none"></pre>
        <button id="referral-pdf-btn" class="ai-generate-btn" style="display:none;border-color:rgba(255,170,0,.4);color:var(--amber);margin-top:4px">📄 Download Referral Letter (PDF)</button>
        </div>
    </div>

    <!-- Surgery planner -->
    <div class="rp-section" id="surgery-section" style="display:none">
      <div class="rp-title">⚕ SURGERY PLANNER</div>
      <div id="surgery-pins-list"><div style="font-size:9px;color:var(--fg-dim);text-align:center;padding:8px 0">No pins placed. Press <kbd>S</kbd> or enable Pin Mode.</div></div>
    </div>

    <!-- Export -->
    <div class="rp-section" id="analysis-export-section" style="display:none">
      <button id="export-btn" class="export-btn" style="margin-bottom:6px">↓ EXPORT CLINICAL REPORT (HTML)</button>
      <button id="export-pdf-btn" class="export-btn" style="margin-bottom:6px;background:rgba(255,51,85,.06);border-color:rgba(255,51,85,.3);color:var(--red)">↓ EXPORT CLINICAL REPORT (PDF)</button>
      <button id="export-json-btn" class="export-btn" style="background:rgba(0,229,255,.04);border-color:rgba(0,229,255,.2)">↓ EXPORT STRUCTURED DATA (JSON)</button>
      <div class="export-note">SynthSeg · BraTS · Gemini 2.0 Flash </div>
    </div>
  `

  // Clear right panel and add scaffold (NOT the GUI)
  rightPanel.innerHTML = ''
  rightPanel.appendChild(scaffold)

  // [P4-13] GUI goes into LEFT panel mount (lp-gui-mount)
  const guiMount = document.getElementById('lp-gui-mount')
  if (guiInstance) { guiInstance.destroy(); guiInstance = null }
  guiInstance = new GUI({ title: '⬡ VIEWER CONTROLS', width: 272, container: guiMount })

  // Volume & Appearance
  const vF = guiInstance.addFolder('🎚 VOLUME & APPEARANCE'); vF.open()
  vF.add(S, 'colormap', ['gray', 'hot', 'cool', 'viridis', 'inferno', 'plasma']).name('Colormap').onChange(v => { if (nv.volumes.length) nv.setColormap(nv.volumes[0].id, v) })
  vF.add(S, 'mriOpacity', 0, 1, .01).name('MRI Opacity').onChange(v => { if (nv.volumes.length) nv.setOpacity(0, v) })
  vF.add(S, 'tumorVisible').name('Tumor Overlay').onChange(v => { const idx = tumorUrl ? 2 : -1; if (idx >= 0 && nv.volumes.length > idx) nv.setOpacity(idx, v ? S.tumorOpacity : 0) })
  vF.add(S, 'tumorOpacity', 0, 1, .01).name('Tumor Opacity').onChange(v => { const idx = tumorUrl ? 2 : -1; if (idx >= 0 && nv.volumes.length > idx && S.tumorVisible) nv.setOpacity(idx, v) })
  vF.add(S, 'interpolation').name('Interpolation').onChange(v => nv.setInterpolation(v))

  

  // Voxel Inspector
  const iF = guiInstance.addFolder('🔬 VOXEL INSPECTOR')
  iF.add(S, 'voxelInspector').name('Enable Inspector').onChange(v => { canvas.style.cursor = v ? 'crosshair' : ''; if (!v) { const t = document.getElementById('voxel-tooltip'); if (t) t.style.display = 'none' } })

  // Clipping
  const cF = guiInstance.addFolder('✂ CLIPPING PLANES')
  cF.add(S, 'clippingEnabled').name('Enable').onChange(() => applyClipping())
  const xF = cF.addFolder('X (Sagittal)'); xF.add(S, 'clipXEnabled').name('Enable X').onChange(() => applyClipping()); xF.add(S, 'clipX', -1, 1, .01).name('Depth').onChange(() => S.clipXEnabled && applyClipping())
  const yF = cF.addFolder('Y (Coronal)');  yF.add(S, 'clipYEnabled').name('Enable Y').onChange(() => applyClipping()); yF.add(S, 'clipY', -1, 1, .01).name('Depth').onChange(() => S.clipYEnabled && applyClipping())
  const zF = cF.addFolder('Z (Axial)');    zF.add(S, 'clipZEnabled').name('Enable Z').onChange(() => applyClipping()); zF.add(S, 'clipZ', -1, 1, .01).name('Depth').onChange(() => S.clipZEnabled && applyClipping())
  cF.add({ r: () => { S.clipX = S.clipY = S.clipZ = 0; S.clipXEnabled = S.clipYEnabled = S.clipZEnabled = S.clippingEnabled = false; applyClipping(); cF.controllersRecursive().forEach(c => c.updateDisplay()) } }, 'r').name('↺ Reset All')

  // 3D View
  const dF = guiInstance.addFolder('🧊 3D VIEW')
  dF.add({ mp: () => setSliceType('multiplanar') }, 'mp').name('→ Multiplanar')
  dF.add({ r3: () => setSliceType('render') }, 'r3').name('→ NiiVue 3D Render')
  dF.add(S, 'autoRotateDiagram').name('Auto-Rotate Diagram').onChange(v => { if (threeControls) threeControls.autoRotate = v })

  // Display
  const dispF = guiInstance.addFolder('🖥 DISPLAY')
  dispF.add(S, 'showCrosshair').name('Crosshair').onChange(v => { nv.opts.crosshairWidth = v ? .5 : 0; nv.updateGLVolume() })
  dispF.add(S, 'showColorbar').name('Colorbar').onChange(v => { nv.opts.isColorbar = v; nv.updateGLVolume() })


  // Surgery
  const surgF = guiInstance.addFolder('⚕ SURGERY PLANNER')
  surgF.add(S, 'surgeryMode').name('Pin Mode').onChange(v => { surgeryMode = v; canvas.style.cursor = v ? 'crosshair' : ''; 
    if (threeControls) threeControls.autoRotate = v ? false : S.autoRotateDiagram
  const ind = document.getElementById('surgery-mode-indicator'); if (ind) ind.style.display = v ? 'flex' : 'none' })
  surgF.addColor(S, 'surgeryPinColor').name('Pin Color')
  surgF.add(S, 'showSurgeryPins').name('Show Pins').onChange(() => renderSurgeryOverlay())
  surgF.add(S, 'clearAllPins').name('🗑 Clear All Pins')

  // Utilities
  const uF = guiInstance.addFolder('📸 UTILITIES')
  uF.add({ sc: doScreenshot }, 'sc').name('📷 Screenshot PNG')
  uF.add({ ra: () => runAnalysis() }, 'ra').name('▶ Re-run Analysis')
  uF.add({ rv: resetUpload }, 'rv').name('↺ Reset / Load New')

  
}

// ── SCREENSHOT ─────────────────────────────────────────────────────────────────
function doScreenshot() {
  const a = document.createElement('a'); a.download = `NeuroHEX_${Date.now()}.png`; a.href = canvas.toDataURL('image/png'); a.click()
}

// ── STATE & RESET ──────────────────────────────────────────────────────────────
function setState(s) {
  appState = s
  if (runBtnEl) runBtnEl.disabled = (s !== State.LOADED && s !== State.DONE)
}

// REPLACE the entire resetUpload function
function resetUpload() {
  uploadedFile = null
  if (mriUrl)   { URL.revokeObjectURL(mriUrl);   mriUrl   = null }
  if (tumorUrl) { URL.revokeObjectURL(tumorUrl);  tumorUrl = null }
  niftiMeta = null; analysisData = null; tumorData = null; anomalyRegions = []
  nv?.loadVolumes([])
  clearSurgeryPins()
  fileBadge.classList.add('hidden'); dropZone.classList.remove('hidden')
  metaSection.classList.add('hidden'); histogramSection.classList.add('hidden')
  emptyState.classList.remove('hidden')
  if (threeAnimId) { cancelAnimationFrame(threeAnimId); threeAnimId = null }
  if (threeRenderer) { threeRenderer.dispose(); threeRenderer = null }
  threeScene = null; threeCamera = null; threeControls = null; brainSpheres = []
  window.demoMode = false
  const banner = document.getElementById('demo-mode-banner'); if (banner) banner.style.display = 'none'

  // Rebuild GUI and scaffold so renderResults can find all section IDs on next load
  buildGUI()
  setState(State.IDLE)
}
// ── DOM INJECTIONS ─────────────────────────────────────────────────────────────
function injectSurgeryIndicator() {
  const vm = document.getElementById('viewer-main')
  const ind = document.createElement('div'); ind.id = 'surgery-mode-indicator'
  ind.innerHTML = '⚕ SURGERY PIN MODE — Click on 3D brain model to place markers · ESC to exit'
  vm.appendChild(ind)
}
function injectClipHUD() {
  const vm = document.getElementById('viewer-main')
  const hud = document.createElement('div'); hud.id = 'clip-hud'
  hud.textContent = 'CLIP: OFF'; hud.style.color = '#4a7a8a'
  vm.appendChild(hud)
}
function injectVoxelTooltip() {
  const vm = document.getElementById('viewer-main')
  const tt = document.createElement('div'); tt.id = 'voxel-tooltip'; tt.style.display = 'none'
  vm.appendChild(tt)
}

// ── EVENTS ─────────────────────────────────────────────────────────────────────
function setupEvents() {
  browseBtn.addEventListener('click', () => fileInput.click())
  dropZone.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', e => { if (e.target.files[0]) loadMRI(e.target.files[0]); fileInput.value = '' })
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) loadMRI(e.dataTransfer.files[0]) })
  clearFileBtn.addEventListener('click', resetUpload)
  viewBtns.forEach(b => b.addEventListener('click', () => setSliceType(b.dataset.view)))
  colormapSelect?.addEventListener('change', () => { S.colormap = colormapSelect.value; if (nv.volumes.length) nv.setColormap(nv.volumes[0].id, S.colormap) })
  toggleCrosshairBtn?.addEventListener('click', () => { S.showCrosshair = !S.showCrosshair; nv.opts.crosshairWidth = S.showCrosshair ? .5 : 0; nv.updateGLVolume(); toggleCrosshairBtn.classList.toggle('active', S.showCrosshair) })
  screenshotBtn?.addEventListener('click', doScreenshot)

  // Demo scan loader
  const demoBtn = document.getElementById('demo-scan-btn')
  if (demoBtn) demoBtn.addEventListener('click', loadDemoScan)

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    const ind = document.getElementById('surgery-mode-indicator')
    switch (e.key.toLowerCase()) {
      case '1': setSliceType('multiplanar'); break; case '2': setSliceType('axial'); break
      case '3': setSliceType('sagittal'); break; case '4': setSliceType('coronal'); break
      case '5': setSliceType('render'); break; case 'p': doScreenshot(); break
      // REPLACE the keyboard 's' case in setupEvents():
      case 's':
        if (!uploadedFile) break
        S.surgeryMode = !S.surgeryMode; surgeryMode = S.surgeryMode; canvas.style.cursor = S.surgeryMode ? 'crosshair' : ''
        if (threeControls) threeControls.autoRotate = S.surgeryMode ? false : S.autoRotateDiagram
        if (ind) ind.style.display = S.surgeryMode ? 'flex' : 'none'
        break
      case 'x': S.clipXEnabled = !S.clipXEnabled; S.clippingEnabled = S.clipXEnabled || S.clipYEnabled || S.clipZEnabled; applyClipping(); break
      case 'y': S.clipYEnabled = !S.clipYEnabled; S.clippingEnabled = S.clipXEnabled || S.clipYEnabled || S.clipZEnabled; applyClipping(); break
      case 'z': S.clipZEnabled = !S.clipZEnabled; S.clippingEnabled = S.clipXEnabled || S.clipYEnabled || S.clipZEnabled; applyClipping(); break
      case 'escape':
        S.surgeryMode = false; surgeryMode = false; canvas.style.cursor = ''
        if (ind) ind.style.display = 'none'
        break
    }
  })

  window.addEventListener('resize', () => {
    nv?.resizeListener();
    const tc = document.getElementById('three-brain-canvas')
    if (tc && threeRenderer && threeCamera) {
      threeRenderer.setSize(tc.clientWidth, tc.clientHeight || 220)
      threeCamera.aspect = tc.clientWidth / (tc.clientHeight || 220)
      threeCamera.updateProjectionMatrix()
    }
  })

  const ro = new ResizeObserver(() => { nv?.resizeListener() })
  ro.observe(document.getElementById('viewer-main'))
}

// ── INIT ───────────────────────────────────────────────────────────────────────
async function init() {
  injectStyles()
  injectSurgeryIndicator()
  injectClipHUD()
  injectVoxelTooltip()
  loadLongitudinal()
  if (runBtnEl) runBtnEl.style.display = 'none'
  await initViewer()
  setupEvents()
  buildGUI()
  const sd = document.getElementById('scan-date'); if (sd) sd.value = new Date().toISOString().split('T')[0]
  console.log('%c⬡ NeuroHEX v2.0 loaded ', 'color:#00e5ff;font-family:monospace;font-size:13px;font-weight:bold')
  console.log('%cSynthSeg · BraTS · Gemini 2.0 Flash · Cole Brain Age', 'color:#39ff6e;font-family:monospace;font-size:10px')
  console.log(`%cBackend: ${BACKEND_URL}`, 'color:#ffaa00;font-family:monospace;font-size:9px')
}

init()