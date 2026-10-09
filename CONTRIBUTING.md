# Contributing

Thanks for helping improve Evertech Mod Studio. Small, focused pull requests are easiest to review.

## Before opening a pull request

1. Open an issue first for larger changes so the approach can be discussed.
2. Keep changes focused and avoid unrelated formatting churn.
3. Run `npm test` and test the relevant workflow in a current browser.
4. When changing export behavior, include a small reproducible test case or clear manual test steps.
5. Update documentation and `CHANGELOG.md` when behavior or user-facing controls change.

## Style and structure

- Keep HTML semantics and accessibility in mind; preserve labels and focus indicators.
- Put presentation rules in `css/styles.css`, not in new inline style blocks where practical.
- Put application logic in `js/app.js` until a change intentionally extracts a module.
- Keep `vendor/` limited to third-party distributions and retain their license notices.
- Do not add telemetry, analytics, network uploads, or remote dependencies without an explicit design discussion.
- Avoid claiming game compatibility unless verified against a named game version.

## Commit messages

Use a concise verb-first summary, for example `Fix texture paths in ZIP export` or `Document collider settings`.

## Pull request checklist

- [ ] The change has a clear purpose and scope.
- [ ] `npm test` passes.
- [ ] Relevant browser workflows were manually checked, or limitations are stated.
- [ ] UI/documentation is updated where needed.
- [ ] Third-party licensing and privacy implications were considered.
