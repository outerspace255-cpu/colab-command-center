---
name: Single-user lease handshake
description: Browser-level occupancy must establish its client cookie before protected page queries run.
---

The frontend must complete the occupancy handshake before mounting route components that issue protected API requests.

**Why:** Browsers can send initial data requests concurrently before a Set-Cookie response is stored. If those requests each generate an opaque client ID, the first visitor can race against itself and be shown the busy screen.

**How to apply:** Keep occupancy endpoint responses uncached, claim the lease only through the occupancy handshake when no client cookie exists, and gate protected UI rendering on a successful occupancy response.