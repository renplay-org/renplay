import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PY2_COMPAT } from '../pipeline/py2compat.js'

// Python 2.7 (Ren'Py 7.8.7's) pickled the syntax tree of this code, as Ren'Py 6 stored the Python
// of old-style screens in .rpyc files:
//
//   items = [1, 2, 3]; first = items[0]; pair = items[0:2]; grid = {}; grid[1, 2] = 5
//   def f(a, b=2): return a + b
//   def g(*args, **kwargs): return len(args) + len(kwargs)
//   try: raise ValueError, "bad"
//   except ValueError, e: message = str(e)
//   try: x = 1
//   finally: done = True
//   exec "y = 2"
//   print >>out, "printed", first,
const OLD_TREE = 'gAJjX2FzdApNb2R1bGUKcQApUnEBfXECVQRib2R5cQNdcQQoY19hc3QKQXNzaWduCnEFKVJxBn1xByhVCmNvbF9vZmZzZXRxCEsAVQd0YXJnZXRzcQldcQpjX2FzdApOYW1lCnELKVJxDH1xDShVA2N0eHEOY19hc3QKU3RvcmUKcQ8pUnEQfXERYlUCaWRxElUFaXRlbXNxE2gISwBVBmxpbmVub3EUSwJ1YmFVBXZhbHVlcRVjX2FzdApMaXN0CnEWKVJxF31xGChVBGVsdHNxGV1xGihjX2FzdApOdW0KcRspUnEcfXEdKGgUSwJoCEsJVQFucR5LAXViaBspUnEffXEgKGgUSwJoCEsMaB5LAnViaBspUnEhfXEiKGgUSwJoCEsPaB5LA3ViZWgOY19hc3QKTG9hZApxIylScSR9cSViaBRLAmgISwh1YmgUSwJ1YmgFKVJxJn1xJyhoCEsAaAldcShoCylScSl9cSooaA5oEGgSVQVmaXJzdHEraAhLAGgUSwN1YmFoFWNfYXN0ClN1YnNjcmlwdApxLClScS19cS4oVQVzbGljZXEvY19hc3QKSW5kZXgKcTApUnExfXEyaBVoGylScTN9cTQoaBRLA2gISw5oHksAdWJzYmgOaCRoFEsDaBVoCylScTV9cTYoaA5oJGgSaBNoCEsIaBRLA3ViaAhLCHViaBRLA3ViaAUpUnE3fXE4KGgISwBoCV1xOWgLKVJxOn1xOyhoDmgQaBJVBHBhaXJxPGgISwBoFEsEdWJhaBVoLClScT19cT4oaC9jX2FzdApTbGljZQpxPylScUB9cUEoVQV1cHBlcnFCaBspUnFDfXFEKGgUSwRoCEsPaB5LAnViVQVsb3dlcnFFaBspUnFGfXFHKGgUSwRoCEsNaB5LAHViVQRzdGVwcUhOdWJoDmgkaBRLBGgVaAspUnFJfXFKKGgOaCRoEmgTaAhLB2gUSwR1YmgISwd1YmgUSwR1YmgFKVJxS31xTChoCEsAaAldcU1oCylScU59cU8oaA5oEGgSVQRncmlkcVBoCEsAaBRLBXViYWgVY19hc3QKRGljdApxUSlScVJ9cVMoVQRrZXlzcVRdcVVVBnZhbHVlc3FWXXFXaBRLBWgISwd1YmgUSwV1YmgFKVJxWH1xWShoCEsAaAldcVpoLClScVt9cVwoaC9oMClScV19cV5oFWNfYXN0ClR1cGxlCnFfKVJxYH1xYShoGV1xYihoGylScWN9cWQoaBRLBmgISwVoHksBdWJoGylScWV9cWYoaBRLBmgISwhoHksCdWJlaA5oJGgUSwZoCEsFdWJzYmgOaBBoFEsGaBVoCylScWd9cWgoaA5oJGgSaFBoCEsAaBRLBnViaAhLAHViYWgVaBspUnFpfXFqKGgUSwZoCEsNaB5LBXViaBRLBnViY19hc3QKRnVuY3Rpb25EZWYKcWspUnFsfXFtKGgDXXFuY19hc3QKUmV0dXJuCnFvKVJxcH1xcShoFEsIaBVjX2FzdApCaW5PcApxcilScXN9cXQoVQJvcHF1Y19hc3QKQWRkCnF2KVJxd31xeGJVBXJpZ2h0cXloCylScXp9cXsoaA5oJGgSVQFicXxoCEsPaBRLCHViaBRLCGgISwtVBGxlZnRxfWgLKVJxfn1xfyhoDmgkaBJVAWFxgGgISwtoFEsIdWJ1YmgISwR1YmFVDmRlY29yYXRvcl9saXN0cYFdcYJVBG5hbWVxg1UBZnGEaAhLAFUEYXJnc3GFY19hc3QKYXJndW1lbnRzCnGGKVJxh31xiChohV1xiShoCylScYp9cYsoaA5jX2FzdApQYXJhbQpxjClScY19cY5iaBJogGgISwZoFEsHdWJoCylScY99cZAoaA5ojWgSaHxoCEsJaBRLB3ViZVUFa3dhcmdxkU5VCGRlZmF1bHRzcZJdcZNoGylScZR9cZUoaBRLB2gISwtoHksCdWJhVQZ2YXJhcmdxlk51YmgUSwd1YmhrKVJxl31xmChoA11xmWhvKVJxmn1xmyhoFEsKaBVocilScZx9cZ0oaHVod2h5Y19hc3QKQ2FsbApxnilScZ99caAoaAhLF1UIc3RhcmFyZ3NxoU5ohV1xomgLKVJxo31xpChoDmgkaBJVBmt3YXJnc3GlaAhLG2gUSwp1YmFoFEsKVQRmdW5jcaZoCylScad9cagoaA5oJGgSVQNsZW5xqWgISxdoFEsKdWJopU5VCGtleXdvcmRzcapdcat1YmgUSwpoCEsLaH1onilScax9ca0oaAhLC2ihTmiFXXGuaAspUnGvfXGwKGgOaCRoEmiFaAhLD2gUSwp1YmFoFEsKaKZoCylScbF9cbIoaA5oJGgSaKloCEsLaBRLCnViaKVOaKpdcbN1YnViaAhLBHViYWiBXXG0aINVAWdxtWgISwBohWiGKVJxtn1xtyhohV1xuGiRaKVokl1xuWiWaIV1YmgUSwl1YmNfYXN0ClRyeUV4Y2VwdApxuilScbt9cbwoaANdcb1jX2FzdApSYWlzZQpxvilScb99ccAoVQV0YmFja3HBTlUEaW5zdHHCY19hc3QKU3RyCnHDKVJxxH1xxShVAXNxxlUDYmFkccdoFEsMaAhLFnViVQR0eXBlcchoCylSccl9ccooaA5oJGgSVQpWYWx1ZUVycm9ycctoCEsKaBRLDHViaBRLDGgISwR1YmFoCEsAaBRLC1UGb3JlbHNlccxdcc1VCGhhbmRsZXJzcc5dcc9jX2FzdApFeGNlcHRIYW5kbGVyCnHQKVJx0X1x0ihoA11x02gFKVJx1H1x1ShoCEsEaAldcdZoCylScdd9cdgoaA5oEGgSVQdtZXNzYWdlcdloCEsEaBRLDnViYWgVaJ4pUnHafXHbKGgISw5ooU5ohV1x3GgLKVJx3X1x3ihoDmgkaBJVAWVx32gISxJoFEsOdWJhaBRLDmimaAspUnHgfXHhKGgOaCRoElUDc3RyceJoCEsOaBRLDnViaKVOaKpdceN1YmgUSw51YmFoyGgLKVJx5H1x5ShoDmgkaBJoy2gISwdoFEsNdWJog2gLKVJx5n1x5yhoDmgQaBJo32gISxNoFEsNdWJoCEsAaBRLDXViYXViY19hc3QKVHJ5RmluYWxseQpx6ClScel9ceooaANdcetoBSlScex9ce0oaAhLBGgJXXHuaAspUnHvfXHwKGgOaBBoElUBeHHxaAhLBGgUSxB1YmFoFWgbKVJx8n1x8yhoFEsQaAhLCGgeSwF1YmgUSxB1YmFVCWZpbmFsYm9keXH0XXH1aAUpUnH2fXH3KGgISwRoCV1x+GgLKVJx+X1x+ihoDmgQaBJVBGRvbmVx+2gISwRoFEsSdWJhaBVoCylScfx9cf0oaA5oJGgSVQRUcnVlcf5oCEsLaBRLEnViaBRLEnViYWgISwBoFEsPdWJjX2FzdApFeGVjCnH/KVJyAAEAAH1yAQEAAChoA2jDKVJyAgEAAH1yAwEAAChoxlUFeSA9IDJyBAEAAGgUSxNoCEsFdWJVB2dsb2JhbHNyBQEAAE5oFEsTVQZsb2NhbHNyBgEAAE5oCEsAdWJjX2FzdApQcmludApyBwEAAClScggBAAB9cgkBAAAoVQRkZXN0cgoBAABoCylScgsBAAB9cgwBAAAoaA5oJGgSVQNvdXRyDQEAAGgISwhoFEsUdWJVAm5scg4BAACJaFZdcg8BAAAoaMMpUnIQAQAAfXIRAQAAKGjGVQdwcmludGVkchIBAABoFEsUaAhLDXViaAspUnITAQAAfXIUAQAAKGgOaCRoEmgraAhLGGgUSxR1YmVoFEsUaAhLAHViZXNiLg=='

// Runs Renplay's `python early` block the way the engine does: Ren'Py's py_compile parses the
// code, hands the tree to renpy.python.wrap_node and compiles it, and PyExpr carries the
// Python version the code was written for (2 when it comes from an old game's .rpyc).
// renpy-compat-pickle.py is Ren'Py 8.5.3's renpy/compat/pickle.py, which loads .rpyc files.
function run(program: string): string {
  const block = PY2_COMPAT.split('\n').slice(PY2_COMPAT.split('\n').indexOf('python early:') + 1)
  const body = block.map((line) => line.replace(/^ {4}/, '')).join('\n')
  const script = String.raw`
import ast, sys, types
sys.modules["renpy"] = types.ModuleType("renpy")
compat_pickle = types.ModuleType("renpy.compat.pickle")
exec(open(sys.argv[1]).read(), compat_pickle.__dict__)

class PyExpr(str):
    def __new__(cls, s, filename="game/script.rpy", linenumber=1, py=2, hashcode=None, column=0):
        rv = str.__new__(cls, s)
        rv.filename, rv.linenumber, rv.py, rv.column = filename, linenumber, py, column
        return rv

python = types.ModuleType("renpy.python")
python.wrap_node = ast.NodeTransformer()

def py_compile(source, mode, filename="<none>", lineno=1, ast_node=False, cache=True, py=None, hashcode=None, column=0):
    if isinstance(source, ast.Module):
        return compile(source, filename, mode)
    if isinstance(source, PyExpr):
        filename = source.filename
    tree = compile(str(source), filename, "exec" if mode == "hide" else mode, ast.PyCF_ONLY_AST)
    tree = python.wrap_node.visit(tree)
    if ast_node:
        return tree.body
    return compile(tree, filename, "exec" if mode == "hide" else mode)

python.py_compile = py_compile
pyanalysis = types.ModuleType("renpy.pyanalysis")
pyanalysis.py_compile = py_compile
import importlib.abc
class RenpyImporter(importlib.abc.MetaPathFinder, importlib.abc.InspectLoader):
    def get_source(self, fullname):
        return None
importer = types.ModuleType("renpy.importer")
importer.RenpyImporter = RenpyImporter
store = types.ModuleType("store")
sys.modules["store"] = store
# In game code renpy is renpy.exports; the engine's modules are only in sys.modules.
sys.modules.update({"renpy.python": python, "renpy.pyanalysis": pyanalysis, "renpy.importer": importer, "renpy.compat.pickle": compat_pickle})
renpy = types.SimpleNamespace(store=store)
# The store's dict, list and object are Ren'Py's revertable kinds, as in the engine.
class RevertableDict(dict): pass
class RevertableList(list): pass
class RevertableObject(object): pass
`
    + `\nexec(${JSON.stringify(body)}, {"renpy": renpy, "dict": RevertableDict, "list": RevertableList, "object": RevertableObject})\n`
    + String.raw`
def run(code, py=2):
    exec(python.py_compile(PyExpr(code, py=py), "exec"), store.__dict__)
` + program
  return execFileSync('python3', ['-I', '-c', script, join(import.meta.dirname, 'renpy-compat-pickle.py')], { encoding: 'utf8' }).trim()
}

describe('Python 2 compatibility script', () => {
  it('runs Python 2 code from old games the way Python 2 did', () => {
    const out = run(String.raw`
run('''
class Card(object):
    def __init__(self, n):
        self.n = n
    def __cmp__(self, other):
        return cmp(self.n, other.n)
    def __nonzero__(self):
        return self.n != 0
    def __div__(self, k):
        return Card(self.n / k)

class Counter(object):
    def __init__(self):
        self.i = 0
    def __iter__(self):
        return self
    def next(self):
        self.i += 1
        if self.i > 3:
            raise StopIteration
        return self.i

import string, sys, itertools, cPickle
d = {"b": 2, "a": 1}
x = 9
x /= 2
checks = [
    ("long", long(5) == 5),
    ("unichr", unichr(65) == u"A"),
    ("reduce", reduce(lambda a, b: a + b, [1, 2, 3]) == 6),
    ("cmp", cmp(1, 2) == -1),
    ("iteritems", sorted(d.iteritems()) == [("a", 1), ("b", 2)]),
    ("has_key", d.has_key("a")),
    ("keys_index", sorted(d.keys())[0] == "a" and d.keys()[0] in d),
    ("values_index", d.values()[0] in (1, 2)),
    ("items_index", d.items()[0][0] in d),
    ("keys_sort", (lambda k: (k.sort(), k)[1])(d.keys()) == ["a", "b"]),
    ("keys_plus", sorted(d.keys() + ["c"]) == ["a", "b", "c"]),
    ("delete_while_iterating", [d.pop(k) for k in d.keys()] and d == {}),
    ("map_index", map(str, [1, 2])[0] == "1"),
    ("filter_index", filter(None, [0, 5])[0] == 5),
    ("filter_text", filter(lambda c: c != "b", "abc") == "ac"),
    ("zip_index", zip([1], [2])[0] == (1, 2)),
    ("mixed_sorted", sorted([3, "a", 1]) == [1, 3, "a"]),
    ("mixed_sort", (lambda l: (l.sort(), l)[1])([2, "b", 1]) == [1, 2, "b"]),
    ("none_sort", sorted([2, None, 1]) == [None, 1, 2]),
    ("mixed_max", max([1, "a"]) == "a" and min(x for x in [1, "a"]) == 1),
    ("cmp_class_sort", [c.n for c in sorted([Card(3), Card(1)])] == [1, 3]),
    ("cmp_class_lt", Card(1) < Card(2) and Card(2) == Card(2) and len({Card(1)}) == 1),
    ("nonzero", not Card(0) and bool(Card(1))),
    ("div_class", (Card(6) / 2).n == 3),
    ("next_iter", list(Counter()) == [1, 2, 3]),
    ("next_method", iter([7]).next() == 7),
    ("sort_cmp", sorted([3, 1, 2], cmp=lambda a, b: b - a) == [3, 2, 1]),
    ("list_sort_cmp", (lambda l: (l.sort(cmp=lambda a, b: a - b), l)[1])([2, 1]) == [1, 2]),
    ("plain_list_sort", (lambda l: (l.sort(cmp=lambda a, b: cmp(b, a)), l)[1])("a c b".split()) == ["c", "b", "a"]),
    ("string", "a" in string.letters and string.join(["a", "b"], "-") == "a-b" and string.upper("a") == "A"),
    ("maxint", sys.maxint > 0),
    ("izip", list(itertools.izip([1], [2])) == [(1, 2)]),
    ("cpickle", cPickle.loads(cPickle.dumps(1)) == 1),
    ("decode", "abc".decode("utf-8") == u"abc"),
    ("int_div", 7 / 2 == 3 and 7.0 / 2 == 3.5 and -7 / 2 == -4 and x == 4),
    ("round", round(2.5) == 3.0 and isinstance(round(2), float)),
]
failed = [name for name, ok in checks if not ok]
print("failed: %s" % failed)
''')
`)
    expect(out).toBe('failed: []')
  })

  it('keeps true division when the code imports it from __future__', () => {
    expect(run(`run("from __future__ import division\\nprint(7 / 2)")`)).toBe('3.5')
  })

  it('leaves Python 3 code alone', () => {
    const out = run(String.raw`
run('''
class Card(object):
    def __cmp__(self, other):
        return 0
try:
    Card() < Card()
    ordered = "ordered"
except TypeError:
    ordered = "unordered"
print(7 / 2, type({}.keys()).__name__, type(map(str, [])).__name__, ordered, "long" in globals())
''', py=3)
`)
    expect(out).toBe('3.5 dict_keys map unordered False')
  })

  it('fixes Python 2 syntax and runs the code as Python 2', () => {
    const out = run(String.raw`
import io, sys
source = (
    "try:\n"
    "    raise ValueError, 'bad'\n"
    # Python 3.14 reads "except A, e" as a tuple again, the engine's 3.12 refuses it.
    + ("except ValueError, e:\n" if sys.version_info < (3, 14) else "except ValueError as e:\n") +
    "    message = str(e)\n"
    "import io\n"
    "buffer = io.StringIO()\n"
    "print >>buffer, 'to a file'\n"
    "print 'statement', 0777, 10L\n"
    "exec 'shown = 1 != 2'\n"
    "different = 1 <> 2\n"
    "if True:\n"
    "\tquoted = ` + "`" + String.raw`7 / 2` + "`" + String.raw`\n"
    "        quoted += ur'!'\n"
    "print message, buffer.getvalue().strip(), shown, different, quoted\n"
)
run(source)
`)
    expect(out).toBe('statement 511 10\nbad to a file True True 3!')
  })

  it('fixes a Python 2 game\'s own .py modules the same way', () => {
    const out = run(String.raw`
run("x = 1")  # Python 2 code from the game's scripts turns the fixes on.
module = types.ModuleType("helpers")
source = b"from __future__ import print_function\nimport string\nhalf = 7 / 2\nbig = long(2) ** 70\nkeys = {'a': 1}.keys()[0]\ndef show():\n    print 'half', half, big > sys.maxint, keys, string.letters[:3]\nimport sys\n"
exec(RenpyImporter().source_to_code(source, "game/helpers.py"), module.__dict__)
module.show()
`)
    expect(out).toBe('half 3 True a abc')
  })

  it('loads and runs the Python 2 syntax trees of old-style screens', () => {
    const out = run(String.raw`
import base64, io
tree = compat_pickle.loads(base64.b64decode(${JSON.stringify(OLD_TREE)}))
out = io.StringIO()
scope = {"out": out}
exec(python.py_compile(tree, "exec", "game/screens.rpy", py=2), scope)
print(scope["first"], scope["pair"], scope["grid"], scope["f"](1), scope["g"](1, k=2), scope["message"], scope["done"], scope["y"], repr(out.getvalue()))
`)
    expect(out).toBe("1 [1, 2] {(1, 2): 5} 3 2 bad True 2 'printed 1 '")
  })

  it('stays off for a Ren\'Py 8 game whose statements Ren\'Py also tries as expressions', () => {
    // Ren'Py compiles every statement as an expression too, and ignores the errors.
    const out = run(String.raw`
try:
    python.py_compile(PyExpr("x = 1", py=3), "eval")
except SyntaxError:
    pass
module = types.ModuleType("helpers")
exec(RenpyImporter().source_to_code(b"half = 7 / 2\nkeys = type({}.keys()).__name__\n", "game/helpers.py"), module.__dict__)
print(module.half, module.keys, hasattr(store, "long"))
`)
    expect(out).toBe('3.5 dict_keys False')
  })
})

