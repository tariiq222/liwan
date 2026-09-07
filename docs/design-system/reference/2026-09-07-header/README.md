# Connected header and module rail reference

Current visual reference for [DESIGN.md](../../../../DESIGN.md). Revised on 2026-09-07 following the user's explicit requests: full-page visual quality, global search and user account, matching header/rail background, and a larger 32px inner curve with frame borders removed.

- [Interactive preview](index.html)
- [Updated header and page screenshot](header-curved.png)
- [Earlier approved page examples](../2026-09-07/README.md), supplementary for content composition; their former header is superseded.

HTML SHA-256: `bcb142522d2e172840943640668eaef1871c26112e7acc671730b3dd1f8c99a9`.

Serve this directory with a static server. Local font assets are included with the project's existing font licensing unchanged. Temporary working preview: http://127.0.0.1:4397/?header=8#my-tasks.
This is a self-contained demonstration, not the application. Search operates on demo records; account details, counts and hash routes are fixtures. Do not import the fixture code or fixed colour values into production. Dark mode, permissions, persisted filters/preferences and real APIs remain production requirements, not features proven by the demo.

Final revision: the header/module rail use the configured primary colour with contrasting text/icons; the context sidebar and breadcrumb strip share a neutral background and a 24px inner corner. The outer corner is 32px. The demo Appearance page previews, validates, explicitly saves and cancels a browser-local prototype colour; this does not update real institution settings.

Context-navigation revision: its collapse button/state are removed. The section icon and title share one row. Context navigation remains visible and reflows above content on narrow screens; only the primary module rail collapses. This supersedes earlier collapse behavior shown in the original page examples.

Main content elevation: one very subtle outer shadow, `0 0 14px rgba(18,34,58,.045)`, around the 24px rounded content surface. Cards do not inherit this elevation.

Navigation heading cleanup: module title appears once beside its icon. Repeated group labels and placeholder organization subtitles are removed; group headings are reserved for distinct navigation groups.
