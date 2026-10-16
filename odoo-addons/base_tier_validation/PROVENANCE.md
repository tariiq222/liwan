# Imported engine provenance

WebVue imports the modified OCA `base_tier_validation` 19.0.1.4.7 candidate from the read-only local Eradah distribution at `/Users/tariq/code/eradah/.work/oca-tier19-fixed-20261013/candidate/base_tier_validation` on 2026-10-14. Upstream repository: https://github.com/OCA/tier-validation. Original copyright, contributors, AGPL-3 license declaration, translations and source tests remain included. WebVue adaptations replace elevated review CRUD with caller-authorized CRUD and private identity tokens, use a global origin-following rule with live ORM subqueries, remove elevated metadata/notification access, and capture prior computed state through ORM instead of SQL. Public/portal approval ACLs are removed. Optional chatter requires ordinary caller write permission. Privileged server-action companion addons are not imported.

The upstream reminder scheduler ships inactive and explicitly uses the ordinary administrator account. Activating reminders requires an authorized recipient-aware notification setup; the operations queue and audit remain available. JSON context `skip_check_state_condition` no longer changes eligible origin states.

Imported README formatting strips trailing whitespace and lengthens the Credits underline to avoid Git conflict-marker detection; source content and attribution are unchanged.
