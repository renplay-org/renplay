/*
 * RPG Maker MZ keeps every image it loads until the player changes maps. A game with many large
 * pictures shown on one map then grows until a phone's browser closes the page and loads it again.
 * This keeps the images that were shown within a budget: past it, the ones unused the longest,
 * and not drawn, shown or asked for in the last seconds, leave the cache. They are never
 * destroyed: a sprite that still holds one keeps it, PIXI frees its GPU copy once it is no longer
 * drawn, and the game loads it again when it asks for it later. Images loaded but never shown (an
 * event's preloads) cost little until they are drawn, and stay. MV has its own limit (ImageCache)
 * and is left alone. The server puts it between renplay-html-media.js and renplay-html.js.
 */

var memPhone = (function () {
  try {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  } catch (e) {
    return false
  }
})()
var memBudget = (memPhone ? 192 : 768) * 1024 * 1024
var memRecent = 3000
// Drawn in the last 120 frames (two seconds): still on screen.
var memRecentFrames = 120
var memMarks = typeof WeakMap === 'function' ? new WeakMap() : null

function memNow() {
  return window.performance && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/** When a bitmap was last asked for or shown, and whether a sprite ever showed it. */
function memMark(bitmap, shown) {
  if (!bitmap || typeof bitmap !== 'object') return
  var mark = memMarks.get(bitmap) || { used: 0, shown: false }
  mark.used = memNow()
  if (shown) mark.shown = true
  memMarks.set(bitmap, mark)
}

/** PIXI's frame count, which marks each texture it draws. */
function memFrame() {
  var graphics = window.Graphics
  var renderer = graphics && graphics.app && graphics.app.renderer
  var gc = renderer && renderer.textureGC
  return gc && typeof gc.count === 'number' ? gc.count : null
}

function memTrim(manager) {
  var cache = manager._cache
  var now = memNow()
  var frame = memFrame()
  var shown = []
  var total = 0
  for (var url in cache) {
    var bitmap = cache[url]
    var mark = bitmap && memMarks.get(bitmap)
    if (!mark || !mark.shown || typeof bitmap.isReady !== 'function' || !bitmap.isReady()) continue
    var size = bitmap.width * bitmap.height * 4
    total += size
    // One drawn lately is in use: a character sheet or a background stays as long as it shows.
    var texture = bitmap._baseTexture
    if (frame !== null && texture && texture.touched && frame - texture.touched <= memRecentFrames) mark.used = now
    if (now - mark.used > memRecent) shown.push({ url: url, size: size, used: mark.used })
  }
  if (total <= memBudget) return
  shown.sort(function (a, b) {
    return a.used - b.used
  })
  for (var i = 0; i < shown.length && total > memBudget; i++) {
    delete cache[shown[i].url]
    total -= shown[i].size
  }
}

function memWrapLoad(manager) {
  var load = manager.loadBitmapFromUrl
  if (typeof load !== 'function' || load.__renplayMemory) return
  var wrapped = function (url) {
    var bitmap = load.apply(this, arguments)
    if (manager._cache && manager._cache[url] === bitmap) {
      memMark(bitmap, false)
      memTrim(manager)
    }
    return bitmap
  }
  wrapped.__renplayMemory = true
  manager.loadBitmapFromUrl = wrapped
}

// A sprite shows a bitmap once it has loaded: MZ calls _onBitmapLoad for it (a tiling sprite, for a
// parallax, has its own).
function memWrapShow(proto, ownBitmap) {
  var onLoad = proto && proto._onBitmapLoad
  if (typeof onLoad !== 'function' || onLoad.__renplayMemory) return
  var wrapped = function (bitmap) {
    memMark(ownBitmap ? this._bitmap : bitmap, true)
    return onLoad.apply(this, arguments)
  }
  wrapped.__renplayMemory = true
  proto._onBitmapLoad = wrapped
}

// Each script's load event, caught on its way down: after RPG Maker's core and managers, and again
// after a plugin that replaces how images load or show, so the budget still sees every image.
window.addEventListener(
  'load',
  function () {
    var utils = window.Utils
    var manager = window.ImageManager
    if (!memMarks || !utils || utils.RPGMAKER_NAME !== 'MZ' || !manager || !manager._cache) return
    memWrapLoad(manager)
    if (window.Sprite) memWrapShow(window.Sprite.prototype, false)
    if (window.TilingSprite) memWrapShow(window.TilingSprite.prototype, true)
  },
  true,
)
