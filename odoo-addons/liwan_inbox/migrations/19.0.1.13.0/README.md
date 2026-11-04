`liwan.inbox.channel.verify_token` (plain text) became `verify_token_enc`: the post-migration encrypts every stored
token with the channel secrets key and drops the old column. A channel without a stored token gets a new one the
next time it is rotated; nothing else reads the value.
