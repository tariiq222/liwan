# 19.0.1.26.0

Agent availability and shifts. New model `liwan.inbox.agent`, new column `agent_id` on `liwan.inbox.hours.range`, and the
settings fields `agent_shifts_enabled` (default off) and `unavailable_release` (default `keep`). No existing row changes
and no data needs carrying. Odoo drops and re-adds the range owner check on update (`odoo/orm/table_objects.py:109-122`) so
that it accepts the new third owner; every existing range still has exactly one owner.
