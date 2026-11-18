# KitsuNexus Hand & Body Tracking — avatar setup (Unity)

KitsuNexus's **Face, Hands & Body** tab tracks you with a webcam and sends the result to VRChat
over OSC. Face tracking uses the VRCFaceTracking `FT/v2/…` parameters, which your face-tracking
setup already handles. Hands and body use KitsuNexus's own parameters:

| Parameters | What they are |
|---|---|
| `HT/LeftThumbCurl` … `HT/RightPinkyCurl`, `HT/LeftSpread`, `HT/RightSpread` | finger curl / spread, 0–1 |
| `HT/LeftDetected`, `HT/RightDetected` | hand is visible to the camera |
| `BT/LeftUpperLegX/Z`, `BT/LeftKnee`, `BT/LeftUpperArmX/Z`, `BT/LeftElbow` (+ Right) | limb angles |
| `BT/SpineBend`, `BT/SpineSide`, `BT/SpineTwist`, `BT/Crouch` | torso |
| `BT/Detected` | body is visible to the camera |

VRChat can't take bones over OSC, and it ignores OSC trackers in Desktop mode. So the avatar
needs animator layers that turn these numbers into a pose. This tool builds those layers for you.

## Install

The tool needs the VRChat Avatars SDK 3 (Unity 2022.3). Pick one way to install it:

- **VRChat Creator Companion (recommended):** *Settings → Packages → Add Repository* →
  `https://github.com/NekoSuneProjects/KitsuNexus/releases/latest/download/vpm.json`, then
  click **Manage Project** and add *KitsuNexus Hand & Body Tracking Setup*. Every KitsuNexus
  release ships a matching version, so VCC shows updates.

- **Copy:** in KitsuNexus, open the *Face, Hands & Body* tab and click **Open Unity avatar setup
  tool**. Copy that `KitsuNexusTracking` folder anywhere under `Assets/` in your avatar project.
  The folder is also in the repo at `unity/KitsuNexusTracking`.
- **Package Manager (from disk):** *Window → Package Manager → + → Add package from disk…* and
  pick `KitsuNexusTracking/package.json`.
- **Package Manager (git):** *+ → Add package from git URL…* and enter
  `https://github.com/NekoSuneProjects/KitsuNexus.git?path=/unity/KitsuNexusTracking`

Then open **Tools → KitsuNexus → Hand & Body Tracking Setup**.

## Use

1. Put your avatar in the scene **in its normal rest pose** (T-pose or A-pose, not mid-animation).
   The tool measures the skeleton to work out how each joint should bend.
2. Select the avatar, or drag it into the window.
3. Pick **Hand tracking** and/or **Body tracking** (arms / legs / spine).
4. Check the **synced parameter memory** box. VRChat allows 256 bits, and face tracking uses
   many of them. If you're over, untick **Other players can see it** for hands and/or body.
   Unticked means it still works and you see it in your mirror, but other players see your
   normal animations.
5. Click **Set Up / Update**. Run it again any time to update, for example after changing options.
   **Remove** takes everything back out.
6. Upload. In VRChat, open **Action Menu → Options → OSC → Reset Config**, because VRChat caches
   the old parameter list. Then start tracking in KitsuNexus.

## Test it in Unity before uploading — Live Preview

Open **Tools → KitsuNexus → Tracking Live Preview**, or use the button in the setup window. It
poses your avatar in the Scene view from the generated layers. It works in Edit mode, and the
pose is put back exactly when you press Stop. Nothing is saved.

- **Live from KitsuNexus:** in KitsuNexus, go to *OSC settings → Extra OSC send targets* and add
  `127.0.0.1:9100`. Start tracking, then click **Listen** and **Start preview** in Unity. If
  VRChat isn't running on this avatar, also tick **Send every parameter (testing)** in
  *Face, Hands & Body*. Otherwise KitsuNexus only sends the parameters the current VRChat avatar
  has. Turn that option off again when you're done testing (on KitsuNexus versions before this
  fix it stops face tracking on avatars with prefixed names, such as Echo FT). Don't listen on
  9000: that's VRChat's port.
- **Sliders:** move every `HT/` and `BT/` value by hand.

In Play mode, use Gesture Manager or Av3Emulator instead.

## What it changes

- **Gesture layer:** adds `[KN] Left Hand` / `[KN] Right Hand`. Each is a direct blend tree on one
  hand's finger muscles with a fingers-only mask. Each also has a gate layer that fades it in
  only while that hand is detected and **Hand Tracking** is on. Your own gestures still work
  whenever the camera can't see that hand.
- **Action layer:**
  - adds `[KN] Body`, a direct blend tree on leg, arm and spine-twist muscles, plus a gate.
    While your body is detected and **Body Tracking** is on, the gate raises the Action layer
    and sets VRC Tracking Control to *Animation* for the tracked limbs.
  - adds a `[KN] Body Pose` state to the Action controller's **first layer**, for lean, side
    lean and crouch. Unity only takes the hips position and rotation from a controller's first
    layer, which is also how VRChat's own sit and lie emotes work. The state is entered from
    the idle state and gives way to VRChat as soon as an emote or AFK starts.
  - if your Action controller's first layer has no mask, gives it one with only the tracked
    parts plus Root. VRChat applies that mask to the whole Action layer, so your hand tracking,
    gestures, head and any untracked limbs still show while body tracking is on.
- **FX layer: not touched,** so your face-tracking setup keeps working.
- **Expression Parameters:** adds the parameters above, plus `KN/HandsOn` and `KN/BodyOn` if you
  ticked the menu option.
- **Expression Menu:** adds a **KitsuNexus Tracking** submenu with Hand Tracking and Body Tracking
  toggles.
- If a layer was VRChat's default, or pointed at a read-only SDK file, the tool makes an editable
  copy in `Assets/KitsuNexus/Tracking/<Avatar>/` and assigns it.
- Before changing anything, it backs up your controllers, parameters and menu to
  `Assets/KitsuNexus/Tracking/<Avatar>/Backups/`.

## Good to know

- **Body tracking is a pose, not full-body IK.** Walking with WASD while it's on slides a posed
  body. It works best standing or sitting in front of the camera. Your head still follows your
  mouse or headset.
- **If your fingers freeze while body tracking is on** (VRChat not using the Action mask),
  tick **Fallback: also put hand tracking in the Action layer** and run Set Up again. While body
  tracking is on, a hand the camera can't see then shows a relaxed hand instead of your gesture.
- **Emotes and AFK still work.** Starting one hands the body back to VRChat, and body tracking
  comes back by itself when it ends. With the new Action mask, emotes only move the tracked
  parts (not the head or fingers). Remove restores your mask.
- **Leaning works.** Unity's body rotation follows the hips-to-shoulders line, so a lean has to
  turn the whole body. The thigh poses are solved for each amount of lean, so your legs keep
  the angle the camera saw.
- **Joints have limits.** Each rig stops where its muscle limits are, for example how far a
  thigh can go back or an arm can go up.
- **Legs need your feet in the camera view.** Leg values that were never seen stay at standing.
  If your legs leave the frame, they keep their last pose.
- If you add your own layers after `[KN]` layers in the same controller, run **Set Up / Update**
  again. The gates refer to layers by their position in the controller.
- `unity/tests/KNTest.cs` in the KitsuNexus repo is an end-to-end batch-mode test. It builds a
  test humanoid, runs the setup, and measures every limb through Unity's Animator.
- Works with VRCFury avatars. VRCFury merges its own layers at build time on top of these.
