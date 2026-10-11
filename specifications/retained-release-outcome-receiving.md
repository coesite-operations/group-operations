# Optional retained release outcomes in the primary-health pulse

## Receiving boundary

The existing `runPrimaryHealthPulse` may receive an explicitly injected
`retainedReleaseOutcomes: { binding: { machine, repository, root }, read }`.
`readRetainedReleaseOutcomes` is the provided local-filesystem reader. There is
no default binding, environment variable, CLI flag, new watcher, schedule,
machine configuration, access grant, endpoint or public artifact. The existing
CLI does not supply this input. This is an unbound source capability.

The runtime owner must establish that the existing pulse identity may read the
selected runner custody and write the existing private knowledge journal.
Runner-private `0600` files and `0700` attempt directories do not establish
cross-user access. The reader does not change permissions or choose a home
directory. The binder must also verify private journal custody and the absence
of filesystem aliases into the public web root. The source rejects explicit
lexical overlap in either direction; that is not a proof of access-control isolation.

## Existing sources and actual provider

- Consumer: Operations main `71c01a1013abe915926a2455316ec5e7129b2b22`, with
  PR96 `ba2dc1b5cf431fa6b6edf8dfcc3023d8a4351d93` health-identity changes retained
- Producer contract: guix-machine-release-service PR44
  `fa53a96f6321a5999a8cf69593a95ac545e9c811`,
  `specifications/release-outcome-evidence.md`, `scripts/release-outcome.mjs`
  and `scripts/record-outcome.mjs`
- Assembly declaration: Cold Red Gate
  `0a4b2e61ad77449f867d3464e7898c5510eff871`, `sources.json`,
  `.github/workflows/release.yml`, and the existing
  `deployments/cold-red-gate-host/deploy/jobs/primary-health-pulse.json`
- Actual declared journal provider: computer-data-services-section
  `9c5649a19af8f2427b05d19be06b6f2feae204a8`, package
  `@red-cup-engineering/semiotic-eavt-services-section`, exports
  `record-semantic-record`, `query-semantic-records`, and its real witness
  event/segment implementation

Operations declares the journal as `workspace:*`; its source alone does not
select a provider revision. The stated CRG assembly selects the Data revision
above and an older Operations revision
`b50bdc7220579d64b0e79e648721bb82e39dc4a2`. Source-level qualification of this
candidate with the selected Data provider is not proof that this consumer is
installed in that assembly. Supplemental Koios Data `c7d52ae` qualification is
not substituted for the declared provider.

## Reading and private evidence

The declared producer keeps one immutable `release-outcome.json` in each
immediate `<run>-<attempt>` directory of its existing runner-cache root. The
reader enumerates those directories, rather than reading `latest.json` or
selecting only the newest file. Root absence, unreadability, an empty retained
set, malformed input, or a limit hit stays unknown. An empty set is not a claim
that no build was attempted. Individual unreadable or absent outcomes remain
unknown and are re-observed on the next pulse.

Known symlink ancestors, roots, attempt directories and outcome files are
refused; nonregular files are refused before reading; the opened descriptor and
located file identity are checked. The root and attempt directory identities
are rechecked. The cooperative immutable-custody assumption still applies:
these checks do not constitute a general hostile-filesystem sandbox. The reader
performs no recursive discovery, cleanup, deletion or acknowledgement at source.

Default observation bounds are 4096 directory entries, 128 KiB per envelope and
32 MiB of bytes per reading. A boundary yields an explicitly incomplete/unknown
reading, never silent full coverage. The retained original files remain the
recovery source. A custody root that exceeds these bounds needs an owner decision
before claiming complete automatic receiving; this code supplies no rolling
cursor that could skip an intervening attempt. Repeated capped enumerations may
continue to omit later entries. Larger legitimate producer envelopes also remain
owed: their originals are untouched, and their marker says unknown/oversize;
it is not a receipt of their full bytes.

The private journal value contains the explicit custody binding, run-attempt
locator, exact bounded outer bytes in base64, SHA-256 of those bytes, and their
JSON reading state. Parsed values are used only for envelope classification and
are not stored in the journal. Each embedded observation's bytes, hash, JSON reading
state and parsed value must agree. Outer machine/repository/run/attempt must
match the binding and locator. Invalid UTF-8, malformed JSON, unfamiliar kinds
or versions, inconsistent embedded evidence and identity mismatch remain
unknown while retaining the exact available outer bytes.

The 128 KiB cap makes the outer base64 field at most 174,764 bytes, below the
selected journal's 262,144-byte string bound. The stored record is a fixed shallow
shape, so arbitrary parsed values such as Infinity, negative zero and deep
objects do not enter its JSON-to-SEN bridge or cause structural expansion.
Envelope classification errors are caught and remain unknown with the bounded
original bytes preserved. No alternative canonical JSON or SEN codec is added.

`bound-envelope` means this observation's envelope and embedded byte evidence
passed those checks. The producer's `attributed`, `reason`, candidate, receipt,
assembly-break and job fields remain its reported claims. The consumer does not
replace the producer's attribution algorithm, certify a receipt signature,
verify a Guix NAR anew, or turn a staging observation into deployment. Current
health and the running release still come only from the separate HTTP probe.

The journal uses object kind `561-group.primary-system-release-observation`
and category `retained-machine-release-outcome` within the existing private
knowledge root. Neither raw bytes, parsed envelopes, paths nor their private
identity fields enter `status.json`, `index.html`, or the existing CLI log.
The optional pulse return has only read state and aggregate counters. Public
health defaults and the declared 300-second schedule are unchanged.

## Identity, repetition, conflict and interruption

The selected journal derives a semantic content ID from object kind and value.
Its witness event additionally includes the record row, category, time, told
charge, origin and causes. A content ID alone is not a receipt. The consumer
queries the exact private category first; an identical value reuses its original
`recordedAt`, `told`, `origin` and `causes` before calling the genuine
`journal.record` again. The read-back event must equal the original event.
It then queries and requires the returned event ID, content ID, exact value,
timestamp and charge to be visible. `appended: 0` alone is insufficient because
the provider can also return no newly written statement for refused or
quarantined admission. An equal legacy-shaped record without a witness event,
origin, causes or charge refuses replay acknowledgement rather than inventing
the missing provenance.

This preserves one event across the existing single pulse writer's restart
after journal admission but before public status writing or acknowledgement.
The query reads complete verified segment lines, including a segment line whose
admission index had not yet caught up. An incomplete trailing line is not a
visible witness; the provider repairs that tail on the next append. No public
status checkpoint governs private evidence replay. This assumes intact dated
journal directories. The selected query discovers existing YYYY/MM/DD paths;
loss of an entire admitted day directory may omit its event despite an admission
index entry. Complete recovery from that corruption requires a separate
provider-owned correction. No multiwriter transaction, complete replay after
directory loss, or protection against arbitrary concurrent custody changes is
claimed.

Different bytes under the same bound attempt create another immutable record
with a contested charge, and the receiving summary reports the conflict. The
earlier record and charge are preserved. Re-reading either version still reports
the known conflict and reuses that version's original event. The charge describes
the retained evidence observation, never the candidate's current health.

The actual selected provider synchronizes the segment append before publishing
the deferred admission-index line. A segment-sync failure occurs before that
index update; a later re-admission can republish and synchronize the same event.
A deferred index-sync failure occurs after the segment was synchronized; an
already-admitted replay can skip index re-synchronization. The consumer does not
pretend query visibility alone is a fresh filesystem durability proof, and does
not patch the provider or introduce an alternative journal. Filesystem durability
and fault recovery retain the existing provider's contract and limitations.

## Qualification scope

Distinct reader, envelope and real-journal fixtures cover every retained attempt,
byte/identity mismatches, staging versus promotion, unavailable and malformed
observations, replay, byte conflict, interruption after genuine admission,
journal-ahead/public-status-behind recovery, public-output privacy, and unchanged
default behavior. The new journal fixture imports the genuine selected provider;
it does not replace event identity or journal semantics with a stub.

The old original primary-health integration test and old sandbox probe are not
part of this qualification. Passing these focused tests does not qualify the
full installed dependency suite, runtime binding, access permissions, collector
activation, current machine deployment, or institutional receiving.
