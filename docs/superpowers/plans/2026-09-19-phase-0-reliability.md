# Phase 0 — Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** جعل nasq قابلاً للبناء والاختبار والترقية والاسترجاع آلياً، دون أي تغيير وظيفي في المنتج.

**Architecture:** خمسة بنود مستقلة (CI، إطار migrations، صورة Odoo مخبوزة، نسخ احتياطي مع استرجاع فعلي، حراسة الأسرار) تتشارك ملف workflow واحداً. كل فحص يُكتب أولاً كأداة Python قابلة للتشغيل محلياً ولها اختبارات وحدة، ثم يُستدعى من CI؛ الـCI لا يحتوي منطقاً لا يمكن تشغيله محلياً.

**Tech Stack:** GitHub Actions · Python 3.12 (`unittest`، بلا اعتماديات خارجية للأدوات) · PostgreSQL 16 · Odoo 19 CE من المصدر عند commit مثبّت · Docker · Node (الإصدار في `.nvmrc`) · Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-nasq-distribution-models-design.md` (§2.1، §7.5، §10، §12)

## Global Constraints

- لا تغيير وظيفي: لا موديلات، ولا routes، ولا صفحات. **لا يبدأ `nasq_platform` ولا الكتالوج ولا Health قبل أن يصبح Phase 0 أخضر بالكامل.**
- كل ملف Python يبدأ بـ `# Part of Odoo. See LICENSE file for full copyright and licensing details.`
- `ruff check odoo-addons` يبقى نظيفاً. أدوات `tools/` و`deploy/` تتبع أسلوب `deploy/backup.py`: `argparse`، `subprocess` بقائمة argv و`shell=False`، حقن `runner` للاختبار.
- لا اختبارات على قاعدة `odoo19` إطلاقاً. كل تشغيل Odoo: قاعدة scratch جديدة + `--addons-path` صريح + منفذ غير 8069.
- مستودع Odoo (`/Users/tariq/code/odoo`) للقراءة فقط، ويحميه hook يرفض أي أمر git موجَّه إليه؛ في CI يُستنسخ عند الـcommit المثبّت. لا تعديل داخل `odoo/` أو `addons/`.
- لا OCA ولا Enterprise. لا اعتماد خارجي وقت التشغيل في `apps/web` (§2.1).
- Rollback في الترقية = **استرجاع DB + filestore**، لا downgrade migration (§7.5).
- `npm ci --ignore-scripts` دائماً؛ لا تعديل على `~/.npmrc`. type-check: `npm -w apps/web run lint` من الجذر، أو `npm run lint` من داخل `apps/web` — لا تجمع الاثنين، ولا `npx -w`.
- worktree واحد للمرحلة: `codex/phase-0-reliability`، بـ`node_modules` و`.nuxt` مستقلين. لا push دون إذن صريح. كل commit ينتهي بسطر Co-Authored-By المعتمد في الجلسة.
- في شجرة `main` تعديلات غير مودَعة على `apps/web` لا تخص هذه الخطة؛ لا تُلمس.

## حقائق مُتحقَّق منها (2026-09-19) — تصحّح افتراضات سابقة

| الحقيقة | الأثر |
|---|---|
| `deploy/.env` و`deploy/data/` و`deploy/branding.json` **غير متتبَّعة** (`.gitignore`) ولم تدخل التاريخ قط | البند 0.5 حراسة تمنع الانتكاس، لا تنظيف تاريخ |
| `deploy/check_isolated.py` يملك أوامر `odoo` و`upgrade` و`runtime` و`e2e`، لكن `NASQ_ADDONS` لا تشمل `nasq_chat` | يُصلَّح في Task 3 |
| لا يوجد أي مجلد `migrations/` | Task 4 |
| `deploy/security/README.md` يثبّت Odoo عند `157874aa…`، بينما النسخة المحلية المستخدمة في الاختبارات عند `34eed49d88f0f4357e1f54fe82cb0ad280939572` | Task 2 يحسم commit واحداً في ملف واحد |
| `requirements-python312-macos.txt` خاص بـmacOS arm64 | Task 2 ينتج نظيره لـLinux |
| `nasq_pmo` يملك تقارير PDF (`report/meeting_report_history_templates.xml`) | الصورة تحتاج `wkhtmltopdf` |
| `deploy/docker-compose.yml` يستخدم `image: odoo:19.0` ويربط `../odoo-addons` — أي لا يمرّ عبر `odoo_secure.py` | Task 5 |
| `backup.py` يرفض عمداً ادّعاء `recovery_ready` | Task 6 يضيف أداة استرجاع منفصلة ولا يغيّر هذا الادّعاء |
| Playwright الحقيقي يتطلب Odoo بfixtures؛ يوجد mock معتمد: `apps/web/e2e/internal-ui-audit-mock.mjs` | Task 7 يبدأ بالـmock |

## File Structure

| الملف | المسؤولية |
|---|---|
| `.github/workflows/ci.yml` | كل الوظائف؛ تستدعي الأدوات فقط |
| `.nvmrc` | إصدار Node الوحيد |
| `tools/secret_guard.py` + `tools/test_secret_guard.py` | مسارات ممنوع تتبّعها + أسرار حرفية |
| `tools/no_external_refs.py` + `tools/test_no_external_refs.py` | لا مراجع خارجية وقت التشغيل في `apps/web` |
| `tools/migration_guard.py` + `tools/test_migration_guard.py` | رفع الإصدار ⇔ مجلد migrations |
| `deploy/odoo/ODOO_COMMIT` | commit Odoo المثبّت — المصدر الوحيد |
| `deploy/odoo/requirements-python312-linux.txt` | اعتماديات Linux المجمّدة |
| `deploy/odoo/Dockerfile` + `deploy/odoo/entrypoint.sh` | الصورة المخبوزة |
| `deploy/odoo/upgrade_smoke.py` | فحص حالة الوحدات بعد `-u` |
| `deploy/restore_verify.py` + `deploy/test_restore_verify.py` | استرجاع فعلي + تحقق |
| `docs/migrations.md` | سياسة الإصدارات والترحيل |
| `apps/web/e2e/ci-mock-specs.txt` | قائمة specs التي تمر على الـmock |

ترتيب التنفيذ: Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

| البند المطلوب | المهام |
|---|---|
| **0.1 CI** | Task 1، 3، 7 |
| **0.2 Migration framework** | Task 4 |
| **0.3 Baked Odoo image** | Task 2، 5 |
| **0.4 Backup + real restore test** | Task 6 |
| **0.5 Secrets / .env cleanup** | Task 1 (الحراسة) + Task 5 Step 6 (كلمات مرور التزويد) |

---

### Task 1: الحراسات الثابتة + CI الأساسي (0.1 + 0.5)

**Files:**
- Create: `tools/secret_guard.py`, `tools/test_secret_guard.py`, `tools/no_external_refs.py`, `tools/test_no_external_refs.py`, `.nvmrc`, `.github/workflows/ci.yml`
- Modify: `package.json` (سكربت `test`)

**Interfaces:**
- Produces: `python3 -B tools/secret_guard.py` و`python3 -B tools/no_external_refs.py` — يخرجان 0 عند النجاح و1 مع قائمة المخالفات على stderr. وظيفة CI باسم `static`.

- [ ] **Step 1: اختبار فاشل لـsecret_guard**

```python
# tools/test_secret_guard.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from secret_guard import find_forbidden_paths, find_secret_lines


class TestSecretGuard(unittest.TestCase):
    def test_forbidden_tracked_paths(self):
        tracked = ['deploy/.env.example', 'deploy/.env', 'deploy/data/odoo.conf',
                   'apps/web/.env.local', 'certs/site.key', 'README.md']
        self.assertEqual(
            find_forbidden_paths(tracked),
            ['apps/web/.env.local', 'certs/site.key', 'deploy/.env', 'deploy/data/odoo.conf'],
        )

    def test_example_files_are_allowed(self):
        self.assertEqual(find_forbidden_paths(['deploy/.env.example', 'a/.env.sample']), [])

    def test_literal_secret_lines(self):
        text = 'DB_PASSWORD=${DB_PASSWORD}\nadmin_passwd = hunter2hunter2\nVENDOR_PASSWORD=change-me\n'
        self.assertEqual(find_secret_lines('x.conf', text), [('x.conf', 2)])

    def test_ci_ephemeral_database_password_is_not_a_secret(self):
        text = 'env: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: odoo, POSTGRES_DB: postgres }\n'
        self.assertEqual(find_secret_lines('ci.yml', text), [])


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: شغّله وتأكد من الفشل**

Run: `cd tools && python3 -B -m unittest test_secret_guard -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'secret_guard'`

- [ ] **Step 3: التنفيذ**

```python
# tools/secret_guard.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fail when a secret-bearing path is tracked or a literal secret is committed."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ALLOWED_SUFFIXES = ('.example', '.sample', '.template')
FORBIDDEN_PATH_RE = re.compile(
    r'(^|/)\.env(\.[^/]+)?$|^deploy/data/|\.(pem|key|p12|pfx)$',
)
SECRET_LINE_RE = re.compile(
    r'(?i)\b(\w*(password|passwd|secret|token|api_key)\w*)\s*[=:]\s*["\']?([^\s"\'#]+)',
)
# `odoo` is the throwaway password of the ephemeral CI postgres service.
PLACEHOLDERS = frozenset({'change-me', 'changeme', 'x', 'validation-only', 'none', 'false', 'true', 'odoo'})
SCANNED_SUFFIXES = ('.conf', '.yml', '.yaml', '.env.example', '.sh', '.json')
SCAN_ROOTS = ('deploy/', '.github/')


def find_forbidden_paths(tracked: list[str]) -> list[str]:
    return sorted(
        path for path in tracked
        if FORBIDDEN_PATH_RE.search(path) and not path.endswith(ALLOWED_SUFFIXES)
    )


def find_secret_lines(path: str, text: str) -> list[tuple[str, int]]:
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = SECRET_LINE_RE.search(line)
        if not match:
            continue
        value = match.group(3).rstrip(',;}')
        if value.startswith(('${', '$', '<', 'REPLACE_WITH_')) or value.lower() in PLACEHOLDERS:
            continue
        hits.append((path, number))
    return hits


def main() -> int:
    tracked = subprocess.run(
        ['git', 'ls-files'], capture_output=True, text=True, check=True, shell=False,
    ).stdout.splitlines()
    problems = [f'tracked secret path: {p}' for p in find_forbidden_paths(tracked)]
    for path in tracked:
        if path.startswith(SCAN_ROOTS) and path.endswith(SCANNED_SUFFIXES):
            text = Path(path).read_text(encoding='utf-8', errors='replace')
            problems += [f'literal secret: {p}:{n}' for p, n in find_secret_lines(path, text)]
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 4: شغّل الاختبارات ثم الأداة على المستودع**

Run: `cd tools && python3 -B -m unittest test_secret_guard -v && cd .. && python3 -B tools/secret_guard.py; echo exit=$?`
Expected: 4 اختبارات PASS ثم `exit=0`. إن ظهر `literal secret:` على ملف متتبَّع: قيمة توثيقية ← أضفها إلى `PLACEHOLDERS` مع اختبار؛ سر حقيقي ← **توقف وأبلغ** (تدوير السر قرار المالك).

- [ ] **Step 5: اختبار فاشل لـno_external_refs**

```python
# tools/test_no_external_refs.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from no_external_refs import find_external_refs


class TestNoExternalRefs(unittest.TestCase):
    def test_flags_runtime_hosts(self):
        text = "@import url('https://fonts.googleapis.com/css2?family=X');\n<script src=\"//cdn.jsdelivr.net/x.js\">"
        self.assertEqual([n for _, n in find_external_refs('a.css', text)], [1, 2])

    def test_ignores_namespaces_and_reserved_example_hosts(self):
        text = '<svg xmlns="http://www.w3.org/2000/svg">\nconst u = "https://example.invalid/docs"\n'
        self.assertEqual(find_external_refs('a.vue', text), [])


if __name__ == '__main__':
    unittest.main()
```

Run: `cd tools && python3 -B -m unittest test_no_external_refs -v` → Expected: FAIL (module missing).

- [ ] **Step 6: التنفيذ**

```python
# tools/no_external_refs.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Customer-hosted deployments may have no internet: the web app must not load
anything from a third-party host at runtime (spec §2.1)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOTS = ('apps/web/app', 'apps/web/public', 'apps/web/nuxt.config.ts', 'apps/web/server')
SUFFIXES = ('.vue', '.ts', '.js', '.mjs', '.css', '.scss', '.html')
URL_RE = re.compile(r'(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})', re.IGNORECASE)
ALLOWED_HOSTS = frozenset({'www.w3.org', 'example.invalid', 'example.com', 'localhost'})


def find_external_refs(path: str, text: str) -> list[tuple[str, int]]:
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        hosts = {h.lower() for h in URL_RE.findall(line)}
        if hosts - ALLOWED_HOSTS:
            hits.append((path, number))
    return hits


def main() -> int:
    problems = []
    for root in ROOTS:
        base = Path(root)
        files = [base] if base.is_file() else [p for p in base.rglob('*') if p.suffix in SUFFIXES]
        for file in files:
            text = file.read_text(encoding='utf-8', errors='replace')
            problems += find_external_refs(str(file), text)
    for path, number in problems:
        print(f'external runtime reference: {path}:{number}', file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 7: شغّل وعالج النتائج**

Run: `cd tools && python3 -B -m unittest test_no_external_refs -v && cd .. && python3 -B tools/no_external_refs.py; echo exit=$?`
Expected: الاختبارات PASS. إن خرجت الأداة بـ1، فكل سطر إمّا (أ) مرجع وقت تشغيل حقيقي ← **لا تصلحه هنا**: سجّله في وصف الـPR كدَين وأضف مضيفه إلى `ALLOWED_HOSTS` مع تعليق `# debt: <file>`، أو (ب) نص توثيقي/اختبار ← أضف مضيفه إلى `ALLOWED_HOSTS`. الهدف أن يمنع الفحص مراجع **جديدة** من اليوم.

- [ ] **Step 8: ثبّت Node وأضف الاختبارات إلى `npm test`**

```bash
node -v | sed 's/^v//; s/\..*//' > .nvmrc
```

في `package.json` استبدل سكربت `test` بـ:

```json
"test": "python3 -B -m unittest discover -s tools -p 'test_*.py' && python3 -B tools/secret_guard.py && python3 -B tools/no_external_refs.py && python3 -B tools/ui_policy.py && python3 -B tools/ui_inventory.py --check && node tools/ui_templates.mjs && npm -w packages/contracts run test && npm -w apps/web run test",
```

(النمط `test_*.py` يشمل `test_ui_policy.py` القائم وكل اختبار أداة يُضاف لاحقاً.)

- [ ] **Step 9: workflow الأساسي**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read

jobs:
  static:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: pip install ruff==0.16.3
      - run: ruff check odoo-addons
      - run: python3 -B -m unittest discover -s deploy -p 'test_*.py' -v
      - run: npm ci --ignore-scripts
      - run: npm -w apps/web run postinstall   # nuxt prepare: required before vue-tsc
      - run: npm test
      - run: npm -w apps/web run lint
```

- [ ] **Step 10: تحقق محلي كامل ثم commit**

Run: `npm test && npm -w apps/web run lint && ruff check odoo-addons`
Expected: الكل يخرج 0.

```bash
git add tools/secret_guard.py tools/test_secret_guard.py tools/no_external_refs.py tools/test_no_external_refs.py .nvmrc package.json .github/workflows/ci.yml
git commit -m "ci: add static job with secret and external-reference guards"
```

**Acceptance:** وظيفة `static` خضراء على PR · إضافة `deploy/.env` متتبَّع أو `@import` من Google Fonts في PR تجريبي تُفشل الوظيفة.
**Rollback:** `git revert` للـcommit؛ لا أثر على وقت التشغيل.

---

### Task 2: تثبيت مصدر Odoo واعتماديات Linux (0.3 — أساس)

**Files:**
- Create: `deploy/odoo/ODOO_COMMIT`, `deploy/odoo/requirements-python312-linux.txt`
- Modify: `deploy/security/README.md`

**Interfaces:**
- Produces: `deploy/odoo/ODOO_COMMIT` (سطر واحد: SHA بـ40 خانة) و`deploy/odoo/requirements-python312-linux.txt` — يستهلكهما Task 3 وTask 4 (CI) وTask 5 (Dockerfile).

- [ ] **Step 1: احسم الـcommit**

المعتمد هو **ما تُشغَّل عليه الاختبارات فعلاً** اليوم، لا ما يذكره README القديم:

```bash
printf '%s\n' 34eed49d88f0f4357e1f54fe82cb0ad280939572 > deploy/odoo/ODOO_COMMIT
```

تحقق يدوي يطلبه المنفّذ من المالك (الـhook يمنع أوامر git على مستودع Odoo من هذه الجلسة): أن `HEAD` في `/Users/tariq/code/odoo` ما زال هذا الـSHA وأن شجرته نظيفة. إن اختلف الـSHA ← اكتب القيمة الجديدة. إن وُجدت تعديلات محلية في Odoo ← **توقف وأبلغ** (يخالف "Zero modifications").

- [ ] **Step 2: ولّد اعتماديات Linux داخل حاوية مطابقة للصورة**

```bash
docker run --rm -v "$PWD/deploy:/deploy" python:3.12-slim-bookworm bash -c '
  pip install --quiet uv &&
  apt-get update -qq && apt-get install -y -qq --no-install-recommends build-essential libpq-dev libldap2-dev libsasl2-dev >/dev/null &&
  sed "s/^psycopg2-binary==/psycopg2==/" /deploy/security/requirements-python312-macos.txt > /tmp/in.txt &&
  uv venv /venv --python python3.12 && uv pip install --python /venv/bin/python -r /tmp/in.txt &&
  uv pip check --python /venv/bin/python &&
  uv pip freeze --python /venv/bin/python > /deploy/odoo/requirements-python312-linux.txt'
```

Expected: `uv pip check` يطبع `All installed packages are compatible`. إن فشل تثبيت حزمة لأنها خاصة بـmacOS: استثنِ سطرها من `/tmp/in.txt` (`grep -v '^<name>=='`) وأعد التشغيل، واذكر الحزمة في رسالة الـcommit.

- [ ] **Step 3: تحقق من شرط `odoo_secure.py`**

Run: `grep -ci '^pypdf2' deploy/odoo/requirements-python312-linux.txt; grep -i '^pypdf==' deploy/odoo/requirements-python312-linux.txt`
Expected: `0` ثم سطر `pypdf==6.18.0`.

- [ ] **Step 4: حدّث README وcommit**

في `deploy/security/README.md` استبدل العبارة `Odoo19 official commit157874aad3aebef5bc9268de6e17530641107e31` بـ `Odoo 19 at the commit pinned in deploy/odoo/ODOO_COMMIT`.

```bash
git add deploy/odoo/ODOO_COMMIT deploy/odoo/requirements-python312-linux.txt deploy/security/README.md
git commit -m "build: pin the Odoo source commit and freeze Linux requirements"
```

**Acceptance:** ملف واحد يحدد commit Odoo لكل من CI والصورة · الاعتماديات تتثبّت نظيفة على `python:3.12-slim-bookworm` · لا PyPDF2.
**Rollback:** `git revert`؛ لا مستهلك بعد.

---

### Task 3: وظيفة اختبارات Odoo في CI (0.1)

**Files:**
- Modify: `.github/workflows/ci.yml`, `deploy/check_isolated.py`, `deploy/test_operations.py`

**Interfaces:**
- Consumes: `deploy/odoo/ODOO_COMMIT`, `deploy/odoo/requirements-python312-linux.txt`
- Produces: وظيفة CI باسم `odoo`؛ الثابت `NASQ_ADDONS = ('nasq_core', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat')`.

- [ ] **Step 1: اختبار فاشل لقائمة الوحدات**

أضف إلى `deploy/test_operations.py` داخل `class TestOdooWrapper` (استخدم اسم الاستيراد المعتمد أعلى الملف لوحدة `check_isolated`):

```python
    def test_nasq_addons_cover_every_shipped_pillar(self) -> None:
        self.assertEqual(
            check_isolated.NASQ_ADDONS,
            ('nasq_core', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat'),
        )
```

Run: `python3 -B -m unittest discover -s deploy -p test_operations.py -v`
Expected: FAIL — الـtuple الحالي بلا `nasq_chat`.

- [ ] **Step 2: أصلح الثابت**

في `deploy/check_isolated.py`:

```python
NASQ_ADDONS = ('nasq_core', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat')
```

Run: نفس الأمر → Expected: PASS للكل. إن فشل اختبار قائم يثبّت الـtuple القديم فحدّث قيمته المتوقعة.

- [ ] **Step 3: أضف الوظيفة**

```yaml
  odoo:
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: odoo, POSTGRES_DB: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U odoo" --health-interval 5s --health-timeout 5s --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - id: pin
        run: echo "sha=$(cat deploy/odoo/ODOO_COMMIT)" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        with: { repository: odoo/odoo, ref: '${{ steps.pin.outputs.sha }}', path: _odoo, fetch-depth: 1 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12', cache: pip, cache-dependency-path: deploy/odoo/requirements-python312-linux.txt }
      - run: sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends libpq-dev libldap2-dev libsasl2-dev
      - run: pip install -r deploy/odoo/requirements-python312-linux.txt
      - name: Odoo tests on a fresh scratch database
        run: |
          python _odoo/odoo-bin \
            --db_host=127.0.0.1 --db_port=5432 --db_user=odoo --db_password=odoo \
            --addons-path="$PWD/_odoo/addons,$PWD/odoo-addons" \
            -d nasq_ci_scratch_${{ github.run_id }} \
            -i nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
            --test-tags /nasq_core,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat \
            --http-port=8169 --stop-after-init --log-level=test 2>&1 | tee odoo-test.log
          ! grep -E " (ERROR|CRITICAL) |FAIL: " odoo-test.log
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: odoo-test-log, path: odoo-test.log }
```

ملاحظة: حاوية postgres في CI سريعة الزوال، فالقاعدة scratch بالتعريف؛ لذلك يُستدعى `odoo-bin` مباشرة. `deploy/check_isolated.py` يبقى الغلاف الإلزامي **محلياً**.

- [ ] **Step 4: تحقق محلي مكافئ**

شغّل أمر "Check commands" من `CLAUDE.md` مع إضافة `nasq_chat` إلى `-i` و`--test-tags`، وقاعدة `nasq_phase0_scratch`، ومسار `<WORKTREE>/odoo-addons`.
Expected: ينتهي بلا `ERROR`/`FAIL`. ثم `dropdb nasq_phase0_scratch`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml deploy/check_isolated.py deploy/test_operations.py
git commit -m "ci: run the Odoo addon suites on a fresh scratch database"
```

**Acceptance:** وظيفة `odoo` خضراء · كسر اختبار واحد عمداً في PR تجريبي يُفشلها · السجل مرفوع كـartifact.
**Rollback:** `git revert`.

---

### Task 4: إطار الـMigrations + وظيفة الترقية (0.2)

**Files:**
- Create: `docs/migrations.md`, `tools/migration_guard.py`, `tools/test_migration_guard.py`, `deploy/odoo/upgrade_smoke.py`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: إعداد وظيفة `odoo` (خدمة postgres + مصدر Odoo + الاعتماديات).
- Produces: وسم git `release/19.0.1.0.0` = خط الأساس للترقية · قاعدة المجلد `odoo-addons/<addon>/migrations/<version>/{pre,post,end}-*.py` بدالة `migrate(cr, version)` · `python3 -B tools/migration_guard.py --base <ref>`.

- [ ] **Step 1: اكتب السياسة `docs/migrations.md`**

```markdown
# سياسة الإصدارات والترحيل

**خط إصدار واحد.** كل addon يحمل `19.0.X.Y.Z`. الوسم `release/<version>` على `main` هو الإصدار.

## متى أرفع الإصدار؟
أي تغيير يمسّ مخطط القاعدة أو بيانات قائمة: حقل مخزَّن جديد أو محذوف أو متغيّر النوع، `required` جديد،
قيد SQL، إعادة تسمية موديل/حقل/xmlid، تغيير على بيانات `noupdate="1"`، تضييق record rule يعتمد على تعبئة بيانات.
التغييرات البرمجية البحتة لا ترفع الإصدار.

## كيف؟
1. ارفع `version` في `__manifest__.py` للـaddon المتأثر (Z للتصحيح، Y لتغيير مخطط).
2. أنشئ `odoo-addons/<addon>/migrations/<version>/`:
   - `pre-*.py`  قبل تحميل الموديلات (إعادة تسمية أعمدة/جداول).
   - `post-*.py` بعد التحميل (تعبئة بيانات؛ ORM عبر `api.Environment(cr, SUPERUSER_ID, {})`).
   - `end-*.py`  بعد تحديث كل الوحدات.
   كل ملف: ترويسة Odoo + `def migrate(cr, version):` ويبدأ بـ `if not version: return` (تثبيت جديد).
3. لا تغيير بيانات؟ ضع `migrations/<version>/README.md` بجملة تشرح السبب. الحارس يقبله.
4. الترحيل idempotent ولا يخمّن: حالة غامضة ⇒ `raise` برسالة تحدد المطلوب من المشغّل.

## ما لا نفعله
- لا downgrade migrations. التراجع = استرجاع DB + filestore (`deploy/restore_verify.py`).
- لا تعديل ترحيل بعد صدور وسمه. الإصلاح = إصدار جديد.

## الإصدارات المدعومة للترقية
الحالي والسابق. CI يرقّي من آخر وسم `release/*` إلى HEAD.
```

- [ ] **Step 2: اختبار فاشل للحارس**

```python
# tools/test_migration_guard.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from migration_guard import check_addon


class TestMigrationGuard(unittest.TestCase):
    def test_unchanged_version_needs_nothing(self):
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.0.0', set()))

    def test_bump_without_directory_fails(self):
        self.assertEqual(
            check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', set()),
            'nasq_pmo: version 19.0.1.0.0 -> 19.0.1.1.0 but migrations/19.0.1.1.0/ is missing or empty',
        )

    def test_bump_with_script_or_readme_passes(self):
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', {'post-backfill.py'}))
        self.assertIsNone(check_addon('nasq_pmo', '19.0.1.0.0', '19.0.1.1.0', {'README.md'}))

    def test_downgrade_and_new_addon(self):
        self.assertEqual(
            check_addon('nasq_pmo', '19.0.1.1.0', '19.0.1.0.0', set()),
            'nasq_pmo: version went backwards 19.0.1.1.0 -> 19.0.1.0.0',
        )
        self.assertIsNone(check_addon('nasq_new', None, '19.0.1.0.0', set()))


if __name__ == '__main__':
    unittest.main()
```

Run: `cd tools && python3 -B -m unittest test_migration_guard -v` → Expected: FAIL (module missing).

- [ ] **Step 3: التنفيذ**

```python
# tools/migration_guard.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A manifest version bump must ship migrations/<version>/ (docs/migrations.md)."""
from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from pathlib import Path

ADDONS_ROOT = Path('odoo-addons')
ACCEPTED_PREFIXES = ('pre-', 'post-', 'end-')


def _key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split('.'))


def check_addon(addon: str, old: str | None, new: str, entries: set[str]) -> str | None:
    if old is None or old == new:
        return None
    if _key(new) < _key(old):
        return f'{addon}: version went backwards {old} -> {new}'
    ok = any(e == 'README.md' or (e.startswith(ACCEPTED_PREFIXES) and e.endswith('.py')) for e in entries)
    if ok:
        return None
    return f'{addon}: version {old} -> {new} but migrations/{new}/ is missing or empty'


def _version(text: str) -> str:
    return ast.literal_eval(text)['version']


def _old_version(base: str, manifest: Path) -> str | None:
    shown = subprocess.run(
        ['git', 'show', f'{base}:{manifest.as_posix()}'],
        capture_output=True, text=True, check=False, shell=False,
    )
    return _version(shown.stdout) if shown.returncode == 0 else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='git ref to compare against, e.g. origin/main')
    args = parser.parse_args(argv)
    problems = []
    for manifest in sorted(ADDONS_ROOT.glob('nasq_*/__manifest__.py')):
        addon = manifest.parent.name
        new = _version(manifest.read_text(encoding='utf-8'))
        directory = manifest.parent / 'migrations' / new
        entries = {p.name for p in directory.iterdir()} if directory.is_dir() else set()
        problem = check_addon(addon, _old_version(args.base, manifest), new, entries)
        if problem:
            problems.append(problem)
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
```

Run: `cd tools && python3 -B -m unittest test_migration_guard -v && cd .. && python3 -B tools/migration_guard.py --base HEAD; echo exit=$?`
Expected: 4 PASS ثم `exit=0`.

- [ ] **Step 4: فحص ما بعد الترقية**

```python
# deploy/odoo/upgrade_smoke.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Piped into `odoo-bin shell`: fail unless the upgrade left every module settled."""
import sys

Module = env['ir.module.module']  # noqa: F821 - `env` is provided by the Odoo shell
installed = Module.search([('name', '=like', 'nasq_%'), ('state', '=', 'installed')])
unsettled = Module.search([('state', 'in', ('to upgrade', 'to install', 'to remove'))])
problems = [f'{m.name} state={m.state}' for m in unsettled]
if not installed:
    problems.append('no nasq module is installed')
for problem in problems:
    print(f'UPGRADE_SMOKE_FAIL {problem}')
print('UPGRADE_SMOKE_FAILED' if problems else f'UPGRADE_SMOKE_OK installed={len(installed)}')
sys.exit(1 if problems else 0)
```

- [ ] **Step 5: ضع وسم خط الأساس (محلي)**

```bash
git tag release/19.0.1.0.0 "$(git merge-base HEAD origin/main)"
```

دفع الوسم يتطلب **إذناً صريحاً من المالك**. وظيفة `upgrade` تتخطّى نفسها بتحذير واضح ما دام لا وسم `release/*` على الـremote.

- [ ] **Step 6: CI**

أضف إلى وظيفة `static` قبل `npm ci`:

```yaml
      - run: python3 -B tools/migration_guard.py --base "origin/${{ github.base_ref || 'main' }}"
```

وأضف الوظيفة:

```yaml
  upgrade:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: odoo, POSTGRES_DB: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U odoo" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      ODOO_DB_ARGS: --db_host=127.0.0.1 --db_port=5432 --db_user=odoo --db_password=odoo
      MODULES: nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - id: base
        run: |
          tag=$(git tag --list 'release/*' --sort=-v:refname | head -n1)
          echo "tag=$tag" >> "$GITHUB_OUTPUT"
          [ -n "$tag" ] || echo "::warning::no release/* tag on the remote; upgrade job skipped"
      - if: steps.base.outputs.tag != ''
        run: git worktree add _baseline "${{ steps.base.outputs.tag }}"
      - if: steps.base.outputs.tag != ''
        id: pin
        run: echo "sha=$(cat deploy/odoo/ODOO_COMMIT)" >> "$GITHUB_OUTPUT"
      - if: steps.base.outputs.tag != ''
        uses: actions/checkout@v4
        with: { repository: odoo/odoo, ref: '${{ steps.pin.outputs.sha }}', path: _odoo, fetch-depth: 1 }
      - if: steps.base.outputs.tag != ''
        uses: actions/setup-python@v5
        with: { python-version: '3.12', cache: pip, cache-dependency-path: deploy/odoo/requirements-python312-linux.txt }
      - if: steps.base.outputs.tag != ''
        run: |
          sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends libpq-dev libldap2-dev libsasl2-dev
          pip install -r deploy/odoo/requirements-python312-linux.txt
      - name: Install the previous release
        if: steps.base.outputs.tag != ''
        run: |
          python _odoo/odoo-bin $ODOO_DB_ARGS --addons-path="$PWD/_odoo/addons,$PWD/_baseline/odoo-addons" \
            -d nasq_ci_upgrade_scratch -i "$MODULES" --without-demo=all --http-port=8169 --stop-after-init
      - name: Upgrade to this commit
        if: steps.base.outputs.tag != ''
        run: |
          python _odoo/odoo-bin $ODOO_DB_ARGS --addons-path="$PWD/_odoo/addons,$PWD/odoo-addons" \
            -d nasq_ci_upgrade_scratch -u "$MODULES" --http-port=8169 --stop-after-init 2>&1 | tee upgrade.log
          ! grep -E " (ERROR|CRITICAL) " upgrade.log
      - name: Post-upgrade smoke
        if: steps.base.outputs.tag != ''
        run: |
          python _odoo/odoo-bin shell $ODOO_DB_ARGS --addons-path="$PWD/_odoo/addons,$PWD/odoo-addons" \
            -d nasq_ci_upgrade_scratch --no-http < deploy/odoo/upgrade_smoke.py | tee smoke.log
          grep -q UPGRADE_SMOKE_OK smoke.log
```

- [ ] **Step 7: تحقق محلي من دورة الترقية ثم commit**

كرّر الخطوات الثلاث محلياً: `git worktree add /tmp/nasq-baseline release/19.0.1.0.0`، ثبّت منه على `nasq_phase0_upgrade_scratch` (منفذ 8169، بـpython وodoo-bin المحليين)، ثم `-u` بمسار الـworktree الحالي، ثم مرّر `upgrade_smoke.py` إلى `odoo-bin shell`.
Expected: `UPGRADE_SMOKE_OK installed=5`. ثم `dropdb nasq_phase0_upgrade_scratch` و`git worktree remove /tmp/nasq-baseline`.

```bash
git add docs/migrations.md tools/migration_guard.py tools/test_migration_guard.py deploy/odoo/upgrade_smoke.py .github/workflows/ci.yml
git commit -m "ci: add the migration policy, version guard, and upgrade-from-release job"
```

**Tests:** 4 اختبارات وحدة للحارس · دورة install(السابق) ← `-u`(HEAD) ← smoke.
**Acceptance:** PR يرفع `version` بلا مجلد migrations يفشل في `static` · PR يضيف حقلاً `required` بلا ترحيل يفشل في `upgrade` · `docs/migrations.md` مرجع وحيد.
**Rollback:** `git revert` + `git tag -d release/19.0.1.0.0`. لا أثر على أي قاعدة.

---

### Task 5: صورة Odoo المخبوزة + كلمات مرور التزويد (0.3 + 0.5)

**Files:**
- Create: `deploy/odoo/Dockerfile`, `deploy/odoo/entrypoint.sh`, `.dockerignore`
- Modify: `deploy/docker-compose.yml` (خدمة `odoo`)، `deploy/odoo.conf` (حذف `addons_path`)، `deploy/provision.sh`، `.github/workflows/ci.yml`، `deploy/OPERATIONS.md`

**Interfaces:**
- Consumes: `deploy/odoo/ODOO_COMMIT`, `deploy/odoo/requirements-python312-linux.txt`, `deploy/security/odoo_secure.py`
- Produces: صورة `nasq-odoo:<tag>` بلا أي bind mount للكود. المسارات داخلها: `/opt/odoo` (المصدر)، `/opt/nasq/addons`، `/opt/nasq/odoo_secure.py`؛ الإعداد يُركَّب على `/etc/odoo/odoo.conf`؛ البيانات على `/var/lib/odoo`. متغيّرا compose: `NASQ_IMAGE_TAG` و`ODOO_COMMIT`.

- [ ] **Step 1: `.dockerignore` (السياق = جذر المستودع)**

```text
**/node_modules
**/.nuxt
**/.output
.git
.worktrees
deploy/.env
deploy/data
deploy/branding.json
**/__pycache__
test-results
playwright-report
```

تحقق أن `apps/web/Dockerfile` لا يعتمد على أي مسار مُستثنى: `docker build -f apps/web/Dockerfile -t nasq-web:dev .` → Expected: ينجح.

- [ ] **Step 2: Dockerfile**

```dockerfile
# deploy/odoo/Dockerfile — build context: repository root
FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq5 libldap-2.5-0 libsasl2-2 libxml2 libxslt1.1 libjpeg62-turbo \
      fonts-noto-core wkhtmltopdf postgresql-client \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG ODOO_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential libpq-dev libldap2-dev libsasl2-dev \
    && rm -rf /var/lib/apt/lists/*
RUN test -n "$ODOO_COMMIT" \
    && git init -q /opt/odoo && cd /opt/odoo \
    && git fetch -q --depth 1 https://github.com/odoo/odoo.git "$ODOO_COMMIT" \
    && git checkout -q FETCH_HEAD && rm -rf .git
COPY deploy/odoo/requirements-python312-linux.txt /tmp/requirements.txt
RUN python -m venv /opt/venv && /opt/venv/bin/pip install -r /tmp/requirements.txt

FROM base
ARG ODOO_COMMIT
ARG NASQ_REVISION=unknown
LABEL sa.nasq.revision=$NASQ_REVISION sa.nasq.odoo-commit=$ODOO_COMMIT
COPY --from=build /opt/odoo /opt/odoo
COPY --from=build /opt/venv /opt/venv
COPY odoo-addons /opt/nasq/addons
COPY deploy/security/odoo_secure.py /opt/nasq/odoo_secure.py
COPY deploy/odoo/entrypoint.sh /usr/local/bin/nasq-odoo
RUN chmod 0755 /usr/local/bin/nasq-odoo \
    && useradd --system --uid 10001 --home-dir /var/lib/odoo --create-home odoo \
    && chmod -R a-w /opt/odoo /opt/nasq
USER odoo
VOLUME /var/lib/odoo
EXPOSE 8069 8072
ENTRYPOINT ["nasq-odoo"]
```

ملاحظة معروفة: `wkhtmltopdf` في Debian مبني بلا Qt المرقّع الذي توصي به Odoo؛ قد يختلّ رأس/تذييل تقرير الاجتماعات. Step 4 يختبر ذلك صراحة. إن اختلّ: استبدل الحزمة بملف `.deb` الرسمي `wkhtmltox 0.12.6.1-3 bookworm` مُضمَّناً في `deploy/odoo/vendor/` مع فحص `sha256sum` داخل الـDockerfile (لا تنزيل وقت البناء من مصدر غير مثبّت).

- [ ] **Step 3: entrypoint**

```sh
#!/bin/sh
# deploy/odoo/entrypoint.sh — every start goes through the guarded launcher.
set -eu
exec /opt/venv/bin/python /opt/nasq/odoo_secure.py --odoo-root /opt/odoo \
  -c /etc/odoo/odoo.conf \
  --addons-path=/opt/odoo/addons,/opt/nasq/addons \
  --data-dir=/var/lib/odoo "$@"
```

- [ ] **Step 4: ابنِ واختبر الصورة محلياً**

```bash
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" \
  --build-arg NASQ_REVISION="$(git rev-parse --short HEAD)" -t nasq-odoo:dev .
docker network create nasq-img-test
docker run -d --name nasq-img-db --network nasq-img-test -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo -e POSTGRES_DB=postgres postgres:16
printf '[options]\ndb_host = nasq-img-db\ndb_user = odoo\ndb_password = odoo\nlist_db = False\nproxy_mode = True\n' > /tmp/nasq-img.conf
for i in $(seq 1 30); do docker exec nasq-img-db pg_isready -U odoo && break; sleep 2; done
docker run --rm --network nasq-img-test -v /tmp/nasq-img.conf:/etc/odoo/odoo.conf:ro nasq-odoo:dev \
  -d nasq_image_scratch -i nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat --without-demo=all --stop-after-init
docker run --rm --network nasq-img-test -v /tmp/nasq-img.conf:/etc/odoo/odoo.conf:ro nasq-odoo:dev \
  -d nasq_image_scratch --test-tags /nasq_pmo:TestMeetings --stop-after-init -u nasq_pmo 2>&1 | tail -5
docker run --rm --entrypoint sh nasq-odoo:dev -c \
  'test ! -w /opt/nasq/addons && test "$(id -u)" = 10001 && wkhtmltopdf --version && ! command -v git && echo IMAGE_OK'
docker rm -f nasq-img-db && docker network rm nasq-img-test
```

Expected: التثبيت بلا `ERROR` · اختبارات الاجتماعات (تشمل توليد PDF) تمر · السطر الأخير `IMAGE_OK`. (اسم صنف الاختبار في `odoo-addons/nasq_pmo/tests/test_meetings.py`؛ إن اختلف عن `TestMeetings` فاستخدم اسمه الفعلي.)

- [ ] **Step 5: حدّث compose**

في `deploy/docker-compose.yml` استبدل في خدمة `odoo` الحقول `image` و`command` و`volumes` بـ:

```yaml
    image: nasq-odoo:${NASQ_IMAGE_TAG:?set NASQ_IMAGE_TAG to the built image tag}
    build:
      context: ..
      dockerfile: deploy/odoo/Dockerfile
      args:
        ODOO_COMMIT: ${ODOO_COMMIT:?set ODOO_COMMIT from deploy/odoo/ODOO_COMMIT}
    command: ["--workers", "2", "--proxy-mode"]
    volumes:
      - ./data/odoo.conf:/etc/odoo/odoo.conf:ro
      - odoo_data:/var/lib/odoo
```

أبقِ `depends_on` و`healthcheck` و`restart` القائمة. احذف سطر ربط `../odoo-addons`. واحذف سطر `addons_path` من قالب `deploy/odoo.conf` (يحدده الـentrypoint).

Run: `cd deploy && NASQ_IMAGE_TAG=dev ODOO_COMMIT=$(cat odoo/ODOO_COMMIT) docker compose config >/dev/null && echo COMPOSE_OK`
Expected: `COMPOSE_OK`. وفي `provision.sh` صدّر المتغيّرين قبل أول `docker compose`:

```sh
export ODOO_COMMIT="$(cat "$(dirname "$0")/odoo/ODOO_COMMIT")"
export NASQ_IMAGE_TAG="${NASQ_IMAGE_TAG:-$(git -C "$(dirname "$0")/.." rev-parse --short HEAD)}"
```

واستبدل في خطوتي التثبيت والبذر أي مسار `/mnt/extra-addons` بـ`/opt/nasq/addons`، واحذف `--addons-path` منهما إن وُجد (الـentrypoint يحدده).

- [ ] **Step 6: `provision.sh` يرفض كل كلمة مرور افتراضية**

اليوم يُرفض `VENDOR_PASSWORD` فقط. استبدل ذلك الفحص بـ:

```sh
for var in DB_PASSWORD ODOO_ADMIN_PASSWORD VENDOR_PASSWORD; do
  eval "value=\${$var:-}"
  case "$value" in
    ''|change-me|changeme|validation-only|odoo|admin)
      echo "provision: $var is empty or a known placeholder; set a real secret in deploy/.env" >&2
      exit 1 ;;
  esac
  [ "${#value}" -ge 16 ] || { echo "provision: $var must be at least 16 characters" >&2; exit 1; }
done
```

Test: انسخ `deploy/` إلى مجلد مؤقت، ضع فيه `.env` بمحتوى `DB_PASSWORD=change-me` وسطرين صالحين للبقية، و`branding.json` من المثال، وشغّل `provision.sh example.test nasq_prov_scratch`.
Expected: خروج 1 برسالة `DB_PASSWORD is empty or a known placeholder` **قبل** أي أمر docker.

- [ ] **Step 7: وظيفة CI**

```yaml
  image:
    runs-on: ubuntu-24.04
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - run: |
          docker build -f deploy/odoo/Dockerfile \
            --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" \
            --build-arg NASQ_REVISION="${GITHUB_SHA::12}" -t nasq-odoo:ci .
      - name: Install every pillar inside the image
        run: |
          docker network create t
          docker run -d --name db --network t -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo -e POSTGRES_DB=postgres postgres:16
          printf '[options]\ndb_host = db\ndb_user = odoo\ndb_password = odoo\nlist_db = False\n' > odoo.conf
          for i in $(seq 1 30); do docker exec db pg_isready -U odoo && break; sleep 2; done
          docker run --rm --network t -v "$PWD/odoo.conf:/etc/odoo/odoo.conf:ro" nasq-odoo:ci \
            -d nasq_image_scratch -i nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat --without-demo=all --stop-after-init
          docker run --rm --entrypoint sh nasq-odoo:ci -c 'test ! -w /opt/nasq/addons && test "$(id -u)" = 10001 && ! command -v git'
```

- [ ] **Step 8: وثّق وcommit**

أضف إلى `deploy/OPERATIONS.md` قسم "Odoo image": أمر البناء من Step 4، ومعنى `NASQ_IMAGE_TAG` و`ODOO_COMMIT`، وأن الكود داخل الصورة للقراءة فقط، وأن كل إقلاع يمرّ عبر `odoo_secure.py`.

```bash
git add .dockerignore deploy/odoo/Dockerfile deploy/odoo/entrypoint.sh deploy/docker-compose.yml deploy/odoo.conf deploy/provision.sh deploy/OPERATIONS.md .github/workflows/ci.yml
git commit -m "build: bake the addons and guarded launcher into the Odoo image"
```

**Acceptance:** لا bind mount للكود في compose · الصورة تثبّت الركائز الخمس من الصفر وتولّد PDF الاجتماعات · تعمل كمستخدم 10001 وكودها غير قابل للكتابة وبلا `git` · تحمل وسمي `sa.nasq.revision` و`sa.nasq.odoo-commit` · `provision.sh` يرفض أي كلمة مرور افتراضية أو أقصر من 16.
**Rollback:** `git revert`؛ compose يعود إلى `odoo:19.0` مع الربط. لا بيانات تتأثر (أسماء الأحجام لم تتغيّر).

---

### Task 6: استرجاع فعلي مُتحقَّق منه (0.4)

**Files:**
- Create: `deploy/restore_verify.py`, `deploy/test_restore_verify.py`
- Modify: `deploy/OPERATIONS.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: مخرجات `deploy/backup.py`: مجلد فيه `database.dump` و`filestore/` و`manifest.json`.
- Produces: `perform_restore(*, backup_dir, target_db, target_filestore, pg_restore, createdb, psql, pg_host=None, pg_port=None, pg_user=None, runner=subprocess.run) -> dict` وواجهة CLI بالأعلام نفسها. يكتب `<backup-dir>/restore-verification.json` ويخرج 0/1. **لا يعدّل `manifest.json`**: ادّعاء `consistency=UNVERIFIED` عن لحظة الأخذ يبقى صحيحاً؛ هذا سجلّ منفصل يثبت أن **هذه النسخة استُرجعت فعلاً**. هذه الدالة هي ما سيستدعيه `nasq-cli upgrade` للتراجع في Phase 3.

- [ ] **Step 1: اختبارات فاشلة**

```python
# deploy/test_restore_verify.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import tempfile
import unittest
from pathlib import Path

import restore_verify as rv


class Completed:
    def __init__(self, returncode=0, stdout=''):
        self.returncode, self.stdout = returncode, stdout


def make_backup(root: Path, files=('ab/abcdef',)) -> Path:
    backup = root / 'backup'
    (backup / 'filestore').mkdir(parents=True)
    (backup / 'database.dump').write_bytes(b'PGDMP')
    (backup / 'manifest.json').write_text(json.dumps({'db_name': 'src', 'consistency': 'UNVERIFIED'}))
    for name in files:
        path = backup / 'filestore' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
    return backup


class TestRestoreVerify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tools = {}
        for name in ('pg_restore', 'createdb', 'psql'):
            tool = self.tmp / name
            tool.write_text('')
            self.tools[name] = str(tool)

    def run_verify(self, backup, psql_answers, target_db='nasq_restore_scratch'):
        answers = iter(psql_answers)

        def runner(argv, **_):
            return Completed(stdout=next(answers)) if Path(argv[0]).name == 'psql' else Completed()

        return rv.perform_restore(
            backup_dir=str(backup), target_db=target_db,
            target_filestore=str(self.tmp / 'restored' / target_db),
            pg_restore=self.tools['pg_restore'], createdb=self.tools['createdb'], psql=self.tools['psql'],
            runner=runner,
        )

    def test_refuses_forbidden_and_non_scratch_targets(self):
        backup = make_backup(self.tmp)
        for name in ('odoo19', 'production', 'customer_live', 'postgres', 'odoo19_scratch'):
            with self.assertRaises(rv.RestoreError):
                self.run_verify(backup, [], target_db=name)

    def test_refuses_incomplete_backup(self):
        backup = make_backup(self.tmp)
        (backup / 'database.dump').unlink()
        with self.assertRaises(rv.RestoreError):
            self.run_verify(backup, [])

    def test_passes_when_modules_installed_and_attachments_present(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, ['5\n', '0\n', 'ab/abcdef\n'])
        self.assertTrue(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], [])
        written = json.loads((backup / 'restore-verification.json').read_text())
        self.assertTrue(written['restore_verified'])
        self.assertEqual(json.loads((backup / 'manifest.json').read_text())['consistency'], 'UNVERIFIED')

    def test_fails_when_an_attachment_file_is_missing(self):
        backup = make_backup(self.tmp)
        result = self.run_verify(backup, ['5\n', '0\n', 'ab/abcdef\ncd/missing\n'])
        self.assertFalse(result['restore_verified'])
        self.assertEqual(result['checks']['missing_attachment_files'], ['cd/missing'])

    def test_fails_when_a_module_is_stuck(self):
        backup = make_backup(self.tmp)
        self.assertFalse(self.run_verify(backup, ['5\n', '2\n', 'ab/abcdef\n'])['restore_verified'])


if __name__ == '__main__':
    unittest.main()
```

Run: `cd deploy && python3 -B -m unittest test_restore_verify -v` → Expected: FAIL (module missing).

- [ ] **Step 2: التنفيذ**

```python
# deploy/restore_verify.py
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore a backup.py candidate into a NEW scratch database and prove it is usable.

Writes restore-verification.json beside the backup. Never edits manifest.json:
the capture-time consistency claim stays UNVERIFIED; this records that the copy
was actually restored and what was checked.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

FORBIDDEN_DB_RE = re.compile(r'(?:^|_)(odoo19|production|prod|postgres|template0|template1)(?:_|$)', re.IGNORECASE)
DB_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
SQL_INSTALLED = "SELECT count(*) FROM ir_module_module WHERE name LIKE 'nasq\\_%' AND state = 'installed'"
SQL_STUCK = "SELECT count(*) FROM ir_module_module WHERE state IN ('to upgrade', 'to install', 'to remove')"
SQL_ATTACHMENTS = 'SELECT DISTINCT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY 1'


class RestoreError(Exception):
    """Validation or restore failure; no verification record claims success."""


def validate_target_db(name: str) -> str:
    if not DB_NAME_RE.match(name) or FORBIDDEN_DB_RE.search(name) or 'scratch' not in name.lower():
        raise RestoreError('target database must be a new scratch name and must not resemble a live database')
    return name


def _tool(path: str, what: str) -> str:
    candidate = Path(path)
    if not candidate.is_absolute() or not candidate.is_file():
        raise RestoreError(f'{what} must be an absolute path to an existing executable')
    return str(candidate)


def _conn(pg_host, pg_port, pg_user) -> list[str]:
    argv = []
    for flag, value in (('-h', pg_host), ('-p', pg_port), ('-U', pg_user)):
        if value:
            argv += [flag, str(value)]
    return argv


def perform_restore(*, backup_dir, target_db, target_filestore, pg_restore, createdb, psql,
                    pg_host=None, pg_port=None, pg_user=None, runner=subprocess.run) -> dict:
    db = validate_target_db(target_db)
    backup = Path(backup_dir)
    dump, store, manifest = backup / 'database.dump', backup / 'filestore', backup / 'manifest.json'
    if not (backup.is_absolute() and dump.is_file() and store.is_dir() and manifest.is_file()):
        raise RestoreError('backup directory must be absolute and contain database.dump, filestore/ and manifest.json')
    destination = Path(target_filestore)
    if not destination.is_absolute() or destination.exists() or destination.name != db:
        raise RestoreError('target filestore must be a new absolute path ending in the target database name')
    tools = {
        'pg_restore': _tool(pg_restore, 'pg_restore'),
        'createdb': _tool(createdb, 'createdb'),
        'psql': _tool(psql, 'psql'),
    }
    conn = _conn(pg_host, pg_port, pg_user)

    def run(argv):
        done = runner(argv, capture_output=True, text=True, shell=False, check=False)
        if done.returncode != 0:
            raise RestoreError(f'{Path(argv[0]).name} failed with exit code {done.returncode}')
        return done.stdout

    run([tools['createdb'], *conn, db])
    run([tools['pg_restore'], *conn, '--no-owner', '--exit-on-error', '-d', db, str(dump)])
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(str(store), str(destination), symlinks=True)

    def query(sql):
        return run([tools['psql'], *conn, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql])

    installed = int(query(SQL_INSTALLED).strip() or 0)
    stuck = int(query(SQL_STUCK).strip() or 0)
    referenced = [line for line in query(SQL_ATTACHMENTS).splitlines() if line]
    missing = [name for name in referenced if not (destination / name).is_file()]
    result = {
        'restore_verified': installed > 0 and stuck == 0 and not missing,
        'verified_at': datetime.now(timezone.utc).isoformat(),
        'restored_into': db,
        'source_manifest': json.loads(manifest.read_text(encoding='utf-8')),
        'checks': {
            'nasq_modules_installed': installed,
            'modules_stuck_mid_transition': stuck,
            'attachment_files_referenced': len(referenced),
            'missing_attachment_files': missing,
        },
        'not_covered': ['capture-time quiescence', 'encryption', 'offsite copy', 'retention', 'RPO', 'RTO'],
    }
    (backup / 'restore-verification.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8',
    )
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('--backup-dir', '--target-db', '--target-filestore', '--pg-restore', '--createdb', '--psql'):
        parser.add_argument(flag, required=True)
    for flag in ('--pg-host', '--pg-port', '--pg-user'):
        parser.add_argument(flag)
    args = parser.parse_args(argv)
    try:
        result = perform_restore(**vars(args))
    except RestoreError as error:
        print(f'restore_verify: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result['checks'], ensure_ascii=False))
    return 0 if result['restore_verified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
```

Run: `cd deploy && python3 -B -m unittest test_restore_verify -v` → Expected: 5 PASS.

- [ ] **Step 3: تمرين حقيقي محلياً — الإيجابي**

```bash
PGBIN=$(dirname "$(command -v pg_dump)"); WORK=$(mktemp -d)
# 1) ثبّت قاعدة مصدر scratch بأمر "Check commands" من CLAUDE.md (بلا --test-tags)، مع:
#    -d nasq_drill_src_scratch  --data-dir="$WORK/data"  --without-demo=all  --http-port=8169
#    -i nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat   و --addons-path يشمل <WORKTREE>/odoo-addons
python3 deploy/backup.py --opt-in MANUAL_BACKUP_OPT_IN --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
  --db-name nasq_drill_src_scratch --filestore "$WORK/data/filestore/nasq_drill_src_scratch" \
  --output-dir "$WORK/backup" --pg-dump "$PGBIN/pg_dump"
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db nasq_drill_restored_scratch \
  --target-filestore "$WORK/restored-data/filestore/nasq_drill_restored_scratch" \
  --pg-restore "$PGBIN/pg_restore" --createdb "$PGBIN/createdb" --psql "$PGBIN/psql"; echo exit=$?
```

Expected: `exit=0`، و`restore-verification.json` فيه `"restore_verified": true` و`missing_attachment_files: []`.
إن رفض `backup.py` مدخلاً أو طلب علماً إضافياً فاتبع رسالته حرفياً (الأداة fail-closed عمداً) ولا تعدّلها.

- [ ] **Step 4: الدليل النهائي — أقلِع Odoo على القاعدة المسترجعة**

شغّل Odoo (بلا `-i`/`-u`، بلا `--stop-after-init`) على `-d nasq_drill_restored_scratch --data-dir="$WORK/restored-data" --http-port=8169 --max-cron-threads=0` في الخلفية، ثم:

```bash
sleep 25; curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8169/web/health
```

Expected: `200`. أوقف العملية.

- [ ] **Step 5: السلبي ثم التنظيف**

```bash
find "$WORK/backup/filestore" -type f | head -n1 | xargs rm
python3 deploy/restore_verify.py --backup-dir "$WORK/backup" --target-db nasq_drill_restored2_scratch \
  --target-filestore "$WORK/restored-data/filestore/nasq_drill_restored2_scratch" \
  --pg-restore "$PGBIN/pg_restore" --createdb "$PGBIN/createdb" --psql "$PGBIN/psql"; echo exit=$?
dropdb nasq_drill_src_scratch; dropdb nasq_drill_restored_scratch; dropdb nasq_drill_restored2_scratch; rm -rf "$WORK"
```

Expected: `exit=1` مع اسم الملف المحذوف في `missing_attachment_files`.

- [ ] **Step 6: وظيفة CI `restore-drill`**

انسخ من وظيفة `odoo` كتلة `services` وخطوات checkout/pin/checkout-odoo/setup-python/apt/pip كما هي، وأضف `postgresql-client-16` إلى سطر `apt-get install`، ثم:

```yaml
      - name: Backup, restore, and prove the negative
        env: { PGPASSWORD: odoo }
        run: |
          set -eu; B=/usr/lib/postgresql/16/bin; W=$(mktemp -d)
          python _odoo/odoo-bin --db_host=127.0.0.1 --db_user=odoo --db_password=odoo \
            --addons-path="$PWD/_odoo/addons,$PWD/odoo-addons" --data-dir="$W/data" \
            -d nasq_drill_src_scratch -i nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
            --without-demo=all --http-port=8169 --stop-after-init
          python3 deploy/backup.py --opt-in MANUAL_BACKUP_OPT_IN --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
            --db-name nasq_drill_src_scratch --filestore "$W/data/filestore/nasq_drill_src_scratch" \
            --output-dir "$W/backup" --pg-dump $B/pg_dump --pg-host 127.0.0.1 --pg-user odoo
          verify() { python3 deploy/restore_verify.py --backup-dir "$W/backup" --target-db "$1" \
            --target-filestore "$W/restored/filestore/$1" --pg-restore $B/pg_restore --createdb $B/createdb \
            --psql $B/psql --pg-host 127.0.0.1 --pg-user odoo; }
          verify nasq_drill_restored_scratch
          find "$W/backup/filestore" -type f | head -n1 | xargs rm
          if verify nasq_drill_restored2_scratch; then echo "negative case passed unexpectedly"; exit 1; fi
```

- [ ] **Step 7: وثّق وcommit**

في `deploy/OPERATIONS.md`: أضف قسم "Restore and verification" بأوامر Step 3–4، واذكر أن `restore-verification.json` سجلّ منفصل لا يغيّر `manifest.json`. في جدول "Unresolved" **أبقِ** retention / encryption / offsite / RPO / RTO / PITR / quiescence كما هي — لم تُحَل في هذه المرحلة.

```bash
git add deploy/restore_verify.py deploy/test_restore_verify.py deploy/OPERATIONS.md .github/workflows/ci.yml
git commit -m "ops: add a verified restore tool and a backup/restore drill in CI"
```

**Acceptance:** نسخة `backup.py` تُسترجع إلى قاعدة جديدة ويقلع عليها Odoo ويجيب `/web/health` بـ200 · حذف ملف مرفق واحد يُفشل التحقق ويسمّيه · الأداة ترفض أي هدف لا يحمل `scratch` أو يشبه قاعدة حية · `manifest.json` لا يتغيّر.
**Rollback:** `git revert`. الأداة لا تكتب إلا في قاعدة scratch جديدة ومسار filestore جديد.

---

### Task 7: Playwright على الـmock في CI (0.1)

**Files:**
- Create: `apps/web/e2e/ci-mock-specs.txt`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `apps/web/e2e/internal-ui-audit-mock.mjs` (env: `PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT`؛ دخول admin/admin؛ قاعدة `nasq_ui_mock_only`).
- Produces: وظيفة `e2e-mock`. الـe2e على Odoo حقيقي **خارج Phase 0** (يتطلب fixtures عبر Odoo؛ يُضاف مع `nasq-cli` في Phase 3).

- [ ] **Step 1: حدّد القائمة بالقياس لا بالتخمين**

```bash
cd apps/web
PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4498 node e2e/internal-ui-audit-mock.mjs &
NUXT_ODOO_URL=http://127.0.0.1:4498 NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4498/websocket npx nuxt dev --port 4097 &
for i in $(seq 1 60); do curl -fs http://localhost:4097/login >/dev/null && break; sleep 2; done
E2E_BASE_URL=http://localhost:4097 E2E_PROJECT_POPUPS=1 npx playwright test --reporter=json > /tmp/e2e.json || true
node -e 'const r=require("/tmp/e2e.json");const ok=new Set(),bad=new Set();(function w(s){for(const x of s.suites||[])w(x);for(const sp of s.specs||[])(sp.ok?ok:bad).add(sp.file)})(r);console.log([...ok].filter(f=>!bad.has(f)).sort().join("\n"))' > e2e/ci-mock-specs.txt
kill %1 %2; wc -l e2e/ci-mock-specs.txt
```

Expected: ملف يسرد ملفات الـspec التي نجحت **كل** اختباراتها على الـmock (مسارات نسبية إلى `e2e/`). إن كان فارغاً **توقف وأبلغ**؛ لا تضف وظيفة لا تختبر شيئاً.

- [ ] **Step 2: الوظيفة**

```yaml
  e2e-mock:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci --ignore-scripts
      - run: npm -w apps/web run postinstall
      - run: npx playwright install --with-deps chromium
        working-directory: apps/web
      - name: Mock API + Nuxt + Playwright
        working-directory: apps/web
        env:
          PROJECTS_UI_PREVIEW: '1'
          MODULE_UI_PREVIEW: '1'
          MOCK_PORT: '4498'
          NUXT_ODOO_URL: http://127.0.0.1:4498
          NUXT_ODOO_DB: nasq_ui_mock_only
          NUXT_PUBLIC_WS_URL: ws://127.0.0.1:4498/websocket
          E2E_BASE_URL: http://localhost:4097
          E2E_PROJECT_POPUPS: '1'
        run: |
          node e2e/internal-ui-audit-mock.mjs &
          npx nuxt build
          PORT=4097 node .output/server/index.mjs &
          for i in $(seq 1 60); do curl -fs http://localhost:4097/login >/dev/null && break; sleep 2; done
          npx playwright test $(sed 's#^#e2e/#' e2e/ci-mock-specs.txt | tr '\n' ' ')
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-results, path: apps/web/test-results }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/ci-mock-specs.txt .github/workflows/ci.yml
git commit -m "ci: run the mock-backed Playwright specs"
```

**Acceptance:** الوظيفة خضراء ثلاث مرات متتالية (لا flakiness) · القائمة مولّدة بالقياس · موثّق في الـPR أن e2e الحقيقي مؤجَّل إلى Phase 3 ولماذا.
**Rollback:** احذف الوظيفة والملف.

---

### Task 8: إغلاق المرحلة

**Files:**
- Modify: `CLAUDE.md`, `docs/WORKSPACE.md`

- [ ] **Step 1: `CLAUDE.md`** — في قسم "Check commands" أضف فقرة: CI (`.github/workflows/ci.yml`) يشغّل `static`، `odoo`، `upgrade`، `image`، `restore-drill`، `e2e-mock`؛ كل فحص قابل للتشغيل محلياً بالأوامر نفسها؛ سياسة الترحيل في `docs/migrations.md`؛ commit Odoo في `deploy/odoo/ODOO_COMMIT`. وأضف `nasq_chat` إلى أمر الاختبار النموذجي (`-i` و`--test-tags`).

**لا تغيّر** سطر "there is no shared tenant layer" في هذه المرحلة. صياغته المعتمدة من المالك تُطبَّق في Phase 1 عند وجود `nasq_platform` فعلاً:

```text
Nasq has a tenant abstraction through nasq_platform,
but tenant isolation remains database-per-tenant.
There is no shared-database tenant layer.
```

- [ ] **Step 2: `docs/WORKSPACE.md`** — أضف سطراً يربط بهذه الخطة وبالمواصفة ضمن "أدلة التسليم".

- [ ] **Step 3: بوابة القبول النهائية** — شغّل وسجّل المخرجات في وصف الـPR:

```bash
npm test && npm -w apps/web run lint && ruff check odoo-addons
python3 -B -m unittest discover -s deploy -p 'test_*.py' -v
```

ثم على PR (بعد إذن الدفع): الوظائف الست خضراء، وثلاث PRات تخريبية تُغلق دون دمج وتثبت الفشل: (أ) ملف `.env` متتبَّع، (ب) رفع `version` بلا migrations، (ج) حقل `required` جديد بلا ترحيل.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/WORKSPACE.md
git commit -m "docs: record the Phase 0 gates and where each one runs"
```

**Acceptance — تعريف "Phase 0 أخضر بالكامل":**
1. ست وظائف CI خضراء على `main`.
2. كل حارس ثبت فشله مرة على تخريب متعمَّد.
3. صورة مخبوزة تثبّت الركائز الخمس بلا bind mount.
4. نسخة احتياطية استُرجعت وأقلع عليها Odoo.
5. ترقية من `release/19.0.1.0.0` إلى HEAD تمر.
6. `git ls-files` بلا مسار سرّي.

عندها فقط تُكتب خطة Phase 1.

**يحتاج إذن المالك صراحةً (لا يُنفَّذ تلقائياً):** دفع الفرع · دفع وسم `release/19.0.1.0.0` · تفعيل branch protection على `main` بالوظائف الست · التحقق من SHA مستودع Odoo (Task 2 Step 1).
