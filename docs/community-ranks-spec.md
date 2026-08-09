# NekoSuneAPPSVRC Community Ranks — Technical Specification

> **Version:** 1.0 (draft)
> **Status:** Design / RFC
> **Owner:** NekoSuneVR
> **Applies to:** NekoSuneAPPSVRC ≥ 1.1.0

---

## 0. Disclaimer & Scope

**NekoSuneAPPSVRC Community Ranks are an independent, community-run reputation system.**
They are **not** affiliated with, endorsed by, or representative of VRChat Inc., and they
are **not** a revival of any official VRChat trust rank, badge, or moderation system.

The names *Veteran* and *Legend* are used here as **NekoSuneAPPSVRC Community Rank labels
only**. Every surface that displays a rank **must** prefix or badge it as a
**"NekoSuneAPPSVRC Community Rank"** (abbreviated **NSA Rank** in compact UI).

This system recreates the *spirit* of recognising long-term, positive community members —
it does not read, mirror, or claim VRChat's internal trust score.

### "OG Rank" master toggle

The entire feature is gated behind a single user setting, **`communityRanks.enabled`**
(stored in `electron-store`, default `false`). When off:

- No scores are computed, no rank badges render, the leaderboard tab is hidden.
- The local rank database is retained but dormant (not deleted) so toggling back on
  restores history.

A secondary toggle, **`communityRanks.ogMode`**, controls whether the nostalgia-styled
*Veteran* / *Legend* tiers are surfaced at all. With `ogMode = false`, the ladder caps
the visible label at *Trusted User* (scores still accrue; the OG tiers simply aren't shown).
This lets the app ship the "bring the OG ranks back" experience as an **opt-in** rather
than a default.

```jsonc
// electron-store schema fragment
{
  "communityRanks": {
    "enabled": false,     // master on/off
    "ogMode": true,       // show Veteran / Legend tiers when enabled
    "shareToLeaderboard": false, // opt-in to the cloud leaderboard
    "lastSyncedAt": null
  }
}
```

---

## 1. Rank Structure

Seven tiers, ascending. The first five mirror familiar community-trust language; the top
two are the rare "OG" tiers.

| # | Rank          | Intent                                                            | Visible when `ogMode=false`? |
|---|---------------|-------------------------------------------------------------------|------------------------------|
| 0 | Visitor       | Brand new / unverified. Default for everyone.                     | ✅ |
| 1 | New User      | Verified account, minimal history.                                | ✅ |
| 2 | User          | Established account with some activity.                           | ✅ |
| 3 | Known User    | Recognisable, consistent positive presence.                       | ✅ |
| 4 | Trusted User  | Long, clean record; meaningful creation or contribution.          | ✅ |
| 5 | Veteran       | Long-term member, sustained positive activity, real creation.     | ❌ (caps at Trusted) |
| 6 | Legend        | Extremely rare. Community pillar / leader / major contributor.    | ❌ (caps at Trusted) |

---

## 2. Ranking Formula (0–1000)

### 2.1 Factor weights

Total budget **1000 points**, grouped so that **time + reputation dominate** (hard to fake)
and raw upload counts are deliberately capped (easy to spam).

| Factor                         | Cluster      | Max pts | Share |
|--------------------------------|--------------|--------:|------:|
| VRChat join age                | Tenure       |     150 | 15.0% |
| Years active in VRChat         | Tenure       |     150 | 15.0% |
| NekoSuneAPPSVRC account age       | Tenure       |      50 |  5.0% |
| World uploads                  | Creation     |     120 | 12.0% |
| Avatar uploads                 | Creation     |      80 |  8.0% |
| Creator activity (recency)     | Creation     |     100 | 10.0% |
| Community contributions        | Community    |     120 | 12.0% |
| Event participation            | Community    |      80 |  8.0% |
| Community reputation           | Community    |     100 | 10.0% |
| Staff / moderator recognition  | Recognition  |      50 |  5.0% |
| **Total**                      |              | **1000**| 100%  |

Cluster totals: **Tenure 350 · Creation 300 · Community 300 · Recognition 50**.

### 2.2 Per-factor formulas

All formulas use **diminishing returns** (log or saturating curves) so the first units are
worth a lot and farming the 500th upload is worthless. `clamp(x, lo, hi)` bounds a value;
`min` caps it.

**Helper — saturating curve** (reaches ~95% of cap at `k` units):

```
sat(n, cap, k) = cap * (1 - exp(-n / k))
```

| Factor | Formula | Notes |
|---|---|---|
| VRChat join age | `min(150, yearsSinceJoin * 25)` | Linear to the cap at **6 years**. Pure time. |
| Years active in VRChat | `sat(activeYears, 150, 3)` | "Active year" = ≥1 verified session in ≥6 distinct weeks that year. ~3 yrs ⇒ ~95%. |
| NekoSuneAPPSVRC account age | `min(50, monthsInstalled * 2.1)` | Linear to cap at **~24 months**. |
| World uploads | `sat(publishedWorlds, 120, 4)` | Only **published, non-private, non-duplicate** worlds count. |
| Avatar uploads | `sat(publicAvatars, 80, 6)` | Only **public** avatars; clones/reuploads excluded. |
| Creator activity | `min(100, creatorScore)` | See 2.3 — rewards *recent + consistent* creation, not raw totals. |
| Community contributions | `min(120, Σ contributionPoints)` | Weighted, staff-verifiable (see 2.4). |
| Event participation | `sat(verifiedEvents, 80, 8)` | Only **verified** attendance; caps the value of grinding events. |
| Community reputation | `clamp(50 + repNet, 0, 100)` | Starts neutral at 50; endorsements raise, sanctions lower. |
| Staff / mod recognition | `recognitionTier * 25` (max 50) | 0 = none, 1 = community helper, 2 = staff/mod. Manual, audited. |

### 2.3 Creator activity (recency-weighted)

Raw upload counts are easy to inflate, so "creator activity" rewards *sustained* output:

```
creatorScore =
    40 * recencyFactor          // any published content in last 180 days
  + 40 * consistencyFactor      // distinct months with a publish over last 24
  + 20 * adoptionFactor         // others actually use/favourite the content
```

```
recencyFactor      = daysSinceLastPublish <= 180 ? 1 : max(0, 1 - (d-180)/540)
consistencyFactor  = distinctPublishMonths(24) / 24        // 0..1
adoptionFactor     = sat(totalFavourites, 20, 50) / 20     // 0..1, capped
```

### 2.4 Contribution point table

`Σ contributionPoints` is capped at 120 and each entry is **staff- or peer-verifiable**.

| Contribution type            | Points | Cap/period |
|------------------------------|-------:|------------|
| Verified bug report (app)    |      3 | 30 / yr    |
| Merged code/PR contribution  |     15 | uncapped   |
| Documentation / guide        |      6 | 60 / yr    |
| Helping new users (verified) |      2 | 40 / yr    |
| Translation / localisation   |     10 | uncapped   |
| Asset / template donation     |     8 | 64 / yr    |
| Partner-community project     |     20 | uncapped   |

### 2.5 Final score

```
rawScore   = Σ (all ten factor outputs)               // 0..1000
penalty    = abusePenalty(userId)                     // 0..1 multiplier (§4)
finalScore = round( clamp(rawScore, 0, 1000) * penalty )
```

`penalty` is a multiplier (not subtraction) so confirmed abuse can wipe out gains
proportionally rather than just shaving a few points.

---

## 3. Rank Thresholds

Scores are necessary but **not sufficient** — *Veteran* and *Legend* have hard gates (§5–6).

| Score range | Rank          | Hard gates beyond score? |
|-------------|---------------|--------------------------|
| 0 – 99      | Visitor       | — |
| 100 – 199   | New User      | Account verified |
| 200 – 399   | User          | — |
| 400 – 599   | Known User    | — |
| 600 – 799   | Trusted User  | — |
| 800 – 949   | Veteran       | **Yes** (§5) |
| 950 – 1000  | Legend        | **Yes** (§6) |

> If a user reaches 800+ by score but fails a Veteran hard gate, they remain **Trusted User**
> with a "Veteran-eligible (pending: <gate>)" annotation. Score never silently grants the OG tiers.

---

## 4. Anti-Abuse Measures

Design principle: **make time and human verification the bottleneck**, since those are the
two things alt-farms and spammers cannot cheaply manufacture.

### 4.1 Spam avatar / world uploads
- Saturating curves (§2.2): the 5th avatar is nearly worthless; the 50th is worthless.
- **Quality gates:** only *published & public* content counts; private/unlisted excluded.
- **Dedup:** content hash + name similarity; near-duplicate uploads collapse to one.
- **Adoption requirement:** `adoptionFactor` means content nobody uses contributes little.
- **Rate dampening:** > N uploads in 24h flags the account for review and pauses
  creation-point accrual until cleared.

### 4.2 Alternate accounts
- **Hardware / install fingerprint** (hashed machine id) + VRChat user id binding;
  multiple NSA profiles on one fingerprint share a single rank lineage.
- **Reputation is non-transferable** between linked accounts.
- Endorsements from accounts sharing a fingerprint **do not count** (§4.4).
- New accounts begin at Visitor regardless of an operator's other ranks.

### 4.3 Fake event attendance
- Attendance is only credited when **verified** by: (a) an event host's signed check-in
  token, or (b) presence confirmed via the app's session telemetry for the event window.
- **Diversity rule:** events hosted by the *same* organiser have diminishing value
  (1st full value, then `0.7^n`), so you can't farm one friend's daily "event".
- Self-hosted events require ≥ K distinct verified attendees to count for the host.

### 4.4 Community reputation gaming (sockpuppet endorsements)
- Endorsements are **weighted by the endorser's own rank** (a Visitor's endorsement ≈ 0).
- One endorser → one target counts **once** per rolling 90 days.
- Shared-fingerprint or reciprocal-only endorsement rings are discounted to zero.
- `repNet` is bounded (±50) so reputation can never dominate the score.

### 4.5 Artificial activity inflation (generic)
- All time-based factors use **server-attested timestamps**, never client clocks.
- **Decay:** inactivity > 12 months applies a slow decay to *Creator activity* and
  *Event* factors (tenure never decays — time served is time served).
- **Penalty multiplier** `abusePenalty` (§2.5): confirmed violations set it to
  `{warn: 0.9, throttle: 0.5, sanction: 0.1}`; it recovers `+0.05/quarter` of clean record.
- **Full audit trail:** every point-affecting event is logged immutably (§7, `rank_history`).

---

## 5. Veteran Requirements

*Veteran* = a real, long-term, positively-engaged community member. **All** of:

| Requirement              | Minimum |
|--------------------------|---------|
| Final score              | ≥ 800 |
| VRChat join age          | ≥ 3 years |
| Years active in VRChat   | ≥ 2 active years |
| Meaningful creation      | ≥ 2 published worlds **OR** ≥ 5 public avatars **OR** `creatorScore ≥ 60` |
| Community involvement     | ≥ 40 contribution points **OR** ≥ 8 verified events |
| Reputation               | `repNet ≥ 0` (no net-negative standing) |
| Clean record             | `abusePenalty == 1.0` for the last 6 months |

Veteran is **revocable**: dropping below score 760 (hysteresis band, §11) or incurring a
sanction demotes to Trusted User.

---

## 6. Legend Requirements

*Legend* = an extremely rare community pillar. Score ≥ 950 **and** a **manual nomination
+ review** by NekoSuneAPPSVRC staff. Score alone never grants Legend.

| Requirement                 | Minimum |
|-----------------------------|---------|
| Final score                 | ≥ 950 |
| VRChat join age             | ≥ 5 years |
| Years active in VRChat      | ≥ 4 active years |
| Significant world creation  | ≥ 5 published, actively-used worlds |
| Significant avatar creation | ≥ 15 public avatars **OR** strong adoption (`totalFavourites ≥ 1000`) |
| Community leadership        | Documented: event hosting, moderation, mentorship, or org role |
| Major contribution          | ≥ 1 partner-community project **OR** sustained core contribution to NekoSuneAPPSVRC |
| Reputation                  | `repNet ≥ +20` |
| Staff approval              | Recorded nomination + ≥ 2 staff sign-offs |

**Rarity target:** ≤ **0.5%** of ranked users, with a soft global cap reviewed quarterly.
If natural qualification exceeds the target, raise the manual bar — never auto-inflate.

---

## 7. Database Design (SQLite / `sql.js`)

Schema is written for the app's bundled `sql.js`. Times are Unix epoch seconds (server-attested).

```sql
-- =========================================================
-- NekoSuneAPPSVRC Community Ranks — schema v1
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nsa_user_id       TEXT    NOT NULL UNIQUE,          -- internal NekoSuneAPPSVRC id
    vrc_user_id       TEXT    UNIQUE,                   -- usr_... (nullable until linked)
    display_name      TEXT    NOT NULL,
    vrc_join_date     INTEGER,                          -- epoch s, attested
    nsa_created_at    INTEGER NOT NULL,
    fingerprint_hash  TEXT,                             -- hashed machine/install id
    vrc_trust_seed    TEXT,                             -- migration seed rank (§10)
    is_verified       INTEGER NOT NULL DEFAULT 0,
    recognition_tier  INTEGER NOT NULL DEFAULT 0,       -- 0 none /1 helper /2 staff
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rank_scores (
    user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- component breakdown (each already capped per §2.2)
    pts_join_age          REAL NOT NULL DEFAULT 0,
    pts_years_active      REAL NOT NULL DEFAULT 0,
    pts_account_age       REAL NOT NULL DEFAULT 0,
    pts_world_uploads     REAL NOT NULL DEFAULT 0,
    pts_avatar_uploads    REAL NOT NULL DEFAULT 0,
    pts_creator_activity  REAL NOT NULL DEFAULT 0,
    pts_contributions     REAL NOT NULL DEFAULT 0,
    pts_events            REAL NOT NULL DEFAULT 0,
    pts_reputation        REAL NOT NULL DEFAULT 0,
    pts_recognition       REAL NOT NULL DEFAULT 0,
    raw_score             REAL NOT NULL DEFAULT 0,
    abuse_penalty         REAL NOT NULL DEFAULT 1.0,     -- 0..1
    final_score           INTEGER NOT NULL DEFAULT 0,    -- 0..1000
    current_rank          TEXT NOT NULL DEFAULT 'visitor',
    rank_locked           INTEGER NOT NULL DEFAULT 0,    -- manual hold (staff)
    computed_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT    NOT NULL,        -- bug_report|pr|docs|help|translation|asset|partner
    points        REAL    NOT NULL,
    description   TEXT,
    evidence_url  TEXT,
    verified_by   INTEGER REFERENCES users(id),   -- staff/peer verifier (null = pending)
    status        TEXT NOT NULL DEFAULT 'pending', -- pending|verified|rejected
    created_at    INTEGER NOT NULL,
    verified_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_contrib_user ON contributions(user_id, status);

CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    host_user_id  INTEGER REFERENCES users(id),
    organiser_key TEXT,                  -- groups repeat events by same organiser (§4.3)
    starts_at     INTEGER NOT NULL,
    ends_at       INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_attendance (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method        TEXT NOT NULL,         -- host_token|telemetry
    verified      INTEGER NOT NULL DEFAULT 0,
    credited_value REAL NOT NULL DEFAULT 0,  -- after diversity discount
    created_at    INTEGER NOT NULL,
    UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS world_statistics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vrc_world_id    TEXT UNIQUE,         -- wrld_...
    name            TEXT,
    content_hash    TEXT,                -- dedup
    is_published    INTEGER NOT NULL DEFAULT 0,
    is_public       INTEGER NOT NULL DEFAULT 0,
    favourites      INTEGER NOT NULL DEFAULT 0,
    visits          INTEGER NOT NULL DEFAULT 0,
    published_at    INTEGER,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_user ON world_statistics(user_id);

CREATE TABLE IF NOT EXISTS avatar_statistics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vrc_avatar_id   TEXT UNIQUE,         -- avtr_...
    name            TEXT,
    content_hash    TEXT,
    is_public       INTEGER NOT NULL DEFAULT 0,
    favourites      INTEGER NOT NULL DEFAULT 0,
    published_at    INTEGER,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avatar_user ON avatar_statistics(user_id);

CREATE TABLE IF NOT EXISTS reputation_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user    INTEGER REFERENCES users(id),
    kind          TEXT NOT NULL,         -- endorse|sanction|warn|throttle
    weight        REAL NOT NULL,         -- already rank-weighted (§4.4)
    reason        TEXT,
    created_at    INTEGER NOT NULL,
    UNIQUE(target_user, actor_user, kind, created_at)
);

CREATE TABLE IF NOT EXISTS rank_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_rank      TEXT,
    new_rank      TEXT NOT NULL,
    old_score     INTEGER,
    new_score     INTEGER NOT NULL,
    reason        TEXT,                  -- recompute|contribution|sanction|manual|migration
    actor         TEXT,                  -- system | staff:<id>
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_user ON rank_history(user_id, created_at);
```

---

## 8. API Design (Express)

Base path: `/api/v1`. All write endpoints require an auth token; staff-only actions require
a staff scope. Responses are JSON. Errors use `{ "error": { "code", "message" } }`.

| Method | Path                         | Scope    | Purpose |
|--------|------------------------------|----------|---------|
| GET    | `/user/rank`                 | user     | Current rank + label + eligibility |
| GET    | `/user/score`                | user     | Full point breakdown |
| GET    | `/leaderboard`               | public*  | Ranked list (opt-in members only) |
| POST   | `/contribution`              | user     | Submit a contribution for verification |
| POST   | `/event-attendance`          | user/host| Claim / confirm attendance |
| POST   | `/recompute` (internal)      | staff    | Force a recompute for a user |
| POST   | `/moderation/sanction`       | staff    | Apply penalty / recognition |

`GET /leaderboard` only includes users with `shareToLeaderboard = true`.

### 8.1 Example responses

**`GET /api/v1/user/rank?nsaUserId=nsa_abc123`**

```json
{
  "user": { "nsaUserId": "nsa_abc123", "displayName": "Mika" },
  "rankSystem": "NekoSuneAPPSVRC Community Ranks",
  "rank": {
    "key": "veteran",
    "label": "NekoSuneAPPSVRC Community Rank: Veteran",
    "tier": 5,
    "color": "#C9A227"
  },
  "score": 842,
  "ogModeVisible": true,
  "eligibility": {
    "nextRank": "legend",
    "scoreToNext": 108,
    "pendingGates": ["join_age >= 5y (currently 3.8y)", "staff_nomination"]
  },
  "computedAt": 1771027200
}
```

**`GET /api/v1/user/score?nsaUserId=nsa_abc123`**

```json
{
  "finalScore": 842,
  "rawScore": 842,
  "abusePenalty": 1.0,
  "breakdown": {
    "joinAge": 95, "yearsActive": 142, "accountAge": 38,
    "worldUploads": 78, "avatarUploads": 52, "creatorActivity": 71,
    "contributions": 96, "events": 60, "reputation": 60, "recognition": 50
  },
  "maxByFactor": {
    "joinAge": 150, "yearsActive": 150, "accountAge": 50,
    "worldUploads": 120, "avatarUploads": 80, "creatorActivity": 100,
    "contributions": 120, "events": 80, "reputation": 100, "recognition": 50
  }
}
```

**`GET /api/v1/leaderboard?limit=3`**

```json
{
  "rankSystem": "NekoSuneAPPSVRC Community Ranks",
  "generatedAt": 1771027200,
  "entries": [
    { "position": 1, "displayName": "Yuki",  "rank": "legend",  "score": 974 },
    { "position": 2, "displayName": "Mika",  "rank": "veteran", "score": 842 },
    { "position": 3, "displayName": "Aero",  "rank": "veteran", "score": 821 }
  ]
}
```

**`POST /api/v1/contribution`**

```jsonc
// request
{ "nsaUserId": "nsa_abc123", "type": "pr",
  "description": "Added Kick follower module", "evidenceUrl": "https://github.com/.../pull/42" }
```
```json
{
  "id": 1187,
  "status": "pending",
  "type": "pr",
  "provisionalPoints": 15,
  "message": "Submitted for staff verification. Points apply once verified."
}
```

**`POST /api/v1/event-attendance`**

```jsonc
// request
{ "nsaUserId": "nsa_abc123", "eventId": 55, "method": "host_token", "token": "evt_..." }
```
```json
{
  "eventId": 55,
  "verified": true,
  "method": "host_token",
  "creditedValue": 0.7,
  "note": "Same-organiser diversity discount applied (2nd event by organiser)."
}
```

---

## 9. Visual Design

Colours chosen for legibility on the app's dark theme (`#0b0b14`). Each rank ships a solid
hex plus an accent for badges/glows. Every badge **must** carry the "NSA" wordmark.

| Rank          | Primary hex | Accent hex | Feel |
|---------------|-------------|------------|------|
| Visitor       | `#8A8F98`   | `#B5BAC2`  | Neutral grey |
| New User      | `#4FB477`   | `#7FE0A6`  | Fresh green |
| User          | `#3FA7D6`   | `#79CBEF`  | Calm blue |
| Known User    | `#7C5CFF`   | `#A78BFA`  | Violet |
| Trusted User  | `#2DD4BF`   | `#5EEAD4`  | Teal trust |
| Veteran       | `#C9A227`   | `#F4D35E`  | Aged gold |
| Legend        | `#E0115F`   | `#FF6FB5`  | Rare rose-crimson + animated shimmer |

> Veteran/Legend may use a subtle gradient (primary→accent) and Legend an animated
> shimmer to signal rarity. When `ogMode = false`, render Trusted User styling instead.

---

## 10. Migration Strategy (VRChat trust → seed score)

On first enable, map the user's **current VRChat trust rank** into a **starting seed score**
that lands them at a fair equivalent tier — then let them *progress* toward Veteran/Legend
through this system's own factors. The seed is a one-time floor, recorded in
`users.vrc_trust_seed`, and **never** re-read afterwards.

| VRChat trust rank | Seed score | Lands at      |
|-------------------|-----------:|---------------|
| Visitor           |        50  | Visitor       |
| New User          |       150  | New User      |
| User              |       300  | User          |
| Known User        |       500  | Known User    |
| Trusted User      |       680  | Trusted User  |

Rules:
- The seed is a **floor on first computation only**: `finalScore = max(seed, computed)`.
- VRChat trust **cannot** seed directly into Veteran/Legend — those are earned here.
- After seeding, every recompute uses the real factor formulas; if earned score exceeds
  the seed, the seed becomes irrelevant.
- Migration writes a `rank_history` row with `reason = 'migration'`.

---

## 11. Computation, Recompute & Hysteresis

- **Recompute triggers:** nightly batch, on verified contribution/event, on moderation
  action, and on manual staff request.
- **Hysteresis band:** to stop rank flicker, promotion uses the threshold but demotion
  requires dropping **40 points below** it (e.g. promote to Veteran at 800, demote at < 760).
- **Locking:** `rank_scores.rank_locked = 1` lets staff freeze a rank during disputes.
- **Audit:** every change appends to `rank_history`; nothing is mutated silently.

### 11.1 Reference scoring pseudocode

```js
function computeScore(u, stats) {
  const sat = (n, cap, k) => cap * (1 - Math.exp(-n / k));
  const p = {
    joinAge:         Math.min(150, stats.yearsSinceJoin * 25),
    yearsActive:     sat(stats.activeYears, 150, 3),
    accountAge:      Math.min(50, stats.monthsInstalled * 2.1),
    worldUploads:    sat(stats.publishedWorlds, 120, 4),
    avatarUploads:   sat(stats.publicAvatars, 80, 6),
    creatorActivity: Math.min(100, creatorScore(stats)),
    contributions:   Math.min(120, stats.contributionPoints),
    events:          sat(stats.verifiedEvents, 80, 8),
    reputation:      clamp(50 + stats.repNet, 0, 100),
    recognition:     Math.min(50, u.recognition_tier * 25),
  };
  const raw = Object.values(p).reduce((a, b) => a + b, 0);
  const final = Math.round(clamp(raw, 0, 1000) * stats.abusePenalty);
  return { breakdown: p, raw, final, rank: rankFor(final, u, stats) };
}
```

---

## 12. Example User Progression Scenarios

**A. Newcomer (Day 1):** No VRChat link, app just installed.
`joinAge 0 + active 0 + accountAge ~2 + … = ~2 pts` → **Visitor**. After linking VRChat
(2-year account) and verifying: `joinAge 50 + yearsActive ~78 + … ≈ 140` → **New User**.

**B. Casual creator (2 years in):** 3 avatars, 0 worlds, attends a few events.
`joinAge 50 + yearsActive 95 + accountAge 25 + avatars 30 + creator 35 + events 25 +
rep 55 = ~315` → **User**, trending toward Known User as activity continues.

**C. Long-time builder (4 years, 6 worlds, active):**
`joinAge 100 + yearsActive 145 + accountAge 40 + worlds 95 + avatars 40 + creator 80 +
contrib 50 + events 45 + rep 65 + recog 0 = ~660` → **Trusted User**; one more contribution
push + clean record clears the Veteran gates → **Veteran**.

**D. Community pillar (6 years, 8 worlds, 20 avatars, hosts events, core contributor, staff helper):**
score ≈ 968, meets every Legend gate, receives 2 staff sign-offs → **Legend** (rare).

**E. Avatar spammer:** uploads 80 avatars in a week, no adoption, alt-boosted endorsements.
Saturating curve caps avatars at ~80; adoption factor ~0; sockpuppet endorsements discounted;
rate-dampening sets `abusePenalty = 0.5`. Net result stays around **User** — farming fails.

---

## 13. Abuse-Prevention Recommendations (summary)

1. **Time is the moat** — keep tenure/recency the largest, un-fakeable share.
2. **Saturate everything countable** — never reward raw upload/event volume linearly.
3. **Verify before crediting** — contributions and events are pending until human/host attested.
4. **Weight reputation by reputation** — low-rank endorsements are near-zero; discount rings.
5. **Bind identity** — fingerprint + VRChat id; alts can't transfer or stack reputation.
6. **Penalise multiplicatively** — confirmed abuse scales the whole score down, with slow recovery.
7. **Gate the OG tiers manually** — Legend always requires staff nomination; Veteran has hard gates.
8. **Log immutably** — `rank_history` makes every rank explainable and appealable.
9. **Decay activity, not tenure** — reward continued presence without erasing years served.
10. **Cap rarity by policy** — if Legends grow past target, raise the bar, never auto-inflate.
```
