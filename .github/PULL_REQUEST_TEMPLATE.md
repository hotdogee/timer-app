<!-- What this changes and why. Link the issue it closes, e.g. "Closes #12". -->

- [ ] `pnpm check`, `pnpm lint` and `pnpm test` pass; also `pnpm test:server` when `server/`
      changed and `pnpm test:e2e` when a user flow changed
- [ ] `src-tauri` changed: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and
      `cargo test` pass
- [ ] New or changed user-facing text is in all three `messages/*.json` files
- [ ] Docs follow the change (README, `docs/`), and a user-visible change has a line under
      Unreleased in `CHANGELOG.md`
