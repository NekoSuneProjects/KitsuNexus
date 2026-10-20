# Community Booster: KitsuNexus server integration

Community Booster is an optional cosmetic reward system for members actively
boosting any of the configured Discord guilds. All VRChat, OSC, chatbox, audio,
accessibility and account functions remain available without a boost.

## Connect and verify

1. Pair the desktop app with your KitsuNexus server in **Settings > Cloud Sync**.
   The desktop uses the existing paired-device token, stored by Cloud Sync.
2. Sign in to that server's website, open **Dashboard > Community Booster**, and
   connect your Discord account via **Manage Discord account** (or
   `/settings/discord`). The desktop's Community Booster panel also opens this
   server-side link page.
3. Boost either configured Discord guild, then use **Refresh** in the
   desktop panel. The app loads rewards from the server and refreshes them
   periodically. Enabled defaults are applied to verified unlocked cosmetics;
   individual appearance options can be saved or reset in Settings.

The server must configure `DISCORD_BOT_TOKEN`, `DISCORD_BOOST_GUILD_IDS` and
its Discord OAuth credentials (see `kitsunexus-server/.env.example`). To check
both KitsuNexus and LinkUp, use:

```dotenv
DISCORD_BOOST_GUILD_IDS=1539604439625764894,1274732053337870417
```

The bot needs Server Members Intent and membership in **both** guilds. Its
token stays on the KitsuNexus backend. `DISCORD_OFFICIAL_GUILD_ID` independently
controls the official KitsuNexus guild used for rank sync and bans. A separate
LinkUp deployment can continue using `1274732053337870417` as its primary
guild. Without `DISCORD_BOOST_GUILD_IDS`, booster verification defaults to the
official KitsuNexus guild.

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
| Spark | Active boost in either configured server (reward level 1) | Supporter badge, ribbon, header sparkle |
| Glow | Active boost in both servers, or an active boost + level 2 role | Accent, card border, ambient lighting |
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
reports the number of verified boosting **guilds** (0, 1 or 2 for the two
configured servers), not a literal Discord boost-slot count. `rewardLevel`
is the reward tier threshold; it can be raised by roles
assigned by trusted server staff or automation. Configure optional role IDs:

```dotenv
DISCORD_BOOST_TIER_ROLES={"2":"ROLE_ID","3":"ROLE_ID","5":"ROLE_ID"}
# Optional guild-specific thresholds, overriding the legacy map for those guilds:
DISCORD_BOOST_TIER_ROLES_BY_GUILD={"1539604439625764894":{"3":"ROLE_ID"},"1274732053337870417":{"5":"ROLE_ID"}}
```

These roles only upgrade a **currently active booster in the associated
guild**, preventing inactive role holders from receiving rewards. The legacy
role map applies to the official guild only. With two configured booster
guilds and no tier roles, Glow is the highest attainable tier.

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
