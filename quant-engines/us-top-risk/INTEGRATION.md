# Spring Investment Platform Integration

The research engine in this directory is vendored from:

- Repository: https://github.com/junqt/junquant-research
- Upstream path: `us-market/01_top_risk_score`
- License: MIT
- Original copyright: Copyright (c) 2026 junqt

The original source code, research notes, tests, charts, and license are kept
alongside this file. The Spring Investment Platform adds only the surrounding
automation, Firebase synchronization, API fallback, and Next.js presentation
layer.

Project-specific files live outside this vendored directory:

- `scripts/sync_top_risk_to_firebase.py`
- `.github/workflows/update-us-top-risk.yml`
- `app/api/quant/crowding/route.ts`
- `app/analysis/quantitative-analysis/`

Do not remove `LICENSE` when redistributing this engine or substantial portions
of its source code.

