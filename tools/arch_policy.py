# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Architecture rules R1-R10 with a shrinking baseline.

Spec: docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import posixpath
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYERS_FILE = Path(__file__).resolve().parent / 'arch_layers.json'
BASELINE_FILE = Path(__file__).resolve().parent / 'arch_baseline.json'
DOCUMENTED_SUDO_FILE = Path(__file__).resolve().parent / 'arch_documented_sudo.json'
AGENTS_FILE = 'AGENTS.md'

# Rank bands: 0-2 foundation (core, platform, api), 3 shared service, 4 app, 5 bridge, 6 customer overlay.
APPROVAL_TRAILER = 'Architecture-approved-by'
BRIDGE_RANK = 5
APP_RANK = 4
FOUNDATION_MAX_RANK = 2

# R2 tokens that are not an addon of this repository: Odoo models.
# app_token() adds every registered application and bridge (ranks 4 and 5 in arch_layers.json).
STATIC_APP_TOKENS = ('project',)
ADDON_IMPORT = re.compile(r'odoo\.addons\.((?:webvue|customer)_\w+)')
CONTROL_PLANE_IMPORT = re.compile(r"""(?:from|import|require\()\s*\(?['"][^'"\n]*control-plane""")
# UI1: a file of a shared UI layer (packages/ui, packages/commercial-ui) reaches into an application, an addon, an app alias, the contracts or the control plane.
UI_LAYER_FORBIDDEN = re.compile(
    # A JS specifier needs its opening quote, so prose such as "moved from apps/web/app/x" in a comment is not an import;
    # CSS at-rules and url() may be unquoted.
    r"""(?:(?:\bfrom|\bimport|\brequire\(|import\.meta\.glob\()\s*[(\[]?\s*['"]|(?:@import|@source|url\()\s*['"]?)"""
    r"""(?:[./]*/)?(?:apps/|odoo-addons/|@/|@@/|~/|~~/|@webvue/contracts|[^'"\n]*control-plane)""",
)
UI_LAYER_FILES = ('.ts', '.vue', '.css')
# VA1: a file of the vendor admin app (a) imports an application, an addon, the customer contracts or the control plane, or
# leaves its own folder through a relative path or an alias, or (b) names an Odoo route as a string. Specifiers are read from
# quoted import forms (JS) and at-rules / url() (CSS) only, so prose in comments never matches; they are judged by path
# segment, so `~/components/control-plane-status` is fine while `../control-plane/x` is not.
JS_SPECIFIER = re.compile(r"""(?:\bfrom|\bimport|\brequire\(|import\.meta\.glob\()\s*[(\[]?\s*(['"`])([^'"`\n]+)\1""")
CSS_SPECIFIER = re.compile(r"""(?:@import|@source)\s*(?:url\()?\s*['"`]?([^'"`);\s]+)|\burl\(\s*['"`]?([^'"`)\s]+)""")
# nuxt.config / vitest.config strings that are paths: `extends`, `alias`, `srcDir`, layer entries.
CONFIG_PATH_STRING = re.compile(r"""['"`]((?:\.{1,2}|~~?|@@?)/[^'"`\n]*)['"`]""")
VENDOR_ADMIN_ODOO_ROUTE = re.compile(
    r"""['"`]/(?:api/v1|web|odoo|jsonrpc|json/2|websocket|mail|longpolling)(?:[/?#'"`]|$)""", re.MULTILINE)
VENDOR_ADMIN_FILES = ('.ts', '.vue', '.css', '.js', '.mjs', '.mts', '.cjs', '.tsx')
VENDOR_ADMIN_SKIPPED_DIRS = {'node_modules', '.nuxt', '.output', 'dist', 'storybook-static'}
VENDOR_ADMIN_TEST_DIRS = {'test', 'tests', 'e2e'}
FORBIDDEN_SEGMENTS = {'apps', 'odoo-addons', 'control-plane'}
COMMERCIAL_IMPORT = re.compile(r"""(?:from|import)\s*\(?['"]@webvue/commercial-contracts""")
CUSTOMER_KIND = re.compile(r'\b(?:government|is_gov|gov_)', re.IGNORECASE)
SQL_TABLE = re.compile(
    r'\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:ONLY\s+)?'
    r'(?!(?:OF|SET|LATERAL|SELECT|ROWS?|UNNEST|GENERATE_SERIES)\b)"?([a-z][a-z0-9_]*)"?',
    re.IGNORECASE,
)
# Constructs whose FROM is not a table reference: IS DISTINCT FROM and the argument of EXTRACT/SUBSTRING/...
SQL_NON_TABLE_FROM = re.compile(
    r'\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b|\b(?:EXTRACT|SUBSTRING|TRIM|OVERLAY|POSITION)\s*\([^()]*\)', re.IGNORECASE,
)
ODOO_INHERIT = re.compile(r'''_inherit\s*=\s*['"](?!webvue\.)''')
ACCESS_OVERRIDE = re.compile(r'^\s+def (?:_search|check_access|_check_access)\(', re.MULTILINE)
ENABLED_FEATURE = re.compile(r'''['"]key['"]\s*:\s*['"][a-z_]+\.enabled['"]''')

Violations = dict[str, dict[str, int]]
# A weakening comparator: the weakenings one file content has that another one, compared with it, does not.
Weakenings = Callable[..., list[str]]


def is_test_path(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & {'tests', '__tests__', 'e2e'}) or '.test.' in path.name or '.spec.' in path.name


def ui_layer_violations(text: str) -> int:
    """UI1: imports of an application, addon, alias, the contracts or the control plane in a shared UI layer file."""
    return count(UI_LAYER_FORBIDDEN, text)


def specifiers(text: str, file: Path) -> list[str]:
    """Import-like specifiers of one file: JS imports, CSS at-rules and url(), config path strings."""
    found = [m[1] for m in JS_SPECIFIER.findall(text)]
    if file.suffix == '.css' or file.suffix == '.vue':
        found += [first or second for first, second in CSS_SPECIFIER.findall(text)]
    if '.config.' in file.name:
        found += CONFIG_PATH_STRING.findall(text)
    return [item for item in found if ':' not in item and not item.startswith('data')]


def escapes_app(specifier: str, file: Path, app_dir: Path) -> bool:
    """A relative path or alias that resolves outside the application folder (`~/` and `@/` mean its `app/`, `~~/` and `@@/` its root)."""
    if specifier.startswith(('~~/', '@@/')):
        target = os.path.join(app_dir, specifier[3:])
    elif specifier.startswith(('~/', '@/')):
        target = os.path.join(app_dir, 'app', specifier[2:])
    elif specifier.startswith('.'):
        target = os.path.join(file.parent, specifier)
    else:
        return False
    base = os.path.normpath(app_dir)
    target = os.path.normpath(target)
    return target != base and not target.startswith(base + os.sep)


def vendor_admin_violations(text: str, file: Path, app_dir: Path) -> int:
    """VA1: forbidden imports, folder escapes or Odoo route strings in a vendor admin app file."""
    found = count(VENDOR_ADMIN_ODOO_ROUTE, text)
    for specifier in specifiers(text, file):
        segments = specifier.split('/')
        bare = not specifier.startswith(('.', '~', '@/', '@@'))
        if escapes_app(specifier, file, app_dir) or (
                bare and (FORBIDDEN_SEGMENTS & set(segments) or segments[:2] == ['@webvue', 'contracts'])):
            found += 1
    return found


def vendor_admin_imported(text: str, file: Path) -> int:
    """VA1: imports of the vendor admin app from the customer app (a `vendor-admin` path segment)."""
    return sum('vendor-admin' in specifier.split('/') for specifier in specifiers(text, file))


def is_vendor_admin_test(rel: Path) -> bool:
    """Tight exemption: *.test.* / *.spec.* files and the top-level test, tests or e2e folder of the app."""
    parts = rel.parts[2:]
    return '.test.' in rel.name or '.spec.' in rel.name or (len(parts) > 1 and parts[0] in VENDOR_ADMIN_TEST_DIRS)


def count(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


def app_token(ranks: dict[str, int]) -> re.Pattern[str]:
    """R2: `<prefix>.x` and `<addon>.` tokens a foundation file must not contain.

    Each registered application or bridge `webvue_<name>` contributes `<name>.` (its capability
    and feature keys) and `webvue_<name>.` (its xml ids and imports). Shared services (rank 3),
    the foundation and customer overlays contribute nothing. Longer alternatives come first,
    and `\\b` keeps `meetings_pmo.` inside `webvue_meetings_pmo.` from counting twice.
    """
    addons = sorted((a for a, rank in ranks.items() if rank in (APP_RANK, BRIDGE_RANK)), key=lambda a: (-len(a), a))
    prefixes = sorted({*STATIC_APP_TOKENS, *(a.removeprefix('webvue_') for a in addons)}, key=lambda p: (-len(p), p))
    names = '|'.join(map(re.escape, addons)) or '(?!)'
    return re.compile(rf'\b(?:(?:{"|".join(map(re.escape, prefixes))})\.[a-z_]|(?:{names})\.)')


def manifest_depends(text: str) -> list[str]:
    return list(ast.literal_eval(text).get('depends', []))


def unregistered_addons(addons: list[str], ranks: dict[str, int], exempt: list[str]) -> list[str]:
    return sorted(a for a in addons if a not in ranks and a not in exempt)


def core_depends_violations(depends: list[str]) -> dict[str, int]:
    """R1: webvue_core depends on base only."""
    return {f'webvue_core depends on {dep}': 1 for dep in depends if dep != 'base'}


def layer_violations(addon: str, targets: list[str], ranks: dict[str, int], kind: str) -> dict[str, int]:
    """R3/R4: a layered addon may only reach a strictly lower rank."""
    found: dict[str, int] = {}
    for target in targets:
        if target == addon or target not in ranks:
            continue
        if ranks[target] >= ranks[addon]:
            key = f'{addon} {kind} {target}'
            found[key] = found.get(key, 0) + 1
    return found


def _decorator_name(node: ast.expr) -> str:
    target = node.func if isinstance(node, ast.Call) else node
    return target.attr if isinstance(target, ast.Attribute) else getattr(target, 'id', '')


def sudo_calls(text: str, superuser_id: bool = True) -> int:
    """R7: .sudo() calls, su=True keywords and used SUPERUSER_ID names; comments and strings are not counted."""
    tree = ast.parse(text)
    found = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            found += isinstance(node.func, ast.Attribute) and node.func.attr == 'sudo'
            found += sum(
                1 for kw in node.keywords
                if kw.arg == 'su' and isinstance(kw.value, ast.Constant) and kw.value.value is True
            )
        elif superuser_id and isinstance(node, ast.Name) and node.id == 'SUPERUSER_ID':
            found += 1
    return found


def routes_without_feature(text: str) -> list[str]:
    """R10: controller functions with a route decorator and no requires_feature."""
    missing = []
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef):
            names = [_decorator_name(d) for d in node.decorator_list]
            if 'route' in names and 'requires_feature' not in names:
                missing.append(node.name)
    return missing


def _scope_nodes(scope: ast.AST) -> list[ast.AST]:
    """Nodes of one function body (or the module), not descending into nested functions."""
    found: list[ast.AST] = []
    stack = list(ast.iter_child_nodes(scope))
    while stack:
        node = stack.pop()
        found.append(node)
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            stack.extend(ast.iter_child_nodes(node))
    return found


def _string_constants(node: ast.AST) -> list[ast.Constant]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _sql_strings(text: str) -> list[str]:
    """String constants (f-string literal parts included) inside arguments of `.execute(...)` / `SQL(...)`.

    A Name argument also contributes the strings assigned to that name in the same function (module-level
    calls: module-level assignments), through `=`, annotated `=` and `+=`.
    """
    tree = ast.parse(text)
    seen: set[int] = set()
    strings: list[str] = []

    def collect(node: ast.AST) -> None:
        for const in _string_constants(node):
            if id(const) not in seen:
                seen.add(id(const))
                strings.append(const.value)

    scopes = [tree, *(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))]
    for scope in scopes:
        nodes = _scope_nodes(scope)
        assigned: dict[str, list[ast.AST]] = {}
        for node in nodes:
            if isinstance(node, ast.Assign):
                targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign)) and isinstance(node.target, ast.Name):
                targets = [node.target.id]
            else:
                continue
            if node.value is not None:
                for name in targets:
                    assigned.setdefault(name, []).append(node.value)
        for node in nodes:
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', '')
            if name not in ('execute', 'SQL'):
                continue
            pending = [*node.args, *(kw.value for kw in node.keywords)]
            resolved: set[str] = set()
            while pending:
                arg = pending.pop()
                collect(arg)
                for n in ast.walk(arg):
                    if isinstance(n, ast.Name) and n.id not in resolved:
                        resolved.add(n.id)
                        pending.extend(assigned.get(n.id, []))
    return strings


def sql_on_odoo_tables(text: str) -> int:
    """R9: SQL passed to execute()/SQL() that names a table that is not a webvue_ table."""
    return sum(
        1 for sql in _sql_strings(text) for table in SQL_TABLE.findall(SQL_NON_TABLE_FROM.sub(' ', sql)) if not table.lower().startswith('webvue_')
    )


def odoo_access_overrides(text: str) -> int:
    """R9: _search/check_access overrides in a file that extends an Odoo model."""
    return count(ACCESS_OVERRIDE, text) if ODOO_INHERIT.search(text) else 0


def pascal(name: str) -> str:
    return ''.join(part.capitalize() for part in name.split('-'))


def kebab(prefix: str) -> str:
    return re.sub(r'(?<!^)(?=[A-Z])', '-', prefix).lower()


def tag_prefixes(dirs: dict) -> list[str]:
    """PascalCase tag prefixes of an app's components: the optional `tags` list, else one per components folder."""
    return list(dirs['tags']) if dirs.get('tags') else [pascal(d) for d in dirs['components']]


def component_tag(prefix: str) -> re.Pattern[str]:
    """A Nuxt tag starting with a PascalCase prefix: PascalCase or kebab-case, with or without `Lazy`."""
    return re.compile(rf'<(?:Lazy)?{re.escape(prefix)}[A-Z]|<(?:lazy-)?{re.escape(kebab(prefix))}-[a-z]')


# Strings are matched first so a `//` inside one (a URL) does not start a comment.
SOURCE_TOKEN = re.compile(
    r"""('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(/\*.*?\*/|//[^\n]*|<!--.*?-->)""",
    re.DOTALL,
)
IMPORT_SPECIFIER = re.compile(
    r"""(?:\b(?:import|export)\b[^'"`;]*?\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1""",
)


def strip_comments(text: str) -> str:
    return SOURCE_TOKEN.sub(lambda m: m.group(1) or ' ', text)


def mask_strings(text: str) -> str:
    """The same text with every string body blanked, so parenthesis scanning never sees one inside a string."""
    return SOURCE_TOKEN.sub(
        lambda m: m.group(1)[:1] + ' ' * (len(m.group(1)) - 2) + m.group(1)[-1:] if m.group(1) else ' ', text,
    )


DEFINE_PAGE_META = re.compile(r'\bdefinePageMeta\s*\(')
MIDDLEWARE_PROPERTY = re.compile(r'\bmiddleware\s*:\s*(?:\[([^\[\]]*)\]|([^,}\n]+))')
STRING_LITERAL = re.compile(r"""'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`""")


def define_page_meta_arguments(text: str) -> list[str]:
    """The argument text of every `definePageMeta(...)` call; comments and strings are not scanned for its parentheses."""
    code = strip_comments(text)
    scan = mask_strings(code)
    arguments = []
    for match in DEFINE_PAGE_META.finditer(scan):
        depth = 1
        for index in range(match.end(), len(scan)):
            if scan[index] == '(':
                depth += 1
            elif scan[index] == ')':
                depth -= 1
                if depth == 0:
                    arguments.append(code[match.end():index])
                    break
    return arguments


def string_literals(text: str) -> list[str]:
    """The contents of the quoted string literals in one source fragment."""
    return [first or second or third for first, second, third in STRING_LITERAL.findall(text)]


def declared_middleware(argument: str) -> list[str]:
    """The names one `definePageMeta(...)` argument list gives to its `middleware` property.

    The property is located on a string-blanked copy so a `middleware:` inside a string value is no
    declaration, while the names themselves are read from the original text.
    """
    scan = mask_strings(argument)
    names = []
    for match in MIDDLEWARE_PROPERTY.finditer(scan):
        group = 1 if match.group(1) is not None else 2
        names += string_literals(argument[match.start(group):match.end(group)])
    return names


def page_declares_middleware(text: str, middleware: str) -> bool:
    """R8: the page declares the middleware as the value of a `definePageMeta(...)` middleware property."""
    return any(middleware in declared_middleware(argument) for argument in define_page_meta_arguments(text))


def import_specifiers(text: str, rel: str | None = None) -> list[str]:
    """Module specifiers of static and dynamic imports (comments ignored, `import.meta.glob` excluded).

    A relative specifier is resolved against the importing file's folder `rel` (a repository path)
    so `../hr/manifest` from modules/pmo/ becomes `.../modules/hr/manifest`.
    """
    found = []
    for match in IMPORT_SPECIFIER.finditer(strip_comments(text)):
        spec = match.group(2)
        if spec.startswith('.') and rel:
            spec = posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec))
        found.append(spec)
    return found


def foreign_component_uses(text: str, own_app: str, web_apps: dict, rel: str | None = None) -> int:
    """R3 (web): tags or imports of another app's components or module manifest folder."""
    total = 0
    code = strip_comments(text)
    specifiers = import_specifiers(text, rel)
    for app, dirs in web_apps.items():
        if app == own_app:
            continue
        total += sum(1 for s in specifiers if re.search(rf'(?:^|/)modules/{re.escape(app)}(?:/|$)', s))
        for prefix in tag_prefixes(dirs):
            total += len(component_tag(prefix).findall(code))
        for directory in dirs['components']:
            total += sum(1 for s in specifiers if re.search(rf'(?:^|/)components/{re.escape(directory)}(?:/|$)', s))
    return total


def increases(current: Violations, baseline: Violations) -> list[str]:
    problems = []
    for rule in sorted(current):
        base = baseline.get(rule, {})
        for key, have in sorted(current[rule].items()):
            if have > base.get(key, 0):
                problems.append(f'{rule}: {key}: {have} found, baseline allows {base.get(key, 0)}')
    return problems


def stale(current: Violations, baseline: Violations) -> list[str]:
    problems = []
    for rule in sorted(baseline):
        now = current.get(rule, {})
        for key, allowed in sorted(baseline[rule].items()):
            if now.get(key, 0) < allowed:
                problems.append(
                    f'{rule}: {key}: {now.get(key, 0)} found, baseline says {allowed}; '
                    'lower the baseline with --write-baseline',
                )
    return problems


def compare(current: Violations, baseline: Violations) -> list[str]:
    return increases(current, baseline) + stale(current, baseline)


def rule_totals(v: Violations) -> dict[str, int]:
    return {rule: sum(keys.values()) for rule, keys in v.items()}


def totals_growth(new: dict[str, int], old: dict[str, int], label: str) -> list[str]:
    return [
        f'{rule}: baseline total {have} exceeds {label} total {old.get(rule, 0)}'
        for rule, have in sorted(new.items()) if have > old.get(rule, 0)
    ]


class UnknownRef(RuntimeError):
    pass


def _git_show(root: Path, ref: str, rel: str) -> str | None:
    """File content at REF, or None when only that path is missing there."""
    verify = subprocess.run(
        ['git', 'rev-parse', '--verify', '--quiet', f'{ref}^{{commit}}'],
        cwd=root, capture_output=True, text=True, check=False, shell=False,
    )
    if verify.returncode != 0:
        raise UnknownRef(f"git rev-parse {ref} failed: unknown ref '{ref}'")
    return file_at(root, ref, rel)


def file_at(root: Path, rev: str, rel: str) -> str | None:
    """File content at REV, or None when REV has no such path (a root commit has no `REV^` either)."""
    done = subprocess.run(
        ['git', 'show', f'{rev}:{rel}'], cwd=root, capture_output=True, text=True, check=False, shell=False,
    )
    return done.stdout if done.returncode == 0 else None


def ratchet_problems(
    ref: str, root: Path, layers_file: Path, baseline_file: Path, totals: dict[str, int], baseline_exists: bool,
    documented_file: Path | None = None,
) -> list[str]:
    """Compare the baseline totals, the layers file and the documented sudo cases with the same files at REF."""
    ref_baseline = _git_show(root, ref, baseline_file.relative_to(root).as_posix())
    ref_layers = _git_show(root, ref, layers_file.relative_to(root).as_posix())
    problems = []
    if ref_baseline is not None:
        if not baseline_exists:
            problems.append(f'baseline file deleted; restore it from {ref}')
        problems += totals_growth(totals, rule_totals(json.loads(ref_baseline)), ref)
    if ref_layers is not None:
        layer_problems = layers_weakened(json.loads(ref_layers), json.loads(_read(layers_file)), root)
        if layer_problems and not change_approved(ref, root, layers_file, layer_weakenings):
            problems += layer_problems
    if documented_file is not None:
        problems += documented_growth(ref, root, documented_file)
    return problems


def layer_weakenings(root: Path, before: str | None, after: str | None) -> list[str]:
    """The arch_layers.json weakenings the `after` content has that `before` does not; an absent file is empty."""
    if after is None:
        return []
    return layers_weakened(json.loads(before) if before is not None else {}, json.loads(after), root)


def documented_weakenings(_root: Path, before: str | None, after: str | None) -> list[str]:
    """The documented sudo cases whose count the `after` content raises above `before`; an absent file is empty.

    `_root` only completes the `change_approved` weakening-comparator signature; a documented case count
    needs no filesystem lookup.
    """
    old = documented_counts(json.loads(before)) if before is not None else {}
    new = documented_counts(json.loads(after)) if after is not None else {}
    return [rel for rel, count in sorted(new.items()) if count > old.get(rel, 0)]


def commits_touching(root: Path, ref: str, rel: str) -> list[tuple[str, str]]:
    """The (commit id, message body) of every commit in REF..HEAD that changes `rel`, one entry per commit.

    `--full-history` keeps the commits behind a merge: the default path simplification drops the commit
    that made a change when a later merge also touches the file, which would hide the weakening to attribute.
    The listing is keyed by commit id, so a commit with an empty message is still one entry.
    """
    done = subprocess.run(
        ['git', 'log', '--full-history', '--format=%H%x1f%B%x00', f'{ref}..HEAD', '--', rel],
        cwd=root, capture_output=True, text=True, check=False, shell=False,
    )
    commits = []
    for record in done.stdout.split('\x00'):
        if '\x1f' in record:
            sha, body = record.split('\x1f', 1)
            commits.append((sha.strip(), body))
    return commits


def commit_approved(body: str) -> bool:
    """One commit message carries the owner approval trailer."""
    return bool(re.search(rf'^{re.escape(APPROVAL_TRAILER)}: .+$', body, re.MULTILINE))


def commit_parents(root: Path, sha: str) -> list[str]:
    """The parent commit ids of SHA, in order (nothing for a root commit or an unknown id)."""
    done = subprocess.run(
        ['git', 'log', '-1', '--format=%P', sha], cwd=root, capture_output=True, text=True, check=False, shell=False,
    )
    return done.stdout.split()


def change_approved(
    ref: str, root: Path, tracked_file: Path, weakenings: Weakenings,
) -> bool:
    """True when every commit in REF..HEAD that introduces a weakening carries the owner approval trailer.

    `weakenings(root, before, after)` lists the weakenings the file content at a commit has that another
    content does not, and it is asked for every parent. A commit introduces a weakening only when no parent
    already has it, so a merge that merely combines branches whose weakenings their own commits carry needs
    no trailer of its own, while a weakening no parent has (a conflict resolution) does. A commit with no
    parent is compared with an empty file, and a range that introduces no weakening at all is not approved,
    because the weakening then comes from something outside the range (an uncommitted edit).
    """
    rel = tracked_file.relative_to(root).as_posix()
    approved = 0
    for sha, body in commits_touching(root, ref, rel):
        after = file_at(root, sha, rel)
        parents = commit_parents(root, sha) or [f'{sha}^']  # no parent: compared with an empty file
        introduced = set.intersection(*(
            set(weakenings(root, file_at(root, parent, rel), after)) for parent in parents
        ))
        if not introduced:
            continue
        if not commit_approved(body):
            return False
        approved += 1
    return approved > 0


def documented_counts(documented: dict) -> dict[str, int]:
    return {rel: case['count'] for rel, case in documented.get('cases', {}).items()}


def documented_growth(ref: str, root: Path, documented_file: Path) -> list[str]:
    """R7: a new documented sudo case or a higher count needs the owner trailer on the commit that changes the file."""
    ref_text = _git_show(root, ref, documented_file.relative_to(root).as_posix())
    old = documented_counts(json.loads(ref_text)) if ref_text is not None else {}
    new = documented_counts(json.loads(_read(documented_file))) if documented_file.is_file() else {}
    grown = [rel for rel, have in sorted(new.items()) if have > old.get(rel, 0)]
    if not grown or change_approved(ref, root, documented_file, documented_weakenings):
        return []
    return [
        f'R7: {rel}: documented sudo case added without {APPROVAL_TRAILER}: {new[rel]} documented, {ref} allows {old.get(rel, 0)}'
        for rel in grown
    ]


def without_documented(current: Violations, documented: dict[str, int]) -> Violations:
    """The violations that are left for the baseline once the documented sudo cases are taken out of R7."""
    r7 = {rel: n - documented.get(rel, 0) for rel, n in current.get('R7', {}).items()}
    return {**current, 'R7': {rel: n for rel, n in r7.items() if n > 0}}


def documented_problems(documented: dict[str, int], current: Violations, root: Path) -> list[str]:
    """Documented sudo cases must still exist in the code and be described in AGENTS.md."""
    problems = []
    for rel, allowed in sorted(documented.items()):
        found = current.get('R7', {}).get(rel, 0)
        if found < allowed:
            problems.append(
                f'R7: {rel}: {found} found, documented sudo case says {allowed}; lower or remove it in {DOCUMENTED_SUDO_FILE.name}',
            )
    agents = root / AGENTS_FILE
    paragraph = sudo_paragraph(_read(agents)) if agents.is_file() else ''
    for rel in sorted(documented):
        addon = rel.split('/')[1] if rel.startswith('odoo-addons/') else rel
        if f'`{addon}`' not in paragraph:
            problems.append(f'R7: {rel}: documented case not described in {AGENTS_FILE}')
    return problems


def sudo_paragraph(agents_text: str) -> str:
    """The AGENTS.md list item that lists the documented sudo cases."""
    for item in re.split(r'\n(?=- )', agents_text):
        if 'path.' in item and '`sudo()`' in item:
            return item
    return ''


def _web_owners(web_apps: dict, kind: str) -> dict[str, str]:
    return {d: app for app, dirs in web_apps.items() for d in dirs.get(kind, [])}


def _web_tags(web_apps: dict) -> dict[str, list[str]]:
    """The effective tag prefixes of every registered web app (its `tags`, else one per components folder)."""
    return {app: tag_prefixes(dirs) for app, dirs in web_apps.items()}


def layers_weakened(old: dict, new: dict, root: Path) -> list[str]:
    """Changes to arch_layers.json that hide violations; strengthening changes are not listed."""
    problems = [f'exempt list grew: {a}' for a in new.get('exempt', []) if a not in set(old.get('exempt', []))]
    new_ranks = new.get('ranks', {})
    for addon, rank in old.get('ranks', {}).items():
        if addon in new_ranks and new_ranks[addon] != rank:
            problems.append(f'rank of {addon} changed {rank} -> {new_ranks[addon]}')
        elif addon not in new_ranks and (root / 'odoo-addons' / addon).is_dir():
            problems.append(f'{addon} removed from arch_layers.json')
    old_commercial, new_commercial = old.get('commercial', {}), new.get('commercial', {})
    old_allowed = set(old_commercial.get('allowed', []))
    problems += [
        f'commercial allowed list grew: {prefix}' for prefix in new_commercial.get('allowed', [])
        if prefix not in old_allowed
    ]
    new_pages = new_commercial.get('pages', {})
    problems += [
        f'commercial page gate weakened: {folder}' for folder, middleware in old_commercial.get('pages', {}).items()
        if new_pages.get(folder) != middleware
    ]
    for kind, base in (('components', 'components'), ('pages', 'pages')):
        old_owner, new_owner = _web_owners(old.get('web_apps', {}), kind), _web_owners(new.get('web_apps', {}), kind)
        for directory, app in old_owner.items():
            if new_owner.get(directory) != app and (root / 'apps' / 'web' / 'app' / base / directory).is_dir():
                problems.append(f'web app folder {directory} moved from {app} to {new_owner.get(directory, "nowhere")}')
    # A tag prefix is what R3 matches against an app's components, so an app that stops covering one
    # hides foreign component uses. Only the effective prefixes count: a `tags` entry the components
    # folders already derive is removable without losing anything.
    old_prefixes, new_prefixes = _web_tags(old.get('web_apps', {})), _web_tags(new.get('web_apps', {}))
    problems += [
        f'web app tag {prefix} removed from {app}'
        for app, prefixes in old_prefixes.items()
        for prefix in prefixes if prefix not in new_prefixes.get(app, [])
    ]
    return problems


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _put(found: dict[str, int], key: str, value: int) -> None:
    if value:
        found[key] = value


def _addon_files(addon_dir: Path, suffixes: tuple[str, ...], root: Path | None = None) -> list[Path]:
    return sorted(
        p for p in addon_dir.rglob('*')
        if p.is_file() and p.suffix in suffixes and not is_test_path(p.relative_to(root) if root else p)
        and '__pycache__' not in p.parts and 'i18n' not in p.parts
    )


def new_app_r2_hits(root: Path, layers: dict, app: str) -> dict[str, int]:
    """R2 hits a new application `app` (addon `webvue_<app>`, rank 4) would add to files of rank 0-3.

    The token set is built exactly as `collect` does, once for the current ranks and once with the
    new application added; a file whose count grows would gain a violation.
    """
    ranks = layers['ranks']
    before, after = app_token(ranks), app_token({**ranks, f'webvue_{app}': APP_RANK})
    addons_root = root / 'odoo-addons'
    hits: dict[str, int] = {}
    if app in STATIC_APP_TOKENS:
        # Already an R2 token (an Odoo model), so no count can grow.
        hits[f'STATIC_APP_TOKENS contains {app!r}'] = 1
    for addon, rank in sorted(ranks.items()):
        if rank >= APP_RANK or not (addons_root / addon).is_dir():
            continue
        for path in _addon_files(addons_root / addon, ('.py', '.xml', '.csv'), root):
            if path.name == '__manifest__.py':
                continue
            text = _read(path)
            grown = count(after, text) - count(before, text)
            if grown > 0:
                hits[_rel(path, root)] = grown
    return hits


def collect(root: Path, layers: dict) -> tuple[Violations, list[str]]:
    ranks, exempt, web_apps = layers['ranks'], layers['exempt'], layers['web_apps']
    commercial = layers['commercial']
    token = app_token(ranks)
    addons_root = root / 'odoo-addons'
    addons = sorted(p.parent.name for p in addons_root.glob('*/__manifest__.py'))
    hard = [f'unregistered addon {a}: add it to tools/arch_layers.json' for a in unregistered_addons(addons, ranks, exempt)]
    hard += [f'arch_layers.json lists missing addon {a}' for a in sorted(ranks) if a not in addons]
    v: Violations = {rule: {} for rule in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10')}

    for addon in addons:
        if addon not in ranks:
            continue
        addon_dir = addons_root / addon
        manifest = ast.literal_eval(_read(addon_dir / '__manifest__.py'))
        depends = list(manifest.get('depends', []))
        if addon == 'webvue_core':
            v['R1'].update(core_depends_violations(depends))
        v['R4'].update(layer_violations(addon, depends, ranks, 'depends on'))
        if ranks[addon] == BRIDGE_RANK and not manifest.get('auto_install'):
            hard.append(f'bridge addon {addon} must set auto_install')
        if ranks[addon] == APP_RANK:
            registry = addon_dir / 'models' / 'feature_registry.py'
            text = _read(registry) if registry.is_file() else ''
            if not (ENABLED_FEATURE.search(text) and f"'owner': '{addon}'" in text):
                v['R10'][f'{addon} registers no <app>.enabled feature it owns'] = 1
        for path in _addon_files(addon_dir, ('.py', '.xml', '.csv'), root):
            text, rel = _read(path), _rel(path, root)
            if ranks[addon] <= FOUNDATION_MAX_RANK and path.name != '__manifest__.py':
                _put(v['R2'], rel, count(token, text))
            if path.suffix != '.py':
                continue
            for key, n in layer_violations(addon, ADDON_IMPORT.findall(text), ranks, 'imports').items():
                v['R3'][key] = v['R3'].get(key, 0) + n
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
            _put(v['R7'], rel, sudo_calls(text, superuser_id='migrations' not in path.parts))
            if ranks[addon] in (APP_RANK, BRIDGE_RANK) and 'controllers' in path.parts:
                for name in routes_without_feature(text):
                    v['R10'][f'{rel}:{name} has no requires_feature'] = 1
            if 'migrations' not in path.parts:
                _put(v['R9'], f'sql {rel}', sql_on_odoo_tables(text))
                _put(v['R9'], f'override {rel}', odoo_access_overrides(text))

    web = root / 'apps' / 'web'
    for base in (web / 'app', web / 'server'):
        for path in sorted(base.rglob('*')):
            rel = _rel(path, root)
            if not path.is_file() or path.suffix not in ('.ts', '.vue') or is_test_path(Path(rel)):
                continue
            text = _read(path)
            _put(v['R5'], f'control-plane import {rel}', count(CONTROL_PLANE_IMPORT, text))
            if not rel.startswith(tuple(commercial['allowed'])):
                _put(v['R5'], f'commercial import {rel}', count(COMMERCIAL_IMPORT, text))
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
    for directory, middleware in commercial['pages'].items():
        folder = web / 'app' / 'pages' / directory
        for path in sorted(folder.rglob('*.vue')) if folder.is_dir() else []:
            rel = _rel(path, root)
            if not is_test_path(Path(rel)) and not page_declares_middleware(_read(path), middleware):
                v['R8'][f'{rel} lacks {middleware} middleware'] = 1
    for app, dirs in web_apps.items():
        folders = [web / 'app' / 'components' / d for d in dirs['components']]
        folders += [web / 'app' / 'pages' / d for d in dirs['pages']]
        folders.append(web / 'app' / 'modules' / app)
        for folder in folders:
            if not folder.is_dir():
                continue
            for path in sorted(folder.rglob('*')):
                rel = _rel(path, root)
                if path.is_file() and path.suffix in ('.ts', '.vue') and not is_test_path(Path(rel)):
                    _put(v['R3'], f'web {rel}', foreign_component_uses(_read(path), app, web_apps, rel))
    # The foundation shell (layout and shell components) names no application (R3).
    ui = root / 'packages' / 'ui'
    for folder in (web / 'app' / 'components' / 'shell', web / 'app' / 'layouts', ui / 'app' / 'components' / 'shell'):
        for path in sorted(folder.rglob('*')) if folder.is_dir() else []:
            rel = _rel(path, root)
            if path.is_file() and path.suffix in ('.ts', '.vue') and not is_test_path(Path(rel)):
                _put(v['R3'], f'web {rel}', foreign_component_uses(_read(path), '', web_apps, rel))
    # The shared UI layers (packages/ui and packages/commercial-ui) are a hard rule, never baselined: they import nothing
    # from an application (UI1). Tests under them are exempt (is_test_path): they may read application files to prove the
    # layer stays independent.
    for layer in (ui, root / 'packages' / 'commercial-ui'):
        for path in sorted(layer.rglob('*')) if layer.is_dir() else []:
            rel = _rel(path, root)
            if 'node_modules' in path.parts or not path.is_file() or path.suffix not in UI_LAYER_FILES or is_test_path(Path(rel)):
                continue
            if ui_layer_violations(_read(path)):
                hard.append(f'UI1 {rel} imports from an application, an addon, an app alias, the contracts or the control plane')
    # The vendor admin app is its own application with its own boundary, a hard rule never baselined (VA1): it reaches no
    # application, addon, customer contract or Odoo route, and the customer app never imports it.
    for app_dir, is_admin, message in (
        (root / 'apps' / 'vendor-admin', True, 'imports an application, an addon, the customer contracts or the control plane, leaves its folder, or names an Odoo route'),
        (web, False, 'imports the vendor admin app'),
    ):
        for path in sorted(app_dir.rglob('*')) if app_dir.is_dir() else []:
            rel = _rel(path, root)
            if VENDOR_ADMIN_SKIPPED_DIRS & set(path.parts) or not path.is_file() or path.suffix not in VENDOR_ADMIN_FILES:
                continue
            if is_admin and is_vendor_admin_test(Path(rel)):
                continue
            text = _read(path)
            if (vendor_admin_violations(text, path, app_dir) if is_admin else vendor_admin_imported(text, path)):
                hard.append(f'VA1 {rel} {message}')
    return v, hard


def main(
    argv: list[str] | None = None,
    root: Path = ROOT,
    layers_file: Path = LAYERS_FILE,
    baseline_file: Path = BASELINE_FILE,
    documented_file: Path | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-baseline', action='store_true', help='record the current violations; refuses any rule total increase')
    parser.add_argument('--base', metavar='REF', help='also ratchet the baseline, arch_layers.json and the documented sudo cases against this git ref')
    args = parser.parse_args(argv)
    documented_file = documented_file or baseline_file.with_name(DOCUMENTED_SUDO_FILE.name)
    documented = documented_counts(json.loads(_read(documented_file))) if documented_file.is_file() else {}
    found, hard = collect(root, json.loads(_read(layers_file)))
    current = without_documented(found, documented)
    exists = baseline_file.is_file()
    baseline = json.loads(_read(baseline_file)) if exists else {}
    # The totals that end up on disk: today's violations when writing, the file itself when checking.
    totals = rule_totals(current) if args.write_baseline else rule_totals(baseline)
    try:
        ratchet = ratchet_problems(args.base, root, layers_file, baseline_file, totals, exists or args.write_baseline, documented_file) if args.base else []
    except UnknownRef as error:
        sys.stderr.write(f'{error}\n')
        return 2
    if args.write_baseline:
        # The first write records today's debt; every later write may only keep or shrink each rule total, and a
        # documented sudo case that no longer matches the code or AGENTS.md blocks the write just like the check path.
        growth = totals_growth(totals, rule_totals(baseline), 'existing baseline') if exists else []
        problems = hard + growth + ratchet + documented_problems(documented, found, root)
        if not problems:
            baseline_file.write_text(
                json.dumps(current, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8',
            )
            print(f'wrote {baseline_file.name}')
    else:
        problems = hard + compare(current, baseline) + documented_problems(documented, found, root) + ratchet
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
