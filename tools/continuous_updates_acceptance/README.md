# Local continuous-update acceptance

These opt-in drivers use separately prepared scratch resources only. Preserve
reports, failed receipts and private runtime configuration. No driver authorizes
Git integration, production deployment or deletion.

- `python3 -m tools.continuous_updates_acceptance.run --config /absolute/operator.json --output /absolute/new-report.json` observes ten live tenant paths while running the ordinary release engine for one target. It checks every acknowledged task by reading it back. Source-process evidence explicitly excludes Docker images and cron. Its prepared config requires actual process/config/source hashes, an actor id and existing private session files for every tenant.
- `postgres_scratch.py` exercises PostgreSQL infrastructure fencing and scratch restoration with the owning local fixture. Inspect its explicit fixture prerequisites before use.
- `docker_odoo.py --source-root /absolute/task-tree --output /absolute/new/docker-odoo-review-name` uses a verified cached base to build an exact-source acceptance overlay, restores into an absent fixed scratch database, and observes HTTP, shared sessions, attachments, role fencing and one cron worker. It refuses existing resources. It is a machine-specific preserved experiment, not a general provisioner or full Dockerfile acceptance. `--observe-existing` is read-only apart from updating the evidence report.

The implementation and dated evidence are described in
`docs/verification/2026-10-16-continuous-updates.html`. Local reports and secrets
remain in ignored `.superpowers/continuous-updates` directories; the public review
report lists only safe evidence paths and outcomes.

The cached base image id is an inspected fact. The final overlay additionally
checks that its filesystem layers start with the inspected base layers and the
stock-commit label matches. This proves filesystem ancestry, not every inherited
base Config/image-id property. It remains a narrow acceptance overlay. A local
RepoDigest can be inspected yet unavailable to BuildKit's registry resolver; the
preserved build uses the cached tag and refuses changed base/layer observations.
