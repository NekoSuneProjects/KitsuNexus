const express = require('express')
const { User, OverlayStatus } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')
const { generateOverlayId } = require('../auth/deviceToken')
const config = require('../config')

const router = express.Router()

// Stale after this long with no push — the app isn't necessarily running, so the overlay
// should go back to its "empty" state instead of showing a song that stopped an hour ago.
const STALE_MS = 30_000

const overlayStyles = ['default', 'bash', 'discord', 'macos', 'windows', 'soundcloud', 'youtube']
const boxBackgrounds = ['solid', 'thin', 'hidden']

async function ensureOverlayId (userId) {
  const user = await User.findByPk(userId)
  if (!user) return null
  if (!user.overlayId) { user.overlayId = generateOverlayId(); await user.save() }
  return user.overlayId
}

// Paired device asking for its account's overlay URL — creates the overlayId on first call for
// any account old enough to predate this feature (db/index.js's backfill also covers this, but
// this is instant rather than waiting for the next server restart).
router.get('/api/overlay/mine', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  const overlayId = await ensureOverlayId(req.userId)
  if (!overlayId) return res.status(404).json({ ok: false, error: 'Account not found' })
  res.json({ ok: true, overlayId, url: `${config.siteUrl}/overlay/${overlayId}` })
}))

// Push the current "now playing" snapshot — same shape the old local overlay server's
// mediaProvider() produced (title/artist/album/image/status/progressMs/durationMs/source/...).
// Last-write-wins per user, so it doesn't matter which of a user's paired devices is pushing.
router.post('/api/overlay/push', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  const payload = JSON.stringify(req.body || {})
  const [status] = await OverlayStatus.findOrCreate({ where: { userId: req.userId }, defaults: { userId: req.userId, payload } })
  if (status.payload !== payload) await status.update({ payload })
  res.json({ ok: true, serverTime: Date.now() })
}))

// Public — no auth. This is the whole point: a URL you can hand to OBS (or anyone) without
// exposing the account itself, gated only by the overlayId being unguessable.
router.get('/api/overlay/:overlayId/now-playing', asyncHandler(async (req, res) => {
  const user = await User.findOne({ where: { overlayId: req.params.overlayId } })
  if (!user) return res.status(404).json({ found: false, error: 'Unknown overlay id' })
  const status = await OverlayStatus.findOne({ where: { userId: user.id } })
  if (!status || (Date.now() - +status.updatedAt) > STALE_MS) {
    return res.json({ found: false, serverTime: Date.now() })
  }
  let media
  try { media = JSON.parse(status.payload) } catch (_) { media = {} }
  res.setHeader('Cache-Control', 'no-store')
  res.json({ ...media, serverTime: Date.now() })
}))

router.get('/overlay/:overlayId', asyncHandler(async (req, res) => {
  const user = await User.findOne({ where: { overlayId: req.params.overlayId } })
  if (!user) return res.status(404).send('Unknown overlay — check the URL from Settings ▸ Cloud Sync.')
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').send(createOverlayHtml(req.params.overlayId))
}))

function createOverlayHtml (overlayId) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KitsuNexus Now Playing Overlay</title>
  <style>
    :root {
      --accent: #ff007f;
      --bg: rgba(15, 23, 42, 0.82);
      --panel: rgba(15, 23, 42, 0.94);
      --text: #f8fafc;
      --muted: #cbd5e1;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; background: transparent; overflow: hidden; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { color: var(--text); }
    a { color: inherit; text-decoration: none; }
    #overlay-root { width: 100vw; min-height: 100vh; display: grid; place-items: center; padding: 18px; }
    #overlay-root.empty { display: none; }
    .player { width: min(720px, 100vw - 36px); color: var(--text); }
    .art { width: 74px; height: 74px; object-fit: cover; flex: 0 0 auto; background: #1f2937; display: grid; place-items: center; color: #94a3b8; font-weight: 800; }
    .fallback-art { font-size: 26px; }
    .content { min-width: 0; flex: 1; }
    .song, .artist, .album { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .song { font-weight: 800; font-size: 20px; line-height: 1.15; }
    .artist { color: var(--muted); margin-top: 4px; font-size: 14px; }
    .album { color: #94a3b8; margin-top: 2px; font-size: 12px; }
    .status { margin-top: 8px; color: #e2e8f0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
    .progress-wrap { margin-top: 10px; max-width: 360px; }
    .progress-bar { height: 6px; background: rgba(148, 163, 184, 0.28); overflow: hidden; border-radius: 999px; }
    .progress { height: 100%; width: 0%; background: var(--accent); transition: width 450ms linear; }
    .time { display: flex; justify-content: space-between; margin-top: 5px; color: #cbd5e1; font-size: 12px; }
    .default { position: relative; display: flex; gap: 15px; align-items: center; min-height: 118px; padding: 16px; background: var(--panel); border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; overflow: hidden; box-shadow: 0 14px 36px rgba(0,0,0,0.32); }
    .default::before { content: ""; position: absolute; inset: 0; background: var(--cover) center/cover; filter: blur(24px); opacity: 0.22; transform: scale(1.2); }
    .default > * { position: relative; }
    .default .art { border-radius: 8px; }
    .discord { min-height: 194px; display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; column-gap: 52px; padding: 22px 32px 18px 32px; background: #2f3136; border-left: 5px solid #5865f2; border-radius: 7px; box-shadow: none; }
    .discord .art { width: 64px; height: 64px; border-radius: 50%; margin-top: 10px; }
    .discord .song { font-size: 21px; line-height: 1.1; text-shadow: 0 1px 0 #000; }
    .discord .artist { margin-top: 5px; font-size: 14px; color: #ffffff; }
    .discord .status { margin-top: 8px; color: #ffffff; font-size: 14px; font-weight: 700; text-transform: none; letter-spacing: 0; }
    .discord .progress-wrap { width: 256px; max-width: 100%; margin-top: 10px; }
    .discord .progress-bar { height: 8px; border: 1px solid #cfd4dc; border-radius: 4px; background: rgba(0, 0, 0, 0.24); }
    .discord .progress { background: #5865f2; }
    .discord .time { margin-top: 3px; width: 256px; max-width: 100%; color: #ffffff; font-size: 12px; }
    .discord .links { display: flex; gap: 8px; margin-top: 10px; color: #dce2f7; font-size: 12px; }
    .discord .footer { margin-top: 12px; color: #8a8f98; font-size: 12px; }
    .macos { display: flex; gap: 14px; align-items: center; min-height: 112px; padding: 14px 16px; background: rgba(245,245,247,0.88); color: #111827; border-radius: 16px; backdrop-filter: blur(18px); box-shadow: 0 14px 34px rgba(0,0,0,0.22); }
    .macos .artist, .macos .album, .macos .time { color: #4b5563; }
    .macos .art { border-radius: 13px; }
    .macos .progress { background: #0a84ff; }
    .windows { display: flex; gap: 14px; align-items: center; min-height: 112px; padding: 14px 16px; background: rgba(32, 32, 32, 0.92); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; box-shadow: 0 12px 30px rgba(0,0,0,0.3); }
    .windows .art { border-radius: 2px; }
    .windows .progress { background: #0078d4; }
    .soundcloud { padding: 14px 16px; background: linear-gradient(135deg, rgba(255, 85, 0, 0.96), rgba(255, 136, 0, 0.9)); border-radius: 8px; box-shadow: 0 14px 34px rgba(0,0,0,0.3); }
    .soundcloud .top { display: flex; gap: 14px; align-items: center; }
    .soundcloud .art { border-radius: 4px; width: 74px; height: 74px; }
    .soundcloud .progress { background: #111827; }
    .youtube { background: rgba(15, 15, 15, 0.96); border-radius: 10px; overflow: hidden; box-shadow: 0 18px 48px rgba(0,0,0,0.4); }
    .youtube .thumb { position: relative; height: 210px; background: #111827; }
    .youtube .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .youtube .thumb .fallback-art { width: 100%; height: 100%; display: grid; place-items: center; font-size: 64px; background: #1f2937; }
    .youtube .content { padding: 14px 16px 16px; }
    .youtube .progress-bar { height: 4px; border-radius: 0; background: #3f3f46; }
    .youtube .progress { background: #ff0000; }
    .bash { background: rgba(0, 0, 0, 0.88); border: 1px solid #22c55e; border-radius: 6px; padding: 12px 14px; font-family: Consolas, Monaco, monospace; color: #22c55e; box-shadow: 0 12px 30px rgba(0,0,0,0.32); }
    .bash .line { margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .player.bg-thin { background: rgba(10, 12, 20, 0.32) !important; border-color: rgba(255,255,255,0.10) !important; box-shadow: none !important; backdrop-filter: blur(6px); }
    .player.bg-hidden { background: transparent !important; border: none !important; box-shadow: none !important; backdrop-filter: none !important; }
    .default.bg-thin::before { opacity: 0.12 !important; }
    .default.bg-hidden::before { display: none !important; }
    .player.bg-hidden .song, .player.bg-hidden .artist, .player.bg-hidden .album,
    .player.bg-hidden .status, .player.bg-hidden .time, .player.bg-thin .song {
      text-shadow: 0 1px 3px rgba(0,0,0,0.92), 0 0 2px rgba(0,0,0,0.85);
    }
    @media (max-width: 420px) {
      #overlay-root { padding: 10px; }
      .player { width: calc(100vw - 20px); }
      .song { font-size: 18px; }
      .artist { font-size: 13px; }
      .art { width: 72px; height: 72px; }
      .youtube .thumb { height: 180px; }
    }
  </style>
</head>
<body>
  <main id="overlay-root" class="empty"></main>
  <script>
    const overlayId = ${JSON.stringify(overlayId)};
    const styles = ${JSON.stringify(overlayStyles)};
    const boxBgOptions = ${JSON.stringify(boxBackgrounds)};
    const root = document.getElementById('overlay-root');
    const params = new URLSearchParams(location.search);

    // ?style=<name> and ?bg=solid|thin|hidden — set by the app when it shows you this URL,
    // editable by hand too. No server-side "default style" setting anymore; it's all in the URL.
    function boxBgClass() {
      const v = boxBgOptions.includes(params.get('bg')) ? params.get('bg') : 'solid';
      return (v && v !== 'solid') ? ' bg-' + v : '';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function formatTime(ms) {
      const seconds = Math.max(Math.floor((ms || 0) / 1000), 0);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return minutes + ':' + String(secs).padStart(2, '0');
    }

    function liveProgress(media) {
      const duration = Number(media.durationMs) || 0;
      let progress = Number(media.progressMs) || 0;
      if (media.status === 'Playing' && media.fetchedAt) {
        progress += Date.now() - Number(media.fetchedAt);
      }
      return Math.max(0, Math.min(progress, duration || progress));
    }

    function getStyle(media) {
      const requested = params.get('style');
      if (styles.includes(requested)) return requested;
      return styles.includes(media.overlayStyle) ? media.overlayStyle : 'default';
    }

    function getArt(media) {
      if (media.image) {
        return '<img class="art" src="' + media.image + '" alt="">';
      }
      const letter = escapeHtml((media.title || media.source || '?').slice(0, 1).toUpperCase());
      return '<div class="art fallback-art">' + letter + '</div>';
    }

    function sharedContent(media) {
      const progress = liveProgress(media);
      const duration = Number(media.durationMs) || 0;
      const percent = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;
      return {
        art: getArt(media),
        song: escapeHtml(media.title || 'Unknown title'),
        artist: escapeHtml(media.artist || media.source || 'Unknown artist'),
        album: escapeHtml(media.album || ''),
        status: escapeHtml(media.status || 'Unknown'),
        progress,
        duration,
        percent
      };
    }

    function render(media) {
      if (!media || !media.found || !media.title) {
        root.className = 'empty';
        root.innerHTML = '';
        return;
      }

      const style = getStyle(media);
      const data = sharedContent(media);
      const bgCls = boxBgClass();
      root.className = '';

      if (style === 'bash') {
        const filled = Math.max(0, Math.min(Math.floor(data.percent / 5), 20));
        const bar = '='.repeat(filled) + '-'.repeat(20 - filled);
        root.innerHTML = '<section class="player bash' + bgCls + '">' +
          '<div class="line">$ now-playing --song "' + data.song + '"</div>' +
          '<div class="line">$ artist: ' + data.artist + '</div>' +
          '<div class="line">$ status: ' + data.status.toLowerCase() + '</div>' +
          '<div class="line">$ progress: [' + bar + '] ' + formatTime(data.progress) + '/' + formatTime(data.duration) + '</div>' +
          '</section>';
        return;
      }

      if (style === 'youtube') {
        root.innerHTML = '<section class="player youtube' + bgCls + '">' +
          '<div class="thumb">' + (media.image ? '<img src="' + media.image + '" alt="">' : '<div class="fallback-art">' + data.song.slice(0, 1) + '</div>') + '</div>' +
          '<div class="progress-bar"><div class="progress" style="width:' + data.percent + '%"></div></div>' +
          '<div class="content"><div class="song">' + data.song + '</div><div class="artist">' + data.artist + '</div>' +
          '<div class="time"><span>' + data.status + '</span><span>' + formatTime(data.progress) + ' / ' + formatTime(data.duration) + '</span></div></div>' +
          '</section>';
        return;
      }

      if (style === 'discord') {
        root.innerHTML = '<section class="player discord' + bgCls + '">' +
          data.art +
          '<div class="content"><div class="song">' + data.song + '</div><div class="artist">' + data.artist + '</div>' +
          '<div class="status">' + (media.status === 'Playing' ? 'Now Playing' : data.status) + '</div>' +
          '<div class="progress-wrap"><div class="progress-bar"><div class="progress" style="width:' + data.percent + '%"></div></div>' +
          '<div class="time"><span>' + formatTime(data.progress) + ' / ' + formatTime(data.duration) + '</span></div></div>' +
          '<div class="links"><span>Song</span><span>Artist</span><span>Album</span></div>' +
          '<div class="footer">KitsuNexus Now Playing</div></div>' +
          '</section>';
        return;
      }

      const progressHtml = '<div class="progress-wrap"><div class="progress-bar"><div class="progress" style="width:' + data.percent + '%"></div></div>' +
        '<div class="time"><span>' + formatTime(data.progress) + '</span><span>' + formatTime(data.duration) + '</span></div></div>';
      const panelStyle = media.image ? ' style="--cover: url(' + media.image + ')"' : '';
      const contentHtml = data.art +
        '<div class="content"><div class="song">' + data.song + '</div><div class="artist">' + data.artist + '</div>' +
        (data.album ? '<div class="album">' + data.album + '</div>' : '') +
        '<div class="status">' + data.status + '</div>' + progressHtml + '</div>';

      root.innerHTML = '<section class="player ' + style + '"' + panelStyle + '>' +
        (style === 'soundcloud' ? '<div class="top">' + contentHtml + '</div>' : contentHtml) +
        '</section>';
    }

    async function refresh() {
      try {
        const response = await fetch('/api/overlay/' + overlayId + '/now-playing', { cache: 'no-store' });
        render(await response.json());
      } catch {
        root.className = 'empty';
        root.innerHTML = '';
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`
}

module.exports = router
