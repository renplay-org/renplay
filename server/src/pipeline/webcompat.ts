/**
 * A script added to every build: stand-ins for what desktop games expect and
 * a browser does not have. It runs as `python early`, before any game code.
 *
 * - ssl: the web build has no _ssl, so a game that imports ssl at init (news
 *   feeds, update checks) crashes on start. A stand-in module makes the import
 *   work and every use fail like being offline, which such games handle.
 * - threads: they cannot start. A thread of the game's own (its target or
 *   class comes from the store) that fails to start counts as finished
 *   instead of raising; Ren'Py's own threads are left alone.
 * - socket.AF_UNIX: missing in the browser's Python; Discord status libraries
 *   use it to look for Discord and handle not finding it.
 * - urllib3: Ren'Py's engine bundles it and on the web (sys.platform is emscripten) it
 *   loads urllib3.contrib.emscripten, which needs Pyodide's js module. A stand-in whose
 *   inject_into_urllib3() does nothing keeps the ordinary socket code, so `import requests`
 *   works and a request fails like being offline.
 * - __builtin__: Python 2's name for the builtins module, which games made for Ren'Py 7
 *   import. It is the same module under its old name.
 * - old import hooks: libraries games bundle (six in old requests) register
 *   finders with only find_module(), which Python 3.12 no longer calls.
 * - Python 2 code and syntax are py2compat.ts's, which loads before the game.
 */
export const WEB_COMPAT_PATH = 'renplay_web.rpy'

export const WEB_COMPAT = `# Added by Renplay to the browser build: stand-ins for what a desktop game
# expects and a browser does not have. https://github.com/renplay-org/renplay

python early:

    def _renplay_web_compat():
        import sys
        import threading
        import types

        if not renpy.emscripten:
            return

        try:
            import ssl
        except ImportError:
            class SSLError(OSError):
                pass

            def unavailable(*args, **kwargs):
                raise SSLError("TLS is not available in the browser")

            # Libraries read constants at import: features are off, numbers 0.
            def missing(name):
                if name.startswith("__"):
                    raise AttributeError(name)
                if name.startswith("HAS_"):
                    return False
                if name == "OPENSSL_VERSION":
                    return ""
                if name == "OPENSSL_VERSION_INFO":
                    return (0, 0, 0, 0, 0)
                if name[:1].isupper() and (name.isupper() or "_" in name):
                    return 0
                return unavailable

            stub = types.ModuleType("ssl")
            stub.SSLError = SSLError
            stub.SSLContext = unavailable
            stub.create_default_context = unavailable
            stub.wrap_socket = unavailable
            stub.__getattr__ = missing
            sys.modules["ssl"] = stub

        # urllib3 2.x injects a Pyodide-only backend on emscripten, and that needs Pyodide's js.
        emscripten = types.ModuleType("urllib3.contrib.emscripten")
        emscripten.inject_into_urllib3 = lambda: None
        emscripten.extract_from_urllib3 = lambda: None
        sys.modules["urllib3.contrib.emscripten"] = emscripten

        # Python 2's name for builtins: games made for Ren'Py 7 import it.
        import builtins
        sys.modules.setdefault("__builtin__", builtins)

        start = threading.Thread.start

        def start_or_skip(self):
            try:
                start(self)
            except RuntimeError:
                target = getattr(self, "_target", None)
                owner = target if target is not None else type(self)
                if not getattr(owner, "__module__", "").startswith("store"):
                    raise
                self.is_alive = lambda: False
                self.join = lambda timeout=None: None
                print("Renplay: threads do not run in the browser, skipped %r" % (owner,))

        threading.Thread.start = start_or_skip

        # Import hooks with only find_module() (six before 1.16, bundled with old requests and
        # urllib3) stopped working in Python 3.12, and Ren'Py 8.5 runs 3.12. This finder asks
        # them the old way.
        import importlib.util

        class LegacyFinders(object):
            def find_spec(self, fullname, path=None, target=None):
                for finder in list(sys.meta_path):
                    if finder is self or hasattr(finder, "find_spec") or not hasattr(finder, "find_module"):
                        continue
                    try:
                        loader = finder.find_module(fullname, path)
                    except Exception:
                        loader = None
                    if loader is not None:
                        return importlib.util.spec_from_loader(fullname, loader)
                return None

        sys.meta_path.insert(0, LegacyFinders())

        # Discord status libraries look for Discord over a Unix socket; on a PC without
        # Discord that fails and they carry on. Here the constant is missing altogether.
        import socket

        if not hasattr(socket, "AF_UNIX"):
            socket.AF_UNIX = 1

        # connect_ex() returns an error number, which such libraries check; here some
        # failures (an unknown address family) raise instead.
        import errno

        connect_ex = socket.socket.connect_ex

        def connect_ex_or_errno(self, address):
            try:
                return connect_ex(self, address)
            except OSError as e:
                return e.errno or errno.ECONNREFUSED

        socket.socket.connect_ex = connect_ex_or_errno

    _renplay_web_compat()
    del _renplay_web_compat
`
