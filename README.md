# GarmentLine

**Sample approval and production issue tracking for a knit garment factory — built end to end on SELISE Blocks Cloud.**

The case: a 6,000-worker knit factory in Gazipur runs 8 sewing lines for European
fast-fashion buyers. Samples walk proto → fit → PP before bulk; production issues
walk raised → closed. The two registers the factory needs to trust are the same two
this app holds: *which sample version is the approved one*, and *what went wrong on
which line, when, and who owns it*.

---

## What the app guarantees

These are the four behaviours the case calls non-negotiable, and where each lives:

| Guarantee | How it is enforced |
|---|---|
| **The sample version of record** — timestamp + person, permission-gated | `ApprovalRecord` is **append-only**; "which version is approved" is derived from the newest record, never a mutable status. The `Status` field on the version is a cache, written *after* the record — if the second write fails the decision still stands in the trail. |
| **History that cannot be rewritten** | Every lifecycle change writes an `IssueEvent` row (actor, kind, note, timestamp). Nothing in the app updates or deletes one — the history is written forward only. (Enforced in the client today; the gateway-side rule that would make it impossible from outside the app is listed under Limits.) |
| **A repeat defect is impossible to miss** | The **second** occurrence of the same defect type on the same line inside 10 days raises a `RepeatAlert` — persisted, not a toast — with links to the evidence. The GM's view reads that table, so Monday's warning is still on the board Friday. |
| **AI proposes, a human decides** | A messy Banglish buyer comment becomes a reviewable action list (what / part / department / urgency / type). Every row is editable; nothing becomes an issue until a merchandiser presses Accept. The AI never writes an official record. |

## Roles

Seven roles, five of them with demo accounts below. Capability is decided per role in `src/stores/auth.ts` and row-level visibility in `src/features/issues/scope.ts`:

| Role | Sees | May |
|---|---|---|
| Merchandiser | own buyers' styles and issues | record buyer comments, run the AI parse, accept/reject proposals, **stamp sample decisions** |
| Line supervisor | own lines | raise issues, record corrections, attach evidence |
| QA inspector | factory-wide issues | raise, verify corrections, reject with reason |
| Factory manager (GM) | everything + cost impact | management view, master data, read the people register |
| Admin / Super administrator | everything | as GM, plus administration |

Demo accounts (password `GarmentLine#2026`): `nusrat.garmentline@example.com`
(merchandiser) · `rafiqul.garmentline@example.com` (line supervisor) ·
`qa.garmentline@example.com` (QA) · `gm.garmentline@example.com` (GM) ·
`owner.garmentline@example.com` (superadmin).

## Blocks services used

| Service | Where it earns its place |
|---|---|
| **Data Gateway** | 11 schemas (`Style`, `SampleVersion`, `ApprovalRecord`, `Issue`, `IssueEvent`, `BuyerComment`, `ActionItem`, `RepeatAlert`, `Buyer`, `Line`, `CostAssumption`) with typed CRUD over one GraphQL endpoint |
| **Storage** | provisioned, with `EvidenceFileIds` carried on issues and sample versions; the upload UI is not built yet (see Limits) |
| **IAM** | roles, permissions (`garmentline::*`), role-scoped visibility, demo users |
| **IDP / OIDC** | browser sign-in via the platform client (PKCE), session bootstrap |
| **Logic · Mail** | buyer notice on approve/reject — template `GarmentLineSampleDecision`, sent *after* the record stands; failure never rolls back a decision |
| **Logic · Notifier** | in-app notification to GM + merchandisers on a decision, and to the GM when a repeat pattern is first detected |
| **AI Agents** | Banglish comment → structured action list via the AI service (`agents.seliseblocks.com`, `/api/ai-agent/query/stream`, session-token auth, SSE), with an honest fallback parser when the service is unreachable — the badge in the UI always says which engine produced the list |
| **Localization / LMT** | full EN + বাংলা UI, bundled dictionary first-paint + service overlay |
| **Release** | build + deploy from the Blocks CLI |

## Run it locally

```bash
npm install
cp .env.example .env.local   # or use the values below
npm run dev
```

`.env.local` (never committed):

```
VITE_BLOCKS_API_URL=http://localhost:5173
VITE_BLOCKS_PROXY_TARGET=https://api.seliseblocks.com
VITE_BLOCKS_PROJECT_KEY=<project key>
VITE_BLOCKS_OIDC_CLIENT_ID=<oidc client id>
VITE_BLOCKS_REDIRECT_URI=http://localhost:5173/login/callback
```

The dev server proxies API calls to the platform, so the browser stays same-origin.

## Provisioning scripts

Run in order after the project exists (`node scripts/NN-….mjs`); all are idempotent:

1. `01-define-schemas.mjs` — schemas + access policies
2. `02-oidc-client.mjs` — the OIDC client the browser signs in with
3. `03-roles-users.mjs` — roles, permissions, demo users
4. `04-seed.mjs` — demo factory: 3 buyers, 8 lines, 5 styles, ST-2451's sample
   history (PP v1/v2 rejected), and **two shade defects on Line 4 inside the
   window** so the repeat rule has something to catch on stage
5. `05-mail-template.mjs` — the buyer-decision mail template (`--test` sends one)

## The demo in six steps

1. **Merchandiser** (Nusrat) opens ST-2451 → pastes the buyer's Banglish comment
   on PP v3 → the AI proposes an action list → she **edits one row and accepts**:
   items become owned issues with due dates, routed to pattern/cutting/dyeing.
2. **Line supervisor** (Rafiqul) records the correction with a photo.
3. **QA** (qa.garmentline) verifies; once, deliberately, *rejects* with a reason.
4. Merchandiser **stamps PP v3 approved** — person, timestamp, note. The buyer
   notice mail and the in-app notifications fire *after* the record stands.
   (Show the supervisor being refused that button.)
5. **Complication:** QA logs shade variation on **Line 4 for the third time in
   ten days** — the repeat alert has been sitting in the GM view since the
   *second*, with its evidence trail.
6. **GM** (gm.garmentline) answers the case's two questions on one screen:
   *which version is approved?* → PP v3, by whom, when. *What is Line 4 doing to
   our delivery date?* → worst buyer/line/type, cost exposure, drill-through to
   the rows behind every number.

## Limits — what is not built

Stated plainly, because a reviewer will find these anyway and a README that
oversells is worse than one that is short.

- **Row-level scoping is enforced in the UI, not at the gateway.** `scope.ts`
  decides what each role sees, and it says so in its own header comment. A
  signed-in user who queried the Data gateway directly could read another
  scope's rows. The fix is a Data Gateway access policy comparing the owner
  field to the token subject; it is designed, not deployed.
- **Append-only is a property of the code, not yet of the schema.** No data
  rules are deployed for `IssueEvent` or `ApprovalRecord`, so the guarantee
  holds for anything going through this app and not against a direct API call.
- **Evidence upload is not wired.** The field exists on the schema and travels
  through the app; nothing writes a file id to it yet.
- **Repeat alerts cannot be acknowledged from the UI.** The capability and the
  `Acknowledged` field both exist; no screen writes it, so an alert stays live
  until the data changes.
- **The people register is read-only.** Accounts and roles are provisioned by
  `scripts/03-roles-users.mjs`. This is deliberate for the demo, not an
  oversight, but it does mean the GM cannot invite anyone from inside the app.

---

Built for the SELISE Blocks hackathon, 2026-09-14. Solo entry by Kawser Harun
(`harun.kawser@selisegroup.com`).
