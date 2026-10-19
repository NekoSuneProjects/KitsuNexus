'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { seasonalTheme } = require('../modules/ui/seasonalTheme')

test('Halloween starts on October 1 and stays active through October 31 in local time', () => {
  const boundaries = [
    [new Date(2026, 8, 30, 23, 59, 59), false],
    [new Date(2026, 9, 1, 0, 0, 0), true],
    [new Date(2026, 9, 19, 14, 30, 0), true],
    [new Date(2026, 9, 31, 23, 59, 59), true],
    [new Date(2026, 10, 1, 0, 0, 0), false]
  ]
  for (const [when, active] of boundaries) {
    const season = seasonalTheme(when)
    assert.equal(season.theme === 'halloween', active, when.toString())
    assert.equal(season.isEvent, active, when.toString())
  }
  assert.match(seasonalTheme(new Date(2026, 9, 1)).label, /October 1–31/)
})

test('other annual events retain their own windows', () => {
  assert.equal(seasonalTheme(new Date(2026, 5, 15)).theme, 'rainbow')
  assert.equal(seasonalTheme(new Date(2026, 11, 15)).theme, 'xmas')
  assert.equal(seasonalTheme(new Date(2026, 1, 15)).theme, 'blackgreen')
})
