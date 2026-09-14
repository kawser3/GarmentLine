# GarmentLine — Sample Approval & Production Issue Tracker

**Case:** `01-GarmentLine.pdf` (organizer-assigned) · **Platform:** SELISE Blocks · **Solo**
**Deadline: TONIGHT, Mon 2026-09-14, 23:59**

A knit factory in Gazipur, 6,000 workers, 8 lines, European fast-fashion buyers. Buyer comments
arrive as WhatsApp voice notes and marked-up tech packs; floor defects get shouted across lines
and written in a register nobody reads. Nobody can say which sample version the buyer actually
approved, and defect patterns surface only when air freight is the only fix left.

---

## 1. What must be true by 23:59

Straight from the case — these six are the grade:

1. Log a sample comment or production issue, attach evidence, assign an owner, set a due date.
2. Track it through: **raised → reviewed → correction under way → corrected → verified → closed**,
   with a reject/send-back branch for buyer or QA.
3. **Unalterable history** on every issue — who said what, who acted, when, with what evidence.
4. Every **sample version** records approval/rejection with a timestamp and a person, so
   *"which version is approved"* has exactly one answer.
5. A **factory-manager view** that names which buyer, line, and issue type keep causing repeats
   and delays — early enough to act.
6. **The same defect three times on one line must be impossible to miss.**

---

## 1b. Traceability — every line of the brief

Nothing here is invented; every row is a sentence from the case. If a row has no demo moment,
it is not done.

| Brief says | Where it lives | Demo moment | Acceptance check |
|---|---|---|---|
| Log a comment/issue, attach evidence, assign owner, set due date | `Issue`, `IssueEvent`, `EvidenceFileIds` | 1–3 | issue exists with photo, owner, due date |
| Lifecycle raised→…→closed, with reject/send-back | `Issue.Status` (7 states) | 3–4 | walk it end to end; QA rejects once |
| Unalterable history: who said what, who acted, when, with what evidence | `IssueEvent`, insert-only policy | 4 | attempted edit refused **by the platform** |
| Each sample version records approve/reject with timestamp + person | `SampleVersion` + `ApprovalRecord` | 4 | "which version is approved" has one answer |
| GM view: which buyer, line, issue type causes repeats and delays, early enough to act | GM dashboard aggregation | 5–6 | GM names all three for this month |
| Same defect 3× on one line impossible to miss | `RepeatAlert` raised on the **2nd** | 5 | alert exists *before* the 3rd occurrence |
| Separate sign-in and permission levels per role; each sees only what they own | IAM: 4 roles + scoped queries | 4 | log in as each role; scoping visible |
| Structured records for styles, sample versions, issues, linked over the order's life | 11 schemas with real foreign keys | throughout | style → sample → issue traversal |
| Photo/document evidence attached directly, not left in an inbox | Storage file ids on issue/sample/approval | 3 | photo opens from the issue |
| **Alerts when a defect repeats *and* when a sample is approved or rejected** | `RepeatAlert` + Mail/Notifier on `ApprovalRecord` write | 4–5 | buyer and owner both notified on approval |
| Management view without anyone manually compiling | gateway aggregation, no export step | 6 | no spreadsheet anywhere in the flow |
| Only authorized people may mark a sample approved | `sample::approve` permission | 4 | supervisor is refused the button |
| History can be added to, never edited or deleted | schema access policy | 4 | shown as a platform guarantee |
| AI turns one messy comment into a reviewable action list; the merchandiser accepts | AI parse → review table | 2 | she edits one item before accepting |
| AI proactively surfaces a repeat-defect warning, with evidence, before the third | data trigger on `Issue` insert | 5 | alert timestamp predates 3rd defect |
| GM names the buyer, line and issue type costing the most delay this month — and shows the evidence trail — without asking any merchandiser | GM view + drill-through to `IssueEvent` | 6 | both closing questions answered on screen |

---

## 2. Domain model

Eleven schemas, defined fresh for this case.

- `Buyer { Name, Country, ContactEmail, PreferredLanguage }`
- `Style { StyleCode, Name, BuyerId, Season, OrderQty, ShipDate, MerchandiserId }`
- `Line { Name, PlantId, SupervisorId }`
- `SampleVersion { StyleId, Type(Proto|Fit|PP), VersionNo, Status(Submitted|Approved|Rejected), SubmittedAt, EvidenceFileIds }`
- `ApprovalRecord` **(append-only)** `{ SampleVersionId, Decision, ActorId, ActorName, DecidedAt, Note }`
- `Issue { Title, Description, Type, Severity, Status, StyleId, LineId, BuyerId, OwnerId, Department, DueDate, RaisedBy, SourceCommentId }`
- `IssueEvent` **(append-only history)** `{ IssueId, Kind, ActorId, ActorName, At, Message, EvidenceFileIds }`
- `BuyerComment { StyleId, SampleVersionId, RawText, ReceivedAt, ParsedAt }`
- `ActionItem { BuyerCommentId, IssueId, What, Part, Department, Urgency, State(Proposed|Accepted|Edited|Rejected), AcceptedBy, AcceptedAt }`
- `RepeatAlert { LineId, IssueType, WindowDays, Occurrences, DetectedAt, Acknowledged }`
- `CostAssumption { Key, Value, Unit, Note }` — the brief's own figures, seeded not hard-coded:
  air freight \$4/kg vs \$0.40/kg by sea, rework ~12 pieces/hour/line, buyer chargeback 2–5%
  of order value. The GM view multiplies these by `Style.OrderQty` to show cost impact, which
  is the one thing the brief says only the GM sees.

**Enums:** `Type` = Shade | Stitch | Measurement | Trim | Finishing | Other ·
`Severity` = Critical | High | Medium | Low ·
`Department` = Pattern | Cutting | Dyeing | Sewing | Finishing | QA ·
`Status` = Raised | Reviewed | CorrectionUnderWay | Corrected | Verified | Closed | Rejected.

**Append-only is enforced at the schema, not the UI.** Give `IssueEvent` and `ApprovalRecord`
insert access with no update or delete in the access policy. Requirement 3 is a platform
guarantee you can show the judges, not a promise the frontend makes.

**Never hand-derive operation names.** Blocks pluralises naively — read the real names back from
`/data/v4/schemas` after defining and generate them into a file the app imports.

---

## 3. Roles and access rules

| Role | Sees | Can |
|---|---|---|
| Merchandiser (Nusrat) | their buyers + styles | log comments, accept AI action items, **approve samples** |
| Line supervisor (Rafiqul) | their lines | record corrections, upload evidence — **cannot approve** |
| QA inspector | samples + output | verify or reject, log defects |
| Factory manager (GM) | everything, incl. cost impact | all of the above + the management view |

Approving a sample is a decision of record: gate it on a dedicated permission
(`sample::approve`), and show a supervisor being refused it during the demo.

---

## 4. Where AI earns its place

**Base ask — comment → action list.** A buyer paragraph mixing measurements, quality and
deadlines in Banglish:

> "body length thik ache but CB length 1cm kom lagche, placket ektu wide, collar tipping e shading..."

becomes structured `ActionItem`s: *what to change · which part · which department · how urgent*.
**The merchandiser accepts each item; the AI never writes an official record.** Proposed items
sit in a review table she can edit, accept, or reject one by one.

**Enhancement ask — get ahead of the repeat.** Watch the growing issue history per line and
raise a `RepeatAlert` with its evidence trail **on the second occurrence**, so the GM's insight
arrives before the third one closes the loop. Run it on a Logic data trigger on `Issue` insert:
count same `Type` + same `LineId` inside a 10-day window, and on ≥2 write the alert.

---

## 5. Build order (17:10 → 23:59)

| Time | Block | Done when |
|---|---|---|
| **17:15–17:35** | Copy the chassis (§7), `npm install`, wire `blocks.mjs` to the GarmentLine tenant | a scripted `getX` query answers from the project |
| 17:30–18:30 | Define the 11 schemas + access policies; push; verify authenticated **and** anonymous | `blocks data schema list` shows all 11 |
| 18:30–19:05 | Seed: Nordic Retail AB, style ST-2451, PP v1–v3, 8 lines, **2 shade-variation issues on line 4 inside the last 10 days** | rows queryable through the gateway |
| 19:05–20:05 | Core UI: issue list + detail with the 7-state lifecycle, timeline, owner, due date | an issue walks raised → closed |
| 20:05–20:40 | Sample versions + approve/reject, permission-gated, written to `ApprovalRecord` | PP v3 approved, stamped with person + time |
| 20:40–21:20 | Buyer comment → AI action list → review/edit/accept → creates Issues | the Banglish paragraph produces owned issues |
| 21:20–21:50 | Repeat-defect rule + GM view (delay by buyer / line / issue type) | 3rd shade log on line 4 is already flagged |
| 21:50–22:20 | Approval report PDF + magic-link share + **alerts on approve/reject** (mail to buyer, notifier to owner) | buyer opens the link; owner is notified on approval |
| 22:20–22:50 | Build and deploy; smoke-test the whole story on the real URL | demo runs deployed |
| 22:50–23:25 | **Rehearse twice**; fix only what breaks the demo | timed under 5 min |
| **23:25–23:59** | **Submission**: README, screenshots/video, service-coverage slide | submitted |

**The last 35 minutes are for submitting.** Protect them.

---

## 6. Access — verified working, no browser needed

The `blocks` CLI's `login` is device-code only (no credential flags), but the platform also
accepts a **password grant**, so the `.env` credentials are enough to script everything.
Confirmed live at 17:12 tonight:

```js
POST /iam/v4/auth-login
     { grant_type: "password", username: BLOCKS_USERNAME, password: BLOCKS_PASSWORD }
  -> access_token (600s) + refresh_token
POST /iam/v4/auth/impersonate      x-blocks-key: <cloud tenant>
     { targeted_tenant_id, organization_id: "default", refresh_token,
       client_id: "4a633b13-1108-4fbf-84fd-b196c9dcdee2" }
  -> project access_token
```

### Which `x-blocks-key`, and why it matters

**Your app's key is `D6fce8ccb4e064ae49f0f6b1ab30f88e8`** — the GarmentLine project. That is
what goes in the frontend `.env`. The other id, `d7e5554c758541db8a18694b64ef423d`, is not a
magic constant: it is your **OS account tenant**, read straight out of the `tenant_id` claim of
the cloud-login JWT. Derive it from the token; never paste it in.

The two are not interchangeable, and picking wrong fails in two different ways — tested live
tonight:

| Call | Key to send | Wrong key does |
|---|---|---|
| Admin/config with the impersonated token (`/data/v4/schemas`, `/os/v4/Mail/Gets`, `/os/v4/Storage/Gets`, `/iam/v4/iam/me`) | **ACCOUNT** | bare **401** — loud, harmless |
| App runtime, anonymous or user session (`/localization/v4/...`, `/iam/v4/iam/signup-settings`, gateway reads) | **PROJECT** | **200 with another tenant's data** — silent, dangerous |

The second row is the trap. `Language/Gets` answered with different `itemId`s under each key,
and `signup-settings` reported `isSignUpEnable: false` for the project and `true` for the
account. Neither errored. **A wrong key here does not fail; it lies.** Assert the tenant you
expect in the response before trusting any config read.

| Fact | Value |
|---|---|
| GarmentLine project (dev) — the app's key | `D6fce8ccb4e064ae49f0f6b1ab30f88e8` |
| Account tenant — admin scripts only, derived from JWT | `d7e5554c758541db8a18694b64ef423d` |
| Schemas currently defined | **0 — clean slate** |
| Mail config | `Default` present (AWS SES eu-central-1) — bootstrap preflight passes |
| Storage config | `Default` present (Azure) |
| Project signup | `isSignUpEnable: false` — turn on before inviting demo users |

`client_id` is mandatory on impersonate ("Client configuration not found" without it), the
refresh token is **single-use**, and the impersonated token lasts **10 minutes** — so start
each admin sequence from a fresh login rather than caching. Reuse `blocks.mjs`'s `session()`,
which re-impersonates transparently at the 60s-to-expiry mark.

## 7. Chassis to start from — plumbing only

`/home/kawser/pipeline/blocks/blocks-incident` is your own working Blocks app. Take its
**UI kit and platform plumbing** as the starting shell, then build GarmentLine's domain fresh
on top. Copy nothing domain-shaped; that app's subject matter is unrelated to this case.

**Copy (domain-neutral):**
- `src/components/` — layout, ui, modal, table-toolbar, charts, theme, confirm, row-selection,
  busy, preloader. **This is the UI reference. Don't restyle it.**
- `src/lib/` — `blocks-api.ts`, `env.ts`, `auth-token.ts`, `format.ts`, `pdf.ts`, `export.ts`, `utils.ts`
- `src/features/data/gateway.ts` + `make-crud.ts` — the gateway client and typed CRUD factory
- `scripts/blocks.mjs` (session helper) and the numbered-script + `bootstrap.mjs` runner pattern
- `Dockerfile`, `nginx.conf`, `vite.config.ts`, `eslint.config.js`, `tsconfig*.json`
- `CLAUDE.md` — read it first; §8 below is condensed from it

**Write fresh:** all schemas, all pages, all features, all seed data, all copy.

---

## 7b. Environment and secrets — copy this convention exactly

Both your repos already solve this. Reproduce it from the first commit; retrofitting a leaked
secret out of git history at 23:00 is not a thing you want to be doing.

**Committed — public build config, `VITE_*` only:**

```
.env.dev    VITE_BLOCKS_API_URL=        # blank on purpose
.env.prod   VITE_BLOCKS_PROJECT_KEY=D6fce8ccb4e064ae49f0f6b1ab30f88e8
            VITE_BLOCKS_OIDC_CLIENT_ID= # written by the oidc-client script
            VITE_BLOCKS_REDIRECT_URI=   # blank on purpose
```

`API_URL` and `REDIRECT_URI` are deliberately blank: `lib/env.ts` derives both from the serving
hostname, so one build runs on the `.slsblx.com` domain and on a custom domain unchanged.

**Gitignored — never committed, never pushed:**

```
.env                      BLOCKS_USERNAME / BLOCKS_PASSWORD, admin scripts only
.env.local                local dev (proxy target, dev port)
.env.docker               local container run
scripts/blocks/ctx*.env   impersonation context
scripts/blocks/sso.env    carries a LIVE IAM client secret
```

Write the `.gitignore` **before** `git init`, and keep the existing
`/home/kawser/pipeline/GarmentLine/.env` out of the app directory — or move it to
`app/.env` only after that ignore rule exists.

**Three-tier resolution** (`src/lib/env.ts`, copy as-is):

1. `window.__BLOCKS_CONFIG__` — written at container start by
   `docker/30-blocks-runtime-config.sh`, because Vite inlines `VITE_*` at **build** time while
   the Blocks pipeline supplies config as Kubernetes env-vars at **runtime**. Without it a
   deployed image silently ignores the portal's settings and uses whatever was baked in.
2. `import.meta.env.VITE_*` — build-time, from `.env.local` in dev.
3. A derived same-site default, for `apiUrl` and `redirectUri` only.

That script accepts each setting with or without the `VITE_` prefix, since portal env-vars are
plain container variables. It escapes quotes and backslashes so a value cannot break out of the
generated JS string.

**Missing config is collected, not thrown.** Throwing at module scope gives a blank page and a
minified stack trace on a deployed build; `env.ts` gathers every missing name and renders one
readable diagnostic instead.

**`VITE_*` is public by definition.** The project key and OIDC *client id* belong there. A
client *secret* never does — it lives in `.env` and on the Blocks provider record only.

---

## 8. Platform gotchas — already paid for, don't rediscover

Verified against the live API in your `CLAUDE.md`:

- **The gateway strips `/api`**: `POST {API}/logic/v4/Mail/SendToAny`, never `/logic/v4/api/...`.
  The wrong path returns **HTTP 200 with the portal's HTML shell** — always check `content-type`.
- **Service prefixes**: `iam`, `os`, `data`, `localization`, `utilities`, `monitor`, `release`,
  **`logic`**. Mail *sending* lives under `logic`; `os` only holds SMTP config and templates.
- **Which key, which token**: admin/config = **ACCOUNT** key + impersonated `PTOK`;
  runtime (gateway, `/iam/me`, translations) = **PROJECT** key + user session. Swapping gives a bare 401.
- **Impersonated tokens die after 10 minutes**, and fail as nonsense 500s or subtly wrong data —
  not as "expired". Re-impersonate before any admin sequence.
- **Filters are operation objects**: `where: { ItemId: { eq: id } }`. A bare value is rejected;
  an *omitted* filter silently returns every row.
- **Reload returns `data: false` on success** — trust `isSuccess`, then prove it with a query.
- **IAM**: assign roles via `POST /iam/v4/iam/users/{id}` with a `roles` array.
  `users/create` produces an **inactive** user who cannot sign in until they click a mailed link.

### ⚠ The browser cannot upload evidence photos

DMS presign requires the **ACCOUNT** key; a signed-in browser gets 401. But requirement 1 wants
photo evidence. **Tonight:** upload demo photos via an admin script at seed time and reference
the `fileId`s; name the server-side uploader as the production step during the demo rather than
faking it. Presign traps: `tags` is JSON-parsed → send `"[\"issue\"]"`; `metaData` → send `"{}"`.

---

## 9. Platform coverage

The case explicitly rewards drawing on the full range: Data Gateway (11 schemas + access
policies) · Storage (evidence) · IAM (4 roles, permissions, scoping) · IDP/OIDC (sign-in) ·
Logic (AI agent + data trigger) · Mail (approval and rejection notices) · Notifier (in-app
alerts) · Magic Links (buyer report) · Localization (EN/BN) · Monitor + LMT · Release ·
Client Credentials. Put the matrix on one submission slide.

---

## 10. Demo script

1. Merchandiser pastes the Banglish comment on **ST-2451 PP v3** (buyer Nordic Retail AB).
2. AI proposes an action list; she **edits one line and accepts** — items become owned issues
   with due dates, routed to pattern, cutting and dyeing.
3. Cutting supervisor corrects, attaches a photo, moves it to *corrected*.
4. QA verifies → the sample is **stamped approved**, with person and timestamp.
   (Show the supervisor being refused that button.)
5. **Complication:** QA logs shade variation on **line 4 for the third time in ten days** — the
   repeat alert is already sitting in the GM view with its evidence trail.
6. Close on the two questions the case asks: *"Which sample version is approved?"* → PP v3, by
   whom, when. *"What is line 4 doing to our delivery date?"* → the GM view, with the evidence.

---

## 11. Cut list, in order

Localization beyond EN → in-app notifier → MFA → Monitor/LMT screens → deployment (demo locally
over HTTPS) → PDF export (browser print).

**Never cut:** approval of record · append-only history · AI action list · repeat-defect alert.
Those four are the case.

---

## 12. Housekeeping

- Working directory is now `/home/kawser/pipeline/GarmentLine` (renamed from `hackathonplan`);
  your shell may still be in the old path.
- `.env` holds the Blocks password in plaintext. It must be gitignored before the first commit
  (§7b) and **rotated after the hackathon**. Verify with `git status` that it never appears.
