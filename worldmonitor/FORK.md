# The `john1506/worldmonitor` fork

This add-on builds from [`john1506/worldmonitor`](https://github.com/john1506/worldmonitor)'s
`self-hosted` branch, a fork of [`koala73/worldmonitor`](https://github.com/koala73/worldmonitor),
rather than from upstream directly. `self-hosted` carries a set of self-hosted-specific
panel/feature unlocks as normal commits on top of a pinned upstream commit — see that
branch's own commit history for the reasoning behind each one (each commit message
explains *why*, not just *what*).

Through v1.4.4, these changes were shipped as `git apply`'d patch files
(`rootfs/source-patches/*.patch`) applied at build time against a fresh upstream
checkout. That worked for a handful of small removals, but stopped scaling once real
feature work (not just deletions/unlocks) started landing on top. The fork replaces
that pipeline: the same changes now live as ordinary commits, and new features are
built directly in the fork instead of as another patch file.

## Pulling in upstream fixes

Upstream (`koala73/worldmonitor`) keeps shipping fixes independently. This fork does
**not** auto-track it — `WORLDMONITOR_REF` in `worldmonitor/Dockerfile` pins an exact
commit SHA on the fork's `self-hosted` branch, chosen deliberately, not upstream's
latest.

To pull in upstream changes:

```sh
cd worldmonitor   # the fork checkout, not this addon repo
git checkout self-hosted
git fetch upstream
git rebase upstream/main
# resolve any conflicts — most of our commits touch a small, well-known set of
# files (src/config/panels.ts, src/App.ts, src/app/event-handlers.ts,
# src/app/search-manager.ts, src/components/UnifiedSettings.ts), so conflicts
# are usually localized and easy to reason about against each commit's own
# message
git push --force-with-lease origin self-hosted
```

Then in `worldmonitor-addon`, re-pin `WORLDMONITOR_REF` in `worldmonitor/Dockerfile`
to the new commit SHA, bump the add-on version, and add a CHANGELOG entry — same
release flow as any other change.

## Adding new self-hosted-only features

Work directly in the fork's `self-hosted` branch as normal commits — no patch files.
Push, re-pin `WORLDMONITOR_REF` to the new SHA, and ship through this repo the same
way as any other update.
