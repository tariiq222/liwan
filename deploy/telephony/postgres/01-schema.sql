-- Asterisk 22 PJSIP realtime tables for one company's telephony package (pbx-db / telephony_pbx).
-- Loaded once by Postgres on fresh volume initialization (/docker-entrypoint-initdb.d/01-schema.sql).
-- Yes/no columns use VARCHAR(8) rather than PostgreSQL enums so Asterisk res_config_pgsql writes
-- 'yes'/'no' cleanly without custom type coupling. ps_endpoints.auth is VARCHAR(200) to hold
-- comma-separated overlap auth IDs during per-session password rotation.

CREATE TABLE IF NOT EXISTS ps_aors (
    id VARCHAR(80) PRIMARY KEY,
    max_contacts INTEGER,
    remove_existing VARCHAR(8),
    default_expiration INTEGER,
    maximum_expiration INTEGER,
    minimum_expiration INTEGER,
    contact VARCHAR(255),
    qualify_frequency INTEGER
);

CREATE TABLE IF NOT EXISTS ps_auths (
    id VARCHAR(80) PRIMARY KEY,
    auth_type VARCHAR(40),
    username VARCHAR(80),
    password VARCHAR(128),
    realm VARCHAR(80),
    nonce_lifetime INTEGER
);

CREATE TABLE IF NOT EXISTS ps_endpoints (
    id VARCHAR(80) PRIMARY KEY,
    transport VARCHAR(64),
    aors VARCHAR(200),
    auth VARCHAR(200),
    context VARCHAR(64),
    disallow VARCHAR(200),
    allow VARCHAR(200),
    direct_media VARCHAR(8),
    rtp_symmetric VARCHAR(8),
    force_rport VARCHAR(8),
    rewrite_contact VARCHAR(8),
    webrtc VARCHAR(8),
    dtls_auto_generate_cert VARCHAR(8),
    ice_support VARCHAR(8),
    media_encryption VARCHAR(40),
    use_avpf VARCHAR(8),
    media_use_received_transport VARCHAR(8),
    rtcp_mux VARCHAR(8),
    dtmf_mode VARCHAR(40),
    device_state_busy_at INTEGER,
    allow_transfer VARCHAR(8),
    from_user VARCHAR(80),
    from_domain VARCHAR(255),
    callerid VARCHAR(128),
    identify_by VARCHAR(80)
);
