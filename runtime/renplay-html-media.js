/*
 * The HTML games' media: videos and sound. The server puts it between renplay-player.js and
 * renplay-html.js in one function (server/src/play/runtime.ts), so isMuted and setAudioMuted come
 * from the first, and the second calls playsInline (for a video's source) and setMuted (when the
 * player mutes).
 */

// A video plays inside the game, never in the phone's own player. Plugins that draw a video into
// RPG Maker's canvas make theirs without playsinline, and an iPhone then opens it full screen
// while the game keeps a still picture.
function isVideo(el) {
  return !!el && typeof el.tagName === 'string' && el.tagName.toUpperCase() === 'VIDEO'
}
function playsInline(el) {
  if (!isVideo(el) || el.playsInline === true) return
  try {
    el.playsInline = true
  } catch (e) {}
  if (typeof el.setAttribute === 'function') {
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
  }
}
var createElement = document.createElement
if (typeof createElement === 'function') {
  document.createElement = function (tag) {
    var el = createElement.apply(this, arguments)
    if (String(tag).toLowerCase() === 'video') playsInline(el)
    return el
  }
}

// ------------------------------------------------------------- mute

// Media elements follow the player's choice; the game's own muting is kept apart.
var own = new WeakMap()
var mutedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')
if (mutedDesc && mutedDesc.set) {
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
    configurable: true,
    get: function () {
      return own.has(this) ? own.get(this) : mutedDesc.get.call(this)
    },
    set: function (v) {
      own.set(this, !!v)
      applyMedia(this)
    },
  })
}
// An iPhone ignores a media element's volume (it always reads 1): one the game turns down to
// nothing is muted.
var volumes = new WeakMap()
var volumeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')
if (volumeDesc && volumeDesc.set) {
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    get: function () {
      return volumes.has(this) ? volumes.get(this) : volumeDesc.get.call(this)
    },
    set: function (v) {
      volumeDesc.set.call(this, v)
      volumes.set(this, Number(v))
      applyMedia(this)
    },
  })
}
// An iPhone refuses a video with sound that starts without a tap: it starts muted instead and gets
// its sound back at the next tap. One that may not start even muted (Low Power Mode) starts then,
// unless the game paused it or gave it another source meanwhile.
var silenced = []
var stalled = []
function applyMedia(el) {
  var quiet = isMuted() || (own.has(el) && own.get(el)) || volumes.get(el) === 0 || silenced.indexOf(el) >= 0
  if (mutedDesc && mutedDesc.set) mutedDesc.set.call(el, quiet)
}
function drop(list, el) {
  for (var i = list.length - 1; i >= 0; i--) if (list[i] === el || list[i].el === el) list.splice(i, 1)
}
function stall(el) {
  drop(stalled, el)
  stalled.push({ el: el, src: el.src })
}
// Media playing now, in the page or not (a video drawn into a canvas), so the player's sound switch
// reaches them. One that stops leaves the list, and its next play() applies the switch again.
var playing = []
var watched = new WeakMap()
function watch(el) {
  if (playing.indexOf(el) < 0) playing.push(el)
  if (watched.has(el) || typeof el.addEventListener !== 'function') return
  watched.set(el, true)
  el.addEventListener('pause', function () {
    drop(playing, el)
  })
}
var nativePlay = HTMLMediaElement.prototype.play
HTMLMediaElement.prototype.play = function () {
  var el = this
  playsInline(el)
  watch(el)
  applyMedia(el)
  var started = nativePlay.apply(el, arguments)
  if (started && typeof started.catch === 'function') {
    started.catch(function () {
      drop(playing, el)
    })
  }
  if (!isVideo(el) || !started || typeof started.catch !== 'function' || !mutedDesc || !mutedDesc.set) return started
  return started.catch(function (e) {
    if (!e || e.name !== 'NotAllowedError') throw e
    if (silenced.indexOf(el) < 0 && !mutedDesc.get.call(el)) {
      silenced.push(el)
      mutedDesc.set.call(el, true)
      return nativePlay.call(el).then(
        function () {
          watch(el)
        },
        function (again) {
          if (again && again.name === 'NotAllowedError') stall(el)
          throw again
        },
      )
    }
    stall(el)
    throw e
  })
}
var nativePause = HTMLMediaElement.prototype.pause
if (typeof nativePause === 'function') {
  HTMLMediaElement.prototype.pause = function () {
    drop(stalled, this)
    return nativePause.apply(this, arguments)
  }
}
function afterTap() {
  var waiting = stalled
  var quiet = silenced
  stalled = []
  silenced = []
  quiet.forEach(applyMedia)
  waiting.forEach(function (w) {
    if (w.el.paused && !w.el.ended && w.el.src === w.src) w.el.play().catch(function () {})
  })
}
;['touchend', 'pointerup', 'click', 'keydown'].forEach(function (type) {
  document.addEventListener(type, afterTap, true)
})
function setMuted(on) {
  setAudioMuted(on)
  var all = Array.prototype.slice.call(document.querySelectorAll('audio, video'))
  playing.forEach(function (el) {
    if (all.indexOf(el) < 0) all.push(el)
  })
  all.forEach(applyMedia)
}
