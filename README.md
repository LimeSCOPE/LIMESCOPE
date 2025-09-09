# LimeScope — Live Solana Token Feed

A tiny, snappy **Express + static HTML** app that shows a live Solana token feed with smooth UI touches:

* Sticky header with brand + **mint link**
  `DQyv2zD5yUVvbq6YS46osXLcZA12mrahhgXSjn81BAGS` → opens on sagb.xyz, lime glow on hover
* Scrolling ticker with **edge fade** (mask)
* Live feed cards (price, MCAP, % change) with **copy mint**, social links, and quick **buy** buttons
* **Leaderboard** view
* **Alpha** members table (admin/star, social, copy wallet, pagination)
* Footer quick links: **X**, **GitHub**, **API**, **Node.js**
* Lightweight backend proxy with compression and CORS

> **Demo stack:** Node 18+, Express, vanilla JS/HTML/CSS (no build step).

---

## ✨ Features

* **Real-time feel:** polls feeds and markets, updates cards in place (no flicker)
* **Creator info:** fetches creator/royalty data (cached)
* **Masked ticker:** CSS mask fades items as they enter/leave the rail
* **Auth-safe proxy:** server injects Bearer token for upstream APIs (never exposed to the browser)
* **GMGN logo proxy:** simple SVG proxy to avoid mixed CORS issues
* **Mobile-friendly:** responsive grid
* **Lime aesthetic:** deep black base with neon lime/yellow accents and crosshair logo (Font Awesome)

---

## 📁 Project Structure

```
.
├── public/
│   ├── index.html        # main app (Live / Top / Alpha) — LimeScope theme
│   ├── token.html        # token details page shell
│   ├── limescope.svg     # SVG favicon (lime crosshair)
│   └── logo.png          # optional png fallback icon
├── server.js             # Express server + proxies (LimeScope UA)
└── README.md
```

---

## 🚀 Quick Start

### 1) Requirements

* **Node.js 18+** (for global `fetch`)
* **npm** or **pnpm**

### 2) Install

```bash
npm install
```

### 3) Configure environment

Create a `.env` (or set env vars in your host):

```bash
# Required for authenticated upstream calls
BAGS_BEARER="Bearer <YOUR-BEARER-HERE>"

# Optional: port (Render/Heroku set this automatically)
PORT=3000

# Optional: allowed origin for CORS (add your deployed URL)
RENDER_EXTERNAL_URL="https://limescope.fun"
```

> If you don’t set `BAGS_BEARER`, authenticated endpoints will fail (creator, market, subscription). Public feeds will still load.

### 4) Run

```bash
npm start
# or
node server.js
```

Open: `http://localhost:3000`

---

## 🌐 Deploy Notes

* **Render / Railway / Heroku:**

  * Start command: `node server.js`
  * Add env var `BAGS_BEARER`
  * Keep `PORT` unset (platform injects it)
* **Static caching:** `public/` is served with `maxAge: 1h`

---

## 🔗 Frontend Customization

These live in `public/index.html`.

### Mint Link (under brand)

* Address: `DQyv2zD5yUVvbq6YS46osXLcZA12mrahhgXSjn81BAGS`
* Link: `https://sagb.xyz/solana/DQyv2zD5yUVvbq6YS46osXLcZA12mrahhgXSjn81BAGS`
* Styled as a monospace pill; **lime** glow on hover/focus.

Change it here if needed:

```html
<a class="mint-link" target="_blank"
   href="https://sagb.xyz/solana/DQyv2zD5yUVvbq6YS46osXLcZA12mrahhgXSjn81BAGS">
  DQyv2zD5yUVvbq6YS46osXLcZA12mrahhgXSjn81BAGS
</a>
```

### Header / Logo

* Uses a lime crosshair from **Font Awesome**: `<i class="fa-solid fa-crosshairs"></i>`
* Favicon is `public/limescope.svg` (SVG). Keep `logo.png` as a fallback if you like.

### Ticker Fade

* Implemented via CSS **mask** on `.ticker-rail`:

```css
.ticker-rail{
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 36px), transparent 100%);
          mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 36px), transparent 100%);
}
```

### Footer Links

Configure these to your handles:

* X (Twitter): `https://x.com/LimeScope` *(placeholder)*
* GitHub: `https://github.com/limescope` *(placeholder)*
* API: `https://LimeSCOPE.mintlify.app/`
* Node.js: `https://nodejs.org/en`

---

## 🧩 Backend (Express) Overview

The server serves static files and proxies upstream APIs (so the browser never sees your bearer token).

```js
const API = "https://api2.LimeSCOPE.fm/api/v1";
const BAGS_BEARER = process.env.BAGS_BEARER || "Bearer <YOUR-BEARER-HERE>";
```

### CORS

By default allows:

* `https://limescope.fun`
* `https://www.limescope.fun`
* `process.env.RENDER_EXTERNAL_URL` (if set)
* local dev (`http://localhost:3000`, `http://127.0.0.1:3000`)

Adjust in `server.js` → `ALLOW_ORIGINS`.

### Routes

**Static**

* `/` → `public/index.html`
* `/token/:tokenAddress` → `public/token.html`

**Proxies**

* `GET /api/feed` → `${API}/token-launch/feed` *(no auth)*
* `GET /api/leaderboard` → `${API}/token-launch/leaderboard` *(no auth)*
* `GET /api/creator?tokenMint=...` → `${API}/token-launch/creator/v2` *(auth)*
* `GET /api/market?tokenAddress=...` → `${API}/LimeSCOPE/token/find` *(auth)*
* `GET /api/token-overview?tokenAddress=...` → `${API}/token/{ca}/overview?extensions=allTimeHigh,creationMetadata` *(auth)*
* `GET /api/token-ohlcv?tokenAddress=...&resolution=1&from=...&to=...` → `${API}/token/{ca}/ohlcv/v2` *(auth)*
* `GET /api/token-trades?tokenAddress=...` → `${API}/token/{ca}/trades` *(auth)*
* `GET /api/subscription` → `${API}/subscription` *(auth)*
* `GET /api/subscription/info/:uuid` → `${API}/subscription/info/{uuid}` *(auth)*
* `GET /api/gmgn-logo` → proxies `https://gmgn.ai/static/logo.svg`

> **Note:** Authenticated routes require `BAGS_BEARER`. The server injects `Authorization` so the client never handles secrets.

---

## 🧪 Scripts

Minimal `package.json` example:

```json
{
  "name": "limescope",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "compression": "^1.7.4",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

---

## 🖼️ Screenshots

Place screenshots in `/docs` and reference them here:

```
![Header + Ticker](docs/header.png)
![Live Feed](docs/live-feed.png)
```

---

## 🔒 Security

* Keep `BAGS_BEARER` **only** on the server.
* Do not commit `.env` files.
* CORS is restricted by default; add your production origin(s) explicitly.

---

## 🛠️ Troubleshooting

* **Blank creator/market data:** ensure `BAGS_BEARER` is set and valid.
* **CORS errors:** add your deployed origin to `ALLOW_ORIGINS` or set `RENDER_EXTERNAL_URL`.
* **Node fetch missing:** you’re on Node < 18; use a `node-fetch` polyfill.

---

## 🤝 Contributing

PRs welcome! Please:

1. Open an issue describing the change.
2. Keep PRs small and focused.
3. Avoid introducing build steps unless necessary.

---

## 📄 License

MIT © LimeScope

---

## 🧭 Links

* X (formerly Twitter): [https://x.com/LimeScope](https://x.com/LimeScope)
* GitHub: [https://github.com/limescope](https://github.com/limescope)
* API Docs: [https://LimeSCOPE.mintlify.app/](https://LimeSCOPE.mintlify.app/)
* Node.js: [https://nodejs.org/en](https://nodejs.org/en)
