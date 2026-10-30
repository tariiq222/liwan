# OCA DMS provenance

Repository: https://github.com/OCA/dms
Branch: `19.0`; immutable commit: `42aec9613f64402ec702e8e21cfb643626a41056`.
Module: `dms`, version `19.0.1.1.3`. The source stays outside LiwanOS and is fetched by
`tools/oca_addons.py`; `deploy/oca-addons.json` owns the runtime pin. No vendor edits.

The module manifest declares LGPL-3. These six files carry AGPL-3.0-or-later headers:

- `dms/models/abstract_dms_mixin.py`
- `dms/migrations/19.0.1.1.0/post-migration.py`
- `dms/wizards/wizard_dms_file_move.py`
- `dms/wizards/wizard_dms_file_move_views.xml`
- `dms/wizards/wizard_dms_share.py`
- `dms/static/src/js/views/search_panel.esm.js`

These are source facts, without reinterpreting their legal effect. The existing owner
acceptance of unmodified OCA AGPL dependencies is recorded in `docs/oca-addons.md`.

DMS internally uses elevated access in its linked-record discovery, directory creation,
portal and attachment handlers. LiwanOS must enforce its policy at the linked business
record and binary stream and must not treat a vendor token or elevated environment as
customer authorization. A dependency pin is not security acceptance.


Execution characterization: in attachment mode the pinned public file create path
removes `content` before its inverse populates `size`/`checksum`. LiwanOS fills those
existing DMS metadata fields from the unchanged attachment after public create. The
10 MiB acceptance assertion caught the original zero size; vendor source stays intact.
