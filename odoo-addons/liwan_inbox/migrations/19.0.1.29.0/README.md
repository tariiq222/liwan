# 19.0.1.29.0

The `inbox.tiktok` feature key is retired: TikTok follows `inbox.enabled`, and `inbox.tiktok` stays only as the integration
usage key of a TikTok connection. `pre-remove-inbox-tiktok-feature.py` removes the key from the tenant profile's `features`,
`post_trial_features` and `retained_read_features` before the registry validates them.
