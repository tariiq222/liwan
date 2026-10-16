# Provenance

- Upstream: https://github.com/rezachidotnet/meeting_minutes-odoo
- Pin: `3a549ffe5ce6a92daa318810bce5e199f7c5c24b`
- Upstream version: `19.0.1.3.0` (author Cyan, license LGPL-3)
- This tree: `19.0.1.3.1` — WebVue privacy/lock/calendar hardening of that vendor module
- No LICENSE file was shipped upstream. Manifest declares `license: LGPL-3` and author Cyan. That is the declared identifier only, not a legal opinion or guarantee.
- WebVue did not author the original module. New tests, `secretary_id`, record rules, write guards, Arabic `i18n/ar.po`, and this file are WebVue changes.
- `project.task` is not linked. A future adapter would go through `webvue_pmo` only.

Sudo exceptions (READ only):

- `group_meeting_manager.sudo().user_ids` to list company managers for follower allow-lists.
- Calendar link existence `Meeting.sudo().search` then `with_env(user)` before any write.

Participant comments use stock `_mail_post_access = 'read'`. There is no `message_post` sudo.

XML `user_admin` auto-grant was removed from this tree. That applies on **fresh install**. An upgraded database that already stored `group_meeting_manager` on admin is not rewritten. No migration.

This addon is not a claim that the product is secure. Independent review is required before acceptance. Cleanup of `cyh7a` / scratch DBs waits for FLOW; keep `W/odoo-addons/cyan_meeting_minutes`.
