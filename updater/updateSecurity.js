'use strict'

const path = require('path')

const OFFICIAL_RELEASE_PATH = /^\/NekoSuneProjects\/KitsuNexus\/releases\/download\/[^/]+\/[^/]+$/i
const REDIRECT_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'])

// cmd.exe expands percent variables even inside quoted paths. Disallow shell
// metacharacters in paths passed to `cmd /c start` before launching an installer.
function validateWindowsCommandArgument (value) {
  const arg = String(value)
  if (/["\r\n%!^&|<>]/.test(arg)) throw new Error('Installer path contains unsupported Windows command characters')
  return arg
}

function validateUpdateUrl (value, redirect = false) {
  let parsed
  try { parsed = new URL(value) } catch (_) { throw new Error('Invalid update URL') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error('Update URL must use HTTPS without credentials or a custom port')
  }
  if (parsed.hostname === 'github.com' && OFFICIAL_RELEASE_PATH.test(parsed.pathname)) return parsed.href
  if (redirect && REDIRECT_HOSTS.has(parsed.hostname)) return parsed.href
  throw new Error('Update URL is not an official KitsuNexus release download')
}

function validateUpdateName (value, platform = process.platform) {
  const name = String(value || '')
  if (!name || name.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name) || name.includes('..') || path.basename(name) !== name) {
    throw new Error('Invalid update asset filename')
  }
  const extension = path.extname(name).toLowerCase()
  const allowed = platform === 'win32' ? ['.exe', '.zip', '.msi']
    : platform === 'darwin' ? ['.zip']
      : platform === 'linux' ? ['.appimage', '.deb'] : []
  if (!allowed.includes(extension)) throw new Error('Unsupported update installer type')
  return name
}

function validateUpdateDigest (value) {
  if (value == null || value === '') return ''
  if (!/^sha256:[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid SHA-256 release asset digest')
  return value.slice(7).toLowerCase()
}

module.exports = { validateUpdateUrl, validateUpdateName, validateUpdateDigest, validateWindowsCommandArgument }
