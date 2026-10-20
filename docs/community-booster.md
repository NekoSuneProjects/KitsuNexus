# Community Booster: KitsuNexus server integration

Community Booster is an optional cosmetic reward system for members actively
boosting the server's official Discord guild. All VRChat, OSC, chatbox, audio,
accessibility and account functions remain available without a boost.

## Connect and verify

1. Pair the desktop app with your KitsuNexus server in **Settings > Cloud Sync**.
   The desktop uses the existing paired-device token, stored by Cloud Sync.
2. Sign in to that server's website, open **Dashboard > Community Booster**, and
   connect your Discord account via **Manage Discord account** (or
   `/settings/discord`). The desktop's Community Booster panel also opens this
   server-side link page.
3. Boost the configured official Discord guild, then use **Refresh** in the
   desktop panel. The app loads rewards from the server and refreshes them
   periodically. Enabled defaults are applied to verified unlocked cosmetics;
   individual appearance options can be saved or reset in Settings.

The server must configure `DISCORD_BOT_TOKEN`, `DISCORD_OFFICIAL_GUILD_ID` and
its Discord OAuth credentials (see `kitsunexus-server/.env.example`). The bot
needs guild member access and the appropriate members intent. The server must
be able to verify membership in the configured official guild.

## Server API

| Route | Authentication | Response |
| --- | --- | --- |
| `GET /api/community-booster/catalog` | Public | `{ok:true, catalogue:{version, tiers, defaults}}` |
| `GET /api/community-booster/me` | Paired-device `Authorization: Bearer <device token>` | `{ok:true, verified:true, linkedDiscord, activeBoostCount, rewardLevel, tier, unlocked, source, catalogue}` |

`/me` verifies the linked server account's Discord membership and active booster
status. It never trusts a locally entered Discord ID. The device token is sent
by the Electron main process and is not returned to renderer IPC. The rewards
are private and sent with `Cache-Control: no-store`. A missing or revoked
device token returns an authentication error, and failed bot verification
returns HTTP 503. TLS is required for remote servers; HTTP is accepted only
on localhost for development.

## Reward catalogue and defaults

| Tier | Verified requirement | Newly unlocked cosmetics |
| --- | --- | --- |
| Spark | Active boost (reward level 1) | Supporter badge, ribbon, header sparkle |
| Glow | Active boost + level 2 role | Accent, card border, ambient lighting |
| Nova | Active boost + level 3 role | Nova decoration, gradient header, navigation highlight |
| Constellation | Active boost + level 5 role | Constellation decoration, decorative frame, starlight |

Rewards accumulate: each tier inherits the earlier tiers. The server supplies
the tier catalogue and default cosmetic preferences. Ribbon, sparkle, accent,
border, ambient light, gradient, navigation highlight, frame and starlight are
on by default when unlocked. The decoration setting defaults to `auto`, which
chooses the highest unlocked decoration. Users can turn individual cosmetics
off without losing their saved preferences.

**Discord's guild-member API confirms active boosting but does not reliably
report how many individual boosts someone contributes.** `activeBoostCount`
reports a verified active-booster indicator (0 or 1), not a literal multi-boost
count. `rewardLevel` is the reward tier threshold; it can be raised by roles
assigned by trusted server staff or automation. Configure optional role IDs:

```dotenv
DISCORD_BOOST_TIER_ROLES={"2":"ROLE_ID","3":"ROLE_ID","5":"ROLE_ID"}
```

These roles only upgrade a **currently active booster**, preventing inactive
role holders from receiving rewards. When no roles are configured, Spark is the
highest attainable tier through the Discord API alone.

## Offline, revocation and safety

The desktop caches verified rewards for at most five minutes in memory. If
verification goes offline, previously verified rewards remain active only
until that cache expires; after expiry, the base theme is shown. Switching or
revoking the paired account invalidates rewards immediately. Confirmed ended
boosts and unlinked Discord accounts remove unlocked cosmetics. Saved cosmetic
preferences remain for a later boost. The catalogue contains no entitlement
authority on its own. Discord bot credentials never reach the desktop.

The app's legacy renderer still has Node integration enabled for other modules;
a broader context-isolation migration remains separately tracked. Community
Booster cosmetic values never enter VRChat, OSC, chatbox or overlays.
