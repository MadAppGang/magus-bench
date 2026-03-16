# License Verification: promptfoo

**Date**: 2026-03-16
**Researcher**: Deep Research Specialist (claude-sonnet-4-6)
**Sources checked**: GitHub LICENSE file, package.json, README, CONTRIBUTING.md, GitHub API

---

## Verdict: MIT License — Commercial Use YES (unrestricted)

---

## Findings

### 1. License Type: MIT

The LICENSE file at `github.com/promptfoo/promptfoo/blob/main/LICENSE` contains the standard MIT license text verbatim:

> Copyright (c) Promptfoo 2025
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software ... to deal in the Software **without restriction** ...

Confirmed via three independent signals:
- `package.json` field: `"license": "MIT"`
- GitHub API (`/repos/promptfoo/promptfoo`): `spdx_id: MIT`
- README badge: "MIT license" shield linking to the LICENSE file

### 2. Commercial Use: YES, unrestricted

MIT grants the right to "use, copy, modify, merge, publish, distribute, sublicense, and/or **sell** copies." There are no carve-outs for commercial use. The README explicitly describes promptfoo as "Open source: MIT licensed."

No usage restrictions, no revenue-based thresholds, no requirement to open-source derivatives.

### 3. Dual-Licensing / Enterprise Tier: NOT PRESENT

No evidence of dual-licensing (e.g., AGPL for self-hosted + commercial for SaaS, or BSL/SSPL time-delayed licensing). No enterprise-only modules detected. The entire public repository is covered by a single MIT license file. The contributing docs confirm: "Promptfoo is an MIT-licensed tool" — no mention of a separate commercial edition.

### 4. CLA / Contributor Agreement: NONE

The contributing documentation (`site/docs/contributing.md`) describes a standard fork-and-PR contribution model with no Contributor License Agreement (CLA) or copyright assignment requirement. No CLA bot or CLA check is referenced. Contributors retain ownership of their submitted code under their normal copyright; the project simply accepts contributions under the existing MIT license.

---

## Source Summary

| Source | URL | Quality | Date |
|--------|-----|---------|------|
| LICENSE file | https://raw.githubusercontent.com/promptfoo/promptfoo/main/LICENSE | High (primary) | Retrieved 2026-03-16 |
| package.json | https://raw.githubusercontent.com/promptfoo/promptfoo/main/package.json | High (primary) | Retrieved 2026-03-16 |
| GitHub API repo metadata | https://api.github.com/repos/promptfoo/promptfoo | High (authoritative) | Retrieved 2026-03-16 |
| README.md | https://raw.githubusercontent.com/promptfoo/promptfoo/main/README.md | High | Retrieved 2026-03-16 |
| CONTRIBUTING / contributing.md | https://raw.githubusercontent.com/promptfoo/promptfoo/main/site/docs/contributing.md | High | Retrieved 2026-03-16 |

All sources: High quality, retrieved directly from the canonical GitHub repository.

---

## Knowledge Gaps

None material. All four questions were answered directly from primary sources. No contradictions found across sources.

One item not checked: whether promptfoo.dev's cloud/SaaS offering has separate terms of service. That would only matter if integrating with their hosted service, not when using the open-source library directly.

---

## Summary

| Question | Answer |
|----------|--------|
| License type | MIT |
| Commercial use allowed? | YES — explicitly granted, no restrictions |
| Dual-licensing or enterprise tier? | NO — single MIT license covers entire repo |
| CLA or contributor agreement? | NO — standard fork-and-PR, no CLA |
