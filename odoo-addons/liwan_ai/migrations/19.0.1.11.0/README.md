19.0.1.11.0 adds the technical usage recorder account (`liwan_ai.user_ai_usage`), its group, ACL rows and rule, all
created by the module's own `noupdate` data file when the module is updated; it changes no existing table or row, so
nothing needs migrating. The account's credential is never created by a migration (since 19.0.1.16.0 it is a bearer derived from the deployment's `LIWAN_AI_USAGE_KEY`).
