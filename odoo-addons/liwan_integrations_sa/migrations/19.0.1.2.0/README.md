# 19.0.1.2.0

No data migration. This version adds new tables only (`liwan.integration.sender`,
`liwan.integration.settings`, `liwan.integration.message`) and two crons (send queued messages, purge
messages older than 24 months), the `integrations.log.read` capability and its group, and the
Twilio provider definition. No existing column, row or secret changes shape, so the module
upgrade creates everything from the model and data files.
