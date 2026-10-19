# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Static gate check for every /api/v1 route declared anywhere under an addon's
``controllers`` package (``odoo-addons/*/controllers/**/*.py``), so a nested area package
such as ``controllers/shifts/hr_shifts.py`` is checked like a flat module.

Each route must have (a) ``api_handler`` (json2 routes), (b) a feature gate
(``requires_feature`` / ``requires_registered_feature``, addons of rank 3 and above) and
(c) a capability gate, and its decorators must be ordered ``route``, ``api_handler``, feature
gate, ``requires_capability``. A capability gate is

* the ``requires_capability`` decorator, or
* a top-level statement of the handler, before it returns data, that is a call to
  ``require_capability`` / ``require_any_capability`` / ``_webvue_require_capability`` or to a
  helper whose own top-level statements make such a call, or
* a top-level ``if`` / ``assert`` whose test calls a reader (``*has_capability``,
  ``_webvue_can_*`` or a function that calls one) and whose body raises 403 / AccessError or
  calls a ``require*`` helper.

A check inside a conditional branch does not count, nor does an unrelated ``raise``. A method call
earns credit by name only on ``self`` or on a record whose model is a literal (``request.env['x']``,
a variable assigned from it, ``get_record('x', ...)``) and only when a WebVue class of that model
defines the method; stock ORM names never count. A route intentionally without a gate is listed with a
reason in ``tools/route_gate_allowlist.json``; an allowlist entry that no longer matches, or whose
route is now gated, is an error, so the list only shrinks. The check also flags
``request.env[<name>]`` whose model name is not a literal or a constant lookup table.

Usage::

    python3 -B tools/route_gate_policy.py
"""
from __future__ import annotations

import ast
import functools
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import api_surface
from api_surface import FEATURE_DECORATORS, const_strings, decorator_name, kw_const

REPO = api_surface.REPO
ADDONS = api_surface.ADDONS
ALLOWLIST = Path(__file__).resolve().parent / 'route_gate_allowlist.json'
LAYERS = Path(__file__).resolve().parent / 'arch_layers.json'
# Foundation addons (rank 0-2) are platform surfaces without an entitlement; ranks 3-5 gate by feature (R10).
FEATURE_MIN_RANK = 3

API_PREFIX = '/api/v1'
CAPABILITY_DECORATOR = 'requires_capability'
# Primitives that check a capability; credited by name on any receiver.
CAPABILITY_CALLS = frozenset({'require_capability', 'require_any_capability', '_webvue_require_capability'})
# Stock Odoo names the models override: never a gate by name.
ORM_METHODS = frozenset({
    'check_access', 'has_access', '_check_access', 'create', 'write', 'unlink', 'read', '_read', 'search',
    'search_read', 'search_count', 'browse', 'copy', 'default_get', 'name_search', 'exists', 'set_values',
    'get_values', 'message_post', 'fields_get', 'onchange',
})
ORM_PREFIXES = ('action_', '_compute_', '_onchange_', '_inverse_', '_search_', '_cron')
# Calls that keep the receiver's model: `request.env['x'].sudo().m()` is still model x.
RECEIVER_PASSTHROUGH = frozenset({'sudo', 'with_context', 'with_user', 'with_company', 'with_env', 'browse', 'exists'})
RECORD_GETTERS = frozenset({'get_record'})
CONSTANT_NAME = re.compile(r'[A-Z][A-Z0-9_]*')
# Decorator order, outermost first; a decorator not listed is unconstrained.
DECORATOR_ORDER = (('route',), ('api_handler',), FEATURE_DECORATORS, (CAPABILITY_DECORATOR,))


@dataclass
class Route:
    addon: str
    file: str
    controller: str
    handler: str
    paths: list[str]
    methods: list[str]
    auth: str | None
    http_type: str | None
    rank: int
    decorators: list[str] = field(default_factory=list)
    api_handler: bool = False
    feature_keys: list[str] = field(default_factory=list)
    has_feature: bool = False
    capability_keys: list[str] = field(default_factory=list)
    capability_match: str | None = None
    capability_source: str | None = None  # 'decorator', 'body' or None

    @property
    def key(self) -> str:
        """``<addon>/controllers/<file>.py:<handler>``: what the allowlist names."""
        return f'{self.file.removeprefix("odoo-addons/")}:{self.handler}'

    @property
    def has_capability(self) -> bool:
        return self.capability_source is not None


@functools.cache
def addon_ranks() -> dict[str, int]:
    return json.loads(LAYERS.read_text(encoding='utf-8')).get('ranks', {})


def call_name(node: ast.Call) -> str:
    return decorator_name(node)


def _functions(scope):
    for node in ast.walk(scope):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


# --- the index of every function a gate can hide in -------------------------------------------


@dataclass(eq=False)
class Func:
    node: ast.FunctionDef | ast.AsyncFunctionDef
    path: Path
    cls: ast.ClassDef | None
    models: tuple[str, ...]


class Index:
    """Module-level functions, class methods and model methods of controllers and models."""

    def __init__(self, trees: dict[Path, ast.Module]):
        self.trees = trees
        self.module_funcs: dict[Path, dict[str, Func]] = {}
        self.by_model: dict[str, dict[str, list[Func]]] = {}
        self.imports: dict[Path, dict[str, tuple[Path, str]]] = {}
        self.local_readers: dict[Path, frozenset[str]] = {}
        self.func_of: dict[int, Func] = {}
        for path, tree in trees.items():
            self._add_module(path, tree)

    def _add_module(self, path: Path, tree: ast.Module):
        funcs = self.module_funcs.setdefault(path, {})
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs[node.name] = self.func_of[id(node)] = Func(node, path, None, ())
            elif isinstance(node, ast.ImportFrom):
                self._add_import(path, node)
            elif isinstance(node, ast.ClassDef):
                models = _class_models(node)
                for member in node.body:
                    if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        func = self.func_of[id(member)] = Func(member, path, node, models)
                        for model in models:
                            self.by_model.setdefault(model, {}).setdefault(member.name, []).append(func)
        readers = {f.node.name for f in self.func_of.values()
                   if f.path == path and any(_is_reader_name(call_name(c)) for c in _calls(f.node))}
        self.local_readers[path] = frozenset(readers)

    def _add_import(self, path: Path, node: ast.ImportFrom):
        target = self._module_path(path, node)
        if target is not None:
            for alias in node.names:
                self.imports.setdefault(path, {})[alias.asname or alias.name] = (target, alias.name)

    def _module_path(self, path: Path, node: ast.ImportFrom) -> Path | None:
        parts = (node.module or '').split('.') if node.module else []
        if node.level:
            base = path.parent
            for _ in range(node.level - 1):
                base = base.parent
        elif parts[:2] == ['odoo', 'addons']:
            base, parts = ADDONS, parts[2:]
        else:
            return None
        candidate = base.joinpath(*parts)
        for option in (candidate.with_suffix('.py'), candidate / '__init__.py'):
            if option in self.trees:
                return option
        return None

    def is_reader(self, path: Path, name: str) -> bool:
        return _is_reader_name(name) or name in self.local_readers.get(path, ())


def _class_models(cls: ast.ClassDef) -> tuple[str, ...]:
    models = []
    for node in cls.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('_name', '_inherit')
                                                for t in node.targets):
            models.extend(const_strings(node.value))
    return tuple(dict.fromkeys(models))


def _calls(scope):
    return (n for n in ast.walk(scope) if isinstance(n, ast.Call))


def _is_reader_name(name: str) -> bool:
    return name.endswith('has_capability') or name.startswith('_webvue_can_')


def _is_stock(name: str) -> bool:
    return name in ORM_METHODS or name.startswith(ORM_PREFIXES)


# --- resolving calls --------------------------------------------------------------------------


def _is_env_literal(node: ast.AST) -> str | None:
    if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == 'env'
            and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str)):
        return node.slice.value
    return None


def _receiver_model(node: ast.expr, local_models: dict[str, str]) -> str | None:
    """The model literal a receiver expression stands for, or None."""
    while isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in RECEIVER_PASSTHROUGH:
        node = node.func.value
    if isinstance(node, ast.Call) and call_name(node) in RECORD_GETTERS and node.args:
        first = node.args[0]
        return first.value if isinstance(first, ast.Constant) and isinstance(first.value, str) else None
    if isinstance(node, ast.Name):
        return local_models.get(node.id)
    return _is_env_literal(node)


def _local_models(fn) -> dict[str, str]:
    found = {}
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            model = _receiver_model(node.value, {})
            if model:
                found[node.targets[0].id] = model
    return found


class Gates:
    """Decides whether a function gates on a capability before it returns data."""

    def __init__(self, index: Index):
        self.index = index
        self._memo: dict[int, bool] = {}

    def function_gates(self, func: Func) -> bool:
        key = id(func.node)
        if key not in self._memo:
            self._memo[key] = False  # a cycle through this function earns no credit
            self._memo[key] = self.scan(func)[0]
        return self._memo[key]

    def scan(self, func: Func) -> tuple[bool, list[str], str | None]:
        """``(gated, literal keys, match)`` from the top-level statements of ``func``."""
        if any(decorator_name(d) == CAPABILITY_DECORATOR for d in func.node.decorator_list):
            return True, [], None
        local = _local_models(func.node)
        for statement in _top_level(func.node.body):
            hit = self._statement_gate(statement, func, local)
            if hit:
                return True, *hit
            if isinstance(statement, (ast.Return, ast.Raise)):
                break
        return False, [], None

    def _statement_gate(self, statement, func: Func, local: dict[str, str]):
        if isinstance(statement, (ast.If, ast.Assert)):
            return self._reader_gate(statement, func)
        if not isinstance(statement, (ast.Expr, ast.Assign, ast.AnnAssign, ast.Return)) or statement.value is None:
            return None
        for call in _unconditional_calls(statement.value):
            if self._call_gates(call, func, local):
                match = 'any' if call_name(call) == 'require_any_capability' else 'all'
                return _literal_keys(call), match
        return None

    def _reader_gate(self, statement, func: Func):
        local = _local_models(func.node)
        readers = [c for c in _calls(statement.test) if self._is_reader_call(c, func, local)]
        if not readers:
            return None
        body = statement.body if isinstance(statement, ast.If) else [ast.Raise(exc=None)]
        if isinstance(statement, ast.Assert) or any(_refuses(n) for stmt in body for n in ast.walk(stmt)):
            return [k for c in readers for k in _literal_keys(c)], 'all'
        return None

    def _is_reader_call(self, call: ast.Call, func: Func, local: dict[str, str]) -> bool:
        """A reader by name, or a resolved function that calls one directly."""
        if self.index.is_reader(func.path, call_name(call)):
            return True
        candidates, _ = self._candidates(call, func, local)
        return any(any(self.index.is_reader(c.path, call_name(inner)) for inner in _calls(c.node))
                   for c in candidates)

    def _call_gates(self, call: ast.Call, func: Func, local: dict[str, str]) -> bool:
        name = call_name(call)
        if name in CAPABILITY_CALLS:
            return True
        controller_self = (isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name)
                           and call.func.value.id in ('self', 'cls') and not func.models)
        if _is_stock(name) and not controller_self:
            return False
        candidates, every = self._candidates(call, func, local)
        quantifier = all if every else any
        return bool(candidates) and quantifier(self.function_gates(candidate) for candidate in candidates)

    def _candidates(self, call: ast.Call, func: Func, local: dict[str, str]) -> tuple[list[Func], bool]:
        """``(functions the call may reach, whether all of them must gate)``."""
        name = call_name(call)
        if isinstance(call.func, ast.Name):
            same = self.index.module_funcs.get(func.path, {}).get(name)
            if same:
                return [same], False
            target = self.index.imports.get(func.path, {}).get(name)
            found = self.index.module_funcs.get(target[0], {}).get(target[1]) if target else None
            return ([found] if found else []), False
        if not isinstance(call.func, ast.Attribute):
            return [], False
        receiver = call.func.value
        if isinstance(receiver, ast.Name) and receiver.id in ('self', 'cls'):
            own = [f for f in self.index.func_of.values() if f.cls is func.cls and f.node.name == name] if func.cls else []
            by_model = [f for model in func.models for f in self.index.by_model.get(model, {}).get(name, [])]
            return own + by_model, False
        model = _receiver_model(receiver, local)
        if model:
            return self.index.by_model.get(model, {}).get(name, []), False
        if name.startswith('_webvue_'):  # a record of unknown model: WebVue's own names, if any definition gates
            return [f for methods in self.index.by_model.values() for f in methods.get(name, [])], False
        return [], False


def _top_level(body: list[ast.stmt]):
    """The statements that always run in order: a `try` body counts, its handlers do not."""
    for statement in body:
        if isinstance(statement, ast.Try):
            yield from _top_level(statement.body)
        else:
            yield statement


def _unconditional_calls(expression: ast.expr):
    """Calls that always run when ``expression`` is evaluated: not those under a lambda, a
    conditional expression, a short-circuit operator or a comprehension."""
    stack = [expression]
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.Lambda, ast.IfExp, ast.BoolOp, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            continue
        if isinstance(node, ast.Call):
            yield node
        stack.extend(ast.iter_child_nodes(node))


def _literal_keys(call: ast.Call) -> list[str]:
    return [k for arg in call.args for k in const_strings(arg)]


def _refuses(node: ast.AST) -> bool:
    """A 403 / AccessError raise, or a call to a ``require*`` helper."""
    if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
        name = call_name(node.exc)
        first = node.exc.args[0] if node.exc.args else None
        return name in ('AccessError', 'WebVueAccessRule') or (
            name == 'ApiError' and isinstance(first, ast.Constant) and first.value == 403)
    return isinstance(node, ast.Call) and 'require' in call_name(node)


# --- routes -----------------------------------------------------------------------------------


def _service_trees() -> dict[Path, ast.Module]:
    """Controller and model modules at any depth: the places a capability check can live.

    Both globs are recursive so the nested area packages of a controller addon (and any
    nested model package) are indexed too; ``__init__.py`` only imports and never carries a
    handler or a model, so it is skipped at every depth.
    """
    paths = [*ADDONS.glob('*/controllers/**/*.py'), *ADDONS.glob('*/models/**/*.py')]
    return {
        py: ast.parse(py.read_text(encoding='utf-8'))
        for py in sorted({py for py in paths if py.name != '__init__.py'})
    }


def extract_routes(trees: dict[Path, ast.Module] | None = None, service_trees: dict[Path, ast.Module] | None = None) -> list[Route]:
    """The /api/v1 routes of api_surface's extraction, each with its gates analysed."""
    trees = trees if trees is not None else api_surface.parse_controllers()
    gates = Gates(Index({**(service_trees if service_trees is not None else _service_trees()), **trees}))
    routes = []
    for raw in api_surface.extract_routes(trees):
        paths = [p for p in raw['paths'] if p.startswith(API_PREFIX)]
        if paths:
            routes.append(_route(raw, paths, gates))
    return routes


def _route(raw: dict, paths: list[str], gates: Gates) -> Route:
    fn = raw['node']
    route = Route(
        addon=raw['addon'], file=raw['file'], controller=raw['controller'], handler=raw['handler'],
        paths=paths, methods=raw['methods'], auth=raw['auth'], http_type=raw['http_type'],
        rank=addon_ranks().get(raw['addon'], FEATURE_MIN_RANK), decorators=raw['decorators'],
        api_handler=raw['api_handler'], feature_keys=raw['feature_keys'],
        has_feature=any(d in FEATURE_DECORATORS for d in raw['decorators']),
    )
    decorator = next((d for d in fn.decorator_list if decorator_name(d) == CAPABILITY_DECORATOR
                      and isinstance(d, ast.Call)), None)
    if decorator is not None:
        route.capability_source = 'decorator'
        route.capability_keys = _literal_keys(decorator)
        route.capability_match = kw_const(decorator, 'match') or 'all'
        return route
    func = gates.index.func_of.get(id(fn)) or Func(fn, REPO / raw['file'], raw['class_node'], ())
    gated, keys, match = gates.scan(func)
    if gated:
        route.capability_source, route.capability_keys, route.capability_match = 'body', sorted(set(keys)), match
    return route


def order_problem(route: Route) -> str | None:
    """None when the decorators run ``route``, ``api_handler``, feature gate, ``requires_capability``."""
    ranks = [next(i for i, group in enumerate(DECORATOR_ORDER) if name in group)
             for name in route.decorators if any(name in group for group in DECORATOR_ORDER)]
    if ranks == sorted(ranks):
        return None
    return (f'{route.file}:{route.handler} {route.paths[0]} decorators are out of order, expected '
            f'route, api_handler, requires_feature*, requires_capability (got {", ".join(route.decorators)})')


# --- non-literal model names ------------------------------------------------------------------


def _is_env_subscript(node: ast.AST) -> bool:
    return (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute)
            and node.value.attr == 'env')


def _is_constant_lookup(node: ast.expr) -> bool:
    """A literal, an UPPER_CASE constant, or a lookup in one (``TABLE[x]`` / ``TABLE.get(x)``)."""
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.Name):
        return bool(CONSTANT_NAME.fullmatch(node.id))
    if isinstance(node, ast.Subscript):
        return _is_constant_lookup(node.value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'get':
        return _is_constant_lookup(node.func.value)
    return False


def _local_constant(fn, name: str) -> bool:
    """``name`` is only ever assigned from constant lookups inside ``fn``."""
    values = [n.value for n in ast.walk(fn)
              if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
    return bool(values) and all(_is_constant_lookup(v) for v in values)


class _Scoped(ast.NodeVisitor):
    """Collects the nodes of one kind together with their chain of enclosing functions."""

    def __init__(self, wanted):
        self.wanted, self.stack, self.found = wanted, [], []

    def generic_visit(self, node):
        if isinstance(node, self.wanted):
            self.found.append((node, tuple(self.stack)))
        is_fn = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        if is_fn:
            self.stack.append(node)
        super().generic_visit(node)
        if is_fn:
            self.stack.pop()


def _scoped(tree: ast.Module, wanted) -> list[tuple[ast.AST, tuple]]:
    visitor = _Scoped(wanted)
    visitor.visit(tree)
    return visitor.found


def _param_names(fn) -> list[str]:
    params = [a.arg for a in fn.args.args]
    return params[1:] if params and params[0] in ('self', 'cls') else params


def _param_always_constant(call_sites, fn, param: str, seen=frozenset()) -> bool:
    """Every call site of ``fn`` passes a constant for ``param``, or forwards a parameter of its
    own function that is itself always constant."""
    params = _param_names(fn)
    if param not in params or (fn.name, param) in seen:
        return False
    index = params.index(param)
    seen = seen | {(fn.name, param)}
    for site, stack in call_sites.get(fn.name, []):
        arg = next((k.value for k in site.keywords if k.arg == param), None)
        if arg is None and index < len(site.args):
            arg = site.args[index]
        if arg is None or _is_constant_lookup(arg):
            continue
        if not (isinstance(arg, ast.Name) and _name_is_constant(call_sites, stack, arg.id, seen)):
            return False
    return True


def _name_is_constant(call_sites, stack, name: str, seen=frozenset()) -> bool:
    """``name`` is only assigned constant lookups in an enclosing function, or is a parameter
    of one that every caller fills with a constant."""
    for fn in reversed(stack):
        if _local_constant(fn, name) or _param_always_constant(call_sites, fn, name, seen):
            return True
    return False


def dynamic_models(trees: dict[Path, ast.Module] | None = None) -> list[str]:
    """``file:line`` of every ``request.env[<expr>]`` whose model name is not a constant."""
    trees = trees if trees is not None else api_surface.parse_controllers()
    # Call sites are matched by name within one addon: helpers are private to it.
    addon_sites: dict[str, dict[str, list]] = {}
    for py, tree in trees.items():
        sites = addon_sites.setdefault(py.parent.parent.name, {})
        for call, stack in _scoped(tree, ast.Call):
            sites.setdefault(call_name(call), []).append((call, stack))
    found = []
    for py, tree in trees.items():
        call_sites = addon_sites[py.parent.parent.name]
        for node, stack in _scoped(tree, ast.Subscript):
            if not _is_env_subscript(node) or _is_constant_lookup(node.slice):
                continue
            if isinstance(node.slice, ast.Name) and _name_is_constant(call_sites, stack, node.slice.id):
                continue
            found.append(f'{py.relative_to(REPO)}:{node.lineno} {ast.unparse(node)}')
    return sorted(set(found))


# --- the allowlist ----------------------------------------------------------------------------

GROUPS = ('no_feature', 'no_capability', 'no_api_handler')


def load_allowlist(path: Path = ALLOWLIST) -> dict[str, dict[str, str]]:
    """``{group: {key: reason}}``. The file lists, per group, entries of ``{"reason", "routes"}``;
    the routes of one entry share its reason."""
    data = json.loads(path.read_text(encoding='utf-8'))
    allow: dict[str, dict[str, str]] = {}
    for group in GROUPS:
        allow[group] = {}
        for entry in data.get(group, []):
            for key in entry['routes']:
                allow[group][key] = entry.get('reason', '')
    return allow


def route_problems(routes: list[Route], allow: dict[str, dict[str, str]]) -> list[str]:
    problems = []
    used: set[tuple[str, str]] = set()

    def need(route: Route, group: str, label: str):
        if route.key in allow[group]:
            used.add((group, route.key))
        else:
            problems.append(f'{route.file}:{route.handler} {route.paths[0]} has no {label}')

    for route in routes:
        if route.http_type == 'json2' and not route.api_handler:
            need(route, 'no_api_handler', 'api_handler')
        if route.rank >= FEATURE_MIN_RANK and not route.has_feature:
            need(route, 'no_feature', 'feature gate (requires_feature / requires_registered_feature)')
        if not route.has_capability:
            need(route, 'no_capability', 'capability gate (requires_capability or a top-level require_capability call)')
        problem = order_problem(route)
        if problem:
            problems.append(problem)
    known = {r.key for r in routes}
    for group in GROUPS:
        for key, reason in allow[group].items():
            if not reason.strip():
                problems.append(f'allowlist {group} {key}: reason is empty')
            elif key not in known:
                problems.append(f'allowlist {group} {key}: no such route, remove the entry')
            elif (group, key) not in used:
                problems.append(f'allowlist {group} {key}: route no longer needs the entry, remove it')
    return problems


def check() -> list[str]:
    return (route_problems(extract_routes(), load_allowlist())
            + [f'{site}: model name is not a constant' for site in dynamic_models()])


def main() -> int:
    problems = check()
    for problem in problems:
        sys.stderr.write(problem + '\n')
    if problems:
        sys.stderr.write(f'route gate policy: {len(problems)} problem(s)\n')
        return 1
    sys.stdout.write('route gate policy: ok\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
