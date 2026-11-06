# 19.0.1.7.0

No data migration. This version adds the AI settings column `knowledge_enabled` (default false, which Odoo fills on
update), the knowledge cursor model, and the technical indexer user and group with their cron; nothing existing changes.
The queue the indexer writes lives in the AI service's schema `liwan_ai`, created by its tenant bootstrap.
