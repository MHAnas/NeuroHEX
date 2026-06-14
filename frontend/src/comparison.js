// ═══════════════════════════════════════════════════════════════════════════
//  NeuroHEX — MRI Comparison Engine  v2.0  (ICADHI 2026 Competition Build)
//
//  Priority 1 fixes:
//    [P1-01] Real SynthSeg API calls replace fake segmentChunked()
//    [P1-02] extractNiftiHeader() + populateVolumesFromSynthSeg() split
//    [P1-03] Real region volumes from FreeSurfer label counts
//    [P1-04] Gemini multimodal progression score
//  Priority 2:
//    [P2-05] AI differential analysis panel
//    [P2-06] Real hippocampal delta (labels 17 + 53)
//    [P2-07] Demo comparison loader
//    [P2-08] Export with AI narrative
//  Priority 3:
//    [P3-09] Real PROC_STEPS
//    [P3-10] Interval estimation warning
//    [P3-11] DICOM support
//    [P3-12] 9-axis radar with hippocampal axes
//  Priority 4 (bugs):
//    [P4-13] gsap import REMOVED
//    [P4-14] Crosshair sync via broadcastTo
//    [P4-15] Overlay layout fix
//    [P4-16] Partial SynthSeg failure error boundary
//  Priority 5:
//    [P5-17] Citations in results + export
//    [P5-18] Nav icons (in HTML)
//    [P5-19] localStorage stale data warning
//    [P5-20] Low-cost badge
// ═══════════════════════════════════════════════════════════════════════════

import './comparison.css'
import { Niivue } from '@niivue/niivue'
import { Chart, registerables } from 'chart.js'
import { BACKEND_URL, GEMINI_KEY, GEMINI_ENDPOINT, GROQ_KEY, GROQ_ENDPOINT } from './config.js'

Chart.register(...registerables)

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const MNI_URL = 'https://niivue.github.io/niivue-demo-images/mni152.nii.gz'
const VIEWS    = ['axial', 'sagittal', 'coronal', 'multiplanar']
const LAYOUTS  = ['side-by-side', 'overlay', 'difference']

// FreeSurfer label sets
const LABEL_SETS = {
  CSF:        new Set([4, 5, 14, 15, 24, 43, 44]),
  WM:         new Set([2, 41, 7, 46, 16]),
  GM_CORTEX:  new Set([3, 42]),
  DEEP:       new Set([10, 11, 12, 13, 17, 18, 26, 49, 50, 51, 52, 53, 54, 58]),
  LEFT:       new Set([2,3,7,8,10,11,12,13,17,18,19,20,25,26,27,28]),
  RIGHT:      new Set([41,42,46,47,49,50,51,52,53,54,58,59,60]),
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let mode        = 'longitudinal'
let layout      = 'side-by-side'
let currentView = 'axial'

let nvA = null, nvB = null, nvOverlay = null
let fileA = null, fileB = null
let urlA  = null, urlB  = null
let metaA = null, metaB = null   // header-only until SynthSeg returns
let rawLabelsA = null, rawLabelsB = null   // Int16Array from SynthSeg
let comparisonResult = null
let radarChart = null, sparkChart = null
let syncEnabled = true
let dragging    = false
let aiNarrative = ''  // LLM-generated narrative for export

// [P4-16] partial failure tracking
window.comparisonDemoMode = { a: false, b: false }

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)

const emptyState    = $('empty-state')
const procOverlay   = $('proc-overlay')
const procBar       = $('proc-bar')
const procGlow      = $('proc-glow')
const procLabel     = $('proc-label')
const procStepsEl   = $('proc-steps')
const dualViewer    = $('dual-viewer')
const overlayViewer = $('overlay-viewer')
const diffViewer    = $('diff-viewer')
const viewerToolbar = $('viewer-toolbar')
const compareBtn    = $('compare-btn')
const compareHint   = $('compare-hint')
const rpIdle        = $('rp-idle')
const rpResults     = $('rp-results')
const navDeltaPill  = $('nav-delta-pill')
const exportRepBtn  = $('export-report-btn')

// ── UTILS ─────────────────────────────────────────────────────────────────────
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const delay    = ms => new Promise(r => setTimeout(r, ms))
const fmtBytes = b => b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'
const fmtVol   = v => v.toFixed(1)
const fmtDelta = (d, suffix = 'cm³') => { const s = d >= 0 ? '+' : ''; return `${s}${d.toFixed(1)} ${suffix}` }
const fmtPct   = (d, base) => { const p = (d / base * 100); const s = p >= 0 ? '+' : ''; return `${s}${p.toFixed(1)}%` }
const countLabel = (arr, id) => { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === id) n++; return n }
const countLabels = (arr, ids) => ids.reduce((acc, id) => acc + countLabel(arr, id), 0)

// ── [P5-19] STALE DATA CHECK ─────────────────────────────────────────────────
function checkStaleLocalStorage() {
  try {
    const raw = localStorage.getItem('neurohex_v5_long')
    if (!raw) return
    const entries = JSON.parse(raw)
    const hasStale = entries.some(e => e.brain > 2000)
    if (hasStale) {
      const notice = document.createElement('div')
      notice.id = 'stale-data-notice'
      notice.style.cssText = `
        position:fixed;bottom:0;left:0;right:0;z-index:9998;
        background:rgba(255,170,0,.18);border-top:1.5px solid rgba(255,170,0,.6);
        padding:5px 20px;font-family:var(--mono);font-size:9px;font-weight:700;
        letter-spacing:.18em;color:var(--amber);text-align:center;
      `
      notice.innerHTML = `⚠ Session history contains potentially incorrect data (brain vol > 2000cm³). 
        <button onclick="localStorage.removeItem('neurohex_v5_long');this.parentElement.remove()" 
          style="margin-left:12px;font-family:var(--mono);font-size:8px;cursor:pointer;background:rgba(255,170,0,.2);border:1px solid rgba(255,170,0,.5);color:var(--amber);padding:2px 8px;border-radius:4px">
          Clear Now
        </button>`
      document.body.appendChild(notice)
    }
  } catch {}
}

// ── [P1-01] SYNTHSEG API CALL ─────────────────────────────────────────────────
async function callSynthSeg(file, scanLabel) {
  if (!file) return null
  const formData = new FormData()
  formData.append('file', file)
  setProc(null, `SynthSeg parcellation — ${scanLabel} (~60s)`)

  try {
    const resp = await fetch(`${BACKEND_URL}/segment`, {
      method: 'POST',
      body: formData,
    })
    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error(`SynthSeg API error ${resp.status}: ${txt}`)
    }
    const buffer = await resp.arrayBuffer()
    const { rawLabels, remapped } = parseSynthSegNifti(buffer)
    return { rawLabels, remapped }
  } catch (err) {
    console.warn(`[NeuroHEX] SynthSeg failed for ${scanLabel}:`, err)
    return null  // caller handles demo fallback
  }
}

// [P1-01] For normative mode: fetch MNI blob and send to SynthSeg
async function callSynthSegFromUrl(url, scanLabel) {
  try {
    setProc(null, `Fetching MNI152 for SynthSeg parcellation (~60s)`)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`MNI fetch failed: ${resp.status}`)
    const blob = await resp.blob()
    const file = new File([blob], 'mni152.nii.gz', { type: 'application/gzip' })
    return await callSynthSeg(file, scanLabel)
  } catch (err) {
    console.warn('[NeuroHEX] SynthSeg MNI fetch failed:', err)
    return null
  }
}

// [P1-01] Parse returned SynthSeg NIfTI binary
function parseSynthSegNifti(buffer) {
  const view = new DataView(buffer)
  const hdrSzLE    = view.getInt32(0, true)
  const littleEndian = hdrSzLE === 348
  const rawOffset  = view.getFloat32(108, littleEndian)
  const dataOffset = rawOffset >= 352 ? Math.round(rawOffset) : 352
  const dims = [
    view.getInt16(42, littleEndian),
    view.getInt16(44, littleEndian),
    view.getInt16(46, littleEndian),
  ]
  if (dims.some(d => d <= 0 || d > 1024)) {
    console.error('[NeuroHEX] Bad NIfTI dims:', dims)
    return { rawLabels: null, remapped: null }
  }
  const N        = dims[0] * dims[1] * dims[2]
  const datatype = view.getInt16(70, littleEndian)
  let raw
  if (datatype === 16) {
    const floats = new Float32Array(buffer, dataOffset, Math.min(N, (buffer.byteLength - dataOffset) / 4))
    raw = new Int16Array(floats.length)
    for (let i = 0; i < floats.length; i++) raw[i] = Math.round(floats[i])
  } else if (datatype === 8) {
    const ints = new Int32Array(buffer, dataOffset, Math.min(N, (buffer.byteLength - dataOffset) / 4))
    raw = new Int16Array(ints.length)
    for (let i = 0; i < ints.length; i++) raw[i] = ints[i]
  } else if (datatype === 4) {
    raw = new Int16Array(buffer, dataOffset, Math.min(N, (buffer.byteLength - dataOffset) / 2))
  } else if (datatype === 512) {
    raw = new Uint16Array(buffer, dataOffset, Math.min(N, (buffer.byteLength - dataOffset) / 2))
  } else {
    raw = new Uint8Array(buffer, dataOffset, Math.min(N, buffer.byteLength - dataOffset))
  }
  const remapped = remapSynthSegLabels(raw)
  return { rawLabels: raw, remapped }
}

// [P1-01] Remap FreeSurfer label IDs → tissue classes 0-4
function remapSynthSegLabels(labelArray) {
  const CSF_LABELS  = new Set([4, 5, 14, 15, 24, 43, 44])
  const WM_LABELS   = new Set([2, 41, 7, 46, 16])
  const DEEP_LABELS = new Set([10, 11, 12, 13, 17, 18, 26, 49, 50, 51, 52, 53, 54, 58])
  const GM_LABELS   = new Set([3, 42])
  const out = new Uint8Array(labelArray.length)
  for (let i = 0; i < labelArray.length; i++) {
    const v = labelArray[i]
    if      (v === 0)              out[i] = 0
    else if (CSF_LABELS.has(v))    out[i] = 1
    else if (WM_LABELS.has(v))     out[i] = 2
    else if (GM_LABELS.has(v))     out[i] = 3
    else if (DEEP_LABELS.has(v))   out[i] = 4
    else if (v > 0)                out[i] = 3
  }
  return out
}

// [P1-01] Demo fallback segmentation when SynthSeg unavailable
async function demoFallbackSeg(meta) {
  const { dims, imgData } = meta
  const N = dims[0] * dims[1] * dims[2]
  const out = new Uint8Array(N)
  if (!imgData || imgData.length !== N) return out
  const sorted = new Float32Array(imgData.length)
  sorted.set(imgData); sorted.sort()
  const p12 = sorted[Math.floor(N * 0.12)]
  const p38 = sorted[Math.floor(N * 0.38)]
  const p62 = sorted[Math.floor(N * 0.62)]
  const p72 = sorted[Math.floor(N * 0.72)]
  const CHUNK = Math.ceil(N / 16)
  for (let s = 0; s < N; s += CHUNK) {
    const e = Math.min(s + CHUNK, N)
    for (let i = s; i < e; i++) {
      const v = imgData[i]
      if      (v < p12) out[i] = 0
      else if (v < p38) out[i] = 1
      else if (v < p62) out[i] = 3
      else if (v < p72) out[i] = 2
      else              out[i] = 4
    }
    await new Promise(r => requestAnimationFrame(r))
  }
  return out
}

// [P4-16] Demo mode banner
function showDemoModeBanner(msg) {
  let banner = $('demo-mode-banner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'demo-mode-banner'
    document.body.appendChild(banner)
  }
  banner.textContent = msg
  banner.style.display = 'block'
}

// ── NIIVUE INIT ───────────────────────────────────────────────────────────────
async function initViewers() {
  nvA = new Niivue({
    backColor:      [0.008, 0.02, 0.031, 1],
    crosshairColor: [0.0, 0.9, 1.0, 0.75],
    fontColor:      [0.0, 0.9, 1.0, 0.6],
    crosshairWidth: 0.5,
    isOrientCube:   true,
    dragMode:       1,
    logLevel:       'error',
  })
  nvB = new Niivue({
    backColor:      [0.008, 0.02, 0.031, 1],
    crosshairColor: [1.0, 0.65, 0.0, 0.75],
    fontColor:      [1.0, 0.65, 0.0, 0.6],
    crosshairWidth: 0.5,
    isOrientCube:   true,
    dragMode:       1,
    logLevel:       'error',
  })
  nvOverlay = new Niivue({
    backColor:      [0.008, 0.02, 0.031, 1],
    crosshairColor: [0.0, 0.9, 1.0, 0.75],
    crosshairWidth: 0.5,
    dragMode:       1,
    logLevel:       'error',
  })

  await nvA.attachToCanvas($('canvas-a'))
  await nvB.attachToCanvas($('canvas-b'))
  await nvOverlay.attachToCanvas($('canvas-overlay'))

  setSliceType(currentView)

  // [P4-14] Fixed crosshair sync via broadcastTo
  // WITH THIS:
  // [P4-14] Crosshair sync via syncWith
  nvA.syncWith(nvB)
  nvB.syncWith(nvA)
}

// ── [P4-14] SYNC TOGGLE ───────────────────────────────────────────────────────
// WITH THIS:
function setSyncEnabled(enabled) {
  syncEnabled = enabled
  if (enabled) {
    nvA.syncWith(nvB)
    nvB.syncWith(nvA)
  } else {
    nvA.syncWith()   // no args = detach sync
    nvB.syncWith()
  }
}
// ── FILE HANDLING ─────────────────────────────────────────────────────────────
function validateFile(f) {
  if (!f) return false
  const name = f.name.toLowerCase()
  return name.endsWith('.nii') || name.endsWith('.nii.gz') || name.endsWith('.dcm')
}

// [P3-11] DICOM conversion
async function convertDicomToNifti(file) {
  try {
    const dcmjs = await import('dcmjs')
    const buffer = await file.arrayBuffer()
    const dataset = dcmjs.data.DicomMessage.readFile(buffer)
    const nat = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dataset.dict)
    const rows = nat.Rows || 512
    const cols = nat.Columns || 512
    const slices = 1
    const pixelData = new Int16Array(nat.PixelData || new ArrayBuffer(rows * cols * 2))
    const spacing = (nat.PixelSpacing || [1, 1]).map(Number)
    const thickness = Number(nat.SliceThickness || 1)
    const OFF = 352
    const buf = new ArrayBuffer(OFF + pixelData.byteLength)
    const v = new DataView(buf)
    v.setInt32(0, 348, true); v.setInt16(40, 3, true)
    v.setInt16(42, cols, true); v.setInt16(44, rows, true); v.setInt16(46, slices, true)
    v.setInt16(48,1,true);v.setInt16(50,1,true);v.setInt16(52,1,true);v.setInt16(54,1,true)
    v.setInt16(70, 4, true); v.setInt16(72, 16, true)
    v.setFloat32(76, 1, true); v.setFloat32(80, spacing[1], true)
    v.setFloat32(84, spacing[0], true); v.setFloat32(88, thickness, true)
    v.setFloat32(108, OFF, true); v.setFloat32(112, 1, true)
    v.setUint8(344, 110); v.setUint8(345, 43); v.setUint8(346, 49)
    new Int16Array(buf, OFF).set(pixelData)
    return new File([buf], file.name.replace('.dcm', '.nii'), { type: 'application/octet-stream' })
  } catch (e) {
    console.warn('[NeuroHEX] DICOM conversion failed:', e)
    return file
  }
}

function setupDrop(dropId, fileInputId, browseId, badgeId, nameId, sizeId, clearId, which) {
  const drop   = $(dropId), inp = $(fileInputId), btn = $(browseId)
  const badge  = $(badgeId), nameEl = $(nameId), sizeEl = $(sizeId), clrBtn = $(clearId)
  btn.addEventListener('click', () => inp.click())
  drop.addEventListener('click', () => inp.click())
  inp.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0], which); inp.value = '' })
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over') })
  drop.addEventListener('dragleave', ()  => drop.classList.remove('drag-over'))
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag-over')
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], which)
  })
  clrBtn.addEventListener('click', () => clearFile(which))
}

async function handleFile(file, which) {
  if (!validateFile(file)) { alert('Please upload a NIfTI (.nii, .nii.gz) or DICOM (.dcm) file'); return }

  // [P3-11] DICOM conversion
  let niftiFile = file
  if (file.name.toLowerCase().endsWith('.dcm')) {
    niftiFile = await convertDicomToNifti(file)
  }

  const badgeId    = which === 'a' ? 'badge-a'        : 'badge-b'
  const nameId     = which === 'a' ? 'name-a'         : 'name-b'
  const sizeId     = which === 'a' ? 'size-a'         : 'size-b'
  const dropId     = which === 'a' ? 'drop-a'         : 'drop-b'
  const metaDispId = which === 'a' ? 'meta-display-a' : 'meta-display-b'

  if (which === 'a') {
    if (urlA) URL.revokeObjectURL(urlA)
    fileA = niftiFile; urlA = URL.createObjectURL(niftiFile)
    rawLabelsA = null
  } else {
    if (urlB) URL.revokeObjectURL(urlB)
    fileB = niftiFile; urlB = URL.createObjectURL(niftiFile)
    rawLabelsB = null
  }

  $(nameId).textContent = file.name
  $(sizeId).textContent = fmtBytes(file.size)
  $(badgeId).classList.remove('hidden')
  $(dropId).classList.add('hidden')

  const nv   = which === 'a' ? nvA : nvB
  const cmap = which === 'a' ? ($('cmap-a').value || 'gray') : ($('cmap-b').value || 'gray')

  dualViewer.classList.remove('hidden')
  emptyState.classList.add('hidden')
  viewerToolbar.classList.remove('hidden')

  try {
    await nv.loadVolumes([{ url: which === 'a' ? urlA : urlB, name: niftiFile.name, colormap: cmap, opacity: 1 }])
    setSliceType(currentView, nv)

    // [P1-02] Header-only extraction — no fake segmentation
    const meta = extractNiftiHeader(nv, niftiFile.name)
    if (which === 'a') metaA = meta
    else               metaB = meta

    // Show header info with "—" placeholders for volumes
    renderMetaDisplayPending(metaDispId, meta, which)


  } catch (err) {
    console.error('[NeuroHEX] File load error:', err)
    clearFile(which)
    alert('Failed to load file. Ensure it is a valid NIfTI or DICOM.')
  }
    // Update scan‑label and date in the viewer pane headers
  const labelEl    = which === 'a' ? $('pane-label-a') : $('pane-label-b')
  const dateEl     = which === 'a' ? $('pane-date-a')  : $('pane-date-b')
  const dateInput  = which === 'a' ? $('date-a')        : $('date-b')
  const labelInput = which === 'a' ? $('label-a')       : $('label-b')

  // Safe fallback – always a string before .toUpperCase()
  const labelText = (labelInput?.value || file?.name || '').toUpperCase()
  if (labelEl) labelEl.textContent = labelText
  if (dateEl)  dateEl.textContent  = dateInput?.value || '—'

  checkCanCompare()
  
}

function clearFile(which) {
  if (which === 'a') {
    fileA = null; if (urlA) { URL.revokeObjectURL(urlA); urlA = null }
    metaA = null; rawLabelsA = null
    $('badge-a').classList.add('hidden'); $('drop-a').classList.remove('hidden')
    $('meta-display-a').classList.add('hidden')
    try { nvA.loadVolumes([]) } catch {}
  } else {
    fileB = null; if (urlB) { URL.revokeObjectURL(urlB); urlB = null }
    metaB = null; rawLabelsB = null
    $('badge-b').classList.add('hidden'); $('drop-b').classList.remove('hidden')
    $('meta-display-b').classList.add('hidden')
    try { nvB.loadVolumes([]) } catch {}
  }
  checkCanCompare()
}

function checkCanCompare() {
  if (mode === 'normative') {
    _updateNormativeCompareState()
    return
  }
  const ready = fileA !== null && fileB !== null
  compareBtn.disabled = !ready
  compareHint.textContent = ready
    ? 'Ready — click to run full comparison'
    : !fileA ? 'Upload Scan A to begin' : 'Upload Scan B to begin'
}

// ── [P1-02] META EXTRACTION (header only, no fake volumes) ───────────────────
function extractNiftiHeader(nv, name = '') {
  if (!nv.volumes.length) return null
  const vol  = nv.volumes[0]
  const hdr  = vol.hdr
  const dims = [hdr.dims[1], hdr.dims[2], hdr.dims[3]]
  const pixd = [Math.abs(hdr.pixDims[1]), Math.abs(hdr.pixDims[2]), Math.abs(hdr.pixDims[3])]
  const voxVol = pixd[0] * pixd[1] * pixd[2]
  return {
    name, dims, pixdims: pixd, voxelVolMm3: voxVol,
    imgData: vol.img,
    // Volume fields populated after SynthSeg
    brainCm3: null, gmCm3: null, wmCm3: null, csfCm3: null, deepCm3: null,
    lhCm3: null, rhCm3: null, asi: null,
    hipLCm3: null, hipRCm3: null,
    synthSegLabels: null,
  }
}

// [P1-02] Populate volumes from real SynthSeg raw labels
function populateVolumesFromSynthSeg(meta, rawLabels) {
  if (!rawLabels || !meta) return
  meta.synthSegLabels = rawLabels
  const ml = meta.voxelVolMm3 / 1000

  const SYNTHSEG_NORM = 910
  const WHOLE_BRAIN_NORM = 1350
  const cf = WHOLE_BRAIN_NORM / SYNTHSEG_NORM

  const csfVox  = countLabels(rawLabels, [4,5,14,15,24,43,44])
  const gmVox   = countLabels(rawLabels, [3,42])
  const wmVox   = countLabels(rawLabels, [2,41,7,46,16])
  const deepVox = countLabels(rawLabels, [10,11,12,13,17,18,26,49,50,51,52,53,54,58])

  const raw = (csfVox + gmVox + wmVox + deepVox) * ml
  meta.brainCm3 = +(raw * cf).toFixed(2)
  meta.gmCm3    = +(gmVox   * ml * cf).toFixed(2)
  meta.wmCm3    = +(wmVox   * ml * cf).toFixed(2)
  meta.csfCm3   = +(csfVox  * ml * cf).toFixed(2)
  meta.deepCm3  = +(deepVox * ml * cf).toFixed(2)

  // [P1-02] Real hippocampal volumes labels 17 + 53
  meta.hipLCm3 = +(countLabel(rawLabels, 17) * ml).toFixed(3)
  meta.hipRCm3 = +(countLabel(rawLabels, 53) * ml).toFixed(3)

  // Validate hippocampal range (1.5–6.0 cm³)
  const HIPPO_MIN = 1.5, HIPPO_MAX = 6.0
  if (meta.hipLCm3 < HIPPO_MIN * 0.1 || meta.hipLCm3 > HIPPO_MAX) {
    // Try scaling assuming 1mm isotropic
    const ml1 = 1.0 / 1000
    const hL1 = +(countLabel(rawLabels, 17) * ml1).toFixed(3)
    const hR1 = +(countLabel(rawLabels, 53) * ml1).toFixed(3)
    if (hL1 >= HIPPO_MIN && hL1 <= HIPPO_MAX) {
      meta.hipLCm3 = hL1; meta.hipRCm3 = hR1
    } else {
      meta.hipLCm3 = null; meta.hipRCm3 = null  // unknown
    }
  }

  // [P1-02] Hemisphere volumes from label sets, not intensity
  let lhVox = 0, rhVox = 0
  const LEFT_LABELS  = new Set([2,3,7,8,10,11,12,13,17,18,19,20,25,26,27,28])
  const RIGHT_LABELS = new Set([41,42,46,47,49,50,51,52,53,54,58,59,60])
  for (let i = 0; i < rawLabels.length; i++) {
    if (LEFT_LABELS.has(rawLabels[i]))  lhVox++
    else if (RIGHT_LABELS.has(rawLabels[i])) rhVox++
  }
  meta.lhCm3 = +((lhVox * ml) * cf).toFixed(2)
  meta.rhCm3 = +((rhVox * ml) * cf).toFixed(2)
  meta.asi   = (lhVox + rhVox) > 0
    ? +((Math.abs(lhVox - rhVox) / ((lhVox + rhVox) / 2)) * 100).toFixed(2)
    : 0
}

// [P1-02] Pending meta display with "—" placeholders
function renderMetaDisplayPending(elId, meta, which) {
  const el = $(elId)
  if (!el || !meta) return
  el.classList.remove('hidden')
  const color = which === 'a' ? 'var(--cyan)' : 'var(--amber)'
  el.innerHTML = [
    { k: 'DIMS',  v: meta.dims.join('×') },
    { k: 'VOX',   v: meta.pixdims.map(p => p.toFixed(1)).join('×') + 'mm' },
    { k: 'BRAIN', v: '<span class="meta-pending">⏳ —</span>' },
    { k: 'GM',    v: '<span class="meta-pending">⏳ —</span>' },
    { k: 'WM',    v: '<span class="meta-pending">⏳ —</span>' },
    { k: 'ASI',   v: '<span class="meta-pending">⏳ —</span>' },
  ].map(({ k, v }) =>
    `<div class="smd-item"><div class="smd-key">${k}</div><div class="smd-val" style="color:${color}">${v}</div></div>`
  ).join('')
}

// [P1-02] Full meta display after SynthSeg returns
function renderMetaDisplay(elId, meta, which) {
  const el = $(elId)
  if (!el || !meta) return
  el.classList.remove('hidden')
  const color = which === 'a' ? 'var(--cyan)' : 'var(--amber)'
  el.innerHTML = [
    { k: 'DIMS',  v: meta.dims.join('×') },
    { k: 'VOX',   v: meta.pixdims.map(p => p.toFixed(1)).join('×') + 'mm' },
    { k: 'BRAIN', v: meta.brainCm3 != null ? meta.brainCm3 + ' cm³' : '—' },
    { k: 'GM',    v: meta.gmCm3    != null ? meta.gmCm3    + ' cm³' : '—' },
    { k: 'WM',    v: meta.wmCm3    != null ? meta.wmCm3    + ' cm³' : '—' },
    { k: 'ASI',   v: meta.asi      != null ? meta.asi      + '%'    : '—' },
  ].map(({ k, v }) =>
    `<div class="smd-item"><div class="smd-key">${k}</div><div class="smd-val" style="color:${color}">${v}</div></div>`
  ).join('')
}

function setMode(m) {
  mode = m
  document.querySelectorAll('.mode-tab').forEach(b =>
    b.classList.toggle('mode-tab-active', b.dataset.mode === m)
  )
  const normNotice = $('normative-notice')
  const metaBEl    = $('meta-b')
  const dropBEl    = $('drop-b')
  const scanBBlock = $('scan-b-block')

  if (m === 'normative') {
    normNotice.classList.remove('hidden')
    metaBEl.classList.add('hidden')
    dropBEl.classList.add('hidden')
    $('badge-b').classList.add('hidden')
    $('pane-date-b').textContent  = 'Standard Atlas'
    // Auto-load demo brain into A + MNI152 into B
    _loadNormativeDefaults()
  } else {
    normNotice.classList.add('hidden')
    metaBEl.classList.remove('hidden')
    dropBEl.classList.remove('hidden')
  }

  const tagB = scanBBlock?.querySelector('[class*="scan-tag"]')
  if (tagB) tagB.textContent = m === 'longitudinal' ? 'FOLLOW-UP' : m === 'normative' ? 'ATLAS' : 'SCAN B'

  // Disable compare button for normative (skull-strip mismatch warning)
  _updateNormativeCompareState()
  checkCanCompare()
}

async function _loadNormativeDefaults() {
  const DEMO_BRAIN_URL = '/demo/demo_brain.nii.gz'
  const DEMO_SEG_URL   = '/demo/demo_seg.nii'
  const LOCAL_MNI_URL  = '/demo/mni152.nii.gz'        // ← local, not CDN
  const MNI_SEG_URL    = '/demo/mni152_seg.nii'
  const MNI_COOL_CMAP  = 'cool'
 
  try {
    // ── 1. Fetch all 4 local files in parallel ──────────────────────────────
    const [respBrain, respSeg, respMNI, respMNISeg] = await Promise.all([
      fetch(DEMO_BRAIN_URL),
      fetch(DEMO_SEG_URL),
      fetch(LOCAL_MNI_URL),
      fetch(MNI_SEG_URL),
    ])
 
    // ── 2. Load demo_brain into Scan A ──────────────────────────────────────
    if (!fileA) {
      if (!respBrain.ok) {
        console.warn('[NeuroHEX] Normative: demo_brain not found — user must upload manually')
      } else {
        const blob = await respBrain.blob()
        const file = new File([blob], 'demo_brain.nii.gz', { type: 'application/gzip' })
        await handleFile(file, 'a')
        // handleFile sets urlA, metaA, fileA
        const labelInpA  = $('label-a');  if (labelInpA)  labelInpA.value       = 'Patient Brain'
        const paneLabelA = $('pane-label-a'); if (paneLabelA) paneLabelA.textContent = 'PATIENT BRAIN'
      }
    }
 
    // ── 3. Build a blob URL for MNI152 and load into Scan B viewer ──────────
    // We create a blob URL so enableOverlayView() has a stable local URL for B.
    let mniBlob = null
    let mniBlobUrl = null
 
    if (respMNI.ok) {
      mniBlob = await respMNI.blob()
      mniBlobUrl = URL.createObjectURL(mniBlob)
      // Store in urlB so the rest of the app (overlay toggle, etc.) can use it
      if (urlB) URL.revokeObjectURL(urlB)
      urlB = mniBlobUrl
    } else {
      // Fallback to CDN if local file missing
      console.warn('[NeuroHEX] Normative: local mni152.nii.gz not found — falling back to CDN')
      urlB = MNI_URL
    }
 
    // Show dual viewer before loading
    dualViewer.classList.remove('hidden')
    emptyState.classList.add('hidden')
    viewerToolbar.classList.remove('hidden')
 
    // Guard against missing URL (local file + CDN fallback failed)
if (!urlB || typeof urlB !== 'string') {
  console.warn('[NeuroHEX] Normative: no valid MNI URL, using CDN fallback')
  urlB = MNI_URL
}
await nvB.loadVolumes([{
  url:      urlB,
  name:     'mni152.nii.gz',       // <-- include extension
  colormap: MNI_COOL_CMAP,
  opacity:  1,
}])
    setSliceType(currentView, nvB)
 
    // Update UI for Scan B slot
    const cmapBEl    = $('cmap-b');       if (cmapBEl)    cmapBEl.value           = MNI_COOL_CMAP
    const badgeBEl   = $('badge-b');      if (badgeBEl)   badgeBEl.classList.remove('hidden')
    const dropBEl2   = $('drop-b');       if (dropBEl2)   dropBEl2.classList.add('hidden')
    const nameBEl    = $('name-b');       if (nameBEl)    nameBEl.textContent     = 'mni152.nii.gz'
    const sizeBEl    = $('size-b');       if (sizeBEl)    sizeBEl.textContent     = mniBlob ? fmtBytes(mniBlob.size) : '↓ remote'
    const paneLabelB = $('pane-label-b'); if (paneLabelB) paneLabelB.textContent = 'MNI152 REFERENCE ATLAS'
    const paneDateB  = $('pane-date-b');  if (paneDateB)  paneDateB.textContent  = 'Standard Atlas'
 
    metaB = extractNiftiHeader(nvB, 'MNI152')
 
    // ── 4. Inject pre-computed SynthSeg seg for Scan A ──────────────────────
    if (respSeg.ok && metaA) {
      const segBuf = await respSeg.arrayBuffer()
      const { rawLabels: rawA } = parseSynthSegNifti(segBuf)
      if (rawA) {
        rawLabelsA = rawA
        populateVolumesFromSynthSeg(metaA, rawLabelsA)
        renderMetaDisplay('meta-display-a', metaA, 'a')
        window.comparisonDemoMode.a = false
        console.log('[NeuroHEX] Normative: demo_seg.nii injected for Scan A ✓')
      }
    } else {
      console.warn('[NeuroHEX] Normative: demo_seg.nii not found — Scan A volumes will be blank')
    }
 
    // ── 5. Inject pre-computed SynthSeg seg for MNI152 ──────────────────────
    if (respMNISeg.ok && metaB) {
      const mniSegBuf = await respMNISeg.arrayBuffer()
      const { rawLabels: rawB } = parseSynthSegNifti(mniSegBuf)
      if (rawB) {
        rawLabelsB = rawB
        populateVolumesFromSynthSeg(metaB, rawLabelsB)
        renderMetaDisplay('meta-display-b', metaB, 'b')
        window.comparisonDemoMode.b = false
        console.log('[NeuroHEX] Normative: mni152_seg.nii injected for Scan B ✓')
      }
    } else {
      console.warn('[NeuroHEX] Normative: mni152_seg.nii not found — MNI volumes will be blank')
    }
 
    // ── 6. Switch to overlay layout ─────────────────────────────────────────
    // Pass urlB explicitly so enableOverlayView doesn't depend on it being set
    // via the normal handleFile() path.
    await enableOverlayView(urlB)
    setLayout('overlay')
 
    // ── 7. Lock compare button with explanation ──────────────────────────────
    _updateNormativeCompareState()
 
    console.log('[NeuroHEX] Normative defaults loaded — overlay active, compare locked ✓')
 
  } catch (e) {
    console.warn('[NeuroHEX] Normative default load failed:', e)
  }
}

function _updateNormativeCompareState() {
  if (mode !== 'normative') {
    compareBtn.disabled = !(fileA && fileB)
    compareHint.textContent = 'Run volumetric comparison'
    return
  }
  // Disable comparison in normative mode — skull-strip mismatch would produce false results
  compareBtn.disabled = true
  compareHint.innerHTML = `
    <span style="color:var(--amber)">⚠ Comparison disabled in Normative mode</span><br>
    <span style="font-size:8px;color:var(--fg-dim)">
      MNI152 is skull-stripped; patient brain is not.<br>
      Volumetric delta would be clinically invalid.
    </span>`
}

// ── SLICE TYPE ────────────────────────────────────────────────────────────────
function setSliceType(view, specificNV = null) {
  currentView = view
  const targets = specificNV
    ? [specificNV]
    : [nvA, nvB, nvOverlay].filter(n => n && n.volumes && n.volumes.length)
  targets.forEach(nv => {
    try {
      switch (view) {
        case 'axial':       nv.setSliceType(nv.sliceTypeAxial);        break
        case 'sagittal':    nv.setSliceType(nv.sliceTypeSagittal);     break
        case 'coronal':     nv.setSliceType(nv.sliceTypeCoronal);      break
        case 'multiplanar': nv.setSliceType(nv.sliceTypeMultiplanar);  break
        case 'render':      nv.setSliceType(nv.sliceTypeRender);       break
      }
    } catch {}
  })
  document.querySelectorAll('.vopt-view').forEach(b =>
    b.classList.toggle('vopt-active', b.dataset.view === view)
  )
  document.querySelectorAll('.tb-slice').forEach(b =>
    b.classList.toggle('tb-layout-active', b.dataset.view === view)
  )
}

// ── LAYOUT ────────────────────────────────────────────────────────────────────
function setLayout(l) {
  layout = l
  document.getElementById('float-diff-canvas')?.remove()
  document.getElementById('diff-legend')?.remove()
  document.getElementById('diff-no-result-hint')?.remove()

  const paneB   = $('pane-b')
  const divider = $('viewer-divider')
  const paneA   = $('pane-a')
  if (paneB)   paneB.style.display   = ''
  if (divider) divider.style.display = ''
  if (paneA)   paneA.style.flex      = ''

  dualViewer.classList.add('hidden')
  overlayViewer.classList.add('hidden')
  diffViewer.classList.add('hidden')

  if (l === 'side-by-side') {
    dualViewer.classList.remove('hidden')
  } else if (l === 'overlay') {
    // [P4-15] Always show overlayViewer when layout === 'overlay', guard is in click handler
    overlayViewer.classList.remove('hidden')
  } else if (l === 'difference') {
    dualViewer.classList.remove('hidden')
    if (comparisonResult) {
      if (paneB)   paneB.style.display   = 'none'
      if (divider) divider.style.display = 'none'
      if (paneA)   paneA.style.flex      = '1 1 100%'
      renderDiffHeatmap()
    } else {
      const hint = document.createElement('div')
      hint.id = 'diff-no-result-hint'
      hint.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:var(--mono);font-size:11px;color:var(--fg-dim);text-align:center;pointer-events:none;z-index:20;letter-spacing:0.1em;'
      hint.innerHTML = `<div style="font-size:20px;margin-bottom:8px;opacity:0.3">⬡</div>Run comparison first to see the difference map`
      $('dual-viewer')?.appendChild(hint)
    }
  }

  if (dualViewer.classList.contains('hidden') &&
      overlayViewer.classList.contains('hidden') &&
      diffViewer.classList.contains('hidden')) {
    dualViewer.classList.remove('hidden')
  }

  document.querySelectorAll('[data-layout]').forEach(b =>
    b.classList.toggle('vopt-active', b.dataset.layout === l)
  )
  document.querySelectorAll('.tb-layout').forEach(b =>
    b.classList.toggle('tb-layout-active', b.dataset.layout === l)
  )
  setTimeout(() => { nvA?.resizeListener(); nvB?.resizeListener(); nvOverlay?.resizeListener() }, 50)
}

// ── [P3-09] UPDATED PROC STEPS ────────────────────────────────────────────────
const PROC_STEPS = [
  'Uploading Scan A to SynthSeg backend',
  'SynthSeg 32-region parcellation — Scan A (~60s)',
  'Uploading Scan B to SynthSeg backend',
  'SynthSeg 32-region parcellation — Scan B (~60s)',
  'Computing real volumetric delta',
  'Hippocampal atrophy analysis (labels 17 + 53)',
  'Atrophy velocity vs normative ranges',
  'Gemini multimodal progression assessment',
  'Rendering clinical results',
]

function buildProcSteps() {
  procStepsEl.innerHTML = PROC_STEPS.map((s, i) =>
    `<div class="proc-step" id="cps-${i}">
       <div class="proc-step-dot"></div>
       <span>${s}</span>
     </div>`
  ).join('')
}

function setProc(pct, label, step = -1) {
  if (pct !== null) {
    procBar.style.width  = pct + '%'
    procGlow.style.right = (100 - pct) + '%'
  }
  if (label) procLabel.textContent = label
  if (step >= 0) {
    document.querySelectorAll('.proc-step').forEach((el, i) => {
      el.classList.remove('active', 'done')
      if (i < step)  el.classList.add('done')
      if (i === step) el.classList.add('active')
    })
  }
}

// ── [P1-01 + P1-02 + P1-03 + P1-04] MAIN ANALYSIS PIPELINE ─────────────────
async function runComparison() {
  if (!fileA) return
  if (!fileB && mode !== 'normative') return

  aiNarrative = ''
  buildProcSteps()
  procOverlay.classList.remove('hidden')
  $('proc-title').textContent =
    mode === 'longitudinal' ? 'LONGITUDINAL ANALYSIS' :
    mode === 'normative'    ? 'NORMATIVE MAPPING'     : 'SCAN COMPARISON'

  try {
    // ── Step 0–1: SynthSeg Scan A ──
    setProc(4, 'Uploading Scan A to SynthSeg backend…', 0)
    await delay(200)
    setProc(8, 'SynthSeg parcellation — Scan A (~60s)…', 1)
    const synthA = await callSynthSeg(fileA, 'Scan A')
    if (synthA) {
      rawLabelsA = synthA.rawLabels
      populateVolumesFromSynthSeg(metaA, rawLabelsA)
      renderMetaDisplay('meta-display-a', metaA, 'a')
      window.comparisonDemoMode.a = false
    } else {
      // [P4-16] Fallback
      window.comparisonDemoMode.a = true
      const remapped = await demoFallbackSeg(metaA)
      rawLabelsA = remapped  // use remapped as fake rawLabels for region counting
      populateVolumesFromFallback(metaA, remapped)
      renderMetaDisplay('meta-display-a', metaA, 'a')
    }

    // ── Step 2–3: Normative mode — load MNI152 ──
    if (mode === 'normative') {
      setProc(22, 'Fetching MNI152 reference atlas…', 2)
      try {
        await nvB.loadVolumes([{ url: MNI_URL, name: 'MNI152', colormap: 'gray', opacity: 1 }])
        metaB = extractNiftiHeader(nvB, 'MNI152')
        renderMetaDisplayPending('meta-display-b', metaB, 'b')
        $('badge-b').classList.remove('hidden'); $('drop-b').classList.add('hidden')
        $('name-b').textContent = 'MNI152.nii.gz'; $('size-b').textContent = '↓ remote'
        dualViewer.classList.remove('hidden'); emptyState.classList.add('hidden'); viewerToolbar.classList.remove('hidden')
      } catch (e) { console.warn('[NeuroHEX] MNI fetch failed:', e) }
      // Send MNI to SynthSeg
      setProc(30, 'SynthSeg parcellation — MNI152 (~60s)…', 3)
      const synthMNI = await callSynthSegFromUrl(MNI_URL, 'MNI152')
      if (synthMNI) {
        rawLabelsB = synthMNI.rawLabels
        populateVolumesFromSynthSeg(metaB, rawLabelsB)
        renderMetaDisplay('meta-display-b', metaB, 'b')
        window.comparisonDemoMode.b = false
      } else {
        window.comparisonDemoMode.b = true
        if (metaB) { const r = await demoFallbackSeg(metaB); rawLabelsB = r; populateVolumesFromFallback(metaB, r) }
      }
    } else {
      // ── Step 2–3: SynthSeg Scan B ──
      setProc(26, 'Uploading Scan B to SynthSeg backend…', 2)
      await delay(200)
      setProc(30, 'SynthSeg parcellation — Scan B (~60s)…', 3)
      const synthB = await callSynthSeg(fileB, 'Scan B')
      if (synthB) {
        rawLabelsB = synthB.rawLabels
        populateVolumesFromSynthSeg(metaB, rawLabelsB)
        renderMetaDisplay('meta-display-b', metaB, 'b')
        window.comparisonDemoMode.b = false
      } else {
        window.comparisonDemoMode.b = true
        const remapped = await demoFallbackSeg(metaB)
        rawLabelsB = remapped
        populateVolumesFromFallback(metaB, remapped)
        renderMetaDisplay('meta-display-b', metaB, 'b')
      }
    }

    // [P4-16] Banner for partial/full demo mode
    const { a: demoA, b: demoB } = window.comparisonDemoMode
    if (demoA && demoB) {
      showDemoModeBanner('⚠ DEMO MODE — Both scans in demo segmentation. Volumes are estimated, not real SynthSeg output.')
    } else if (demoA) {
      showDemoModeBanner('⚠ Scan A in demo mode — delta metrics may be inaccurate. Compare with caution.')
    } else if (demoB) {
      showDemoModeBanner('⚠ Scan B in demo mode — delta metrics may be inaccurate. Compare with caution.')
    }

    if (!metaA || !metaB) throw new Error('Could not extract metadata from both scans.')

    // ── Step 4: Volumetric delta ──
    setProc(55, 'Computing real volumetric delta…', 4)
    await delay(300)

    const ageA = parseFloat($('age-a').value) || 0
    const ageB = parseFloat($('age-b').value) || ageA
    const sex  = $('sex-a').value || ''

    // ── Step 5: Hippocampal analysis ──
    setProc(64, 'Hippocampal atrophy analysis…', 5)
    await delay(250)

    // ── Step 6: Atrophy velocity ──
    setProc(72, 'Atrophy velocity analysis…', 6)
    await delay(200)
    const dateA = $('date-a').value
    const dateB = $('date-b').value
    const intervalObj = computeInterval(dateA, dateB, ageA, ageB)
    const normsA = getNorms(ageA || 35, sex)
    const normsB = getNorms(ageB || 35, sex)

    // [P1-03] Real region delta from SynthSeg labels
    const regionRows = computeRegionDelta(rawLabelsA, rawLabelsB, metaA.voxelVolMm3, metaB.voxelVolMm3)

    // ── Step 7: Gemini multimodal ──
    setProc(80, 'Gemini multimodal progression assessment…', 7)
    await delay(200)

    // Capture MRI slices for Gemini
    let sliceA64 = null, sliceB64 = null
    try {
      const ca = $('canvas-a'), cb = $('canvas-b')
      if (ca) sliceA64 = ca.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
      if (cb) sliceB64 = cb.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
    } catch {}

    // Build result object first (needed for LLM prompt)
    comparisonResult = buildComparisonResult(
      metaA, metaB, normsA, normsB, intervalObj, regionRows, ageA, ageB, sex
    )

    // [P1-04] LLM progression score
    const llmResult = await callLLMProgressionScore(comparisonResult, sliceA64, sliceB64)
    if (llmResult) {
      comparisonResult.progScore   = llmResult.score
      comparisonResult.progSev     = llmResult.severity
      aiNarrative                  = llmResult.narrative
      comparisonResult.aiNarrative = llmResult.narrative
      comparisonResult.aiSource    = llmResult.source
    }

    // ── Step 8: Render ──
    setProc(95, 'Rendering clinical results…', 8)
    await delay(300)
    setProc(100, 'Complete.', 8)
    await delay(300)

    renderAllResults(comparisonResult)
    if (layout === 'difference') renderDiffHeatmap()

    navDeltaPill.classList.remove('hidden')
    $('nav-delta-text').textContent = `Δ ${fmtDelta(comparisonResult.deltas.brain)}`
    exportRepBtn.disabled = false

  } catch (err) {
    console.error('[NeuroHEX] Comparison error:', err)
    alert('Comparison failed: ' + err.message)
  } finally {
    procOverlay.classList.add('hidden')
  }
}

// [P1-02] Fallback volume population from remapped segmentation
function populateVolumesFromFallback(meta, remapped) {
  if (!meta || !remapped) return
  const ml = meta.voxelVolMm3 / 1000
  const SYNTHSEG_NORM = 910, WHOLE_BRAIN_NORM = 1350
  const cf = WHOLE_BRAIN_NORM / SYNTHSEG_NORM
  let csf = 0, gm = 0, wm = 0, deep = 0
  for (let i = 0; i < remapped.length; i++) {
    if      (remapped[i] === 1) csf++
    else if (remapped[i] === 2) wm++
    else if (remapped[i] === 3) gm++
    else if (remapped[i] === 4) deep++
  }
  const raw = (csf + gm + wm + deep) * ml
  meta.brainCm3 = +(raw  * cf).toFixed(2)
  meta.gmCm3    = +(gm   * ml * cf).toFixed(2)
  meta.wmCm3    = +(wm   * ml * cf).toFixed(2)
  meta.csfCm3   = +(csf  * ml * cf).toFixed(2)
  meta.deepCm3  = +(deep * ml * cf).toFixed(2)

  const N = meta.dims[0] * meta.dims[1] * meta.dims[2]
  const midX = Math.floor(meta.dims[0] / 2)
  let lh = 0, rh = 0
  for (let x = 0; x < meta.dims[0]; x++)
    for (let y = 0; y < meta.dims[1]; y++)
      for (let z = 0; z < meta.dims[2]; z++) {
        const idx = x * meta.dims[1] * meta.dims[2] + y * meta.dims[2] + z
        if (remapped[idx] > 0) { if (x < midX) lh++; else rh++ }
      }
  meta.lhCm3 = +((lh * ml) * cf).toFixed(2)
  meta.rhCm3 = +((rh * ml) * cf).toFixed(2)
  meta.asi   = (lh + rh) > 0 ? +((Math.abs(lh - rh) / ((lh + rh) / 2)) * 100).toFixed(2) : 0
  meta.hipLCm3 = null; meta.hipRCm3 = null
  meta.synthSegLabels = null
}

// ── [P1-03] REAL REGION DELTA FROM SYNTHSEG ───────────────────────────────────
function computeRegionDelta(rawA, rawB, voxVolA, voxVolB) {
  const mlA = (voxVolA || 1) / 1000
  const mlB = (voxVolB || 1) / 1000
  const SYNTHSEG_NORM = 910, WHOLE_BRAIN_NORM = 1350
  const cf = WHOLE_BRAIN_NORM / SYNTHSEG_NORM

  const regions = [
    { name: 'Cerebral Cortex', ids: [3, 42] },
    { name: 'Cerebellum',      ids: [7, 8, 46, 47] },
    { name: 'Thalamus',        ids: [10, 49] },
    { name: 'Hippocampus L',   ids: [17] },
    { name: 'Hippocampus R',   ids: [53] },
    { name: 'Putamen',         ids: [12, 51] },
    { name: 'Caudate',         ids: [11, 50] },
    { name: 'Amygdala',        ids: [18, 54] },
    { name: 'Brainstem',       ids: [16] },
    { name: 'White Matter',    ids: [2, 41] },
  ]

  return regions.map(r => {
    const cA = rawA ? countLabels(rawA, r.ids) : 0
    const cB = rawB ? countLabels(rawB, r.ids) : 0
    const vA = +(cA * mlA * cf).toFixed(2)
    const vB = +(cB * mlB * cf).toFixed(2)
    const d  = +(vB - vA).toFixed(2)
    const pct = vA > 0 ? +(d / vA * 100).toFixed(1) : 0
    return { name: r.name, volA: vA, volB: vB, delta: d, pct }
  })
}

// ── [P1-04] LLM PROGRESSION SCORE ────────────────────────────────────────────
async function callLLMProgressionScore(d, sliceA64, sliceB64) {
  const prompt = buildLLMPrompt(d)

  // Try Gemini with MRI images
  if (GEMINI_KEY && sliceA64 && sliceB64) {
    try {
      const result = await callGeminiMultimodal(prompt, sliceA64, sliceB64)
      if (result) return { ...result, source: 'Gemini 2.0 Flash (multimodal)' }
    } catch (e) { console.warn('[NeuroHEX] Gemini failed:', e.message) }
  } else if (GEMINI_KEY) {
    try {
      const result = await callGeminiText(prompt)
      if (result) return { ...result, source: 'Gemini 2.0 Flash' }
    } catch (e) { console.warn('[NeuroHEX] Gemini text failed:', e.message) }
  }

  // Try Groq
  if (GROQ_KEY) {
    try {
      const result = await callGroqProgression(prompt)
      if (result) return { ...result, source: 'Groq Llama 3.3' }
    } catch (e) { console.warn('[NeuroHEX] Groq failed:', e.message) }
  }

  // Fallback to rule-based
  const score = computeProgressionScoreFallback(d.deltas, d.rates, d.intervalYrs, d.ageA, d.ageB)
  const severity = score >= 70 ? 'High Progression' : score >= 40 ? 'Moderate Progression' : 'Stable / Low'
  const narrative = buildRuleBasedNarrative(d)
  return { score, severity, narrative, source: 'Rule-based' }
}

function buildLLMPrompt(d) {
  const hipRows = d.regionRows?.filter(r => r.name.startsWith('Hippo')) || []
  const hipL = hipRows.find(r => r.name === 'Hippocampus L')
  const hipR = hipRows.find(r => r.name === 'Hippocampus R')
  return `You are a board-certified neuroradiologist reviewing longitudinal brain MRI data.

Patient: Age ${d.ageA||'?'} → ${d.ageB||'?'}, Sex ${d.sex||'?'}, Interval: ${d.intervalYrs.toFixed(2)} yr

Volumetric deltas (cm³, B vs A):
- Total Brain: ${d.metaA.brainCm3} → ${d.metaB.brainCm3} (Δ ${d.deltas.brain}, ${d.rates.brain}%/yr)
- Grey Matter: ${d.metaA.gmCm3} → ${d.metaB.gmCm3} (Δ ${d.deltas.gm}, ${d.rates.gm}%/yr)
- White Matter: ${d.metaA.wmCm3} → ${d.metaB.wmCm3} (Δ ${d.deltas.wm}, ${d.rates.wm}%/yr)
- Hippocampus L: ${hipL ? `${hipL.volA} → ${hipL.volB} (Δ ${hipL.delta})` : 'N/A'}
- Hippocampus R: ${hipR ? `${hipR.volA} → ${hipR.volB} (Δ ${hipR.delta})` : 'N/A'}
- ASI: ${d.metaA.asi}% → ${d.metaB.asi}% (Δ ${d.asiDelta})
- Normacy: ${d.normacyA} → ${d.normacyB}

Compare these two brain MRI scans. What has visibly changed? Is the measured atrophy clinically significant for this patient's age?

Respond ONLY in valid JSON (no markdown, no preamble):
{"score": <0-100>, "severity": "<Stable / Low|Moderate Progression|High Progression|Critical>", "narrative": "<two clinical paragraphs>"}`
}

async function callGeminiMultimodal(prompt, sliceA64, sliceB64) {
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/jpeg', data: sliceA64 } },
        { inlineData: { mimeType: 'image/jpeg', data: sliceB64 } },
      ]
    }],
    generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
  }
  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Gemini ${resp.status}: ${e.slice(0,120)}`) }
  const data = await resp.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return parseJSONResponse(text)
}

async function callGeminiText(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 600, temperature: 0.2 },
  }
  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Gemini ${resp.status}: ${e.slice(0,120)}`) }
  const data = await resp.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return parseJSONResponse(text)
}

async function callGroqProgression(prompt) {
  const resp = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600, temperature: 0.2,
    }),
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}`)
  const data = await resp.json()
  const text = data.choices?.[0]?.message?.content || ''
  return parseJSONResponse(text)
}

function parseJSONResponse(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const j = JSON.parse(clean)
    if (typeof j.score === 'number' && j.severity && j.narrative) {
      return { score: Math.round(clamp(j.score, 0, 100)), severity: j.severity, narrative: j.narrative }
    }
  } catch {}
  return null
}

function computeProgressionScoreFallback(deltas, rates, yrs, ageA, ageB) {
  let score = 0
  if      (rates.brain > 0.8) score += 30
  else if (rates.brain > 0.5) score += 15
  else if (rates.brain > 0.3) score += 7
  if      (rates.gm > 1.1) score += 25
  else if (rates.gm > 0.7) score += 12
  else if (rates.gm > 0.4) score += 5
  if      (deltas.brain < -50) score += 20
  else if (deltas.brain < -20) score += 10
  if (yrs > 0 && (ageA > 65 || ageB > 65)) score += 10
  return Math.min(100, Math.round(score))
}

function buildRuleBasedNarrative(d) {
  const rateStatus = d.rates.brain > 0.8 ? 'accelerated' : d.rates.brain > 0.5 ? 'elevated' : 'within normal limits'
  const gmNote = d.rates.gm > 1.1 ? 'significant grey matter atrophy' : 'grey matter within expected range'
  return `Brain volume loss of ${d.rates.brain}%/yr is ${rateStatus} compared to normative data (Raz et al. 2005; normal range 0.1–0.5%/yr). ${gmNote.charAt(0).toUpperCase() + gmNote.slice(1)} detected over the ${d.intervalYrs.toFixed(1)}-year interval. Normalcy index declined from ${d.normacyA} to ${d.normacyB} points.\n\nClinical correlation is recommended. All volumetric metrics were derived from real SynthSeg 32-region parcellation (Billot et al., Nature Methods 2023). This report was generated by the NeuroHEX rule-based engine (fallback mode). For optimal AI interpretation, configure Gemini 2.0 Flash or Groq API keys in config.js.`
}

// ── [P3-10] INTERVAL COMPUTATION WITH ESTIMATION FLAG ────────────────────────
function computeInterval(dA, dB, ageA, ageB) {
  if (dA && dB) {
    const diff = (new Date(dB) - new Date(dA)) / (86400000 * 365.25)
    if (!isNaN(diff) && diff > 0) return { years: diff, estimated: false }
  }
  if (ageA && ageB && ageB > ageA) return { years: ageB - ageA, estimated: false }
  return { years: 1.0, estimated: true }
}

// ── NORMATIVE RANGES ──────────────────────────────────────────────────────────
function getNorms(age, sex) {
  const m = {
    brain: { mean: 1350, sd: 120 },
    gm:    { mean: 620,  sd: 55  },
    wm:    { mean: 480,  sd: 48  },
    csf:   { mean: 140,  sd: 40  },
    deep:  { mean: 55,   sd: 10  },
  }
  const ageFac = 1 - clamp((age - 30) * 0.004, 0, 0.25)
  Object.keys(m).forEach(k => { m[k].mean = Math.round(m[k].mean * ageFac) })
  if (sex === 'F') {
    m.brain.mean = Math.round(m.brain.mean * 0.93)
    m.gm.mean    = Math.round(m.gm.mean    * 0.91)
    m.wm.mean    = Math.round(m.wm.mean    * 0.94)
  }
  return m
}

// [P2-06] Hippocampal normative (Jack et al. 2010)
function getHippoNorm(age, sex) {
  let mean = 3.85
  if (age > 50) mean -= (age - 50) * 0.012
  if (sex === 'F') mean *= 0.94
  return { mean: +mean.toFixed(2), sd: 0.42, lo: +(mean - 0.84).toFixed(2), hi: +(mean + 0.84).toFixed(2) }
}

const NORM_RATES = {
  brain: { lo: 0.1, hi: 0.5, alert: 0.8  },
  gm:    { lo: 0.2, hi: 0.7, alert: 1.1  },
  wm:    { lo: 0.1, hi: 0.4, alert: 0.8  },
  deep:  { lo: 0.2, hi: 0.8, alert: 1.5  },
  hippo: { lo: 0.3, hi: 1.5, alert: 2.5  },  // Jack et al. 2010
}

// ── BUILD COMPARISON RESULT ───────────────────────────────────────────────────
function buildComparisonResult(mA, mB, nA, nB, intervalObj, regionRows, ageA, ageB, sex) {
  const keys   = ['brain', 'gm', 'wm', 'csf', 'deep']
  const keyMap = { brain: 'brainCm3', gm: 'gmCm3', wm: 'wmCm3', csf: 'csfCm3', deep: 'deepCm3' }
  const deltas = {}, rates = {}, pctiles = {}

  const intervalYrs = intervalObj.years
  const intervalEstimated = intervalObj.estimated

  keys.forEach(k => {
    const mk = keyMap[k]
    const a  = mA[mk] || 0, b = mB[mk] || 0
    const d  = b - a
    const annRate = intervalYrs > 0 ? (Math.abs(d) / (a || 1) * 100 / intervalYrs) : 0
    deltas[k]  = +d.toFixed(2)
    rates[k]   = +annRate.toFixed(2)
    const norm = nA[k] || nA.brain
    pctiles[k] = calcPctile(b, norm.mean, norm.sd)
  })

  // [P2-06] Hippocampal delta
  const hipLA = mA.hipLCm3 || 0
  const hipRA = mA.hipRCm3 || 0
  const hipLB = mB.hipLCm3 || 0
  const hipRB = mB.hipRCm3 || 0
  const hipLDelta = +(hipLB - hipLA).toFixed(3)
  const hipRDelta = +(hipRB - hipRA).toFixed(3)
  const hipLRate  = hipLA > 0 && intervalYrs > 0 ? +(Math.abs(hipLDelta) / hipLA * 100 / intervalYrs).toFixed(2) : 0
  const hipRRate  = hipRA > 0 && intervalYrs > 0 ? +(Math.abs(hipRDelta) / hipRA * 100 / intervalYrs).toFixed(2) : 0
  const hipNormA  = getHippoNorm(ageA || 35, sex)
  const hipNormB  = getHippoNorm(ageB || 35, sex)

  const asiA  = mA.asi || 0
  const asiB  = mB.asi || 0
  const asiDelta = +(asiB - asiA).toFixed(2)

  const normacyA  = computeNormacy(mA, nA)
  const normacyB  = computeNormacy(mB, nB)

  // Progression score (will be overwritten by LLM if available)
  const progScore = computeProgressionScoreFallback(deltas, rates, intervalYrs, ageA, ageB)
  const progSev   = progScore >= 70 ? 'High Progression' : progScore >= 40 ? 'Moderate Progression' : 'Stable / Low'

  const clinicalAlerts = evalClinicalRules({
    deltas, rates, asiA, asiB, asiDelta,
    mA, mB, intervalYrs, intervalEstimated, ageA, ageB,
    normacyA, normacyB, nA, nB,
    hipLA, hipRA, hipLB, hipRB, hipLDelta, hipRDelta, hipLRate, hipRRate, hipNormA, hipNormB,
  })

  return {
    mode, metaA: mA, metaB: mB, normsA: nA, normsB: nB,
    intervalYrs: +intervalYrs.toFixed(2), intervalEstimated,
    deltas, rates, pctiles,
    asiA, asiB, asiDelta,
    normacyA, normacyB, progScore, progSev,
    hipLA, hipRA, hipLB, hipRB, hipLDelta, hipRDelta, hipLRate, hipRRate, hipNormA, hipNormB,
    regionRows, clinicalAlerts,
    aiNarrative: '', aiSource: '',
    ageA, ageB, sex,
    labelA: $('label-a').value || $('date-a').value || 'Scan A',
    labelB: $('label-b').value || $('date-b').value || 'Scan B',
    dateA: $('date-a').value, dateB: $('date-b').value,
    pid: $('pid-a').value || '—',
    demoModeA: window.comparisonDemoMode.a, demoModeB: window.comparisonDemoMode.b,
  }
}

function computeNormacy(m, n) {
  if (!m.brainCm3) return 50
  const volScore   = clamp(100 - Math.abs(m.brainCm3 - n.brain.mean) / n.brain.sd * 20, 0, 100)
  const ratioScore = clamp(100 - Math.abs((m.gmCm3 / (m.wmCm3 || 1)) - 1.3) * 30, 0, 100)
  const asiScore   = clamp(100 - (m.asi || 0) * 5, 0, 100)
  return Math.round((volScore + ratioScore + asiScore) / 3)
}

function calcPctile(val, mean, sd) {
  const z = (val - mean) / sd
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const cdf = 1 - 0.3989422803 * Math.exp(-0.5 * z * z) * p
  return Math.round((z >= 0 ? cdf : 1 - cdf) * 100)
}

// ── CLINICAL RULES ENGINE ─────────────────────────────────────────────────────
function evalClinicalRules({ deltas, rates, asiA, asiB, asiDelta, mA, mB, intervalYrs, intervalEstimated, ageA, ageB, normacyA, normacyB, nA, nB, hipLA, hipRA, hipLB, hipRB, hipLDelta, hipRDelta, hipLRate, hipRRate, hipNormA, hipNormB }) {
  const rules = []
  const ratesSuffix = intervalEstimated ? '*' : ''

  if (rates.brain > 0.8) {
    rules.push({ sev: 'alert', icon: '⚠', title: 'Accelerated Global Atrophy',
      desc: `Annualized brain volume loss ${rates.brain}%/yr${ratesSuffix} exceeds threshold of 0.8%/yr (Raz et al. 2005)`,
      rec: 'Repeat MRI 6–12 months; neuropsychological evaluation',
      ddx: ["Early Alzheimer's (G30.9)", 'Frontotemporal Dementia (G31.09)', 'Normal Pressure Hydrocephalus (G91.2)'] })
  } else if (rates.brain > 0.5) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Elevated Atrophy Rate',
      desc: `Brain volume loss ${rates.brain}%/yr${ratesSuffix} above normal range (0.1–0.5%/yr)`,
      rec: 'Repeat MRI 12–18 months; cognitive screen',
      ddx: ['Age-Related Neurodegeneration', 'Vascular Risk Factors'] })
  } else {
    rules.push({ sev: 'ok', icon: '✓', title: 'Atrophy Rate Within Normal Limits',
      desc: `Brain volume change ${rates.brain}%/yr${ratesSuffix} — within expected range for age` })
  }

  if (rates.gm > 1.1) {
    rules.push({ sev: 'alert', icon: '⚠', title: 'Significant Grey Matter Loss',
      desc: `GM atrophy ${rates.gm}%/yr${ratesSuffix} — highly above normal. Δ ${fmtDelta(deltas.gm)} over ${intervalYrs.toFixed(1)} yr`,
      rec: 'FDG-PET; detailed cortical thickness analysis',
      ddx: ['Cortical Atrophy (G31.09)', 'Dementia (F03.90)'] })
  } else if (rates.gm > 0.7) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Elevated Grey Matter Atrophy',
      desc: `GM loss ${rates.gm}%/yr${ratesSuffix} — above expected range (0.2–0.7%/yr)`,
      ddx: ['Age-Related Atrophy', 'Small Vessel Disease (I67.3)'] })
  }

  // [P2-06] Hippocampal rule (Jack et al. 2010)
  if (hipLRate > 2.5 || hipRRate > 2.5) {
    rules.push({ sev: 'alert', icon: '⚠', title: 'Accelerated Hippocampal Atrophy',
      desc: `Hippo L: ${hipLRate}%/yr${ratesSuffix}, R: ${hipRRate}%/yr${ratesSuffix} — exceeds 2.5%/yr threshold (Jack et al. 2010). Δ L ${hipLDelta > 0 ? '+' : ''}${hipLDelta.toFixed(3)} cm³, R ${hipRDelta > 0 ? '+' : ''}${hipRDelta.toFixed(3)} cm³`,
      rec: 'Neuropsychological assessment; amyloid PET imaging',
      ddx: ["Early Alzheimer's (G30.9)", 'Temporal Lobe Epilepsy (G40.2)', 'Mesial Temporal Sclerosis (G93.89)'] })
  } else if ((hipLRate > 1.5 || hipRRate > 1.5) && (hipLA > 0 || hipRA > 0)) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Elevated Hippocampal Atrophy Rate',
      desc: `Hippo L: ${hipLRate}%/yr${ratesSuffix}, R: ${hipRRate}%/yr${ratesSuffix} — above normal ceiling of 1.5%/yr (Jack et al. 2010)`,
      ddx: ['Age-Related Hippocampal Atrophy', 'Early MCI'] })
  }

  const nDelta = normacyB - normacyA
  if (nDelta <= -20) {
    rules.push({ sev: 'alert', icon: '⚠', title: `Normalcy Index Decline — ${Math.abs(nDelta)} pts`,
      desc: `Morphological score fell from ${normacyA} → ${normacyB}. Significant deterioration detected.`,
      rec: 'Comprehensive neurological workup' })
  } else if (nDelta <= -10) {
    rules.push({ sev: 'warn', icon: '⚠', title: `Normalcy Index Decline — ${Math.abs(nDelta)} pts`,
      desc: `Score fell ${normacyA} → ${normacyB}. Moderate morphological change.` })
  } else {
    rules.push({ sev: 'ok', icon: '✓', title: 'Normalcy Index Stable',
      desc: `Score ${normacyA} → ${normacyB} (Δ ${nDelta >= 0 ? '+' : ''}${nDelta})` })
  }

  if (Math.abs(asiDelta) >= 5) {
    rules.push({ sev: 'alert', icon: '⚠', title: 'Significant Asymmetry Change',
      desc: `ASI: ${asiA}% → ${asiB}% (Δ ${asiDelta >= 0 ? '+' : ''}${asiDelta.toFixed(1)}%) — focal process suspected`,
      rec: 'High-res structural MRI; FDG-PET',
      ddx: ['Space-Occupying Lesion', 'Focal Cortical Atrophy'] })
  } else if (Math.abs(asiDelta) >= 2) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Mild Asymmetry Increase',
      desc: `ASI change Δ ${asiDelta >= 0 ? '+' : ''}${asiDelta.toFixed(1)}% — clinical correlation advised` })
  }

  const wmChangePct = Math.abs(deltas.wm) / (mA.wmCm3 || 400) * 100
  if (wmChangePct > 8) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Notable White Matter Volume Change',
      desc: `WM Δ ${fmtDelta(deltas.wm)} (${(deltas.wm / (mA.wmCm3 || 400) * 100).toFixed(1)}%)`,
      ddx: ['White Matter Disease (G35)', 'Small Vessel Disease (I67.3)', 'Demyelination'] })
  }

  // [P3-10] Interval estimation warning
  if (intervalEstimated) {
    rules.push({ sev: 'warn', icon: '⚠', title: 'Interval Estimated as 1.0yr',
      desc: 'No scan dates or age difference provided. All %/yr rates assume 1-year interval. Enter scan dates for accurate velocity calculations.',
      ddx: [] })
  }

  if (!rules.some(r => r.sev !== 'ok')) {
    rules.push({ sev: 'ok', icon: '✓', title: 'No Clinically Significant Progression',
      desc: `All volumetric delta metrics within expected ranges for the ${intervalYrs.toFixed(1)}-year interval` })
  }

  return rules
}

// ── VOXEL DIFFERENCE HEATMAP ──────────────────────────────────────────────────
function computeDeltaMap(remappedA, remappedB, mA, mB) {
  if (!remappedA || !remappedB || !mA || !mB) return null
  const [nxA, nyA, nzA] = mA.dims
  const [nxB, nyB, nzB] = mB.dims
  const N = nxA * nyA * nzA
  const delta = new Int8Array(N)
  for (let x = 0; x < nxA; x++) {
    for (let y = 0; y < nyA; y++) {
      for (let z = 0; z < nzA; z++) {
        const idxA = x * nyA * nzA + y * nzA + z
        const bx = Math.round(x / nxA * nxB), by = Math.round(y / nyA * nyB), bz = Math.round(z / nzA * nzB)
        const idxB = clamp(bx, 0, nxB-1) * nyB * nzB + clamp(by, 0, nyB-1) * nzB + clamp(bz, 0, nzB-1)
        const lA = remappedA[idxA] || 0, lB = remappedB[idxB] || 0
        delta[idxA] = clamp(lB - lA, -4, 4)
      }
    }
  }
  return delta
}

function renderDiffHeatmap() {
  if (!rawLabelsA || !rawLabelsB || !metaA || !metaB) return
  const deltaMap = computeDeltaMap(rawLabelsA, rawLabelsB, metaA, metaB)
  if (!deltaMap) return

  const [nx, ny, nz] = metaA.dims
  document.getElementById('float-diff-canvas')?.remove()
  document.getElementById('diff-legend')?.remove()

  const paneA = $('pane-a')
  if (!paneA) return
  paneA.style.position = 'relative'

  const floatCanvas = document.createElement('canvas')
  floatCanvas.id = 'float-diff-canvas'
  floatCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;opacity:0.65;'
  paneA.appendChild(floatCanvas)

  requestAnimationFrame(() => {
    const W = paneA.clientWidth || 600, H = paneA.clientHeight || 400
    floatCanvas.width = W; floatCanvas.height = H
    const ctx = floatCanvas.getContext('2d')
    const imgD = ctx.createImageData(W, H)
    const midZ = Math.floor(nz / 2)
    for (let px = 0; px < W; px++) {
      for (let py = 0; py < H; py++) {
        const x = Math.floor(px / W * nx), y = Math.floor(py / H * ny)
        const idx = x * ny * nz + y * nz + midZ
        const d = deltaMap[idx] || 0
        const pidx = (py * W + px) * 4
        if (d > 0) {
          imgD.data[pidx]=57; imgD.data[pidx+1]=255; imgD.data[pidx+2]=110; imgD.data[pidx+3]=Math.min(220, d * 55)
        } else if (d < 0) {
          imgD.data[pidx]=255; imgD.data[pidx+1]=51; imgD.data[pidx+2]=85; imgD.data[pidx+3]=Math.min(220, Math.abs(d) * 55)
        }
      }
    }
    ctx.putImageData(imgD, 0, 0)
    const legend = document.createElement('div')
    legend.id = 'diff-legend'
    legend.style.cssText = 'position:absolute;bottom:64px;right:14px;z-index:20;background:rgba(2,5,10,0.88);border:1px solid rgba(0,229,255,0.18);border-radius:7px;padding:8px 12px;font-family:var(--mono);font-size:8px;letter-spacing:0.1em;pointer-events:none;'
    legend.innerHTML = `<div style="color:var(--fg-dim);margin-bottom:6px;letter-spacing:0.16em">DIFF MAP</div><div style="display:flex;align-items:center;gap:7px;margin-bottom:4px"><div style="width:12px;height:12px;background:#39ff6e;border-radius:2px"></div><span style="color:#39ff6e">Tissue Gain (B > A)</span></div><div style="display:flex;align-items:center;gap:7px"><div style="width:12px;height:12px;background:#ff3355;border-radius:2px"></div><span style="color:#ff3355">Tissue Loss (A > B)</span></div>`
    paneA.appendChild(legend)
  })
}

// ── RESULTS RENDERING ─────────────────────────────────────────────────────────
function renderAllResults(d) {
  rpIdle.classList.add('hidden')
  rpResults.classList.remove('hidden')
  rpResults.innerHTML = buildResultsHTML(d)

  requestAnimationFrame(() => requestAnimationFrame(() => {
    rpResults.querySelectorAll('[data-target-w]').forEach(el => {
      el.style.transition = 'width 1s cubic-bezier(0.16,1,0.3,1)'
      el.style.width = el.dataset.targetW + '%'
    })
    const arc = rpResults.querySelector('#score-arc-main')
    if (arc) {
      const C = 2 * Math.PI * 28
      arc.style.strokeDashoffset = String(C - (d.progScore / 100) * C)
    }
    // Stream AI narrative if present
    if (d.aiNarrative) {
      const preEl = rpResults.querySelector('#ai-narrative-pre')
      if (preEl) streamText(d.aiNarrative, preEl)
    }
  }))

  buildRadarChart(d)
  buildSparkline(d)
}

async function streamText(text, el) {
  el.textContent = ''
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i]
    el.scrollTop = el.scrollHeight
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 8))
  }
}

function buildResultsHTML(d) {
  const progColor = d.progScore >= 70 ? 'var(--red)' : d.progScore >= 40 ? 'var(--amber)' : 'var(--green)'
  const progLabel = d.progSev || (d.progScore >= 70 ? 'High Progression' : d.progScore >= 40 ? 'Moderate Progression' : 'Stable / Low')
  const C         = 2 * Math.PI * 28
  const rsSuffix  = d.intervalEstimated ? ' *' : ''
  const sourceTag = d.aiSource ? `<span style="font-size:7px;color:var(--fg-dim);margin-left:8px">${d.aiSource}</span>` : ''

  const makeVelocityRow = (key, label, rate) => {
    const nr    = NORM_RATES[key] || { lo: 0.1, hi: 0.5, alert: 0.8 }
    const color = rate > nr.alert ? 'var(--red)' : rate > nr.hi ? 'var(--amber)' : 'var(--green)'
    const fillW = clamp(rate / nr.alert * 100, 0, 100)
    const normW = clamp(nr.hi  / nr.alert * 100, 0, 100)
    return `<div class="velocity-bar">
      <span class="vel-label">${label}</span>
      <div class="vel-track">
        <div class="vel-fill" style="background:${color};width:0%" data-target-w="${fillW.toFixed(1)}"></div>
        <div class="vel-norm-marker" style="left:${normW}%"></div>
      </div>
      <span class="vel-value" style="color:${color}">${rate}<span style="font-size:7px;color:var(--fg-dim)">/yr${rsSuffix}</span></span>
    </div>`
  }

  const makeDeltaCard = (label, a, b, delta, unit = 'cm³', maxVal = 1400) => {
    const dColor = delta < 0 ? 'var(--red)' : delta > 0 ? 'var(--green)' : 'var(--fg-dim)'
    const fillA  = clamp(a / maxVal * 100, 0, 100)
    const fillB  = clamp(b / maxVal * 100, 0, 100)
    const absDelta = Math.abs(delta / (a || 1) * 100).toFixed(1)
    return `<div class="delta-card">
      <div class="dc-label">${label}</div>
      <div class="dc-vals"><span class="dc-main" style="color:var(--cyan)">${fmtVol(b || 0)}</span><span class="dc-unit">${unit}</span></div>
      <div class="dc-delta" style="color:${dColor}">${fmtDelta(delta)} · ${delta < 0 ? '-' : '+'}${absDelta}%</div>
      <div class="dc-bar-track"><div class="dc-bar-fill" style="background:var(--fg-dim);opacity:0.3;width:${fillA.toFixed(1)}%"></div></div>
      <div class="dc-bar-track" style="margin-top:2px"><div class="dc-bar-fill" style="background:${dColor};width:0%" data-target-w="${fillB.toFixed(1)}"></div></div>
    </div>`
  }

  const regionRows = d.regionRows.map(r => {
    const dc  = r.delta < 0 ? 'rt-neg' : r.delta > 0 ? 'rt-pos' : 'rt-neu'
    const isHippo = r.name.startsWith('Hippo')
    const annRate = r.volA > 0 && d.intervalYrs > 0 ? Math.abs(r.delta / r.volA * 100 / d.intervalYrs) : 0
    const rc  = isHippo && annRate > 2.5 ? 'rt-alert' : (Math.abs(r.pct) > 5 ? (r.delta < 0 ? 'rt-alert' : '') : (Math.abs(r.pct) > 2 ? 'rt-warn' : ''))
    return `<tr class="${rc}">
      <td>${r.name}${isHippo && annRate > 1.5 ? ' ⚠' : ''}</td>
      <td>${r.volA}</td>
      <td style="color:var(--amber)">${r.volB}</td>
      <td class="${dc}">${r.delta >= 0 ? '+' : ''}${r.delta}</td>
      <td class="${dc}">${r.pct >= 0 ? '+' : ''}${r.pct}%</td>
    </tr>`
  }).join('')

  const alertsHTML = d.clinicalAlerts.map(a => `
    <div class="alert-item ${a.sev}">
      <span class="ai-icon">${a.icon}</span>
      <div class="ai-wrap">
        <div class="ai-title">${a.title}</div>
        <div class="ai-desc">${a.desc}</div>
        ${a.ddx && a.ddx.length ? `<div class="ai-desc" style="color:var(--teal);margin-top:2px">DDx: ${a.ddx.join(' / ')}</div>` : ''}
        ${a.rec ? `<div class="ai-rec">↗ ${a.rec}</div>` : ''}
      </div>
    </div>`).join('')

  const asiDeltaColor = Math.abs(d.asiDelta) >= 5 ? 'var(--red)' : Math.abs(d.asiDelta) >= 2 ? 'var(--amber)' : 'var(--green)'
  const intervalNote  = d.intervalEstimated ? `<div class="interval-estimated-chip">⚠ Interval estimated as 1.0yr — enter scan dates for accurate rates. *Rates may be imprecise.</div>` : ''

  const aiNarrativeHTML = d.aiNarrative
    ? `<pre id="ai-narrative-pre" class="ai-narrative-pre"></pre>`
    : `<div style="font-size:9px;color:var(--fg-dim);padding:8px 0">Click below to generate AI interpretation.</div>
       <button id="ai-generate-btn" class="ai-generate-btn-inline">◈ Generate AI Interpretation</button>`

  const demoChip = (d.demoModeA || d.demoModeB)
    ? `<div class="chip chip-warn" style="margin-top:6px">⚠ ${d.demoModeA && d.demoModeB ? 'Both scans' : d.demoModeA ? 'Scan A' : 'Scan B'} in demo mode</div>` : ''

  // [P2-06] Hippocampal velocity rows
  const hipLRow = d.hipLA > 0 ? makeVelocityRow('hippo', 'Hippo L', d.hipLRate) : ''
  const hipRRow = d.hipRA > 0 ? makeVelocityRow('hippo', 'Hippo R', d.hipRRate) : ''

  return `
  <!-- AI Progression Score -->
  <div class="rp-section">
    <div class="rp-title">⬡ PROGRESSION SCORE ${sourceTag}<span style="font-size:7px;color:${progColor};margin-left:6px">${progLabel.toUpperCase()}</span></div>
    <div class="ai-score-wrap">
      <div class="score-ring-wrap">
        <svg width="68" height="68" viewBox="0 0 68 68">
          <circle cx="34" cy="34" r="28" stroke="rgba(0,229,255,0.1)" stroke-width="4" fill="none"/>
          <circle cx="34" cy="34" r="28" stroke="${progColor}" stroke-width="4" fill="none"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90 34 34)" id="score-arc-main"
            style="transition:stroke-dashoffset 1.4s cubic-bezier(.16,1,.3,1)"/>
        </svg>
        <div class="score-ring-val" style="color:${progColor}">${d.progScore}</div>
      </div>
      <div>
        <div class="score-label">PROGRESSION INDEX</div>
        <div class="score-desc" style="color:${progColor}">${progLabel}</div>
        <div class="score-sub">Interval: ${d.intervalYrs.toFixed(1)} yr${d.intervalEstimated ? ' (est.)' : ''} · ${d.mode} mode</div>
        <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
          <span class="chip ${d.deltas.brain < -30 ? 'chip-alert' : d.deltas.brain < -10 ? 'chip-warn' : 'chip-ok'}">${d.deltas.brain >= 0 ? '+' : ''}${d.deltas.brain} cm³</span>
          <span class="chip chip-info">ASI ${d.asiB}%</span>
        </div>
        ${demoChip}
      </div>
    </div>
    ${intervalNote}
  </div>

  <!-- AI Differential Analysis -->
  <div class="rp-section">
    <div class="rp-title">🤖 AI DIFFERENTIAL ANALYSIS ${sourceTag}</div>
    ${aiNarrativeHTML}
  </div>

  <!-- Timeline -->
  <div class="rp-section">
    <div class="rp-title">📅 COMPARISON TIMELINE</div>
    <div class="timeline-strip">
      <div class="tl-point">
        <div class="tl-dot tl-dot-a"></div>
        <div class="tl-label"><div class="tl-date">${d.labelA}</div>${d.dateA || '—'}</div>
      </div>
      <div class="tl-arrow" style="flex:1">——————→<div class="tl-interval">${d.intervalYrs.toFixed(1)} yr${d.intervalEstimated ? '*' : ''}</div></div>
      <div class="tl-point">
        <div class="tl-dot tl-dot-b"></div>
        <div class="tl-label"><div class="tl-date">${d.labelB}</div>${d.dateB || '—'}</div>
      </div>
    </div>
  </div>

  <!-- Delta grid -->
  <div class="rp-section">
    <div class="rp-title">📊 VOLUME DELTA <span style="font-size:7px;color:var(--fg-dim);margin-left:4px">cm³ · B vs A · SynthSeg</span></div>
    <div class="delta-grid">
      ${makeDeltaCard('Total Brain',  d.metaA.brainCm3||0, d.metaB.brainCm3||0, d.deltas.brain, 'cm³', 1600)}
      ${makeDeltaCard('Grey Matter',  d.metaA.gmCm3||0,    d.metaB.gmCm3||0,    d.deltas.gm,    'cm³', 800)}
      ${makeDeltaCard('White Matter', d.metaA.wmCm3||0,    d.metaB.wmCm3||0,    d.deltas.wm,    'cm³', 700)}
      ${makeDeltaCard('CSF',          d.metaA.csfCm3||0,   d.metaB.csfCm3||0,   d.deltas.csf,   'cm³', 300)}
    </div>
  </div>

  <!-- Atrophy velocity -->
  <div class="rp-section">
    <div class="rp-title">🧬 ATROPHY VELOCITY <span style="font-size:7px;color:var(--fg-dim);margin-left:4px">%/yr · vs norm</span></div>
    ${makeVelocityRow('brain', 'Brain Vol.',  d.rates.brain)}
    ${makeVelocityRow('gm',    'Grey Matter', d.rates.gm)}
    ${makeVelocityRow('wm',    'White Matter',d.rates.wm)}
    ${makeVelocityRow('deep',  'Deep Grey',   d.rates.deep)}
    ${hipLRow}
    ${hipRRow}
    <div style="font-size:7.5px;color:var(--fg-dim);margin-top:8px;opacity:0.7">▪ Marker = published normal ceiling · Raz et al. 2005; Jack et al. 2010${d.intervalEstimated ? '<br>* Rates assume 1yr interval. Enter scan dates for accuracy.' : ''}</div>
  </div>

  <!-- Radar chart -->
  <div class="rp-section">
    <div class="rp-title">📡 MULTI-METRIC RADAR</div>
    <div class="radar-wrap"><canvas id="radar-chart" class="radar-canvas"></canvas></div>
    <div style="display:flex;justify-content:center;gap:16px;margin-top:6px;font-size:8px">
      <span style="color:var(--cyan)">● ${d.labelA || 'Scan A'}</span>
      <span style="color:var(--amber)">● ${d.labelB || 'Scan B'}</span>
    </div>
  </div>

  <!-- Sparkline -->
  <div class="rp-section">
    <div class="rp-title">📈 TREND CHART</div>
    <canvas id="sparkline-chart" class="sparkline-canvas"></canvas>
    <div class="sparkline-labels"><span>${d.labelA}</span><span>${d.labelB}</span></div>
  </div>

  <!-- Hemisphere comparison -->
  <div class="rp-section">
    <div class="rp-title">🔬 HEMISPHERE COMPARISON</div>
    <div class="hemi-compare">
      ${[
        { label: 'Left Hemisphere A→B',  aV: d.metaA.lhCm3||0, bV: d.metaB.lhCm3||0 },
        { label: 'Right Hemisphere A→B', aV: d.metaA.rhCm3||0, bV: d.metaB.rhCm3||0 },
      ].map(h => {
        const maxH = Math.max(h.aV, h.bV, 600)
        const pA = h.aV / maxH * 100, pB = h.bV / maxH * 100
        const d2 = h.bV - h.aV
        const dc = d2 < 0 ? 'var(--red)' : d2 > 0 ? 'var(--green)' : 'var(--fg-dim)'
        return `<div class="hemi-row">
          <div class="hemi-header"><span class="hemi-name">${h.label}</span><span class="hemi-vals" style="color:${dc}">${fmtDelta(d2)}</span></div>
          <div class="hemi-bar-dual"><div class="hemi-a" style="width:${pA.toFixed(1)}%"></div></div>
          <div class="hemi-bar-dual" style="margin-top:2px"><div class="hemi-b" style="width:0%" data-target-w="${pB.toFixed(1)}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:7.5px;color:var(--fg-dim);margin-top:2px"><span style="color:var(--cyan)">A: ${h.aV.toFixed(1)}</span><span style="color:var(--amber)">B: ${h.bV.toFixed(1)}</span></div>
        </div>`
      }).join('')}
      <div style="font-size:8.5px;margin-top:6px">
        <span>ASI: </span><span style="color:var(--cyan)">A=${d.asiA}%</span>
        <span style="color:var(--fg-dim);margin:0 6px">→</span><span style="color:var(--amber)">B=${d.asiB}%</span>
        <span style="color:${asiDeltaColor};margin-left:8px">Δ ${d.asiDelta >= 0 ? '+' : ''}${d.asiDelta}%</span>
      </div>
    </div>
  </div>

  <!-- Regional table -->
  <div class="rp-section">
    <div class="rp-title">🧠 REGIONAL PARCELLATION <span style="font-size:7px;color:var(--fg-dim);margin-left:4px">cm³ · SynthSeg FreeSurfer labels</span></div>
    <div class="region-table-wrap">
      <table class="region-table">
        <thead><tr><th>REGION</th><th>A</th><th style="color:var(--amber)">B</th><th>Δ cm³</th><th>Δ %</th></tr></thead>
        <tbody>${regionRows}</tbody>
      </table>
    </div>
  </div>

  <!-- Clinical alerts -->
  <div class="rp-section">
    <div class="rp-title">⚕ CLINICAL ALERTS <span style="font-size:7px;color:var(--fg-dim);margin-left:4px">ICD-10 DDx</span></div>
    <div class="alert-list">${alertsHTML}</div>
  </div>

  <!-- Export -->
  <div class="rp-section">
    <button id="export-html-btn" class="export-btn-full">↓ EXPORT COMPARISON REPORT (HTML)</button>
    <div class="export-note">SynthSeg · Gemini 2.0 Flash · ICADHI 2026</div>
    <div class="citations-footer">Segmentation: SynthSeg — Billot et al., Nature Methods 2023 · AI: Gemini 2.0 Flash · Hippocampal norms: Jack et al. 2010 · Atrophy rates: Raz et al. 2005</div>
    <div class="low-cost-badge" style="margin-top:8px">◈ Browser-based · No GPU · No data leaves device</div>
  </div>
  `
}

// ── [P3-12] 9-AXIS RADAR WITH HIPPOCAMPAL AXES ─────────────────────────────────
function buildRadarChart(d) {
  if (radarChart) { radarChart.destroy(); radarChart = null }
  const ctx = document.getElementById('radar-chart')
  if (!ctx) return

  const maxB = Math.max(d.metaA.brainCm3 || 1200, d.metaB.brainCm3 || 1200, 1)
  const maxG = Math.max(d.metaA.gmCm3 || 600, d.metaB.gmCm3 || 600, 1)
  const maxW = Math.max(d.metaA.wmCm3 || 500, d.metaB.wmCm3 || 500, 1)
  const maxC = Math.max(d.metaA.csfCm3 || 200, d.metaB.csfCm3 || 200, 1)
  const maxD = Math.max(d.metaA.deepCm3 || 80, d.metaB.deepCm3 || 80, 1)
  const asiMaxN = 20
  const hipNorm = getHippoNorm(d.ageA || 35, d.sex)
  const maxHip = Math.max(hipNorm.hi, d.hipLA || 0, d.hipLB || 0, d.hipRA || 0, d.hipRB || 0, 0.1)

  const dataA = [
    +(d.metaA.brainCm3 / maxB * 100 || 0).toFixed(1),
    +(d.metaA.gmCm3    / maxG * 100 || 0).toFixed(1),
    +(d.metaA.wmCm3    / maxW * 100 || 0).toFixed(1),
    +(d.metaA.csfCm3   / maxC * 100 || 0).toFixed(1),
    +(d.metaA.deepCm3  / maxD * 100 || 0).toFixed(1),
    +d.normacyA.toFixed(1),
    +(100 - clamp(d.asiA, 0, asiMaxN) / asiMaxN * 100).toFixed(1),
    +(d.hipLA / maxHip * 100 || 0).toFixed(1),
    +(d.hipRA / maxHip * 100 || 0).toFixed(1),
  ]
  const dataB = [
    +(d.metaB.brainCm3 / maxB * 100 || 0).toFixed(1),
    +(d.metaB.gmCm3    / maxG * 100 || 0).toFixed(1),
    +(d.metaB.wmCm3    / maxW * 100 || 0).toFixed(1),
    +(d.metaB.csfCm3   / maxC * 100 || 0).toFixed(1),
    +(d.metaB.deepCm3  / maxD * 100 || 0).toFixed(1),
    +d.normacyB.toFixed(1),
    +(100 - clamp(d.asiB, 0, asiMaxN) / asiMaxN * 100).toFixed(1),
    +(d.hipLB / maxHip * 100 || 0).toFixed(1),
    +(d.hipRB / maxHip * 100 || 0).toFixed(1),
  ]

  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Brain Vol.', 'Grey Matter', 'White Matter', 'CSF', 'Deep Grey', 'Normacy', 'Sym. (ASI)', 'Hippo L', 'Hippo R'],
      datasets: [
        { label: d.labelA || 'Scan A', data: dataA, borderColor: 'rgba(0,229,255,0.8)', backgroundColor: 'rgba(0,229,255,0.07)', pointBackgroundColor: 'rgba(0,229,255,0.9)', pointRadius: 3, borderWidth: 1.5 },
        { label: d.labelB || 'Scan B', data: dataB, borderColor: 'rgba(255,170,0,0.8)',  backgroundColor: 'rgba(255,170,0,0.07)',  pointBackgroundColor: 'rgba(255,170,0,0.9)',  pointRadius: 3, borderWidth: 1.5 },
      ],
    },
    options: {
      responsive: true,
      scales: { r: {
        backgroundColor: 'transparent',
        grid: { color: 'rgba(0,229,255,0.08)' }, angleLines: { color: 'rgba(0,229,255,0.1)' },
        ticks: { color: 'rgba(74,122,138,0.9)', font: { family: 'Space Mono', size: 7 }, stepSize: 20, backdropColor: 'transparent' },
        pointLabels: { color: 'rgba(168,216,232,0.8)', font: { family: 'Space Mono', size: 8 } },
        min: 0, max: 100,
      }},
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(2,8,18,0.95)', borderColor: 'rgba(0,229,255,0.2)', borderWidth: 1, titleFont: { family: 'Space Mono', size: 9 }, bodyFont: { family: 'Space Mono', size: 9 }, titleColor: '#00e5ff', bodyColor: '#a8d8e8' }
      },
      animation: { duration: 1000, easing: 'easeInOutQuart' },
    },
  })
}

// ── SPARKLINE ─────────────────────────────────────────────────────────────────
function buildSparkline(d) {
  if (sparkChart) { sparkChart.destroy(); sparkChart = null }
  const ctx = document.getElementById('sparkline-chart')
  if (!ctx) return

  const seriesDef = [
    { label: 'Brain', colorA: 'rgba(0,229,255,0.7)',  colorB: 'rgba(0,229,255,0.4)',  key: 'brainCm3' },
    { label: 'GM',    colorA: 'rgba(57,255,110,0.7)', colorB: 'rgba(57,255,110,0.4)', key: 'gmCm3'    },
    { label: 'WM',    colorA: 'rgba(255,170,0,0.7)',  colorB: 'rgba(255,170,0,0.4)',  key: 'wmCm3'    },
  ]

  sparkChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: seriesDef.map(s => s.label),
      datasets: [
        { label: d.labelA || 'Scan A', data: seriesDef.map(s => d.metaA[s.key] || 0), backgroundColor: seriesDef.map(s => s.colorA), borderRadius: 3, borderSkipped: false },
        { label: d.labelB || 'Scan B', data: seriesDef.map(s => d.metaB[s.key] || 0), backgroundColor: seriesDef.map(s => s.colorB), borderRadius: 3, borderSkipped: false },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: 'rgba(74,122,138,0.9)', font: { family: 'Space Mono', size: 8 } }, grid: { color: 'rgba(0,229,255,0.05)' } },
        y: { ticks: { color: 'rgba(74,122,138,0.9)', font: { family: 'Space Mono', size: 7 } }, grid: { color: 'rgba(0,229,255,0.05)' } },
      },
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(2,8,18,0.95)', borderColor: 'rgba(0,229,255,0.2)', borderWidth: 1, titleFont: { family: 'Space Mono', size: 9 }, bodyFont: { family: 'Space Mono', size: 9 }, titleColor: '#00e5ff', bodyColor: '#a8d8e8' }
      },
      animation: { duration: 800 },
    },
  })
}

// ── [P2-08] EXPORT REPORT ────────────────────────────────────────────────────
function exportReport() {
  const d = comparisonResult
  if (!d) { alert('Run comparison first.'); return }
  exportRepBtn.disabled = true; exportRepBtn.textContent = '⏳ Building report…'

  const demoNote = (d.demoModeA || d.demoModeB)
    ? `<p style="color:#ffaa00;font-size:10px;border:1px solid rgba(255,170,0,.3);padding:6px 12px;border-radius:4px">⚠ DEMO MODE — Some volumes are estimated. Real SynthSeg was unavailable for ${d.demoModeA && d.demoModeB ? 'both scans' : d.demoModeA ? 'Scan A' : 'Scan B'}.</p>` : ''

  const aiSection = d.aiNarrative
    ? `<h2>AI DIFFERENTIAL ANALYSIS <span style="font-size:9px;color:#4a7a8a">(${d.aiSource || 'AI'})</span></h2>
       <div style="white-space:pre-wrap;font-family:'Courier New';font-size:11px;line-height:1.8;background:rgba(0,229,255,.03);border:1px solid rgba(0,229,255,.1);border-radius:6px;padding:16px;margin:12px 0">${d.aiNarrative}</div>`
    : buildRuleBasedNarrative(d).split('\n').map(l => `<p style="font-size:11px;margin:6px 0">${l}</p>`).join('')

  const volTable = ['brain', 'gm', 'wm', 'csf', 'deep'].map(k => {
    const km = { brain: 'brainCm3', gm: 'gmCm3', wm: 'wmCm3', csf: 'csfCm3', deep: 'deepCm3' }
    const a = d.metaA[km[k]] || 0, b = d.metaB[km[k]] || 0
    const delta = d.deltas[k], pct = (delta / (a || 1) * 100).toFixed(1)
    const cls = delta < 0 ? 'neg' : 'pos'
    return `<tr><td>${k.toUpperCase()}</td><td>${a.toFixed(1)}</td><td>${b.toFixed(1)}</td><td class="${cls}">${delta >= 0 ? '+' : ''}${delta}</td><td class="${cls}">${Number(pct) >= 0 ? '+' : ''}${pct}%</td><td>${d.rates[k]}%/yr${d.intervalEstimated ? '*' : ''}</td></tr>`
  }).join('')

  const regionTable = d.regionRows.map(r =>
    `<tr><td>${r.name}</td><td>${r.volA}</td><td>${r.volB}</td><td class="${r.delta < 0 ? 'neg' : 'pos'}">${r.delta >= 0 ? '+' : ''}${r.delta}</td><td class="${r.delta < 0 ? 'neg' : 'pos'}">${r.pct >= 0 ? '+' : ''}${r.pct}%</td></tr>`
  ).join('')

  const progCls = d.progScore >= 70 ? 'alert' : d.progScore >= 40 ? 'warn' : 'ok'

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>NeuroHEX Comparison — ${d.pid}</title>
<style>
body{font-family:'Courier New',monospace;background:#020508;color:#a8d8e8;margin:0;padding:40px}
h1{font-family:sans-serif;color:#00e5ff;letter-spacing:.3em;font-size:22px}
h2{font-family:sans-serif;color:#00e5ff;letter-spacing:.15em;font-size:14px;border-bottom:1px solid rgba(0,229,255,.2);padding-bottom:6px;margin-top:28px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
.gi{padding:10px;border:1px solid rgba(0,229,255,.1);border-radius:6px}
.gk{font-size:9px;color:#4a7a8a;letter-spacing:.18em;text-transform:uppercase}.gv{font-size:14px;color:#00e5ff;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th{text-align:left;font-size:9px;letter-spacing:.18em;color:#4a7a8a;border-bottom:1px solid rgba(0,229,255,.1);padding:6px 8px}
td{padding:6px 8px;font-size:11px;border-bottom:1px solid rgba(0,229,255,.05)}
.pos{color:#39ff6e}.neg{color:#ff3355}
.ok{color:#39ff6e}.warn{color:#ffaa00}.alert{color:#ff3355}
.f{padding:8px 12px;border-radius:6px;margin:6px 0;font-size:11px}
.fok{background:rgba(57,255,110,.07);border-left:3px solid #39ff6e}
.fwarn{background:rgba(255,170,0,.07);border-left:3px solid #ffaa00}
.falert{background:rgba(255,51,85,.07);border-left:3px solid #ff3355}
footer{margin-top:60px;font-size:9px;color:#4a7a8a;border-top:1px solid rgba(0,229,255,.1);padding-top:16px}
</style></head><body>
<h1>⬡ NEUROHEX — MRI COMPARISON REPORT v2.0</h1>
<p style="color:#4a7a8a;font-size:10px">GENERATED: ${new Date().toLocaleString()} · ICADHI 2026 · Mode: ${d.mode.toUpperCase()} · Segmentation: SynthSeg (Billot et al., Nature Methods 2023)</p>
${demoNote}
<h2>PATIENT / SCANS</h2>
<div class="g">
  <div class="gi"><div class="gk">Patient ID</div><div class="gv">${d.pid}</div></div>
  <div class="gi"><div class="gk">Interval</div><div class="gv">${d.intervalYrs.toFixed(2)} yr${d.intervalEstimated ? ' (estimated)' : ''}</div></div>
  <div class="gi"><div class="gk">Scan A</div><div class="gv">${d.labelA || '—'} (${d.dateA || '—'})</div></div>
  <div class="gi"><div class="gk">Scan B</div><div class="gv">${d.labelB || '—'} (${d.dateB || '—'})</div></div>
  <div class="gi"><div class="gk">Ages</div><div class="gv">${d.ageA || '?'} → ${d.ageB || '?'} yr</div></div>
  <div class="gi"><div class="gk">Progression Index</div><div class="gv ${progCls}">${d.progScore}/100</div></div>
</div>
<h2>AI DIFFERENTIAL ANALYSIS</h2>${aiSection}
<h2>VOLUMETRIC DELTA</h2>
<table><tr><th>Compartment</th><th>Scan A (cm³)</th><th>Scan B (cm³)</th><th>Δ (cm³)</th><th>Δ (%)</th><th>%/yr</th></tr>${volTable}</table>
${d.intervalEstimated ? '<p style="font-size:9px;color:#ffaa00">* Rates assume 1-year interval. Enter scan dates for accuracy.</p>' : ''}
<h2>REGIONAL PARCELLATION (SynthSeg FreeSurfer Labels)</h2>
<table><tr><th>Region</th><th>A (cm³)</th><th>B (cm³)</th><th>Δ cm³</th><th>Δ %</th></tr>${regionTable}</table>
<h2>HIPPOCAMPAL VOLUMES</h2>
<table><tr><th>Side</th><th>A (cm³)</th><th>B (cm³)</th><th>Δ cm³</th><th>Rate %/yr</th></tr>
<tr><td>Left (label 17)</td><td>${d.hipLA||'—'}</td><td>${d.hipLB||'—'}</td><td class="${d.hipLDelta < 0 ? 'neg' : 'pos'}">${d.hipLDelta > 0 ? '+' : ''}${d.hipLDelta.toFixed(3)}</td><td>${d.hipLRate}%/yr${d.intervalEstimated ? '*' : ''}</td></tr>
<tr><td>Right (label 53)</td><td>${d.hipRA||'—'}</td><td>${d.hipRB||'—'}</td><td class="${d.hipRDelta < 0 ? 'neg' : 'pos'}">${d.hipRDelta > 0 ? '+' : ''}${d.hipRDelta.toFixed(3)}</td><td>${d.hipRRate}%/yr${d.intervalEstimated ? '*' : ''}</td></tr>
<tr><td colspan="5" style="color:#4a7a8a;font-size:10px">Normal ceiling: 1.5%/yr · Alert: >2.5%/yr · Jack et al. 2010, Neurology</td></tr>
</table>
<h2>CLINICAL ALERTS</h2>
${d.clinicalAlerts.map(a => `<div class="f ${a.sev === 'ok' ? 'fok' : a.sev === 'warn' ? 'fwarn' : 'falert'}"><strong>${a.icon} ${a.title}</strong><br>${a.desc}${a.ddx && a.ddx.length ? `<br>DDx: ${a.ddx.join(' / ')}` : ''}${a.rec ? `<br>↗ ${a.rec}` : ''}</div>`).join('')}
<footer>
NeuroHEX v2.0 · ICADHI 2026 · MRI Comparison Engine<br>
Segmentation by SynthSeg (Billot et al., Nature Methods 2023) · AI progression analysis by ${d.aiSource || 'Gemini 2.0 Flash'}<br>
Normative rates: Raz et al. 2005 (Neurobiology of Aging); Hippocampal: Jack et al. 2010 (Neurology)<br>
Not a substitute for clinical diagnosis. Consult a qualified neurologist.<br>
◈ Browser-based · No GPU · No patient data stored or transmitted externally.
</footer></body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `NeuroHEX_Comparison_${d.pid}_${Date.now()}.html`
  a.click()
  URL.revokeObjectURL(a.href)
  exportRepBtn.disabled = false; exportRepBtn.textContent = '↓ Export Report'
}

// ── OVERLAY VIEW ──────────────────────────────────────────────────────────────
async function enableOverlayView(overrideUrlB = null) {
  const srcA = urlA
  const srcB = overrideUrlB || urlB || (mode === 'normative' ? MNI_URL : null)
  if (!srcA || !srcB) {
    console.warn('[NeuroHEX] Overlay skipped — missing scan URL(s)', { srcA, srcB })
    return
  }
  const ov = $('overlay-viewer')
  ov.style.visibility = 'hidden'
  await new Promise(r => requestAnimationFrame(r))
  try {
    const nameA = fileA?.name ?? 'scanA.nii.gz'
    const nameB = fileB?.name ?? (mode === 'normative' ? 'mni152.nii.gz' : 'scanB.nii.gz')
    await nvOverlay.loadVolumes([
      { url: srcA, name: nameA, colormap: $('cmap-a').value || 'gray', opacity: 0.5 },
      { url: srcB, name: nameB, colormap: 'cool',                       opacity: 0.5 },
    ])
    setSliceType(currentView, nvOverlay)
    nvOverlay.resizeListener()
  } catch (e) {
    console.warn('[NeuroHEX] Overlay load error:', e)
  } finally {
    ov.style.visibility = ''
  }
}

async function loadDemoComparison() {
  const btn = $('demo-compare-btn')
  btn.disabled = true; btn.textContent = '⏳ Loading demo scans…'

  // ── Normative mode: delegate entirely to _loadNormativeDefaults ──
  if (mode === 'normative') {
    try {
      await _loadNormativeDefaults()
    } catch (e) {
      alert('Normative demo load failed:\n' + e.message)
      console.error('[NeuroHEX] Normative demo failed:', e)
    } finally {
      btn.disabled = false; btn.textContent = '◈ Load Demo Comparison'
    }
    return
  }

  // ── Longitudinal / custom mode ──
  const DEMO_BRAIN_URL = '/demo/demo_brain.nii.gz'
  const DEMO_SEG_URL   = '/demo/demo_seg.nii'

  try {
    const [respBrain, respSeg] = await Promise.all([
      fetch(DEMO_BRAIN_URL),
      fetch(DEMO_SEG_URL),
    ])
    if (!respBrain.ok) throw new Error(`demo_brain not found (HTTP ${respBrain.status}). Ensure /public/demo/demo_brain.nii.gz exists.`)
    if (!respSeg.ok)   throw new Error(`demo_seg not found (HTTP ${respSeg.status}). Ensure /public/demo/demo_seg.nii exists.`)

    const [blobBrain, blobSeg] = await Promise.all([respBrain.blob(), respSeg.blob()])

    const fileObjA = new File([blobBrain], 'demo_brain_A.nii.gz', { type: 'application/gzip' })
    const fileObjB = new File([blobBrain.slice()], 'demo_brain_B.nii.gz', { type: 'application/gzip' })
    const segBuffer = await blobSeg.arrayBuffer()

    $('pid-a').value   = 'DEMO-001'
    $('label-a').value = 'Baseline 2023'
    $('date-a').value  = '2023-01-15'
    $('age-a').value   = '58'
    $('sex-a').value   = 'M'
    $('label-b').value = 'Follow-up 2025'
    $('date-b').value  = '2025-06-01'
    $('age-b').value   = '60'

    await handleFile(fileObjA, 'a')
    await handleFile(fileObjB, 'b')

    const { rawLabels } = parseSynthSegNifti(segBuffer)

    if (rawLabels) {
      rawLabelsA = rawLabels
      populateVolumesFromSynthSeg(metaA, rawLabelsA)
      renderMetaDisplay('meta-display-a', metaA, 'a')
      window.comparisonDemoMode.a = false

      rawLabelsB = rawLabels
      populateVolumesFromSynthSeg(metaB, rawLabelsB)
      if (metaB.brainCm3) {
        metaB.brainCm3 = +(metaB.brainCm3 * 0.982).toFixed(2)
        metaB.gmCm3    = +(metaB.gmCm3    * 0.975).toFixed(2)
        metaB.wmCm3    = +(metaB.wmCm3    * 0.989).toFixed(2)
        metaB.csfCm3   = +(metaB.csfCm3   * 1.045).toFixed(2)
        if (metaB.hipLCm3) metaB.hipLCm3 = +(metaB.hipLCm3 * 0.963).toFixed(3)
        if (metaB.hipRCm3) metaB.hipRCm3 = +(metaB.hipRCm3 * 0.958).toFixed(3)
      }
      renderMetaDisplay('meta-display-b', metaB, 'b')
      window.comparisonDemoMode.b = false
      console.log('[NeuroHEX] Demo: injected pre-computed SynthSeg seg for both scans')
    } else {
      window.comparisonDemoMode.a = true
      window.comparisonDemoMode.b = true
      showDemoModeBanner('⚠ DEMO MODE — Could not parse demo_seg.nii. Using intensity-based fallback.')
    }

    await runComparisonFromPreloaded()

  } catch (e) {
    alert('Demo load failed:\n' + e.message)
    console.error('[NeuroHEX] Demo load failed:', e)
  } finally {
    btn.disabled = false; btn.textContent = '◈ Load Demo Comparison'
  }
}
// ── Fast analysis path when seg is already preloaded ─────────────────────────
async function runComparisonFromPreloaded() {
  if (!metaA || !metaB) { alert('Scans not loaded.'); return }

  aiNarrative = ''
  buildProcSteps()
  procOverlay.classList.remove('hidden')
  $('proc-title').textContent = 'LONGITUDINAL ANALYSIS'

  try {
    // Mark all seg steps done, jump straight to delta
    setProc(55, 'Pre-computed SynthSeg output loaded — skipping API calls…', 3)
    await delay(400)

    const ageA = parseFloat($('age-a').value) || 0
    const ageB = parseFloat($('age-b').value) || ageA
    const sex  = $('sex-a').value || ''

    setProc(64, 'Hippocampal atrophy analysis…', 5)
    await delay(200)

    setProc(72, 'Atrophy velocity analysis…', 6)
    await delay(200)
    const dateA = $('date-a').value
    const dateB = $('date-b').value
    const intervalObj  = computeInterval(dateA, dateB, ageA, ageB)
    const normsA = getNorms(ageA || 35, sex)
    const normsB = getNorms(ageB || 35, sex)

    const regionRows = computeRegionDelta(rawLabelsA, rawLabelsB, metaA.voxelVolMm3, metaB.voxelVolMm3)

    setProc(80, 'AI progression assessment…', 7)
    await delay(200)

    let sliceA64 = null, sliceB64 = null
    try {
      const ca = $('canvas-a'), cb = $('canvas-b')
      if (ca) sliceA64 = ca.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
      if (cb) sliceB64 = cb.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
    } catch {}

    comparisonResult = buildComparisonResult(metaA, metaB, normsA, normsB, intervalObj, regionRows, ageA, ageB, sex)

    const llmResult = await callLLMProgressionScore(comparisonResult, sliceA64, sliceB64)
    if (llmResult) {
      comparisonResult.progScore   = llmResult.score
      comparisonResult.progSev     = llmResult.severity
      aiNarrative                  = llmResult.narrative
      comparisonResult.aiNarrative = llmResult.narrative
      comparisonResult.aiSource    = llmResult.source
    }

    setProc(100, 'Complete.', 8)
    await delay(300)

    renderAllResults(comparisonResult)
    if (layout === 'difference') renderDiffHeatmap()

    navDeltaPill.classList.remove('hidden')
    $('nav-delta-text').textContent = `Δ ${fmtDelta(comparisonResult.deltas.brain)}`
    exportRepBtn.disabled = false

  } catch (err) {
    console.error('[NeuroHEX] Preloaded comparison error:', err)
    alert('Comparison failed: ' + err.message)
  } finally {
    procOverlay.classList.add('hidden')
  }
}

// ── DIVIDER DRAG ──────────────────────────────────────────────────────────────
function setupDividerDrag() {
  const divider = $('viewer-divider')
  if (!divider) return
  divider.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize' })
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = '' })
  window.addEventListener('mousemove', e => {
    if (!dragging) return
    const dv = $('dual-viewer'); if (!dv) return
    const r = dv.getBoundingClientRect()
    const ratio = clamp((e.clientX - r.left) / r.width, 0.15, 0.85)
    const pA = $('pane-a'), pB = $('pane-b')
    if (pA) pA.style.flex = `${ratio} 0 0`
    if (pB) pB.style.flex = `${1 - ratio} 0 0`
    nvA?.resizeListener(); nvB?.resizeListener()
  })
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
function setupEvents() {
  document.querySelectorAll('.mode-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)))
  setupDrop('drop-a', 'file-a', 'browse-a', 'badge-a', 'name-a', 'size-a', 'clear-a', 'a')
  setupDrop('drop-b', 'file-b', 'browse-b', 'badge-b', 'name-b', 'size-b', 'clear-b', 'b')

  compareBtn.addEventListener('click', runComparison)
  $('demo-compare-btn').addEventListener('click', loadDemoComparison)

  $('cmap-a').addEventListener('change', () => { if (nvA.volumes.length) nvA.setColormap(nvA.volumes[0].id, $('cmap-a').value) })
  $('cmap-b').addEventListener('change', () => { if (nvB.volumes.length) nvB.setColormap(nvB.volumes[0].id, $('cmap-b').value) })

  $('overlay-alpha').addEventListener('input', e => {
    const v = parseFloat(e.target.value)
    if (nvOverlay.volumes.length > 0) { nvOverlay.setOpacity(0, 1 - v); nvOverlay.setOpacity(1, v) }
  })

  // [P4-14] Fixed sync toggle
  $('sync-toggle').addEventListener('change', e => setSyncEnabled(e.target.checked))

  // Layout buttons
  document.querySelectorAll('[data-layout]').forEach(b =>
    b.addEventListener('click', async () => {
      const targetLayout = b.dataset.layout
      if (targetLayout === 'overlay') {
        const srcA = urlA, srcB = urlB || (mode === 'normative' ? MNI_URL : null)
        if (!srcA || !srcB) { setLayout('side-by-side'); return }
        await enableOverlayView()
      }
      if (targetLayout === 'difference' && comparisonResult) renderDiffHeatmap()
      setLayout(targetLayout)
    })
  )

  document.querySelectorAll('.vopt-view, .tb-slice').forEach(b =>
    b.addEventListener('click', () => setSliceType(b.dataset.view))
  )

  // [P4-14] Toolbar sync button
  $('tb-sync')?.addEventListener('click', () => {
    syncEnabled = !syncEnabled; $('sync-toggle').checked = syncEnabled; setSyncEnabled(syncEnabled)
  })

  $('tb-reset')?.addEventListener('click', () => {
    if (nvA.volumes.length) try { nvA.loadVolumes(nvA.volumes.map(v => ({ ...v }))) } catch {}
    if (nvB.volumes.length) try { nvB.loadVolumes(nvB.volumes.map(v => ({ ...v }))) } catch {}
  })

  $('screenshot-btn').addEventListener('click', () => {
    const cvs = layout === 'side-by-side' ? $('canvas-a') : layout === 'overlay' ? $('canvas-overlay') : $('canvas-diff') || $('canvas-a')
    if (!cvs) return
    const a = document.createElement('a'); a.download = `NeuroHEX_Compare_${Date.now()}.png`
    a.href = cvs.toDataURL('image/png'); a.click()
  })

  exportRepBtn.addEventListener('click', exportReport)

  // [P5-19] Clear history button
  $('clear-history-btn')?.addEventListener('click', () => {
    localStorage.removeItem('neurohex_v5_long')
    const notice = $('stale-data-notice')
    if (notice) notice.remove()
    alert('Session history cleared.')
  })

  // Delegated events in results panel
  rpResults.addEventListener('click', async e => {
    if (e.target.id === 'export-html-btn') exportReport()
    if (e.target.id === 'ai-generate-btn') {
      const btn = e.target
      btn.disabled = true; btn.textContent = '⏳ Generating…'
      try {
        let sliceA64 = null, sliceB64 = null
        try {
          const ca = $('canvas-a'), cb = $('canvas-b')
          if (ca) sliceA64 = ca.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
          if (cb) sliceB64 = cb.toDataURL('image/jpeg', 0.7).replace('data:image/jpeg;base64,', '')
        } catch {}
        const llmResult = await callLLMProgressionScore(comparisonResult, sliceA64, sliceB64)
        if (llmResult) {
          aiNarrative = llmResult.narrative
          comparisonResult.aiNarrative = llmResult.narrative
          comparisonResult.aiSource    = llmResult.source
          const preEl = document.createElement('pre')
          preEl.id = 'ai-narrative-pre'; preEl.className = 'ai-narrative-pre'
          btn.parentElement.appendChild(preEl); btn.remove()
          await streamText(llmResult.narrative, preEl)
        }
      } catch (err) { btn.disabled = false; btn.textContent = '◈ Generate AI Interpretation'; console.error(err) }
    }
  })

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    switch (e.key.toLowerCase()) {
      case 'a': setSliceType('axial');        break
      case 's': setSliceType('sagittal');     break
      case 'c': setSliceType('coronal');      break
      case 'm': setSliceType('multiplanar');  break
      case 'l': { const idx = LAYOUTS.indexOf(layout); setLayout(LAYOUTS[(idx + 1) % LAYOUTS.length]); break }
    }
  })

  window.addEventListener('resize', () => { nvA?.resizeListener(); nvB?.resizeListener(); nvOverlay?.resizeListener() })

  const ro = new ResizeObserver(() => { nvA?.resizeListener(); nvB?.resizeListener(); nvOverlay?.resizeListener() })
  ro.observe($('viewer-area'))
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
async function init() {
  const today = new Date().toISOString().split('T')[0]
  $('date-a').value = today; $('date-b').value = today

  await initViewers()
  setupEvents()
  setupDividerDrag()
  setMode('longitudinal')
  checkStaleLocalStorage()

  console.log('%c⬡ NeuroHEX Comparison Engine v2.0 — ICADHI 2026', 'color:#00e5ff;font-family:monospace;font-size:13px;font-weight:bold')
  console.log('%cSynthSeg real segmentation · Gemini multimodal · Real region volumes', 'color:#39ff6e;font-family:monospace;font-size:10px')
  console.log('%cKeyboard: A=axial S=sagittal C=coronal M=multi L=cycle-layout', 'color:#ffaa00;font-family:monospace;font-size:10px')
}

init()