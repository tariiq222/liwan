No data change. The channel gains the nullable TikTok columns (`tiktok_business_id`, `tiktok_username`,
`refresh_token_enc`, `token_expires_at`, `refresh_expires_at`, `tiktok_welcome_id`, `tiktok_welcome_audit`,
`tiktok_bound`), `kind` gains the `tiktok` value and `phone_number_id`/`business_account_id` stop being
required because a TikTok channel has neither. Every existing channel keeps its kind and its provider ids.
