# Architecture Rules and Guards (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop architectural drift from today: write rules R1–R10 and the Git workflow into `CLAUDE.md` and `AGENTS.md`, and add two automated guards that reject new violations.

**Architecture:** `tools/arch_policy.py` scans `odoo-addons` and `apps/web` with regular expressions and compares per-rule violation counts with `tools/arch_baseline.json`. The baseline records today's debt and may only shrink. `tools/git_policy.py` checks commit subjects and the branch name. Both are stdlib-only Python with `unittest` tests, following `tools/migration_guard.py`.

**Tech Stack:** Python 3 standard library, `unittest`, Woodpecker CI (`.woodpecker.yml`), Git.

**Spec:** `docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md` — sections 2, 2.1, 3.1, 4 and 5. Read it before starting.

## Global Constraints

- This phase changes no product behavior: no file under `odoo-addons/`, `apps/`, or `packages/` is edited.
- Do not fix any existing violation in this phase. Existing violations go into the baseline.
- Do not edit `package.json` or `package-lock.json`. The main checkout has uncommitted owner changes in both; `arch_policy` reaches `npm test` through its own unittest instead.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`
- Guards use the Python standard library only. No new dependency.
- Work in a worktree on branch `codex/tools-arch-policy`, created from `main`. Do not touch the main checkout at `/Users/tariq/code/nasq`, the three worktrees under `~/.codex/worktrees`, or any other branch.
- Commit subjects follow `type(scope): subject` with scope from `core platform api pmo hr chat web cp deploy tools docs ci`, at most 72 characters. End each commit message with the attribution line your session specifies.
- Do not merge, push, delete branches, or change Git config. Stop after the final verification and report.
- Never run anything against the `odoo19` database. This plan needs no database and no Odoo process.
- Run every command from the worktree root unless a step says otherwise.

## Review Focus

- **Baseline abuse:** an agent runs `--write-baseline` to admit a new violation. Expected: the write is refused and the file is unchanged. Pinned by `TestMain.test_later_write_refuses_an_increase_and_keeps_the_file` (Task 1).
- **Stale baseline:** a violation is fixed but its baseline entry stays, leaving room to reintroduce it. Expected: the check fails until the baseline is lowered. Pinned by `TestMain.test_fixing_a_violation_requires_lowering_the_baseline` (Task 1).
- **New addon without a layer:** someone adds `odoo-addons/webvue_sales`. Expected: hard failure naming the addon, not baselineable. Pinned by `TestCollect.test_unregistered_and_missing_addons_are_hard_failures` (Task 1).
- **Broken config read as a pass:** `arch_layers.json` is malformed or the base ref is missing. Expected: a non-zero exit, never a silent pass. Pinned by `TestMain.test_malformed_layers_file_is_an_error_not_a_pass` (Task 1) and Step 5 of Task 3.
- **History before the policy:** the ten unpushed commits on `main` do not follow the subject format. Expected: commits at or before `POLICY_START` are never checked. Verified in Task 3 Step 5.

## File Structure

| File | Responsibility |
|---|---|
| `tools/arch_layers.json` (create) | Rank of every layered addon, exempt addons, which web folders belong to which application, and the commercial folders and their gate middleware |
| `tools/arch_policy.py` (create) | Collect violations per rule, compare with the baseline, write a shrinking baseline |
| `tools/test_arch_policy.py` (create) | Unit tests for each rule, the baseline logic, and one test that checks the real repository |
| `tools/arch_baseline.json` (create, generated) | Today's violations |
| `tools/git_policy.py` (create) | Commit subject and branch name checks |
| `tools/test_git_policy.py` (create) | Unit tests for both checks |
| `.woodpecker.yml` (modify, `static` step) | Run `git_policy.py` |
| `CLAUDE.md`, `AGENTS.md` (modify) | The rules and Git workflow, identical text in both; CI description fix in `CLAUDE.md` |
| `docs/parallel-work.md` (modify line 54) | Branch naming |

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/tariq/code/nasq
git worktree add -b codex/tools-arch-policy ../webvue-arch-policy main
cd ../webvue-arch-policy
git status --short
```

Expected: empty status. `main` is one docs commit after `7208cf96` (the commit that added this plan and the spec). If it has moved further, continue and note the actual commit in your report.

---

### Task 1: Architecture guard

**Files:**
- Create: `tools/arch_layers.json`, `tools/arch_policy.py`, `tools/test_arch_policy.py`

**Interfaces:**
- Produces: `python3 -B tools/arch_policy.py` (exit 0 clean, 1 on problems, problems on stderr) and `--write-baseline`. `main(argv=None, root=ROOT, layers_file=LAYERS_FILE, baseline_file=BASELINE_FILE) -> int`.
- Baseline shape: `{"R1": {"<key>": <count>}, ...}` for rules `R1` to `R10`.

What each rule counts:

| Rule | Key | Counted |
|---|---|---|
| R1 | `webvue_core depends on <dep>` | Each `depends` entry of `webvue_core` other than `base` |
| R2 | file path | In foundation addons (rank ≤ 2): tokens `project.`, `hr.`, `pmo.`, `meetings.`, `chat.`, `cyan_meeting_minutes.` in `.py`, `.xml`, `.csv` |
| R3 | `<addon> imports <target>` / `web <path>` | `odoo.addons.<x>` imports of an equal or higher rank; in `apps/web`, tags and imports of another application's components |
| R4 | `<addon> depends on <target>` | Manifest dependency on an equal or higher rank |
| R5 | `control-plane import <path>` / `commercial import <path>` | In `apps/web/app` and `apps/web/server`: import statements whose path contains `control-plane`; imports of `@webvue/commercial-contracts` outside the folders listed in `commercial.allowed` |
| R6 | file path | `government`, `is_gov`, `gov_` |
| R7 | file path | `.sudo()` calls in addon Python, counted from the syntax tree (comments and strings do not count) |
| R8 | `<path> lacks <middleware> middleware` | Pages under the commercial page folders that do not name their gate middleware |
| R9 | `sql <path>` / `override <path>` | SQL keywords followed by a non-`webvue_` table outside `migrations/`; `_search`/`check_access` overrides in files extending an Odoo model |
| R10 | `<addon> registers no <app>.enabled feature it owns` / `<path>:<function> has no requires_feature` | Application addons whose `models/feature_registry.py` lacks an owned `.enabled` key; controller functions with a `route` decorator and no `requires_feature` decorator |

Tests, `i18n` and `__pycache__` are excluded everywhere. R1, R3, R4, R5, R7, R8, R10 and the SQL part of R9 are exact on today's tree (every current match was inspected). R2 is a text match and about 5% of its 125 matches are feature or navigation keys rather than capability keys; R6 is a keyword match. The baseline absorbs today's matches, and a rise in any file fails.

The Odoo test `odoo-addons/webvue_api/tests/test_feature_route_coverage.py` already checks route feature metadata at runtime in the CI `odoo` step; the R10 check here gives the same answer without a database.

- [ ] **Step 1: Write the layer registry**

Create `tools/arch_layers.json`:

```json
{
  "ranks": {
    "webvue_core": 0,
    "webvue_platform": 1,
    "webvue_api": 2,
    "webvue_pmo": 4,
    "webvue_hr": 4,
    "webvue_chat": 4
  },
  "exempt": [
    "cyan_meeting_minutes",
    "web_theme_shadcn",
    "webvue_registry_probe"
  ],
  "web_apps": {
    "pmo": {
      "components": [
        "project",
        "task"
      ],
      "pages": [
        "projects",
        "tasks",
        "project-templates"
      ]
    },
    "meetings": {
      "components": [
        "meetings"
      ],
      "pages": [
        "meetings"
      ]
    },
    "hr": {
      "components": [
        "hr"
      ],
      "pages": [
        "hr"
      ]
    },
    "chat": {
      "components": [
        "chat"
      ],
      "pages": [
        "chat"
      ]
    }
  },
  "commercial": {
    "pages": {
      "subscription": "customer-commercial",
      "invite": "customer-commercial",
      "vendor": "vendor"
    },
    "allowed": [
      "apps/web/app/pages/vendor/",
      "apps/web/app/pages/subscription/",
      "apps/web/app/pages/invite/",
      "apps/web/app/components/vendor/",
      "apps/web/app/components/subscription/",
      "apps/web/server/"
    ]
  }
}
```

Ranks: 0–2 foundation, 3 shared service, 4 application, 5 bridge, 6 customer overlay.

- [ ] **Step 2: Write the failing tests**

Create `tools/test_arch_policy.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import tempfile
import unittest
from pathlib import Path

from arch_policy import (
    collect,
    compare,
    core_depends_violations,
    foreign_component_uses,
    is_test_path,
    layer_violations,
    main,
    odoo_access_overrides,
    routes_without_feature,
    sql_on_odoo_tables,
    sudo_calls,
    unregistered_addons,
)

RANKS = {'webvue_core': 0, 'webvue_platform': 1, 'webvue_api': 2, 'webvue_pmo': 4, 'webvue_hr': 4, 'webvue_meetings_pmo': 5}
WEB_APPS = {
    'pmo': {'components': ['project', 'task'], 'pages': ['projects', 'tasks']},
    'hr': {'components': ['hr'], 'pages': ['hr']},
}
COMMERCIAL = {
    'pages': {'subscription': 'customer-commercial'},
    'allowed': ['apps/web/app/pages/subscription/', 'apps/web/server/'],
}
HEADER = '# Part of Odoo. See LICENSE file for full copyright and licensing details.\n'


class TestPureRules(unittest.TestCase):
    def test_core_may_depend_on_base_only(self):
        self.assertEqual(core_depends_violations(['base']), {})
        self.assertEqual(
            core_depends_violations(['base', 'project', 'hr']),
            {'webvue_core depends on project': 1, 'webvue_core depends on hr': 1},
        )

    def test_dependencies_must_point_strictly_down(self):
        self.assertEqual(layer_violations('webvue_pmo', ['webvue_api', 'project', 'webvue_pmo'], RANKS, 'depends on'), {})
        self.assertEqual(
            layer_violations('webvue_pmo', ['webvue_hr'], RANKS, 'imports'),
            {'webvue_pmo imports webvue_hr': 1},
        )
        self.assertEqual(
            layer_violations('webvue_core', ['webvue_platform', 'webvue_platform'], RANKS, 'imports'),
            {'webvue_core imports webvue_platform': 2},
        )
        self.assertEqual(layer_violations('webvue_meetings_pmo', ['webvue_pmo', 'webvue_api'], RANKS, 'depends on'), {})

    def test_unregistered_addons_are_listed(self):
        self.assertEqual(
            unregistered_addons(['webvue_core', 'webvue_sales', 'web_theme_shadcn'], RANKS, ['web_theme_shadcn']),
            ['webvue_sales'],
        )

    def test_sql_counts_only_non_webvue_tables(self):
        text = 'SELECT 1 FROM hr_employee e JOIN webvue_access_role r ON 1=1; UPDATE res_users SET x=1'
        self.assertEqual(sql_on_odoo_tables(text), 2)
        self.assertEqual(sql_on_odoo_tables('returns rows from the cache'), 0)

    def test_access_overrides_count_only_on_odoo_models(self):
        override = '    def _search(self, domain):\n        pass\n    def check_access(self, operation):\n        pass\n'
        self.assertEqual(odoo_access_overrides("    _inherit = 'hr.employee'\n" + override), 2)
        self.assertEqual(odoo_access_overrides("    _inherit = 'webvue.access.role'\n" + override), 0)
        self.assertEqual(odoo_access_overrides("    _name = 'webvue.thing'\n" + override), 0)

    def test_sudo_counts_calls_not_comments_or_strings(self):
        text = "# x.sudo() in a comment\nA = 'y.sudo()'\nb = env['res.users'].sudo().browse(1).sudo()\n"
        self.assertEqual(sudo_calls(text), 2)

    def test_routes_need_requires_feature(self):
        text = (
            "class C:\n"
            "    @http.route('/api/v1/a', type='json2')\n"
            "    @api_handler\n"
            "    @requires_feature('pmo.enabled', operation='read')\n"
            "    def covered(self):\n        pass\n"
            "    @http.route('/api/v1/b', type='json2')\n"
            "    @api_handler\n"
            "    def bare(self):\n        pass\n"
            "    def helper(self):\n        pass\n"
        )
        self.assertEqual(routes_without_feature(text), ['bare'])

    def test_foreign_components_are_counted_by_tag_and_import(self):
        text = "<HrEmployeeCard /><TaskRow /><Hrx />\nimport X from '~/components/hr/EmployeeCard.vue'"
        self.assertEqual(foreign_component_uses(text, 'pmo', WEB_APPS), 2)
        self.assertEqual(foreign_component_uses(text, 'hr', WEB_APPS), 1)

    def test_test_paths_are_recognised(self):
        self.assertTrue(is_test_path(Path('odoo-addons/webvue_pmo/tests/test_tasks.py')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/__tests__/a.ts')))
        self.assertTrue(is_test_path(Path('apps/web/app/utils/a.test.ts')))
        self.assertFalse(is_test_path(Path('odoo-addons/webvue_pmo/models/project_task.py')))


class TestCompare(unittest.TestCase):
    def test_equal_sets_pass(self):
        self.assertEqual(compare({'R7': {'a.py': 2}}, {'R7': {'a.py': 2}}), [])

    def test_increase_and_new_key_fail(self):
        self.assertEqual(
            compare({'R7': {'a.py': 3, 'b.py': 1}}, {'R7': {'a.py': 2}}),
            ['R7: a.py: 3 found, baseline allows 2', 'R7: b.py: 1 found, baseline allows 0'],
        )

    def test_stale_baseline_fails_so_it_only_shrinks(self):
        problems = compare({'R7': {}}, {'R7': {'a.py': 2}})
        self.assertEqual(len(problems), 1)
        self.assertIn('lower the baseline with --write-baseline', problems[0])

    def test_rule_missing_from_either_side(self):
        self.assertEqual(compare({}, {}), [])
        self.assertEqual(compare({'R1': {'x': 1}}, {}), ['R1: x: 1 found, baseline allows 0'])


class TestCollect(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers = {'ranks': {'webvue_core': 0, 'webvue_pmo': 4}, 'exempt': ['web_theme_shadcn'], 'web_apps': WEB_APPS,
                       'commercial': COMMERCIAL}

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def addon(self, name, depends, extra=''):
        self.write(f'odoo-addons/{name}/__manifest__.py', HEADER + repr({'name': name, 'depends': depends}) + extra)

    def clean_tree(self):
        self.addon('webvue_core', ['base'])
        self.addon('webvue_pmo', ['webvue_core', 'project'])
        self.write(
            'odoo-addons/webvue_pmo/models/feature_registry.py',
            HEADER + "X = {'key': 'pmo.enabled', 'owner': 'webvue_pmo'}\n",
        )

    def test_clean_tree_has_no_violations(self):
        self.clean_tree()
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual({rule: found for rule, found in violations.items() if found}, {})

    def test_each_rule_fires_on_its_violation(self):
        self.addon('webvue_core', ['base', 'project'])
        self.addon('webvue_pmo', ['webvue_core', 'project'])
        self.write(
            'odoo-addons/webvue_core/models/access.py',
            HEADER + "from odoo.addons.webvue_pmo.models import x\nKEY = 'pmo.tasks.read'\nrows = env['res.users'].sudo()\n",
        )
        self.write(
            'odoo-addons/webvue_pmo/models/project_task.py',
            HEADER + "class T:\n    _inherit = 'project.task'\n    def _search(self, d):\n"
            "        self.env.cr.execute('SELECT id FROM project_task')\n        is_gov = True\n",
        )
        self.write('odoo-addons/webvue_pmo/tests/test_x.py', HEADER + "x = env['a'].sudo().sudo()\n")
        self.write('apps/web/app/components/hr/Card.vue', '<template><TaskRow /></template>\n')
        self.write('apps/web/app/utils/cp.ts', "import { x } from '../../../control-plane/src/x'\n// control-plane note\n")
        self.write('apps/web/app/pages/hr/index.vue', "<script setup>import type { Q } from '@webvue/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/index.vue', "<script setup>import type { Q } from '@webvue/commercial-contracts'</script>\n")
        self.write('apps/web/app/pages/subscription/ok.vue', "definePageMeta({ middleware: 'customer-commercial' })\n")
        self.write(
            'odoo-addons/webvue_pmo/controllers/tasks.py',
            HEADER + "class C:\n    @http.route('/api/v1/tasks')\n    def tasks(self):\n        pass\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R1'], {'webvue_core depends on project': 1})
        self.assertEqual(violations['R2'], {'odoo-addons/webvue_core/models/access.py': 1})
        self.assertEqual(
            violations['R3'],
            {'webvue_core imports webvue_pmo': 1, 'web apps/web/app/components/hr/Card.vue': 1},
        )
        self.assertEqual(
            violations['R5'],
            {
                'control-plane import apps/web/app/utils/cp.ts': 1,
                'commercial import apps/web/app/pages/hr/index.vue': 1,
            },
        )
        self.assertEqual(
            violations['R8'],
            {'apps/web/app/pages/subscription/index.vue lacks customer-commercial middleware': 1},
        )
        self.assertEqual(violations['R6'], {'odoo-addons/webvue_pmo/models/project_task.py': 1})
        self.assertEqual(violations['R7'], {'odoo-addons/webvue_core/models/access.py': 1})
        self.assertEqual(
            violations['R9'],
            {
                'sql odoo-addons/webvue_pmo/models/project_task.py': 1,
                'override odoo-addons/webvue_pmo/models/project_task.py': 1,
            },
        )
        self.assertEqual(
            violations['R10'],
            {
                'webvue_pmo registers no <app>.enabled feature it owns': 1,
                'odoo-addons/webvue_pmo/controllers/tasks.py:tasks has no requires_feature': 1,
            },
        )

    def test_upward_manifest_dependency_is_r4(self):
        self.clean_tree()
        self.addon('webvue_core', ['base', 'webvue_pmo'])
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R4'], {'webvue_core depends on webvue_pmo': 1})

    def test_unregistered_and_missing_addons_are_hard_failures(self):
        self.clean_tree()
        self.addon('webvue_sales', ['webvue_core'])
        self.addon('web_theme_shadcn', ['web'])
        self.layers['ranks']['webvue_gone'] = 4
        _, hard = collect(self.root, self.layers)
        self.assertEqual(
            hard,
            [
                'unregistered addon webvue_sales: add it to tools/arch_layers.json',
                'arch_layers.json lists missing addon webvue_gone',
            ],
        )

    def test_bridge_must_auto_install(self):
        self.clean_tree()
        self.layers['ranks']['webvue_meetings_pmo'] = 5
        self.addon('webvue_meetings_pmo', ['webvue_pmo'])
        _, hard = collect(self.root, self.layers)
        self.assertEqual(hard, ['bridge addon webvue_meetings_pmo must set auto_install'])

    def test_migrations_may_use_sql(self):
        self.clean_tree()
        self.write(
            'odoo-addons/webvue_pmo/migrations/19.0.1.1.0/pre-x.py',
            HEADER + "def migrate(cr, version):\n    cr.execute('UPDATE project_task SET x = 1')\n",
        )
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(violations['R9'], {})

    def test_baseline_file_shape_round_trips(self):
        self.clean_tree()
        violations, _ = collect(self.root, self.layers)
        self.assertEqual(compare(violations, json.loads(json.dumps(violations))), [])


class TestMain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.layers_file = self.root / 'arch_layers.json'
        self.baseline_file = self.root / 'arch_baseline.json'
        self.layers_file.write_text(
            json.dumps({'ranks': {'webvue_core': 0}, 'exempt': [], 'web_apps': {}, 'commercial': {'pages': {}, 'allowed': []}}), encoding='utf-8',
        )
        self.manifest = self.root / 'odoo-addons' / 'webvue_core' / '__manifest__.py'
        self.manifest.parent.mkdir(parents=True)
        self.depends(['base', 'project'])

    def depends(self, names):
        self.manifest.write_text(HEADER + repr({'name': 'webvue_core', 'depends': names}), encoding='utf-8')

    def run_main(self, *argv):
        return main(list(argv), root=self.root, layers_file=self.layers_file, baseline_file=self.baseline_file)

    def test_missing_baseline_reports_existing_debt(self):
        self.assertEqual(self.run_main(), 1)

    def test_first_write_records_debt_and_then_passes(self):
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(json.loads(self.baseline_file.read_text())['R1'], {'webvue_core depends on project': 1})
        self.assertEqual(self.run_main(), 0)

    def test_later_write_refuses_an_increase_and_keeps_the_file(self):
        self.run_main('--write-baseline')
        before = self.baseline_file.read_text()
        self.depends(['base', 'project', 'hr'])
        self.assertEqual(self.run_main('--write-baseline'), 1)
        self.assertEqual(self.baseline_file.read_text(), before)

    def test_fixing_a_violation_requires_lowering_the_baseline(self):
        self.run_main('--write-baseline')
        self.depends(['base'])
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.run_main('--write-baseline'), 0)
        self.assertEqual(self.run_main(), 0)

    def test_malformed_layers_file_is_an_error_not_a_pass(self):
        self.layers_file.write_text('{', encoding='utf-8')
        with self.assertRaises(json.JSONDecodeError):
            self.run_main()


class TestRepository(unittest.TestCase):
    def test_repository_matches_baseline(self):
        """The real tree against tools/arch_baseline.json; this is what `npm test` enforces."""
        self.assertEqual(main([]), 0, 'run: python3 -B tools/arch_policy.py')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python3 -B -m unittest discover -s tools -p 'test_arch_policy.py'`
Expected: `ModuleNotFoundError: No module named 'arch_policy'`

- [ ] **Step 4: Write the guard**

Create `tools/arch_policy.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Architecture rules R1-R10 with a shrinking baseline.

Spec: docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYERS_FILE = Path(__file__).resolve().parent / 'arch_layers.json'
BASELINE_FILE = Path(__file__).resolve().parent / 'arch_baseline.json'

# Rank bands: 0-2 foundation (core, platform, api), 3 shared service, 4 app, 5 bridge, 6 customer overlay.
BRIDGE_RANK = 5
APP_RANK = 4
FOUNDATION_MAX_RANK = 2

APP_TOKEN = re.compile(r'\b(?:project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]')
ADDON_IMPORT = re.compile(r'odoo\.addons\.((?:webvue|customer)_\w+)')
CONTROL_PLANE_IMPORT = re.compile(r"""(?:from|import|require\()\s*\(?['"][^'"\n]*control-plane""")
COMMERCIAL_IMPORT = re.compile(r"""(?:from|import)\s*\(?['"]@webvue/commercial-contracts""")
CUSTOMER_KIND = re.compile(r'\b(?:government|is_gov|gov_)', re.IGNORECASE)
SQL_TABLE = re.compile(r'\b(?:FROM|JOIN|UPDATE|INSERT INTO|DELETE FROM)\s+([a-z][a-z0-9_]*)')
ODOO_INHERIT = re.compile(r'''_inherit\s*=\s*['"](?!webvue\.)''')
ACCESS_OVERRIDE = re.compile(r'^\s+def (?:_search|check_access|_check_access)\(', re.MULTILINE)
ENABLED_FEATURE = re.compile(r'''['"]key['"]\s*:\s*['"][a-z_]+\.enabled['"]''')

Violations = dict[str, dict[str, int]]


def is_test_path(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & {'tests', '__tests__', 'e2e'}) or '.test.' in path.name or '.spec.' in path.name


def count(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


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


def sudo_calls(text: str) -> int:
    """R7: real .sudo() calls; comments and strings are not counted."""
    return sum(
        1 for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'sudo'
    )


def routes_without_feature(text: str) -> list[str]:
    """R10: controller functions with a route decorator and no requires_feature."""
    missing = []
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef):
            names = [_decorator_name(d) for d in node.decorator_list]
            if 'route' in names and 'requires_feature' not in names:
                missing.append(node.name)
    return missing


def sql_on_odoo_tables(text: str) -> int:
    """R9: SQL keywords followed by a table that is not a webvue_ table."""
    return sum(1 for table in SQL_TABLE.findall(text) if not table.startswith('webvue_'))


def odoo_access_overrides(text: str) -> int:
    """R9: _search/check_access overrides in a file that extends an Odoo model."""
    return count(ACCESS_OVERRIDE, text) if ODOO_INHERIT.search(text) else 0


def pascal(name: str) -> str:
    return ''.join(part.capitalize() for part in name.split('-'))


def foreign_component_uses(text: str, own_app: str, web_apps: dict) -> int:
    """R3 (web): tags or imports of another app's components."""
    total = 0
    for app, dirs in web_apps.items():
        if app == own_app:
            continue
        for directory in dirs['components']:
            total += len(re.findall(rf'<{pascal(directory)}[A-Z]', text))
            total += len(re.findall(rf'components/{re.escape(directory)}/', text))
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


def _read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _put(found: dict[str, int], key: str, value: int) -> None:
    if value:
        found[key] = value


def _addon_files(addon_dir: Path, suffixes: tuple[str, ...]) -> list[Path]:
    return sorted(
        p for p in addon_dir.rglob('*')
        if p.is_file() and p.suffix in suffixes and not is_test_path(p)
        and '__pycache__' not in p.parts and 'i18n' not in p.parts
    )


def collect(root: Path, layers: dict) -> tuple[Violations, list[str]]:
    ranks, exempt, web_apps = layers['ranks'], layers['exempt'], layers['web_apps']
    commercial = layers['commercial']
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
        for path in _addon_files(addon_dir, ('.py', '.xml', '.csv')):
            text, rel = _read(path), _rel(path, root)
            if ranks[addon] <= FOUNDATION_MAX_RANK and path.name != '__manifest__.py':
                _put(v['R2'], rel, count(APP_TOKEN, text))
            if path.suffix != '.py':
                continue
            for key, n in layer_violations(addon, ADDON_IMPORT.findall(text), ranks, 'imports').items():
                v['R3'][key] = v['R3'].get(key, 0) + n
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
            _put(v['R7'], rel, sudo_calls(text))
            if ranks[addon] == APP_RANK and 'controllers' in path.parts:
                for name in routes_without_feature(text):
                    v['R10'][f'{rel}:{name} has no requires_feature'] = 1
            if 'migrations' not in path.parts:
                _put(v['R9'], f'sql {rel}', sql_on_odoo_tables(text))
                _put(v['R9'], f'override {rel}', odoo_access_overrides(text))

    web = root / 'apps' / 'web'
    for base in (web / 'app', web / 'server'):
        for path in sorted(base.rglob('*')):
            if not path.is_file() or path.suffix not in ('.ts', '.vue') or is_test_path(path):
                continue
            text, rel = _read(path), _rel(path, root)
            _put(v['R5'], f'control-plane import {rel}', count(CONTROL_PLANE_IMPORT, text))
            if not rel.startswith(tuple(commercial['allowed'])):
                _put(v['R5'], f'commercial import {rel}', count(COMMERCIAL_IMPORT, text))
            _put(v['R6'], rel, count(CUSTOMER_KIND, text))
    for directory, middleware in commercial['pages'].items():
        folder = web / 'app' / 'pages' / directory
        for path in sorted(folder.rglob('*.vue')) if folder.is_dir() else []:
            if not is_test_path(path) and middleware not in _read(path):
                v['R8'][f'{_rel(path, root)} lacks {middleware} middleware'] = 1
    for app, dirs in web_apps.items():
        folders = [web / 'app' / 'components' / d for d in dirs['components']]
        folders += [web / 'app' / 'pages' / d for d in dirs['pages']]
        for folder in folders:
            if not folder.is_dir():
                continue
            for path in sorted(folder.rglob('*')):
                if path.is_file() and path.suffix in ('.ts', '.vue') and not is_test_path(path):
                    _put(v['R3'], f'web {_rel(path, root)}', foreign_component_uses(_read(path), app, web_apps))
    return v, hard


def main(
    argv: list[str] | None = None,
    root: Path = ROOT,
    layers_file: Path = LAYERS_FILE,
    baseline_file: Path = BASELINE_FILE,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-baseline', action='store_true', help='record the current violations; refuses any increase')
    args = parser.parse_args(argv)
    current, hard = collect(root, json.loads(_read(layers_file)))
    exists = baseline_file.is_file()
    baseline = json.loads(_read(baseline_file)) if exists else {}
    if args.write_baseline:
        # The first write records today's debt; every later write may only shrink it.
        problems = hard + (increases(current, baseline) if exists else [])
        if not problems:
            baseline_file.write_text(
                json.dumps(current, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8',
            )
            print(f'wrote {baseline_file.name}')
    else:
        problems = hard + compare(current, baseline)
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 5: Run the tests**

Run: `python3 -B -m unittest discover -s tools -p 'test_arch_policy.py'`
Expected: 26 tests, exactly one failure: `TestRepository.test_repository_matches_baseline` (no baseline exists yet). Every other test passes.

Do not commit yet: Task 2 creates the baseline that makes the last test pass, and commits everything together.

---

### Task 2: Baseline

**Files:**
- Create: `tools/arch_baseline.json` (generated)

**Interfaces:**
- Consumes: `tools/arch_policy.py --write-baseline` from Task 1.

- [ ] **Step 1: Generate the baseline**

Run: `python3 -B tools/arch_policy.py --write-baseline`
Expected: `wrote arch_baseline.json`, exit 0.

- [ ] **Step 2: Check the baseline against the expected shape**

Run:

```bash
python3 -c "import json;d=json.load(open('tools/arch_baseline.json'));print({r:(len(v),sum(v.values())) for r,v in d.items()})"
```

Expected (keys, total count), measured on the tree at `7208cf96`:
`R1 (3, 3)`, `R2 (8, 125)`, `R3 (4, 4)`, `R4 (0, 0)`, `R5 (7, 8)`, `R6 (0, 0)`, `R7 (33, 88)`, `R8 (1, 1)`, `R9 (17, 68)`, `R10 (2, 2)`.

`R1` must list exactly `project`, `hr`, `cyan_meeting_minutes`. `R8` must be `apps/web/app/pages/invite/accept.vue` only. `R10` must be the two notification write routes `mark_read` and `mark_all_read` only. Every `R5` key must start with `commercial import`. No `R7` key may start with `odoo-addons/webvue_hr/`. If `main` has moved and numbers differ, record the actual numbers in your report; do not edit the file by hand.

- [ ] **Step 3: Verify the guard and the full tools suite pass**

Run: `python3 -B tools/arch_policy.py && python3 -B -m unittest discover -s tools -p 'test_*.py'`
Expected: exit 0, all tests pass, including `test_repository_matches_baseline`.

- [ ] **Step 4: Prove the guard rejects a new violation, then undo**

```bash
printf "\nX = env['res.users'].sudo()\n" >> odoo-addons/webvue_hr/models/hr_department.py
python3 -B tools/arch_policy.py; echo "exit=$?"
python3 -B tools/arch_policy.py --write-baseline; echo "exit=$?"
git checkout -- odoo-addons/webvue_hr/models/hr_department.py
git status --short
```

Expected: both runs print `R7: odoo-addons/webvue_hr/models/hr_department.py: 1 found, baseline allows 0` and `exit=1`; final status shows only the four untracked files under `tools/`.

- [ ] **Step 5: Commit**

```bash
git add tools/arch_layers.json tools/arch_policy.py tools/test_arch_policy.py tools/arch_baseline.json
git commit -m "feat(tools): add architecture guard for rules R1-R10"
```

---

### Task 3: Commit and branch guard

**Files:**
- Create: `tools/git_policy.py`, `tools/test_git_policy.py`
- Modify: `.woodpecker.yml` (`static` step)

**Interfaces:**
- Produces: `python3 -B tools/git_policy.py --base <ref>` (exit 0 clean, 1 on problems, 2 when Git fails).

- [ ] **Step 1: Write the failing tests**

Create `tools/test_git_policy.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from git_policy import check_branch, check_subject


class TestSubject(unittest.TestCase):
    def test_conventional_subject_passes(self):
        self.assertIsNone(check_subject('feat(pmo): add milestone reorder endpoint'))
        self.assertIsNone(check_subject('ci(tools): run arch_policy in the static step'))

    def test_merge_and_revert_subjects_are_skipped(self):
        self.assertIsNone(check_subject("Merge branch 'codex/pmo-reorder'"))
        self.assertIsNone(check_subject('Revert "feat(pmo): add milestone reorder endpoint"'))

    def test_wip_is_rejected_in_any_form(self):
        for subject in ('wip', 'WIP: stuff', 'wip(pmo): task updates'):
            self.assertIn('wip commits', check_subject(subject))

    def test_unknown_type_scope_or_missing_scope_is_rejected(self):
        for subject in (
            'feature(pmo): add thing',
            'feat(vendor): add thing',
            'feat: add thing',
            'feat(pmo) add thing',
            'feat(pmo):add thing',
            'feat(pmo): ',
            'Record completed local workspace consolidation',
            '',
        ):
            self.assertIn("expected 'type(scope): subject'", check_subject(subject), subject)

    def test_subject_length_limit(self):
        self.assertIsNone(check_subject('fix(hr): ' + 'x' * 63))
        self.assertIn('limit is 72', check_subject('fix(hr): ' + 'x' * 64))

    def test_arabic_subject_text_is_allowed(self):
        self.assertIsNone(check_subject('docs(docs): توثيق قواعد المعمارية'))


class TestBranch(unittest.TestCase):
    def test_allowed_branches(self):
        for name in ('main', 'HEAD', 'codex/pmo-milestone-reorder', 'codex/tools-arch-policy', 'spike/generic-app-layer'):
            self.assertIsNone(check_branch(name), name)

    def test_rejected_branches(self):
        for name in (
            'codex/saas-admin-fixes',
            'codex/pmo',
            'codex/pmo-',
            'codex/PMO-thing',
            'feature/pmo-thing',
            'customer/acme',
            'support/1.0',
            'spike/',
        ):
            self.assertIn('must be main', check_branch(name), name)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -B -m unittest discover -s tools -p 'test_git_policy.py'`
Expected: `ModuleNotFoundError: No module named 'git_policy'`

- [ ] **Step 3: Write the guard**

Create `tools/git_policy.py`. `POLICY_START` is the full SHA of `7208cf96`, the last commit before the policy. Keep this value even though `main` is now ahead of it: the commits after it follow the format.

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commit subject and branch name rules (spec section 4 of the reference architecture)."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

TYPES = ('feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'ci', 'build', 'chore')
AREAS = ('core', 'platform', 'api', 'pmo', 'hr', 'chat', 'web', 'cp', 'deploy', 'tools', 'docs', 'ci')
# Commits at or before this one predate the policy and are never checked.
POLICY_START = '7208cf961ecbeb60e988e840fe2ca7cd4c3a3b9d'
MAX_SUBJECT = 72

SUBJECT = re.compile(rf"^(?:{'|'.join(TYPES)})\((?:{'|'.join(AREAS)})\): \S")
SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
TASK_BRANCH = re.compile(rf"^codex/(?:{'|'.join(AREAS)})-{SLUG}$")
SPIKE_BRANCH = re.compile(rf'^spike/{SLUG}$')


def check_subject(subject: str) -> str | None:
    if subject.startswith(('Merge ', 'Revert "')):
        return None
    if re.match(r'wip\b', subject, re.IGNORECASE):
        return 'wip commits stay on the task branch and are squashed or reworded before merge'
    if not SUBJECT.match(subject):
        return f"expected 'type(scope): subject' with type in {TYPES} and scope in {AREAS}"
    if len(subject) > MAX_SUBJECT:
        return f'subject is {len(subject)} characters, limit is {MAX_SUBJECT}'
    return None


def check_branch(name: str) -> str | None:
    if name in ('main', 'HEAD') or TASK_BRANCH.match(name) or SPIKE_BRANCH.match(name):
        return None
    return f"branch '{name}' must be main, codex/<area>-<slug> or spike/<slug>; areas: {AREAS}"


def _git(*args: str) -> str:
    done = subprocess.run(['git', *args], capture_output=True, text=True, check=False, shell=False)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def commits(base: str) -> list[tuple[str, str]]:
    out = _git('log', '--no-merges', '--format=%h%x09%s', f'{base}..HEAD', f'^{POLICY_START}')
    return [tuple(line.split('\t', 1)) for line in out.splitlines() if line]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='git ref to compare against, e.g. origin/main')
    args = parser.parse_args(argv)
    try:
        problems = []
        branch_problem = check_branch(_git('rev-parse', '--abbrev-ref', 'HEAD').strip())
        if branch_problem:
            problems.append(branch_problem)
        for sha, subject in commits(args.base):
            problem = check_subject(subject)
            if problem:
                problems.append(f'{sha} {subject!r}: {problem}')
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests**

Run: `python3 -B -m unittest discover -s tools -p 'test_git_policy.py'`
Expected: 8 tests pass.

- [ ] **Step 5: Run the guard on the real branch**

```bash
python3 -B tools/git_policy.py --base origin/main; echo "exit=$?"
python3 -B tools/git_policy.py --base no-such-ref; echo "exit=$?"
```

Expected: first `exit=0` (the older unpushed commits on `main` are excluded by `POLICY_START`; the docs commit after it and your commit conform). Second prints a `git log ... failed` message and `exit=2`.

- [ ] **Step 6: Add the guard to CI**

In `.woodpecker.yml`, in the `static` step, add one line directly after `- python3 -B tools/migration_guard.py --base origin/main`:

```yaml
      - python3 -B tools/git_policy.py --base origin/main
```

`arch_policy` needs no CI line: `npm test` in the same step runs `unittest discover -s tools`, which includes `TestRepository`.

- [ ] **Step 7: Commit**

```bash
git add tools/git_policy.py tools/test_git_policy.py .woodpecker.yml
git commit -m "feat(tools): add commit subject and branch name guard"
```

---

### Task 4: Rules in the agent entry files

**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md`, `docs/parallel-work.md`

- [ ] **Step 1: Add the rules section to `CLAUDE.md`**

Insert this block immediately before the line `## Repository layout`:

````markdown
## Architecture rules (R1–R10)

Spec: [reference architecture and Git workflow](docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md).
`tools/arch_policy.py` (runs inside `npm test`) and `tools/git_policy.py` (CI `static` step) enforce these
rules. Violations that predate them are recorded in `tools/arch_baseline.json`. That baseline only shrinks:
never add an entry or raise a count to make a check pass.

- **R1** `webvue_core` depends on `base` only and names no application model or group.
- **R2** Each application owns its capabilities, groups, roles and record rules inside its own addon.
- **R3** No application imports another application. Two applications are linked by a bridge addon
  `webvue_<a>_<b>` with `auto_install`. The same holds in `apps/web`: an application folder under
  `pages/` or `components/` does not use another application's components.
- **R4** Dependencies point down only: foundation (`webvue_core` ← `webvue_platform` ← `webvue_api`) ← shared
  services ← applications ← bridges ← `customer_<name>_*`.
- **R5** The product runs without the control plane. Nothing in `odoo-addons` or `apps/web/app` imports
  from `apps/control-plane`; no new file references the control plane.
- **R6** No condition on a customer name or customer type. Differences come from `commercial_mode`,
  entitlements and `customer_<name>_*` addons.
- **R7** No new `sudo()` outside the documented cases.
- **R8** Every feature works in `saas` and `non_saas`, or is explicitly commercial and hidden in `non_saas`.
- **R9** Customise Odoo through its public extension points only: no edits to Odoo source, no new direct
  SQL on Odoo tables, no new override of a private access method on an Odoo model without a documented
  reason and a test, no copied Odoo methods.
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `webvue.feature.registry` with `owner` set to its addon name, and every route checks its feature.

A new addon is registered in `tools/arch_layers.json` with its rank (0–2 foundation, 3 shared service,
4 application, 5 bridge, 6 customer overlay) before it is merged. After removing a violation, run
`python3 -B tools/arch_policy.py --write-baseline` and commit the smaller baseline with the fix.

### Git workflow

- `main` is the only long-lived branch and is always releasable. Task branches are
  `codex/<area>-<slug>`; throwaway experiments are `spike/<slug>` and are never merged.
  `<area>` is one of `core platform api pmo hr chat web cp deploy tools docs ci`.
- Commit subjects are `type(scope): imperative subject`, at most 72 characters, with `type` in
  `feat fix refactor perf test docs ci build chore` and `scope` from the `<area>` list. One logical change
  per commit. No `wip` commit reaches `main`. A schema change carries its version bump and migration
  directory in the same commit.
- The orchestrator merges with `git merge --no-ff` after the branch contains current `main`, the focused
  checks and `npm test` pass, `python3 -B tools/git_policy.py --base origin/main` passes, and the working
  tree is clean. The merged branch and its worktree are removed the same day.
- Only `main` and tags are pushed, each push with the owner's explicit authorization. Task branches stay
  local unless the owner asks for a pull request. `release/19.0.X.Y.Z` tags on `main` are the releases;
  there is no per-customer branch.
````

- [ ] **Step 2: Add the identical block to `AGENTS.md`**

Insert the same block, character for character, immediately before the line `## Preserve approved work on every merge — 2026-09-08`.

- [ ] **Step 3: Fix the branch naming and the CI description**

Replace the task-branch placeholder in three places. The old text is `codex/<task>`; the new text is `codex/<area>-<slug>`:

- `CLAUDE.md`, section "Safe worktree workflow", first sentence.
- `AGENTS.md`, line 30.
- `docs/parallel-work.md`, line 54.

In `CLAUDE.md`, replace

```
The main pipeline has seven steps—`prepare`, `static`,
`control-plane`, `odoo`, `upgrade`, `restore-drill`, and `e2e-mock`
```

with

```
The main pipeline has seven steps—`static`,
`control-plane`, `odoo`, `upgrade`, `restore-drill`, `image`, and `e2e-mock`
```

Then read the two sentences that follow in `CLAUDE.md` about the image gate. `.woodpecker.yml` contains an `image` step; `deploy/woodpecker/image.yml` is described as opt-in. If the file `deploy/woodpecker/image.yml` exists, leave those sentences; if it does not, say so in your report and leave them unchanged.

- [ ] **Step 4: Verify the two blocks are identical and the old names are gone**

```bash
diff <(sed -n '/^## Architecture rules (R1–R10)/,/no per-customer branch\.$/p' CLAUDE.md) \
     <(sed -n '/^## Architecture rules (R1–R10)/,/no per-customer branch\.$/p' AGENTS.md) && echo identical
grep -n 'codex/<task>' CLAUDE.md AGENTS.md docs/parallel-work.md; echo "grep exit=$?"
grep -c 'prepare' CLAUDE.md
```

Expected: `identical`; `grep exit=1` with no matches; the last command prints `0`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/parallel-work.md
git commit -m "docs(docs): add architecture rules and git workflow"
```

---

### Task 5: Final verification and report

- [ ] **Step 1: Run every check this phase touches**

```bash
python3 -B -m unittest discover -s tools -p 'test_*.py'
python3 -B tools/arch_policy.py; echo "arch=$?"
python3 -B tools/git_policy.py --base origin/main; echo "git=$?"
python3 -B tools/secret_guard.py; echo "secret=$?"
python3 -B tools/no_external_refs.py; echo "refs=$?"
ruff check odoo-addons
git status --short
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: all tests pass; `arch=0`, `git=0`, `secret=0`, `refs=0`; ruff clean; empty status; three commits; the diff touches only the nine files in the File Structure table. If `secret_guard` or `no_external_refs` fails on a file this plan created, fix the file; if it fails on a file this plan did not touch, report it and do not fix it.

- [ ] **Step 2: Report and stop**

Report: the commit `main` was at, the three commit SHAs, the baseline numbers from Task 2 Step 2, the full output of Step 1, and anything that differed from an "Expected" line. Do not merge, push, remove the worktree, or start Phase 2.

---

## Known follow-ups (not in this phase)

- Merging into `main` is the orchestrator's job. The main checkout has uncommitted changes in `.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`; this branch touches none of them.
- Branches `codex/saas-*` and the three `~/.codex/worktrees` predate the naming rule and would fail `git_policy` if used; they are removed in Phase 0 with the owner's permission.
- Updating the `odoo-reviewer` agent, the `webvue-api-endpoint` skill, and creating the `webvue-new-app` skill belong to Phase 4.
