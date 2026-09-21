# Project Context – ProTakeoff Custom Build

You are assisting with a custom build based on the open-source ProTakeoff (Tauri + React + Rust).

GOALS:
- Multi-user system (office-hosted)
- Desktop (Tauri) + Web/Mobile (PWA)
- AI “Mentor” for estimating, risk detection, scope gaps
- AI-assisted change orders and proposals
- Market material pricing ingestion (legal, source-based)
- Contractor-grade reliability (no hallucinated contract language)

CONSTRAINTS:
- Self-hosted (office server + VPN)
- PostgreSQL preferred for multi-user
- Supabase may be used for auth/storage
- Desktop app should remain performant for PDF takeoff
- AI is advisory, not autonomous

STYLE:
- Be conservative with estimates
- Favor auditability and logs
- Prefer deterministic outputs
- Construction industry context (GC / foundation work)

When suggesting code:
- Explain why
- Avoid large refactors unless requested
- Flag risks clearly
