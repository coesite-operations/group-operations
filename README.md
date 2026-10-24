# group-operations

<!-- 561-group-standards:badges:start -->
[![Coesite Operations](https://img.shields.io/badge/561%20Group-Coesite%20Operations-5d6d7e)](https://github.com/coesite-operations)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-5d6d7e)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/coesite-operations/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This repository holds the Group operations campaign library and records. It is operation data only, read by
[red-cup-engineering/group-operations-application](https://github.com/red-cup-engineering/group-operations-application)
and by Red Cup AOE `operating-cell-plan`.

- `content/operations-campaign-library.v1.json` is the Group operations campaign library; AOE
  `operating-cell-plan` reads it Git-pinned from this repository at this path.
- `content/pulse-operating-cells.v1.json` holds the pulse operating cells.

The executable code that was formerly here (the `@561-group/group-operations` MetroPlat application: `src/`,
`scripts/`, `test/`, `package.json`) moved on 2026-10-23 to
[red-cup-engineering/group-operations-application](https://github.com/red-cup-engineering/group-operations-application).
Coesite pins this repository as a submodule at `apps/group-operations` of
`coesite-operations/operations-services-section`.
