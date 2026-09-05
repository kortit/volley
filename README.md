# volley

A tiny availability board for a local beach volley court.

Someone at the court scans a QR code taped to the net post. They see whether the
regulars are up for a game and, if so, tap one button to ping them on Telegram.

- `/` — **court page** (the QR target). Shows availability, offers the notify button.
- `/admin` — **team page**. Set availability for 1/2/3 hours or until 20:00, or turn it off.
- `/print` — printable sign with the QR code on it.

## How availability works

The stored value is an **expiry timestamp**, not a boolean. `available` is derived as
`now < availableUntil`. That means the flag switches itself off — there is no way to
leave a stale "we're ready to play" showing at midnight.

State lives in a single JSON file. On Azure App Service that is `/home/data/state.json`;
`/home` is a persistent mounted share, so it survives restarts and image updates. No
database, no storage account.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | for notifications | — | From @BotFather |
| `TELEGRAM_CHAT_ID` | for notifications | — | Group chat id (a negative number) |
| `PORT` | no | `8080` | Listen port |
| `COURT_NAME` | no | `the court` | Used in the notification text |
| `NOTIFY_COOLDOWN_SECONDS` | no | `300` | Min gap between notifications |
| `DATA_DIR` | no | `/home/data` on Azure, else `./data` | Where `state.json` lives |
| `PUBLIC_BASE_URL` | no | derived from request | URL encoded into the QR code |
| `TZ` | no | `Europe/Paris` | Timezone in the notification text |

Without the two Telegram variables the app still runs: the court page shows the notify
button disabled rather than failing at tap time.

## Run locally

```bash
npm install
npm start          # http://localhost:8080
```

## Deploy

`git push` to `main` builds the image and pushes it to `ghcr.io/kortit/volley:latest`
via GitHub Actions. Azure App Service pulls that image.

Optional: set an `AZURE_WEBHOOK_URL` repository secret (App Service → Deployment Center →
Webhook URL) and each push redeploys automatically instead of waiting for a restart.
