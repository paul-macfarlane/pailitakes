---
description: Bootstrap a sibling git worktree so a second session can work in parallel (branch, env files, install)
argument-hint: <task-id | branch-name>
---

Create a parallel-session worktree for: **$ARGUMENTS**

1. **Resolve the branch:** an existing branch name is used as-is; a task ID becomes `feat/<task-id-slug>` cut from `staging`.
2. **Create it as a sibling**, never inside the repo: `git worktree add ../paulitakes-<slug> <branch>` (with `-b` when cutting fresh).
3. **Copy every gitignored env file the stack reads** into the same relative paths — `.env` and `.env.local` at the root. This is the load-bearing step and the whole reason this skill exists: a worktree without them fails silently, `npm run test:e2e` first (the session helper signs cookies with `BETTER_AUTH_SECRET` from `.env`).
4. **Install:** `npm install` in the worktree.
5. **Report** the path, and the one constraint that travels with it: the dev database on :5434 and the Playwright e2e suite are shared state, so run e2e one session at a time.

After the branch merges: `git worktree remove ../paulitakes-<slug>` from the main checkout.
