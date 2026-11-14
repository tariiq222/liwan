`liwan.inbox.channel.verify_token` (plain text) became `verify_token_enc`. The post script that encrypted the stored
tokens is gone: 19.0.1.23.0 (`pre-move-accounts-to-connections.py`) moves every channel's account and secrets to a
connection of the integrations service and supersedes this step. That script reads the 19.0.1.22.0 schema only and
refuses an older database: such a database is upgraded with a checkout that ships 19.0.1.22.0 first, or recreated.

Messages gain the boolean `unconfirmed` (default false, no data change): the send may have reached the provider even
though no answer arrived.
