# Heart-rate OSC profiles

Every monitoring source feeds the same OSC output pipeline. Profiles can therefore use
Pulsoid, HypeRate, standard BLE, Goodmans watches, or the local HTTP bridge.

## Beko Smooth Heartbeat Gimmick 3.x / VRC Heart Rate

The current asset consumes `VRCOSC/Heartrate/Value`. NekoSuneAPPSVRC also emits the related
`Connected`, `Average`, `Enabled`, `Beat`, `Normalised`, `Units`, `Tens`, and `Hundreds`
parameters. These follow VRCOSC's default 240 BPM normalization and digit/10 behavior.

The `HBG/*` values visible in the Modular Avatar component are internal sound, menu and
local animation controls. They are deliberately not overwritten by the monitor.

## Beko legacy 2.x

Older versions consumed the integer parameter `HR`. Enable the legacy toggle only for an
avatar that has not yet been upgraded to version 3.

## Akaryu HeartRate OSC 3.0

This profile sends `hr_percent`, `hr_connected`, and `hr_beat`. It matches the original
`hr-osc` calculation: `hr_percent` is BPM divided by a configurable maximum that defaults
to 200. `hr_beat` alternates true/false on each calculated beat, which is robust for its
synced Bool parameter; the common `isHRBeat` output remains a short local pulse.

`hr_LocalUI`, `hr_position`, `hr_rotation`, `hr_scale`, and `hr_opacity` belong to the
avatar's own menu and are not overwritten.

## HeartEchoes

The HeartEchoes profile owns `HeartEchoes_Heart_Beat`, `isHRActive`, `isHRConnected`,
`isHRBeat`, and `HeartBeatToggle`. Disabling the profile disables all five outputs.
