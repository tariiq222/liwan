-- Gives the LiwanOS AI role its own schema inside one tenant database, and nothing in public.
--
-- Run as the PostgreSQL admin role (postgres) against database `postgres`, once per tenant database:
--   psql -v ON_ERROR_STOP=1 -v tenant_db=<tenant db> -f ai/tenant_schema.sql
-- deploy/provision.sh applies it to every tenant database, and the operator's tenant.create applies it
-- when the inventory entry names `ai_python`. The service's own operator bootstrap then creates the
-- tables inside schema liwan_ai.
--
-- Inside the tenant database this is one of the two fixed scripts the admin role runs there (the other is the
-- bootstrap, deploy/release/tenant_postgres.py tenant_bootstrap_sql). Both are catalog DDL and ACL statements only: they
-- start with search_path pinned to pg_catalog and name every schema, so a function or operator a tenant plants in
-- schema public cannot shadow a call made with the admin role's power. Never add a statement here that reads a
-- tenant table or calls a function outside pg_catalog.
--
-- The database must already be closed to PUBLIC (deploy/release/tenant_postgres.py, tenant_isolation_sql): that
-- is the one place that revokes CONNECT from PUBLIC, whether or not the AI role exists, and this script
-- only adds the AI role's own grant. Callers run that step first.
--
-- Idempotent: every statement can be applied again to the same database. The whole script is a no-op
-- when role liwan_ai does not exist (a deployment without AI). Odoo keeps schema public for itself;
-- only the AI role loses it, so AI state can never read an Odoo table.
\set ON_ERROR_STOP on
SET search_path = pg_catalog;

SELECT format('GRANT CONNECT ON DATABASE %I TO liwan_ai', :'tenant_db')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec

\connect :"tenant_db"
-- \connect opens a new session, so the pin is set again before anything runs in the tenant database.
SET search_path = pg_catalog;

SELECT 'CREATE SCHEMA IF NOT EXISTS liwan_ai AUTHORIZATION liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
-- Odoo's role (odoo) holds USAGE on the schema: the AI bootstrap, which runs as liwan_ai, grants the queue tables to the
-- one non-owner role that holds it. A pg_restore of the schema alone does not carry this ACL, so it lives here.
SELECT 'GRANT USAGE ON SCHEMA liwan_ai TO odoo'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odoo') \gexec
-- pgcrypto encrypts the tenant's own provider key (AI service tenant_config.py); its functions live in the AI
-- schema, so the AI role reaches them through its search_path and Odoo's schema gains nothing.
SELECT 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
-- pgvector holds the knowledge index (AI service knowledge.py). It is not a trusted extension, so this superuser step
-- creates it; the AI role only checks that it is there.
SELECT 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
SELECT 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM liwan_ai'
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'liwan_ai') \gexec
