# WebVue AI — الخطة أ: أدون `webvue_ai` وأدوات PMO

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** أدون `webvue_ai` برتبة 3 يملك سجل الأدوات وسجل التدقيق وميزة `ai.enabled` وحدودها،
ومساري `GET /api/v1/ai/tools` و`POST /api/v1/ai/audit`، و`webvue_pmo` يعلن أدواته الست فيه.

**Architecture:** `webvue.ai.tool.registry` نموذج مجرد يُركَّب عبر `super()` مثل
`webvue.notify.registry`؛ كل تطبيق يرث منه ويعلن أدواته فوق مساراته القائمة. المسار يعيد
فقط ما يملك المستخدم قدرته. `webvue.ai.audit` نموذج عادي بقواعد سجل، وعدّاد الرسائل
الشهري يمتد من `webvue.entitlement.service._webvue_count_usage`.

**Tech Stack:** Odoo 19 Community، `WebVueApiCase` / `WebVuePmoCase`، `tools/odoo_test.py`.

**Spec:** [`../specs/2026-10-15-webvue-ai-design.md`](../specs/2026-10-15-webvue-ai-design.md) —
العقود في [`2026-10-15-webvue-ai-master.md`](2026-10-15-webvue-ai-master.md) (ع1، ع4، ع6).

## Global Constraints

- كما في الخطة الرئيسية، إضافةً إلى: `webvue_ai` يعتمد على `webvue_api` فقط. لا `sudo()`
  إطلاقًا في الأدون. لا يسمّي `webvue_pmo` ولا أي تطبيق في كوده أو اختباراته.
- الإصدار الأول `19.0.1.0.0`. `webvue_pmo` يرتفع من `19.0.1.5.0` إلى `19.0.1.5.1` مع
  `migrations/19.0.1.5.1/README.md` (تبعية جديدة بلا تغيير مخطط).
- كل مسار جديد يمر باختبار `test_feature_route_coverage` القائم: بوابة
  `requires_registered_feature` تكفيه.
- أوامر الاختبار تعمل من الـ worktree: `python3 -B tools/odoo_test.py --addons webvue_ai`
  (ينشئ نسخة من قالب سكراتش ويسقطها؛ لا يلمس `odoo19`).

## Review Focus

1. **أداة معلنة بقدرة غير موجودة في الكتالوج** (خطأ إملائي في تطبيق): `_webvue_ai_tool_map`
   يرفضها عند أول استدعاء برسالة تسمّي الأداة (اختبار في المهمة 2).
2. **مستخدم من شركة أخرى يقرأ سجل تدقيق ليس له**: قاعدة السجل تخفيه، والمسار لا يعيد
   غير سجلات المستخدم (اختبار في المهمة 4).
3. **`input_map` يشير إلى مدخل غير معرّف في `input_schema`**: يُرفض عند التحقق لا عند
   التنفيذ (اختبار في المهمة 2).
4. **تدقيق بـ `kind = draft` و`result = approved` بلا `attested`**: يُرفض 422 حتى لا يُسجَّل
   اعتماد بلا إقرار (اختبار في المهمة 4).
5. **الميزة `ai.enabled` معطلة للمستأجر**: المساران يردان 403 `feature_not_included` ولا
   يكتبان شيئًا (اختبار في المهمة 3 و4).

---

### Task 1: هيكل الأدون وتسجيله في الطبقات والميزات

**Files:**
- Create: `odoo-addons/webvue_ai/__init__.py`
- Create: `odoo-addons/webvue_ai/__manifest__.py`
- Create: `odoo-addons/webvue_ai/models/__init__.py`
- Create: `odoo-addons/webvue_ai/models/feature_registry.py`
- Create: `odoo-addons/webvue_ai/controllers/__init__.py`
- Create: `odoo-addons/webvue_ai/tests/__init__.py`
- Create: `odoo-addons/webvue_ai/tests/test_feature_registry.py`
- Modify: `tools/arch_layers.json` (المفتاح `ranks`)

**Interfaces:**
- Produces: مفاتيح `ai.enabled` و`ai.messages.monthly` و`ai.tool_calls.per_run` في
  `webvue.feature.registry`، ومعرّف الوحدة `webvue_ai` في `_webvue_module_definitions`.

- [ ] **Step 1: سجّل الأدون في طبقات المعمارية**

في `tools/arch_layers.json` أضف داخل `"ranks"` بعد `"webvue_notify": 3,`:

```json
    "webvue_ai": 3,
```

- [ ] **Step 2: اكتب الاختبار الفاشل**

`odoo-addons/webvue_ai/tests/test_feature_registry.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestAiFeatureRegistry(TransactionCase):

    def test_ai_features_are_registered_with_their_owner(self):
        features = self.env['webvue.feature.registry']._webvue_feature_map()
        self.assertEqual(features['ai.enabled']['type'], 'boolean')
        self.assertEqual(features['ai.enabled']['owner'], 'webvue_ai')
        self.assertEqual(features['ai.messages.monthly']['type'], 'limit')
        self.assertEqual(features['ai.tool_calls.per_run']['type'], 'limit')
        self.assertIn('webvue_ai', self.env['webvue.feature.registry']._webvue_module_map())

    def test_fresh_tenant_policy_enables_ai(self):
        service = self.env['webvue.entitlement.service']
        self.assertTrue(service._webvue_feature_read('ai.enabled'))
        self.assertIsNone(service._webvue_limit_value('ai.messages.monthly'))
```

`odoo-addons/webvue_ai/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_feature_registry
```

- [ ] **Step 3: اكتب المانيفست والهيكل**

`odoo-addons/webvue_ai/__manifest__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue AI',
    'summary': 'webvue platform: the WebVue AI tool registry, audit log and /api/v1/ai routes',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (rank 3): it knows no application and no language model.
    # Each application declares its tools in webvue.ai.tool.registry; the AI
    # service and the Nuxt executor live outside Odoo (spec 2026-10-15-webvue-ai-design).
    'depends': ['webvue_api'],
    'data': [
        'security/ir.model.access.csv',
        'security/webvue_ai_rules.xml',
    ],
    'installable': True,
    'application': False,
}
```

المهمة 4 تنشئ ملفي `security/`؛ حتى ذلك الحين أنشئهما فارغين صالحين:

`odoo-addons/webvue_ai/security/ir.model.access.csv`:

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
```

`odoo-addons/webvue_ai/security/webvue_ai_rules.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
</odoo>
```

`odoo-addons/webvue_ai/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
```

`odoo-addons/webvue_ai/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import feature_registry
```

`odoo-addons/webvue_ai/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
```

`odoo-addons/webvue_ai/models/feature_registry.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueAiFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {'key': 'ai.enabled', 'type': 'boolean', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
            {'key': 'ai.messages.monthly', 'type': 'limit', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
            {'key': 'ai.tool_calls.per_run', 'type': 'limit', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + ({'id': 'webvue_ai'},)
```

- [ ] **Step 4: شغّل الاختبار**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: الاختباران يمران (`0 failed, 0 error(s) of 2 tests`). لو فشل التثبيت بسبب
الكتالوج ("feature ... not in any tier") فهذا متوقع حتى المهمة 5؛ أكمل المهمة 5 أولًا ثم
أعد هذه الخطوة.

- [ ] **Step 5: Commit**

```bash
git add tools/arch_layers.json odoo-addons/webvue_ai
git commit -m "feat(platform): scaffold webvue_ai with its features"
```

---

### Task 2: سجل الأدوات `webvue.ai.tool.registry` والتحقق من التعريفات

**Files:**
- Create: `odoo-addons/webvue_ai/models/tool_registry.py`
- Modify: `odoo-addons/webvue_ai/models/__init__.py`
- Create: `odoo-addons/webvue_ai/tests/common.py`
- Create: `odoo-addons/webvue_ai/tests/test_tool_registry.py`
- Modify: `odoo-addons/webvue_ai/tests/__init__.py`

**Interfaces:**
- Produces:
  - `webvue.ai.tool.registry._webvue_ai_tool_definitions() -> tuple[dict]` تُركَّب عبر `super()`.
  - `_webvue_ai_tool_map() -> dict[name, definition]` بعد التحقق (يرفع `ValidationError`).
  - `_webvue_ai_feature_keys() -> tuple[str]` مفاتيح `feature_key` المسجلة، لبوابة المسار.
  - `_webvue_ai_tools_for_user(user=None) -> list[dict]` (المهمة 3).
  - الثوابت `TOOL_KINDS = ('read', 'write_light', 'draft')`.

- [ ] **Step 1: اكتب أدوات الاختبار المشتركة**

`odoo-addons/webvue_ai/tests/common.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only tools for webvue_ai's own tests.

webvue_ai knows no application, so its tests register probe tools for the length
of one test (``self.patch`` on the registry), gated by the platform probe
feature and by capability keys the test grants through a patched
``_webvue_has_capability``. The tests behave the same with or without an
application installed.
"""
from odoo.addons.webvue_api.tests.common import (
    PROBE_FEATURE,
    register_probe_feature,
    set_probe_feature,
)

READ_CAP = 'probe.things.read'
WRITE_CAP = 'probe.things.write'
CREATE_CAP = 'probe.things.create'

PROBE_TOOLS = (
    {
        'name': 'probe.list_things',
        'owner': 'webvue_probe',
        'kind': 'read',
        'capability': READ_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'GET', 'path': '/api/v1/probe/things'},
        'input_schema': {
            'type': 'object',
            'properties': {'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}},
            'additionalProperties': False,
        },
        'input_map': {'query': {'limit': '$limit', 'filter': 'mine'}},
        'description_ar': 'يعرض الأشياء',
        'description_en': 'List things',
        'result_summary': ['items[].id', 'items[].name', 'total'],
    },
    {
        'name': 'probe.rename_thing',
        'owner': 'webvue_probe',
        'kind': 'write_light',
        'capability': WRITE_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'PATCH', 'path': '/api/v1/probe/things/{thing_id}'},
        'input_schema': {
            'type': 'object',
            'properties': {'thing_id': {'type': 'integer'}, 'name': {'type': 'string'}},
            'required': ['thing_id', 'name'],
            'additionalProperties': False,
        },
        'input_map': {'path': {'thing_id': '$thing_id'}, 'body': {'name': '$name'}},
        'description_ar': 'يعيد تسمية شيء',
        'description_en': 'Rename a thing',
        'result_summary': ['id', 'name'],
    },
    {
        'name': 'probe.draft_thing',
        'owner': 'webvue_probe',
        'kind': 'draft',
        'capability': CREATE_CAP,
        'feature_key': PROBE_FEATURE,
        'draft_target': '/things/new',
        'input_schema': {
            'type': 'object',
            'properties': {'name': {'type': 'string'}},
            'required': ['name'],
            'additionalProperties': False,
        },
        'description_ar': 'يجهّز مسودة شيء',
        'description_en': 'Draft a thing',
    },
)


class AiProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``.

    ``self.granted`` is the set of capability keys the patched access service
    grants to every user; tests add and remove keys to shape what a user sees.
    """

    def _install_probe(self, tools=PROBE_TOOLS):
        self.granted = set()
        registry = type(self.env['webvue.ai.tool.registry'])
        self.patch(registry, '_webvue_ai_tool_definitions', lambda model: tools)
        access = type(self.env['webvue.access.service'])
        original = access._webvue_has_capability

        def has_capability(model, user, key, record=None, company=None):
            if key in {READ_CAP, WRITE_CAP, CREATE_CAP}:
                return key in self.granted
            return original(model, user, key, record=record, company=company)

        self.patch(access, '_webvue_has_capability', has_capability)
        register_probe_feature(self)
        set_probe_feature(self)
```

- [ ] **Step 2: اكتب اختبارات التحقق الفاشلة**

`odoo-addons/webvue_ai/tests/test_tool_registry.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_ai.tests.common import PROBE_TOOLS, AiProbe


@tagged('post_install', '-at_install', 'webvue')
class TestAiToolRegistry(AiProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_probe()

    def _with(self, **changes):
        base = dict(PROBE_TOOLS[0])
        base.update(changes)
        return (base,)

    def _assert_rejected(self, tools, fragment):
        self.patch(type(self.env['webvue.ai.tool.registry']), '_webvue_ai_tool_definitions', lambda model: tools)
        with self.assertRaises(ValidationError) as caught:
            self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
        self.assertIn(fragment, str(caught.exception))

    def test_probe_tools_validate_and_keep_registration_order(self):
        tools = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
        self.assertEqual(list(tools), ['probe.list_things', 'probe.rename_thing', 'probe.draft_thing'])
        self.assertEqual(self.env['webvue.ai.tool.registry']._webvue_ai_feature_keys(), ('test_probe.enabled',))

    def test_duplicate_name_is_rejected(self):
        self._assert_rejected((PROBE_TOOLS[0], PROBE_TOOLS[0]), 'duplicate tool probe.list_things')

    def test_name_must_start_with_owner_prefix(self):
        self._assert_rejected(self._with(name='other.list_things'), 'probe.list_things')
        # The message names the offending tool by its declared name.

    def test_unknown_kind_is_rejected(self):
        self._assert_rejected(self._with(kind='delete'), 'kind')

    def test_read_tool_must_use_get(self):
        self._assert_rejected(self._with(route={'method': 'POST', 'path': '/api/v1/probe/things'}), 'GET')

    def test_route_must_be_under_api_v1(self):
        self._assert_rejected(self._with(route={'method': 'GET', 'path': '/web/things'}), '/api/v1/')

    def test_draft_tool_has_target_and_no_route(self):
        draft = dict(PROBE_TOOLS[2])
        draft['route'] = {'method': 'POST', 'path': '/api/v1/probe/things'}
        self._assert_rejected((draft,), 'route')
        draft = dict(PROBE_TOOLS[2])
        draft.pop('draft_target')
        self._assert_rejected((draft,), 'draft_target')

    def test_input_map_may_only_reference_schema_properties(self):
        self._assert_rejected(
            self._with(input_map={'query': {'limit': '$page_size'}}), 'page_size',
        )

    def test_path_placeholders_must_be_mapped(self):
        self._assert_rejected(
            self._with(route={'method': 'GET', 'path': '/api/v1/probe/things/{thing_id}'}), 'thing_id',
        )

    def test_missing_capability_or_descriptions_are_rejected(self):
        self._assert_rejected(self._with(capability=''), 'capability')
        self._assert_rejected(self._with(description_ar=''), 'description_ar')

    def test_result_summary_must_be_a_list_of_paths(self):
        self._assert_rejected(self._with(result_summary='items'), 'result_summary')
        self._assert_rejected(self._with(result_summary=['items[]', 'bad path!']), 'bad path!')
```

عدّل `odoo-addons/webvue_ai/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import common, test_feature_registry, test_tool_registry
```

- [ ] **Step 3: شغّل الاختبارات للتأكد من فشلها**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: FAIL بسبب `KeyError: 'webvue.ai.tool.registry'` في `_install_probe`.

- [ ] **Step 4: اكتب السجل**

`odoo-addons/webvue_ai/models/tool_registry.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

TOOL_KINDS = ('read', 'write_light', 'draft')
ROUTE_METHODS = ('GET', 'POST', 'PATCH')
MAP_SECTIONS = ('path', 'query', 'body')
TOOL_NAME = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
SUMMARY_PATH = re.compile(r'^[a-z_][a-z0-9_]*(\[\])?(\.[a-z_][a-z0-9_]*(\[\])?)*$')
PLACEHOLDER = re.compile(r'\{([a-z_][a-z0-9_]*)\}')
REQUIRED_TEXT = ('owner', 'capability', 'feature_key', 'description_ar', 'description_en')


class WebVueAiToolRegistry(models.AbstractModel):
    """WebVue AI tools, composed through ``super()`` like ``webvue.feature.registry``.

    webvue_ai knows no application. Each application declares its tools here:
    a name, the capability its route already checks, the route and how the
    model's inputs map onto it, and the whitelist of result fields the model
    may read. A tool outside this registry does not exist for the AI service.
    """
    _name = 'webvue.ai.tool.registry'
    _description = 'WebVue AI tool registry'
    _webvue_scope = 'global'

    @api.model
    def _webvue_ai_tool_definitions(self):
        """Pure descriptors; never a process-global set."""
        return ()

    def _webvue_ai_error(self, name, message):
        raise ValidationError(self.env._('webvue_ai: tool %(name)s: %(message)s', name=name, message=message))

    @api.model
    def _webvue_ai_validate(self, item):
        name = item.get('name')
        if not isinstance(name, str) or not TOOL_NAME.match(name):
            self._webvue_ai_error(repr(name), 'name must be <app>.<verb_object>')
        for field in REQUIRED_TEXT:
            if not item.get(field) or not isinstance(item[field], str):
                self._webvue_ai_error(name, f'missing {field}')
        if name.split('.')[0] != item['owner'].removeprefix('webvue_'):
            self._webvue_ai_error(name, f"name prefix must match owner {item['owner']}")
        kind = item.get('kind')
        if kind not in TOOL_KINDS:
            self._webvue_ai_error(name, f'kind must be one of {TOOL_KINDS}')
        schema = item.get('input_schema')
        if not isinstance(schema, dict) or schema.get('type') != 'object' or not isinstance(schema.get('properties'), dict):
            self._webvue_ai_error(name, 'input_schema must be a JSON Schema object with properties')
        properties = set(schema['properties'])
        if kind == 'draft':
            if item.get('route') is not None:
                self._webvue_ai_error(name, 'a draft tool has no route')
            target = item.get('draft_target')
            if not isinstance(target, str) or not target.startswith('/'):
                self._webvue_ai_error(name, 'draft_target must be an absolute page path')
            if item.get('input_map') or item.get('result_summary'):
                self._webvue_ai_error(name, 'a draft tool has no input_map or result_summary')
            return
        if item.get('draft_target') is not None:
            self._webvue_ai_error(name, 'only a draft tool has a draft_target')
        route = item.get('route')
        if not isinstance(route, dict) or route.get('method') not in ROUTE_METHODS or not str(route.get('path', '')).startswith('/api/v1/'):
            self._webvue_ai_error(name, 'route must be {method, path} under /api/v1/')
        if kind == 'read' and route['method'] != 'GET':
            self._webvue_ai_error(name, 'a read tool must use GET')
        if kind == 'write_light' and route['method'] == 'GET':
            self._webvue_ai_error(name, 'a write_light tool must not use GET')
        input_map = item.get('input_map') or {}
        if not isinstance(input_map, dict) or set(input_map) - set(MAP_SECTIONS):
            self._webvue_ai_error(name, f'input_map sections must be among {MAP_SECTIONS}')
        for section, values in input_map.items():
            if not isinstance(values, dict):
                self._webvue_ai_error(name, f'input_map.{section} must be an object')
            for value in values.values():
                if isinstance(value, str) and value.startswith('$') and value[1:] not in properties:
                    self._webvue_ai_error(name, f'input_map references unknown input {value[1:]}')
        placeholders = set(PLACEHOLDER.findall(route['path']))
        unmapped = placeholders - set(input_map.get('path') or {})
        if unmapped:
            self._webvue_ai_error(name, f'path placeholder {sorted(unmapped)[0]} is not mapped')
        summary = item.get('result_summary')
        if not isinstance(summary, (list, tuple)) or not summary:
            self._webvue_ai_error(name, 'result_summary must be a non-empty list of paths')
        for path in summary:
            if not isinstance(path, str) or not SUMMARY_PATH.match(path):
                self._webvue_ai_error(name, f'result_summary path {path!r} is invalid')

    @api.model
    def _webvue_ai_tool_map(self):
        tools = {}
        for item in self._webvue_ai_tool_definitions():
            self._webvue_ai_validate(item)
            if item['name'] in tools:
                self._webvue_ai_error(item['name'], f"duplicate tool {item['name']}")
            tools[item['name']] = item
        return tools

    @api.model
    def _webvue_ai_feature_keys(self):
        """Feature keys of the registered tools, in registration order, each once."""
        keys = []
        for item in self._webvue_ai_tool_map().values():
            if item['feature_key'] not in keys:
                keys.append(item['feature_key'])
        return tuple(keys)
```

عدّل `odoo-addons/webvue_ai/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import feature_registry, tool_registry
```

- [ ] **Step 5: شغّل الاختبارات**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: PASS (كل اختبارات `test_tool_registry` و`test_feature_registry`).

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_ai
git commit -m "feat(platform): add the webvue_ai tool registry with validation"
```

---

### Task 3: أدوات المستخدم ومسار `GET /api/v1/ai/tools`

**Files:**
- Modify: `odoo-addons/webvue_ai/models/tool_registry.py`
- Create: `odoo-addons/webvue_ai/serializers/__init__.py`
- Create: `odoo-addons/webvue_ai/serializers/tool.py`
- Create: `odoo-addons/webvue_ai/controllers/ai.py`
- Modify: `odoo-addons/webvue_ai/controllers/__init__.py`
- Create: `odoo-addons/webvue_ai/tests/test_ai_routes.py`
- Modify: `odoo-addons/webvue_ai/tests/__init__.py`

**Interfaces:**
- Consumes: `_webvue_ai_tool_map()` من المهمة 2؛ `webvue.access.service._webvue_has_capability(user, key)`؛
  `webvue.entitlement.service._webvue_feature_read(key)` و`require_read(key)` و`_webvue_limit_value(key)`.
- Produces:
  - `_webvue_ai_tools_for_user(user=None) -> list[dict]`.
  - `dump_tool(item) -> dict` بشكل ع1.
  - `GET /api/v1/ai/tools` يعيد `{items, total, limits}`؛ `limits.messages_used` يأتي من
    المهمة 4 (حتى تكتمل يعيد 0 عبر الدالة `_webvue_ai_messages_used()` التي تُنشأ هنا
    وتعيد 0 ثم تُستبدل في المهمة 4).

- [ ] **Step 1: اكتب اختبارات المسار الفاشلة**

`odoo-addons/webvue_ai/tests/test_ai_routes.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase, set_probe_feature
from odoo.addons.webvue_ai.tests.common import CREATE_CAP, READ_CAP, WRITE_CAP, AiProbe
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestAiToolsRoute(AiProbe, WebVueApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_limit(self, key, value):
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def test_lists_only_the_tools_the_user_has_capabilities_for(self):
        self.granted = {READ_CAP}
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual([item['name'] for item in body['items']], ['probe.list_things'])
        self.assertEqual(body['total'], 1)
        tool = body['items'][0]
        self.assertEqual(tool['kind'], 'read')
        self.assertEqual(tool['route'], {'method': 'GET', 'path': '/api/v1/probe/things'})
        self.assertEqual(tool['input_map'], {'query': {'limit': '$limit', 'filter': 'mine'}})
        self.assertEqual(tool['description'], {'ar': 'يعرض الأشياء', 'en': 'List things'})
        self.assertIsNone(tool['draft_target'])
        self.assertNotIn('capability', tool)
        self.assertNotIn('owner', tool)

    def test_draft_tool_carries_its_target_and_no_route(self):
        self.granted = {CREATE_CAP}
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual([item['name'] for item in body['items']], ['probe.draft_thing'])
        self.assertIsNone(body['items'][0]['route'])
        self.assertEqual(body['items'][0]['draft_target'], '/things/new')

    def test_no_capability_means_an_empty_catalog_not_an_error(self):
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(body, {'items': [], 'total': 0, 'limits': body['limits']})

    def test_limits_block_reports_configured_values(self):
        self.granted = {READ_CAP, WRITE_CAP}
        self._set_limit('ai.tool_calls.per_run', 5)
        body = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(body['limits'], {'tool_calls_per_run': 5, 'messages_monthly': None, 'messages_used': 0})

    def test_tools_whose_feature_is_off_are_hidden(self):
        self.granted = {READ_CAP}
        set_probe_feature(self, enabled=False)
        response = self.api('GET', '/api/v1/ai/tools')
        # The only registered feature is off, so the registry gate answers 403.
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'feature_not_included')

    def test_ai_disabled_answers_feature_not_included(self):
        self.granted = {READ_CAP}
        self._set_limit('ai.enabled', False)
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'retained_read_features': [k for k in (profile.retained_read_features or []) if k != 'ai.enabled'],
        })
        response = self.api('GET', '/api/v1/ai/tools')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['details'], {'reason': 'feature', 'feature': 'ai.enabled'})

    def test_anonymous_is_rejected(self):
        self.logout()
        response = self.api('GET', '/api/v1/ai/tools')
        self.assertIn(response.status_code, (401, 403, 404))
        # auth='user' routes never answer a catalog to a visitor.
        self.assertNotIn(b'probe.list_things', response.content)
```

عدّل `odoo-addons/webvue_ai/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import common, test_ai_routes, test_feature_registry, test_tool_registry
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: FAIL، `GET /api/v1/ai/tools` يعيد 404.

- [ ] **Step 3: أضف تصفية الأدوات حسب المستخدم إلى السجل**

في نهاية صنف `WebVueAiToolRegistry` في `odoo-addons/webvue_ai/models/tool_registry.py` أضف:

```python
    @api.model
    def _webvue_ai_tools_for_user(self, user=None):
        """The registered tools whose feature reads and whose capability ``user`` holds, in registration order."""
        user = user or self.env.user
        access = self.env['webvue.access.service']
        entitlement = self.env['webvue.entitlement.service']
        return [
            item for item in self._webvue_ai_tool_map().values()
            if entitlement._webvue_feature_read(item['feature_key'])
            and access._webvue_has_capability(user, item['capability'])
        ]

    @api.model
    def _webvue_ai_messages_used(self):
        """Messages recorded this UTC month for the current company; the audit model owns the count."""
        return 0

    @api.model
    def _webvue_ai_limits(self):
        entitlement = self.env['webvue.entitlement.service']
        return {
            'tool_calls_per_run': entitlement._webvue_limit_value('ai.tool_calls.per_run'),
            'messages_monthly': entitlement._webvue_limit_value('ai.messages.monthly'),
            'messages_used': self._webvue_ai_messages_used(),
        }
```

- [ ] **Step 4: اكتب المسلسل والمسار**

`odoo-addons/webvue_ai/serializers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
```

`odoo-addons/webvue_ai/serializers/tool.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of one AI tool (master plan contract ع1). Capability and owner stay server-side."""


def dump_tool(item):
    return {
        'name': item['name'],
        'kind': item['kind'],
        'description': {'ar': item['description_ar'], 'en': item['description_en']},
        'input_schema': item['input_schema'],
        'route': dict(item['route']) if item.get('route') else None,
        'input_map': item.get('input_map') or {},
        'result_summary': list(item.get('result_summary') or []),
        'draft_target': item.get('draft_target'),
    }
```

`odoo-addons/webvue_ai/controllers/ai.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_ai.serializers.tool import dump_tool
from odoo.addons.webvue_api.controllers.common import api_handler, requires_registered_feature

AI_FEATURE = 'ai.enabled'


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='read', match='any',
    )
    def list_tools(self, **_):
        request.env['webvue.entitlement.service'].require_read(AI_FEATURE)
        registry = request.env['webvue.ai.tool.registry']
        items = [dump_tool(item) for item in registry._webvue_ai_tools_for_user()]
        return {'items': items, 'total': len(items), 'limits': registry._webvue_ai_limits()}
```

عدّل `odoo-addons/webvue_ai/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import ai
```

- [ ] **Step 5: شغّل الاختبارات**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: PASS. لو فشل `test_tools_whose_feature_is_off_are_hidden` برمز غير 403، تحقق أن
`set_probe_feature(enabled=False)` تُبقي المفتاح خارج `retained_read_features` (الافتراضي)
فتجيب بوابة السجل 403.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_ai
git commit -m "feat(platform): serve the user's AI tools on /api/v1/ai/tools"
```

---

### Task 4: سجل التدقيق `webvue.ai.audit` ومسار `POST /api/v1/ai/audit` وعدّاد الرسائل

**Files:**
- Create: `odoo-addons/webvue_ai/models/ai_audit.py`
- Create: `odoo-addons/webvue_ai/models/entitlement_service.py`
- Modify: `odoo-addons/webvue_ai/models/__init__.py`
- Modify: `odoo-addons/webvue_ai/models/tool_registry.py` (`_webvue_ai_messages_used`)
- Modify: `odoo-addons/webvue_ai/security/ir.model.access.csv`
- Modify: `odoo-addons/webvue_ai/security/webvue_ai_rules.xml`
- Create: `odoo-addons/webvue_ai/serializers/audit.py`
- Modify: `odoo-addons/webvue_ai/controllers/ai.py`
- Create: `odoo-addons/webvue_ai/tests/test_ai_audit.py`
- Modify: `odoo-addons/webvue_ai/tests/__init__.py`

**Interfaces:**
- Consumes: `_webvue_ai_tool_map()`؛ `webvue.entitlement.service.require(key)` و`require_within_limit(key, count)`.
- Produces:
  - نموذج `webvue.ai.audit` بالحقول: `company_id`, `user_id`, `conversation_id`, `kind`,
    `tool_name`, `input`, `result`, `http_status`, `draft`, `approved`, `attested_at`.
  - `webvue.ai.audit._webvue_ai_record(values) -> record` (التحقق + الإنشاء باسم المستخدم).
  - `webvue.ai.audit._webvue_ai_count_messages(company) -> int` لهذا الشهر UTC.
  - `POST /api/v1/ai/audit` بشكل ع4؛ الرد `{id, messages_used, messages_limit}`.

- [ ] **Step 1: اكتب اختبارات التدقيق الفاشلة**

`odoo-addons/webvue_ai/tests/test_ai_audit.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase
from odoo.addons.webvue_ai.tests.common import READ_CAP, AiProbe
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_test_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}
READ = {
    'conversation_id': 'r_test_01', 'kind': 'read', 'tool_name': 'probe.list_things',
    'input': {'limit': 5, 'token': 'secret'}, 'result': 'ok', 'http_status': 200,
    'draft': None, 'approved': None, 'attested': False,
}
DRAFT = {
    'conversation_id': 'r_test_01', 'kind': 'draft', 'tool_name': 'probe.draft_thing',
    'input': {'name': 'A'}, 'result': 'proposed', 'http_status': None,
    'draft': {'name': 'A'}, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'webvue')
class TestAiAudit(AiProbe, WebVueApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.granted = {READ_CAP}
        self.other = new_test_user(
            self.env, login='ai_other', password='ai_other_pass_123', name='Omar',
            groups='webvue_core.group_employee',
        )
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def test_message_audit_counts_against_the_monthly_limit(self):
        first = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['messages_used'], 1)
        self.assertIsNone(first.json()['messages_limit'])
        self._set_feature('ai.messages.monthly', 1)
        blocked = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['error']['details'], {'reason': 'limit', 'limit_key': 'ai.messages.monthly'})
        self.assertEqual(self.env['webvue.ai.audit'].search_count([('kind', '=', 'message')]), 1)
        tools = self.api('GET', '/api/v1/ai/tools').json()
        self.assertEqual(tools['limits']['messages_used'], 1)

    def test_tool_audit_stores_a_scrubbed_input_as_the_user(self):
        body = self.api('POST', '/api/v1/ai/audit', READ).json()
        row = self.env['webvue.ai.audit'].browse(body['id'])
        self.assertEqual(row.user_id, self.employee)
        self.assertEqual(row.company_id, self.employee.company_id)
        self.assertEqual(row.input, {'limit': 5})
        self.assertEqual((row.kind, row.tool_name, row.result, row.http_status), ('read', 'probe.list_things', 'ok', 200))

    def test_unknown_tool_or_kind_or_result_is_422(self):
        for change, field in (
            ({'tool_name': 'probe.nope'}, 'tool_name'),
            ({'kind': 'delete'}, 'kind'),
            ({'result': 'maybe'}, 'result'),
            ({'tool_name': None}, 'tool_name'),
        ):
            response = self.api('POST', '/api/v1/ai/audit', {**READ, **change})
            self.assertEqual(response.status_code, 422, change)
            self.assertEqual(response.json()['error']['field'], field, change)

    def test_message_kind_rejects_a_tool_name(self):
        response = self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'tool_name': 'probe.list_things'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['error']['field'], 'tool_name')

    def test_draft_lifecycle_requires_attestation_to_approve(self):
        proposed = self.api('POST', '/api/v1/ai/audit', DRAFT)
        self.assertEqual(proposed.status_code, 200)
        unattested = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'name': 'A2'}})
        self.assertEqual(unattested.status_code, 422)
        self.assertEqual(unattested.json()['error']['field'], 'attested')
        approved = self.api('POST', '/api/v1/ai/audit', {**DRAFT, 'result': 'approved', 'approved': {'name': 'A2'}, 'attested': True})
        self.assertEqual(approved.status_code, 200)
        row = self.env['webvue.ai.audit'].browse(approved.json()['id'])
        self.assertTrue(row.attested_at)
        self.assertEqual((row.draft, row.approved), ({'name': 'A'}, {'name': 'A2'}))

    def test_approved_result_is_only_valid_for_drafts(self):
        response = self.api('POST', '/api/v1/ai/audit', {**READ, 'result': 'approved', 'attested': True})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['error']['field'], 'result')

    def test_users_see_only_their_own_rows(self):
        self.api('POST', '/api/v1/ai/audit', READ)
        mine = self.env['webvue.ai.audit'].with_user(self.employee).search([])
        theirs = self.env['webvue.ai.audit'].with_user(self.other).search([])
        self.assertEqual(len(mine), 1)
        self.assertFalse(theirs)

    def test_ai_disabled_blocks_writes(self):
        self._set_feature('ai.enabled', False)
        response = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['details'], {'reason': 'feature', 'feature': 'ai.enabled'})
        self.assertFalse(self.env['webvue.ai.audit'].search([]))
```

عدّل `odoo-addons/webvue_ai/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import common, test_ai_audit, test_ai_routes, test_feature_registry, test_tool_registry
```

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: FAIL، المسار 404 والنموذج غير موجود.

- [ ] **Step 3: اكتب النموذج والأمن**

`odoo-addons/webvue_ai/models/ai_audit.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.webvue_ai.models.tool_registry import TOOL_KINDS

AUDIT_KINDS = ('message', *TOOL_KINDS)
AUDIT_RESULTS = ('ok', 'denied', 'failed', 'proposed', 'approved', 'rejected')
DRAFT_RESULTS = ('proposed', 'approved', 'rejected')
SECRET_KEYS = ('password', 'token', 'api_key')


def scrub(value):
    """Drop secret-looking keys anywhere in a JSON value; everything else is kept verbatim."""
    if isinstance(value, dict):
        return {key: scrub(item) for key, item in value.items() if key not in SECRET_KEYS}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


class WebVueAiAudit(models.Model):
    """One row per AI message, tool execution or draft decision, owned by its user.

    Written by the Nuxt executor as the user (``/api/v1/ai/audit``); never
    elevated. Record rules keep each user on their own rows and the access
    audit readers on their company.
    """
    _name = 'webvue.ai.audit'
    _description = 'WebVue AI audit'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade',
                              default=lambda self: self.env.user)
    conversation_id = fields.Char(required=True, index=True)
    kind = fields.Selection([(kind, kind) for kind in AUDIT_KINDS], required=True, index=True)
    tool_name = fields.Char(index=True)
    input = fields.Json()
    result = fields.Selection([(result, result) for result in AUDIT_RESULTS], required=True, index=True)
    http_status = fields.Integer()
    draft = fields.Json()
    approved = fields.Json()
    attested_at = fields.Datetime()

    @api.model
    def _webvue_ai_validate_payload(self, values):
        """Validate the wire payload (contract ع4) and return create values; raises ``ValidationError`` with a field name."""
        def invalid(field, message):
            error = ValidationError(self.env._('%(message)s', message=message))
            error.webvue_field = field
            raise error

        conversation_id = values.get('conversation_id')
        if not isinstance(conversation_id, str) or not conversation_id or len(conversation_id) > 64:
            invalid('conversation_id', 'conversation_id must be a non-empty string of at most 64 characters')
        kind = values.get('kind')
        if kind not in AUDIT_KINDS:
            invalid('kind', f'kind must be one of {AUDIT_KINDS}')
        result = values.get('result')
        if result not in AUDIT_RESULTS:
            invalid('result', f'result must be one of {AUDIT_RESULTS}')
        tool_name = values.get('tool_name')
        if kind == 'message':
            if tool_name is not None:
                invalid('tool_name', 'a message audit has no tool_name')
            if result != 'ok':
                invalid('result', 'a message audit result is ok')
        else:
            tools = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
            if tool_name not in tools:
                invalid('tool_name', f'unknown tool {tool_name!r}')
            if tools[tool_name]['kind'] != kind:
                invalid('kind', f'tool {tool_name} is of kind {tools[tool_name]["kind"]}')
        if kind == 'draft' and result not in DRAFT_RESULTS:
            invalid('result', f'a draft result must be one of {DRAFT_RESULTS}')
        if kind != 'draft' and result in DRAFT_RESULTS:
            invalid('result', f'result {result} is only valid for a draft')
        attested = values.get('attested', False)
        if not isinstance(attested, bool):
            invalid('attested', 'attested must be a boolean')
        if result == 'approved' and not attested:
            invalid('attested', 'an approved draft needs the user attestation')
        if result == 'approved' and not isinstance(values.get('approved'), dict):
            invalid('approved', 'an approved draft carries the approved payload')
        http_status = values.get('http_status')
        if http_status is not None and (not isinstance(http_status, int) or isinstance(http_status, bool) or not 100 <= http_status <= 599):
            invalid('http_status', 'http_status must be an HTTP status code')
        for field in ('input', 'draft', 'approved'):
            if values.get(field) is not None and not isinstance(values[field], dict):
                invalid(field, f'{field} must be an object')
        return {
            'conversation_id': conversation_id,
            'kind': kind,
            'tool_name': tool_name,
            'input': scrub(values.get('input')),
            'result': result,
            'http_status': http_status,
            'draft': scrub(values.get('draft')),
            'approved': scrub(values.get('approved')),
            'attested_at': fields.Datetime.now() if attested else False,
        }

    @api.model
    def _webvue_ai_record(self, values):
        """Validate, enforce the monthly message limit, and create the row as the current user."""
        create_values = self._webvue_ai_validate_payload(values)
        entitlement = self.env['webvue.entitlement.service']
        if create_values['kind'] == 'message':
            entitlement.require_within_limit('ai.messages.monthly', self._webvue_ai_count_messages() + 1)
        return self.create(create_values)

    @api.model
    def _webvue_ai_month_start(self):
        now = datetime.now(timezone.utc)
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    @api.model
    def _webvue_ai_count_messages(self, company=None):
        """Message rows of ``company`` (default: current) since the start of this UTC month."""
        company = company or self.env.company
        return self.search_count([
            ('company_id', '=', company.id),
            ('kind', '=', 'message'),
            ('create_date', '>=', self._webvue_ai_month_start()),
        ])
```

`odoo-addons/webvue_ai/models/entitlement_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueAiEntitlementService(models.AbstractModel):
    _inherit = 'webvue.entitlement.service'

    @api.model
    def _webvue_count_usage(self, limit_key):
        if limit_key == 'ai.messages.monthly':
            return self.env['webvue.ai.audit']._webvue_ai_count_messages()
        return super()._webvue_count_usage(limit_key)
```

في `odoo-addons/webvue_ai/models/tool_registry.py` استبدل جسم `_webvue_ai_messages_used`:

```python
    @api.model
    def _webvue_ai_messages_used(self):
        """Messages recorded this UTC month for the current company."""
        return self.env['webvue.ai.audit']._webvue_ai_count_messages()
```

عدّل `odoo-addons/webvue_ai/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import ai_audit, entitlement_service, feature_registry, tool_registry
```

`odoo-addons/webvue_ai/security/ir.model.access.csv`:

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_ai_audit_employee,ai.audit employee,model_webvue_ai_audit,webvue_core.group_employee,1,0,1,0
access_ai_audit_reader,ai.audit reader,model_webvue_ai_audit,webvue_core.group_cap_access_audit_read,1,0,0,0
access_ai_audit_system,ai.audit system,model_webvue_ai_audit,base.group_system,1,0,0,0
```

`odoo-addons/webvue_ai/security/webvue_ai_rules.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="rule_ai_audit_own" model="ir.rule">
        <field name="name">AI audit: own rows in current companies</field>
        <field name="model_id" ref="model_webvue_ai_audit"/>
        <field name="domain_force">[('user_id', '=', user.id), ('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[Command.link(ref('webvue_core.group_employee'))]"/>
    </record>
    <record id="rule_ai_audit_company" model="ir.rule">
        <field name="name">AI audit: company rows for audit readers</field>
        <field name="model_id" ref="model_webvue_ai_audit"/>
        <field name="domain_force">[('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[Command.link(ref('webvue_core.group_cap_access_audit_read')), Command.link(ref('base.group_system'))]"/>
    </record>
</odoo>
```

- [ ] **Step 4: اكتب المسلسل والمسار**

`odoo-addons/webvue_ai/serializers/audit.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_audit_receipt(row, messages_used, messages_limit):
    return {'id': row.id, 'messages_used': messages_used, 'messages_limit': messages_limit}
```

في `odoo-addons/webvue_ai/controllers/ai.py` حدّث الاستيرادات وأضف المسار:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.webvue_ai.serializers.audit import dump_audit_receipt
from odoo.addons.webvue_ai.serializers.tool import dump_tool
from odoo.addons.webvue_api.controllers.common import ApiError, api_handler, requires_registered_feature

AI_FEATURE = 'ai.enabled'
AUDIT_FIELDS = {'conversation_id', 'kind', 'tool_name', 'input', 'result', 'http_status', 'draft', 'approved', 'attested'}


class AiController(http.Controller):

    @http.route('/api/v1/ai/tools', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='read', match='any',
    )
    def list_tools(self, **_):
        request.env['webvue.entitlement.service'].require_read(AI_FEATURE)
        registry = request.env['webvue.ai.tool.registry']
        items = [dump_tool(item) for item in registry._webvue_ai_tools_for_user()]
        return {'items': items, 'total': len(items), 'limits': registry._webvue_ai_limits()}

    @http.route('/api/v1/ai/audit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(
        'webvue.ai.tool.registry', '_webvue_ai_feature_keys',
        keys=('registry:webvue.ai.tool.registry',), operation='write', match='any',
    )
    def record_audit(self, **payload):
        request.env['webvue.entitlement.service'].require(AI_FEATURE)
        unknown = set(payload) - AUDIT_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        Audit = request.env['webvue.ai.audit']
        try:
            row = Audit._webvue_ai_record(payload)
        except ValidationError as error:
            field = getattr(error, 'webvue_field', None)
            if field is None:
                raise
            raise ApiError(422, 'invalid', str(error), field=field) from error
        entitlement = request.env['webvue.entitlement.service']
        return dump_audit_receipt(row, Audit._webvue_ai_count_messages(), entitlement._webvue_limit_value('ai.messages.monthly'))
```

- [ ] **Step 5: شغّل الاختبارات**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: PASS لكل اختبارات `webvue_ai`. ملاحظة: `test_tools_whose_feature_is_off_are_hidden`
يعتمد على أن `PROBE_FEATURE` هو المفتاح الوحيد المسجل؛ يبقى كذلك لأن `_install_probe`
تستبدل التعريفات كاملة.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_ai
git commit -m "feat(platform): record WebVue AI audit rows and the monthly message count"
```

---

### Task 5: الكتالوج والنسخ المشتقة وتوثيق التخطيط وسطح الـ API

**Files:**
- Create: `deploy/catalog/solutions/platform_v5.json`
- Modify: ما تعيد كتابته `--sync-release-copies` (قائمة `RELEASE_COPIES` في `tools/catalog_check.py`)
- Modify: `docs/agents/repository-layout.md`
- Modify: `docs/api/openapi.json` (مولَّد)

**Interfaces:**
- Produces: `webvue_ai` ضمن وحدات الإصدار (`python3 -B tools/catalog_check.py --release-modules`
  يطبعه)، وميزاته في طبقة واحدة.

- [ ] **Step 1: أنشئ مراجعة الكتالوج الجديدة**

انسخ `deploy/catalog/solutions/platform_v4.json` إلى `platform_v5.json` وعدّل:

```json
  "id": "platform_v5",
  "description": "WebVue AI release revision: adds the assistant tier; earlier catalog revisions remain unchanged.",
```

وأضف طبقة في نهاية `tiers`:

```json
    {
      "id": "assistant",
      "name_ar": "WebVue AI",
      "name_en": "WebVue AI",
      "modules": ["webvue_ai"],
      "features": [
        "boolean:ai.enabled",
        "limit:ai.messages.monthly",
        "limit:ai.tool_calls.per_run"
      ]
    }
```

(انسخ أسماء مفاتيح الطبقة كما تظهر في طبقات `platform_v4.json` الموجودة: لو كانت الطبقات
تستخدم `name` بدل `name_ar`/`name_en` فاتبع الموجود؛ `deploy/catalog/schema/solution.schema.json`
هو الحكم.)

- [ ] **Step 2: شغّل فحص الكتالوج وزامن النسخ**

Run:

```bash
python3 -B tools/catalog_check.py
python3 -B tools/catalog_check.py --sync-release-copies
python3 -B tools/catalog_check.py --release-modules
python3 -B -m unittest tools/test_managed_policy.py
```

Expected: الفحص يمر، آخر أمر يطبع قائمة تحوي `webvue_ai`، واختبار السياسة يمر. لو أبلغ
`catalog_check.py` أن حالة في `deploy/catalog/fixtures/release_features.json` تحتاج تحديثًا
فأضف حالة `v5_assistant_tier` بنفس بنية حالات `v4` مع الطبقة الجديدة ونتيجتها
المشتقة (`ai.enabled: true`، الحدان `null`).

- [ ] **Step 3: وثّق الأدون في تخطيط المستودع**

في `docs/agents/repository-layout.md` بعد فقرة `webvue_notify` أضف:

```markdown
- `odoo-addons/webvue_ai` (shared service, rank 3) owns the WebVue AI tool registry
  (`webvue.ai.tool.registry`, composed through `super()` by each application), the
  per-user audit log `webvue.ai.audit`, the `ai.*` features and limits, and the two
  routes `GET /api/v1/ai/tools` and `POST /api/v1/ai/audit`. It knows no application and
  holds no language-model code: the AI service and the Nuxt executor live outside Odoo
  (`docs/superpowers/specs/2026-10-15-webvue-ai-design.md`).
```

- [ ] **Step 4: جدّد سطح الـ API**

Run: `python3 tools/api_surface.py && python3 tools/api_surface.py --check`
Expected: الأمر الثاني يخرج 0 و`docs/api/openapi.json` يحوي `/api/v1/ai/tools` و`/api/v1/ai/audit`.

- [ ] **Step 5: أعد تشغيل اختبار الأدون كاملًا**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai --no-dependents`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add deploy/catalog docs/agents/repository-layout.md docs/api/openapi.json $(git status --short | awk '{print $2}' | grep -v '^odoo-addons/')
git commit -m "chore(platform): register webvue_ai in the release catalog and API surface"
```

---

### Task 6: أدوات PMO الست في `webvue_pmo`

**Files:**
- Create: `odoo-addons/webvue_pmo/models/ai_tools.py`
- Modify: `odoo-addons/webvue_pmo/models/__init__.py`
- Modify: `odoo-addons/webvue_pmo/__manifest__.py` (`depends` و`version`)
- Create: `odoo-addons/webvue_pmo/migrations/19.0.1.5.1/README.md`
- Create: `odoo-addons/webvue_pmo/tests/test_ai_tools.py`
- Modify: `odoo-addons/webvue_pmo/tests/__init__.py`

**Interfaces:**
- Consumes: `webvue.ai.tool.registry._webvue_ai_tool_definitions`؛ القدرات
  `pmo.tasks.read`، `pmo.projects.read`، `pmo.tasks.write`، `pmo.projects.create`؛ المسارات
  القائمة `GET /api/v1/tasks`، `GET /api/v1/projects`، `GET /api/v1/projects/{project_id}`،
  `GET /api/v1/projects/{project_id}/finance/summary`، `POST /api/v1/tasks/{task_id}/transition`.
- Produces: الأدوات `pmo.list_my_tasks`، `pmo.list_projects`، `pmo.get_project`،
  `pmo.get_project_finance_summary`، `pmo.update_task_state`، `pmo.draft_project` بشكل ع1 وع5.

- [ ] **Step 1: اكتب الاختبار الفاشل**

`odoo-addons/webvue_pmo/tests/test_ai_tools.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_pmo.tests.common import WebVuePmoCase

PMO_TOOLS = (
    'pmo.list_my_tasks', 'pmo.list_projects', 'pmo.get_project',
    'pmo.get_project_finance_summary', 'pmo.update_task_state', 'pmo.draft_project',
)


@tagged('post_install', '-at_install', 'webvue')
class TestPmoAiTools(WebVuePmoCase):

    def test_pmo_declares_its_six_tools_over_existing_routes(self):
        tools = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()
        self.assertTrue(set(PMO_TOOLS) <= set(tools))
        routing = {
            (rule.rule, method)
            for rule in self.env['ir.http'].routing_map().iter_rules()
            for method in (rule.methods or ())
        }
        for name in PMO_TOOLS:
            tool = tools[name]
            self.assertEqual(tool['owner'], 'webvue_pmo', name)
            self.assertEqual(tool['feature_key'], 'pmo.enabled', name)
            if tool['kind'] == 'draft':
                continue
            path = tool['route']['path']
            for placeholder in ('project_id', 'task_id'):
                path = path.replace('{%s}' % placeholder, '<int:%s>' % placeholder)
            self.assertIn((path, tool['route']['method']), routing, name)

    def test_employee_sees_read_and_task_state_tools_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()
        names = {item['name'] for item in body['items']}
        self.assertEqual(names & set(PMO_TOOLS), {
            'pmo.list_my_tasks', 'pmo.list_projects', 'pmo.get_project',
            'pmo.get_project_finance_summary', 'pmo.update_task_state',
        })

    def test_manager_sees_the_project_draft_tool(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()
        draft = next(item for item in body['items'] if item['name'] == 'pmo.draft_project')
        self.assertEqual(draft['kind'], 'draft')
        self.assertEqual(draft['draft_target'], '/projects/new')
        self.assertIsNone(draft['route'])
        self.assertEqual(draft['input_schema']['required'], ['name'])

    def test_list_my_tasks_tool_maps_onto_the_mine_filter(self):
        tool = self.env['webvue.ai.tool.registry']._webvue_ai_tool_map()['pmo.list_my_tasks']
        self.assertEqual(tool['input_map']['query']['filter'], 'mine')
        self.assertEqual(tool['route'], {'method': 'GET', 'path': '/api/v1/tasks'})
        self.assertIn('items[].is_overdue', tool['result_summary'])

    def test_a_user_outside_the_employee_role_sees_no_pmo_tools(self):
        new_test_user(self.env, login='api_guest', password='api_guest_pass_123', name='Ghada', groups='base.group_user')
        self.authenticate('api_guest', 'api_guest_pass_123')
        response = self.api('GET', '/api/v1/ai/tools')
        if response.status_code == 200:
            self.assertFalse({item['name'] for item in response.json()['items']} & set(PMO_TOOLS))
        else:
            self.assertEqual(response.status_code, 403)
```

أضف `test_ai_tools,` إلى قائمة `odoo-addons/webvue_pmo/tests/__init__.py` في موضعها الأبجدي
(بعد `test_access_capabilities,`).

- [ ] **Step 2: شغّل للتأكد من الفشل**

Run: `python3 -B tools/odoo_test.py --addons webvue_pmo --no-dependents`
Expected: FAIL، `KeyError` على أسماء الأدوات.

- [ ] **Step 3: أعلن الأدوات وحدّث المانيفست**

`odoo-addons/webvue_pmo/models/ai_tools.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""webvue_pmo's WebVue AI tools: named tools over the PMO routes, each with the capability its route checks.

Numbers are computed by the routes, never by the model: the finance summary
tool returns the server-side totals as they are. The draft tool writes nothing;
it only shapes the payload the create page opens with (master plan contract ع5).
"""
from odoo import api, models

# The API names of project.task states (serializers/task.py STATE_TO_API).
TASK_STATES = ['in_progress', 'changes_requested', 'approved', 'waiting', 'done', 'cancelled']
PAGE = {'type': 'integer', 'minimum': 1, 'maximum': 50}
TEXT = {'type': 'string', 'maxLength': 4000}
DATE = {'type': 'string', 'pattern': r'^\d{4}-\d{2}-\d{2}$'}


def _tool(name, kind, capability, description_ar, description_en, **extra):
    return {
        'name': name, 'owner': 'webvue_pmo', 'kind': kind, 'capability': capability,
        'feature_key': 'pmo.enabled', 'description_ar': description_ar, 'description_en': description_en,
        **extra,
    }


PMO_AI_TOOLS = (
    _tool(
        'pmo.list_my_tasks', 'read', 'pmo.tasks.read',
        'يعرض مهام المستخدم الحالي مع حالتها ومواعيدها وهل هي متأخرة',
        "List the current user's tasks with state, deadline and overdue flag",
        route={'method': 'GET', 'path': '/api/v1/tasks'},
        input_schema={
            'type': 'object',
            'properties': {'state': {'type': 'string', 'enum': TASK_STATES}, 'limit': PAGE},
            'additionalProperties': False,
        },
        input_map={'query': {'filter': 'mine', 'state': '$state', 'limit': '$limit'}},
        result_summary=['items[].id', 'items[].name', 'items[].state', 'items[].date_deadline',
                        'items[].is_overdue', 'items[].priority', 'items[].project.id', 'items[].project.name', 'total'],
    ),
    _tool(
        'pmo.list_projects', 'read', 'pmo.projects.read',
        'يعرض المشاريع التي يراها المستخدم مع حالتها ونسبة إنجازها',
        'List the projects visible to the user with status and progress',
        route={'method': 'GET', 'path': '/api/v1/projects'},
        input_schema={
            'type': 'object',
            'properties': {'q': {'type': 'string', 'maxLength': 120}, 'limit': PAGE},
            'additionalProperties': False,
        },
        input_map={'query': {'q': '$q', 'limit': '$limit'}},
        result_summary=['items[].id', 'items[].name', 'items[].status', 'items[].progress',
                        'items[].date_end', 'items[].manager.name', 'items[].task_count', 'total'],
    ),
    _tool(
        'pmo.get_project', 'read', 'pmo.projects.read',
        'يعرض تفاصيل مشروع واحد وميثاقه',
        'Show one project with its charter',
        route={'method': 'GET', 'path': '/api/v1/projects/{project_id}'},
        input_schema={
            'type': 'object',
            'properties': {'project_id': {'type': 'integer', 'minimum': 1}},
            'required': ['project_id'],
            'additionalProperties': False,
        },
        input_map={'path': {'project_id': '$project_id'}},
        result_summary=['id', 'name', 'status', 'progress', 'date_start', 'date_end', 'manager.name',
                        'task_count', 'closed_task_count', 'milestone_count', 'charter.code',
                        'charter.rationale', 'charter.objectives[]', 'charter.scope', 'charter.success'],
    ),
    _tool(
        'pmo.get_project_finance_summary', 'read', 'pmo.projects.read',
        'يعرض الميزانية والمصروف والمتبقي لمشروع واحد كما يحسبها النظام',
        'Show one project\'s budget, spent and remaining as computed by the server',
        route={'method': 'GET', 'path': '/api/v1/projects/{project_id}/finance/summary'},
        input_schema={
            'type': 'object',
            'properties': {'project_id': {'type': 'integer', 'minimum': 1}},
            'required': ['project_id'],
            'additionalProperties': False,
        },
        input_map={'path': {'project_id': '$project_id'}},
        result_summary=['planned', 'actual', 'remaining', 'utilization_percent', 'over_budget',
                        'budget_count', 'currency.name', 'currency.symbol'],
    ),
    _tool(
        'pmo.update_task_state', 'write_light', 'pmo.tasks.write',
        'ينقل مهمة إلى حالة أخرى بعد تأكيد المستخدم',
        'Move a task to another state after the user confirms',
        route={'method': 'POST', 'path': '/api/v1/tasks/{task_id}/transition'},
        input_schema={
            'type': 'object',
            'properties': {'task_id': {'type': 'integer', 'minimum': 1}, 'state': {'type': 'string', 'enum': TASK_STATES}},
            'required': ['task_id', 'state'],
            'additionalProperties': False,
        },
        input_map={'path': {'task_id': '$task_id'}, 'body': {'state': '$state'}},
        result_summary=['id', 'name', 'state', 'allowed_transitions[]'],
    ),
    _tool(
        'pmo.draft_project', 'draft', 'pmo.projects.create',
        'يجهّز مسودة مشروع تُفتح في صفحة الإنشاء الحقيقية؛ المستخدم يراجع ويرسل بنفسه',
        'Prepare a project draft that opens in the real create page; the user reviews and submits',
        draft_target='/projects/new',
        input_schema={
            'type': 'object',
            'properties': {
                'name': {'type': 'string', 'minLength': 1, 'maxLength': 255},
                'description': TEXT,
                'date_start': DATE,
                'date_end': DATE,
                'charter': {
                    'type': 'object',
                    'properties': {
                        'rationale': TEXT,
                        'objectives': {'type': 'array', 'items': {'type': 'string', 'maxLength': 500}, 'maxItems': 10},
                        'scope': TEXT, 'exclusions': TEXT, 'success': TEXT, 'assumptions': TEXT, 'constraints': TEXT,
                    },
                    'additionalProperties': False,
                },
            },
            'required': ['name'],
            'additionalProperties': False,
        },
    ),
)


class WebVuePmoAiTools(models.AbstractModel):
    _inherit = 'webvue.ai.tool.registry'

    @api.model
    def _webvue_ai_tool_definitions(self):
        return super()._webvue_ai_tool_definitions() + PMO_AI_TOOLS
```

مفاتيح `result_summary` أعلاه مأخوذة من المسلسلات الحقيقية وقت كتابة الخطة:
`build_finance_summary` في `serializers/project_finance.py` يعيد `planned` و`actual` و`remaining`
و`utilization_percent` و`over_budget` و`budget_count` و`currency`؛ `dump_project` يعيد `status`
و`progress` و`date_end` و`manager` و`task_count`؛ `dump_task` يعيد `is_overdue` و`priority`
و`project`؛ `dump_charter` يعيد `code` و`rationale` و`objectives` و`scope` و`success`. لو تغيّر
مسلسل بعد كتابة الخطة فالمسلسل هو المرجع، ويُعدَّل `result_summary` ليطابقه.

أضف `ai_tools,` إلى `odoo-addons/webvue_pmo/models/__init__.py` في موضعه الأبجدي.

في `odoo-addons/webvue_pmo/__manifest__.py`:

```python
    'version': '19.0.1.5.1',
```

و`depends`:

```python
    'depends': [
        'webvue_api', 'webvue_platform', 'webvue_directory', 'webvue_notify', 'webvue_ai',
        'project', 'mail', 'bus',
    ],
```

`odoo-addons/webvue_pmo/migrations/19.0.1.5.1/README.md`:

```markdown
No data migration: 19.0.1.5.1 adds the `webvue_ai` dependency (PMO declares its WebVue AI
tools in `webvue.ai.tool.registry`). Upgrading `webvue_pmo` installs `webvue_ai` in the same run.
```

- [ ] **Step 4: شغّل اختبارات PMO والـ AI**

Run: `python3 -B tools/odoo_test.py --addons webvue_pmo,webvue_ai --no-dependents`
Expected: PASS، بما فيها `test_feature_route_coverage` و`test_api_surface` القائمة.

- [ ] **Step 5: حدّث سطح الـ API مرة أخرى وفحص الهجرة**

Run:

```bash
python3 tools/api_surface.py --check
python3 -B tools/migration_guard.py --base main
```

Expected: كلاهما 0 (لا مسارات جديدة في هذه المهمة، وملف الهجرة موجود).

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_pmo
git commit -m "feat(pmo): declare the six PMO tools in the WebVue AI registry"
```

---

### Task 7: البوابات الكاملة قبل التسليم

**Files:** لا ملفات جديدة.

- [ ] **Step 1: فحوص السياسة والجودة**

Run:

```bash
ruff check odoo-addons/webvue_ai odoo-addons/webvue_pmo
python3 -B tools/arch_policy.py --base main
python3 -B tools/git_policy.py --base main
python3 -B tools/catalog_check.py
```

Expected: الأربعة تمر. `arch_policy` لا يُظهر أي عدّ جديد لـ R7 (لا `sudo()` في `webvue_ai`).

- [ ] **Step 2: الاختبارات الكاملة للطبقة**

Run: `python3 -B tools/odoo_test.py --addons webvue_ai,webvue_pmo`
Expected: PASS مع المعتمِدين على `webvue_pmo` (الجسور).

- [ ] **Step 3: اختبار يدوي على قاعدة السكراتش**

```bash
export PYTHONDONTWRITEBYTECODE=1
WT=/Users/tariq/code/nasq/.worktrees/platform-ai-assistant
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c "$WT/.scratch/scratch.conf" \
  --addons-path="odoo/addons,addons,$WT/odoo-addons" \
  -d webvue_scratch_platform_ai_assistant --db-filter='^webvue_scratch_platform_ai_assistant$' \
  --data-dir="$WT/.scratch/data" --logfile="$WT/.scratch/logs/upgrade.log" \
  -i webvue_ai -u webvue_pmo --http-port=8174 --workers=0 --max-cron-threads=0 --stop-after-init
```

ثم شغّل أودو بلا `--stop-after-init` على 8174، سجّل الدخول بمستخدم المدير التجريبي عبر
`/web/session/authenticate`، ونادِ `GET /api/v1/ai/tools` بالكوكي. Expected: ست أدوات
و`limits`. أوقف أودو بعدها.

- [ ] **Step 4: التقرير**

اكتب في رد التسليم: الملفات المتغيرة، مخرجات الأوامر أعلاه، وأي انحراف عن الخطة (مثل
أسماء حقول ملخص المالية الحقيقية).
