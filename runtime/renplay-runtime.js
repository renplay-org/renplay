/*
 * renplay runtime: loaded into every game page before Ren'Py's renpy-pre.js.
 *
 * - Saves: ~/.renpy lives on the server. Before Ren'Py starts, this game's save
 *   folder and the shared folders are restored into Emscripten's in-memory FS;
 *   other games' folders appear as files fetched on first read. Every change
 *   Ren'Py makes (it calls FS.syncfs after each save) is uploaded right away.
 *   A per-browser IndexedDB copy keeps unsent changes across reloads and lets
 *   the game start when the server is unreachable.
 * - Caches game.zip in Cache Storage (build URLs are versioned).
 * - Serves the shared engine files and bridges fullscreen/exit to the player.
 */
;(function () {
  'use strict'
  if (window.__renplayRuntime) return
  var cfg = window.__renplay || {}
  if (!cfg.slug) return

  var HOME = '/home/web_user/.renpy'
  var API = '/api/saves/' + encodeURIComponent(cfg.slug)
  var inFrame = window.parent && window.parent !== window
  var log = function () {
    var a = Array.prototype.slice.call(arguments)
    a.unshift('[renplay]')
    console.log.apply(console, a)
  }

  // ---------------------------------------------------------------- frame pacing

  /*
   * Ren'Py expects swapping buffers to block until vsync. In a browser it does
   * not, and the web build yields with emscripten_sleep(0) (a zero-delay
   * setTimeout), so Ren'Py redraws as fast as it can. The browser then shows a
   * frame only every 70-100 ms: the timer chain starves rendering and the GPU
   * queue fills with frames nobody sees.
   *
   * Fix: once Ren'Py has drawn (any WebGL clear), its next short sleep resumes
   * on the next animation frame instead. Ren'Py then draws at most once per
   * display refresh, inside requestAnimationFrame, like a normal web game.
   * Hidden pages keep plain timers so music and autosaves continue.
   *
   * Until Ren'Py draws its first frame, zero-delay yields go through a
   * MessageChannel: browsers stretch chained setTimeout(0) to 4 ms, and
   * unpacking game.zip (a yield every 25 files) and loading the script spent
   * most of their time waiting. Afterwards plain timers are kept for work
   * between frames, so it never competes with drawing.
   */
  var pacing = (function () {
    var realSetTimeout = window.setTimeout.bind(window)
    var realClearTimeout = window.clearTimeout.bind(window)
    var drawn = false
    var started = false
    var waiting = []
    var byId = new Map()
    var raf = 0
    var fallback = 0
    var nextId = 0x40000000
    var stats = { frames: 0, deferred: 0, immediate: 0 }
    var immediate = []
    var channel = new MessageChannel()
    channel.port1.onmessage = function () {
      var list = immediate
      immediate = []
      runList(list)
    }

    ;[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (C) {
      if (!C || !C.prototype.clear) return
      var clear = C.prototype.clear
      C.prototype.clear = function (mask) {
        drawn = true
        started = true
        return clear.call(this, mask)
      }
    })

    function run(fromRaf) {
      if (fromRaf) {
        if (fallback) realClearTimeout(fallback)
      } else if (raf) cancelAnimationFrame(raf)
      raf = 0
      fallback = 0
      drawn = false
      stats.frames++
      var list = waiting
      waiting = []
      runList(list)
    }

    function runList(list) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i]
        byId.delete(e.id)
        if (e.cancelled) continue
        try {
          e.fn.apply(window, e.args)
        } catch (err) {
          realSetTimeout(function () {
            throw err
          }, 0)
        }
      }
    }

    window.setTimeout = function (fn, ms) {
      if (drawn && typeof fn === 'function' && !(ms > 4) && !document.hidden) {
        var e = { id: nextId++, fn: fn, args: Array.prototype.slice.call(arguments, 2), cancelled: false }
        waiting.push(e)
        byId.set(e.id, e)
        stats.deferred++
        if (!raf) {
          raf = requestAnimationFrame(function () {
            run(true)
          })
          // rAF stops when the page is hidden mid-frame; never stall longer than this.
          fallback = realSetTimeout(function () {
            run(false)
          }, 250)
        }
        return e.id
      }
      if (!started && typeof fn === 'function' && !(ms > 0)) {
        var im = { id: nextId++, fn: fn, args: Array.prototype.slice.call(arguments, 2), cancelled: false }
        byId.set(im.id, im)
        stats.immediate++
        if (immediate.push(im) === 1) channel.port2.postMessage(0)
        return im.id
      }
      return realSetTimeout.apply(window, arguments)
    }

    window.clearTimeout = function (id) {
      var e = byId.get(id)
      if (e) {
        e.cancelled = true
        byId.delete(id)
        return
      }
      return realClearTimeout(id)
    }

    return stats
  })()

  var state = {
    saveDir: cfg.saveDir || null,
    known: new Map(), // path -> { mtime, size, hash }
    lazy: new Map(), // path -> { size, mtime, loaded }
    queue: new Map(), // path -> { data|null, mtime }
    inflight: false,
    online: true,
    lastSync: 0,
    failures: 0,
    ready: false,
    parentFullscreen: false,
  }

  // ---------------------------------------------------------------- messaging

  function post(type, data) {
    if (!inFrame) return
    var msg = { type: 'renplay:' + type, slug: cfg.slug }
    if (data) for (var k in data) msg[k] = data[k]
    try {
      window.parent.postMessage(msg, location.origin)
    } catch (e) {}
  }

  function status() {
    post('sync', {
      pending: state.queue.size + (state.inflight ? 1 : 0),
      online: state.online,
      lastSync: state.lastSync,
      saveDir: state.saveDir,
    })
  }

  // ---------------------------------------------------------------- IndexedDB

  var dbPromise = null
  function idb() {
    if (!window.indexedDB) return Promise.reject(new Error('no indexedDB'))
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open('renplay', 1)
        req.onupgradeneeded = function () {
          var s = req.result.createObjectStore('files', { keyPath: 'key' })
          s.createIndex('slug', 'slug')
        }
        req.onsuccess = function () {
          resolve(req.result)
        }
        req.onerror = function () {
          reject(req.error)
        }
      })
    }
    return dbPromise
  }

  function idbTx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', mode)
        var out = fn(tx.objectStore('files'))
        tx.oncomplete = function () {
          resolve(out && out.result !== undefined ? out.result : out)
        }
        tx.onerror = function () {
          reject(tx.error)
        }
        tx.onabort = function () {
          reject(tx.error)
        }
      })
    })
  }

  // Mirror entries are keyed by path only: ~/.renpy is shared by all games.
  function idbPut(path, data, mtime, synced) {
    return idbTx('readwrite', function (s) {
      s.put({ key: path, slug: cfg.slug, path: path, data: data, mtime: mtime, synced: synced ? 1 : 0 })
    }).catch(function () {})
  }

  function idbAll() {
    return idbTx('readonly', function (s) {
      return s.getAll()
    }).catch(function () {
      return []
    })
  }

  function idbMarkSynced(path, mtime) {
    return idbTx('readwrite', function (s) {
      var r = s.get(path)
      r.onsuccess = function () {
        var v = r.result
        if (!v || v.mtime !== mtime) return
        if (v.data === null) s.delete(path)
        else {
          v.synced = 1
          s.put(v)
        }
      }
    }).catch(function () {})
  }

  // ---------------------------------------------------------------- helpers

  function b64ToBytes(b64) {
    var bin = atob(b64)
    var out = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  function hash(bytes) {
    // FNV-1a over the bytes plus the length; enough to skip identical rewrites.
    var h = 0x811c9dc5
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i]
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16) + ':' + bytes.length
  }

  function isJunk(path) {
    var base = path.slice(path.lastIndexOf('/') + 1)
    return base.charAt(0) === '.' || /\.(tmp|new)$/.test(base) || base === 'text.txt'
  }

  function fetchJSON(url, opts, tries) {
    tries = tries || 1
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }).catch(function (e) {
      if (tries <= 1) throw e
      return new Promise(function (res) {
        setTimeout(res, 600)
      }).then(function () {
        return fetchJSON(url, opts, tries - 1)
      })
    })
  }

  function mkdirp(dir) {
    var parts = dir.split('/')
    var cur = ''
    for (var i = 1; i < parts.length; i++) {
      cur += '/' + parts[i]
      try {
        FS.mkdir(cur)
      } catch (e) {}
    }
  }

  function setTimes(full, mtime) {
    try {
      FS.utime(full, mtime, mtime)
    } catch (e) {}
  }

  function writeLocal(path, bytes, mtime) {
    var full = HOME + '/' + path
    mkdirp(full.slice(0, full.lastIndexOf('/')))
    FS.writeFile(full, bytes)
    setTimes(full, mtime)
  }

  /** Synchronous binary GET (Ren'Py reads files synchronously). */
  function syncFetch(path) {
    var xhr = new XMLHttpRequest()
    xhr.open('GET', API + '/raw?path=' + encodeURIComponent(path), false)
    xhr.overrideMimeType('text/plain; charset=x-user-defined')
    xhr.send(null)
    if (xhr.status !== 200) throw new Error('lazy fetch failed ' + xhr.status)
    var s = xhr.responseText
    var out = new Uint8Array(s.length)
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
    return out
  }

  /**
   * Creates a file whose bytes are fetched the first time something reads it.
   * stat() and directory listings use the known size and never fetch.
   */
  function createLazy(path, size, mtime) {
    var full = HOME + '/' + path
    mkdirp(full.slice(0, full.lastIndexOf('/')))
    FS.writeFile(full, new Uint8Array(0))
    var node = FS.lookupPath(full).node
    var backing = null
    var loaded = false
    var entry = { size: size, mtime: mtime, loaded: false }
    state.lazy.set(path, entry)
    Object.defineProperty(node, 'contents', {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!loaded) {
          loaded = true
          entry.loaded = true
          try {
            backing = syncFetch(path)
            log('loaded', path, 'on demand')
          } catch (e) {
            console.warn('[renplay] could not load', path, e)
            backing = new Uint8Array(0)
          }
          node.usedBytes = backing.length
        }
        return backing
      },
      set: function (v) {
        loaded = true
        entry.loaded = true
        backing = v
      },
    })
    node.usedBytes = size
    setTimes(full, mtime)
    state.known.set(path, { mtime: mtime, size: size, hash: null })
  }

  function walk(dir, prefix, out) {
    var names
    try {
      names = FS.readdir(dir)
    } catch (e) {
      return out
    }
    for (var i = 0; i < names.length; i++) {
      var n = names[i]
      if (n === '.' || n === '..') continue
      var full = dir + '/' + n
      var rel = prefix ? prefix + '/' + n : n
      var st
      try {
        st = FS.stat(full)
      } catch (e) {
        continue
      }
      if (FS.isDir(st.mode)) walk(full, rel, out)
      else if (FS.isFile(st.mode) && !isJunk(rel)) out.push({ path: rel, full: full, size: st.size, mtime: +st.mtime })
    }
    return out
  }

  // ---------------------------------------------------------------- sync

  var scanTimer = null
  function scheduleScan(delay) {
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(function () {
      scanTimer = null
      scan()
    }, delay === undefined ? 250 : delay)
  }

  /** Compares ~/.renpy with what the server has and queues the differences. */
  function scan() {
    if (!state.ready || typeof FS === 'undefined') return
    var seen = new Set()
    var files = walk(HOME, '', [])
    for (var i = 0; i < files.length; i++) {
      var f = files[i]
      seen.add(f.path)
      var k = state.known.get(f.path)
      var lz = state.lazy.get(f.path)
      if (lz && !lz.loaded) continue
      if (k && k.mtime === f.mtime && k.size === f.size) continue
      var bytes
      try {
        bytes = FS.readFile(f.full)
      } catch (e) {
        continue
      }
      var h = hash(bytes)
      if (k && k.hash === h) {
        k.mtime = f.mtime
        continue
      }
      state.known.set(f.path, { mtime: f.mtime, size: f.size, hash: h })
      enqueue(f.path, bytes, f.mtime)
    }
    state.known.forEach(function (_v, path) {
      if (!seen.has(path)) {
        state.known.delete(path)
        state.lazy.delete(path)
        enqueue(path, null, Date.now())
      }
    })
  }

  function enqueue(path, bytes, mtime) {
    var data = bytes ? new Uint8Array(bytes) : null
    state.queue.set(path, { data: data, mtime: mtime })
    idbPut(path, data, mtime, false)
    pump()
  }

  function pump() {
    if (state.inflight || !state.queue.size) {
      status()
      return
    }
    var path = state.queue.keys().next().value
    var item = state.queue.get(path)
    state.queue.delete(path)
    state.inflight = true
    status()
    var url = API + '/file?path=' + encodeURIComponent(path)
    var req = item.data
      ? fetch(url, { method: 'PUT', body: item.data, headers: { 'content-type': 'application/octet-stream', 'x-mtime': String(item.mtime) } })
      : fetch(url, { method: 'DELETE' })
    req
      .then(function (r) {
        if (!r.ok && !(r.status === 404 && !item.data)) throw new Error('HTTP ' + r.status)
        state.online = true
        state.failures = 0
        state.lastSync = Date.now()
        idbMarkSynced(path, item.mtime)
      })
      .catch(function (e) {
        console.warn('[renplay] upload failed for', path, e)
        // Keep the newest version queued.
        if (!state.queue.has(path)) state.queue.set(path, item)
        state.online = false
        state.failures++
      })
      .then(function () {
        state.inflight = false
        if (!state.online) {
          status()
          setTimeout(pump, Math.min(30000, 1000 * Math.pow(2, Math.min(5, state.failures))))
        } else pump()
      })
  }

  function flush(timeoutMs) {
    scan()
    return new Promise(function (resolve) {
      var start = Date.now()
      ;(function wait() {
        if ((!state.queue.size && !state.inflight) || Date.now() - start > (timeoutMs || 8000)) {
          resolve(!state.queue.size && !state.inflight)
          return
        }
        setTimeout(wait, 100)
      })()
    })
  }

  // ---------------------------------------------------------------- boot

  /** Saves left by the previous sync client in Ren'Py's own IndexedDB (IDBFS). */
  function legacyIdbfs() {
    if (!window.indexedDB) return Promise.resolve([])
    var flag = 'renplay:legacy-migrated'
    try {
      if (localStorage.getItem(flag)) return Promise.resolve([])
    } catch (e) {}
    return new Promise(function (resolve) {
      var req = indexedDB.open(HOME)
      req.onupgradeneeded = function () {
        // Database did not exist; do not create it.
        req.transaction.abort()
      }
      req.onerror = function () {
        resolve([])
      }
      req.onsuccess = function () {
        var db = req.result
        if (!db.objectStoreNames.contains('FILE_DATA')) {
          db.close()
          resolve([])
          return
        }
        var out = []
        var cur = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA').openCursor()
        cur.onsuccess = function () {
          var c = cur.result
          if (!c) {
            db.close()
            try {
              localStorage.setItem(flag, '1')
            } catch (e) {}
            resolve(out)
            return
          }
          var v = c.value
          if (typeof c.key === 'string' && c.key.indexOf(HOME + '/') === 0 && v && v.contents) {
            out.push({ path: c.key.slice(HOME.length + 1), data: new Uint8Array(v.contents), mtime: +new Date(v.timestamp) })
          }
          c.continue()
        }
        cur.onerror = function () {
          resolve(out)
        }
      }
    })
  }

  function boot() {
    var server = null
    return fetchJSON(API + '/boot', { cache: 'no-store' }, 3)
      .then(function (b) {
        server = b
      })
      .catch(function (e) {
        console.warn('[renplay] save server unreachable, using the local copy', e)
        state.online = false
      })
      .then(function () {
        return Promise.all([idbAll(), legacyIdbfs()])
      })
      .then(function (res) {
        var local = res[0]
        var legacy = res[1]
        var serverFiles = new Map()
        if (server) {
          if (server.saveDir) state.saveDir = server.saveDir
          server.files.forEach(function (f) {
            serverFiles.set(f.path, f)
          })
        }
        // 1. Server state.
        serverFiles.forEach(function (f) {
          var bytes = b64ToBytes(f.data)
          writeLocal(f.path, bytes, f.mtime)
          state.known.set(f.path, { mtime: f.mtime, size: bytes.length, hash: hash(bytes) })
        })
        if (server && server.lazy) {
          server.lazy.forEach(function (f) {
            if (!serverFiles.has(f.path)) createLazy(f.path, f.size, f.mtime)
          })
        }
        // 2. Local changes the server has not seen (written while offline or
        //    interrupted). Offline: the whole local copy.
        local.forEach(function (e) {
          var srv = serverFiles.get(e.path)
          if (!server) {
            if (e.data) writeLocal(e.path, e.data, e.mtime)
            if (e.synced) state.known.set(e.path, { mtime: e.mtime, size: e.data ? e.data.length : 0, hash: e.data ? hash(e.data) : null })
            else if (e.data) state.queue.set(e.path, { data: e.data, mtime: e.mtime })
            return
          }
          if (e.synced) return
          if (srv && srv.mtime > e.mtime) return
          if (e.data) {
            writeLocal(e.path, e.data, e.mtime)
            state.known.set(e.path, { mtime: e.mtime, size: e.data.length, hash: hash(e.data) })
            state.queue.set(e.path, { data: e.data, mtime: e.mtime })
          } else {
            try {
              FS.unlink(HOME + '/' + e.path)
            } catch (er) {}
            state.known.delete(e.path)
            state.queue.set(e.path, { data: null, mtime: e.mtime })
          }
        })
        // 3. One-time migration of saves kept by the old IDBFS-based client.
        var migrated = 0
        legacy.forEach(function (e) {
          if (!server) return
          var top = e.path.split('/')[0]
          if (top !== state.saveDir && top !== 'tokens' && top !== 'persistent') {
            if (state.known.has(e.path) || state.lazy.has(e.path)) return
          }
          var srv = serverFiles.get(e.path)
          var lzMeta = state.lazy.get(e.path)
          if ((srv && srv.mtime >= e.mtime) || (lzMeta && lzMeta.mtime >= e.mtime)) return
          if (isJunk(e.path)) return
          if (top === state.saveDir || top === 'tokens' || top === 'persistent') writeLocal(e.path, e.data, e.mtime)
          state.queue.set(e.path, { data: e.data, mtime: e.mtime })
          migrated++
        })
        if (migrated) log('migrating', migrated, 'saves from the old browser storage')
        state.ready = true
        log('saves ready', { saveDir: state.saveDir, files: serverFiles.size, lazy: state.lazy.size, queued: state.queue.size })
        pump()
      })
  }

  // ---------------------------------------------------------------- Emscripten hooks

  var Module = (window.Module = window.Module || {})
  Module.preRun = Module.preRun || []
  if (cfg.engineBase) {
    var prevLocate = Module.locateFile
    Module.locateFile = function (path, prefix) {
      if (/^renpy\.(wasm|data)$/.test(path)) return cfg.engineBase + path
      return prevLocate ? prevLocate(path, prefix) : prefix + path
    }
  }

  /** Size of game.zip, known before renpy-pre.js streams it into the FS. */
  var gameZipSize = 0

  /**
   * Faster file creation for unpacking game.zip (tens of thousands of files).
   * Emscripten finds out that a new file does not exist yet by throwing and
   * catching "not found" twice per file, which costs about 2 s for a big game.
   * These versions check the name table directly and otherwise do exactly what
   * Emscripten does. Only in-memory (MEMFS) directories are affected.
   */
  function speedUpFs() {
    if (typeof MEMFS === 'undefined' || !MEMFS.ops_table || !FS.nameTable) return
    var memDir = MEMFS.ops_table.dir.node
    var find = function (dir, name) {
      var hash = FS.hashName(dir.id, name)
      for (var n = FS.nameTable[hash]; n; n = n.name_next) if (n.parent.id === dir.id && n.name === name) return n
      return null
    }
    var mayCreate = FS.mayCreate
    FS.mayCreate = function (dir, name) {
      if (dir.node_ops !== memDir) return mayCreate.call(FS, dir, name)
      return find(dir, name) ? 20 : FS.nodePermissions(dir, 'wx')
    }
    var open = FS.open
    FS.open = function (path, flags, mode) {
      var f = typeof flags === 'string' ? FS_modeStringToFlags(flags) : flags
      // O_CREAT without O_EXCL on a plain path: create the node first, so the
      // original open finds it instead of throwing to learn it is missing.
      if (typeof path === 'string' && path && f & 64 && !(f & 128)) {
        try {
          var parent = FS.lookupPath(path, { parent: true }).node
          var name = PATH.basename(PATH.normalize(path))
          if (parent && parent.node_ops === memDir && name && name !== '.' && name !== '..' && !find(parent, name)) {
            var m = typeof mode === 'undefined' ? 438 : mode
            FS.mknod(path, (m & 4095) | 32768, 0)
          }
        } catch (e) {}
      }
      var stream = open.call(FS, path, flags, mode)
      if (path === '/game.zip' && stream) gameZipNode = stream.node
      return stream
    }
    // renpy-pre.js streams game.zip in chunks; MEMFS would grow the buffer in
    // 12.5% steps, copying the whole archive each time. Grow it once, to size.
    var gameZipNode = null
    var expand = MEMFS.expandFileStorage
    MEMFS.expandFileStorage = function (node, capacity) {
      if (node === gameZipNode && gameZipSize > capacity) capacity = gameZipSize
      return expand.call(MEMFS, node, capacity)
    }
  }

  function preRun() {
    try {
      speedUpFs()
    } catch (e) {
      console.warn('[renplay] FS speedups not applied', e)
    }
    // Keep ~/.renpy in memory; renplay replaces IDBFS with the server.
    var origMount = FS.mount
    FS.mount = function (type, opts, mountpoint) {
      if (mountpoint === HOME && typeof IDBFS !== 'undefined' && type === IDBFS) return null
      return origMount.apply(FS, arguments)
    }
    FS.syncfs = function (populate, callback) {
      if (typeof populate === 'function') {
        callback = populate
        populate = false
      }
      if (!populate) scheduleScan()
      if (callback) setTimeout(function () {
        callback(null)
      }, 0)
    }
    Module.addRunDependency('renplay-saves')
    boot()
      .catch(function (e) {
        console.error('[renplay] save restore failed', e)
        state.ready = true
      })
      .then(function () {
        Module.removeRunDependency('renplay-saves')
      })
  }

  // ---------------------------------------------------------------- game.zip cache

  var origFetch = window.fetch.bind(window)
  var CACHE = 'renplay-gamezip-v1'
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url
    if (url && 'caches' in window && /(^|\/)game\.zip(\?|$)/.test(url)) {
      var abs = new URL(url, location.href).toString()
      return caches
        .open(CACHE)
        .then(function (cache) {
          return cache.match(abs).then(function (hit) {
            if (hit) {
              log('game.zip from cache')
              gameZipSize = Number(hit.headers.get('content-length')) || 0
              return hit
            }
            return origFetch(input, init).then(function (res) {
              gameZipSize = Number(res.headers.get('content-length')) || 0
              if (res.ok) {
                cache.keys().then(function (keys) {
                  keys.forEach(function (k) {
                    if (k.url.indexOf('/g/' + cfg.slug + '/') !== -1 && k.url !== abs) cache.delete(k)
                  })
                })
                cache.put(abs, res.clone()).catch(function () {})
              }
              return res
            })
          })
        })
        .catch(function () {
          return origFetch(input, init)
        })
    }
    return origFetch(input, init)
  }

  // ---------------------------------------------------------------- Ren'Py bridge

  function exec(py, timeoutMs) {
    if (typeof window.renpy_exec !== 'function') return Promise.reject(new Error('bridge not ready'))
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error('timeout'))
      }, timeoutMs || 5000)
      window.renpy_exec(py).then(
        function (v) {
          clearTimeout(t)
          resolve(v)
        },
        function (e) {
          clearTimeout(t)
          reject(e)
        },
      )
    })
  }

  function pyStr(s) {
    return JSON.stringify(String(s))
  }

  function verifySaveDir() {
    exec('result = [config.save_directory, config.screen_width, config.screen_height, config.name, config.version]', 20000)
      .then(function (r) {
        var sd = r && r[0]
        post('info', { saveDir: sd, screen: [r[1], r[2]], name: r[3], version: r[4] })
        if (!sd || sd === state.saveDir) return
        log('save folder is', sd, '(server had', state.saveDir, ')')
        return fetchJSON(API + '/save-dir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ saveDir: sd }) }).then(function (res) {
          state.saveDir = sd
          // The game's real folder was only listed lazily; reload once so its
          // saves and persistent data are restored before Ren'Py starts.
          var key = 'renplay:reloaded:' + cfg.slug
          var hasFiles = false
          state.lazy.forEach(function (_v, p) {
            if (p.indexOf(sd + '/') === 0) hasFiles = true
          })
          if (res.changed && hasFiles && !sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1')
            flush(4000).then(function () {
              location.reload()
            })
          }
        })
      })
      .catch(function (e) {
        log('could not read config.save_directory', e && e.message)
      })
  }

  /** Loads a save slot as soon as Ren'Py starts its next interaction. */
  function loadSlot(slot) {
    // The bridge exec()s in the store, where `renpy` is renpy.exports (do not
    // `import renpy`, that is the internal package). Locals are separate, so the
    // callback captures what it needs through default arguments. Anything but
    // renpy.load's own control flow exception must stay inside: an error in an
    // interact callback would crash the game.
    var py =
      'def _renplay_load(renpy=renpy, slot=' + pyStr(slot) + ', st={"done": False}):\n' +
      '    if st["done"]:\n' +
      '        return\n' +
      '    st["done"] = True\n' +
      '    try:\n' +
      '        ok = renpy.can_load(slot)\n' +
      '    except Exception:\n' +
      '        ok = False\n' +
      '    if ok:\n' +
      '        renpy.load(slot)\n' +
      'config.interact_callbacks.append(_renplay_load)\n' +
      'renpy.restart_interaction()\n' +
      'result = True\n'
    return exec(py, 30000)
  }

  function autosave() {
    return exec(
      'result = False\n' +
        'if not renpy.context()._main_menu and config.has_autosave:\n' +
        '    renpy.force_autosave(take_screenshot=True, block=True)\n' +
        '    result = True\n',
      6000,
    ).catch(function () {
      return false
    })
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || typeof e.data.type !== 'string') return
    var d = e.data
    switch (d.type) {
      case 'renplay:flush':
        flush(d.timeout).then(function (ok) {
          post('flushed', { ok: ok, id: d.id })
        })
        break
      case 'renplay:save-and-exit':
        autosave()
          .then(function () {
            return flush(8000)
          })
          .then(function (ok) {
            post('flushed', { ok: ok, id: d.id })
          })
        break
      case 'renplay:load':
        loadSlot(d.slot).catch(function (er) {
          console.warn('[renplay] load failed', er)
        })
        break
      case 'renplay:reload-saves':
        fetchJSON(API + '/boot', { cache: 'no-store' }).then(function (b) {
          b.files.forEach(function (f) {
            var bytes = b64ToBytes(f.data)
            var k = state.known.get(f.path)
            if (k && k.hash === hash(bytes)) return
            writeLocal(f.path, bytes, f.mtime)
            state.known.set(f.path, { mtime: f.mtime, size: bytes.length, hash: hash(bytes) })
          })
          return exec('import renpy.loadsave as _rl\n_rl.location.scan()\nrenpy.restart_interaction()\nresult = True')
        })
        break
      case 'renplay:fullscreen-state':
        state.parentFullscreen = !!d.value
        break
      case 'renplay:focus':
        var c = document.getElementById('canvas')
        if (c) c.focus()
        window.focus()
        break
    }
  })

  // Called after renpy-pre.js (see renderIndex), so this preRun runs first:
  // Emscripten runs preRun callbacks in reverse order of registration.
  window.__renplayLate = function () {
    Module.preRun.push(preRun)

    // game.zip is only read by the unpacker; free its memory (often hundreds
    // of MB) once Ren'Py moves on to loading the script.
    var freeGameZip = function () {
      try {
        FS.unlink('/game.zip')
        log('freed game.zip from memory')
      } catch (e) {}
    }
    var origPrint = Module.print
    Module.print = function (s) {
      if (typeof s === 'string' && s.indexOf('Loading script') === 0) setTimeout(freeGameZip, 0)
      return origPrint ? origPrint.apply(this, arguments) : console.log(s)
    }

    var origPresplashEnd = window.presplashEnd
    window.presplashEnd = function () {
      if (origPresplashEnd) origPresplashEnd()
      post('ready')
      setTimeout(verifySaveDir, 500)
    }

    var origProgress = window.progress
    var lastProgressPost = 0
    window.progress = function (done, total) {
      if (origProgress) origProgress(done, total)
      var now = Date.now()
      if (now - lastProgressPost > 100 || done >= total) {
        lastProgressPost = now
        post('progress', { done: done, total: total })
      }
    }

    var origAtExit = window.atExit
    window.atExit = function () {
      flush(4000).then(function () {
        if (inFrame) post('exited')
        else if (origAtExit) origAtExit()
      })
    }

    if (inFrame) {
      window.setFullscreen = function (enable) {
        post('fullscreen', { enable: !!enable })
      }
      window.isFullscreen = function () {
        return state.parentFullscreen ? 1 : 0
      }
    }
  }

  // Safety nets: periodic scan, and flush when the page is hidden.
  setInterval(function () {
    scan()
  }, 15000)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') scan()
  })
  window.addEventListener('pagehide', function () {
    scan()
  })

  window.__renplayRuntime = {
    state: state,
    pacing: pacing,
    flush: flush,
    scan: scan,
    loadSlot: loadSlot,
    autosave: autosave,
  }
})()
