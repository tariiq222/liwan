# 19.0.1.2.1

The noupdate starter list gains the Arabic sources, created once on update. The stock sources that suit
no Saudi business (Search engine, Lead Recall, Newsletter, Monster, Glassdoor, Craigslist) are archived:
by `_liwan_seed_sources` from the seed on a fresh install, and from `post-retire-stock-sources.py` on update (a starter name the tenant already uses is adopted, a renamed stock source is kept), because
a noupdate `<function>` does not run on update. Opportunities keep a source that is archived.
