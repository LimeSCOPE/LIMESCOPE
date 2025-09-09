# LimeSCOPE – UX Hardening Pack

Drop these files into your repo to reduce "unsafe" vibes and improve reviewability.

## 1) Don't auto-connect; connect only on user click
Include the wallet script in your HTML (or import it in your bundler):

```html
<link rel="stylesheet" href="/css/modal.css">
<script src="https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js"></script>
<script type="module">
  import { bindWalletConnect, showTxSummaryAndConfirm } from '/js/wallet-ux.js';

  let provider = null;
  bindWalletConnect('connectBtn', (p, pubkey) => {
    provider = p;
    console.log('Connected:', pubkey);
  });

  // Example: building a tx on your server and asking the user to sign
  async function deploy() {
    const res = await fetch('/api/fees/build', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ wallet: window.walletPubkey, mint: '<BASE_MINT>' }) });
    const { txBase64 } = await res.json();

    showTxSummaryAndConfirm(txBase64, {
      action: 'Deploy token',
      cluster: 'mainnet-beta',
      onConfirm: async () => {
        const buf = Buffer.from(txBase64, 'base64');
        let signature;
        try {
          const vtx = solanaWeb3.VersionedTransaction.deserialize(buf);
          const r = await provider.signAndSendTransaction(vtx);
          signature = r.signature || r; // some wallets return { signature }
        } catch {
          const tx = solanaWeb3.Transaction.from(buf);
          const r = await provider.signAndSendTransaction(tx);
          signature = r.signature || r;
        }
        alert('Submitted: ' + signature);
      }
    });
  }

  window.deploy = deploy; // attach for a button onclick="deploy()"
</script>
```

## 2) Human-readable summary before signing
The `showTxSummaryAndConfirm()` modal lists the program IDs the transaction will touch and reminds the user that the wallet shows the exact fee. You can extend this easily.

## 3) Security pages
- `/privacy` and `/terms` are static HTML pages.
- `/.well-known/security.txt` and `/security.txt` served by `installUxHardening()` helper.

In your Express server:

```ts
import express from 'express';
import { installUxHardening } from './src/server/uxHardening';

const app = express();
installUxHardening(app); // after app creation
```

**Replace `<YOUR_DOMAIN>` placeholders** inside `public/security.txt`, `public/privacy.html`, `public/terms.html`.

---

## Render build error for @bagsfm/LimeSCOPE-sdk
If you see `ETARGET No matching version found for @bagsfm/LimeSCOPE-sdk@^0.1.0`, fix by pinning the package to an existing source.

**Option A (recommended, if repo is public):** use GitHub as the source.
```json
// package.json
{
  "dependencies": {
    "@bagsfm/LimeSCOPE-sdk": "github:bagsfm/LimeSCOPE-sdk"
  }
}
```

**Option B:** pin to the actual published version (check locally with `npm view @bagsfm/LimeSCOPE-sdk versions` and choose one), e.g.
```json
{ "dependencies": { "@bagsfm/LimeSCOPE-sdk": "0.0.XX" } }
```

**Option C:** vendor the SDK in your repo and map it via TS paths:
- Copy the SDK under `libs/LimeSCOPE-sdk/`
- Add to `tsconfig.json`:
  ```json
  { "compilerOptions": { "baseUrl": ".", "paths": { "@bagsfm/LimeSCOPE-sdk": ["libs/LimeSCOPE-sdk/src/index.ts"] } } }
  ```
- If using `ts-node`, run with `ts-node -r tsconfig-paths/register`.

After pushing the change, re-deploy on Render.
