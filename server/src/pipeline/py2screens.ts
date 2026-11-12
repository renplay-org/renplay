/**
 * Part of the script py2compat.ts adds to every build: old-style screens of games made with
 * Ren'Py 6.17 and older keep their Python as Python 2 syntax trees in the .rpyc files. Ren'Py 8
 * converts most of their nodes as it loads them (renpy.compat.pickle). This adds the ones it lacks
 * (Index, ExtSlice, Ellipsis, Print, Exec, TryExcept, TryFinally, Python 2 Raise and
 * ExceptHandler), keeps `arguments` without `*args` valid, and fills the fields Python 3 requires.
 * Only syntax trees from old .rpyc files go through it.
 */
export const OLD_SCREENS = String.raw`
    def _renplay_old_screens():
        import ast
        import sys
        from builtins import dict, list, object

        # In game code renpy is renpy.exports: the engine's loader comes from sys.modules.
        old_pickle = sys.modules.get("renpy.compat.pickle")
        rewrite = getattr(old_pickle, "REWRITE_NODES", None)
        fixup = getattr(old_pickle, "AstFixupTransformer", None)
        if isinstance(rewrite, dict) and fixup is not None:
            class OldNode(ast.AST):
                def __setstate__(self, state):
                    self.__dict__.update(state)

            for name in ("Index", "ExtSlice", "Ellipsis", "Print", "Exec", "TryExcept", "TryFinally", "Raise", "ExceptHandler"):
                rewrite.setdefault(name, type(name, (OldNode,), {"__module__": "renplay_py2"}))

            arguments = rewrite.get("arguments")
            if arguments is not None:
                class Arguments(arguments):
                    def __setstate__(self, state):
                        arguments.__setstate__(self, state)
                        if not state.get("vararg"):
                            self.vararg = None
                        if not state.get("kwarg"):
                            self.kwarg = None

                rewrite["arguments"] = Arguments

            def at(new, old):
                return ast.copy_location(new, old) if hasattr(old, "lineno") else new

            def name_call(name, args, keywords, node):
                return at(ast.Call(func=at(ast.Name(id=name, ctx=ast.Load()), node), args=args, keywords=keywords), node)

            lists = {"body", "orelse", "finalbody", "handlers", "decorator_list", "keywords", "args", "elts", "targets",
                     "names", "type_params", "generators", "ifs", "keys", "values", "ops", "comparators", "type_ignores",
                     "kw_defaults", "defaults", "posonlyargs", "kwonlyargs", "bases"}

            numbers = {"is_async": 0, "level": 0, "conversion": -1}

            def complete(tree):
                for node in ast.walk(tree):
                    for field in node._fields:
                        if not hasattr(node, field):
                            setattr(node, field, [] if field in lists else numbers.get(field))
                ast.fix_missing_locations(tree)
                # Python 2 trees have no end positions: an end before the start is refused.
                for node in ast.walk(tree):
                    if getattr(node, "lineno", None) is None:
                        continue
                    if getattr(node, "end_lineno", None) is None or node.end_lineno < node.lineno:
                        node.end_lineno = node.lineno
                        node.end_col_offset = node.col_offset
                    elif node.end_lineno == node.lineno and (node.end_col_offset or 0) < node.col_offset:
                        node.end_col_offset = node.col_offset

            class Fixup(fixup):
                def statements(self, nodes):
                    out = []
                    for n in nodes or []:
                        n = self.visit(n)
                        out.extend(n if isinstance(n, list) else [n] if n is not None else [])
                    return out

                def visit_Index(self, node):
                    return self.visit(node.value)

                def visit_ExtSlice(self, node):
                    return at(ast.Tuple(elts=[self.visit(d) for d in node.dims], ctx=ast.Load()), node)

                def visit_Ellipsis(self, node):
                    return at(ast.Constant(value=Ellipsis), node)

                def visit_Print(self, node):
                    keywords = []
                    if getattr(node, "dest", None) is not None:
                        keywords.append(ast.keyword(arg="file", value=self.visit(node.dest)))
                    if not getattr(node, "nl", True):
                        keywords.append(ast.keyword(arg="end", value=ast.Constant(value=" ")))
                    return at(ast.Expr(value=name_call("print", [self.visit(v) for v in node.values], keywords, node)), node)

                def visit_Exec(self, node):
                    args = [self.visit(a) for a in (node.body, getattr(node, "globals", None), getattr(node, "locals", None)) if a is not None]
                    return at(ast.Expr(value=name_call("exec", args, [], node)), node)

                def visit_TryExcept(self, node):
                    return at(ast.Try(body=self.statements(node.body), handlers=self.statements(node.handlers),
                                      orelse=self.statements(node.orelse), finalbody=[]), node)

                def visit_TryFinally(self, node):
                    inner = self.statements(node.body)
                    final = self.statements(node.finalbody)
                    if len(inner) == 1 and isinstance(inner[0], ast.Try) and not inner[0].finalbody:
                        inner[0].finalbody = final
                        return inner[0]
                    return at(ast.Try(body=inner, handlers=[], orelse=[], finalbody=final), node)

                def visit_Raise(self, node):
                    if not isinstance(node, OldNode):
                        return self.generic_visit(node)
                    exc = self.visit(node.type) if getattr(node, "type", None) is not None else None
                    inst = getattr(node, "inst", None)
                    if exc is not None and inst is not None:
                        inst = self.visit(inst)
                        exc = at(ast.Call(func=exc, args=inst.elts if isinstance(inst, ast.Tuple) else [inst], keywords=[]), node)
                    return at(ast.Raise(exc=exc, cause=None), node)

                def visit_ExceptHandler(self, node):
                    if not isinstance(node, OldNode):
                        return self.generic_visit(node)
                    name = getattr(node, "name", None)
                    kind = getattr(node, "type", None)
                    return at(ast.ExceptHandler(type=self.visit(kind) if kind is not None else None,
                                                name=name.id if isinstance(name, ast.Name) else name,
                                                body=self.statements(node.body)), node)

                def visit_ModuleWrapper(self, node):
                    self.generic_visit(node)
                    complete(node)
                    return node

            old_pickle.AstFixupTransformer = Fixup

    _renplay_old_screens()
    del _renplay_old_screens
`
