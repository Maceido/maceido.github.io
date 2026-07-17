# WTinyRadio data bridge

This small Cloudflare Worker powers WTinyRadio's live metadata, weekly schedule, community chat, and support-ticket form without using RadioCult's visual embeds. Support tickets are stored privately in the bound D1 database and receive a public confirmation number.

Deploy from the repository root after signing in to the Cloudflare account that manages `wtinyradio.com`:

```powershell
npx wrangler login
npx wrangler deploy --config radio-data-worker/wrangler.toml
```

The configuration creates `radio-api.wtinyradio.com` as a Worker custom domain. The main site is already configured to use that address.

Support tickets can also be reviewed in Cloudflare's D1 table browser. From the command line, list the newest open tickets with:

```powershell
npx wrangler d1 execute wtinyradio-chat --remote --command "SELECT ticket_number, name, email, category, subject, message, created_at FROM support_tickets WHERE status = 'open' ORDER BY created_at DESC"
```
