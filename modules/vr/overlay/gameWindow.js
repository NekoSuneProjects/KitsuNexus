'use strict'
// Win32 window inspection and explicit focus return; no game hooks or process memory access.
function createReader () {
  const ffi = require('koffi')
  const user = ffi.load('user32.dll')
  const kernel = ffi.load('kernel32.dll')
  const foreground = user.func('void * __stdcall GetForegroundWindow()')
  const pidOf = user.func('uint32_t __stdcall GetWindowThreadProcessId(void *, _Out_ uint32_t *)')
  const iconic = user.func('int __stdcall IsIconic(void *)')
  const visible = user.func('int __stdcall IsWindowVisible(void *)')
  const rect = user.func('int __stdcall GetClientRect(void *, void *)')
  const origin = user.func('int __stdcall ClientToScreen(void *, void *)')
  const open = kernel.func('void * __stdcall OpenProcess(uint32_t, int, uint32_t)')
  const query = kernel.func('int __stdcall QueryFullProcessImageNameW(void *, uint32_t, void *, _Inout_ uint32_t *)')
  const close = kernel.func('int __stdcall CloseHandle(void *)')
  const focus = user.func('int __stdcall SetForegroundWindow(void *)')
  const valid = user.func('int __stdcall IsWindow(void *)')
  const find = user.func('void * __stdcall FindWindowW(void *, str16)')
  let game = null
  const reader = (handles, explicitOpen = false) => {
    const focused = explicitOpen ? (game && valid(game) ? game : find(null, 'VRChat')) : foreground()
    if (!focused) return null
    const owned = handles.some(h => BigInt(h) === ffi.address(focused))
    if (!owned) {
      const pid = [0]; pidOf(focused, pid)
      const processHandle = open(0x1000, 0, pid[0])
      if (!processHandle) return null
      const text = Buffer.alloc(65536); const size = [32768]
      let name = ''
      try { if (query(processHandle, 0, text, size)) name = text.toString('utf16le', 0, size[0] * 2) } finally { close(processHandle) }
      if (!/[\\/]VRChat\.exe$/i.test(name)) return null
      game = focused
    }
    if (!game || iconic(game) || !visible(game)) return null
    const bounds = Buffer.alloc(16); const point = Buffer.alloc(8)
    if (!rect(game, bounds) || !origin(game, point)) return null
    const width = bounds.readInt32LE(8); const height = bounds.readInt32LE(12)
    if (width < 280 || height < 280) return null
    return { x: point.readInt32LE(0), y: point.readInt32LE(4), width, height }
  }
  reader.focusGame = () => !!(game && !iconic(game) && visible(game) && focus(game))
  return reader
}
module.exports = { createReader }
