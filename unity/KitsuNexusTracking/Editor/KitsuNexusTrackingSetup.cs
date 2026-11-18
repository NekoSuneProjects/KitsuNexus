// KitsuNexus — Desktop Hand & Body Tracking avatar setup (VRChat SDK3, Unity Editor only).
//
// KitsuNexus's webcam tracking sends avatar parameters over OSC:
//   HT/<Side><Finger>Curl, HT/<Side>Spread, HT/<Side>Detected        (hands, handParams.js)
//   BT/<Side>UpperLegX|UpperLegZ|Knee|UpperArmX|UpperArmZ|Elbow,
//   BT/SpineBend|SpineSide|SpineTwist|Crouch, BT/Detected             (body, bodyTracking.js)
// VRChat can't take bones over OSC and ignores OSC trackers on Desktop, so this tool
// builds the avatar side: animator layers that turn those numbers into a pose.
//
//   * Hands -> Gesture layer: one layer per hand (direct blend tree, finger muscles,
//     hand-only mask), faded in only while that hand is seen (HT/<Side>Detected).
//   * Body  -> Action layer: one layer (direct blend tree, leg/arm/spine muscles),
//     the Action layer is raised only while your body is seen (BT/Detected), with
//     VRC Tracking Control set to Animation for the tracked limbs.
//   * FX (face tracking) is never touched. Parameters are appended to your existing
//     Expression Parameters; an optional "KitsuNexus Tracking" submenu gets on/off toggles.
//
// Muscle values are not guessed: the tool poses your avatar through Unity's
// HumanPoseHandler, measures each limb the same way bodyTracking.js measures you,
// and solves for the muscle value that matches each parameter value. The avatar
// in the scene must be in its normal rest pose (T/A-pose) when you click Set Up.
// The scene pose is restored afterwards.
//
// Tools > KitsuNexus > Hand & Body Tracking Setup

#if UNITY_EDITOR && (VRC_SDK_VRCSDK3 || KN_VRC_AVATARS)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using VRC.SDK3.Avatars.Components;
using VRC.SDK3.Avatars.ScriptableObjects;
using VRC.SDKBase;
using AnimLayerType = VRC.SDK3.Avatars.Components.VRCAvatarDescriptor.AnimLayerType;
using ExprParam = VRC.SDK3.Avatars.ScriptableObjects.VRCExpressionParameters.Parameter;
using ExprType = VRC.SDK3.Avatars.ScriptableObjects.VRCExpressionParameters.ValueType;
using TrackingType = VRC.SDKBase.VRC_AnimatorTrackingControl.TrackingType;

namespace KitsuNexus.TrackingSetup
{
    public class KitsuNexusTrackingSetup : EditorWindow
    {
        const string Prefix = "[KN] ";
        const string MenuName = "KitsuNexus Tracking";
        const string One = "KN/One";          // animator-only constant 1, direct blend tree weight
        const string HandsOn = "KN/HandsOn";  // menu toggle
        const string BodyOn = "KN/BodyOn";    // menu toggle
        // Head rotation from face tracking. KitsuNexus sends anything ending in v2/Head/Yaw etc.
        // (VRCFaceTracking names), so these need no extra app support. ±1 = ±90°.
        const string HeadYaw = "KN/v2/Head/Yaw", HeadPitch = "KN/v2/Head/Pitch", HeadRoll = "KN/v2/Head/Roll";
        const int MaxCost = 256;              // VRChat synced parameter budget (bits)
        static readonly string[] Sides = { "Left", "Right" };
        static readonly string[] HtFingers = { "Thumb", "Index", "Middle", "Ring", "Pinky" };
        static readonly string[] UnityFingers = { "Thumb", "Index", "Middle", "Ring", "Little" }; // Unity says Little, KitsuNexus says Pinky
        static readonly string[] BodyLimbParams = { "UpperLegX", "UpperLegZ", "Knee", "UpperArmX", "UpperArmZ", "Elbow", "UpperArmTwist" };

        VRCAvatarDescriptor avatar;
        bool doHands = true, doBody = true, doArms = true, doLegs = true, doSpine = true;
        bool syncHands = true, syncBody = true, addMenu = true, handsInAction = true, doHead = true;
        // Unity keeps an open window's fields across script reloads, so a window opened with an
        // older version of this tool would keep its old values for options added since. Bump
        // when new options need their defaults (2: hands fallback on, head).
        const int OptionsVersion = 2;
        [SerializeField] int optionsVersion;
        float fistStrength = 1f, thumbStrength = 1f;
        bool showAdvanced;
        Vector2 scroll;
        string lastLog = "";

        [MenuItem("Tools/KitsuNexus/Hand & Body Tracking Setup")]
        static void Open() { GetWindow<KitsuNexusTrackingSetup>("KitsuNexus Tracking"); }

        void OnEnable()
        {
            if (optionsVersion < OptionsVersion) { handsInAction = true; doHead = true; optionsVersion = OptionsVersion; }
            PickFromSelection();
        }
        void OnSelectionChange() { if (avatar == null) { PickFromSelection(); Repaint(); } }

        void PickFromSelection()
        {
            var go = Selection.activeGameObject;
            if (go == null) return;
            var d = go.GetComponentInParent<VRCAvatarDescriptor>();
            if (d != null) SetAvatar(d);
        }

        void SetAvatar(VRCAvatarDescriptor d)
        {
            avatar = d;
            lastLog = "";
            if (d == null) return;
            // Pick sync defaults that fit next to whatever (face tracking) is already there.
            syncHands = true; syncBody = true;
            if (TotalCost() > MaxCost) syncBody = false;
            if (TotalCost() > MaxCost) syncHands = false;
        }

        /* ------------------------------------------------------------------ UI */

        void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            try { DrawGui(); }
            finally { EditorGUILayout.EndScrollView(); }
        }

        void DrawGui()
        {
            EditorGUILayout.LabelField("KitsuNexus — Desktop Hand & Body Tracking", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Makes your avatar's fingers and body follow KitsuNexus webcam tracking (HT/ and BT/ OSC parameters), in Desktop and VR.\n" +
                "Hands go on the Gesture layer, body on the Action layer. Your FX layer (face tracking) is not changed. " +
                "Your controllers, parameters and menu are backed up first.", MessageType.Info);

            var d = (VRCAvatarDescriptor)EditorGUILayout.ObjectField("Avatar", avatar, typeof(VRCAvatarDescriptor), true);
            if (d != avatar) SetAvatar(d);
            if (avatar == null)
            {
                EditorGUILayout.HelpBox("Select your avatar (the object with the VRC Avatar Descriptor) in the scene.", MessageType.Warning);
                return;
            }
            var anim = avatar.GetComponent<Animator>();
            if (anim == null || anim.avatar == null || !anim.avatar.isHuman)
            {
                EditorGUILayout.HelpBox("This avatar needs an Animator with a Humanoid rig.", MessageType.Error);
                return;
            }

            EditorGUILayout.Space();
            doHands = EditorGUILayout.ToggleLeft("Hand tracking — fingers curl and spread (Gesture layer)", doHands, EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(!doHands))
            {
                EditorGUI.indentLevel++;
                syncHands = EditorGUILayout.ToggleLeft($"Other players can see it (synced, {HandCost(true)} bits)", syncHands);
                EditorGUI.indentLevel--;
            }

            EditorGUILayout.Space();
            doBody = EditorGUILayout.ToggleLeft("Body tracking — desktop full-body pose (Action layer)", doBody, EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(!doBody))
            {
                EditorGUI.indentLevel++;
                doArms = EditorGUILayout.ToggleLeft("Arms (upper arm forward / raise, elbow bend)", doArms);
                doLegs = EditorGUILayout.ToggleLeft("Legs (thigh forward / out, knee bend)", doLegs);
                doSpine = EditorGUILayout.ToggleLeft("Spine & hips (lean, side lean, twist, lying down" + (doLegs ? ", crouch)" : ")"), doSpine);
                doHead = EditorGUILayout.ToggleLeft("Head (turn / nod / tilt from face tracking)", doHead);
                syncBody = EditorGUILayout.ToggleLeft($"Other players can see it (synced, {BodyCost(true)} bits)", syncBody);
                using (new EditorGUI.DisabledScope(!doHands))
                    handsInAction = EditorGUILayout.ToggleLeft(new GUIContent("Fallback: also put hand tracking in the Action layer",
                        "Only if your fingers freeze while body tracking is on in VRChat. Hand tracking then also works through the Action layer, " +
                        "but while body tracking is on, a hand the camera can't see shows a relaxed hand instead of your gesture."), handsInAction);
                EditorGUI.indentLevel--;
            }

            EditorGUILayout.Space();
            addMenu = EditorGUILayout.ToggleLeft("Add on/off toggles (\"" + MenuName + "\" submenu in your Expression Menu)", addMenu);

            showAdvanced = EditorGUILayout.Foldout(showAdvanced, "Advanced");
            if (showAdvanced)
            {
                EditorGUI.indentLevel++;
                fistStrength = EditorGUILayout.Slider("Finger curl strength", fistStrength, 0.3f, 1f);
                thumbStrength = EditorGUILayout.Slider("Thumb curl strength", thumbStrength, 0.3f, 1f);
                EditorGUILayout.HelpBox("Open fingers = how the fingers look in your avatar's rest pose. Curled = a fist at full strength.", MessageType.None);
                EditorGUI.indentLevel--;
            }

            EditorGUILayout.Space();
            int ex = ExistingCost(), add = AddedCost(), tot = ex + add;
            bool over = tot > MaxCost;
            EditorGUILayout.HelpBox(
                $"Synced parameter memory: {ex} bits already used (face tracking etc.) + {add} added = {tot} / {MaxCost}." +
                (over ? "\nToo much for VRChat. Untick \"Other players can see it\" for hands and/or body — it still works for you and in your own view, " +
                        "other players just see your normal animations. Or use fewer face-tracking parameters / a parameter compressor (e.g. VRCFury)." : ""),
                over ? MessageType.Error : MessageType.Info);

            bool nothing = !doHands && !(doBody && (doArms || doLegs || doSpine));
            using (new EditorGUI.DisabledScope(over || nothing))
            {
                if (GUILayout.Button("Set Up / Update", GUILayout.Height(32)))
                    EditorApplication.delayCall += () => Run(Setup);
            }
            if (GUILayout.Button("Remove KitsuNexus tracking from this avatar"))
            {
                EditorApplication.delayCall += () =>
                {
                    if (EditorUtility.DisplayDialog("KitsuNexus Tracking", "Remove the [KN] layers, HT/ BT/ KN/ parameters and the KitsuNexus Tracking menu from this avatar?", "Remove", "Cancel"))
                        Run(() => { var l = new List<string>(); RemoveFromAvatar(l); if (l.Count == 0) l.Add("Nothing to remove."); return l; });
                };
            }
            if (GUILayout.Button("Open Live Preview (test the pose in the Scene view)"))
                KitsuNexusTrackingPreview.OpenFor(avatar);
            if (!string.IsNullOrEmpty(lastLog))
            {
                EditorGUILayout.Space();
                EditorGUILayout.HelpBox(lastLog, MessageType.None);
            }
        }

        void Run(Func<List<string>> f)
        {
            try
            {
                var log = f();
                lastLog = string.Join("\n", log);
                Debug.Log("[KitsuNexus Tracking]\n" + lastLog);
            }
            catch (Exception e)
            {
                lastLog = "Failed: " + e.Message;
                Debug.LogException(e);
            }
            finally
            {
                AssetDatabase.SaveAssets();
                Repaint();
            }
        }

        /* ------------------------------------------------------- parameter list */

        class Spec
        {
            public string name; public ExprType type; public bool synced; public float def; public bool saved;
            public Spec(string n, ExprType t, bool s, float d = 0f, bool sv = false) { name = n; type = t; synced = s; def = d; saved = sv; }
        }

        static IEnumerable<string> HandFloats(string side)
        {
            foreach (var f in HtFingers) yield return $"HT/{side}{f}Curl";
            yield return $"HT/{side}Spread";
        }

        IEnumerable<string> BodyFloats()
        {
            foreach (var s in Sides)
            {
                if (doLegs) { yield return $"BT/{s}UpperLegX"; yield return $"BT/{s}UpperLegZ"; yield return $"BT/{s}Knee"; }
                if (doArms) { yield return $"BT/{s}UpperArmX"; yield return $"BT/{s}UpperArmZ"; yield return $"BT/{s}Elbow"; yield return $"BT/{s}UpperArmTwist"; }
            }
            if (doSpine) { yield return "BT/SpineBend"; yield return "BT/SpineSide"; yield return "BT/SpineTwist"; yield return "BT/Lying"; yield return "BT/LiePitch"; yield return "BT/LieRoll"; }
            if (doHead) { yield return HeadYaw; yield return HeadPitch; yield return HeadRoll; }
            if (doLegs) yield return "BT/Crouch";
        }

        bool BodyActive => doBody && (doArms || doLegs || doSpine);

        List<Spec> Wanted()
        {
            var l = new List<Spec>();
            if (doHands)
            {
                foreach (var s in Sides)
                {
                    foreach (var n in HandFloats(s)) l.Add(new Spec(n, ExprType.Float, syncHands));
                    l.Add(new Spec($"HT/{s}Detected", ExprType.Bool, syncHands));
                }
                if (addMenu) l.Add(new Spec(HandsOn, ExprType.Bool, syncHands, 1f, true));
            }
            if (BodyActive)
            {
                foreach (var n in BodyFloats()) l.Add(new Spec(n, ExprType.Float, syncBody));
                l.Add(new Spec("BT/Detected", ExprType.Bool, syncBody));
                if (addMenu) l.Add(new Spec(BodyOn, ExprType.Bool, syncBody, 1f, true));
            }
            return l;
        }

        static HashSet<string> AllOurNames()
        {
            var h = new HashSet<string> { One, HandsOn, BodyOn, "BT/Detected", "BT/SpineBend", "BT/SpineSide", "BT/SpineTwist", "BT/Crouch", "BT/Lying", "BT/LiePitch", "BT/LieRoll", HeadYaw, HeadPitch, HeadRoll };
            foreach (var s in Sides)
            {
                foreach (var n in HandFloats(s)) h.Add(n);
                h.Add($"HT/{s}Detected");
                foreach (var n in BodyLimbParams) h.Add($"BT/{s}{n}");
            }
            return h;
        }

        static int Cost(ExprType t) { return t == ExprType.Bool ? 1 : 8; }

        int ExistingCost()
        {
            var p = avatar != null ? avatar.expressionParameters : null;
            if (p == null || p.parameters == null) return 0;
            var ours = AllOurNames();
            return p.parameters.Where(x => x != null && !string.IsNullOrEmpty(x.name) && x.networkSynced && !ours.Contains(x.name)).Sum(x => Cost(x.valueType));
        }
        int AddedCost() { return Wanted().Where(s => s.synced).Sum(s => Cost(s.type)); }
        int TotalCost() { return ExistingCost() + AddedCost(); }
        int HandCost(bool _) { return 12 * 8 + 2 + (addMenu ? 1 : 0); }
        int BodyCost(bool _) { return BodyFloats().Count() * 8 + 1 + (addMenu ? 1 : 0); }

        /* ---------------------------------------------------------------- setup */

        List<string> Setup()
        {
            var log = new List<string>();
            var anim = avatar.GetComponent<Animator>();
            if (anim == null || anim.avatar == null || !anim.avatar.isHuman) throw new Exception("The avatar needs a Humanoid Animator.");
            string folder = AvatarFolder();
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");

            Backup(folder, stamp, log);
            RemoveFromAvatar(new List<string>()); // re-running = update

            // Measure the avatar and build the blend trees (scene pose restored afterwards).
            BlendTree handL = null, handR = null, body = null, bodyPose = null;
            var bodyParts = new List<AvatarMaskBodyPart>();
            using (var pr = new Probe(anim))
            {
                if (doHands)
                {
                    handL = BuildHand(pr, "Left", Fresh($"{folder}/KN_LeftHand.asset"), log);
                    handR = BuildHand(pr, "Right", Fresh($"{folder}/KN_RightHand.asset"), log);
                }
                if (BodyActive) body = BuildBody(pr, Fresh($"{folder}/KN_Body.asset"), bodyParts, Fresh($"{folder}/KN_BodyPose.asset"), out bodyPose);
            }
            var empty = EmptyClip(folder);

            if (doHands)
            {
                var g = EnsureController(AnimLayerType.Gesture, "vrc_AvatarV3HandsLayer", folder, log);
                CheckBaseMask(g, new[] { AvatarMaskBodyPart.LeftFingers, AvatarMaskBodyPart.RightFingers }, "Gesture", log);
                AddAnimParam(g, One, AnimatorControllerParameterType.Float, 1f, log);
                AddAnimParam(g, HandsOn, AnimatorControllerParameterType.Bool, 1f, log);
                foreach (var s in Sides)
                {
                    foreach (var n in HandFloats(s)) AddAnimParam(g, n, AnimatorControllerParameterType.Float, 0f, log);
                    AddAnimParam(g, $"HT/{s}Detected", AnimatorControllerParameterType.Bool, 0f, log);
                }
                AddHandLayers(g, VRC_AnimatorLayerControl.BlendableLayer.Gesture, "", handL, handR, folder, empty);
                EditorUtility.SetDirty(g);
                log.Add("Hands: added [KN] Left/Right Hand (+ gates) to the Gesture layer '" + g.name + "'.");
            }

            if (BodyActive)
            {
                var a = EnsureController(AnimLayerType.Action, "vrc_AvatarV3ActionLayer", folder, log);
                bool fallbackHands = handsInAction && doHands;
                var actionParts = fallbackHands ? bodyParts.Concat(new[] { AvatarMaskBodyPart.LeftFingers, AvatarMaskBodyPart.RightFingers }).ToList() : bodyParts;
                SetActionMask(a, actionParts, folder, log);
                CheckBaseMask(a, bodyParts.Concat(new[] { AvatarMaskBodyPart.Root }).ToArray(), "Action", log);
                AddAnimParam(a, One, AnimatorControllerParameterType.Float, 1f, log);
                AddAnimParam(a, BodyOn, AnimatorControllerParameterType.Bool, 1f, log);
                AddAnimParam(a, "BT/Detected", AnimatorControllerParameterType.Bool, 0f, log);
                foreach (var n in BodyFloats()) AddAnimParam(a, n, AnimatorControllerParameterType.Float, 0f, log);
                AddTrackingLayer(a, Prefix + "Body", body, MakeMask($"{folder}/KN_Body.mask", bodyParts.ToArray()));
                int idx = LayerIndex(a, Prefix + "Body");
                bool arms = doArms, legs = doLegs, spine = doSpine, head = doHead;
                Action<AnimatorState, bool> bodyBehaviours = (st, on) =>
                {
                    var pl = st.AddStateMachineBehaviour<VRCPlayableLayerControl>();
                    pl.layer = VRC_PlayableLayerControl.BlendableLayer.Action;
                    pl.goalWeight = on ? 1f : 0f; pl.blendDuration = 0.25f;
                    pl.debugString = "KitsuNexus body " + (on ? "on" : "off");
                    var lc = st.AddStateMachineBehaviour<VRCAnimatorLayerControl>();
                    lc.playable = VRC_AnimatorLayerControl.BlendableLayer.Action;
                    lc.layer = idx; lc.goalWeight = on ? 1f : 0f; lc.blendDuration = 0.25f;
                    var tc = st.AddStateMachineBehaviour<VRCAnimatorTrackingControl>();
                    var tt = on ? TrackingType.Animation : TrackingType.Tracking;
                    if (arms) { tc.trackingLeftHand = tt; tc.trackingRightHand = tt; }
                    if (legs) { tc.trackingLeftFoot = tt; tc.trackingRightFoot = tt; }
                    if (spine || legs) tc.trackingHip = tt;
                    if (head) tc.trackingHead = tt;
                };
                AddGate(a, Prefix + "Body Gate", empty, new[] { "BT/Detected", BodyOn }, bodyBehaviours);
                // The pose state re-asserts the same "on" behaviours each time it's entered, so
                // tracking comes back by itself after an emote / AFK (VRChat's own states lower
                // the Action layer and restore tracking when they finish).
                AddBodyPoseState(a, bodyPose, st => bodyBehaviours(st, true), log);
                if (fallbackHands)
                {
                    AddAnimParam(a, HandsOn, AnimatorControllerParameterType.Bool, 1f, log);
                    foreach (var s in Sides)
                    {
                        foreach (var n in HandFloats(s)) AddAnimParam(a, n, AnimatorControllerParameterType.Float, 0f, log);
                        AddAnimParam(a, $"HT/{s}Detected", AnimatorControllerParameterType.Bool, 0f, log);
                    }
                    AddHandLayers(a, VRC_AnimatorLayerControl.BlendableLayer.Action, " (Action)", handL, handR, folder, empty);
                    log.Add("Hands fallback: also added the hand layers to the Action layer.");
                }
                EditorUtility.SetDirty(a);
                log.Add("Body: added [KN] Body (+ gate) to the Action layer '" + a.name + "'.");
            }

            ApplyExpressionParams(Wanted(), folder, log);
            if (addMenu) ApplyMenu(folder, log);

            log.Add("");
            log.Add($"Synced parameter memory now: {TotalCost()} / {MaxCost} bits.");
            log.Add("Done. Next: upload the avatar, then in VRChat open Action Menu > Options > OSC > Reset Config " +
                    "(VRChat caches the old parameter list), and start Face, Hands & Body tracking in KitsuNexus.");
            return log;
        }

        /* ---------------------------------------------------------- pose probe */

        // Poses the avatar through HumanPoseHandler so limbs can be measured for any
        // muscle value; puts every transform back exactly as it was on Dispose.
        sealed class Probe : IDisposable
        {
            public readonly Animator anim;
            public HumanPose rest;
            readonly Transform root;
            readonly HumanPoseHandler handler;
            readonly List<(Transform t, Vector3 p, Quaternion r, Vector3 s)> saved;

            public Probe(Animator a)
            {
                anim = a; root = a.transform;
                saved = root.GetComponentsInChildren<Transform>(true).Select(t => (t, t.localPosition, t.localRotation, t.localScale)).ToList();
                handler = new HumanPoseHandler(a.avatar, root);
                rest = new HumanPose();
                handler.GetHumanPose(ref rest);
            }

            // Rest pose with `muscles` set to v and, optionally, a different body rotation.
            // Bone rotation in the avatar's own space.
            public Quaternion R(HumanBodyBones b)
            {
                var t = anim.GetBoneTransform(b);
                return t == null ? Quaternion.identity : Quaternion.Inverse(root.rotation) * t.rotation;
            }

            // Rest pose with a different body rotation and position (for lying down).
            public void SetBody(Quaternion rot, Vector3 pos, Dictionary<int, float> muscles = null)
            {
                var p = rest;
                p.muscles = (float[])rest.muscles.Clone();
                if (muscles != null) foreach (var kv in muscles) p.muscles[kv.Key] = kv.Value;
                p.bodyRotation = rot; p.bodyPosition = pos;
                handler.SetHumanPose(ref p);
            }

            public void Set(int[] muscles, float v, Quaternion? body = null, (int muscle, float value)[] hold = null)
            {
                var p = rest;
                p.muscles = (float[])rest.muscles.Clone();
                if (hold != null) foreach (var h in hold) p.muscles[h.muscle] = h.value;
                foreach (var m in muscles) p.muscles[m] = v;
                if (body.HasValue) p.bodyRotation = body.Value;
                handler.SetHumanPose(ref p);
            }

            // Rest body rotation tilted by `bendDeg` about the avatar's right axis (forward
            // lean) and `sideDeg` about its forward axis.
            public Quaternion Tilt(float bendDeg, float sideDeg)
            {
                var q = Quaternion.AngleAxis(bendDeg, Vector3.right) * Quaternion.AngleAxis(sideDeg, Vector3.forward) * rest.bodyRotation;
                return q.w < 0f ? new Quaternion(-q.x, -q.y, -q.z, -q.w) : q;
            }

            public bool Has(params HumanBodyBones[] bones) { return bones.All(b => anim.GetBoneTransform(b) != null); }

            // Bone position in the avatar's own space (x = right, y = up, z = forward).
            public Vector3 P(HumanBodyBones b)
            {
                var t = anim.GetBoneTransform(b);
                return t == null ? Vector3.zero : root.InverseTransformPoint(t.position);
            }

            public void Dispose()
            {
                foreach (var s in saved)
                {
                    if (s.t == null) continue;
                    s.t.localPosition = s.p; s.t.localRotation = s.r; s.t.localScale = s.s;
                }
                handler.Dispose();
            }
        }

        class Sweep { public float[] m; public float[] f; }

        // Measure `measure` while moving `muscles` together from -1 to 1.
        static Sweep Measure(Probe pr, int[] muscles, Func<Probe, float> measure, Quaternion? body = null, (int muscle, float value)[] hold = null)
        {
            return SweepBy(-1f, 1f, 81, v => pr.Set(muscles, v, body, hold), () => measure(pr));
        }

        // Generic sweep: call set(v) for v in [min, max], record measure().
        static Sweep SweepBy(float min, float max, int n, Action<float> set, Func<float> measure)
        {
            var s = new Sweep { m = new float[n], f = new float[n] };
            for (int k = 0; k < n; k++)
            {
                float v = min + (max - min) * k / (n - 1);
                set(v);
                s.m[k] = v; s.f[k] = measure();
            }
            return s;
        }

        // Muscle value whose measurement equals `target`. If several do, the one nearest
        // the rest value; if none can reach it, the closest sample (limit of the joint).
        static float Solve(Sweep s, float target, float restM)
        {
            float best = float.NaN, bestDist = float.MaxValue;
            for (int k = 0; k < s.m.Length - 1; k++)
            {
                float a = s.f[k], b = s.f[k + 1];
                if ((target - a) * (target - b) > 0f) continue;
                float m = Mathf.Approximately(a, b) ? s.m[k] : Mathf.Lerp(s.m[k], s.m[k + 1], (target - a) / (b - a));
                float dist = Mathf.Abs(m - restM);
                if (dist < bestDist) { bestDist = dist; best = m; }
            }
            if (!float.IsNaN(best)) return best;
            int bi = 0;
            for (int k = 1; k < s.m.Length; k++) if (Mathf.Abs(s.f[k] - target) < Mathf.Abs(s.f[bi] - target)) bi = k;
            return s.m[bi];
        }

        /* ------------------------------------------------------------- hands */

        BlendTree BuildHand(Probe pr, string side, string path, List<string> log)
        {
            var root = Direct($"KN {side} Hand", path);
            var kids = new List<Motion>();
            var driven = new HashSet<int>();
            float[] fingerFist = { -0.9f, -1f, -1f };
            float[] thumbFist = { -0.4f, -0.6f, -0.8f };

            for (int f = 0; f < HtFingers.Length; f++)
            {
                int[] ms = new[] { 1, 2, 3 }.Select(j => Muscle($"{side} {UnityFingers[f]} {j} Stretched")).ToArray();
                float[] fist = f == 0 ? thumbFist : fingerFist;
                float strength = f == 0 ? thumbStrength : fistStrength;
                var open = Clip($"{side} {HtFingers[f]} Open", root, ms.Select(i => (Prop(i), pr.rest.muscles[i])));
                var curled = Clip($"{side} {HtFingers[f]} Curled", root, ms.Select((i, k) => (Prop(i), Mathf.Lerp(pr.rest.muscles[i], fist[k], strength))));
                var t = Tree1D($"{side} {HtFingers[f]} Curl", $"HT/{side}{HtFingers[f]}Curl", root);
                t.AddChild(open, 0f);
                t.AddChild(curled, 1f);
                kids.Add(t);
                foreach (var i in ms) driven.Add(i);
            }

            // Spread: for index / ring / little, find which way the Spread muscle moves the
            // finger away from the middle finger on this avatar.
            var together = new List<(string, float)>();
            var apart = new List<(string, float)>();
            var midA = HB(side + "MiddleProximal"); var midB = HB(side + "MiddleIntermediate");
            foreach (var fn in new[] { "Index", "Ring", "Little" })
            {
                int sm = Muscle($"{side} {fn} Spread");
                var a = HB(side + fn + "Proximal"); var b = HB(side + fn + "Intermediate");
                if (!pr.Has(a, b, midA, midB)) { log.Add($"{side} {fn}: finger bones missing, spread skipped for it."); continue; }
                var sw = Measure(pr, new[] { sm }, p => Vector3.Angle(p.P(b) - p.P(a), p.P(midB) - p.P(midA)));
                int kMin = 0;
                for (int k = 1; k < sw.m.Length; k++) if (sw.f[k] < sw.f[kMin]) kMin = k;
                float restV = pr.rest.muscles[sm];
                float away = sw.m[kMin] <= restV ? 1f : -1f;
                together.Add((Prop(sm), Mathf.Lerp(restV, sw.m[kMin], 0.8f)));
                apart.Add((Prop(sm), Mathf.Lerp(restV, away, 0.8f)));
                driven.Add(sm);
            }
            if (together.Count > 0)
            {
                var t = Tree1D($"{side} Spread", $"HT/{side}Spread", root);
                t.AddChild(Clip($"{side} Fingers Together", root, together), 0f);
                t.AddChild(Clip($"{side} Fingers Spread", root, apart), 1f);
                kids.Add(t);
            }

            var part = side == "Left" ? AvatarMaskBodyPart.LeftFingers : AvatarMaskBodyPart.RightFingers;
            var restProps = Enumerable.Range(0, HumanTrait.MuscleCount)
                .Where(i => !driven.Contains(i) && PartOf(i) == part)
                .Select(i => (Prop(i), pr.rest.muscles[i])).ToList();
            if (restProps.Count > 0) kids.Add(Clip($"{side} Hand Rest", root, restProps));

            SetDirectChildren(root, kids);
            return root;
        }

        /* -------------------------------------------------------------- body */

        // Every measurement below mirrors computeBodyParams() in bodyTracking.js, so a
        // parameter value of e.g. BT/LeftUpperLegX = 0.5 gives the same thigh angle here.
        //
        // Unity's humanoid body rotation (RootQ) follows the hips-to-shoulders line, so spine
        // muscles alone can't lean the torso: lean / side lean rotate RootQ instead. That
        // also tilts the hips and legs, so the thigh trees are 2D (thigh angle x lean),
        // each point solved with the avatar actually leaning, so thighs keep the angle the
        // camera saw (bodyTracking.js measures legs against a level pelvis, i.e. gravity).
        BlendTree BuildBody(Probe pr, string path, List<AvatarMaskBodyPart> parts, string posePath, out BlendTree pose)
        {
            var root = Direct("KN Body", path);
            var kids = new List<Motion>();
            var driven = new HashSet<int>();
            Neutral.Clear();
            float[] sym = Steps(-1f, 1f, 9);
            float[] bend = Steps(0f, 1f, 9);
            float[] armZ = Steps(-0.5f, 1f, 13);
            float[] lean = Steps(-1f, 1f, 5);
            const float Quarter = Mathf.PI / 2f;
            const float Bend150 = 150f;
            var lua = HumanBodyBones.LeftUpperArm; var rua = HumanBodyBones.RightUpperArm;
            var lul = HumanBodyBones.LeftUpperLeg; var rul = HumanBodyBones.RightUpperLeg;
            Func<Probe, Vector3> torsoUp = p => ((p.P(lua) + p.P(rua)) - (p.P(lul) + p.P(rul))).normalized;
            Func<Probe, float> bendOf = p => { var u = torsoUp(p); return Mathf.Atan2(u.z, u.y) / (Mathf.PI / 3f); };
            Func<Probe, float> sideOf = p => { var u = torsoUp(p); return Mathf.Atan2(u.x, u.y) / (Mathf.PI / 4f); };

            // Body rotation angles (degrees) that give each lean / side-lean value on this rig.
            var bendAngle = new Dictionary<float, float>();
            var sideAngle = new Dictionary<float, float>();
            if (doSpine)
            {
                var none = new int[0];
                var swB = SweepBy(-90f, 90f, 181, a => pr.Set(none, 0f, pr.Tilt(a, 0f)), () => bendOf(pr));
                var swS = SweepBy(-90f, 90f, 181, a => pr.Set(none, 0f, pr.Tilt(0f, a)), () => sideOf(pr));
                foreach (var v in lean) { bendAngle[v] = Solve(swB, v, 0f); sideAngle[v] = Solve(swS, v, 0f); }
            }
            Func<float, float, Quaternion> leanQ = (b, s) => pr.Tilt(doSpine ? bendAngle[b] : 0f, doSpine ? sideAngle[s] : 0f);

            foreach (var side in Sides)
            {
                float o = side == "Right" ? 1f : -1f; // +x is "outward" for the right limb
                var ul = HB(side + "UpperLeg"); var ll = HB(side + "LowerLeg"); var ft = HB(side + "Foot");
                var ua = HB(side + "UpperArm"); var la = HB(side + "LowerArm"); var hd = HB(side + "Hand");
                if (doLegs)
                {
                    parts.Add(side == "Left" ? AvatarMaskBodyPart.LeftLeg : AvatarMaskBodyPart.RightLeg);
                    Func<Probe, float> legX = p => { var d = p.P(ll) - p.P(ul); return Mathf.Atan2(d.z, -d.y) / Quarter; };
                    Func<Probe, float> legZ = p => { var d = p.P(ll) - p.P(ul); return Mathf.Atan2(d.x * o, -d.y) / Quarter; };
                    int fb = Muscle($"{side} Upper Leg Front-Back"), io = Muscle($"{side} Upper Leg In-Out");
                    if (doSpine)
                    {
                        kids.Add(TrackLean(pr, root, $"{side} Thigh Forward", $"BT/{side}UpperLegX", "BT/SpineBend", fb, legX, sym, lean, b => leanQ(b, 0f), driven));
                        kids.Add(TrackLean(pr, root, $"{side} Thigh Out", $"BT/{side}UpperLegZ", "BT/SpineSide", io, legZ, sym, lean, s => leanQ(0f, s), driven));
                    }
                    else
                    {
                        kids.Add(Track(pr, root, $"{side} Thigh Forward", $"BT/{side}UpperLegX", new[] { fb }, legX, sym, driven));
                        kids.Add(Track(pr, root, $"{side} Thigh Out", $"BT/{side}UpperLegZ", new[] { io }, legZ, sym, driven));
                    }
                    kids.Add(Track(pr, root, $"{side} Knee", $"BT/{side}Knee", new[] { Muscle($"{side} Lower Leg Stretch") },
                        p => Vector3.Angle(p.P(ll) - p.P(ul), p.P(ft) - p.P(ll)) / Bend150, bend, driven));
                }
                if (doArms)
                {
                    // Arms are measured against the chest in bodyTracking.js and ride along with
                    // the chest when the body leans, so they need no lean correction.
                    parts.Add(side == "Left" ? AvatarMaskBodyPart.LeftArm : AvatarMaskBodyPart.RightArm);
                    kids.Add(Track(pr, root, $"{side} Arm Forward", $"BT/{side}UpperArmX", new[] { Muscle($"{side} Arm Front-Back") },
                        p => { var a = p.P(la) - p.P(ua); return Mathf.Atan2(a.z, Mathf.Sqrt(a.y * a.y + a.x * a.x)) / Quarter; }, sym, driven));
                    kids.Add(Track(pr, root, $"{side} Arm Raise", $"BT/{side}UpperArmZ", new[] { Muscle($"{side} Arm Down-Up") },
                        p => { var a = p.P(la) - p.P(ua); return Mathf.Atan2(a.x * o, -a.y) / Mathf.PI; }, armZ, driven));
                    int forearm = Muscle($"{side} Forearm Stretch");
                    Func<Probe, float> elbowOf = p => Vector3.Angle(p.P(la) - p.P(ua), p.P(hd) - p.P(la)) / Bend150;
                    kids.Add(Track(pr, root, $"{side} Elbow", $"BT/{side}Elbow", new[] { forearm }, elbowOf, bend, driven));
                    // Upper-arm twist (BT/<Side>UpperArmTwist, bodyTracking.js armTwist()): which way the
                    // bent forearm points around the upper arm, 0 = forward, +1 = up, -1 = down. Measured
                    // with the elbow held bent 90 degrees so the forearm direction is defined.
                    float bent90 = Solve(Measure(pr, new[] { forearm }, elbowOf), 90f / Bend150, pr.rest.muscles[forearm]);
                    kids.Add(Track(pr, root, $"{side} Arm Twist", $"BT/{side}UpperArmTwist", new[] { Muscle($"{side} Arm Twist In-Out") },
                        p => ArmTwistOf(p.P(la) - p.P(ua), p.P(hd) - p.P(la), o), sym, driven, new[] { (forearm, bent90) }));
                }
            }

            if (doSpine)
            {
                parts.Add(AvatarMaskBodyPart.Body);
                kids.Add(Track(pr, root, "Spine Twist", "BT/SpineTwist", new[] { Muscle("Spine Twist Left-Right"), Muscle("Chest Twist Left-Right") },
                    p => TwistOf(p.P(rua) - p.P(lua), p.P(rul) - p.P(lul)), sym, driven));

            }

            if (doHead && pr.Has(HumanBodyBones.Head))
            {
                // Head rotation from face tracking, split over neck + head like a real neck.
                // Measured from the head bone's actual rotation, in the same convention as the
                // face tracker (unifiedExpressions.js): yaw + = turn right, pitch + = look down,
                // roll + = tilt toward the left shoulder; ±1 = ±90°.
                parts.Add(AvatarMaskBodyPart.Head);
                pr.Set(new int[0], 0f);
                var head0 = pr.R(HumanBodyBones.Head);
                Func<Probe, Quaternion> dq = p => p.R(HumanBodyBones.Head) * Quaternion.Inverse(head0);
                kids.Add(Track(pr, root, "Head Yaw", HeadYaw, new[] { Muscle("Neck Turn Left-Right"), Muscle("Head Turn Left-Right") },
                    p => { var f = dq(p) * Vector3.forward; return Mathf.Atan2(f.x, f.z) / Quarter; }, sym, driven));
                kids.Add(Track(pr, root, "Head Pitch", HeadPitch, new[] { Muscle("Neck Nod Down-Up"), Muscle("Head Nod Down-Up") },
                    p => { var f = dq(p) * Vector3.forward; return Mathf.Asin(Mathf.Clamp(-f.y, -1f, 1f)) / Quarter; }, sym, driven));
                kids.Add(Track(pr, root, "Head Roll", HeadRoll, new[] { Muscle("Neck Tilt Left-Right"), Muscle("Head Tilt Left-Right") },
                    p => { var u = dq(p) * Vector3.up; return Mathf.Atan2(-u.x, u.y) / Quarter; }, sym, driven));
            }

            // Body position / rotation (crouch, lean). Unity only takes these from the FIRST
            // layer of a controller, so this tree is played by a state in the Action
            // controller's base layer (AddBodyPoseState), not by the [KN] Body layer.
            pose = null;
            {
                var rp = pr.rest.bodyPosition;
                pose = new BlendTree { name = "KN Body Pose", blendType = BlendTreeType.Simple1D, blendParameter = doSpine ? "BT/Lying" : One, useAutomaticThresholds = false };
                AssetDatabase.CreateAsset(pose, posePath);
                var poseRoot = pose;
                var upright = Tree1D("Upright", doLegs ? "BT/Crouch" : One, poseRoot);
                // A clip with only RootT/RootQ isn't treated as humanoid (Unity skips it), so the
                // pose clips also carry the spine's rest muscles (the [KN] Body layer above
                // overrides those anyway).
                var spineRest = Enumerable.Range(0, HumanTrait.MuscleCount).Where(i => PartOf(i) == AvatarMaskBodyPart.Body)
                    .Select(i => (Prop(i), pr.rest.muscles[i])).ToArray();
                Func<float, string, Motion> leanAt = (y, label) =>
                {
                    Func<Quaternion, (string, float)[]> at = q => new[] { ("RootT.x", rp.x), ("RootT.y", y), ("RootT.z", rp.z), ("RootQ.x", q.x), ("RootQ.y", q.y), ("RootQ.z", q.z), ("RootQ.w", q.w) }.Concat(spineRest).ToArray();
                    if (!doSpine) return Clip($"Hips {label}", poseRoot, at(pr.rest.bodyRotation));
                    var t = Tree2D($"Lean {label}", "BT/SpineBend", "BT/SpineSide", poseRoot);
                    foreach (var b in lean)
                        foreach (var sd in lean)
                            t.AddChild(Clip($"Lean {label} {b:0.##} {sd:0.##}", poseRoot, at(leanQ(b, sd))), new Vector2(b, sd));
                    return t;
                };
                // Crouch lowers the hips like bodyTracking.js: 1 = hips 60% lower.
                upright.AddChild(leanAt(rp.y, "standing"), 0f);
                if (doLegs) upright.AddChild(leanAt(rp.y * 0.4f, "crouched"), 1f);
                pose.AddChild(upright, 0f);
                if (doSpine)
                {
                    // Lying down (BT/Lying = 1): the body tilted by BT/LiePitch (±1 = ±90°, -1 = on the
                    // back) then BT/LieRoll (±1 = ±180°, ±0.5 = on a side), like lyingAngles() in
                    // bodyTracking.js, and lowered so its lowest bone rests just above the floor.
                    var lieTree = Tree2D("Lying", "BT/LiePitch", "BT/LieRoll", poseRoot);
                    foreach (var lp in Steps(-1f, 1f, 5))
                        foreach (var lr in Steps(-1f, 1f, 9))
                        {
                            var q = pr.Tilt(lp * 90f, lr * 180f);
                            float y = LyingHeight(pr, q);
                            lieTree.AddChild(Clip($"Lying {lp:0.##} {lr:0.##}", poseRoot,
                                new[] { ("RootT.x", rp.x), ("RootT.y", y), ("RootT.z", rp.z), ("RootQ.x", q.x), ("RootQ.y", q.y), ("RootQ.z", q.z), ("RootQ.w", q.w) }.Concat(spineRest).ToArray()),
                                new Vector2(lp, lr));
                        }
                    pose.AddChild(lieTree, 1f);
                }
                EditorUtility.SetDirty(pose);
            }

            var partSet = new HashSet<AvatarMaskBodyPart>(parts);
            var restProps = Enumerable.Range(0, HumanTrait.MuscleCount)
                .Where(i => !driven.Contains(i) && PartOf(i).HasValue && partSet.Contains(PartOf(i).Value) && !IsEyeOrJaw(i))
                .Select(i => (Prop(i), pr.rest.muscles[i])).ToList();
            if (restProps.Count > 0) kids.Add(Clip("Body Rest", root, restProps));

            SetDirectChildren(root, kids);
            return root;
        }

        // Shoulders turned against the hips, like bodyTracking.js (+ = shoulders to own left,
        // normalised to +-60 deg). Measured against the hips, not the root, because Unity's
        // pose solver turns the hips back while the Animator keeps them from the pose layer.
        static float TwistOf(Vector3 shoulderLine, Vector3 hipLine)
        {
            var right = new Vector3(hipLine.x, 0f, hipLine.z).normalized;
            var fwd = Vector3.Cross(right, Vector3.up);
            return Mathf.Atan2(Vector3.Dot(shoulderLine, fwd), Vector3.Dot(shoulderLine, right)) / (Mathf.PI / 3f);
        }

        // Same as armTwist() in bodyTracking.js (avatar space: x right, y up, z forward).
        static float ArmTwistOf(Vector3 upper, Vector3 fore, float outward)
        {
            var a = upper.normalized;
            var f0 = Vector3.forward - a * Vector3.Dot(Vector3.forward, a);
            if (f0.magnitude < 0.3f) return 0f;
            f0.Normalize();
            var upRef = Vector3.Cross(a, f0) * -outward;
            var fp = fore - a * Vector3.Dot(fore, a);
            return Mathf.Clamp(Mathf.Atan2(Vector3.Dot(fp, upRef), Vector3.Dot(fp, f0)) / (Mathf.PI / 2f), -1f, 1f);
        }

        // Muscle values for every tracked limb parameter at 0 (arms hanging, legs straight):
        // the pose the app sends while lying, so the lying height is computed for it.
        static readonly Dictionary<int, float> Neutral = new Dictionary<int, float>();

        static readonly HumanBodyBones[] OutlineBones = {
            HumanBodyBones.Hips, HumanBodyBones.Spine, HumanBodyBones.Chest, HumanBodyBones.Neck, HumanBodyBones.Head,
            HumanBodyBones.LeftShoulder, HumanBodyBones.RightShoulder, HumanBodyBones.LeftUpperArm, HumanBodyBones.RightUpperArm,
            HumanBodyBones.LeftLowerArm, HumanBodyBones.RightLowerArm, HumanBodyBones.LeftHand, HumanBodyBones.RightHand,
            HumanBodyBones.LeftUpperLeg, HumanBodyBones.RightUpperLeg, HumanBodyBones.LeftLowerLeg, HumanBodyBones.RightLowerLeg,
            HumanBodyBones.LeftFoot, HumanBodyBones.RightFoot, HumanBodyBones.LeftToes, HumanBodyBones.RightToes };

        // Body height (normalised RootT.y) at which the body, rotated by q, has its lowest bone
        // ~6% of the standing hip height above the floor. The lowest point moves linearly with
        // the body height, so two samples solve it.
        static float LyingHeight(Probe pr, Quaternion q)
        {
            var rp = pr.rest.bodyPosition;
            float Low(float y)
            {
                pr.SetBody(q, new Vector3(rp.x, y, rp.z), Neutral);
                return OutlineBones.Where(b => pr.Has(b)).Min(b => pr.P(b).y);
            }
            pr.Set(new int[0], 0f);
            float hipH = pr.P(HumanBodyBones.Hips).y;
            float y0 = rp.y, y1 = rp.y * 0.5f;
            float l0 = Low(y0), l1 = Low(y1);
            if (Mathf.Abs(l0 - l1) < 1e-5f) return rp.y * 0.2f;
            float target = hipH * 0.06f;
            return y0 + (target - l0) * (y1 - y0) / (l1 - l0);
        }

        static float[] Steps(float a, float b, int n)
        {
            var r = new float[n];
            for (int i = 0; i < n; i++) r[i] = Mathf.Round((a + (b - a) * i / (n - 1)) * 1000f) / 1000f;
            return r;
        }

        // 1D blend tree on `param`; at each threshold, a clip with the muscle value(s) that
        // make the avatar's limb measure that parameter value.
        static Motion Track(Probe pr, BlendTree container, string name, string param, int[] muscles,
                            Func<Probe, float> measure, float[] thresholds, HashSet<int> driven, (int muscle, float value)[] hold = null)
        {
            var sw = Measure(pr, muscles, measure, null, hold);
            float restM = pr.rest.muscles[muscles[0]];
            var tree = Tree1D(name, param, container);
            foreach (var t in thresholds)
            {
                float m = Solve(sw, t, restM);
                if (t == 0f) foreach (var i in muscles) Neutral[i] = m;
                tree.AddChild(Clip($"{name} {t:0.###}", container, muscles.Select(i => (Prop(i), m))), t);
            }
            foreach (var i in muscles) driven.Add(i);
            return tree;
        }

        // 2D (param x lean) tree: for every lean value the muscle is solved with the body
        // rotated by that lean, so the limb measures `param` in the level (gravity) frame.
        static Motion TrackLean(Probe pr, BlendTree container, string name, string param, string leanParam, int muscle,
                                Func<Probe, float> measure, float[] thresholds, float[] leans, Func<float, Quaternion> bodyFor, HashSet<int> driven)
        {
            var tree = Tree2D(name, param, leanParam, container);
            float restM = pr.rest.muscles[muscle];
            foreach (var l in leans)
            {
                var sw = Measure(pr, new[] { muscle }, measure, bodyFor(l));
                foreach (var t in thresholds)
                {
                    float m = Solve(sw, t, restM);
                    if (t == 0f && l == 0f) Neutral[muscle] = m;
                    tree.AddChild(Clip($"{name} {t:0.###} lean {l:0.##}", container, new[] { (Prop(muscle), m) }), new Vector2(t, l));
                }
            }
            driven.Add(muscle);
            return tree;
        }

        /* --------------------------------------------------- muscles & masks */

        internal static readonly Regex FingerRx = new Regex(@"^(Left|Right) (Thumb|Index|Middle|Ring|Little) (.+)$");

        static int Muscle(string name)
        {
            int i = Array.IndexOf(HumanTrait.MuscleName, name);
            if (i < 0) throw new Exception("Unity has no humanoid muscle called '" + name + "'.");
            return i;
        }

        // Animation clip property for a muscle: body muscles use their name, finger
        // muscles are written "LeftHand.Index.1 Stretched".
        internal static string Prop(int muscle)
        {
            string n = HumanTrait.MuscleName[muscle];
            var m = FingerRx.Match(n);
            return m.Success ? $"{m.Groups[1].Value}Hand.{m.Groups[2].Value}.{m.Groups[3].Value}" : n;
        }

        static HumanBodyBones HB(string name) { return (HumanBodyBones)Enum.Parse(typeof(HumanBodyBones), name); }

        static bool IsEyeOrJaw(int muscle)
        {
            var b = (HumanBodyBones)HumanTrait.BoneFromMuscle(muscle);
            return b == HumanBodyBones.LeftEye || b == HumanBodyBones.RightEye || b == HumanBodyBones.Jaw;
        }

        static AvatarMaskBodyPart? PartOf(int muscle)
        {
            var b = (HumanBodyBones)HumanTrait.BoneFromMuscle(muscle);
            switch (b)
            {
                case HumanBodyBones.Spine: case HumanBodyBones.Chest: case HumanBodyBones.UpperChest:
                    return AvatarMaskBodyPart.Body;
                case HumanBodyBones.Neck: case HumanBodyBones.Head: case HumanBodyBones.LeftEye: case HumanBodyBones.RightEye: case HumanBodyBones.Jaw:
                    return AvatarMaskBodyPart.Head;
                case HumanBodyBones.LeftUpperLeg: case HumanBodyBones.LeftLowerLeg: case HumanBodyBones.LeftFoot: case HumanBodyBones.LeftToes:
                    return AvatarMaskBodyPart.LeftLeg;
                case HumanBodyBones.RightUpperLeg: case HumanBodyBones.RightLowerLeg: case HumanBodyBones.RightFoot: case HumanBodyBones.RightToes:
                    return AvatarMaskBodyPart.RightLeg;
                case HumanBodyBones.LeftShoulder: case HumanBodyBones.LeftUpperArm: case HumanBodyBones.LeftLowerArm: case HumanBodyBones.LeftHand:
                    return AvatarMaskBodyPart.LeftArm;
                case HumanBodyBones.RightShoulder: case HumanBodyBones.RightUpperArm: case HumanBodyBones.RightLowerArm: case HumanBodyBones.RightHand:
                    return AvatarMaskBodyPart.RightArm;
            }
            string s = b.ToString();
            if (s.StartsWith("Left")) return AvatarMaskBodyPart.LeftFingers;
            if (s.StartsWith("Right")) return AvatarMaskBodyPart.RightFingers;
            return null;
        }

        static AvatarMask MakeMask(string path, params AvatarMaskBodyPart[] parts)
        {
            var m = AssetDatabase.LoadAssetAtPath<AvatarMask>(path);
            if (m == null) { m = new AvatarMask(); AssetDatabase.CreateAsset(m, path); }
            for (var p = AvatarMaskBodyPart.Root; p < AvatarMaskBodyPart.LastBodyPart; p++)
                m.SetHumanoidBodyPartActive(p, parts.Contains(p));
            EditorUtility.SetDirty(m);
            return m;
        }

        // VRChat applies the first layer's mask to the whole playable layer.
        static void CheckBaseMask(AnimatorController c, AvatarMaskBodyPart[] needed, string label, List<string> log)
        {
            if (c.layers.Length == 0) return;
            var m = c.layers[0].avatarMask;
            if (m == null) return;
            var missing = needed.Where(p => !m.GetHumanoidBodyPartActive(p)).ToList();
            if (missing.Count > 0)
                log.Add($"WARNING: the first layer of your {label} controller uses mask '{m.name}', which blocks {string.Join(", ", missing)}. " +
                        $"VRChat applies that mask to the whole {label} layer, so those parts won't move until you enable them in that mask.");
        }

        /* ------------------------------------------------- asset helpers */

        static AnimationClip Clip(string name, UnityEngine.Object container, IEnumerable<(string, float)> curves)
        {
            var c = new AnimationClip { name = name };
            foreach (var (prop, v) in curves)
                AnimationUtility.SetEditorCurve(c, EditorCurveBinding.FloatCurve("", typeof(Animator), prop), AnimationCurve.Constant(0f, 1f / 60f, v));
            var settings = AnimationUtility.GetAnimationClipSettings(c);
            settings.loopTime = true;
            // "Bake Into Pose" + "Based Upon: Original" for root rotation and position, so the
            // body lean / hips height in RootQ / RootT stay in the pose instead of being
            // pulled out as root motion (which flattens the lean on the Animator).
            settings.loopBlendOrientation = true;
            settings.loopBlendPositionY = true;
            settings.loopBlendPositionXZ = true;
            settings.keepOriginalOrientation = true;
            settings.keepOriginalPositionY = true;
            settings.keepOriginalPositionXZ = true;
            AnimationUtility.SetAnimationClipSettings(c, settings);
            AssetDatabase.AddObjectToAsset(c, container);
            return c;
        }

        static AnimationClip EmptyClip(string folder)
        {
            string p = $"{folder}/KN_Empty.anim";
            var c = AssetDatabase.LoadAssetAtPath<AnimationClip>(p);
            if (c == null) { c = new AnimationClip { name = "KN_Empty" }; AssetDatabase.CreateAsset(c, p); }
            return c;
        }

        static BlendTree Direct(string name, string path)
        {
            var t = new BlendTree { name = name, blendType = BlendTreeType.Direct, blendParameter = One, useAutomaticThresholds = false };
            AssetDatabase.CreateAsset(t, path);
            return t;
        }

        static BlendTree Tree1D(string name, string param, UnityEngine.Object container)
        {
            var t = new BlendTree { name = name, blendType = BlendTreeType.Simple1D, blendParameter = param, useAutomaticThresholds = false, hideFlags = HideFlags.HideInHierarchy };
            AssetDatabase.AddObjectToAsset(t, container);
            return t;
        }

        static BlendTree Tree2D(string name, string paramX, string paramY, UnityEngine.Object container)
        {
            var t = new BlendTree { name = name, blendType = BlendTreeType.FreeformCartesian2D, blendParameter = paramX, blendParameterY = paramY, useAutomaticThresholds = false, hideFlags = HideFlags.HideInHierarchy };
            AssetDatabase.AddObjectToAsset(t, container);
            return t;
        }

        static void SetDirectChildren(BlendTree root, List<Motion> kids)
        {
            root.children = kids.Select(m => new ChildMotion { motion = m, directBlendParameter = One, timeScale = 1f }).ToArray();
            EditorUtility.SetDirty(root);
        }

        static string Fresh(string path)
        {
            if (AssetDatabase.LoadMainAssetAtPath(path) != null) AssetDatabase.DeleteAsset(path);
            return path;
        }

        static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            string cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }

        internal static string Safe(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            s = s.Trim();
            return s.Length == 0 ? "Avatar" : s;
        }

        string AvatarFolder()
        {
            string p = "Assets/KitsuNexus/Tracking/" + Safe(avatar.gameObject.name);
            EnsureFolder(p);
            return p;
        }

        static bool InPackages(UnityEngine.Object o)
        {
            string p = AssetDatabase.GetAssetPath(o);
            return !string.IsNullOrEmpty(p) && p.StartsWith("Packages/");
        }

        // Copy a read-only package asset (e.g. an SDK sample) into the avatar folder.
        static T CopyIntoFolder<T>(string srcPath, string folder, string fileName) where T : UnityEngine.Object
        {
            string dst = AssetDatabase.GenerateUniqueAssetPath($"{folder}/{fileName}");
            if (!AssetDatabase.CopyAsset(srcPath, dst)) throw new Exception($"Couldn't copy {srcPath} to {dst}.");
            return AssetDatabase.LoadAssetAtPath<T>(dst);
        }

        void Backup(string folder, string stamp, List<string> log)
        {
            var objs = new List<UnityEngine.Object>();
            if (avatar.customizeAnimationLayers && avatar.baseAnimationLayers != null)
                foreach (var l in avatar.baseAnimationLayers)
                    if ((l.type == AnimLayerType.Gesture || l.type == AnimLayerType.Action) && !l.isDefault && l.animatorController != null)
                        objs.Add(l.animatorController);
            if (avatar.expressionParameters != null) objs.Add(avatar.expressionParameters);
            if (avatar.expressionsMenu != null) objs.Add(avatar.expressionsMenu);
            objs = objs.Where(o => !InPackages(o) && !string.IsNullOrEmpty(AssetDatabase.GetAssetPath(o))).Distinct().ToList();
            if (objs.Count == 0) return;
            string dir = $"{folder}/Backups/{stamp}";
            EnsureFolder(dir);
            foreach (var o in objs)
            {
                string src = AssetDatabase.GetAssetPath(o);
                AssetDatabase.CopyAsset(src, AssetDatabase.GenerateUniqueAssetPath($"{dir}/{Path.GetFileName(src)}"));
            }
            log.Add("Backed up your controllers / parameters / menu to " + dir);
        }

        /* ------------------------------------------------- controllers */

        AnimatorController EnsureController(AnimLayerType type, string sampleName, string folder, List<string> log)
        {
            var layers = avatar.baseAnimationLayers;
            if (layers == null || layers.Length == 0)
            {
                // A descriptor whose inspector was never opened has no layer slots yet; create
                // the standard humanoid set (all VRChat defaults) like the SDK inspector does.
                Undo.RecordObject(avatar, "KitsuNexus tracking setup");
                layers = new[] { AnimLayerType.Base, AnimLayerType.Additive, AnimLayerType.Gesture, AnimLayerType.Action, AnimLayerType.FX }
                    .Select(t => new VRCAvatarDescriptor.CustomAnimLayer { type = t, isDefault = true, isEnabled = true }).ToArray();
                avatar.baseAnimationLayers = layers;
                if (avatar.specialAnimationLayers == null || avatar.specialAnimationLayers.Length == 0)
                    avatar.specialAnimationLayers = new[] { AnimLayerType.Sitting, AnimLayerType.TPose, AnimLayerType.IKPose }
                        .Select(t => new VRCAvatarDescriptor.CustomAnimLayer { type = t, isDefault = true, isEnabled = true }).ToArray();
                EditorUtility.SetDirty(avatar);
            }
            int i = Array.FindIndex(layers, l => l.type == type);
            if (i < 0)
                throw new Exception($"The Avatar Descriptor has no {type} playable layer slot. In the VRC Avatar Descriptor open Playable Layers, click Customize, then run this again.");

            var cur = layers[i];
            string fileName = Safe(avatar.gameObject.name) + "_" + type + ".controller";
            AnimatorController ctrl;
            if (avatar.customizeAnimationLayers && !cur.isDefault && cur.animatorController != null)
            {
                var ac = cur.animatorController as AnimatorController;
                if (ac == null)
                    throw new Exception($"Your {type} layer uses an Animator Override Controller. This tool needs a normal Animator Controller there.");
                if (!InPackages(ac)) return ac;
                ctrl = CopyIntoFolder<AnimatorController>(AssetDatabase.GetAssetPath(ac), folder, fileName);
                log.Add($"Your {type} layer pointed at a read-only SDK controller; using a copy: {AssetDatabase.GetAssetPath(ctrl)}");
            }
            else
            {
                string src = AssetDatabase.FindAssets(sampleName + " t:AnimatorController").Select(AssetDatabase.GUIDToAssetPath)
                    .FirstOrDefault(p => Path.GetFileNameWithoutExtension(p) == sampleName);
                if (src != null) ctrl = CopyIntoFolder<AnimatorController>(src, folder, fileName);
                else
                {
                    ctrl = AnimatorController.CreateAnimatorControllerAtPath(AssetDatabase.GenerateUniqueAssetPath($"{folder}/{fileName}"));
                    if (type == AnimLayerType.Gesture)
                    {
                        var ls = ctrl.layers;
                        ls[0].avatarMask = MakeMask($"{folder}/KN_HandsOnly.mask", AvatarMaskBodyPart.LeftFingers, AvatarMaskBodyPart.RightFingers);
                        ctrl.layers = ls;
                    }
                }
                log.Add($"Your {type} layer was VRChat's default; made an editable copy: {AssetDatabase.GetAssetPath(ctrl)}");
            }

            Undo.RecordObject(avatar, "KitsuNexus tracking setup");
            avatar.customizeAnimationLayers = true;
            cur.isDefault = false; cur.isEnabled = true; cur.animatorController = ctrl;
            layers[i] = cur;
            avatar.baseAnimationLayers = layers;
            EditorUtility.SetDirty(avatar);
            return ctrl;
        }

        AnimatorController CustomControllerOrNull(AnimLayerType type)
        {
            if (!avatar.customizeAnimationLayers || avatar.baseAnimationLayers == null) return null;
            foreach (var l in avatar.baseAnimationLayers)
                if (l.type == type && !l.isDefault) return l.animatorController as AnimatorController;
            return null;
        }

        static void AddAnimParam(AnimatorController c, string name, AnimatorControllerParameterType t, float def, List<string> log)
        {
            var ps = c.parameters;
            int i = Array.FindIndex(ps, p => p.name == name);
            if (i >= 0)
            {
                if (ps[i].type != t)
                {
                    log.Add($"Changed animator parameter {name} in '{c.name}' from {ps[i].type} to {t} (KitsuNexus sends it as {t}).");
                    ps[i].type = t;
                    c.parameters = ps;
                }
                return;
            }
            c.AddParameter(new AnimatorControllerParameter { name = name, type = t, defaultFloat = def, defaultBool = def > 0.5f, defaultInt = (int)def });
        }

        // [KN] Left/Right Hand (+ gates) in a controller; `playable` is the VRChat layer the
        // controller sits on (for the gates' layer control).
        static void AddHandLayers(AnimatorController c, VRC_AnimatorLayerControl.BlendableLayer playable, string suffix,
                                  BlendTree handL, BlendTree handR, string folder, AnimationClip empty)
        {
            AddTrackingLayer(c, Prefix + "Left Hand" + suffix, handL, MakeMask($"{folder}/KN_LeftFingers.mask", AvatarMaskBodyPart.LeftFingers));
            AddTrackingLayer(c, Prefix + "Right Hand" + suffix, handR, MakeMask($"{folder}/KN_RightFingers.mask", AvatarMaskBodyPart.RightFingers));
            foreach (var s in Sides)
            {
                string side = s;
                int idx = LayerIndex(c, Prefix + side + " Hand" + suffix);
                AddGate(c, Prefix + side + " Hand Gate" + suffix, empty, new[] { $"HT/{side}Detected", HandsOn }, (st, on) =>
                {
                    var lc = st.AddStateMachineBehaviour<VRCAnimatorLayerControl>();
                    lc.playable = playable;
                    lc.layer = idx; lc.goalWeight = on ? 1f : 0f; lc.blendDuration = 0.15f;
                    lc.debugString = $"KitsuNexus {side} hand {(on ? "on" : "off")}";
                    var tc = st.AddStateMachineBehaviour<VRCAnimatorTrackingControl>();
                    var tt = on ? TrackingType.Animation : TrackingType.Tracking;
                    if (side == "Left") tc.trackingLeftFingers = tt; else tc.trackingRightFingers = tt;
                });
            }
        }

        static AnimatorStateMachine NewLayer(AnimatorController c, string name, float weight, AvatarMask mask)
        {
            var sm = new AnimatorStateMachine { name = name, hideFlags = HideFlags.HideInHierarchy };
            AssetDatabase.AddObjectToAsset(sm, c);
            c.AddLayer(new AnimatorControllerLayer { name = name, stateMachine = sm, defaultWeight = weight, avatarMask = mask });
            return sm;
        }

        // Always-playing direct blend tree; layer weight starts at 0 and is raised by the gate.
        // Write Defaults ON is what direct blend trees need; the mask keeps it to its own body part.
        static void AddTrackingLayer(AnimatorController c, string name, Motion tree, AvatarMask mask)
        {
            var sm = NewLayer(c, name, 0f, mask);
            var st = sm.AddState("Tracking", new Vector3(300f, 0f, 0f));
            st.motion = tree;
            st.writeDefaultValues = true;
            sm.defaultState = st;
        }

        // Off <-> On on (all conds true); behaviours added to both states.
        static void AddGate(AnimatorController c, string name, AnimationClip empty, string[] conds, Action<AnimatorState, bool> behaviours)
        {
            var sm = NewLayer(c, name, 1f, null);
            var off = sm.AddState("Off", new Vector3(300f, 0f, 0f));
            var on = sm.AddState("On", new Vector3(300f, 120f, 0f));
            off.motion = empty; on.motion = empty;
            off.writeDefaultValues = false; on.writeDefaultValues = false;
            sm.defaultState = off;
            var t = off.AddTransition(on); Instant(t);
            foreach (var p in conds) t.AddCondition(AnimatorConditionMode.If, 0f, p);
            foreach (var p in conds) { var b = on.AddTransition(off); Instant(b); b.AddCondition(AnimatorConditionMode.IfNot, 0f, p); }
            behaviours(on, true);
            behaviours(off, false);
        }

        // Unity takes body position/rotation only from a controller's first layer, so the
        // crouch/lean tree is a state in the Action base layer. It's entered from the base
        // layer's idle (default) state while the body is tracked, and hands control back
        // to VRChat as soon as an emote or AFK starts, so those keep working.
        static void AddBodyPoseState(AnimatorController c, Motion pose, Action<AnimatorState> onEnter, List<string> log)
        {
            var sm = c.layers[0].stateMachine;
            var idle = sm.defaultState;
            if (idle == null)
            {
                idle = sm.AddState(Prefix + "Idle", new Vector3(300f, 0f, 0f));
                sm.defaultState = idle;
            }
            var idlePos = sm.states.FirstOrDefault(s => s.state == idle).position;
            var st = sm.AddState(Prefix + "Body Pose", idlePos + new Vector3(0f, 160f, 0f));
            st.motion = pose;
            st.writeDefaultValues = idle.writeDefaultValues;
            onEnter(st);

            bool hasAfk = c.parameters.Any(p => p.name == "AFK" && p.type == AnimatorControllerParameterType.Bool);
            bool hasEmote = c.parameters.Any(p => p.name == "VRCEmote" && p.type == AnimatorControllerParameterType.Int);

            var tin = idle.AddTransition(st); Instant(tin); tin.duration = 0.2f;
            tin.AddCondition(AnimatorConditionMode.If, 0f, "BT/Detected");
            tin.AddCondition(AnimatorConditionMode.If, 0f, BodyOn);
            if (hasAfk) tin.AddCondition(AnimatorConditionMode.IfNot, 0f, "AFK");
            if (hasEmote) tin.AddCondition(AnimatorConditionMode.Equals, 0f, "VRCEmote");

            void Out(AnimatorConditionMode mode, float th, string param)
            {
                var t = st.AddTransition(idle); Instant(t); t.duration = 0.2f;
                t.AddCondition(mode, th, param);
            }
            Out(AnimatorConditionMode.IfNot, 0f, "BT/Detected");
            Out(AnimatorConditionMode.IfNot, 0f, BodyOn);
            if (hasAfk) Out(AnimatorConditionMode.If, 0f, "AFK");
            if (hasEmote) Out(AnimatorConditionMode.NotEqual, 0f, "VRCEmote");
            log.Add($"Body: added state '{st.name}' (crouch / lean) to the first layer of '{c.name}', entered from '{idle.name}'.");
        }

        // VRChat applies the first layer's mask to the whole playable layer. While body tracking
        // raises the Action layer, it should only take the body parts it tracks (plus Root for
        // lean/crouch) and let hands/gestures, head and untracked limbs show through.
        // Only set when your Action controller has no first-layer mask; Remove puts it back.
        const string ActionMaskName = "KN_ActionMask";
        static void SetActionMask(AnimatorController c, List<AvatarMaskBodyPart> parts, string folder, List<string> log)
        {
            var ls = c.layers;
            if (ls.Length == 0 || ls[0].avatarMask != null) return;
            ls[0].avatarMask = MakeMask($"{folder}/{ActionMaskName}.mask", parts.Concat(new[] { AvatarMaskBodyPart.Root }).ToArray());
            c.layers = ls;
            log.Add($"Body: gave the Action layer a mask ({string.Join(", ", parts)}, Root), so your hand tracking / gestures and head still show while body tracking is on. Emotes are limited to those parts too.");
        }

        static void RemoveBodyPoseState(AnimatorController c)
        {
            if (c.layers.Length == 0) return;
            var ls = c.layers;
            if (ls[0].avatarMask != null && ls[0].avatarMask.name == ActionMaskName) { ls[0].avatarMask = null; c.layers = ls; }
            var sm = c.layers[0].stateMachine;
            var ours = sm.states.Select(s => s.state).Where(s => s.name.StartsWith(Prefix)).ToList();
            if (ours.Count == 0) return;
            foreach (var cs in sm.states)
                foreach (var t in cs.state.transitions.Where(t => ours.Contains(t.destinationState)).ToArray())
                    cs.state.RemoveTransition(t);
            foreach (var t in sm.anyStateTransitions.Where(t => ours.Contains(t.destinationState)).ToArray())
                sm.RemoveAnyStateTransition(t);
            if (ours.Contains(sm.defaultState)) sm.defaultState = null;
            foreach (var s in ours) sm.RemoveState(s);
        }

        static void Instant(AnimatorStateTransition t)
        {
            t.hasExitTime = false; t.exitTime = 0f; t.duration = 0f; t.hasFixedDuration = true;
        }

        static int LayerIndex(AnimatorController c, string name)
        {
            int i = Array.FindIndex(c.layers, l => l.name == name);
            if (i < 0) throw new Exception("Layer " + name + " missing after creation.");
            return i;
        }

        /* --------------------------------------- expression params & menu */

        void ApplyExpressionParams(List<Spec> specs, string folder, List<string> log)
        {
            var ep = avatar.expressionParameters;
            string safe = Safe(avatar.gameObject.name);
            if (ep == null || InPackages(ep))
            {
                if (ep != null) ep = CopyIntoFolder<VRCExpressionParameters>(AssetDatabase.GetAssetPath(ep), folder, safe + "_Parameters.asset");
                else
                {
                    ep = CreateInstance<VRCExpressionParameters>();
                    ep.parameters = new ExprParam[0];
                    AssetDatabase.CreateAsset(ep, AssetDatabase.GenerateUniqueAssetPath($"{folder}/{safe}_Parameters.asset"));
                }
                Undo.RecordObject(avatar, "KitsuNexus tracking setup");
                avatar.customExpressions = true;
                avatar.expressionParameters = ep;
                if (avatar.expressionsMenu == null)
                {
                    var menu = CreateInstance<VRCExpressionsMenu>();
                    AssetDatabase.CreateAsset(menu, AssetDatabase.GenerateUniqueAssetPath($"{folder}/{safe}_Menu.asset"));
                    avatar.expressionsMenu = menu;
                }
                EditorUtility.SetDirty(avatar);
                log.Add("Created Expression Parameters " + AssetDatabase.GetAssetPath(ep));
            }

            Undo.RecordObject(ep, "KitsuNexus tracking setup");
            var list = (ep.parameters ?? new ExprParam[0]).Where(p => p != null).ToList();
            foreach (var s in specs)
            {
                var p = list.FirstOrDefault(x => x.name == s.name);
                if (p == null) { p = new ExprParam(); list.Add(p); }
                p.name = s.name; p.valueType = s.type; p.networkSynced = s.synced; p.saved = s.saved; p.defaultValue = s.def;
            }
            ep.parameters = list.ToArray();
            EditorUtility.SetDirty(ep);
            log.Add($"Expression Parameters: {specs.Count} KitsuNexus parameters ({specs.Count(s => s.synced)} synced, {specs.Count(s => !s.synced)} local-only).");
        }

        void ApplyMenu(string folder, List<string> log)
        {
            var menu = avatar.expressionsMenu;
            string safe = Safe(avatar.gameObject.name);
            if (menu == null || InPackages(menu))
            {
                menu = menu != null
                    ? CopyIntoFolder<VRCExpressionsMenu>(AssetDatabase.GetAssetPath(menu), folder, safe + "_Menu.asset")
                    : CreateMenuAsset(AssetDatabase.GenerateUniqueAssetPath($"{folder}/{safe}_Menu.asset"));
                Undo.RecordObject(avatar, "KitsuNexus tracking setup");
                avatar.customExpressions = true;
                avatar.expressionsMenu = menu;
                EditorUtility.SetDirty(avatar);
            }

            string subPath = Fresh($"{folder}/KN_TrackingMenu.asset");
            var sub = CreateMenuAsset(subPath);
            if (doHands) sub.controls.Add(ToggleControl("Hand Tracking", HandsOn));
            if (BodyActive) sub.controls.Add(ToggleControl("Body Tracking", BodyOn));
            EditorUtility.SetDirty(sub);

            Undo.RecordObject(menu, "KitsuNexus tracking setup");
            if (menu.controls == null) menu.controls = new List<VRCExpressionsMenu.Control>();
            menu.controls.RemoveAll(c => c != null && c.name == MenuName);
            if (menu.controls.Count >= VRCExpressionsMenu.MAX_CONTROLS)
                log.Add($"Your main Expression Menu is full ({VRCExpressionsMenu.MAX_CONTROLS} controls), so the toggles weren't linked. Add a Sub Menu control pointing to {subPath} in one of your menus.");
            else
            {
                menu.controls.Add(new VRCExpressionsMenu.Control
                {
                    name = MenuName,
                    type = VRCExpressionsMenu.Control.ControlType.SubMenu,
                    subMenu = sub,
                    parameter = new VRCExpressionsMenu.Control.Parameter { name = "" },
                    subParameters = new VRCExpressionsMenu.Control.Parameter[0],
                    labels = new VRCExpressionsMenu.Control.Label[0]
                });
                log.Add($"Expression Menu: added '{MenuName}' submenu with on/off toggles.");
            }
            EditorUtility.SetDirty(menu);
        }

        static VRCExpressionsMenu CreateMenuAsset(string path)
        {
            var m = CreateInstance<VRCExpressionsMenu>();
            m.controls = new List<VRCExpressionsMenu.Control>();
            AssetDatabase.CreateAsset(m, path);
            return m;
        }

        static VRCExpressionsMenu.Control ToggleControl(string name, string param)
        {
            return new VRCExpressionsMenu.Control
            {
                name = name,
                type = VRCExpressionsMenu.Control.ControlType.Toggle,
                parameter = new VRCExpressionsMenu.Control.Parameter { name = param },
                value = 1f,
                subParameters = new VRCExpressionsMenu.Control.Parameter[0],
                labels = new VRCExpressionsMenu.Control.Label[0]
            };
        }

        /* --------------------------------------------------------- remove */

        void RemoveFromAvatar(List<string> log)
        {
            var names = AllOurNames();
            foreach (var t in new[] { AnimLayerType.Gesture, AnimLayerType.Action })
            {
                var c = CustomControllerOrNull(t);
                if (c == null || InPackages(c)) continue;
                int removed = 0;
                if (t == AnimLayerType.Action) RemoveBodyPoseState(c);
                for (int i = c.layers.Length - 1; i >= 1; i--)
                    if (c.layers[i].name.StartsWith(Prefix)) { c.RemoveLayer(i); removed++; }
                int pRemoved = 0;
                foreach (var p in c.parameters.Where(p => names.Contains(p.name)).ToArray()) { c.RemoveParameter(p); pRemoved++; }
                if (removed + pRemoved > 0)
                {
                    EditorUtility.SetDirty(c);
                    log.Add($"Removed {removed} [KN] layers and {pRemoved} parameters from {t} controller '{c.name}'.");
                }
            }
            var ep = avatar.expressionParameters;
            if (ep != null && ep.parameters != null && !InPackages(ep))
            {
                int before = ep.parameters.Length;
                Undo.RecordObject(ep, "KitsuNexus tracking remove");
                ep.parameters = ep.parameters.Where(p => p == null || !names.Contains(p.name)).ToArray();
                if (ep.parameters.Length != before) { EditorUtility.SetDirty(ep); log.Add($"Removed {before - ep.parameters.Length} KitsuNexus expression parameters."); }
            }
            var menu = avatar.expressionsMenu;
            if (menu != null && menu.controls != null && !InPackages(menu))
            {
                Undo.RecordObject(menu, "KitsuNexus tracking remove");
                if (menu.controls.RemoveAll(c => c != null && c.name == MenuName) > 0) { EditorUtility.SetDirty(menu); log.Add("Removed the KitsuNexus Tracking menu entry."); }
            }
        }
    }
}
#endif
