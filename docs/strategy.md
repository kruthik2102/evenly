# Evenly: a free, serverless group-expense app

The question: how do several people share one expense ledger with no backend
server and no database, and still get every Splitwise Pro feature for free?

The answer in one line: **every phone holds the whole ledger as an append-only,
encrypted event log that merges without conflicts, and people exchange the
missing events over channels they already use: a link in WhatsApp, a QR code
across the table, or a direct peer-to-peer connection.**

## 1. Where the app lives

- A **Progressive Web App**: static HTML/CSS/JS, no build step. It can be
  installed to the home screen and works fully offline (service worker).
- Hosting is optional static file hosting (GitHub Pages, Cloudflare Pages, or the
  phone itself via `localhost`). A static host serves files and never sees your
  data. Nothing runs server-side and nothing is stored server-side.
- Storage is **IndexedDB on each device**. The device *is* the database.
- Cost: ₹0. There's no account system and no subscription to build.

## 2. Data model: an event log that can't conflict

Every change is an **operation** (op):

```text
{ id, group, device, seq, clock, entity, entityId, set: { field: value, … } }
```

- `device` + `seq` make the id unique and give each device a gap-free counter.
- `clock` is a **hybrid logical clock**: `max(wall time, last seen + 1)`, so it
  roughly tracks real time but never runs backwards.
- `set` writes fields on one entity (group, member, expense, payment, comment,
  conversion). Each field is a **last-writer-wins register** keyed by
  `(clock, device)`.

The current state is just a fold over the ops. Because "keep the field with the
larger `(clock, device)`" is commutative, associative and idempotent, **any two
devices that have seen the same set of ops show exactly the same ledger, in
whatever order the ops arrived.** That's a state-based CRDT. You don't need a
server to decide who wins.

Edge cases this handles without extra code:

| Situation | Result |
|---|---|
| Two people add expenses offline | Both kept (different ids) |
| Two people edit the same expense | Each field resolves to the latest edit; shown in history |
| An edit arrives before the create | Entity fills in when the create lands |
| Delete vs. edit race | `deleted` is a field too; "Restore" is just a later write |
| Same bundle imported twice | Ops are keyed by id, so it's a no-op |
| Recurring expense materialised on two phones | Occurrence id is `templateId@date`, so both write identical values |

Edit history and the Activity feed fall out of the log at no extra cost.

## 3. Money that always adds up

- Amounts are **integers in minor units** (paise, cents; 0 decimals for JPY,
  3 for KWD, from `Intl`). No floating-point drift.
- Every split mode (equal, exact, percent, shares, adjustment, itemized with
  tax/tip) ends in **largest-remainder rounding**, so the shares always sum to
  exactly the total. The leftover paise go to a deterministic member order so
  every device rounds identically.
- Balances are per currency. **Currency conversion** is itself an op that stores
  the rate used, so every device converts identically and history is auditable.
- **Simplify debts** = greedy min-cash-flow on net balances (largest debtor pays
  largest creditor), giving at most *n − 1* transfers. With it off, pairwise
  debts are derived from who-paid-for-whom.

## 4. How phones talk without a server

Three transports, all carrying the same thing: **encrypted op bundles**.

### 4a. Share link (default, asynchronous)
1. Tap **Share updates** in a group.
2. Evenly packs every op the group hasn't been sent yet, compresses it
   (`CompressionStream` deflate), encrypts it with the group key (AES-GCM-256),
   and puts it in a link **after the `#`**: `…/#b=<data>`.
3. Send it however you like (WhatsApp, Telegram, SMS) via the system share sheet.
4. A friend taps it, Evenly opens and merges.

Browsers never send the part after `#` to any server, so even the static host
can't see it. Large bundles go as a `.evenly` file through the same share sheet.

### 4b. QR code (in person)
The invite and small bundles fit in a QR code. Scanning uses the browser's
`BarcodeDetector` where available, with paste as the fallback.

### 4c. Live peer-to-peer (WebRTC)
Two phones open a WebRTC data channel. The handshake (offer → answer) is
exchanged as two QR codes or links. That's "manual signalling", so no signalling
server is involved. Once connected, each side sends its **version vector**
(`{device: highest seq}`) and receives exactly the ops it's missing, in both
directions. On the same Wi-Fi this needs no third party at all. Across the
internet a public STUN server only tells a phone its own public address; it
never sees or stores data.

## 5. Groups, invites and identity

- First launch creates a **device identity**: a random id plus a display name,
  an optional UPI ID and a default currency. There are no accounts or passwords.
- Creating a group creates a random **group id** and a **group key**.
- **Invite link / QR** = group id + key + snapshot, in the `#` fragment. Whoever
  has the link can read and write the group, the same trust model as a WhatsApp
  group invite link. To shut someone out, rotate to a new group (roadmap: key
  rotation in place).
- Members you add by name are placeholders. When a friend joins on their own
  phone, they **claim** their placeholder, so the history stays attached to them
  and the Friends tab merges them across groups.

## 6. Pro features, free and on-device

| Pro feature | How Evenly does it without a server |
|---|---|
| Unlimited expenses | No artificial limit; IndexedDB holds hundreds of thousands of ops |
| Expense search | Full-text filter over the in-memory ledger |
| Charts and graphs | SVG drawn on device: by category, by month, by member |
| Currency conversion | Rates from a free public feed (frankfurter.app, ECB data) or typed manually; the rate is stored in the op |
| Receipt scanning | Tesseract.js (WebAssembly OCR) runs in the browser; the photo never leaves the phone |
| Itemization | Items × who-had-it, tax/tip shared proportionally |
| Save default splits | A group field, synced like any other |
| Trip Pass | Not needed; every member already has everything |

## 7. What a serverless app can't do (and the substitutes)

| Splitwise has | Why it needs a server | Evenly instead |
|---|---|---|
| Push notifications when a friend adds an expense | Push needs a push service plus a sender | Activity feed with unread badge after each merge; the share message itself is the notification |
| Email reminders and summaries | Needs a mail server | **Remind…** composes a WhatsApp/SMS message for you to send |
| Instant sync with no action | Needs an always-online relay | Share link or live P2P; optional shared cloud folder (roadmap) |
| Account recovery | Needs an account store | **Backup / restore** JSON file; any group member's phone holds a full copy too |
| In-app payments | Needs a payment processor | **UPI deep link** opens GPay/PhonePe/Paytm with amount and payee pre-filled; then record it |

## 8. Security posture

- Data at rest stays in the browser's per-site storage on your device.
- Data in transit is AES-GCM encrypted with the group key; the key only travels
  inside invite links you choose to share.
- Optional **app lock** with the device's biometrics/screen lock (WebAuthn
  platform authenticator) with a re-lock timeout.
- Known limits: anyone with the group link is a full member; per-op signatures
  (Ed25519) and key rotation are the next hardening steps.

## 9. Build and design approach

- Vanilla ES modules: no framework and no build. The core (`money`, `split`,
  `ledger`, `balances`) is pure and unit-tested in Node.
- Apple's *Designing Fluid Interfaces* principles, implemented with a small
  spring solver using damping ratio and response:
  - sheets and the edge-swipe "back" track the finger 1:1, inherit release
    velocity, project momentum (`v/1000 · d/(1−d)`), rubber-band past limits,
    and can be grabbed mid-animation
  - default springs critically damped (1.0, 0.35 s); bounce (0.8) only after a
    flick
  - press feedback on pointer-down; haptic tick on commit
  - translucent bars (`backdrop-filter`) over scrolling content; large titles
    that collapse into the bar
  - size-specific tracking, system font, `rem` everywhere so text scaling works
  - `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`
    all honoured
- iPad-style **split view** on tablets (sidebar + detail), tab bar on phones.

## 10. Roadmap

1. Per-op Ed25519 signatures and group key rotation.
2. Shared-folder sync (each device writes its own log file into a Drive/iCloud
   folder that everyone already shares, so there's still no custom server).
3. Wrap with Capacitor for a Play Store/App Store build (same code).
4. Import from a Splitwise CSV export.
