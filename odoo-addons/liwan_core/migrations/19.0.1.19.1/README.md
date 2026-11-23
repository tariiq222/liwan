# 19.0.1.19.1 — stored secrets are bound to the database uuid

`secret_box` derives its key from the stock `database.uuid` parameter instead of the database name, so a restore under a new name keeps its secrets. Ciphertext stored under the old derivation is not carried forward: no data is migrated, and the keys and connections that held it are entered again (development databases only, no live tenant exists).
