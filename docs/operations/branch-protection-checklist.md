# Branch Protection Checklist (GitHub Rulesets)

> **Audit and tightening guide** for the existing GitHub configuration on `develop` and `main`.
> **Last updated:** 2026-05-12 (recommended tightening applied — review_count + dismiss_stale).

---

## TL;DR

- This repo uses **GitHub Repository Rulesets** (Settings → Rules → Rulesets), **not** legacy "Branch Protection" (Settings → Branches → Branch protection rules). The legacy API returns `404 Branch not protected` for `develop` and `main`; the rulesets API returns an active ruleset that covers both.
- One ruleset (id `14883955`, name `develop`) covers **both** `refs/heads/develop` and `refs/heads/main`. Empirically verified 2026-05-11 via `gh api repos/{owner}/{repo}/rulesets/14883955`.
- The **ONLY required status check** is **`ci-success`** (the rollup job defined in `.github/workflows/ci.yml`). Do **NOT** add individual `test-*` jobs as required checks — that would block legitimate docs-only PRs that path-filter-skip those jobs.

---

## Why this doc exists (history)

`docs/project_notes/bugs.md` → **BUG-DEV-CI-001** records the original concern: `develop` showed `404 Branch not protected` via the legacy `gh api repos/{owner}/{repo}/branches/develop/protection` endpoint. That endpoint only queries classic branch protection. The repo was — and is — actually protected via the newer **Rulesets** mechanism, which is a separate API surface. The misdiagnosis is captured in `docs/project_notes/product-tracker.md:119` ("F116.g scope reinterpreted: tighten existing ruleset, don't create one") after empirical discovery during BUG-PROD-004-FU1.

If you are reading this and considering creating a new branch protection rule via Settings → Branches, **stop** and read the next section first.

---

## (a) Inventory step — see what already exists

### GitHub UI

1. Open the repo on github.com.
2. Settings → **Rules** → **Rulesets**. (NOT Settings → Branches.)
3. You should see at least one active ruleset whose name is `develop` (or similar) targeting `refs/heads/develop` AND `refs/heads/main`.
4. Click into the ruleset to see its rules and configured status checks.

### CLI

```bash
gh api repos/{owner}/{repo}/rulesets | jq '.[] | {id, name, enforcement, target}'

# Then for each ruleset id:
gh api repos/{owner}/{repo}/rulesets/<id> | jq '{name, conditions, rules: [.rules[] | {type, parameters}], bypass_actors}'
```

### Current empirical state @ 2026-05-12

Ruleset id `14883955`, name `develop`, enforcement `active`. Conditions: `include = [refs/heads/develop, refs/heads/main]`. Rules (after 2026-05-12 tightening — F116-lite operator action):

| Rule | Current value | Notes |
|------|---------------|-------|
| `pull_request` rule type | enabled | This is what enforces PR-only (no direct pushes). |
| `required_approving_review_count` | **`1`** | ✓ **TIGHTENED 2026-05-12** — was `0`. Forces 1 approval before merge (incl. self-approval for solo flows). |
| `dismiss_stale_reviews_on_push` | **`true`** | ✓ **TIGHTENED 2026-05-12** — was `false`. Approvals auto-invalidate on new commits. |
| `require_code_owner_review` | `false` | — (no CODEOWNERS file in repo yet; deferred). |
| `require_last_push_approval` | `false` | — |
| `allowed_merge_methods` | `["merge", "squash", "rebase"]` | All three retained intentionally — `merge` is required for gitflow release PRs (`develop → main`), `squash` for features, `rebase` rarely used. Restricting to squash only would break the release flow. |
| `required_status_checks` | `["ci-success"]` only | ✓ Correct per the `ci-success` rollup block in `.github/workflows/ci.yml` (comment: "the ONLY required check in branch protection") rationale. |
| `strict_required_status_checks_policy` | `true` | ✓ Forces branch to be up-to-date before merge. |
| `do_not_enforce_on_create` | `false` | ✓ Enforced on branch creation too. |
| `bypass_actors` | `[]` | ✓ Nobody can bypass. |

---

## (b) Mandatory configuration — required state

These are the **non-negotiable** items. If your inventory shows any of them are missing or different from below, fix them:

- ✅ **Required status check is exactly `ci-success`** — the rollup job defined in `.github/workflows/ci.yml`. **Do NOT list individual `test-*` jobs as required checks.** Source: the `ci-success` rollup block in `.github/workflows/ci.yml` (block comment: "the ONLY required check in branch protection"). Rationale: `ci-success` passes when all per-package test jobs pass **or were skipped** (docs-only PRs intentionally skip many test jobs via path filters). Requiring `test-shared` / `test-api` / `test-bot` / `test-scraper` / `test-landing` / `test-web` directly as required checks would block legitimate docs-only PRs from ever merging.
- ✅ **`pull_request` rule type enabled** — no direct pushes allowed to `develop` or `main`.
- ✅ **`strict_required_status_checks_policy: true`** — forces branches to be up-to-date with the target before merge.
- ✅ **`bypass_actors` empty** OR audit-logged if non-empty.

---

## (c) Recommended tightening — adoption status

Adoption decisions made 2026-05-12 pre-beta. Each item independent and reversible via `gh api PATCH` to the ruleset.

| Item | Status | Rationale / Trade-off |
|------|--------|----------------------|
| `required_approving_review_count: 1` | ✅ **ADOPTED 2026-05-12** | Forces at least 1 review per PR (including self-review for solo flows). Trade-off accepted: ~1 click extra per PR; offset by catching obvious mistakes before merge. |
| `dismiss_stale_reviews_on_push: true` | ✅ **ADOPTED 2026-05-12** | Prevents old approval carrying over into substantially different commits. Trade-off accepted: small re-review cost on push-after-approval. |
| Restrict `allowed_merge_methods` to `["squash"]` only | ❌ **REJECTED 2026-05-12** | Would break gitflow release PRs that need merge-commit (e.g., #267). Kept all 3 methods. Linear history on `develop` is already de-facto squash via convention. |
| `require_code_owner_review: true` + CODEOWNERS file | ⏸️ **DEFERRED** | No CODEOWNERS file exists yet; needed only when team grows past solo. Revisit when 2+ contributors. |
| Configure for `main` separately | ⏸️ **DEFERRED** | Single ruleset covers both branches today; differentiating (e.g., 2 reviews on main, 1 on develop) only valuable post-beta. |

---

## (d) Operator action checklist

Apply this when you decide to tighten protection. Each step is **reversible** in the GitHub UI.

1. **Inventory** — Run the CLI snippet above (or open the UI) and confirm you see ruleset id `14883955` (or whatever the current id is) active on both `develop` and `main`.
2. **Confirm mandatory state** — Verify every item in section (b) is correct. If any is missing, fix it first.
3. **Decide recommended items** — For each item in section (c), decide adopt/skip and note the rationale in the PR description that updates this doc.
4. **Apply via UI** — Settings → Rules → Rulesets → click the ruleset → Edit → toggle the rules → Save changes.
5. **Verify post-change** — Re-run the CLI inventory. Confirm the new values are present.
6. **Smoke-test** — Open a throwaway PR with a trivial change and confirm:
   - It cannot be merged without `ci-success` passing.
   - It cannot be pushed directly (try `git push origin develop` — should fail with `GH013`).
   - If review count > 0, it cannot be merged without an approval.
7. **Record** — If the ruleset id changes (e.g., you create a new one rather than editing), update the "Current empirical state" table above with the new id and date.

---

## (e) Notes for future maintainers

- **Rulesets vs Branch Protection:** GitHub has two distinct mechanisms with overlapping functionality. Rulesets are the newer model and the one this repo uses. If you see `404 Branch not protected` from `/branches/{branch}/protection`, it does NOT mean the branch is unprotected — check `/rulesets` too.
- **Do not "fix" this doc by enumerating individual `test-*` jobs.** They are intentionally NOT required checks. `ci-success` is the single rollup; it is the contract between the CI workflow and branch protection. Changing this requires also changing the `ci-success` rollup block in `.github/workflows/ci.yml` and revising the path-filtered job design — not a doc-only change.
- **CODEOWNERS** — none currently exists. If you adopt code-owner-required reviews, create `.github/CODEOWNERS` with the relevant patterns.
- **Audit log** — if you ever enable a `bypass_actors` entry, also enable repo-level audit logging (Settings → Audit log) so the bypass is observable.

---

## References

- `.github/workflows/ci.yml` → the `ci-success` rollup job block + its preceding comment ("the ONLY required check in branch protection") — documents the job's role as the only required check.
- `docs/project_notes/bugs.md` → BUG-DEV-CI-001 — original discovery + status updates.
- `docs/project_notes/product-tracker.md:119` — empirical reinterpretation note ("tighten existing ruleset, don't create one").
- `docs/tickets/F116-lite-ci-hardening.md` — the ticket that produced this doc.
- GitHub docs: [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets) and [Creating rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).
- `docs/operations/sentry-observability-checklist.md` — sister operator doc for Sentry observability (F030-lite).
