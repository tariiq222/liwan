# Working on two pillars at once

One rule: **a pillar never edits another pillar's files, nor the other's
locale or contract namespace.** Shared plumbing is the only thing both teams
read, and it changes rarely and deliberately.

## Who owns what

| Area | Shared (`nasq_api` / `common`) | PMO pillar | HR pillar |
|---|---|---|---|
| Odoo addon | `nasq_api` (+ `nasq_core` for groups/branding) | `nasq_pmo` | `nasq_hr` |
| Controllers | `controllers/common.py`, `auth.py`, `branding.py`, `me.py` | `nasq_pmo/controllers/*` | `nasq_hr/controllers/*` |
| Serializers | `serializers/common.py` (`iso`), `company.py`, `user.py` | `nasq_pmo/serializers/*` | `nasq_hr/serializers/*` |
| Tests | `nasq_api/tests/common.py` (`NasqApiCase`) + its own tests | `nasq_pmo/tests/*` (`NasqPmoCase`) | `nasq_hr/tests/*` |
| Messages | `i18n/locales/{ar,en}/common.json` | `…/{tasks,projects,settings}.json` | `…/hr.json` |
| Contracts | `packages/contracts/src/common/` | `src/pmo/` | `src/hr/` |
| Web pages/components | `app/components/ui/*`, layout, `useApi`/`useMe`/`useBranding` | task pages & components | people/employee pages |

## Adding to your pillar

- **An endpoint**: a file under `<addon>/controllers/`, one line in that
  addon's `controllers/__init__.py`. Import helpers from
  `odoo.addons.nasq_api.controllers.common`; never from another pillar.
- **A test fixture record**: put it on your pillar's own `tests/common.py`
  case (`NasqPmoCase`), not on the shared `NasqApiCase`.
- **A message**: your namespace file only. Key paths are flat after the
  merge, so `hr.json` holds `{"hr": {...}}` and `$t('hr.…')` resolves.
- **A schema**: a file under `src/<pillar>/`, one line in that pillar's
  `index.ts`.

## The four files both teams still touch

Keep changes to these to a single added line, and rebase early:

1. `packages/contracts/src/index.ts` — one `export * from './<pillar>'`.
2. `apps/web/nuxt.config.ts` — one entry per locale in `i18n.locales[].files`.
3. `apps/web/app/composables/useNav.ts` — the pillar's nav entry.
4. `deploy/provision.sh`'s `-i` list — a new pillar must be added there
   explicitly, since pillars depend on `nasq_api` and not the other way
   round; nothing else pulls it in.

A pillar's nav label key is the one deliberate exception to the "your
namespace only" rule: it lives under `nav.*` in the shared
`i18n/locales/{ar,en}/common.json`, alongside the entry it adds in
`useNav.ts`. `nav.settings` (the الإعدادات sidebar entry, PMO's
`/settings/projects`) is the concrete instance of this exception so far.

`/api/v1/people` lives in `nasq_pmo`, not the HR pillar — it feeds the
assignee picker, so PMO owns it even though "people" sounds like HR's.

Run the Odoo suite installed from scratch (`-i`, see the README's Tests
section), not `-u`: a manifest dependency you forgot to declare then fails
loudly instead of riding on the other pillar's.
