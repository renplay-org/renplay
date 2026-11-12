/*
 * Renplay's runtime for HTML games (docs.renplay.org/engines), inlined at the top of
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
 * - indexedDB: in memory (runtime/vendor/fake-indexeddb.js), restored from
 *   window.__renplay.idb before the game's scripts run and sent to the player
 *   after every write. Unity, Godot and RPG Maker MZ keep saves there. Download
 *   caches (Unity's) are refused: the game fetches again instead of holding
 *   them in memory.
 *
 * It also tells the player when the game is ready and mutes media elements on
 * request. Messages, Web Audio muting and Esc come from renplay-player.js, which
 * the server puts in front of this script.
 */
;(function () {
  'use strict'
  var parentWin = window.parent

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
    // Keep the snapshot dirty until the trusted parent confirms durable, owner-keyed storage.
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
  // Cache Storage throws in a sandboxed frame; absent, loaders (Unity's) just do not cache.
  define(window, 'caches', function () {
    return undefined
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

  // ------------------------------------------------------------- IndexedDB

  var IDB = window.__renplayIDB
  var idbDirty = false
  var idbVersion = 0
  var idbPending = null
  var idbFlush = null
  var idbTimer = null
  var flushIdb = function () {
    return Promise.resolve()
  }
  if (IDB) {
    var factory = new IDB.IDBFactory()
    var realOpen = factory.open.bind(factory)
    var CACHES = /^UnityCache$/
    var restoring = 0

    var bytes64 = function (u8) {
      var s = ''
      for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
      return btoa(s)
    }
    var unbytes64 = function (s) {
      var b = atob(s)
      var u = new Uint8Array(b.length)
      for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
      return u
    }
    // JSON for what IndexedDB stores: binary data, dates and the like keep their type.
    var encode = function (v) {
      if (v === undefined) return { $t: 'undef' }
      if (typeof v === 'number' && !isFinite(v)) return { $t: 'num', v: String(v) }
      if (v === null || typeof v !== 'object') return v
      if (v instanceof Date) return { $t: 'date', v: v.getTime() }
      if (v instanceof ArrayBuffer) return { $t: 'ab', b: bytes64(new Uint8Array(v)) }
      if (ArrayBuffer.isView(v)) return { $t: 'view', c: v.constructor.name, b: bytes64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
      if (Array.isArray(v)) return v.map(encode)
      if (v instanceof Map) return { $t: 'map', v: Array.from(v, function (e) { return [encode(e[0]), encode(e[1])] }) }
      if (v instanceof Set) return { $t: 'set', v: Array.from(v, encode) }
      var o = {}
      for (var k in v) if (has.call(v, k)) o[k] = encode(v[k])
      return has.call(o, '$t') ? { $t: 'obj', v: o } : o
    }
    var decode = function (v) {
      if (v === null || typeof v !== 'object') return v
      if (Array.isArray(v)) return v.map(decode)
      switch (v.$t) {
        case 'undef':
          return undefined
        case 'num':
          return Number(v.v)
        case 'date':
          return new Date(v.v)
        case 'ab':
          return unbytes64(v.b).buffer
        case 'view': {
          var u = unbytes64(v.b)
          var C = window[v.c]
          return v.c === 'DataView' ? new DataView(u.buffer) : C ? new C(u.buffer, 0, u.byteLength / (C.BYTES_PER_ELEMENT || 1)) : u
        }
        case 'map':
          return new Map(v.v.map(function (e) { return [decode(e[0]), decode(e[1])] }))
        case 'set':
          return new Set(v.v.map(decode))
        case 'obj':
          v = v.v
      }
      var o = {}
      for (var k in v) if (has.call(v, k)) o[k] = decode(v[k])
      return o
    }

    var changedIdb = function () {
      if (restoring) return
      idbDirty = true
      idbVersion++
      if (!idbTimer) idbTimer = setTimeout(function () { flushIdb() }, 2000)
    }
    // A cache refused like a browser without storage would: the open request fails.
    var refused = function () {
      var listeners = []
      var req = { result: undefined, error: null, readyState: 'pending', source: null, transaction: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
      req.addEventListener = function (type, f) {
        if (type === 'error') listeners.push(f)
      }
      req.removeEventListener = function () {}
      setTimeout(function () {
        req.readyState = 'done'
        req.error = new DOMException('Not kept in Renplay', 'UnknownError')
        var ev = { type: 'error', target: req, currentTarget: req, preventDefault: function () {}, stopPropagation: function () {} }
        if (req.onerror) req.onerror(ev)
        listeners.forEach(function (f) { f(ev) })
      }, 0)
      return req
    }
    factory.open = function (name) {
      if (CACHES.test(String(name))) return refused()
      var req = realOpen.apply(null, arguments)
      req.addEventListener('upgradeneeded', changedIdb)
      return req
    }
    var tx = IDB.IDBDatabase.prototype.transaction
    IDB.IDBDatabase.prototype.transaction = function (stores, mode) {
      var t = tx.apply(this, arguments)
      if (mode === 'readwrite') t.addEventListener('complete', changedIdb)
      return t
    }

    // The saved databases go in first; IndexedDB serves a database's open requests in order,
    // so the game's own requests wait until these are done.
    var saved = (cfg.idb && cfg.idb.databases) || []
    saved.forEach(function (d) {
      if (!d || !d.name) return
      restoring++
      var req = realOpen(d.name, d.version || 1)
      req.onupgradeneeded = function () {
        var db = req.result
        ;(d.stores || []).forEach(function (s) {
          var store = db.createObjectStore(s.name, s.keyPath == null ? { autoIncrement: !!s.autoIncrement } : { keyPath: s.keyPath, autoIncrement: !!s.autoIncrement })
          ;(s.indexes || []).forEach(function (i) {
            store.createIndex(i.name, i.keyPath, { unique: !!i.unique, multiEntry: !!i.multiEntry })
          })
          ;(s.records || []).forEach(function (r) {
            if (s.keyPath == null) store.put(decode(r[1]), decode(r[0]))
            else store.put(decode(r[1]))
          })
        })
      }
      var done = function () {
        restoring--
        try {
          req.result.close()
        } catch (e) {}
      }
      req.onsuccess = done
      req.onerror = function () {
        restoring--
      }
    })

    var readDb = function (name) {
      return new Promise(function (resolve, reject) {
        var req = realOpen(name)
        req.onerror = function () {
          reject(req.error)
        }
        req.onsuccess = function () {
          var db = req.result
          db.onversionchange = function () {
            db.close()
          }
          var out = { name: name, version: db.version, stores: [] }
          var names = Array.prototype.slice.call(db.objectStoreNames)
          if (!names.length) {
            db.close()
            return resolve(out)
          }
          var t = tx.call(db, names, 'readonly')
          names.forEach(function (n) {
            var st = t.objectStore(n)
            var s = {
              name: n,
              keyPath: st.keyPath,
              autoIncrement: st.autoIncrement,
              indexes: Array.prototype.map.call(st.indexNames, function (i) {
                var x = st.index(i)
                return { name: x.name, keyPath: x.keyPath, unique: x.unique, multiEntry: x.multiEntry }
              }),
              records: [],
            }
            out.stores.push(s)
            var keys = st.getAllKeys()
            var values = st.getAll()
            values.onsuccess = function () {
              s.records = values.result.map(function (v, i) {
                return [encode(keys.result[i]), encode(v)]
              })
            }
          })
          t.oncomplete = function () {
            db.close()
            resolve(out)
          }
          t.onerror = t.onabort = function () {
            db.close()
            reject(t.error)
          }
        }
      })
    }
    flushIdb = function () {
      if (idbTimer) clearTimeout(idbTimer)
      idbTimer = null
      if (idbFlush) return idbFlush
      if (!idbDirty) return Promise.resolve()
      var version = idbVersion
      idbFlush = factory
        .databases()
        .then(function (list) {
          return Promise.all(
            list
              .filter(function (d) {
                return !CACHES.test(d.name)
              })
              .map(function (d) {
                return readDb(d.name)
              }),
          )
        })
        .then(function (dbs) {
          var data = JSON.stringify({ databases: dbs.filter(Boolean) })
          idbPending = { data: data, version: version }
          post('storage', { kind: 'idb', data: data })
        })
        .catch(function (e) {
          console.warn('[renplay] could not keep the game storage', e)
        })
        .then(function () { idbFlush = null })
      return idbFlush
    }

    define(window, 'indexedDB', function () {
      return factory
    })
    Object.keys(IDB).forEach(function (k) {
      if (k === 'IDBFactory') return
      try {
        Object.defineProperty(window, k, { value: IDB[k], configurable: true, writable: true })
      } catch (e) {}
    })
    window.addEventListener('pagehide', function () {
      flushIdb()
    })
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushIdb()
    })
  }

  // Retry both storage APIs until the trusted parent acknowledges durable storage, not upload.
  setInterval(function () { sendStorage(); flushIdb() }, 5000)

  // ------------------------------------------------------------- the game's own files

  // The frame's origin is opaque, so the game's own files count as another origin's. The server
  // lets any origin read them. Pictures and media load with crossOrigin so a canvas that draws them
  // stays readable (RPG Maker reads its window skin's colours), and a worker starts from a copy of
  // its script (RPG Maker MZ decodes its music in one).
  function folderOf(url) {
    return url.replace(/[^/]*([?#].*)?$/, '')
  }
  var gameBase = folderOf(location.href)
  function isGameFile(url) {
    try {
      return new URL(String(url), location.href).href.indexOf(gameBase) === 0
    } catch (e) {
      return false
    }
  }
  function corsFirst(element, value) {
    if (element.crossOrigin === null && typeof value === 'string' && isGameFile(value)) element.crossOrigin = 'anonymous'
  }
  ;['HTMLImageElement', 'HTMLMediaElement'].forEach(function (name) {
    var proto = window[name] && window[name].prototype
    var srcDesc = proto && Object.getOwnPropertyDescriptor(proto, 'src')
    if (!srcDesc || !srcDesc.set) return
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: srcDesc.get,
      set: function (value) {
        corsFirst(this, value)
        srcDesc.set.call(this, value)
      },
    })
  })
  // Pictures and media a script names with setAttribute.
  if (window.Element && window.Element.prototype.setAttribute) {
    var setAttribute = window.Element.prototype.setAttribute
    window.Element.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'src' && /^(IMG|VIDEO|AUDIO)$/.test(this.tagName || '')) corsFirst(this, value)
      return setAttribute.call(this, name, value)
    }
  }
  // A browser that still refuses the frame a feature it asks for every frame answers as if
  // nothing is there, instead of stopping the game (iPhone Safari and getGamepads).
  var nav = window.navigator
  if (nav && typeof nav.getGamepads === 'function') {
    var getGamepads = nav.getGamepads
    try {
      nav.getGamepads = function () {
        try {
          return getGamepads.call(nav)
        } catch (e) {
          return []
        }
      }
    } catch (e) {}
  }

  var NativeWorker = window.Worker
  if (NativeWorker) {
    var copies = {}
    var GameWorker = function (url, options) {
      try {
        return new NativeWorker(url, options)
      } catch (e) {
        if (!e || e.name !== 'SecurityError' || (options && options.type === 'module') || !isGameFile(url)) throw e
        var address = new URL(String(url), location.href).href
        if (!copies[address]) {
          var request = new XMLHttpRequest()
          request.open('GET', address, false)
          request.send()
          if (request.status < 200 || request.status >= 300) throw e
          // Relative addresses in the worker (importScripts, fetch) still mean the script's folder.
          var prelude =
            '(function(){var b=' + JSON.stringify(folderOf(address)) + ';function at(u){return typeof u==="string"?new URL(u,b).href:u}' +
            'var i=self.importScripts;self.importScripts=function(){return i.apply(self,Array.prototype.map.call(arguments,at))};' +
            'var f=self.fetch;if(f)self.fetch=function(u,o){return f.call(self,at(u),o)}})();\n'
          copies[address] = URL.createObjectURL(new Blob([prelude, request.responseText], { type: 'text/javascript' }))
        }
        return new NativeWorker(copies[address], options)
      }
    }
    GameWorker.prototype = NativeWorker.prototype
    window.Worker = GameWorker
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
        mutedDesc.set.call(this, !!v || isMuted())
      },
    })
  }
  function applyMedia(el) {
    if (mutedDesc && mutedDesc.set) mutedDesc.set.call(el, isMuted() || (own.has(el) && own.get(el)))
  }
  var nativePlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    applyMedia(this)
    return nativePlay.apply(this, arguments)
  }
  function setMuted(on) {
    setAudioMuted(on)
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
      case 'renplay:storage-kept':
        if (d.userId !== cfg.userId) break
        if (!d.kind && d.data === JSON.stringify(local)) dirty = false
        if (d.kind === 'idb' && idbPending && d.data === idbPending.data && idbPending.version === idbVersion) idbDirty = false
        break
      case 'renplay:resume-sync':
        if (d.userId !== cfg.userId) break
        dirty = true
        idbDirty = true
        sendStorage()
        flushIdb()
        break
      case 'renplay:flush':
      case 'renplay:save-and-exit':
        sendStorage()
        flushIdb().then(function () {
          post('flushed', { ok: true, id: d.id })
        })
        break
      case 'renplay:focus':
        window.focus()
        break
    }
  })

  // RPG Maker MZ in a phone's browser keeps a tenth of the height free for the browser's bars. A
  // game's frame has none, so it would only show a band of black: it takes the whole height.
  var fullHeight = false
  function rpgMakerFullHeight() {
    var G = window.Graphics
    if (fullHeight || !G || typeof G._stretchHeight !== 'function' || !window.Utils || !window.Utils.RPGMAKER_NAME) return
    fullHeight = true
    G._stretchHeight = function () {
      return document.documentElement.clientHeight || window.innerHeight
    }
    try {
      if (G._canvas && typeof G._updateRealScale === 'function') {
        G._updateRealScale()
        if (typeof G._updateAllElements === 'function') G._updateAllElements()
      }
    } catch (e) {}
  }

  window.addEventListener('load', function () {
    post('ready')
    rpgMakerFullHeight()
    // Engines set up their Graphics while they boot: try for a while.
    var looks = 0
    var look = setInterval(function () {
      rpgMakerFullHeight()
      if (++looks >= 30 || fullHeight) clearInterval(look)
    }, 1000)
  })
})()
