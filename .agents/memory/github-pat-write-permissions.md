---
name: GitHub PAT write permissions
description: Fine-grained GitHub tokens can authenticate successfully while repository write APIs return 404 without Contents write access.
---

Fine-grained GitHub PATs may identify the correct account and show repository-level push permissions, yet Git transport and repository Contents/Git Data write endpoints can return `403`, `invalid credentials`, or `404` when the token's repository access or **Contents: Read and write** permission is missing.

**Why:** GitHub intentionally masks many authorization failures as not-found or invalid-credential responses.

**How to apply:** When a PAT can read `/user` and `/repos/:owner/:repo` but cannot push, have the owner edit that PAT to select the target repository and grant Contents read/write, then retry without changing the project remote or code.