# Splitwise feature catalogue

Observed on a Xiaomi Pad 7 (Android 16) running Splitwise 26.9.1 (build 963),
free account, on 21 Oct 2026. Every screen was opened read-only over ADB; nothing
was saved, sent or purchased. Premium features were catalogued from the in-app
"Upgrade to Splitwise Pro" paywall and the screens it guards.

Method: black-box observation of the running app (UI hierarchy dumps and
screenshots). The APK was **not** decompiled and no Splitwise code, artwork or
branding is reused. Evenly is an original implementation of the same
*functional ideas*, which is what the strategy and the app are built on.

Legend: **Free**: available on the free plan · **Pro**: behind the paywall
· ✅ = implemented in Evenly (all free)

## 1. Navigation shell

| Feature | Tier | Notes | Evenly |
|---|---|---|---|
| Four tabs: Groups, Friends, Activity, Account | Free | Bottom bar, unread dot on Activity | ✅ tab bar on phone, sidebar on tablet |
| Global "Add expense" and "Scan" floating buttons | Free / Pro | Scan opens paywall | ✅ |
| Header search button | Pro | Opens paywall on free plan | ✅ |
| Header "Create group" / "Add friends" button | Free | Context-sensitive per tab | ✅ |

## 2. Groups tab (dashboard)

| Feature | Tier | Notes | Evenly |
|---|---|---|---|
| "Overall, you owe / you are owed X" summary | Free | Net across every group and friend | ✅ |
| Balance filter menu | Free | All groups · Outstanding balances · Groups you owe · Groups that owe you | ✅ |
| Group card: cover image, name, your net, up to 2 per-person lines, "Plus N other balances" | Free | Green = owed to you, orange = you owe | ✅ |
| "Non-group expenses" pseudo-group | Free | Expenses with friends outside any group | ✅ (direct ledgers) |
| Auto-hide groups settled up for over a month, with "Show N settled-up groups" | Free | | ✅ |

## 3. Group detail

| Feature | Tier | Notes | Evenly |
|---|---|---|---|
| Header: cover, name, member-count chip | Free | | ✅ |
| Balance summary, expandable per-person lines | Free | | ✅ |
| Action chips: Settle up, Charts, Balances, Totals, Whiteboard, Export | Free except Charts | Charts → paywall | ✅ all |
| Expense feed grouped by month; date block, description, "X paid ₹Y", "you borrowed / you lent / not involved" + amount | Free | Payments shown inline as "A paid B ₹Y" | ✅ |
| Group-level "Add expense" and "Scan" FABs | Free / Pro | | ✅ |

### 3a. Balances
- Per member: "gets back ₹X in total" / "owes ₹X in total", expandable to pairwise debts. ✅
- Per pairwise row: **Remind…** and **Settle up** buttons. ✅
- Banner: "Turning on simplify debts would save your group N repayments." with a one-tap enable. ✅

### 3b. Totals
- "Month YYYY group spending", bar chart of recent months. ✅
- Total spent · Your share · your % of group spending. ✅
- Month stepper (back/forward), month picker, "All time". ✅

### 3c. Whiteboard
- Free-text shared note per group ("landlord's address, wifi password…"). ✅

### 3d. Export
- Generates `export.csv` and hands it to the system share sheet. ✅ (CSV + full JSON backup)

### 3e. Group settings
- Edit name, cover image, **type**: Trip · Home · Couple · Other. ✅
- Members list with each member's net; **Add people to group**; **Invite via link**. ✅
- Advanced: **Simplify group debts** toggle. ✅
- Advanced: **Default split** (*Pro*): "Paid by you and split equally" template for new expenses. ✅
- **Leave group** (blocked while you have outstanding debts), **Delete group**. ✅

## 4. Add / edit expense

| Field | Tier | Notes | Evenly |
|---|---|---|---|
| "With you and:" people/group token field | Free | Autocomplete | ✅ |
| Category picker (searchable, grouped) | Free | Entertainment, Food & drink, Home, Life, Transportation, Uncategorized, Utilities, each with sub-categories | ✅ |
| Description, amount, currency (full ISO list, searchable) | Free | | ✅ |
| **Paid by**: any single member, or **Multiple people** with amounts | Free | | ✅ |
| **Split**: Equally (choose who) · Unequally (exact amounts) · By percentages · By shares · By adjustment | Free | Live "₹X/person", "0% of 100%", "N left" feedback | ✅ |
| **Itemization** (split line by line) | Pro | | ✅ incl. tax/tip |
| Group selector | Free | | ✅ |
| Date picker with **Repeat**: Off · Weekly · Fortnightly · Monthly · Yearly | Free | | ✅ |
| Attach receipt image | Free | | ✅ |
| Notes | Free | | ✅ |
| **Receipt scanning** (OCR into an expense) | Pro | | ✅ on-device OCR |
| **Save default splits** | Pro | | ✅ |
| **Unlimited expenses** | Pro | Free plan is rate-limited | ✅ no limits |

## 5. Expense detail
- Category icon, receipt thumbnail, description, amount, "Added by X on date". ✅
- "X paid ₹Y" and a per-person "owes ₹Z" breakdown. ✅
- Toolbar: attach image, delete, edit. ✅ (+ undo/restore)
- Comment thread with composer. ✅
- Edit history. ✅ (falls out of the event log for free)

## 6. Settle up
- "Select a balance to settle" list with direction and amount; "More options" to pick any recipient. ✅
- "Record a payment" screen: editable amount, payer → payee; disclaimer that no money moves. ✅
- (Evenly adds) UPI deep link to open GPay/PhonePe/Paytm with the amount pre-filled. ✅

## 7. Friends tab
- Same overall summary and filter as Groups. ✅
- Per-friend net with a breakdown per shared group ("owes you ₹X for 'Group'"). ✅
- Friend detail: chips **Settle up · Remind… · Charts · Convert to INR · Export**, shared-group and non-group history. ✅

## 8. Activity tab
- Reverse-chronological feed: expense added/edited/deleted, payment recorded, member added, group created, settings changed (e.g. simplify debts turned on), with "N days ago, time" and your resulting balance. ✅
- Unread dot on the tab. ✅
- Search (Pro). ✅

## 9. Account tab
- Profile (name, photo, email/phone), **Edit**. ✅ (name, emoji, UPI ID, default currency)
- **Scan code** (QR to add friends). ✅ (QR invite)
- Splitwise Pro upsell. ✗ (nothing to sell)
- Preferences: **Email settings**, **Device & push notification settings** (channels: expense added, etc.), **Security** (biometric/device-passcode lock with timeout: 5 s…), **Appearance** (Light · Dark · System default). ✅ except email/push, see strategy §7
- Help & Support, Rate, Log out, version. ✅ (About, Reset)

## 10. Pro paywall (complete list as shown in-app)

| Pro feature | Evenly |
|---|---|
| Expense search | ✅ full-text, on device |
| Unlimited expenses | ✅ |
| 30-day Trip Pass (Pro for a whole group, yearly plan only) | ✅ unnecessary, everyone gets everything |
| Currency conversion | ✅ per-group "Convert to …" with recorded rate |
| Receipt scanning | ✅ Tesseract OCR in the browser |
| Itemization | ✅ |
| Charts and graphs | ✅ by category, by month, by member |
| Save default splits | ✅ |

Plans shown: Individual + Trip Pass (yearly), Duo + Trip Pass (yearly), plus
monthly options behind "View all options"; recurring billing.
