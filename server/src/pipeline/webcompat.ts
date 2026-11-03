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
 * - old import hooks: libraries games bundle (six in old requests) register
 *   finders with only find_module(), which Python 3.12 no longer calls.
 * - Python 2 syntax: games made for Ren'Py 7 (Python 2) can have print
 *   statements and 0-prefixed numbers in their Python, which Ren'Py 8
 *   compiles as Python 3. Code that fails for those reasons is fixed where the
 *   error points and compiled again.
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

        import re

        # Ren'Py retries such code with renpy.compat.fixes, which tokenizes it; Python 3.12's
        # tokenizer refuses 0-prefixed numbers, so that retry fails. This one fixes what the
        # error points at and tries again.
        compile_py = renpy.python.py_compile
        statement = re.compile(r"^([ \\t]*)print\\b(?![ \\t]*[(=.])[ \\t]*(.*?)[ \\t]*$", re.M)
        number = re.compile(r"(?<![\\w.])0+([0-9]+)(?![\\w.])")

        def call(m):
            body = m.group(2)
            if body.endswith(","):
                return '%sprint(%s, end=" ")' % (m.group(1), body[:-1])
            return "%sprint(%s)" % (m.group(1), body)

        def fix(source, e, first):
            msg = str(e.msg)
            if "print" in msg:
                return statement.sub(call, source)
            if "leading zeros" in msg and e.lineno is not None and e.offset:
                lines = source.split("\\n")
                i = e.lineno - first
                if 0 <= i < len(lines):
                    line = lines[i]
                    near = [n for n in number.finditer(line) if abs(n.start() - (e.offset - 1)) <= 2]
                    m = near[0] if near else None
                    if m:
                        digits = m.group(1)
                        # 010 was octal in Python 2.
                        literal = "0o" + digits if re.match(r"^[0-7]+$", digits) else digits.lstrip("0") or "0"
                        lines[i] = line[: m.start()] + literal + line[m.end() :]
                        return "\\n".join(lines)
            return None

        def py_compile(source, mode, *args, **kwargs):
            try:
                return compile_py(source, mode, *args, **kwargs)
            except SyntaxError as e:
                if not isinstance(source, str):
                    raise
                error = e
            first = getattr(source, "linenumber", None) or kwargs.get("lineno") or (args[1] if len(args) > 1 else 1)
            fixed = source
            for _ in range(50):
                attempt = fix(str(fixed), error, first)
                if attempt is None or attempt == str(fixed):
                    raise error
                try:
                    fixed = type(source)(attempt, source.filename, source.linenumber)
                except Exception:
                    fixed = attempt
                try:
                    return compile_py(fixed, mode, *args, **kwargs)
                except SyntaxError as e:
                    error = e
            raise error

        renpy.python.py_compile = py_compile

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
