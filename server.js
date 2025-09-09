// server.js

// --- Load .env only in local/dev (Render sets env for you) ---
const runningOnRender = !!process.env.RENDER || !!process.env.RENDER_EXTERNAL_URL;
const isProd = process.env.NODE_ENV === "production";
if (!runningOnRender && !isProd) {
  require("dotenv").config();
}

/* ===== Requires ===== */
const path = require("path");
const express = require("express");
const compression = require("compression");
const multer = require("multer");
const fs = require("fs");
const { BagsSDK } = require("@bagsfm/LimeSCOPE-sdk");
const { Connection, PublicKey, Transaction } = require("@solana/web3.js");
const { Blob: NodeBlob } = require("buffer");

/* ===== Constants & env ===== */
const API  = "https://api2.LimeSCOPE.fm/api/v1";
const PORT = process.env.PORT || 3000;

// LimeScope treasury (default hardcoded, can override by env LIME_TREASURY)
const LIME_TREASURY_DEFAULT = "4zhqLxD1ZcE1T96a6BGXvqbY5ZLpagwwEqbanb8vWbp";
const LIME_TREASURY = new PublicKey(process.env.LIME_TREASURY || LIME_TREASURY_DEFAULT);

// If you’ve run the setup, set this to the CONFIG KEY (public key) you printed
// e.g. BAGS_TREASURY_CONFIG_KEY=8BKc5oYb49cHJFy7t1r5MZ2YY913iRdbVyfu1jTeExXW
const TREASURY_CONFIG_KEY_STR = process.env.BAGS_TREASURY_CONFIG_KEY || null;
let TREASURY_CONFIG_KEY = null;
try { if (TREASURY_CONFIG_KEY_STR) TREASURY_CONFIG_KEY = new PublicKey(TREASURY_CONFIG_KEY_STR); } catch { TREASURY_CONFIG_KEY = null; }

// (Optional) WSOL mint – kept for completeness if you need it later
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// LimeSCOPE SDK + RPC
const BAGS_API_KEY    = process.env.BAGS_API_KEY;
const SOLANA_RPC_URL  = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
if (!BAGS_API_KEY) console.warn("⚠️  Missing BAGS_API_KEY. Launch/fees endpoints will fail.");

const chain = new Connection(SOLANA_RPC_URL, "processed");
const LimeSCOPE  = new BagsSDK(BAGS_API_KEY, chain, "processed");

// Bearer used for proxying certain authed GETs (subscription, token endpoints)
const BAGS_BEARER = process.env.BAGS_BEARER || "Bearer <YOUR-BEARER-HERE>";

// Vanity mode config: "off" | "auto" | "suffix:<TEXT>"
const BAGS_VANITY_MODE   = (process.env.BAGS_VANITY_MODE || "off").trim().toLowerCase();
const BAGS_VANITY_MAX_MS = Number(process.env.BAGS_VANITY_MAX_MS || 0);

/* ===== Helpers ===== */
const BlobCtor = typeof Blob !== "undefined" ? Blob : NodeBlob;

function vanityHintFrom(mode) {
  const m = (mode || "").trim().toLowerCase();
  if (!m || m === "auto") return null;
  if (m === "off") return { disabled: true, maxMillis: BAGS_VANITY_MAX_MS || 0 };
  if (m.startsWith("suffix:")) {
    const suffix = m.split(":")[1]?.trim();
    if (suffix) return { suffix, maxMillis: Number.isFinite(BAGS_VANITY_MAX_MS) ? BAGS_VANITY_MAX_MS : 10000 };
  }
  return null;
}

async function attachBlockhashAndFeePayer(tx, feePayer) {
  if (!tx.feePayer && feePayer) tx.feePayer = new PublicKey(feePayer);
  if (!tx.recentBlockhash) {
    const { blockhash } = await chain.getLatestBlockhash("processed");
    tx.recentBlockhash = blockhash;
  }
  return tx;
}
function txToBase64(tx) {
  // Support both legacy and v0 tx classes
  if (tx instanceof Transaction) {
    return Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    ).toString("base64");
  }
  // VersionedTransaction
  return Buffer.from(tx.serialize()).toString("base64");
}

const asPubkey = (v) => {
  if (!v) return null;
  if (v instanceof PublicKey) return v;
  try { return new PublicKey(String(v)); } catch { return null; }
};
const asBase58 = (v) => {
  if (!v) return null;
  return v instanceof PublicKey ? v.toBase58() : String(v);
};

function revivePositionKeys(pos) {
  // Convert known base58 string fields back into PublicKey objects for SDK
  if (!pos || typeof pos !== "object") return pos;
  const out = { ...pos };

  // Common fields observed in LimeSCOPE fee positions
  const maybeKeyFields = [
    "customFeeVaultClaimerA", "customFeeVaultClaimerB",
    "customFeeVault", "feeVault",
    "baseMint", "quoteMint", "tokenMint", "mint",
    "pool", "owner", "creator", "authority",
    "receiver", "receiverA", "receiverB", "receiverC",
    "configKey", "wallet", "ata", "treasury", "payer",
  ];

  for (const k of maybeKeyFields) {
    if (k in out && out[k]) {
      const pk = asPubkey(out[k]);
      if (pk) out[k] = pk;
    }
  }

  // Some SDKs expect nested account LimeSCOPE like { accounts: {...} }
  if (out.accounts && typeof out.accounts === "object") {
    out.accounts = revivePositionKeys(out.accounts);
  }

  return out;
}

/* ===== App ===== */
const app = express();
app.use(express.json());
app.use(compression());

/* ===== Data storage for launched list (simple JSON file) ===== */
const DATA_DIR = path.join(__dirname, "data");
const LAUNCHED_PATH = path.join(DATA_DIR, "launched.json");
function ensureData(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(LAUNCHED_PATH)) fs.writeFileSync(LAUNCHED_PATH, "[]");
}
function readLaunched(){ ensureData(); try { return JSON.parse(fs.readFileSync(LAUNCHED_PATH,"utf8")); } catch { return []; } }
function writeLaunched(arr){ ensureData(); fs.writeFileSync(LAUNCHED_PATH, JSON.stringify(arr,null,2)); }

/* ===== CORS ===== */
const ALLOW_ORIGINS = new Set(
  [
    "https://limescope.fun",
    "https://www.limescope.fun",
    "https://sagb.xyz",
    "https://www.sagb.xyz",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.RENDER_EXTERNAL_URL,
  ].filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (ALLOW_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ===== Simple health ===== */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    withBearer: !!(BAGS_BEARER && !BAGS_BEARER.includes("<YOUR-BEARER-HERE>")),
    vanityMode: BAGS_VANITY_MODE,
    vanityMaxMs: BAGS_VANITY_MAX_MS || 0,
    treasury: LIME_TREASURY.toBase58(),
    treasuryConfigKeySet: !!TREASURY_CONFIG_KEY,
  });
});

/* ===== Public feeds (no auth) ===== */
app.get("/api/feed", (req, res) =>
  proxyJSON(res, `${API}/token-launch/feed`)
);
app.get("/api/leaderboard", (req, res) =>
  proxyJSON(res, `${API}/token-launch/leaderboard`)
);

/* ===== Lifetime royalties (creator earnings) ===== */
app.get("/api/lifetime-fees", (req, res) => {
  const tokenMint = req.query.tokenMint;
  if (!tokenMint) return res.status(400).json({ success: false, error: "missing tokenMint" });
  proxyJSON(
    res,
    `${API}/token-launch/lifetime-fees?tokenMint=${encodeURIComponent(tokenMint)}`,
    { withAuth: true, auth: req.headers.authorization }
  );
});

/* ===== Token: market / overview / trades / holders / ohlcv ===== */
app.get("/api/market", (req, res) => {
  const ca = req.query.tokenAddress;
  if (!ca) return res.status(400).json({ success: false, error: "missing tokenAddress" });
  proxyJSON(
    res,
    `${API}/LimeSCOPE/token/find?tokenAddress=${encodeURIComponent(ca)}`,
    { withAuth: true, auth: req.headers.authorization }
  );
});
app.get("/api/token-overview", (req, res) => {
  const ca = req.query.tokenAddress;
  if (!ca) return res.status(400).json({ success: false, error: "missing tokenAddress" });
  proxyJSON(
    res,
    `${API}/token/${encodeURIComponent(ca)}/overview?extensions=allTimeHigh,creationMetadata`,
    { withAuth: true, auth: req.headers.authorization }
  );
});
app.get("/api/token-trades", (req, res) => {
  const ca = req.query.tokenAddress;
  if (!ca) return res.status(400).json({ success: false, error: "missing tokenAddress" });
  proxyJSON(
    res,
    `${API}/token/${encodeURIComponent(ca)}/trades`,
    { withAuth: true, auth: req.headers.authorization }
  );
});
app.get("/api/token-top-holders", (req, res) => {
  const ca = req.query.tokenAddress;
  if (!ca) return res.status(400).json({ success: false, error: "missing tokenAddress" });
  proxyJSON(
    res,
    `${API}/token/${encodeURIComponent(ca)}/top-holders`,
    { withAuth: true, auth: req.headers.authorization }
  );
});
app.get("/api/token-ohlcv", (req, res) => {
  const ca = req.query.tokenAddress;
  const { resolution = 1, from, to } = req.query;
  if (!ca) return res.status(400).json({ success: false, error: "missing tokenAddress" });
  if (!from || !to) return res.status(400).json({ success: false, error: "missing from or to timestamp" });
  proxyJSON(
    res,
    `${API}/token/${encodeURIComponent(ca)}/ohlcv/v2?resolution=${resolution}&from=${from}&to=${to}`,
    { withAuth: true, auth: req.headers.authorization }
  );
});

// REST aliases
app.get("/api/token/:ca/overview", (req, res) =>
  proxyJSON(res, `${API}/token/${encodeURIComponent(req.params.ca)}/overview?extensions=allTimeHigh,creationMetadata`, { withAuth: true, auth: req.headers.authorization })
);
app.get("/api/token/:ca/trades", (req, res) =>
  proxyJSON(res, `${API}/token/${encodeURIComponent(req.params.ca)}/trades`, { withAuth: true, auth: req.headers.authorization })
);
app.get("/api/token/:ca/top-holders", (req, res) =>
  proxyJSON(res, `${API}/token/${encodeURIComponent(req.params.ca)}/top-holders`, { withAuth: true, auth: req.headers.authorization })
);
app.get("/api/token/:ca/ohlcv", (req, res) => {
  const { resolution = 1, from, to } = req.query;
  if (!from || !to) return res.status(400).json({ success: false, error: "missing from or to timestamp" });
  proxyJSON(res, `${API}/token/${encodeURIComponent(req.params.ca)}/ohlcv/v2?resolution=${resolution}&from=${from}&to=${to}`, { withAuth: true, auth: req.headers.authorization });
});

/* ===== Creator & subscription (auth) ===== */
app.get("/api/creator", (req, res) => {
  const tokenMint = req.query.tokenMint;
  if (!tokenMint) return res.status(400).json({ success: false, error: "missing tokenMint" });
  proxyJSON(res, `${API}/token-launch/creator/v2?tokenMint=${encodeURIComponent(tokenMint)}`, { withAuth: true, auth: req.headers.authorization });
});
app.get("/api/subscription", (req, res) => {
  const auth = req.headers.authorization || BAGS_BEARER;
  if (!auth || auth.includes("<YOUR-BEARER-HERE>")) {
    return res.status(401).json({ success: false, error: "missing authorization" });
  }
  proxyJSON(res, `${API}/subscription`, { withAuth: true, auth });
});
app.get("/api/subscription/info/:uuid", (req, res) => {
  const uuid = req.params.uuid;
  if (!uuid) return res.status(400).json({ success: false, error: "missing uuid" });
  proxyJSON(res, `${API}/subscription/info/${encodeURIComponent(uuid)}`, { withAuth: true, auth: req.headers.authorization });
});

/* ===== GMGN.ai logo passthrough ===== */
app.get("/api/gmgn-logo", async (_req, res) => {
  try {
    const url = "https://gmgn.ai/static/logo.svg";
    const upstream = await fetch(url, { headers: { "User-Agent": "LimeScopeProxy/1.0" } });
    const buffer = await upstream.arrayBuffer();
    res
      .status(upstream.status)
      .set("Content-Type", "image/svg+xml")
      .set("Cross-Origin-Resource-Policy", "cross-origin")
      .send(Buffer.from(buffer));
  } catch (err) {
    console.error(`[Proxy] GMGN.ai logo error:`, err);
    res.status(500).send("Failed to load GMGN.ai logo");
  }
});

/* ===== Record + list launched tokens (local JSON) ===== */
app.post("/api/launch/record", async (req, res) => {
  try {
    const { tokenMint, signature = "", wallet = "", name = "", symbol = "", imageUrl = "" } = req.body || {};
    if (!tokenMint) return res.status(400).json({ success:false, error:"missing tokenMint" });
    const arr = readLaunched();
    if (!arr.some(x => x.tokenMint === tokenMint)) {
      arr.unshift({ tokenMint, signature, wallet, name, symbol, imageUrl, createdAt: new Date().toISOString() });
      writeLaunched(arr);
    }
    res.json({ success:true, recorded:true });
  } catch (e) {
    res.status(500).json({ success:false, error:e.message || "record error" });
  }
});

app.get("/api/my-launched", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page)||1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize)||10));
  const arr = readLaunched();
  const total = arr.length;
  const start = (page-1)*pageSize;
  res.json({ success:true, total, page, pageSize, items: arr.slice(start, start+pageSize) });
});

/* ===== Fees: claimable + build claim txs (unsigned) ===== */
app.get("/api/fees/claimable", async (req, res) => {
  try {
    const wallet = req.query.wallet;
    const tokenMint = req.query.tokenMint || "";
    if (!wallet) return res.status(400).json({ success:false, error:"missing wallet" });

    const pub = new PublicKey(wallet);
    const positions = await LimeSCOPE.fee.getAllClaimablePositions(pub);

    const filtered = tokenMint
      ? positions.filter(p => {
          const baseMintStr = p.baseMint instanceof PublicKey ? p.baseMint.toBase58() : String(p.baseMint || "");
          return baseMintStr === tokenMint;
        })
      : positions;

    res.json({ success:true, positions: filtered });
  } catch (e) {
    console.error("/api/fees/claimable error:", e);
    res.status(500).json({ success:false, error:e.message || "claimable error" });
  }
});

app.post("/api/fees/build-claims", async (req, res) => {
  try {
    const { wallet, positions = [] } = req.body || {};
    if (!wallet || !Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ success:false, error:"wallet and positions[] required" });
    }
    const owner = new PublicKey(wallet);

    const txsBase64 = [];
    const errors = [];

    for (let i = 0; i < positions.length; i++) {
      const raw = positions[i];
      const revived = revivePositionKeys(raw);

      try {
        const txs = await LimeSCOPE.fee.getClaimTransaction(owner, revived); // returns 0..n txs
        for (const tx of txs) {
          await attachBlockhashAndFeePayer(tx, owner);
          txsBase64.push(txToBase64(tx));
        }
      } catch (err) {
        errors.push({ index: i, error: err?.message || String(err) });
      }
    }

    if (txsBase64.length === 0 && errors.length) {
      return res.status(500).json({ success:false, error:"failed to build any claim transactions", details: errors });
    }

    res.json({ success:true, txs: txsBase64, errors });
  } catch (e) {
    console.error("/api/fees/build-claims error:", e);
    // Explicitly surface the common toBase58 misuse to help debugging
    const msg = (e && e.message) || "";
    const hint = /toBase58/.test(msg) ? "One or more position fields arrived as strings; server now revives keys, but check client payload shape." : undefined;
    res.status(500).json({ success:false, error: msg || "build-claims error", hint });
  }
});

/* =======================================================================
   LAUNCH ENDPOINT — treasury-only config (all fees → LIME_TREASURY)
   ======================================================================= */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Per-wallet launch (no treasury config key required)
app.post("/api/launch/create", upload.single("image"), async (req, res) => {
  try {
    if (!BAGS_API_KEY) throw new Error("BAGS_API_KEY not configured");

    const {
      name = "",
      symbol = "",
      description = "",
      websiteUrl = "",
      imageUrl = "",
      wallet,               // user's pubkey (base58)
      initialBuySol = "0",
      vanityMode            // optional override: "off" | "auto" | "suffix:XYZ"
    } = req.body || {};

    if (!wallet || wallet.length < 32) {
      return res.status(400).json({ success:false, error:"missing or invalid wallet" });
    }
    if (!name || !symbol) {
      return res.status(400).json({ success:false, error:"name & symbol are required" });
    }

    // image: uploaded file wins; else imageUrl
    let imageBlob = null;
    if (req.file) {
      const type = req.file.mimetype || "image/png";
      imageBlob = new BlobCtor([req.file.buffer], { type });
    } else if (imageUrl) {
      const r = await fetch(imageUrl);
      if (!r.ok) throw new Error(`Failed to fetch imageUrl: HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const type = r.headers.get("content-type") || "image/png";
      imageBlob = new BlobCtor([buf], { type });
    } else {
      return res.status(400).json({ success:false, error:"provide an image file (field: image) or imageUrl" });
    }

    const initialBuyLamports = Math.max(0, Number(initialBuySol || 0)) * 1e9;

    // 1) Token info + metadata (vanity hint is optional/safe)
    const chosenMode = vanityMode || BAGS_VANITY_MODE;
    const vanityHint = vanityHintFrom(chosenMode);
    const info = await LimeSCOPE.tokenLaunch.createTokenInfoAndMetadata({
      image: imageBlob,
      name,
      description,
      symbol: String(symbol).toUpperCase().replace("$",""),
      twitter: "",
      website: websiteUrl || "",
      ...(vanityHint ? { vanity: vanityHint } : {}),
    });

    // 2) Ensure per-wallet LimeSCOPE config exists for this wallet
    const cfg = await LimeSCOPE.config.getOrCreateConfig(new PublicKey(wallet));
    if (cfg.transaction) {
      // ask client to sign once, then re-submit this same endpoint
      await attachBlockhashAndFeePayer(cfg.transaction, wallet);
      return res.json({
        success: true,
        step: "need_config",
        tx: txToBase64(cfg.transaction),
        note: "Sign this one-time LimeSCOPE config tx, then submit /api/launch/create again."
      });
    }

    // 3) Build the unsigned launch tx using that configKey
    const launchTx = await LimeSCOPE.tokenLaunch.createLaunchTransaction({
      metadataUrl: info.tokenMetadata,
      tokenMint: new PublicKey(info.tokenMint),
      launchWallet: new PublicKey(wallet),
      initialBuyLamports,
      configKey: cfg.configKey
    });
    await attachBlockhashAndFeePayer(launchTx, wallet);

    return res.json({
      success: true,
      step: "launch",
      tokenMint: info.tokenMint,
      metadataUrl: info.tokenMetadata,
      vanityModeUsed: chosenMode,
      tx: txToBase64(launchTx)
    });
  } catch (err) {
    console.error("/api/launch/create error", err);
    res.status(500).json({ success:false, error: err.message || "server error" });
  }
});


/* ===== Static & SPA fallback ===== */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { maxAge: "1h", etag: true }));

app.get("/token/:tokenAddress", (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "token.html"))
);
app.get("*", (req, res, next) => {
  if (!(req.headers.accept || "").includes("text/html")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* ===== Proxy helper ===== */
async function proxyJSON(res, url, { withAuth = false, auth = null } = {}) {
  try {
    const headers = {
      "User-Agent": "LimeScopeProxy/1.0",
      Accept: "application/json, text/plain, */*",
    };
    if (withAuth) {
      const chosen =
        (auth && auth.startsWith("Bearer ")) ? auth :
        (BAGS_BEARER && !BAGS_BEARER.includes("<YOUR-BEARER-HERE>")) ? BAGS_BEARER : null;
      if (chosen) headers.Authorization = chosen;
    }

    const upstream = await fetch(url, { headers, redirect: "follow" });
    const text = await upstream.text();
    const ct = upstream.headers.get("content-type") || "";
    const looksJson = text && (text.trim().startsWith("{") || text.trim().startsWith("["));
    res
      .status(upstream.status)
      .type(ct || (looksJson ? "application/json; charset=utf-8" : "text/plain"))
      .send(text);
  } catch (err) {
    console.error(`[Proxy] ${url} →`, err);
    res.status(500).json({ success:false, error: err.message || "proxy error" });
  }
}

/* ===== Listen ===== */
app.listen(PORT, () => {
  if (!BAGS_BEARER || BAGS_BEARER.includes("<YOUR-BEARER-HERE>")) {
    console.warn("⚠️  BAGS_BEARER is not set. Auth-only routes may return 401.");
  }
  if (!TREASURY_CONFIG_KEY) {
    console.warn("⚠️  BAGS_TREASURY_CONFIG_KEY not set. Server will attempt to read existing treasury config on first launch request.");
  }
  console.log(`✅ LimeScope server running on port ${PORT}`);
});
