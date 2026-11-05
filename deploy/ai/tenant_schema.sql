-- Gives the LiwanOS AI role its own schema inside one tenant database, and nothing in public.
--
-- Run as the PostgreSQL superuser against database `postgres`, once per tenant database:
--   psql -v ON_ERROR_STOP=1 -v tenant_db=<tenant db> -f ai/tenant_schema.sql
-- deploy/provision.sh applies it to every tenant database, and the operator's tenant.create applies it
-- when the inventory entry names `ai_python`. The service's own operator bootstrap then creates the
-- tables inside schema liwan_ai.
--
-- Idempotent: every statement can be applied again to the same database. The whole script is a no-op
-- when role liwan_ai does not exist (a deployment without AI). Odoo keeps schema public for itself;
-- only the AI role loses it, so AI state can never read an Odoo table.
\set ON_ERROR_STOP on

SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'tenant_db')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO liwan_ai', :'tenant_db')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec

\connect :"tenant_db"

SELECT 'CREATE SCHEMA IF NOT EXISTS liwan_ai AUTHORIZATION liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
-- pgcrypto encrypts the tenant's own provider key (AI service tenant_config.py); its functions live in the AI
-- schema, so the AI role reaches them through its search_path and Odoo's schema gains nothing.
SELECT 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
