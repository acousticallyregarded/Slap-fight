# Buy vs. Sell

A browser anime slap game for a Solana token. Qualifying $100+ swaps make Buy or
Sell slap the other; market-cap milestones unlock outfits; token chat triggers
a fixed library of reactions.

- `client/`: React + PixiJS game (and the admin screen).
- `server/`: live data adapters, admin API, WebSocket feed to viewers.
- `shared/`: game engine, trade pipeline, chat moderation, config.
- `docs/ASSETS.md`: where the art and audio come from and how to rebuild them.

## Run it locally

Needs Node.js 20 or newer.

```
npm install
cp .env.example .env         # then edit .env (see below)
npm run build                # builds the client into client/dist
npm start                    # serves game + API on http://localhost:8787
```

In `.env`, set at least `ADMIN_PASSWORD` (any password you like) and, for a
plain `http://localhost` run, `COOKIE_SECURE=false`. Provider keys are optional:
each feature stays off and says so until its key is set.

Provider keys can go in `.env`, or be typed into **Admin → API keys** once the
server is running. Keys typed there are sent to your server once, stored in
`server/data/secrets.json` (readable only by the server's user), override the
same key in `.env`, and are never shown again: the page only says whether each
key is set. On a hosted server, only type keys over https. `ADMIN_PASSWORD`
stays in `.env`.

- Live game: http://localhost:8787/?mode=live
- Demo game: http://localhost:8787/?mode=demo
- Admin: press **Admin** in either page and sign in with `ADMIN_PASSWORD`.

`npm test` runs the tests; `npm run build:standalone` builds the one-file demo.

## Show extras

On top of the slaps and outfits, the arena runs a few extras. They never change
which trades slap or when outfits unlock.

- **Combos:** three or more slaps in a row from one side show a combo badge and
  callouts ("3x COMBO!", "5x ON FIRE!", "7x UNSTOPPABLE!", "10x LEGENDARY!");
  the other side snapping a streak gets "COMBO BREAKER!".
- **Whale slaps:** a qualifying trade of $1,000 or more (Admin → Show extras)
  plays in slow motion with a camera push-in, flash, shake and a deeper hit.
  The day's biggest slap (UTC day) sits under the crowd bar.
- **Hype meter:** qualifying volume over the last 5 minutes. The arena lights,
  crowd bounce and (with sound on) crowd noise follow it.
- **Crowd cheers:** "go buy" / "go sell" style chat messages fill the crowd bar
  for 2 minutes and make that team's glow sticks jump. Each viewer counts once
  per 10 seconds per team; moderation still applies.
- **Trash talk:** the side on a streak, the side that breaks one, and the side
  ahead after a quiet spell throw out a line from a fixed, playful list.
- **Share card:** the Share button next to the day's biggest slap draws a
  1200×675 image of it (the hand-drawn contact frame) to download, copy, or post
  on X. Demo cards are stamped "DEMO · SIMULATED".

The demo's **Show extras** buttons trigger each of these.

## Try the pump.fun chat with any token

pump.fun has no official chat API. The game can read a token's pump.fun chat
through **pump-chat-client**, an unofficial open-source library that connects
the way the pump.fun website does. It only reads; it never posts. pump.fun can
change or block it at any time, and the game labels it as unofficial.

1. Start the server as above (the published demo page cannot do this: it has
   no server and no network access to pump.fun).
2. Open the game, press **Admin**, sign in.
3. Under **Token**, paste the token's mint address (the address in its
   pump.fun URL: `pump.fun/coin/<mint>`). Pick an active token so chat is
   moving.
4. Under **Providers → pump.fun chat**, choose **Unofficial reader:
   pump-chat-client** and save.
5. Open http://localhost:8787/?mode=live.

When it works:

- the header pill reads **pump.fun chat (unofficial): connected**;
- the admin screen's **Adapter status → chat** says the room was joined and,
  once people post, "receiving messages";
- new messages such as "gm", "lol", "go buy" or "cute" make the characters
  react, and they appear under **Chat reactions** (old messages from before you
  connected are not replayed; cooldowns and moderation still apply).

If the status shows an error (for example a 403), your network or pump.fun
refused the connection; the bridge retries on its own.

For a hosted server, the same steps apply: deploy it anywhere that runs a
long-lived Node process (a VPS, Render, Railway, Fly.io) with the `.env`
values set there.

## Live trades and market cap (free)

The free setup needs one free account, at [Helius](https://www.helius.dev):

1. Sign up for the free plan and copy your RPC link
   (`https://mainnet.helius-rpc.com/?api-key=...`).
2. Paste it as `SOLANA_RPC_URL` under **Admin → API keys** (or in `.env`).
3. Under **Admin → Providers**, check that **Confirmed swaps** is **Solana
   chain** and **Market cap** is **From each trade** (the defaults; DexScreener
   is the other free market-cap choice), and save.

The game then reads pump.fun's own trade records straight from the Solana
chain: each buy or sell of your token, on the bonding curve and after it moves
to PumpSwap, with the SOL amount (fees excluded) and the market cap right
after the trade, worked out the way pump.fun shows it. The record format comes
from pump.fun's published program interface
([pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)).
SOL/USD comes from Jupiter with no key.

- **From each trade** updates the market cap on every trade and re-prices it as
  SOL moves. **DexScreener** (free, no key) checks the market cap every 15
  seconds whatever the trade source; it lists totals only, never single trades.
- Trades made while the server is off or disconnected are not replayed.
- Whether a very busy token stays inside Helius's free monthly credits has not
  been measured; the admin screen's **Adapter status** shows errors if the
  RPC starts refusing.

Paid or alternative sources remain available on the same screens: PumpPortal
(trades and market cap, billed per event), Helius webhooks, Birdeye market cap,
and Pyth price history. See `.env.example` for each variable.
