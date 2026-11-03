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
 */
export const WEB_COMPAT_PATH = 'renplay_web.rpy'

export const WEB_COMPAT = `# Added by Renplay to the browser build: stand-ins for what a desktop game
# expects and a browser does not have. https://github.com/renplay-web/renplay

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

    _renplay_web_compat()
    del _renplay_web_compat
`
