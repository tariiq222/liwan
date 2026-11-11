-- the tenant's Paymob keys live encrypted in these columns; stock's neutralize.sql only empties its own plain ones
UPDATE payment_provider
    SET liwan_paymob_secret_key_enc = NULL,
        liwan_paymob_hmac_key_enc = NULL,
        liwan_paymob_api_key_enc = NULL;
