# Evenly

Split expenses with friends. Free, private, no servers.

**Open it:** https://kruthik2102.github.io/evenly/. On Android, choose
**Install** (or ⋮ → *Add to Home screen*) in Chrome to get an app icon,
full-screen launch and offline use.

Evenly is a feature-complete, serverless take on group-expense apps like
Splitwise, including everything Splitwise puts behind Pro: receipt scanning,
itemized splits, charts, search, currency conversion, default splits and
unlimited expenses. Every group lives on each member's phone. Phones exchange
changes through encrypted links (WhatsApp, SMS, anything), QR codes, or a
direct phone-to-phone connection.

- **What Splitwise does, feature by feature:** [docs/feature-catalog.md](docs/feature-catalog.md)
- **How it works without a backend or database:** [docs/strategy.md](docs/strategy.md)

## Run it

Needs Node.js 18+ (no `npm install`; there are no dependencies).

```bash
node scripts/serve.mjs
```

Open http://localhost:5180. ES modules, WebCrypto and the offline service
worker need `localhost` or `https`, so double-clicking `index.html` won't work.

### On an Android phone or tablet over USB/Wi-Fi debugging

```bash
adb reverse tcp:5180 tcp:5180
```

Then open `http://localhost:5180` in Chrome on the device and choose
**Install** to put Evenly on the home screen.

### Share it with friends (free hosting)

Push this folder to a GitHub repository and turn on **GitHub Pages**, or drop
it on Cloudflare Pages or Netlify. The host only serves static files. It never
receives anyone's data, because invite and update links carry everything after
the `#`, which browsers don't send to servers.

## Tests

```bash
node --test tests/core.test.mjs
```

The tests cover rounding, all six split modes, ledger convergence under
shuffled and duplicated delivery, balances and debt simplification, recurring
dates, encryption, receipt parsing, currency conversion, and a full two-phone
invite → offline edits → link exchange → agreement round trip.

## Layout

| Path | What it is |
|---|---|
| `js/core/` | Pure logic: money, splits, CRDT ledger, balances, recurring, receipt parser |
| `js/sync/` | Compression + AES-GCM codec, share links, WebRTC live sync |
| `js/app/store.js` | IndexedDB persistence and every user action as a ledger op |
| `js/ui/` | Springs and gestures, navigation stack, sheets, menus, swipe rows |
| `js/screens/` | All screens |
| `css/app.css` | iOS-style tokens, light/dark, reduced motion/transparency, contrast |
| `sw.js` | Offline cache |

## Design notes

The interface follows Apple's *Designing Fluid Interfaces*:

- Springs are specified by damping ratio and response and are always
  interruptible: they start from the on-screen value and keep velocity.
- Sheets, edge-swipe-back and swipe-to-delete track the finger 1:1, project
  momentum on release, and rubber-band past their limits.
- Press feedback happens on pointer-down.
- Bars are translucent material over scrolling content, and large titles
  collapse into the bar.
- Text sizes are in `rem` so system text size scales the layout.
- `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast` are all handled.

Phones get a tab bar; tablets in landscape get an iPad-style split view.
Android's back button works as in-app back.
