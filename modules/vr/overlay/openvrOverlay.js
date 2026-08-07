'use strict'

// VR overlay (experimental) - mirrors the app's main window into a SteamVR
// overlay panel so it can be seen/used without tabbing out to desktop.
// Windows + SteamVR only. Runs in the MAIN process.
//
// Talks to OpenVR via koffi (FFI), not a compiled native addon - there is no
// pure-JS way to call a C++ SDK, and koffi needs no build step (lower risk
// than node-gyp, same reasoning as avoiding node-global-key-listener earlier
// in this project's history). The function signatures/struct layout below
// are transcribed directly from Valve's own openvr_capi.h (the official
// C-compatible API surface OpenVR ships specifically for FFI bindings from
// other languages) - not guessed.
//
// VERIFIED LIVE on this dev machine (no headset attached): DLL loads, the
// core VR_InitInternal/VR_GetGenericInterface/error-lookup calls all behave
// exactly as expected, and initializing as VRApplication_Overlay correctly
// fails with "Hmd Not Found" when no headset is detected (confirmed against
// a real, running SteamVR instance). NOT verified: any actual IVROverlay
// method call (CreateOverlay, ShowOverlay, SetOverlayFromFile, etc.) - that
// requires a physically connected, powered-on headset, which this
// environment doesn't have. If something in the overlay-specific calls is
// wrong, expect to debug it together against a real headset.

// koffi is loaded LAZILY (see getKoffi below), never at require-time. Merely
// requiring koffi immediately LoadLibrary's its native koffi.node addon, and
// this module is required at startup by main.js via vrOverlayController - so
// a top-level require meant every user did a native addon load on every
// launch just to have the VR Overlay *available*, even with no headset and
// no SteamVR. If that native load faults (corrupted/AV-quarantined .node,
// ABI mismatch, missing from asarUnpack) it takes the whole app down before
// any window exists, with a bare Windows "0xc0000005" access-violation
// dialog and no JS stack. Deferring it means a broken koffi can only ever
// break the VR Overlay feature itself, which already degrades gracefully.
// Same lazy pattern already used for ffmpeg-static and vrnotications.
const fs = require('fs')
const path = require('path')

let koffi = null
function getKoffi () {
  if (!koffi) koffi = require('koffi')
  return koffi
}

const EVRApplicationType = { Overlay: 2 }

function findOpenVrDll () {
  const candidates = []
  // Steam's own install path, from the registry (32-bit Steam is still what
  // registers this key even on 64-bit Windows).
  try {
    const { execFileSync } = require('child_process')
    const out = execFileSync('reg', ['query', 'HKEY_CURRENT_USER\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' })
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (m) candidates.push(path.join(m[1].trim(), 'steamapps', 'common', 'SteamVR', 'bin', 'win64', 'openvr_api.dll'))
  } catch (_) {}
  candidates.push(
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll',
    'C:\\Program Files\\Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll'
  )
  return candidates.find(p => { try { return fs.existsSync(p) } catch (_) { return false } }) || null
}

let lib = null
let fn = {}
let overlayTable = null
let overlayHandle = null
let vrInitialized = false

function loadLibrary () {
  if (lib) return lib
  const dllPath = findOpenVrDll()
  if (!dllPath) throw new Error('SteamVR is not installed (openvr_api.dll not found)')
  lib = getKoffi().load(dllPath)

  fn.VR_InitInternal = lib.func('intptr_t VR_InitInternal(_Out_ int *peError, int eApplicationType)')
  fn.VR_ShutdownInternal = lib.func('void VR_ShutdownInternal()')
  fn.VR_IsHmdPresent = lib.func('bool VR_IsHmdPresent()')
  fn.VR_IsRuntimeInstalled = lib.func('bool VR_IsRuntimeInstalled()')
  fn.VR_GetVRInitErrorAsEnglishDescription = lib.func('const char *VR_GetVRInitErrorAsEnglishDescription(int)')
  fn.VR_GetGenericInterface = lib.func('intptr_t VR_GetGenericInterface(const char *pchInterfaceVersion, _Out_ int *peError)')

  return lib
}

// The struct below mirrors VR_IVROverlay_FnTable from openvr_capi.h field
// for field, in the exact declared order (offsets have to match exactly for
// the fields after the ones we actually call to be irrelevant - every field
// is pointer-sized regardless of the function it points to, so only the
// COUNT and ORDER up to our target methods matters, not the individual
// signatures of the ones we skip). Only the handful we actually call
// (CreateOverlay, DestroyOverlay, ShowOverlay, HideOverlay,
// SetOverlayWidthInMeters, SetOverlayTransformAbsolute, SetOverlayFromFile)
// get a real typed callback prototype; everything else is an opaque pointer.
function buildOverlayStructDef () {
  const koffi = getKoffi()
  const p = 'void *' // opaque function pointer placeholder for methods we never call
  return {
    FindOverlay: p,
    CreateOverlay: koffi.pointer(koffi.proto('int __stdcall CreateOverlayFn(const char *pchOverlayKey, const char *pchOverlayName, _Out_ uint64_t *pOverlayHandle)')),
    DestroyOverlay: koffi.pointer(koffi.proto('int __stdcall DestroyOverlayFn(uint64_t ulOverlayHandle)')),
    GetOverlayKey: p,
    GetOverlayName: p,
    SetOverlayName: p,
    GetOverlayImageData: p,
    GetOverlayErrorNameFromEnum: p,
    SetOverlayRenderingPid: p,
    GetOverlayRenderingPid: p,
    SetOverlayFlag: p,
    GetOverlayFlag: p,
    GetOverlayFlags: p,
    SetOverlayColor: p,
    GetOverlayColor: p,
    SetOverlayAlpha: p,
    GetOverlayAlpha: p,
    SetOverlayTexelAspect: p,
    GetOverlayTexelAspect: p,
    SetOverlaySortOrder: p,
    GetOverlaySortOrder: p,
    SetOverlayWidthInMeters: koffi.pointer(koffi.proto('int __stdcall SetOverlayWidthInMetersFn(uint64_t ulOverlayHandle, float fWidthInMeters)')),
    GetOverlayWidthInMeters: p,
    SetOverlayCurvature: p,
    GetOverlayCurvature: p,
    SetOverlayPreCurvePitch: p,
    GetOverlayPreCurvePitch: p,
    SetOverlayTextureColorSpace: p,
    GetOverlayTextureColorSpace: p,
    SetOverlayTextureBounds: p,
    GetOverlayTextureBounds: p,
    GetOverlayTransformType: p,
    SetOverlayTransformAbsolute: koffi.pointer(koffi.proto('int __stdcall SetOverlayTransformAbsoluteFn(uint64_t ulOverlayHandle, int eTrackingOrigin, _In_ float *pmatTrackingOriginToOverlayTransform)')),
    GetOverlayTransformAbsolute: p,
    SetOverlayTransformTrackedDeviceRelative: p,
    GetOverlayTransformTrackedDeviceRelative: p,
    SetOverlayTransformTrackedDeviceComponent: p,
    GetOverlayTransformTrackedDeviceComponent: p,
    GetOverlayTransformOverlayRelative: p,
    SetOverlayTransformOverlayRelative: p,
    SetOverlayTransformCursor: p,
    GetOverlayTransformCursor: p,
    SetOverlayTransformProjection: p,
    ShowOverlay: koffi.pointer(koffi.proto('int __stdcall ShowOverlayFn(uint64_t ulOverlayHandle)')),
    HideOverlay: koffi.pointer(koffi.proto('int __stdcall HideOverlayFn(uint64_t ulOverlayHandle)')),
    IsOverlayVisible: p,
    GetTransformForOverlayCoordinates: p,
    WaitFrameSync: p,
    PollNextOverlayEvent: p,
    GetOverlayInputMethod: p,
    SetOverlayInputMethod: p,
    GetOverlayMouseScale: p,
    SetOverlayMouseScale: p,
    ComputeOverlayIntersection: p,
    IsHoverTargetOverlay: p,
    SetOverlayIntersectionMask: p,
    TriggerLaserMouseHapticVibration: p,
    SetOverlayCursor: p,
    SetOverlayCursorPositionOverride: p,
    ClearOverlayCursorPositionOverride: p,
    SetOverlayTexture: p,
    ClearOverlayTexture: p,
    SetOverlayRaw: p,
    SetOverlayFromFile: koffi.pointer(koffi.proto('int __stdcall SetOverlayFromFileFn(uint64_t ulOverlayHandle, const char *pchFilePath)'))
    // Fields after SetOverlayFromFile in the real struct are omitted - safe
    // because nothing here reads past this point, so their absence doesn't
    // shift any offset we actually rely on.
  }
}

function ensureInit () {
  loadLibrary()
  if (vrInitialized) return
  const errPtr = [0]
  const handle = fn.VR_InitInternal(errPtr, EVRApplicationType.Overlay)
  if (!handle) {
    const desc = fn.VR_GetVRInitErrorAsEnglishDescription(errPtr[0])
    throw new Error(`Could not start the VR overlay (${desc || `error ${errPtr[0]}`}). Make sure SteamVR is running and your headset is connected and powered on.`)
  }
  vrInitialized = true
}

function getOverlayTable () {
  if (overlayTable) return overlayTable
  const errPtr = [0]
  const ptr = fn.VR_GetGenericInterface('IVROverlay_026', errPtr)
  if (!ptr) throw new Error(`Could not get the SteamVR overlay interface (error ${errPtr[0]})`)
  const structDef = buildOverlayStructDef()
  const koffi = getKoffi()
  const StructType = koffi.struct('VR_IVROverlay_FnTable', structDef)
  const PtrType = koffi.pointer(StructType)
  overlayTable = koffi.decode(ptr, PtrType, '*')
  return overlayTable
}

function identityMatrixAt (x, y, z) {
  // HmdMatrix34_t: float m[3][4], row-major - rotation (identity here) in
  // the first 3 columns, translation in the 4th.
  return new Float32Array([
    1, 0, 0, x,
    0, 1, 0, y,
    0, 0, 1, z
  ])
}

async function start ({ overlayKey = 'nekosuneapps.mirror', overlayName = 'NekoSuneAPPS', widthMeters = 1.4 } = {}) {
  ensureInit()
  const table = getOverlayTable()

  if (!overlayHandle) {
    const handlePtr = [0n]
    const err = table.CreateOverlay(overlayKey, overlayName, handlePtr)
    if (err) throw new Error(`Could not create the VR overlay (error ${err})`)
    overlayHandle = handlePtr[0]
  }

  table.SetOverlayWidthInMeters(overlayHandle, widthMeters)
  // 1.5m in front of, roughly eye height, in the standing tracking space.
  table.SetOverlayTransformAbsolute(overlayHandle, 1, identityMatrixAt(0, 1.2, -1.5))
  table.ShowOverlay(overlayHandle)
}

function updateFrame (pngFilePath) {
  if (!overlayHandle) return
  const table = getOverlayTable()
  table.SetOverlayFromFile(overlayHandle, pngFilePath)
}

function stop () {
  try {
    if (overlayHandle && overlayTable) overlayTable.HideOverlay(overlayHandle)
    if (overlayHandle && overlayTable) overlayTable.DestroyOverlay(overlayHandle)
  } catch (_) {}
  overlayHandle = null
  if (vrInitialized) {
    try { fn.VR_ShutdownInternal() } catch (_) {}
    vrInitialized = false
  }
}

function isAvailable () {
  try {
    loadLibrary()
    return fn.VR_IsRuntimeInstalled()
  } catch (_) {
    return false
  }
}

module.exports = { start, stop, updateFrame, isAvailable, findOpenVrDll }
