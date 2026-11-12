/**
 * A script added to every build, before the game's own files, so that code written for Python 2
 * (games made with Ren'Py 7 and older) behaves on the Ren'Py 8 engine as it did there.
 *
 * Ren'Py 8 marks Python loaded from an old game's .rpyc as Python 2 (`PyExpr.py == 2`). Only that
 * code is rewritten, as Ren'Py compiles it, so Ren'Py 8 games and the engine run as before:
 * integer `/`, lists from `keys()`/`values()`/`items()`/`map()`/`filter()`/`zip()`, `cmp=` and
 * Python 2 ordering of mixed values when Python 3 refuses (sort, min, max), Python 2 `round`,
 * `iteritems()`/`has_key()`/`next()`/`decode()` on anything, and `__cmp__`, `__nonzero__`,
 * `__div__`, `next` and `__unicode__` on classes. The first such code brings back Python 2 names
 * (`long`, `cmp`, `string.letters`, `sys.maxint`, `cPickle`...). Python 2 syntax that fails to
 * compile is fixed where the error points (Ren'Py's own fixer tokenizes, which Python 3.12 refuses
 * on that very code). A Python 2 game's own .py modules get the same treatment.
 *
 * Ren'Py compiles each file's Python as it loads the file, so this name sorts before any game file.
 */
import { OLD_SCREENS } from './py2screens.js'

export const PY2_COMPAT_PATH = '!renplay_py2.rpy'

export const PY2_COMPAT = String.raw`# Added by Renplay to the browser build: lets Python 2 code from games made with
# Ren'Py 7 and older run on the Ren'Py 8 engine. https://github.com/renplay-org/renplay

python early:

    def _renplay_py2():
        import ast
        import builtins
        import copy
        import functools
        import importlib.util
        import itertools
        import math
        import numbers
        import re
        import sys
        import types
        # The store's dict, list and object are Ren'Py's revertable ones: these mean Python's own.
        # Literals ([] and {}) still make the revertable kinds, so the script's own state uses calls.
        from builtins import dict, list, object, sorted, tuple

        # In game code renpy is renpy.exports: the engine's own modules come from sys.modules.
        def engine(name):
            return sys.modules.get("renpy." + name) or getattr(renpy, name, None)
        python_module = engine("python")
        # Installed once per load of the engine's modules (a reload brings back the originals).
        if getattr(python_module.py_compile, "renplay2", False):
            return

        R = types.ModuleType("renplay_py2")
        sys.modules["renplay_py2"] = R
        builtins.__renplay2__ = R

        # Functions that may end up in saves (cmp in the store) are pickled by reference.
        def export(f):
            f.__module__ = "renplay_py2"
            f.__qualname__ = f.__name__
            setattr(R, f.__name__, f)
            return f

        # ---- Python 2 ordering ----------------------------------------------------

        def sign(n):
            return (n > 0) - (n < 0)
        def type_name(x):
            name = type(x).__name__
            return "str" if name == "bytes" else name
        @export
        def cmp(a, b):
            if a is b:
                return 0
            for x, y, s in ((a, b, 1), (b, a, -1)):
                f = getattr(type(x), "__cmp__", None)
                if f is not None:
                    r = f(x, y)
                    if r is not NotImplemented:
                        return s * sign(r)
            try:
                if a == b:
                    return 0
                if a < b:
                    return -1
                if b < a:
                    return 1
            except TypeError:
                pass
            if isinstance(a, (tuple, list)) and isinstance(b, (tuple, list)) and isinstance(a, tuple) == isinstance(b, tuple):
                for x, y in zip(a, b):
                    c = cmp(x, y)
                    if c:
                        return c
                return sign(len(a) - len(b))
            if a is None:
                return -1
            if b is None:
                return 1
            na = isinstance(a, numbers.Number) and not isinstance(a, complex)
            nb = isinstance(b, numbers.Number) and not isinstance(b, complex)
            if na != nb:
                return -1 if na else 1
            ta, tb = type_name(a), type_name(b)
            if ta != tb:
                return -1 if ta < tb else 1
            if isinstance(a, dict) and isinstance(b, dict) and len(a) != len(b):
                return sign(len(a) - len(b))
            return sign(id(a) - id(b))

        py2_key = functools.cmp_to_key(cmp)
        def ordering_key(key):
            return py2_key if key is None else (lambda x: py2_key(key(x)))
        def with_cmp(key, compare):
            if compare is None:
                return key
            k = functools.cmp_to_key(compare)
            return k if key is None else (lambda x: k(key(x)))
        def sort_list(lst, cmp=None, key=None, reverse=False):
            key = with_cmp(key, cmp)
            try:
                lst.sort(key=key, reverse=reverse)
            except TypeError:
                if cmp is not None:
                    raise
                lst.sort(key=ordering_key(key), reverse=reverse)

        # ---- Calls whose Python 3 result differs ------------------------------------

        def call_sorted(f, iterable, cmp=None, key=None, reverse=False):
            items = list(iterable)
            try:
                return f(items, key=with_cmp(key, cmp), reverse=reverse)
            except TypeError:
                if cmp is not None:
                    raise
                return f(items, key=ordering_key(key), reverse=reverse)
        def call_extreme(f, *args, **kwargs):
            if len(args) == 1:
                args = (list(args[0]),)
            try:
                return f(*args, **kwargs)
            except TypeError:
                key = kwargs.pop("key", None)
                return f(*args, key=ordering_key(key), **kwargs)
        def call_map(f, function, *iterables):
            if function is None:
                if len(iterables) == 1:
                    return list(iterables[0])
                return list(itertools.zip_longest(*iterables))
            if len(iterables) > 1:
                return [function(*t) for t in itertools.zip_longest(*iterables)]
            return list(f(function, *iterables))
        def call_filter(f, function, iterable):
            kept = f(function, iterable)
            if isinstance(iterable, str):
                return "".join(kept)
            if isinstance(iterable, tuple):
                return tuple(kept)
            return list(kept)
        def call_list(f, *args, **kwargs):
            return list(f(*args, **kwargs))
        def call_round(f, number, ndigits=None):
            if not isinstance(number, numbers.Real):
                return f(number) if ndigits is None else f(number, ndigits)
            m = 10.0 ** (ndigits or 0)
            return math.copysign(math.floor(abs(number) * m + 0.5) / m, number)

        special = dict()

        @export
        def call(f, /, *args, **kwargs):
            try:
                handler = special.get(f)
            except TypeError:
                handler = None
            if handler is None:
                return f(*args, **kwargs)
            return handler(f, *args, **kwargs)

        views = (type({}.keys()), type({}.values()), type({}.items()))
        def missing_method(obj, name, args, kwargs):
            if name in ("iteritems", "viewitems"):
                return iter(obj.items()) if name == "iteritems" else obj.items()
            if name in ("iterkeys", "viewkeys"):
                return iter(obj.keys()) if name == "iterkeys" else obj.keys()
            if name in ("itervalues", "viewvalues"):
                return iter(obj.values()) if name == "itervalues" else obj.values()
            if name == "has_key":
                return args[0] in obj
            if name == "next":
                return next(obj, *args)
            raise AttributeError("%r object has no attribute %r" % (type(obj).__name__, name))
        @export
        def meth(obj, name, /, *args, **kwargs):
            if name == "sort" and isinstance(obj, list):
                return sort_list(obj, *args, **kwargs)
            if name == "decode" and isinstance(obj, str):
                return obj
            f = getattr(obj, name, None)
            if f is None:
                return missing_method(obj, name, args, kwargs)
            rv = f(*args, **kwargs)
            if name in ("keys", "values", "items") and isinstance(rv, views):
                return list(rv)
            return rv
        @export
        def div(a, b):
            if isinstance(a, int) and isinstance(b, int):
                return a // b
            return a / b

        # ---- Classes with Python 2 special methods ----------------------------------

        def comparison(f, test):
            def compare(self, other):
                try:
                    r = f(self, other)
                except (TypeError, AttributeError):
                    return NotImplemented
                if r is NotImplemented:
                    return r
                return test(r)
            return compare
        @export
        def py2_class(c):
            d = c.__dict__

            def put(name, value):
                if name not in d:
                    setattr(c, name, value)
            if "__nonzero__" in d:
                put("__bool__", d["__nonzero__"])
            if "__cmp__" in d:
                f = d["__cmp__"]
                put("__lt__", comparison(f, lambda r: r < 0))
                put("__le__", comparison(f, lambda r: r <= 0))
                put("__gt__", comparison(f, lambda r: r > 0))
                put("__ge__", comparison(f, lambda r: r >= 0))
                if "__eq__" not in d:
                    hashing = c.__hash__
                    put("__eq__", comparison(f, lambda r: r == 0))
                    put("__ne__", comparison(f, lambda r: r != 0))
                    c.__hash__ = hashing
            for old, new in (("__div__", "__truediv__"), ("__rdiv__", "__rtruediv__"), ("__idiv__", "__itruediv__")):
                if old in d:
                    put(new, d[old])
            if callable(d.get("next")):
                put("__next__", d["next"])
            if "__unicode__" in d:
                put("__str__", d["__unicode__"])
            return c

        # ---- Python 2 names, given back the first time Python 2 code compiles -------------

        def alias(module, name, value):
            if module is not None and not hasattr(module, name):
                setattr(module, name, value)
        def string_function(name):
            method = getattr(str, name)
            def f(s, *args):
                return method(s, *args)
            f.__name__ = "string_" + name
            return export(f)

        active = list()

        def activate():
            if active:
                return
            active.append(True)

            @export
            def apply(function, args=(), kwargs={}):
                return function(*args, **kwargs)

            store = sys.modules.get("store")
            names = {
                "long": int, "unichr": chr, "reduce": functools.reduce, "cmp": cmp,
                "raw_input": input, "intern": sys.intern, "apply": apply, "buffer": memoryview,
                "unicode": str, "basestring": str, "xrange": range,
            }
            for name, value in names.items():
                alias(store, name, value)
                setattr(R, name, value)

            import importlib
            alias(store, "reload", importlib.reload)
            R.reload = importlib.reload

            import string
            for name, value in (("letters", string.ascii_letters), ("lowercase", string.ascii_lowercase),
                                ("uppercase", string.ascii_uppercase), ("maketrans", str.maketrans),
                                ("atoi", int), ("atol", int), ("atof", float)):
                alias(string, name, value)
            @export
            def string_join(words, sep=" "):
                return sep.join(words)

            @export
            def string_split(s, sep=None, maxsplit=-1):
                return s.split(sep, maxsplit)

            for name, value in (("join", string_join), ("joinfields", string_join), ("split", string_split), ("splitfields", string_split)):
                alias(string, name, value)
            for name in ("upper", "lower", "strip", "lstrip", "rstrip", "replace", "find", "rfind", "index",
                         "rindex", "count", "zfill", "capitalize", "swapcase", "ljust", "rjust", "center",
                         "expandtabs", "translate"):
                alias(string, name, string_function(name))

            alias(sys, "maxint", sys.maxsize)
            alias(sys, "setdefaultencoding", lambda encoding: None)
            for old, new in (("izip", zip), ("imap", map), ("ifilter", filter),
                             ("ifilterfalse", itertools.filterfalse), ("izip_longest", itertools.zip_longest)):
                alias(itertools, old, new)

            import os
            alias(os, "getcwdu", os.getcwd)

            import collections
            import collections.abc
            for name in ("Mapping", "MutableMapping", "Sequence", "MutableSequence", "Iterable", "Iterator",
                         "Callable", "Set", "MutableSet", "Hashable", "Sized", "Container"):
                alias(collections, name, getattr(collections.abc, name))

            for name, value in (("StringType", str), ("UnicodeType", str), ("StringTypes", (str,)),
                                ("IntType", int), ("LongType", int), ("FloatType", float), ("BooleanType", bool),
                                ("ListType", list), ("TupleType", tuple), ("DictType", dict),
                                ("ClassType", type), ("InstanceType", object), ("NoneType", type(None))):
                alias(types, name, value)

            for old, new in (("cPickle", "pickle"), ("cStringIO", "io"), ("StringIO", "io"), ("Queue", "queue"),
                             ("ConfigParser", "configparser"), ("urlparse", "urllib.parse"), ("copy_reg", "copyreg"),
                             ("HTMLParser", "html.parser"), ("htmlentitydefs", "html.entities"),
                             ("thread", "_thread"), ("UserDict", "collections"), ("UserList", "collections")):
                if old not in sys.modules:
                    try:
                        sys.modules[old] = importlib.import_module(new)
                    except Exception:
                        pass

            def handle(handler, *functions):
                for f in functions:
                    if f is not None:
                        special[f] = handler

            revertable = engine("revertable")
            handle(call_sorted, builtins.sorted, getattr(store, "sorted", None), getattr(revertable, "revertable_sorted", None))
            handle(call_extreme, builtins.min, builtins.max)
            handle(call_map, builtins.map)
            handle(call_filter, builtins.filter)
            handle(call_list, builtins.zip, builtins.range)
            handle(call_round, builtins.round, getattr(store, "round", None))

        # ---- Rewriting Python 2 code as Ren'Py compiles it --------------------------

        methods = {"keys", "values", "items", "iteritems", "iterkeys", "itervalues", "viewkeys", "viewvalues",
                   "viewitems", "has_key", "sort", "next", "decode"}
        calls = {"sorted", "min", "max", "map", "filter", "zip", "range", "round"}

        def helper(name, node):
            return ast.copy_location(ast.Attribute(value=ast.Name(id="__renplay2__", ctx=ast.Load()), attr=name, ctx=ast.Load()), node)
        def simple(target):
            if isinstance(target, ast.Name):
                return True
            if isinstance(target, ast.Attribute):
                return isinstance(target.value, ast.Name)
            if isinstance(target, ast.Subscript):
                return isinstance(target.value, ast.Name) and isinstance(target.slice, (ast.Name, ast.Constant))
            return False
        def loaded(target):
            target = copy.deepcopy(target)
            target.ctx = ast.Load()
            return target
        class Python2(ast.NodeTransformer):
            def __init__(self, division):
                self.division = division

            def visit_BinOp(self, node):
                self.generic_visit(node)
                if self.division and isinstance(node.op, ast.Div):
                    return ast.copy_location(ast.Call(func=helper("div", node), args=[node.left, node.right], keywords=[]), node)
                return node

            def visit_AugAssign(self, node):
                self.generic_visit(node)
                if self.division and isinstance(node.op, ast.Div) and simple(node.target):
                    value = ast.Call(func=helper("div", node), args=[loaded(node.target), node.value], keywords=[])
                    return ast.copy_location(ast.Assign(targets=[node.target], value=value), node)
                return node

            def visit_Call(self, node):
                self.generic_visit(node)
                f = node.func
                if isinstance(f, ast.Attribute) and f.attr in methods:
                    args = [f.value, ast.Constant(value=f.attr)] + node.args
                    return ast.copy_location(ast.Call(func=helper("meth", node), args=args, keywords=node.keywords), node)
                if isinstance(f, ast.Name) and f.id in calls:
                    return ast.copy_location(ast.Call(func=helper("call", node), args=[f] + node.args, keywords=node.keywords), node)
                return node

            # print >>f, x is valid Python 3, a shift and a tuple: make it the print it was.
            def visit_Expr(self, node):
                self.generic_visit(node)
                v = node.value
                items = v.elts if isinstance(v, ast.Tuple) else [v]
                first = items[0] if items else None
                if isinstance(first, ast.BinOp) and isinstance(first.op, ast.RShift) and isinstance(first.left, ast.Name) and first.left.id == "print":
                    call = ast.Call(func=first.left, args=items[1:], keywords=[ast.keyword(arg="file", value=first.right)])
                    return ast.copy_location(ast.Expr(value=ast.copy_location(call, v)), node)
                if isinstance(v, ast.Name) and v.id == "print":
                    return ast.copy_location(ast.Expr(value=ast.copy_location(ast.Call(func=v, args=[], keywords=[]), v)), node)
                return node

            def visit_ClassDef(self, node):
                self.generic_visit(node)
                node.decorator_list.append(helper("py2_class", node))
                return node
        def true_division(tree):
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "__future__":
                    if any(a.name == "division" for a in node.names):
                        return True
            return False

        python2 = list()
        class WrapNode(object):
            def __init__(self, wrapped):
                self.wrapped = wrapped

            def visit(self, tree):
                tree = self.wrapped.visit(tree)
                if python2 and python2[-1]:
                    tree = Python2(not true_division(tree)).visit(tree)
                    ast.fix_missing_locations(tree)
                return tree

        python_module.wrap_node = WrapNode(python_module.wrap_node)

        # ---- Python 2 syntax --------------------------------------------------------

        backtick = chr(96)
        statement = re.compile(r"^([ \t]*)print\b(?![ \t]*[(=.])[ \t]*(.*?)[ \t]*$", re.M)
        number = re.compile(r"(?<![\w.])0+([0-9]+)(?![\w.])")
        line_fixes = [
            (re.compile(r"^(\s*except\s+)(.+?)\s*,\s*([A-Za-z_]\w*)\s*:"), r"\1\2 as \3:"),
            (re.compile(r"^(\s*raise\s+)([\w.]+)\s*,\s*(.+?)\s*$"), r"\1\2(\3)"),
            (re.compile(r"^(\s*)exec\s+(?![\s(=.])(.+?)\s+in\s+(.+?)\s*$"), r"\1exec(\2, \3)"),
            (re.compile(r"^(\s*)exec\s+(?![\s(=.])(.+?)\s*$"), r"\1exec(\2)"),
            (re.compile(r"\b(0[xX][0-9a-fA-F]+|[0-9]+)[lL]\b"), r"\1"),
            (re.compile(r"\b[uU][rR](['\"])"), r"r\1"),
            (re.compile(r"<>"), "!="),
            (re.compile(backtick + "([^" + backtick + "]*)" + backtick), r"repr(\1)"),
        ]

        def call_print(m):
            body = m.group(2)
            target = re.match(r">>\s*([^,]+?)\s*(?:,\s*(.*))?$", body)
            if target:
                rest = target.group(2) or ""
                return "%sprint(%s%sfile=%s)" % (m.group(1), rest, ", " if rest else "", target.group(1))
            if body.endswith(","):
                return '%sprint(%s, end=" ")' % (m.group(1), body[:-1])
            return "%sprint(%s)" % (m.group(1), body)
        def fix(source, e, first):
            msg = str(e.msg)
            if isinstance(e, TabError) or "inconsistent use of tabs" in msg:
                return source.expandtabs(8)
            if "print" in msg:
                fixed = statement.sub(call_print, source)
                if fixed != source:
                    return fixed
            if e.lineno is None:
                return None
            lines = source.split("\n")
            i = e.lineno - first
            if not 0 <= i < len(lines):
                return None
            line = lines[i]
            if "leading zeros" in msg and e.offset:
                near = [n for n in number.finditer(line) if abs(n.start() - (e.offset - 1)) <= 2]
                if near:
                    m = near[0]
                    digits = m.group(1)
                    # 010 was octal in Python 2.
                    literal = "0o" + digits if re.match(r"^[0-7]+$", digits) else digits.lstrip("0") or "0"
                    lines[i] = line[: m.start()] + literal + line[m.end() :]
                    return "\n".join(lines)
            for pattern, replacement in line_fixes:
                fixed = pattern.sub(replacement, line)
                if fixed != line:
                    lines[i] = fixed
                    return "\n".join(lines)
            fixed = statement.sub(call_print, line)
            if fixed != line:
                lines[i] = fixed
                return "\n".join(lines)
            return None

        compile_py = python_module.py_compile

        def py_compile(source, mode, *args, **kwargs):
            py = getattr(source, "py", None)
            if py is None:
                py = kwargs.get("py", args[4] if len(args) > 4 else None)
            if py == 2:
                activate()
            python2.append(py == 2)
            try:
                # Ren'Py compiles a syntax tree (an old screen's) as it is, without wrap_node.
                if py == 2 and isinstance(source, ast.Module):
                    source = Python2(not true_division(source)).visit(copy.deepcopy(source))
                    ast.fix_missing_locations(source)
                try:
                    return compile_py(source, mode, *args, **kwargs)
                except SyntaxError as e:
                    if not isinstance(source, str):
                        raise
                    error = e
                # Code that compiles once fixed is Python 2. A failed compile alone proves nothing:
                # Ren'Py also compiles every statement as an expression and ignores the errors.
                python2[-1] = True
                first = getattr(source, "linenumber", None) or kwargs.get("lineno") or (args[1] if len(args) > 1 else 1)
                fixed = source
                for _ in range(50):
                    attempt = fix(str(fixed), error, first)
                    if attempt is None or attempt == str(fixed):
                        raise error
                    try:
                        fixed = type(source)(attempt, source.filename, source.linenumber, 2, None, getattr(source, "column", 0))
                    except Exception:
                        fixed = attempt
                    try:
                        code = compile_py(fixed, mode, *args, **kwargs)
                    except SyntaxError as e:
                        error = e
                        continue
                    activate()
                    return code
                raise error
            finally:
                python2.pop()

        py_compile.renplay2 = True
        python_module.py_compile = py_compile

        # A game's own .py modules are imported, not compiled by Ren'Py. In a Python 2 game they
        # get the same fixes, and the Python 2 names they use from this module.
        def module_code(data, path):
            text = importlib.util.decode_source(data) if isinstance(data, (bytes, bytearray)) else data
            while True:
                try:
                    tree = compile(text, path, "exec", ast.PyCF_ONLY_AST, dont_inherit=True)
                    break
                except SyntaxError as e:
                    attempt = fix(text, e, 1)
                    if attempt is None or attempt == text:
                        raise
                    text = attempt
            tree = Python2(not true_division(tree)).visit(tree)
            loaded_names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
            wanted = sorted(n for n in loaded_names if n in module_names)
            if wanted:
                at = 0
                body = tree.body
                if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
                    at = 1
                while at < len(body) and isinstance(body[at], ast.ImportFrom) and body[at].module == "__future__":
                    at += 1
                body.insert(at, ast.ImportFrom(module="renplay_py2", names=[ast.alias(name=n) for n in wanted], level=0))
            ast.fix_missing_locations(tree)
            return compile(tree, path, "exec", dont_inherit=True)

        module_names = {"long", "unichr", "reduce", "cmp", "raw_input", "intern", "apply", "buffer", "unicode",
                        "basestring", "xrange", "reload"}
        importer = getattr(engine("importer"), "RenpyImporter", None)
        if importer is not None:
            source_to_code = importer.source_to_code

            def py2_source_to_code(data, path="<string>"):
                if active:
                    try:
                        return module_code(data, path)
                    except SyntaxError:
                        pass
                return source_to_code(data, path)

            importer.source_to_code = staticmethod(py2_source_to_code)
        pyanalysis = engine("pyanalysis")
        # Screens fold constant expressions: the helpers are as pure as what they stand for.
        for name in ("__renplay2__.div", "__renplay2__.call"):
            if hasattr(pyanalysis, "pure"):
                pyanalysis.pure(name)
        if getattr(pyanalysis, "py_compile", None) is compile_py:
            pyanalysis.py_compile = py_compile

    _renplay_py2()
    del _renplay_py2
${OLD_SCREENS}`
