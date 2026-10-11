# Operational fault findings in the existing work arena

This source candidate derives reports on the existing Group Operations turn. It
adds no schedule, actor, key, grant, transport or incident database. The existing
Group Operations enterprise is the poster and already seats the CEO office.
Report identity, deduplication, corroboration and resolution use the actual
organizing `enterprise/work-arena` contract. Each report uses that contract's
`enterprise:<poster>` subject for the enterprise's own operational conformance.
The per-system condition is stated in its law, preserving distinct stable ids.
A generic machine/peer subject would exclude the opener from home assignment
and leave these self-derived reports in the market rather than its house agenda.

## Evidence and recovery

The primary-health journal keeps changed measurements; the public status file
keeps the most recent pulse. A denied or contested journal measurement opens a
report. Recovery requires a held journal measurement, affirmative-only TOLD, a
fresh held status of the same system and kind, and a status instant no earlier
than that measurement. Machine recovery additionally requires `readiness.state`
to be `ready` in both records, with the same readiness evidence. Historical
HTTP-only machine success cannot resolve a fault. A ready measurement must
internally agree: `ok` true, any native actor claim true, and any present service
state ready/degraded. Peer-service recovery additionally requires the actor claim. Properties retain their
existing HTTP-availability meaning.

The independent peer observer's existing FOUR-valued records are read from the
local settlement journal. A qualified supervised body that explicitly reports
unready is retained with that same observation and opens a separate immediate
service-readiness report, without waiting for silence suspicion. A qualified
503 body is read as well as 200. Timeout, 404, HTML and other unqualified answers
supply no direct service diagnosis. Denied and contested readings open reports. A fresh
held reading can resolve the same peer report; absence, stale success, malformed
or future evidence cannot. A record telling both sides remains contested.
A ready service witness must be affirmative-only in custody, and no newer
unqualified health observation may expose that older success as recovery.
The existing liveness law is deliberately different: its latest told heartbeat
remains held through a later unknown/away observation before the suspicion
threshold. A fresh heartbeat after a liveness fault can resolve that fault even
if later silence is below threshold; it does not settle a service-readiness fault.
Evidence addresses remain in the report. Missing domains cannot settle reports
belonging to another system or poster.

This candidate proposes conservative receiving freshness bounds of 600 seconds
for primary status and 1800 seconds for peer recovery. These are newly proposed
two-cadence bounds, based respectively on the existing 300-second primary pulse
and 900-second peer catch-up. They are not previously established policy and do
not alter liveness suspicion. They must be reviewed with this source change.

## Existing independent observation contract

The Computer host's existing peer catch-up observes only already-declared peers
that also have an explicit `web.workPeerHealth` supervised-health contract. A
work grant alone promises no health endpoint. BCF's contract binds its existing
CRG actor to the source-proven CRG service identity; no other actor is added.
Peers lacking that contract are not probed and remain unobserved/unknown.
A real attempted work delivery remains its existing observation. When idle, the
candidate performs a credential-free, no-redirect GET of that peer origin's
`/healthz`, concurrently and with a two-second request-and-body deadline and
64-KiB body limit. Timed-out body readers are cancelled and released without
waiting for a provider's cancellation promise. No fabricated work move is sent.

The selected host emits `service: config.instance.name`, and instance config
sets that name to `installed.identity.id`. CRG's authored identity is
`cold-red-gate.561.group`; BCF's is `bare-cedar-fog.561.group`. These agree with
their declared peer actor hostnames. The probe uses the explicit contract
service identity and requires for recovery HTTP 200, `ok: true`, `state: ready|degraded`, and `nativeActor.ok: true`. A mere
HTTP answer, another service or an unready actor cannot establish recovery.
Other peers without that explicit contract are not silently assumed health-capable.

The existing Computer `peer-liveness.mjs` owns the 300-second window and
3600-second default suspicion threshold. `instance-config.mjs` accepts the
existing positive-integer `METROPLAT_WORK_PEER_SUSPICION_SECONDS` / installed
`web.workPeerSuspicionSeconds` override. No override is changed here. Silence is
measured from the last heartbeat, or first observation when never heard. Only
an actual unsuccessful observation can cross the threshold; known-intermittent
peers remain unknown. At a 900-second cadence, the default takes about 60–75
minutes after the last heartbeat or first unsuccessful observation. This is a
slow liveness policy, not immediate crash notification or a crash diagnosis.

## Activation and remaining receiving gaps

The runtime operation uses the existing owner `host-read` classification. Its
journal constructor performs no I/O; query may maintain disposable verification
checkpoints (including checkpoint-file compaction/repair). It is not a strictly
filesystem-read-only operation and does not rewrite retained causal witnesses.

Computer's peer reader/export and explicit health-contract configuration, Operations' derivation, Group's existing-enterprise
derives selection and BCF's existing-operation capability selection must be
admitted together under their owners' normal review. BCF observations use its own
journal and therefore do not need CRG's journal endpoint to answer. CRG's separate
primary-health journal is not included in the recovered BCF replica jobs; this
candidate does not invent that missing transfer or claim those remote primary
measurements are available on BCF.

The resulting Group Operations house agenda is only a source-proven consumer.
The actual CEO character Hai Xudi is hosted on CRG. Its world journal, character
inbox and authenticated SessionStart hook are pull paths on that host. No
independent delivery to the currently exposed CEO caller has been established
while CRG is unavailable. A BCF arena finding alone does not complete that final
binding. Installation, actual addressed receipt, CEO consumption, owner action
and consumed recovery remain required operational evidence.

## Qualification

The tests use the genuine peer producer and genuine work-arena constructors and
reconciliation, with explicit inert HTTP ports and in-memory journal ports.
They use an exact genuine Group Operations record fixture and the actual
territory, report-party, agenda and taking-policy functions. They cover fault, deduplication, retained identity on recurrence, fresh recovery,
false-200 historical refusal, missing/stale/future evidence, contradictory sides
and custody of unrelated findings. They do not execute the runtime journal
adapter, a network read, the host, an actor, SQL or a live schedule. Passing them
qualifies this source contract only, not runtime delivery or CEO awareness.

## Independent runtime input reads

The actual operation reads primary status, primary journal and peer journal
independently. A read failure or malformed shape makes only that input unknown.
The returned derivation carries bounded input-availability observations and
classified evidence (a fixed source name, allowlisted error type/code), never
raw exception messages, paths, bodies or credentials. Available input is not a
claim of service health. Unknown input cannot expand the measured domain or
settle an earlier report. A separately measured fault still reaches its actual
Group Operations house agenda.

If every domain is unmeasured, the operation preserves the exact existing
no-measured-domain TypeError and attaches the bounded input observations and
unknown-domain evidence. It does not return an empty successful derivation.

The default read functions still use the genuine filesystem status reader and
semantic-record journal. Only the owning operation factory can supply explicit
readStatus/readWitnesses ports; request input cannot replace readers or roots.
The six adapter tests construct and execute the genuine operation with both
ports supplied, real peer witnesses and real arena reconciliation. They cover
independent thrown reads and malformed shapes, prior-report custody, sanitized
unknown evidence and exact no-domain refusal. They do not call default journal
I/O, read host state, install providers, execute SQL, pack segments or invoke a
network. Default journal checkpoint effects remain as documented above.
