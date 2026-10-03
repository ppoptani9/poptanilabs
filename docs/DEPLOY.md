# Deploying poptanilabs.com

Production is the Cloudflare Pages project **`poptanilabs`**
(production domains: `poptanilabs.com`, `www.poptanilabs.com`).
Deploys are **manual direct uploads** — there is no CI pipeline.

## Release checklist

1. **Verify locally first.** Serve the repo root and eyeball every changed page
   in **both** light and dark themes (button contrast, readability, hidden/visible
   states), plus a mobile viewport.
   ```bash
   python3 -m http.server 8080
   ```
2. **Bump cache-busters.** Every change to `styles.css`, `app.js`, `sip.js`, or
   `xray.js` MUST bump its `?v=` query string in all HTML `<link>` / `<script>`
   references, or the Cloudflare CDN will keep serving the stale file.
3. **Build the zip** from the repo root:
   ```bash
   zip -qr poptanilabs-site.zip . -x "*.DS_Store"
   ```
4. **Upload** in the Cloudflare dashboard: Pages → `poptanilabs` →
   *Create deployment* → *Direct Upload* → drop the zip → *Save and deploy*.
5. **Verify live.** Fresh-load `https://poptanilabs.com/` (and each changed tool
   page) and confirm the new behavior. If the CDN still serves stale assets,
   run **Caching → Purge Everything** once for `poptanilabs.com` (purge only —
   change no settings).

## Notes

- AdSense (`ads.txt`, publisher ID) and the sitemap/robots/canonical tags live
  in this repo — keep them in sync with the AdSense dashboard.
- `data/holdings.json` is regenerated from AMCs' public monthly disclosures;
  when refreshing it, keep the schema (`fund → [{stock, weight}]`) stable —
  `xray.js` depends on it.
