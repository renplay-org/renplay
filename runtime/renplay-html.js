/*
 * Renplay's runtime for HTML games (docs/engines.md), inlined at the top of
 * the game's page before any of its scripts.
 *
 * The page runs in a sandboxed frame with an opaque origin: no access to
 * Renplay, and no localStorage, sessionStorage, IndexedDB or cookies of its
 * own. This script provides storage the game can use:
 * - localStorage: starts with what the server keeps for the game (inlined in
 *   window.__renplay.storage) and sends every change to the player, which
 *   stores it with the game's saves. SugarCube and RPG Maker keep saves there.
 * - sessionStorage and cookies: in memory, for this visit.
 *
 * It also tells the player when the game is ready, mutes on request (media
 * elements and Web Audio), and reports Esc held in fullscreen.
 */
;(function () {
  'use strict'
  var cfg = window.__renplay || {}
  var parentWin = window.parent
  function post(type, data) {
    var msg = { type: 'renplay:' + type, game: cfg.id }
    if (data) for (var k in data) msg[k] = data[k]
    // The player is the only window that listens; an opaque origin cannot name it.
    parentWin.postMessage(msg, '*')
  }

  // ------------------------------------------------------------- storage

  var has = Object.prototype.hasOwnProperty
  function makeStorage(store, onChange) {
    var api = {
      getItem: function (k) {
        k = String(k)
        return has.call(store, k) ? store[k] : null
      },
      setItem: function (k, v) {
        k = String(k)
        v = String(v)
        if (store[k] === v) return
        store[k] = v
        onChange()
      },
      removeItem: function (k) {
        k = String(k)
        if (!has.call(store, k)) return
        delete store[k]
        onChange()
      },
      clear: function () {
        var any = false
        for (var k in store) {
          if (has.call(store, k)) {
            delete store[k]
            any = true
          }
        }
        if (any) onChange()
      },
      key: function (i) {
        var keys = Object.keys(store)
        return i >= 0 && i < keys.length ? keys[i] : null
      },
    }
    Object.defineProperty(api, 'length', {
      get: function () {
        return Object.keys(store).length
      },
    })
    return api
  }

  var local = {}
  var initial = cfg.storage
  if (initial && typeof initial === 'object') for (var key in initial) if (has.call(initial, key)) local[key] = String(initial[key])

  // Changes go to the player a moment later, all at once.
  var timer = null
  var dirty = false
  function sendStorage() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!dirty) return
    dirty = false
    post('storage', { data: JSON.stringify(local) })
  }
  function changed() {
    dirty = true
    if (!timer) timer = setTimeout(sendStorage, 1500)
  }
  var localStorageApi = makeStorage(local, changed)
  var sessionStorageApi = makeStorage({}, function () {})
  function define(obj, name, get, set) {
    try {
      Object.defineProperty(obj, name, { get: get, set: set, configurable: true })
    } catch (e) {}
  }
  define(window, 'localStorage', function () {
    return localStorageApi
  })
  define(window, 'sessionStorage', function () {
    return sessionStorageApi
  })
  var jar = {}
  define(
    Document.prototype,
    'cookie',
    function () {
      return Object.keys(jar)
        .map(function (k) {
          return k + '=' + jar[k]
        })
        .join('; ')
    },
    function (v) {
      var pair = String(v).split(';')[0]
      var eq = pair.indexOf('=')
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    },
  )
  // Leaving the page (closing the tab, Save & exit) must not lose a change.
  window.addEventListener('pagehide', sendStorage)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendStorage()
  })

  // ------------------------------------------------------------- mute

  var muted = false
  var outputs = []
  if (typeof AudioNode !== 'undefined' && typeof AudioDestinationNode !== 'undefined') {
    var nativeConnect = AudioNode.prototype.connect
    var nativeDisconnect = AudioNode.prototype.disconnect
    var gains = new Map()
    var outputFor = function (dest) {
      var g = gains.get(dest)
      if (!g) {
        g = dest.context.createGain()
        g.gain.value = muted ? 0 : 1
        nativeConnect.call(g, dest)
        gains.set(dest, g)
        outputs.push(g)
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
        mutedDesc.set.call(this, !!v || muted)
      },
    })
  }
  function applyMedia(el) {
    if (mutedDesc && mutedDesc.set) mutedDesc.set.call(el, muted || (own.has(el) && own.get(el)))
  }
  var nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    applyMedia(this)
    return nativePlay.apply(this, arguments)
  }
  function setMuted(on) {
    muted = !!on
    outputs.forEach(function (g) {
      g.gain.value = muted ? 0 : 1
    })
    Array.prototype.forEach.call(document.querySelectorAll('audio, video'), applyMedia)
  }

  // ------------------------------------------------------------- player

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin || !e.data || typeof e.data.type !== 'string') return
    var d = e.data
    switch (d.type) {
      case 'renplay:mute':
        setMuted(d.value)
        break
      case 'renplay:flush':
      case 'renplay:save-and-exit':
        sendStorage()
        post('flushed', { ok: true, id: d.id })
        break
      case 'renplay:focus':
        window.focus()
        break
    }
  })

  window.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && !e.repeat) post('escape', { down: true })
    },
    true,
  )
  window.addEventListener(
    'keyup',
    function (e) {
      if (e.key === 'Escape') post('escape', { down: false })
    },
    true,
  )

  window.addEventListener('load', function () {
    post('ready')
  })
})()
