`liwan.inbox.channel.verify_token` (plain text) became `verify_token_enc`: the post-migration encrypts every stored
token with the channel secrets key and drops the old column. A channel without a stored token gets a new one the
next time it is rotated; nothing else reads the value.

Messages gain the boolean `unconfirmed` (default false, no data change): the send may have reached the provider even
though no answer arrived. A new channel starts without a handshake token until the administrator generates one.
