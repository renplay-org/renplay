/*
 * What Renplay's two in-game runtimes share. The server puts it in front of each
 * (renplay-runtime.js for Ren'Py, renplay-html.js for HTML games) inside one
 * function, so none of it is global in the game's page (server/src/play/runtime.ts).
 *
 * - post: a message to the player, the page that frames the game.
 * - Muting like a browser tab: every Web Audio output goes through a gain node set
 *   to 0 while muted, so the game's own volume settings stay as they are.
 * - Renplay's keys: ` opens and closes the menu, \ the guide. Capture runs before the
 *   game sees them, so they work wherever focus is, fullscreen too, and are never typed.
 */
var cfg = window.__renplay || {}
var inFrame = window.parent && window.parent !== window

function post(type, data) {
  if (!inFrame) return
  if (type === 'ready') measureFrames()
  var msg = { type: 'renplay:' + type, game: cfg.id, userId: cfg.userId }
  if (data) for (var k in data) msg[k] = data[k]
  // Only the player, on Renplay's own address, may read it. A sandboxed page's own origin is
  // opaque, but its address still names Renplay's.
  try {
    window.parent.postMessage(msg, location.origin)
  } catch (e) {}
}

// ------------------------------------------------------------------ frame rate

// For the anonymous usage report: how smoothly the page ran, as the frames the browser asked for in
// five seconds, measured once. It starts half a minute after the game is ready, and a hidden page
// waits for a later try. The player turns the number into a bucket and never shows it.
var framesMeasured = false
function measureFrames() {
  if (framesMeasured) return
  framesMeasured = true
  var tries = 0
  var later = function (attempt) {
    if (++tries < 8) setTimeout(attempt, 15000)
  }
  var attempt = function () {
    if (document.visibilityState !== 'visible') return later(attempt)
    var frames = 0
    var first = 0
    var tick = function (now) {
      if (document.visibilityState !== 'visible') return later(attempt)
      if (!first) first = now
      if (now - first >= 5000) {
        post('perf', { fps: Math.round((frames * 1000) / (now - first)) })
        return
      }
      frames++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  setTimeout(attempt, 30000)
}

// ------------------------------------------------------------------ mute

// The choice is kept per browser. A sandboxed HTML game cannot read it and waits for the player.
var muted = false
try {
  muted = localStorage.getItem('renplay:muted') === '1'
} catch (e) {}
var outputs = new Map()
if (typeof AudioNode !== 'undefined' && typeof AudioDestinationNode !== 'undefined') {
  var nativeConnect = AudioNode.prototype.connect
  var nativeDisconnect = AudioNode.prototype.disconnect
  var outputFor = function (dest) {
    var g = outputs.get(dest)
    if (!g) {
      g = dest.context.createGain()
      g.gain.value = muted ? 0 : 1
      nativeConnect.call(g, dest)
      outputs.set(dest, g)
    }
    return g
  }
  var redirect = function (native) {
    return function (target) {
      if (!(target instanceof AudioDestinationNode)) return native.apply(this, arguments)
      var args = Array.prototype.slice.call(arguments)
      args[0] = outputFor(target)
      return native.apply(this, args)
    }
  }
  AudioNode.prototype.connect = redirect(nativeConnect)
  AudioNode.prototype.disconnect = redirect(nativeDisconnect)
}

function setAudioMuted(on) {
  muted = !!on
  outputs.forEach(function (g) {
    g.gain.value = muted ? 0 : 1
  })
}
function isMuted() {
  return muted
}

// ------------------------------------------------------------------ fullscreen

var parentFullscreen = false
function isParentFullscreen() {
  return parentFullscreen
}

// ------------------------------------------------------------------ Renplay's keys

// By physical key, so a layout does not move them. The player says whether the game has a guide: the
// backslash is the game's own when it has none.
var KEYS = { Backquote: 'menu', Backslash: 'guide', IntlBackslash: 'guide' }
var hasGuide = false
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || !e.data) return
  if (e.data.type === 'renplay:fullscreen-state') parentFullscreen = !!e.data.value
  else if (e.data.type === 'renplay:keys') hasGuide = !!e.data.guide
})
function renplayKey(e) {
  var key = KEYS[e.code]
  if (!inFrame || !key || e.ctrlKey || e.metaKey || e.altKey || (key === 'guide' && !hasGuide)) return null
  e.preventDefault()
  e.stopImmediatePropagation()
  return key
}
window.addEventListener(
  'keydown',
  function (e) {
    var key = renplayKey(e)
    if (key && !e.repeat) post('key', { key: key })
  },
  true,
)
window.addEventListener('keyup', renplayKey, true)
