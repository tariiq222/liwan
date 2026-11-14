`liwan.inbox.channel.verify_token` (plain text) became `verify_token_enc`. The post script that encrypted the stored
tokens is gone: 19.0.1.23.0 (`pre-move-accounts-to-connections.py`) moves every channel's account and secrets to a
connection of the integrations service and supersedes this step. That script carries every version from 19.0.1.13.0
on forward and refuses only a database older than it, which still holds the token in plain text: such a database is
upgraded with a checkout that ships this version first, or recreated.

Messages gain the boolean `unconfirmed` (default false, no data change): the send may have reached the provider even
though no answer arrived.
