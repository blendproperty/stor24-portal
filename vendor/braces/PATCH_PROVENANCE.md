# Local security-patched braces fork

Source: https://github.com/FSDevelop/braces/commit/d0d575e55e74a4e0218e5248fafb79efc3e54ebb
Upstream proposed fix: https://github.com/micromatch/braces/pull/72
CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm. Upstream patch is unreleased and unmerged.

All library files and index.js based on from this immutable commit. MIT license retained. Local corrections: parser compares the next depth, enforcing fractional limits consistently; stringify forwards depth without changing the original parent/escapeInvalid behavior. Package metadata changes: local version 3.0.4-stor24.1; development scripts/dependencies omitted. This is a locally maintained security fix, not an official upstream release.

Parser and compile/expand/stringify limit nesting to100 with stricter caller limits allowed. Replace this override after an official reviewed fixed release passes the same regression checks. No security check is suppressed.
