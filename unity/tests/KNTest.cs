// End-to-end test for unity/KitsuNexusTracking (not shipped with the tool).
//
// Builds a procedural humanoid, runs Hand & Body Tracking Setup on it (twice, to cover
// the update path), checks the generated Gesture/Action layers, gates, masks, base-layer
// pose state, parameters and menu, then drives the generated trees through Unity's real
// Animator and measures every limb with the same maths as bodyTracking.js. Also checks
// the Live Preview (sliders + a real UDP OSC packet) and Remove.
//
// Run it in a throwaway copy of a VRChat Avatars SDK project (Unity 2022.3):
//   1. copy unity/KitsuNexusTracking to <project>/Packages/com.nekosuneprojects.kitsunexus.tracking
//   2. copy this file to <project>/Assets/Editor/KNTest.cs
//   3. KN_OUT=<project>/kn_result.txt Unity.exe -batchmode -nographics -projectPath <project> -executeMethod KNTest.Run -logFile unity.log
// Set KN_MODEL=Assets/.../Avatar.fbx (a Humanoid-imported model) to test a real avatar instead.
// kn_result.txt ends with "RESULT: PASS" (exit code 0) or lists the failed checks.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using VRC.SDK3.Avatars.Components;

// Batch-mode end-to-end test for the KitsuNexus tracking setup tool.
public static class KNTest
{
    static readonly StringBuilder sb = new StringBuilder();
    static int failures;
    static void L(string s) { sb.AppendLine(s); Debug.Log("[KNTEST] " + s); }

    public static void Run()
    {
        int code = 0;
        try { Main(); }
        catch (Exception e) { L("EXCEPTION " + e); code = 2; }
        L(failures == 0 && code == 0 ? "RESULT: PASS" : $"RESULT: FAIL ({failures} checks failed)");
        System.IO.File.WriteAllText(Environment.GetEnvironmentVariable("KN_OUT") ?? "kn_result.txt", sb.ToString());
        EditorApplication.Exit(code != 0 ? code : (failures > 0 ? 1 : 0));
    }

    static readonly Dictionary<HumanBodyBones, Transform> bones = new Dictionary<HumanBodyBones, Transform>();
    static Transform Mk(string n, Transform parent, Vector3 pos, HumanBodyBones? hb = null)
    {
        var go = new GameObject(n);
        go.transform.SetParent(parent, false);
        go.transform.position = pos;
        if (hb.HasValue) bones[hb.Value] = go.transform;
        return go.transform;
    }
    static HumanBodyBones B(string s) { return (HumanBodyBones)Enum.Parse(typeof(HumanBodyBones), s); }

    static GameObject BuildAvatar()
    {
        var root = new GameObject("KNTestAvatar").transform;
        var arm = Mk("Armature", root, Vector3.zero);
        var hips = Mk("Hips", arm, new Vector3(0, 1.0f, 0), HumanBodyBones.Hips);
        var spine = Mk("Spine", hips, new Vector3(0, 1.1f, 0), HumanBodyBones.Spine);
        var chest = Mk("Chest", spine, new Vector3(0, 1.25f, 0), HumanBodyBones.Chest);
        var neck = Mk("Neck", chest, new Vector3(0, 1.45f, 0), HumanBodyBones.Neck);
        Mk("Head", neck, new Vector3(0, 1.55f, 0), HumanBodyBones.Head);
        foreach (var side in new[] { "Left", "Right" })
        {
            float sx = side == "Left" ? -1 : 1;
            var ul = Mk(side + "UpperLeg", hips, new Vector3(sx * 0.1f, 0.95f, 0), B(side + "UpperLeg"));
            var ll = Mk(side + "LowerLeg", ul, new Vector3(sx * 0.1f, 0.5f, 0), B(side + "LowerLeg"));
            var ft = Mk(side + "Foot", ll, new Vector3(sx * 0.1f, 0.08f, 0), B(side + "Foot"));
            Mk(side + "Toes", ft, new Vector3(sx * 0.1f, 0.02f, 0.1f), B(side + "Toes"));
            var sh = Mk(side + "Shoulder", chest, new Vector3(sx * 0.05f, 1.4f, 0), B(side + "Shoulder"));
            var ua = Mk(side + "UpperArm", sh, new Vector3(sx * 0.18f, 1.4f, 0), B(side + "UpperArm"));
            var la = Mk(side + "LowerArm", ua, new Vector3(sx * 0.45f, 1.4f, 0), B(side + "LowerArm"));
            var hd = Mk(side + "Hand", la, new Vector3(sx * 0.70f, 1.4f, 0), B(side + "Hand"));
            var fz = new Dictionary<string, float> { { "Index", 0.03f }, { "Middle", 0.01f }, { "Ring", -0.01f }, { "Little", -0.03f } };
            foreach (var kv in fz)
            {
                var p = Mk(side + kv.Key + "Proximal", hd, new Vector3(sx * 0.78f, 1.4f, kv.Value), B(side + kv.Key + "Proximal"));
                var i = Mk(side + kv.Key + "Intermediate", p, new Vector3(sx * 0.82f, 1.4f, kv.Value), B(side + kv.Key + "Intermediate"));
                var d = Mk(side + kv.Key + "Distal", i, new Vector3(sx * 0.85f, 1.4f, kv.Value), B(side + kv.Key + "Distal"));
                Mk(side + kv.Key + "Tip", d, new Vector3(sx * 0.87f, 1.4f, kv.Value));
            }
            var tp = Mk(side + "ThumbProximal", hd, new Vector3(sx * 0.72f, 1.385f, 0.04f), B(side + "ThumbProximal"));
            var ti = Mk(side + "ThumbIntermediate", tp, new Vector3(sx * 0.75f, 1.38f, 0.06f), B(side + "ThumbIntermediate"));
            var td = Mk(side + "ThumbDistal", ti, new Vector3(sx * 0.77f, 1.375f, 0.08f), B(side + "ThumbDistal"));
            Mk(side + "ThumbTip", td, new Vector3(sx * 0.785f, 1.372f, 0.095f));
        }
        var hdsc = new HumanDescription
        {
            human = bones.Select(kv => new HumanBone { boneName = kv.Value.name, humanName = HumanTrait.BoneName[(int)kv.Key], limit = new HumanLimit { useDefaultValues = true } }).ToArray(),
            skeleton = root.GetComponentsInChildren<Transform>().Select(t => new SkeletonBone { name = t.name, position = t.localPosition, rotation = t.localRotation, scale = t.localScale }).ToArray(),
            upperArmTwist = 0.5f, lowerArmTwist = 0.5f, upperLegTwist = 0.5f, lowerLegTwist = 0.5f,
            armStretch = 0.05f, legStretch = 0.05f, feetSpacing = 0f, hasTranslationDoF = false
        };
        var av = AvatarBuilder.BuildHumanAvatar(root.gameObject, hdsc);
        if (!av.isValid || !av.isHuman) throw new Exception("test avatar invalid");
        av.name = "KNTestAvatar";
        AssetDatabase.CreateAsset(av, "Assets/KNTestAvatar.asset");
        var anim = root.gameObject.AddComponent<Animator>();
        anim.avatar = av;
        root.gameObject.AddComponent<VRCAvatarDescriptor>();
        return root.gameObject;
    }

    // KN_MODEL=Assets/.../Model.fbx: test a real humanoid model instead of the procedural one.
    static GameObject LoadModel()
    {
        string path = Environment.GetEnvironmentVariable("KN_MODEL");
        if (string.IsNullOrEmpty(path)) return null;
        var asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (asset == null) throw new Exception("KN_MODEL not found: " + path);
        var go = (GameObject)PrefabUtility.InstantiatePrefab(asset);
        PrefabUtility.UnpackPrefabInstance(go, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
        go.name = asset.name;
        var a = go.GetComponent<Animator>() ?? go.AddComponent<Animator>();
        if (a.avatar == null || !a.avatar.isHuman) throw new Exception(path + " is not imported as a Humanoid");
        go.AddComponent<VRCAvatarDescriptor>();
        return go;
    }

    static void Check(bool ok, string what) { if (!ok) failures++; L((ok ? "  ok   " : "  FAIL ") + what); }

    static void Main()
    {
        // fresh state
        if (AssetDatabase.IsValidFolder("Assets/KitsuNexus")) AssetDatabase.DeleteAsset("Assets/KitsuNexus");
        var go = LoadModel() ?? BuildAvatar();
        var desc = go.GetComponent<VRCAvatarDescriptor>();
        var anim = go.GetComponent<Animator>();
        float restHipsY = go.transform.InverseTransformPoint(anim.GetBoneTransform(HumanBodyBones.Hips).position).y;
        L($"avatar: {go.name}  (rest hips height {restHipsY:0.000} in avatar space)");

        var asm = AppDomain.CurrentDomain.GetAssemblies().First(a => a.GetName().Name == "KitsuNexus.TrackingSetup.Editor");
        var tSetup = asm.GetType("KitsuNexus.TrackingSetup.KitsuNexusTrackingSetup");
        var w = ScriptableObject.CreateInstance(tSetup);
        const BindingFlags F = BindingFlags.NonPublic | BindingFlags.Instance;
        tSetup.GetMethod("SetAvatar", F).Invoke(w, new object[] { desc });
        var log = (List<string>)tSetup.GetMethod("Setup", F).Invoke(w, null);
        L("--- setup log ---"); foreach (var s in log) L("  " + s);

        // second run = update path (remove + rebuild) must also work
        log = (List<string>)tSetup.GetMethod("Setup", F).Invoke(w, null);
        L("--- second run ok, " + log.Count + " log lines ---");

        L("--- structure ---");
        string folder0 = $"Assets/KitsuNexus/Tracking/{go.name}";
        AnimatorController Ctrl(VRCAvatarDescriptor.AnimLayerType t) => desc.baseAnimationLayers.First(l => l.type == t).animatorController as AnimatorController;
        var g = Ctrl(VRCAvatarDescriptor.AnimLayerType.Gesture);
        var a = Ctrl(VRCAvatarDescriptor.AnimLayerType.Action);
        Check(desc.customizeAnimationLayers, "playable layers customized");
        Check(g != null && g.layers.Count(l => l.name.StartsWith("[KN] ")) == 4, "Gesture has 4 [KN] layers: " + (g == null ? "-" : string.Join(", ", g.layers.Select(l => l.name))));
        Check(a != null && a.layers.Any(l => l.name == "[KN] Body") && a.layers.Any(l => l.name == "[KN] Body Gate") && a.layers.Any(l => l.name == "[KN] Left Hand (Action)"), "Action has [KN] Body + gate + hands fallback (default on): " + (a == null ? "-" : string.Join(", ", a.layers.Select(l => l.name))));
        var ep = desc.expressionParameters;
        Check(ep != null && ep.parameters.Any(p => p.name == "HT/LeftIndexCurl") && ep.parameters.Any(p => p.name == "BT/Crouch"), "expression params added (" + (ep == null ? 0 : ep.parameters.Length) + ")");
        Check(ep.parameters.Count(p => p.name == "HT/LeftIndexCurl") == 1, "no duplicate params after re-run");
        Check(desc.expressionsMenu != null && desc.expressionsMenu.controls.Count(c => c.name == "KitsuNexus Tracking") == 1, "menu submenu added once");
        int gi = Array.FindIndex(g.layers, l => l.name == "[KN] Left Hand");
        var gate = g.layers.First(l => l.name == "[KN] Left Hand Gate").stateMachine.states.First(s => s.state.name == "On").state;
        var lc = gate.behaviours.OfType<VRCAnimatorLayerControl>().FirstOrDefault();
        Check(lc != null && lc.layer == gi && lc.goalWeight == 1f, $"left hand gate controls layer {gi}");
        var bgate = a.layers.First(l => l.name == "[KN] Body Gate").stateMachine.states.First(s => s.state.name == "On").state;
        Check(bgate.behaviours.OfType<VRCPlayableLayerControl>().Any(b => b.goalWeight == 1f), "body gate raises Action playable");
        Check(a.layers[0].avatarMask != null && a.layers[0].avatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.Root) && a.layers[0].avatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.Head), "Action first-layer mask: Root + tracked parts (incl. head)");
        Check(!AssetDatabase.LoadAssetAtPath<AvatarMask>(folder0 + "/KN_Body.mask").GetHumanoidBodyPartActive(AvatarMaskBodyPart.Root), "[KN] Body mask excludes Root (keeps lean/crouch)");
        var a0 = a.layers[0].stateMachine;
        var poseState = a0.states.Select(x => x.state).FirstOrDefault(x => x.name == "[KN] Body Pose");
        Check(poseState != null && a0.states.Count(x => x.state.name == "[KN] Body Pose") == 1, "Action base layer has one [KN] Body Pose state (after re-run)");
        Check(poseState != null && a0.defaultState.transitions.Any(t => t.destinationState == poseState && t.conditions.Any(c => c.parameter == "VRCEmote")), "pose state entered from idle only when no emote (" + a0.defaultState.name + ")");
        Check(poseState != null && poseState.transitions.Any(t => t.conditions.Any(c => c.parameter == "AFK" && c.mode == AnimatorConditionMode.If)), "pose state hands back to VRChat on AFK");
        Check(poseState != null && poseState.behaviours.OfType<VRCPlayableLayerControl>().Any(b => b.goalWeight == 1f) && poseState.behaviours.OfType<VRCAnimatorTrackingControl>().Any(b => b.trackingHip == VRC.SDKBase.VRC_AnimatorTrackingControl.TrackingType.Animation), "pose state re-raises Action + tracking control after emotes");

        // ---- drive the generated trees through Unity's real Animator ----
        string folder = $"Assets/KitsuNexus/Tracking/{go.name}";
        var bodyTree = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_Body.asset");
        var handTree = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_LeftHand.asset");
        Check(bodyTree != null && handTree != null, "generated trees exist");

        var root = go.transform;
        Vector3 P(HumanBodyBones b) => root.InverseTransformPoint(anim.GetBoneTransform(b).position);
        float Rad = Mathf.PI;

        var ctrl = AnimatorController.CreateAnimatorControllerAtPath("Assets/KNTmp.controller");
        foreach (var p in a.parameters) ctrl.AddParameter(new AnimatorControllerParameter { name = p.name, type = p.type, defaultFloat = p.defaultFloat, defaultBool = p.defaultBool });
        foreach (var p in g.parameters) if (!ctrl.parameters.Any(x => x.name == p.name)) ctrl.AddParameter(new AnimatorControllerParameter { name = p.name, type = p.type, defaultFloat = p.defaultFloat, defaultBool = p.defaultBool });
        var poseTree = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_BodyPose.asset");
        Check(poseTree != null, "body pose tree exists");
        var sm = ctrl.layers[0].stateMachine;
        var st = sm.AddState("Pose"); st.motion = poseTree; st.writeDefaultValues = false; sm.defaultState = st;
        var smB = new AnimatorStateMachine { name = "Body" }; AssetDatabase.AddObjectToAsset(smB, ctrl);
        ctrl.AddLayer(new AnimatorControllerLayer { name = "Body", stateMachine = smB, defaultWeight = 1f, avatarMask = AssetDatabase.LoadAssetAtPath<AvatarMask>(folder + "/KN_Body.mask") });
        var stB = smB.AddState("Body"); stB.motion = bodyTree; stB.writeDefaultValues = true; smB.defaultState = stB;
        var sm2 = new AnimatorStateMachine { name = "Hand" }; AssetDatabase.AddObjectToAsset(sm2, ctrl);
        var m = new AvatarMask(); for (var bp = AvatarMaskBodyPart.Root; bp < AvatarMaskBodyPart.LastBodyPart; bp++) m.SetHumanoidBodyPartActive(bp, bp == AvatarMaskBodyPart.LeftFingers);
        AssetDatabase.CreateAsset(m, "Assets/KNTmp.mask");
        ctrl.AddLayer(new AnimatorControllerLayer { name = "Hand", stateMachine = sm2, defaultWeight = 1f, avatarMask = m });
        var st2 = sm2.AddState("Hand"); st2.motion = handTree; st2.writeDefaultValues = true; sm2.defaultState = st2;
        anim.runtimeAnimatorController = ctrl;
        // Imported models default to culling: with no camera in batch mode they'd never animate.
        anim.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        anim.Rebind();

        string[] floats = ctrl.parameters.Where(p => p.type == AnimatorControllerParameterType.Float && p.name != "KN/One").Select(p => p.name).ToArray();
        void Pose(Dictionary<string, float> vals)
        {
            foreach (var f in floats) anim.SetFloat(f, vals.TryGetValue(f, out var v) ? v : (f.EndsWith("UpperArmZ") ? 0.1f : 0f));
            anim.Update(0.05f); anim.Update(0.05f);
        }

        L("--- body: requested parameter vs what the avatar's limb measures (same maths as bodyTracking.js) ---");
        void Case(string param, float v, Func<float> measure, float tol, Dictionary<string, float> extra = null)
        {
            var vals = new Dictionary<string, float>(extra ?? new Dictionary<string, float>()) { [param] = v };
            Pose(vals);
            float got = measure();
            Check(Mathf.Abs(got - v) <= tol, $"{param} = {v,5:0.00}  ->  measured {got,6:0.000}  (tol {tol})");
        }
        void Info(string param, float v, Func<float> measure)
        {
            Pose(new Dictionary<string, float> { [param] = v });
            L($"  info {param} = {v:0.00} -> {measure():0.000} (joint limit of this rig)");
        }
        foreach (var side in new[] { "Left", "Right" })
        {
            float o = side == "Right" ? 1 : -1;
            var ul = B(side + "UpperLeg"); var ll = B(side + "LowerLeg"); var ft = B(side + "Foot");
            var ua = B(side + "UpperArm"); var la = B(side + "LowerArm"); var hd = B(side + "Hand");
            Func<float> legX = () => { var d = P(ll) - P(ul); return Mathf.Atan2(d.z, -d.y) / (Rad / 2); };
            Func<float> legZ = () => { var d = P(ll) - P(ul); return Mathf.Atan2(d.x * o, -d.y) / (Rad / 2); };
            Func<float> knee = () => Vector3.Angle(P(ll) - P(ul), P(ft) - P(ll)) / 150f;
            Func<float> armX = () => { var d = P(la) - P(ua); return Mathf.Atan2(d.z, Mathf.Sqrt(d.y * d.y + d.x * d.x)) / (Rad / 2); };
            Func<float> armZ = () => { var d = P(la) - P(ua); return Mathf.Atan2(d.x * o, -d.y) / Rad; };
            Func<float> elbow = () => Vector3.Angle(P(la) - P(ua), P(hd) - P(la)) / 150f;
            foreach (var v in new[] { -0.1f, 0f, 0.3f, 0.6f, 1f }) Case($"BT/{side}UpperLegX", v, legX, 0.04f);
            Info($"BT/{side}UpperLegX", -0.3f, legX);
            foreach (var v in new[] { 0f, 0.2f, 0.4f }) Case($"BT/{side}UpperLegZ", v, legZ, 0.06f);
            foreach (var v in new[] { 0f, 0.3f, 0.6f }) Case($"BT/{side}Knee", v, knee, 0.06f);
            foreach (var v in new[] { 0.1f, 0.3f, 0.5f, 0.75f }) Case($"BT/{side}UpperArmZ", v, armZ, 0.04f);
            Info($"BT/{side}UpperArmZ", 0.95f, armZ);
            foreach (var b in new[] { -0.25f, 0.5f }) foreach (var v in new[] { 0f, 0.5f }) Case($"BT/{side}UpperLegX", v, legX, 0.06f, new Dictionary<string, float> { ["BT/SpineBend"] = b });
            foreach (var sd in new[] { -0.5f, 0.5f }) foreach (var v in new[] { 0f, 0.3f }) Case($"BT/{side}UpperLegZ", v, legZ, 0.06f, new Dictionary<string, float> { ["BT/SpineSide"] = sd });
            foreach (var v in new[] { -0.3f, 0f, 0.4f, 0.7f }) Case($"BT/{side}UpperArmX", v, armX, 0.08f, new Dictionary<string, float> { [$"BT/{side}UpperArmZ"] = 0.5f });
            foreach (var v in new[] { 0f, 0.3f, 0.6f }) Case($"BT/{side}Elbow", v, elbow, 0.06f, new Dictionary<string, float> { [$"BT/{side}UpperArmZ"] = 0.5f });
            Func<float> twist = () =>
            {
                var up = (P(la) - P(ua)).normalized; var fore = P(hd) - P(la);
                var f0 = Vector3.forward - up * Vector3.Dot(Vector3.forward, up); if (f0.magnitude < 0.3f) return 0f; f0.Normalize();
                var upRef = Vector3.Cross(up, f0) * -o; var fp = fore - up * Vector3.Dot(fore, up);
                return Mathf.Atan2(Vector3.Dot(fp, upRef), Vector3.Dot(fp, f0)) / (Rad / 2);
            };
            foreach (var v in new[] { -0.5f, 0f, 0.5f, 0.9f }) Case($"BT/{side}UpperArmTwist", v, twist, 0.1f, new Dictionary<string, float> { [$"BT/{side}UpperArmZ"] = 0.5f, [$"BT/{side}Elbow"] = 0.6f });
        }
        Func<Vector3> up = () => ((P(HumanBodyBones.LeftUpperArm) + P(HumanBodyBones.RightUpperArm)) - (P(HumanBodyBones.LeftUpperLeg) + P(HumanBodyBones.RightUpperLeg))).normalized;
        foreach (var v in new[] { -0.5f, 0.25f, 0.5f, 0.8f }) Case("BT/SpineBend", v, () => { var u = up(); return Mathf.Atan2(u.z, u.y) / (Rad / 3); }, 0.08f);
        foreach (var v in new[] { -0.5f, 0.5f }) Case("BT/SpineSide", v, () => { var u = up(); return Mathf.Atan2(u.x, u.y) / (Rad / 4); }, 0.08f);
        foreach (var v in new[] { -0.5f, 0.25f, 0.5f }) Case("BT/SpineTwist", v, () => { var r = P(HumanBodyBones.RightUpperArm) - P(HumanBodyBones.LeftUpperArm); var hl = P(HumanBodyBones.RightUpperLeg) - P(HumanBodyBones.LeftUpperLeg); var rt = new Vector3(hl.x, 0, hl.z).normalized; var fw = Vector3.Cross(rt, Vector3.up); return Mathf.Atan2(Vector3.Dot(r, fw), Vector3.Dot(r, rt)) / (Rad / 3); }, 0.08f);

        Pose(new Dictionary<string, float>());
        float hip0 = P(HumanBodyBones.Hips).y, foot0 = P(HumanBodyBones.LeftFoot).y;
        Pose(new Dictionary<string, float> { ["BT/Crouch"] = 1f, ["BT/LeftKnee"] = 0.6f, ["BT/RightKnee"] = 0.6f, ["BT/LeftUpperLegX"] = 0.5f, ["BT/RightUpperLegX"] = 0.5f });
        float hip1 = P(HumanBodyBones.Hips).y;
        L($"  info standing hips y {hip0:0.000} (foot {foot0:0.000}), crouch=1 hips y {hip1:0.000}  ratio {hip1 / Mathf.Max(hip0, 1e-4f):0.00} (target 0.40)");
        Check(Mathf.Abs(hip0 - restHipsY) < restHipsY * 0.06f, $"standing hips stay at the avatar's own hip height ({hip0:0.000} vs rest {restHipsY:0.000})");
        Check(hip1 < hip0 * 0.6f, "crouch lowers the hips");
        Pose(new Dictionary<string, float> { ["BT/SpineBend"] = 0.5f, ["BT/SpineSide"] = -0.5f });
        { var u = up(); float gb = Mathf.Atan2(u.z, u.y) / (Rad / 3), gs = Mathf.Atan2(u.x, u.y) / (Rad / 4); Check(Mathf.Abs(gb - 0.5f) < 0.1f && Mathf.Abs(gs + 0.5f) < 0.1f, $"combined lean 0.5 / side -0.5 -> {gb:0.000} / {gs:0.000}"); }

        L("--- lying down ---");
        Vector3 rightLine() => P(HumanBodyBones.RightUpperArm) - P(HumanBodyBones.LeftUpperArm);
        float Lowest() => new[] { HumanBodyBones.Hips, HumanBodyBones.Head, HumanBodyBones.Chest, HumanBodyBones.LeftFoot, HumanBodyBones.RightFoot, HumanBodyBones.LeftHand, HumanBodyBones.RightHand, HumanBodyBones.LeftLowerLeg, HumanBodyBones.RightLowerLeg }.Min(b => P(b).y);
        Pose(new Dictionary<string, float> { ["BT/LeftUpperArmZ"] = 0f, ["BT/RightUpperArmZ"] = 0f, ["BT/Lying"] = 1f, ["BT/LiePitch"] = -1f });
        { var u = up(); var fwd = Vector3.Cross(rightLine().normalized, u); Check(Mathf.Abs(u.y) < 0.3f && fwd.y > 0.7f, $"on the back: torso level ({u.y:0.00}), chest faces up ({fwd.y:0.00})"); }
        { float lo = Lowest(); Check(lo > -0.02f * restHipsY && lo < 0.2f * restHipsY, $"lying on the floor: lowest bone at {lo:0.000} (hips standing {restHipsY:0.000})"); }
        Pose(new Dictionary<string, float> { ["BT/LeftUpperArmZ"] = 0f, ["BT/RightUpperArmZ"] = 0f, ["BT/Lying"] = 1f, ["BT/LieRoll"] = -0.5f });
        { var u = up(); var r = rightLine().normalized; Check(u.x > 0.7f && r.y < -0.7f, $"on the right side: head to +X ({u.x:0.00}), right shoulder down ({r.y:0.00})"); }
        { float lo = Lowest(); Check(lo > -0.02f * restHipsY && lo < 0.2f * restHipsY, $"lying on a side, on the floor: lowest bone at {lo:0.000}"); }
        Pose(new Dictionary<string, float> { ["BT/LeftUpperArmZ"] = 0f, ["BT/RightUpperArmZ"] = 0f, ["BT/Lying"] = 1f, ["BT/LiePitch"] = 1f });
        { var u = up(); var fwd = Vector3.Cross(rightLine().normalized, u); Check(fwd.y < -0.7f, $"face down: chest faces the floor ({fwd.y:0.00})"); }

        L("--- head (face tracking yaw / pitch / roll) ---");
        Pose(new Dictionary<string, float>());
        var head0 = Quaternion.Inverse(root.rotation) * anim.GetBoneTransform(HumanBodyBones.Head).rotation;
        Quaternion headDelta() => (Quaternion.Inverse(root.rotation) * anim.GetBoneTransform(HumanBodyBones.Head).rotation) * Quaternion.Inverse(head0);
        foreach (var v in new[] { -0.5f, 0.3f, 0.6f }) Case("KN/v2/Head/Yaw", v, () => { var f = headDelta() * Vector3.forward; return Mathf.Atan2(f.x, f.z) / (Rad / 2); }, 0.08f);
        foreach (var v in new[] { -0.3f, 0.3f }) Case("KN/v2/Head/Pitch", v, () => { var f = headDelta() * Vector3.forward; return Mathf.Asin(Mathf.Clamp(-f.y, -1, 1)) / (Rad / 2); }, 0.08f);
        foreach (var v in new[] { -0.3f, 0.3f }) Case("KN/v2/Head/Roll", v, () => { var u2 = headDelta() * Vector3.up; return Mathf.Atan2(-u2.x, u2.y) / (Rad / 2); }, 0.08f);

        L("--- hands ---");
        float IndexBend() => Vector3.Angle(P(HumanBodyBones.LeftIndexProximal) - P(HumanBodyBones.LeftHand), P(HumanBodyBones.LeftIndexIntermediate) - P(HumanBodyBones.LeftIndexProximal))
                           + Vector3.Angle(P(HumanBodyBones.LeftIndexIntermediate) - P(HumanBodyBones.LeftIndexProximal), P(HumanBodyBones.LeftIndexDistal) - P(HumanBodyBones.LeftIndexIntermediate));
        float SpreadAngle() => Vector3.Angle(P(HumanBodyBones.LeftIndexIntermediate) - P(HumanBodyBones.LeftIndexProximal), P(HumanBodyBones.LeftMiddleIntermediate) - P(HumanBodyBones.LeftMiddleProximal))
                             + Vector3.Angle(P(HumanBodyBones.LeftLittleIntermediate) - P(HumanBodyBones.LeftLittleProximal), P(HumanBodyBones.LeftMiddleIntermediate) - P(HumanBodyBones.LeftMiddleProximal));
        Pose(new Dictionary<string, float> { ["HT/LeftIndexCurl"] = 0f }); float b0 = IndexBend();
        Pose(new Dictionary<string, float> { ["HT/LeftIndexCurl"] = 0.5f }); float b5 = IndexBend();
        Pose(new Dictionary<string, float> { ["HT/LeftIndexCurl"] = 1f }); float b1 = IndexBend();
        L($"  info index bend: curl 0 = {b0:0}°, 0.5 = {b5:0}°, 1 = {b1:0}°");
        Check(b1 > b5 + 10 && b5 > b0 + 10, "index curls more as HT/LeftIndexCurl rises");
        Pose(new Dictionary<string, float> { ["HT/LeftSpread"] = 0f }); float s0 = SpreadAngle();
        Pose(new Dictionary<string, float> { ["HT/LeftSpread"] = 1f }); float s1 = SpreadAngle();
        L($"  info index+little angle from middle: spread 0 = {s0:0.0}°, 1 = {s1:0.0}°");
        Check(s1 > s0 + 5, "fingers spread apart as HT/LeftSpread rises");

        // ---- Live Preview window evaluates the same trees ----
        L("--- live preview (sliders) matches the Animator ---");
        anim.runtimeAnimatorController = null;
        var tPrev = asm.GetType("KitsuNexus.TrackingSetup.KitsuNexusTrackingPreview");
        var pw = ScriptableObject.CreateInstance(tPrev);
        tPrev.GetField("avatar", F).SetValue(pw, desc);
        tPrev.GetField("source", F).SetValue(pw, Enum.ToObject(tPrev.GetNestedType("Source", BindingFlags.NonPublic), 1));
        var sliders = (Dictionary<string, float>)tPrev.GetField("sliders", F).GetValue(pw);
        Vector3 restKnee = P(HumanBodyBones.LeftLowerLeg);
        tPrev.GetMethod("StartPreview", F).Invoke(pw, null);
        var perr = (string)tPrev.GetField("previewError", F).GetValue(pw);
        Check(string.IsNullOrEmpty(perr), "preview starts " + perr);
        sliders["BT/Detected"] = 1f; sliders["BT/LeftUpperLegX"] = 0.5f;
        tPrev.GetMethod("ApplyPose", F).Invoke(pw, null);
        { var d = P(HumanBodyBones.LeftLowerLeg) - P(HumanBodyBones.LeftUpperLeg); float got = Mathf.Atan2(d.z, -d.y) / (Rad / 2); Check(Mathf.Abs(got - 0.5f) < 0.06f, $"preview BT/LeftUpperLegX 0.5 -> {got:0.000}"); }
        sliders["HT/LeftDetected"] = 1f; sliders["HT/LeftIndexCurl"] = 1f;
        tPrev.GetMethod("ApplyPose", F).Invoke(pw, null);
        Check(Mathf.Abs(IndexBend() - b1) < 8f, $"preview index curl 1 -> {IndexBend():0}° (animator {b1:0}°)");
        sliders["BT/LeftUpperLegX"] = 0f; sliders["BT/SpineBend"] = 0.5f; sliders["BT/SpineSide"] = 0.25f;
        tPrev.GetMethod("ApplyPose", F).Invoke(pw, null);
        { var u = up(); float gb = Mathf.Atan2(u.z, u.y) / (Rad / 3), gs = Mathf.Atan2(u.x, u.y) / (Rad / 4); Check(Mathf.Abs(gb - 0.5f) < 0.08f && Mathf.Abs(gs - 0.25f) < 0.08f, $"preview lean 0.5 / side 0.25 -> {gb:0.000} / {gs:0.000}"); }
        tPrev.GetMethod("StopPreview", F).Invoke(pw, null);
        Check((P(HumanBodyBones.LeftLowerLeg) - restKnee).magnitude < 1e-4f, "preview Stop restores the scene pose exactly");

        // OSC listener round trip on a real socket
        L("--- live preview OSC socket ---");
        tPrev.GetField("port", F).SetValue(pw, 9137);
        tPrev.GetMethod("StartListening", F).Invoke(pw, null);
        var lerr = (string)tPrev.GetField("listenError", F).GetValue(pw);
        Check(string.IsNullOrEmpty(lerr), "listening on 9137 " + lerr);
        var msg = OscMsg("/avatar/parameters/BT/LeftKnee", 0.42f);
        using (var u = new System.Net.Sockets.UdpClient()) u.Send(msg, msg.Length, "127.0.0.1", 9137);
        var live = (System.Collections.Concurrent.ConcurrentDictionary<string, float>)tPrev.GetField("live", F).GetValue(pw);
        float got2 = float.NaN;
        for (int i = 0; i < 100 && !live.TryGetValue("BT/LeftKnee", out got2); i++) System.Threading.Thread.Sleep(20);
        Check(Mathf.Abs(got2 - 0.42f) < 1e-5f, $"received BT/LeftKnee over UDP = {got2}");
        tPrev.GetMethod("StopListening", F).Invoke(pw, null);

        // hands fallback option: hand layers also in the Action controller
        L("--- hands fallback (Action layer) ---");
        tSetup.GetField("handsInAction", F).SetValue(w, true);
        tSetup.GetMethod("Setup", F).Invoke(w, null);
        a = Ctrl(VRCAvatarDescriptor.AnimLayerType.Action); g = Ctrl(VRCAvatarDescriptor.AnimLayerType.Gesture);
        int ai = Array.FindIndex(a.layers, l => l.name == "[KN] Left Hand (Action)");
        Check(ai > 0 && a.layers.Any(l => l.name == "[KN] Right Hand Gate (Action)"), "Action has the fallback hand layers: " + string.Join(", ", a.layers.Select(l => l.name)));
        var agate = a.layers.First(l => l.name == "[KN] Left Hand Gate (Action)").stateMachine.states.First(x => x.state.name == "On").state.behaviours.OfType<VRCAnimatorLayerControl>().First();
        Check(agate.playable == VRC.SDKBase.VRC_AnimatorLayerControl.BlendableLayer.Action && agate.layer == ai, "fallback gate controls its Action layer");
        Check(a.layers[0].avatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.LeftFingers), "Action mask now lets the fallback fingers through");
        Check(g.layers.Count(l => l.name.StartsWith("[KN] ")) == 4, "Gesture layers unchanged");

        // remove
        var rl = new List<string>();
        tSetup.GetMethod("RemoveFromAvatar", F).Invoke(w, new object[] { rl });
        Check(!g.layers.Any(l => l.name.StartsWith("[KN] ")) && !a.layers.Any(l => l.name.StartsWith("[KN] ")), "Remove takes the [KN] layers out");
        Check(!desc.expressionParameters.parameters.Any(p => p.name.StartsWith("HT/") || p.name.StartsWith("BT/")), "Remove takes the parameters out");
        Check(!a.layers[0].stateMachine.states.Any(x => x.state.name.StartsWith("[KN] ")) && !a.layers[0].stateMachine.states.SelectMany(x => x.state.transitions).Any(t => t.destinationState == null && !t.isExit), "Remove takes the pose state + its transitions out");
        Check(a.layers[0].avatarMask == null, "Remove restores the Action first-layer mask");
    }

    static byte[] OscMsg(string addr, float v)
    {
        var l = new List<byte>();
        void Str(string s) { var b = Encoding.ASCII.GetBytes(s); l.AddRange(b); int pad = 4 - (b.Length % 4); for (int i = 0; i < pad; i++) l.Add(0); }
        Str(addr); Str(",f");
        var fb = BitConverter.GetBytes(v); if (BitConverter.IsLittleEndian) Array.Reverse(fb); l.AddRange(fb);
        return l.ToArray();
    }
}
