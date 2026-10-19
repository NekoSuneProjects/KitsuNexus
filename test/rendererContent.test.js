'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { escapeHtml, safeHttpUrl, safeImageUrl, releaseNotesHtml } = require('../modules/security/rendererContent')

test('escapes text as well as double/single quoted HTML attributes', () => {
  assert.equal(escapeHtml('A & <img src=x onerror="boom">'), 'A &amp; &lt;img src=x onerror=&quot;boom&quot;&gt;')
  assert.equal(escapeHtml(`' onfocus='alert(1)`), '&#39; onfocus=&#39;alert(1)')
})

test('allows HTTP images and links but rejects script and file URLs', () => {
  assert.equal(safeHttpUrl('https://example.com/a?b=1&c=2'), 'https://example.com/a?b=1&c=2')
  assert.equal(safeHttpUrl('https://user:secret@example.com/'), '')
  assert.equal(safeHttpUrl('javascript:alert(1)'), '')
  assert.equal(safeImageUrl('data:text/html,<script>bad()</script>'), 'assets/logo.png')
  assert.equal(safeImageUrl('https://images.example/avatar.png'), 'https://images.example/avatar.png')
  assert.equal(safeImageUrl('assets/vrchat.png'), 'assets/vrchat.png')
})

test('release notes cannot inject attributes or JavaScript URLs', () => {
  const rendered = releaseNotesHtml('**Fixed** [safe](https://example.com/?q=" onmouseover="alert(1)) [bad](javascript:alert(1)) <img src=x onerror=alert(1)>')
  assert.match(rendered, /<b>Fixed<\/b>/)
  assert.match(rendered, /data-ext="https:\/\/example\.com\//)
  assert.doesNotMatch(rendered, / onmouseover="|<img|data-ext="javascript:/)
  assert.match(rendered, /&lt;img/)
})
