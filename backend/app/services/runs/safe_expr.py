import ast
import json
import operator

MAX_NODES = 400
MAX_REPEAT = 100_000
MAX_RANGE = 100_000
MAX_COMP = 100_000


class ExprError(Exception):
    pass


class _Json:
    pass


JSON_NS = _Json()
JSON_FUNCS = {"loads": json.loads, "dumps": json.dumps}


def _range(*args):
    out = range(*args)
    if len(out) > MAX_RANGE:
        raise ExprError("range is too large")
    return out


BUILTINS = {
    "len": len, "str": str, "int": int, "float": float, "bool": bool,
    "any": any, "all": all, "sorted": sorted, "min": min, "max": max,
    "sum": sum, "list": list, "range": _range, "enumerate": enumerate,
    "abs": abs, "round": round, "reversed": reversed, "zip": zip,
}
ALLOWED_CALLS = {id(f) for f in BUILTINS.values()} | {id(f) for f in JSON_FUNCS.values()}
METHODS = {
    "get", "keys", "values", "items", "lower", "upper", "strip", "lstrip",
    "rstrip", "split", "splitlines", "startswith", "endswith", "join",
    "replace", "count", "index", "find", "title", "isdigit", "isalpha",
    "format", "removeprefix", "removesuffix",
}
METHOD_OWNERS = (str, dict, list, tuple)
BINOPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}
CMPOPS = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
    ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge,
    ast.Is: operator.is_, ast.IsNot: operator.is_not,
    ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
}


class _Eval:
    def __init__(self, names: dict) -> None:
        self.names = names
        self.count = 0
        self.comp = 0

    def run(self, node, scope: dict):
        self.count += 1
        if self.count > MAX_NODES * 50:
            raise ExprError("expression took too many steps")
        method = getattr(self, "n_" + type(node).__name__, None)
        if method is None:
            raise ExprError(f"{type(node).__name__} is not allowed in expressions")
        return method(node, scope)

    def n_Expression(self, node, scope):
        return self.run(node.body, scope)

    def n_Constant(self, node, scope):
        return node.value

    def n_Name(self, node, scope):
        if node.id in scope:
            return scope[node.id]
        if node.id in self.names:
            return self.names[node.id]
        if node.id == "json":
            return JSON_NS
        if node.id in BUILTINS:
            return BUILTINS[node.id]
        if node.id in ("True", "False", "None"):
            return {"True": True, "False": False, "None": None}[node.id]
        raise ExprError(f"unknown name: {node.id}")

    def n_Attribute(self, node, scope):
        base = self.run(node.value, scope)
        attr = node.attr
        if attr.startswith("_"):
            raise ExprError("private attributes are not allowed")
        if base is JSON_NS:
            if attr in JSON_FUNCS:
                return JSON_FUNCS[attr]
            raise ExprError(f"json.{attr} is not allowed")
        if attr in METHODS and isinstance(base, METHOD_OWNERS):
            return getattr(base, attr)
        raise ExprError(f"attribute {attr} is not allowed")

    def n_Subscript(self, node, scope):
        base = self.run(node.value, scope)
        key = self.run(node.slice, scope)
        try:
            return base[key]
        except (KeyError, IndexError, TypeError) as err:
            raise ExprError(f"cannot index: {err}")

    def n_Slice(self, node, scope):
        parts = [self.run(p, scope) if p is not None else None for p in (node.lower, node.upper, node.step)]
        return slice(*parts)

    def n_Index(self, node, scope):
        return self.run(node.value, scope)

    def n_Call(self, node, scope):
        func = self.run(node.func, scope)
        owner = getattr(func, "__self__", None)
        if not (id(func) in ALLOWED_CALLS or (owner is not None and isinstance(owner, METHOD_OWNERS) and func.__name__ in METHODS)):
            raise ExprError("that call is not allowed")
        args = []
        for a in node.args:
            if isinstance(a, ast.Starred):
                raise ExprError("star arguments are not allowed")
            args.append(self.run(a, scope))
        kwargs = {}
        for k in node.keywords:
            if k.arg is None:
                raise ExprError("star arguments are not allowed")
            kwargs[k.arg] = self.run(k.value, scope)
        return func(*args, **kwargs)

    def n_BoolOp(self, node, scope):
        if isinstance(node.op, ast.And):
            value = True
            for v in node.values:
                value = self.run(v, scope)
                if not value:
                    return value
            return value
        value = False
        for v in node.values:
            value = self.run(v, scope)
            if value:
                return value
        return value

    def n_UnaryOp(self, node, scope):
        v = self.run(node.operand, scope)
        if isinstance(node.op, ast.Not):
            return not v
        if isinstance(node.op, ast.USub):
            return -v
        if isinstance(node.op, ast.UAdd):
            return +v
        raise ExprError("operator is not allowed")

    def n_BinOp(self, node, scope):
        op = BINOPS.get(type(node.op))
        if op is None:
            raise ExprError("operator is not allowed")
        a = self.run(node.left, scope)
        b = self.run(node.right, scope)
        if isinstance(node.op, ast.Mult):
            for seq, n in ((a, b), (b, a)):
                if isinstance(seq, (str, list, tuple)) and isinstance(n, int) and n * max(len(seq), 1) > MAX_REPEAT:
                    raise ExprError("repeat is too large")
        try:
            return op(a, b)
        except (TypeError, ZeroDivisionError, ValueError) as err:
            raise ExprError(str(err))

    def n_Compare(self, node, scope):
        left = self.run(node.left, scope)
        for op, right_node in zip(node.ops, node.comparators):
            fn = CMPOPS.get(type(op))
            if fn is None:
                raise ExprError("comparison is not allowed")
            right = self.run(right_node, scope)
            try:
                ok = fn(left, right)
            except TypeError as err:
                raise ExprError(str(err))
            if not ok:
                return False
            left = right
        return True

    def n_IfExp(self, node, scope):
        return self.run(node.body if self.run(node.test, scope) else node.orelse, scope)

    def n_List(self, node, scope):
        return [self.run(e, scope) for e in node.elts]

    def n_Tuple(self, node, scope):
        return tuple(self.run(e, scope) for e in node.elts)

    def n_Set(self, node, scope):
        return {self.run(e, scope) for e in node.elts}

    def n_Dict(self, node, scope):
        out = {}
        for k, v in zip(node.keys, node.values):
            if k is None:
                raise ExprError("dict unpacking is not allowed")
            out[self.run(k, scope)] = self.run(v, scope)
        return out

    def n_JoinedStr(self, node, scope):
        return "".join(str(self.run(v, scope)) for v in node.values)

    def n_FormattedValue(self, node, scope):
        return format(self.run(node.value, scope))

    def _generate(self, generators, scope, emit):
        def step(i: int, local: dict):
            if i == len(generators):
                emit(local)
                return
            gen = generators[i]
            for item in self.run(gen.iter, local):
                self.comp += 1
                if self.comp > MAX_COMP:
                    raise ExprError("comprehension is too large")
                inner = dict(local)
                self._bind(gen.target, item, inner)
                if all(self.run(c, inner) for c in gen.ifs):
                    step(i + 1, inner)
        step(0, dict(scope))

    def _bind(self, target, value, scope):
        if isinstance(target, ast.Name):
            scope[target.id] = value
        elif isinstance(target, (ast.Tuple, ast.List)):
            for t, v in zip(target.elts, value):
                self._bind(t, v, scope)
        else:
            raise ExprError("bad comprehension target")

    def n_ListComp(self, node, scope):
        out: list = []
        self._generate(node.generators, scope, lambda local: out.append(self.run(node.elt, local)))
        return out

    n_GeneratorExp = n_ListComp

    def n_SetComp(self, node, scope):
        out: set = set()
        self._generate(node.generators, scope, lambda local: out.add(self.run(node.elt, local)))
        return out

    def n_DictComp(self, node, scope):
        out: dict = {}
        self._generate(node.generators, scope, lambda local: out.__setitem__(self.run(node.key, local), self.run(node.value, local)))
        return out


def evaluate(expr: str, names: dict):
    if not isinstance(expr, str) or len(expr) > 2000:
        raise ExprError("expression is empty or too long")
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as err:
        raise ExprError(f"syntax error: {err.msg}")
    if sum(1 for _ in ast.walk(tree)) > MAX_NODES:
        raise ExprError("expression is too large")
    return _Eval(names).run(tree, {})
