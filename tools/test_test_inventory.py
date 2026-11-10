"""Every test file of the repository runs in a CI stage or is registered in tools/ci_not_run.json with a reason.

The runners are read from the sources CI itself executes (`deploy/ci/**/*.sh` and the deploy scripts they
call, the `package.json` scripts they run), so a new test file is covered by the glob, list or workspace that
runs it and a new runner needs no edit here. A file nothing runs must be listed in the register; the register
only shrinks: an entry whose file is gone or is run after all fails, and so does a reason that says nothing.

Odoo addon tests are left to tools/test_addon_test_imports.py. Vitest filters (`vitest run <name>`) and Playwright
`projects` are not interpreted: a workspace's vitest run counts every file its config includes, and a Playwright
run without a spec list counts every file of its config's `testDir` that `testMatch` selects.
"""
import fnmatch
import json
import posixpath
import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REGISTER = REPO / 'tools' / 'ci_not_run.json'
# Test files by name: unittest, node and vitest files, Playwright specs, the e2e runner's and the Storybook RTL suite's.
TEST_FILE = re.compile(r'(?:^|/)(?:test_[^/]*\.(?:py|mjs|js|ts)|[^/]*\.(?:test\.(?:mjs|js|ts)|spec\.(?:ts|mjs)|e2e\.ts|rtl\.ts))\Z')
EXCLUDED_ROOTS = ('odoo-addons/',)
VITEST_DEFAULT_INCLUDE = re.compile(r'\.(?:test|spec)\.[cm]?[jt]sx?\Z')
PLAYWRIGHT_DEFAULT_MATCH = VITEST_DEFAULT_INCLUDE
SEPARATORS = {';', '&&', '||', '|', '&', '(', ')', ';;'}
MAX_SCRIPT_DEPTH = 4
# A reason must say what keeps the file out of CI; these say nothing.
EMPTY_REASONS = {'todo', 'tbd', 'n/a', 'na', 'none', 'wip', 'fixme', 'later', 'not run', 'not run in ci', 'skipped',
                 'not in ci', 'unknown', 'ignore', 'disabled'}
MIN_REASON_WORDS = 5


def glob_regex(pattern: str) -> re.Pattern:
    """A shell/Playwright glob where `*` stays inside one folder and `**/` spans any number of them."""
    out, index = '', 0
    while index < len(pattern):
        if pattern.startswith('**/', index):
            out, index = out + '(?:.*/)?', index + 3
        elif pattern.startswith('**', index):
            out, index = out + '.*', index + 2
        elif pattern[index] == '*':
            out, index = out + '[^/]*', index + 1
        elif pattern[index] == '?':
            out, index = out + '[^/]', index + 1
        else:
            out, index = out + re.escape(pattern[index]), index + 1
    return re.compile(out + r'\Z')


def normal(path: str) -> str:
    return posixpath.normpath(path).lstrip('./') if path not in ('', '.') else ''


def join(base: str, path: str) -> str:
    return normal(posixpath.join(base, path))


def test_files(files: list[str]) -> list[str]:
    return sorted(path for path in files if TEST_FILE.search(path) and not path.startswith(EXCLUDED_ROOTS))


def tracked_files(repo: Path = REPO) -> list[str]:
    listing = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                                      text=True)
    return sorted(filter(None, listing.split('\0')))


def statements(text: str):
    """Token lists of the simple commands in a shell text; a quoted `sh -c` body is read as a script too."""
    for line in re.sub(r'\\\n\s*', ' ', text).splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
        lexer.whitespace_split, lexer.commenters = True, '#'
        try:
            tokens = list(lexer)
        except ValueError:  # an unbalanced quote: a heredoc or a multi-line string, never a command that runs a test
            continue
        command = []
        for token in [*tokens, ';']:
            if token in SEPARATORS or (token and set(token) <= set(';&|()')):
                if command:
                    yield command
                command = []
            else:
                command.append(token)
    return


def arrays(text: str) -> dict[str, tuple]:
    """Shell arrays a Playwright run expands: literal `NAME=( ... )` lists and `mapfile NAME < <(sed 's#^#prefix#' list.txt)`."""
    found = {}
    for name, body in re.findall(r'^\s*(\w+)=\(([^)]*)\)', text, re.M):
        items = [item for line in body.splitlines() if not line.strip().startswith('#') for item in line.split()]
        found[name] = ('literal', [item.strip('"\'') for item in items])
    for name, prefix, source in re.findall(r"mapfile -t (\w+) < <\(sed 's#\^#([^#]*)#' (\S+)\)", text):
        found[name] = ('file', prefix, source)
    return found


class Runs:
    """The test files the CI sources execute, collected from the scripts reachable from them."""

    def __init__(self, root: Path, files: list[str]):
        self.root = root
        self.files = set(files)
        self.executed: set[str] = set()

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding='utf-8')

    def mark(self, paths):
        self.executed.update(path for path in paths if path in self.files)

    def expand(self, cwd: str, pattern: str) -> list[str]:
        regex = glob_regex(join(cwd, pattern))
        return [path for path in self.files if regex.match(path)]

    def scan_script(self, rel: str, seen: set[str]):
        if rel in seen or rel not in self.files:
            return
        seen.add(rel)
        text = self.read(rel)
        self.scan_text(text, '', arrays(text), 0)
        for reference in re.findall(r'deploy/[\w./-]+\.sh', text):
            self.scan_script(reference, seen)

    def scan_text(self, text: str, cwd: str, shell_arrays: dict, depth: int):
        for tokens in statements(text):
            if tokens[0] == 'cd':
                target = tokens[1] if len(tokens) > 1 else ''
                cwd = join(cwd, target) if re.fullmatch(r'[\w./-]+', target) else ''
                continue
            self.command(tokens, cwd, shell_arrays, depth)

    def command(self, tokens: list[str], cwd: str, shell_arrays: dict, depth: int):
        names = [posixpath.basename(token) for token in tokens]
        for index, token in enumerate(tokens[:-1]):
            if names[index] in ('sh', 'bash') and tokens[index + 1] == '-c' and index + 2 < len(tokens):
                self.scan_text(tokens[index + 2], cwd, shell_arrays, depth)
        if 'unittest' in tokens and tokens[tokens.index('unittest') - 1:tokens.index('unittest')] == ['-m']:
            self.unittest(tokens[tokens.index('unittest') + 1:], cwd)
        if 'node' in names and '--test' in tokens:
            for argument in tokens[tokens.index('--test') + 1:]:
                if re.search(r'\.(?:mjs|js|ts)\Z', argument):
                    self.mark(self.expand(cwd, argument))
        if 'pytest' in names:
            self.pytest(cwd)
        if 'vitest' in names:
            self.vitest(cwd)
        if 'playwright' in names and tokens[names.index('playwright') + 1:names.index('playwright') + 2] == ['test']:
            self.playwright(tokens[names.index('playwright') + 2:], cwd, shell_arrays)
        if 'npm' in names:
            self.npm(tokens[names.index('npm') + 1:], cwd, depth)

    def unittest(self, args: list[str], cwd: str):
        if args[:1] == ['discover']:
            options = dict(zip(args[1::2], args[2::2]))
            start, pattern = join(cwd, options.get('-s', '.')), options.get('-p', 'test*.py')
            for path in self.files:
                if not path.endswith('.py') or not path.startswith(start + '/' if start else ''):
                    continue
                folders = posixpath.dirname(path)[len(start):].strip('/').split('/') if posixpath.dirname(path) != start else []
                packages = [posixpath.join(start, *folders[:depth + 1], '__init__.py') for depth in range(len(folders))]
                if fnmatch.fnmatchcase(posixpath.basename(path), pattern) and all(package in self.files for package in packages):
                    self.executed.add(path)
            return
        for argument in args:
            if argument.startswith('-'):
                continue
            if argument.endswith('.py'):
                self.mark(self.expand(cwd, argument))
                continue
            parts = argument.split('.')  # a dotted module or class: the longest prefix that is a file
            for length in range(len(parts), 0, -1):
                candidate = join(cwd, '/'.join(parts[:length]) + '.py')
                if candidate in self.files:
                    self.executed.add(candidate)
                    break

    def pytest(self, cwd: str):
        pyproject = join(cwd, 'pyproject.toml')
        paths = ['.']
        if pyproject in self.files:
            match = re.search(r'testpaths\s*=\s*\[([^\]]*)\]', self.read(pyproject))
            paths = re.findall(r'"([^"]+)"', match.group(1)) if match else paths
        for path in self.files:
            name = posixpath.basename(path)
            if name.endswith('.py') and (name.startswith('test_') or name.endswith('_test.py')):
                if any(path.startswith(join(cwd, base) + '/') for base in paths):
                    self.executed.add(path)

    def vitest(self, workspace: str):
        config = join(workspace, 'vitest.config.ts')
        text = self.read(config) if config in self.files else ''
        include = re.search(r'include:\s*\[([^\]]*)\]', text)
        exclude = re.search(r'exclude:\s*\[([^\]]*)\]', text)
        include_globs = re.findall(r"'([^']+)'", include.group(1)) if include else []
        exclude_globs = re.findall(r"'([^']+)'", exclude.group(1)) if exclude else ['**/node_modules/**']
        excluded = [glob_regex(join(workspace, pattern)) for pattern in exclude_globs]
        included = [glob_regex(join(workspace, pattern)) for pattern in include_globs]
        prefix = workspace + '/' if workspace else ''
        for path in self.files:
            if not path.startswith(prefix) or any(regex.match(path) for regex in excluded):
                continue
            if (any(regex.match(path) for regex in included) if included else VITEST_DEFAULT_INCLUDE.search(path)):
                self.executed.add(path)

    def playwright(self, args: list[str], cwd: str, shell_arrays: dict):
        specs, config = [], 'playwright.config.ts'
        for index, argument in enumerate(args):
            if argument in ('-c', '--config') and index + 1 < len(args):
                config = args[index + 1]
            reference = re.fullmatch(r'\$\{(\w+)\[@\]\}', argument)
            if reference and reference.group(1) in shell_arrays:
                kind = shell_arrays[reference.group(1)]
                if kind[0] == 'literal':
                    specs += kind[1]
                else:
                    listing = join(cwd, kind[2])
                    specs += [kind[1] + line.strip() for line in self.read(listing).splitlines() if line.strip()] if listing in self.files else []
            elif re.search(r'\.(?:spec|test)\.[cm]?[jt]s\Z', argument):
                specs.append(argument)
        if specs:
            self.mark(join(cwd, spec) for spec in specs)
            return
        text = self.read(join(cwd, config)) if join(cwd, config) in self.files else ''
        directory = re.search(r"testDir:\s*'([^']+)'", text)
        match = re.search(r"testMatch:\s*'([^']+)'", text)
        base = join(cwd, directory.group(1) if directory else '.')
        matcher = glob_regex(match.group(1)) if match else None
        for path in self.files:
            if path.startswith(base + '/') and (matcher.match(path[len(base) + 1:]) if matcher else PLAYWRIGHT_DEFAULT_MATCH.search(path)):
                self.executed.add(path)

    def npm(self, args: list[str], cwd: str, depth: int):
        workspace, script = None, None
        index = 0
        while index < len(args):
            argument = args[index]
            if argument in ('-w', '--workspace') and index + 1 < len(args):
                workspace, index = args[index + 1], index + 2
                continue
            if argument in ('run', 'run-script') or argument.startswith('-'):
                index += 1
                continue
            script = argument
            break
        manifest = join(workspace if workspace is not None else cwd, 'package.json')
        if script is None or depth >= MAX_SCRIPT_DEPTH or manifest not in self.files:
            return
        body = json.loads(self.read(manifest)).get('scripts', {}).get(script)
        if body:
            self.scan_text(body, posixpath.dirname(manifest), {}, depth + 1)


def ci_sources(files: list[str]) -> list[str]:
    return sorted(path for path in files if path.startswith('deploy/ci/') and path.endswith('.sh'))


def executed_files(root: Path, files: list[str]) -> set[str]:
    """Every tracked file that a CI script, directly or through a script it calls, runs as a test."""
    runs = Runs(root, files)
    seen: set[str] = set()
    for source in ci_sources(files):
        runs.scan_script(source, seen)
    return runs.executed


def load_register(path: Path = REGISTER) -> list[dict]:
    return json.loads(path.read_text(encoding='utf-8'))['not_run']


def register_problems(groups: list[dict], files: set[str], executed: set[str]) -> list[str]:
    """What is wrong with the register itself: bad reasons, repeated files, files gone or run after all."""
    problems, owner, reasons = [], {}, {}
    for number, group in enumerate(groups, 1):
        reason = str(group.get('reason', '')).strip()
        listed = group.get('files', [])
        label = f'group {number} ({reason[:40]!r})'
        if reason.lower().rstrip('.') in EMPTY_REASONS or len(reason.split()) < MIN_REASON_WORDS:
            problems.append(f'{label}: the reason must say what keeps these files out of CI (at least {MIN_REASON_WORDS} words, '
                            f'not a placeholder)')
        if reason in reasons:
            problems.append(f'{label}: the same reason as group {reasons[reason]}; merge the two groups')
        reasons.setdefault(reason, number)
        if not listed:
            problems.append(f'{label}: lists no file')
        if listed != sorted(listed):
            problems.append(f'{label}: keep the files sorted')
        for path in listed:
            if path in owner:
                problems.append(f'{path}: registered twice (groups {owner[path]} and {number})')
            owner.setdefault(path, number)
            if path not in files:
                problems.append(f'{path}: registered but no longer a test file of the repository; remove the entry')
            elif path in executed:
                problems.append(f'{path}: registered but a CI script runs it; remove the entry')
    return problems


def unaccounted(files: list[str], executed: set[str], groups: list[dict]) -> list[str]:
    registered = {path for group in groups for path in group.get('files', [])}
    return [path for path in test_files(files) if path not in executed and path not in registered]


class InventoryLogicTest(unittest.TestCase):
    """The runner readers and the register checks, on small fixture trees."""

    def tree(self, contents: dict[str, str]):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        for rel, text in contents.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text, encoding='utf-8')
        return root, sorted(contents)

    def run_of(self, contents: dict[str, str]) -> set[str]:
        root, files = self.tree(contents)
        return executed_files(root, files)

    def test_test_file_names(self):
        for path in ('tools/test_x.py', 'a/b.test.mjs', 'a/b.spec.ts', 'e2e/tests/a.e2e.ts', 'apps/web/e2e-rtl/a.rtl.ts',
                     'tools/test_dev_web.mjs'):
            self.assertTrue(TEST_FILE.search(path), path)
        for path in ('tools/testing.py', 'a/test.py', 'apps/web/e2e-rtl/serve.mjs', 'a/b.spec.json'):
            self.assertFalse(TEST_FILE.search(path), path)
        self.assertEqual(test_files(['odoo-addons/a/tests/test_a.py', 'tools/test_a.py']), ['tools/test_a.py'])

    def test_unittest_discover_reads_packages_only(self):
        run = self.run_of({
            'deploy/ci/static.sh': "python3 -B -m unittest discover -s tools -p 'test_*.py'\n",
            'tools/test_a.py': '', 'tools/pkg/__init__.py': '', 'tools/pkg/test_b.py': '', 'tools/plain/test_c.py': '',
            'tools/pkg/other.py': ''})
        self.assertEqual(run, {'tools/test_a.py', 'tools/pkg/test_b.py'})

    def test_unittest_paths_globs_and_dotted_names(self):
        run = self.run_of({
            'deploy/ci/static.sh': 'PYTHONPATH=deploy python3 -B -m unittest deploy/test_*.py tools.test_c.Case\n',
            'deploy/test_a.py': '', 'deploy/sub/test_b.py': '', 'tools/test_c.py': ''})
        self.assertEqual(run, {'deploy/test_a.py', 'tools/test_c.py'})

    def test_node_test_follows_continuations_and_globs(self):
        run = self.run_of({
            'deploy/ci/static.sh': 'node --test deploy/shared/a.test.mjs \\\n  deploy/shared/*.test.mjs tools/x.test.mjs\n',
            'deploy/shared/a.test.mjs': '', 'deploy/shared/b.test.mjs': '', 'deploy/shared/c.mjs': '', 'tools/x.test.mjs': ''})
        self.assertEqual(run, {'deploy/shared/a.test.mjs', 'deploy/shared/b.test.mjs', 'tools/x.test.mjs'})

    def test_cd_and_a_called_script_set_the_working_folder(self):
        run = self.run_of({
            'deploy/ci/stage.sh': 'cd "$(dirname "$0")/../.."\ndeploy/control-plane/ci-test.sh\n',
            'deploy/control-plane/ci-test.sh': 'cd apps/ai\n.venv/bin/pytest -q\n',
            'apps/ai/pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
            'apps/ai/tests/test_a.py': '', 'apps/ai/other/test_b.py': ''})
        self.assertEqual(run, {'apps/ai/tests/test_a.py'})

    def test_a_script_nobody_calls_runs_nothing(self):
        run = self.run_of({'deploy/helper.sh': 'node --test tools/a.test.mjs\n', 'tools/a.test.mjs': ''})
        self.assertEqual(run, set())

    def test_workspace_vitest_honors_the_config_excludes(self):
        run = self.run_of({
            'package.json': json.dumps({'scripts': {'test': "python3 -B x.py -- sh -c \"npm -w apps/w run test && npm -w apps/v run test\""}}),
            'deploy/ci/static.sh': 'npm test\n',
            'apps/w/package.json': json.dumps({'scripts': {'test': 'vitest run'}}),
            'apps/w/vitest.config.ts': "export default { test: { exclude: ['**/node_modules/**', '**/e2e/**'] } }",
            'apps/w/app/a.test.ts': '', 'apps/w/e2e/b.spec.ts': '', 'apps/w/app/c.ts': '',
            'apps/v/package.json': json.dumps({'scripts': {'test': 'vitest run'}}),
            'apps/v/src/d.spec.ts': '', 'apps/other/e.test.ts': ''})
        self.assertEqual(run, {'apps/w/app/a.test.ts', 'apps/v/src/d.spec.ts'})

    def test_playwright_runs_listed_specs_only(self):
        run = self.run_of({
            'deploy/ci/e2e.sh': "cd apps/web\nmapfile -t SPECS < <(sed 's#^#e2e/#' e2e/list.txt)\n"
                                "SOME=(\n  e2e/real.spec.ts\n)\n"
                                'npx playwright test ${SHARD:+--shard="$SHARD"} "${SPECS[@]}"\nnpx playwright test "${SOME[@]}"\n',
            'apps/web/e2e/list.txt': 'a.spec.ts\nb.spec.ts\n', 'apps/web/e2e/a.spec.ts': '', 'apps/web/e2e/b.spec.ts': '',
            'apps/web/e2e/c.spec.ts': '', 'apps/web/e2e/real.spec.ts': ''})
        self.assertEqual(run, {'apps/web/e2e/a.spec.ts', 'apps/web/e2e/b.spec.ts', 'apps/web/e2e/real.spec.ts'})

    def test_playwright_config_run_uses_test_dir_and_match(self):
        run = self.run_of({
            'deploy/ci/rtl.sh': 'cd apps/web\nnpm run test:rtl -- --shard=1/2\n',
            'apps/web/package.json': json.dumps({'scripts': {'test:rtl': 'npm run build-storybook && playwright test -c rtl.config.ts',
                                                              'build-storybook': 'storybook build'}}),
            'apps/web/rtl.config.ts': "export default { testDir: './e2e-rtl', testMatch: '**/*.rtl.ts' }",
            'apps/web/e2e-rtl/a.rtl.ts': '', 'apps/web/e2e-rtl/b.spec.ts': ''})
        self.assertEqual(run, {'apps/web/e2e-rtl/a.rtl.ts'})

    def test_unaccounted_and_register_problems(self):
        files = {'a/test_run.py', 'a/test_reg.py', 'a/test_lost.py', 'a/test_both.py'}
        executed = {'a/test_run.py', 'a/test_both.py'}
        groups = [{'reason': 'needs a live service that only the nightly environment starts', 'files': ['a/test_both.py', 'a/test_reg.py']}]
        self.assertEqual(unaccounted(sorted(files), executed, groups), ['a/test_lost.py'])
        self.assertEqual(register_problems(groups, files, executed),
                         ['a/test_both.py: registered but a CI script runs it; remove the entry'])

    def test_register_rejects_bad_entries(self):
        files = {'a/test_one.py', 'a/test_two.py'}
        good = 'needs a live service that only the nightly environment starts'
        cases = {
            'a placeholder': [{'reason': 'TODO', 'files': ['a/test_one.py']}],
            'a short reason': [{'reason': 'not worth it', 'files': ['a/test_one.py']}],
            'a repeated reason': [{'reason': good, 'files': ['a/test_one.py']}, {'reason': good, 'files': ['a/test_two.py']}],
            'a missing file': [{'reason': good, 'files': ['a/test_gone.py']}],
            'a file listed twice': [{'reason': good, 'files': ['a/test_one.py']},
                                    {'reason': good + ' for a second reason', 'files': ['a/test_one.py']}],
            'an empty group': [{'reason': good, 'files': []}],
            'unsorted files': [{'reason': good, 'files': ['a/test_two.py', 'a/test_one.py']}],
        }
        for name, groups in cases.items():
            with self.subTest(name):
                self.assertTrue(register_problems(groups, files, set()))
        self.assertEqual(register_problems([{'reason': good, 'files': ['a/test_one.py']}], files, set()), [])


class InventoryTest(unittest.TestCase):
    """The repository itself: no test file is silently left out of CI."""

    @classmethod
    def setUpClass(cls):
        cls.files = tracked_files()
        cls.executed = executed_files(REPO, cls.files)
        cls.groups = load_register()

    def test_the_readers_find_the_runners(self):
        # A reader that silently lost a runner would register nothing and pass; these anchors fail first.
        for anchor in ('tools/test_ci_scope.py', 'deploy/test_alerts.py', 'deploy/releases/test_dedicated_guard.mjs',
                       'deploy/shared/guard.test.mjs', 'tools/foundation_acceptance/lib.test.mjs',
                       'apps/web/app/composables/useAuth.test.ts', 'apps/control-plane/src/__tests__/app.test.ts',
                       'apps/ai-service/tests/test_app.py'):
            if anchor in self.files:
                self.assertIn(anchor, self.executed, f'the inventory no longer sees how {anchor} runs')
        self.assertGreater(len(self.executed), 500)

    def test_every_test_file_runs_in_ci_or_is_registered(self):
        missing = unaccounted(self.files, self.executed, self.groups)
        self.assertEqual(missing, [], 'these test files are run by no CI script: wire them into a stage or list them with a '
                                      'reason in tools/ci_not_run.json')

    def test_the_register_only_shrinks(self):
        self.assertEqual(register_problems(self.groups, set(test_files(self.files)), self.executed), [])


if __name__ == '__main__':
    unittest.main()
