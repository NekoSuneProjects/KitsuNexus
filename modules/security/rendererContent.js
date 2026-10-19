'use strict'

// Remote VRChat profiles, avatar providers and GitHub release notes are not
// trusted markup. These helpers are shared by the Node-enabled renderer.
function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHttpUrl (value) {
  try {
    const url = new URL(String(value || ''))
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username && !url.password ? url.href : ''
  } catch (_) { return '' }
}

function safeImageUrl (value) {
  const input = String(value || '')
  // Application-bundled placeholder, never a user-defined relative URL.
  return (input === 'assets/logo.png' || input === 'assets/vrchat.png') ? input : (safeHttpUrl(input) || 'assets/logo.png')
}

function releaseNotesHtml (markdown) {
  const inline = raw => escapeHtml(raw)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:4px">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, escapedUrl) => {
      // Check the raw Markdown link before ever creating an HTML attribute.
      // HTML entity encoding is undone by the DOM when data-ext is read.
      const url = safeHttpUrl(escapedUrl.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
      return url ? `<a href="#" data-ext="${escapeHtml(url)}" style="color:var(--accent,#7c5cff)">${label}</a>` : label
    })
  return String(markdown || '').split(/\r?\n/).map(raw => {
    const line = raw.trim()
    if (!line) return ''
    let m = line.match(/^#{1,6}\s+(.*)$/)
    if (m) return `<div style="font-weight:700;margin:10px 0 2px">${inline(m[1])}</div>`
    m = line.match(/^[-*]\s+(.*)$/)
    if (m) return `<div style="margin-left:6px">• ${inline(m[1])}</div>`
    if (/^---+$/.test(line)) return '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">'
    return `<div>${inline(line)}</div>`
  }).join('')
}

module.exports = { escapeHtml, safeHttpUrl, safeImageUrl, releaseNotesHtml }
