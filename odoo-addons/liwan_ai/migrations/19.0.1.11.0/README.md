19.0.1.11.0 adds the technical usage recorder account (`liwan_ai.user_ai_usage`), its group, ACL rows and rule, all
created by the module's own `noupdate` data file when the module is updated; it changes no existing table or row, so
nothing needs migrating. The API key for the account is minted per deployment by `deploy/seed_ai_usage_key.py`, never by a migration.
