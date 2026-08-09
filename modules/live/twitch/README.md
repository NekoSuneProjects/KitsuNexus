# Twitch live features

`followers.js` polls Twitch Helix for channel follower totals. `interactive.js` provides
native compatibility for Fooma's Twitch to VRChat Interaction System. Twitch chat
commands and channel-point reward redemptions are mapped to integer values sent to
the avatar parameter `/avatar/parameters/twitch`.

Mappings use one line per action:

```text
command | !bonk | 1
reward | Throw Tomato | 2
```

Reward mappings can use either the exact reward title or its Twitch reward ID. The
integer values must match the actions configured by the purchased Unity package;
NekoSuneAPPSVRC does not redistribute that package.

Both features consume the shared account stored by the OAuth sidebar page. OAuth requires
`moderator:read:followers chat:read channel:read:redemptions`. Reward events use Twitch
EventSub WebSockets, while commands use Twitch IRC WebSockets.
