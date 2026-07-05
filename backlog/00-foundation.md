# Epic: Foundation (FND)

Scaffold the app and get environments + auth settled early so OAuth redirect URIs are stable. Ref: technical-design.md §7, §9.1.

- [ ] **FND-1** — Scaffold Next.js App Router + TypeScript + Tailwind; base project structure per technical-design.md §6. _(deps: none)_
- [ ] **FND-2** — Add shadcn/ui and configure theme/tokens. _(deps: FND-1)_
- [ ] **FND-3** — Drizzle + local Docker Postgres (compose file matching Neon major version); drizzle-kit config + migration workflow. _(deps: FND-1)_
- [ ] **FND-4** — Better Auth: Google + Discord OAuth, Drizzle adapter; extend `user` with `role` (reader/author/admin, default reader) and `banned_at`. _(deps: FND-3)_
- [ ] **FND-5** — Typed env validation (zod) + `.env.example` covering all vars in technical-design.md §7. _(deps: FND-1)_
- [ ] **FND-6** — Vercel project; staging + prod environments; Neon `staging`/`main` branches; per-env OAuth clients with registered redirect URIs. _(deps: FND-4)_
- [ ] **FND-7** — One-time seed script to promote the first admin (no in-app self-promote path). _(deps: FND-4)_
- [ ] **FND-8** — CI: run drizzle migrations (staging→prod) + typecheck + lint + **tests** on PR. _(deps: FND-3, FND-6, FND-10)_
- [ ] **FND-9** — Safety hook: `PreToolUse` hook in `.claude/settings.json` that blocks/prompts on destructive commands — `drizzle-kit push`/migrate against a non-local `DATABASE_URL`, `vercel deploy --prod`, `git push`. Enforced by the harness regardless of model behavior; complements the prompt-level escalation rules in `/task`. _(deps: FND-6, FND-8)_
- [ ] **FND-10** — Test harness: **Vitest** (unit/integration for `src/lib` + server actions) + **Playwright** (e2e for critical flows). Config, `test`/`test:e2e` scripts, and a first smoke test. See ADR-0003. _(deps: FND-1)_
