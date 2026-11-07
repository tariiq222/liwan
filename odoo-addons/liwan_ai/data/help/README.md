# LiwanOS user guide (draft for the owner's review)

This guide is a **draft**. The help agent (`mode=help`, spec 2026-11-04 section 6.13) answers how-to questions from it and
from nothing else, so every sentence here is something the assistant may repeat to a customer. The owner reviews the
Arabic text before a release; the English files are shorter translations of their Arabic originals.

## Layout

`ar/<section>.md` is the original, `en/<section>.md` its shorter English version (a section may exist in Arabic only). One
file per application section of the product. The files ship with the addon directory (the Odoo image copies `odoo-addons`
whole), and `models/help_guide.py` reads them at runtime with `odoo.tools.file_path`; nothing is listed in the manifest.
A change to a file takes effect when Odoo restarts.

## File format

```
# <section title>
pages: <page names the section answers for, separated by spaces>

## <task, as a user would ask it>
page: </route that does the task>
1. <step that names the real button, tab or field label>
2. ...
```

- `pages:` holds the rail module id (`projects`, `hr`, ...) and the record kind where one exists (`project`). The assistant
  passes the page the user asks from, and those sections rank first.
- `page:` is one real route of `apps/web/app/pages`. The assistant shows it as the link of the section.
- Steps are numbered, short, and use the labels of `apps/web/i18n/locales/ar` exactly (in guillemets). A step that is not
  certain is left out rather than guessed. Do not describe a feature the product does not have.
- Keep each section under about 1,500 characters: the search returns it whole.

## Checks

`odoo-addons/liwan_ai/tests/test_ai_help.py` requires, for every shipped file, a title, `pages:`, and for every section a
well-formed `page:` and numbered steps starting at 1.
