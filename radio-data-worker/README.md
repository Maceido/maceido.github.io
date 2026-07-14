# WTinyRadio data bridge

This small Cloudflare Worker lets the custom WTinyRadio schedule and chat interface read RadioCult data without using RadioCult's visual embeds. It exposes only the station's live metadata, weekly schedule, public chat history, and listener display-name actions.

Deploy from the repository root after signing in to the Cloudflare account that manages `wtinyradio.com`:

```powershell
npx wrangler login
npx wrangler deploy --config radio-data-worker/wrangler.toml
```

The configuration creates `radio-api.wtinyradio.com` as a Worker custom domain. The main site is already configured to use that address.
