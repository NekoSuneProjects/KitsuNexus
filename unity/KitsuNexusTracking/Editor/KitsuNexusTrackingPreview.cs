// KitsuNexus — Tracking Live Preview (Unity Editor only).
//
// Poses the avatar in the Scene view from the layers that "Hand & Body Tracking Setup"
// generated, so you can check fingers, arms, legs, lean and crouch without uploading:
//
//   * Live OSC: KitsuNexus sends its tracking here as well as to VRChat. In KitsuNexus,
//     add 127.0.0.1:9100 to OSC > "Extra OSC send targets". If VRChat isn't running
//     with this avatar, also tick "Send every parameter (testing)" in Face, Hands & Body.
//   * Sliders: move every HT/ and BT/ value by hand.
//
// It evaluates the generated blend trees directly, then poses the rig with
// HumanPoseHandler. Edit mode only. The scene pose is put back exactly when you
// press Stop, close the window, enter Play mode or scripts reload. Nothing is saved.
//
// Tools > KitsuNexus > Tracking Live Preview

#if UNITY_EDITOR && (VRC_SDK_VRCSDK3 || KN_VRC_AVATARS)
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using VRC.SDK3.Avatars.Components;

namespace KitsuNexus.TrackingSetup
{
    public class KitsuNexusTrackingPreview : EditorWindow
    {
        const string AddrPrefix = "/avatar/parameters/";
        const string One = "KN/One", HandsOn = "KN/HandsOn", BodyOn = "KN/BodyOn";

        enum Source { LiveOsc, Sliders }

        VRCAvatarDescriptor avatar;
        Source source = Source.LiveOsc;
        int port = 9100;
        Vector2 scroll;
        bool foldHands = true, foldBody = true;

        // live OSC
        readonly ConcurrentDictionary<string, float> live = new ConcurrentDictionary<string, float>();
        UdpClient udp;
        Thread thread;
        volatile bool listening;
        long packets;
        long lastPacketTicks;
        string listenError;

        // sliders
        readonly Dictionary<string, float> sliders = new Dictionary<string, float>();

        // posing
        bool previewing;
        Animator anim;
        HumanPoseHandler handler;
        HumanPose rest;
        List<(Transform t, Vector3 p, Quaternion r, Vector3 s)> saved;
        BlendTree handL, handR, body, bodyPose;
        Dictionary<string, int> muscleByProp;
        readonly Dictionary<AnimationClip, (string, float)[]> clipCache = new Dictionary<AnimationClip, (string, float)[]>();
        string previewError;
        double nextApply, nextRepaint;

        [MenuItem("Tools/KitsuNexus/Tracking Live Preview")]
        public static void Open() { GetWindow<KitsuNexusTrackingPreview>("KN Live Preview"); }

        public static void OpenFor(VRCAvatarDescriptor d)
        {
            var w = GetWindow<KitsuNexusTrackingPreview>("KN Live Preview");
            if (w.avatar != d) { w.StopPreview(); w.avatar = d; }
        }

        void OnEnable()
        {
            EditorApplication.update += Tick;
            AssemblyReloadEvents.beforeAssemblyReload += StopAll;
            EditorApplication.playModeStateChanged += OnPlayMode;
            if (avatar == null && Selection.activeGameObject != null)
                avatar = Selection.activeGameObject.GetComponentInParent<VRCAvatarDescriptor>();
            ResetSliders();
        }

        void OnDisable()
        {
            EditorApplication.update -= Tick;
            AssemblyReloadEvents.beforeAssemblyReload -= StopAll;
            EditorApplication.playModeStateChanged -= OnPlayMode;
            StopAll();
        }

        void OnPlayMode(PlayModeStateChange _) { StopPreview(); }

        void StopAll()
        {
            StopPreview();
            StopListening();
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
            EditorGUILayout.LabelField("KitsuNexus — Tracking Live Preview", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Poses your avatar in the Scene view from the generated [KN] tracking layers, using live KitsuNexus OSC or sliders. " +
                                    "Edit mode only. The pose is put back when you stop.", MessageType.Info);

            using (new EditorGUI.DisabledScope(previewing))
                avatar = (VRCAvatarDescriptor)EditorGUILayout.ObjectField("Avatar", avatar, typeof(VRCAvatarDescriptor), true);

            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorGUILayout.HelpBox("Leave Play mode to use the preview (in Play mode use Gesture Manager / Av3Emulator).", MessageType.Warning);
                return;
            }

            EditorGUILayout.Space();
            source = (Source)GUILayout.Toolbar((int)source, new[] { "Live from KitsuNexus (OSC)", "Sliders" });
            EditorGUILayout.Space();

            if (source == Source.LiveOsc) DrawLive(); else DrawSliders();

            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(avatar == null))
                {
                    if (!previewing && GUILayout.Button("▶ Start preview", GUILayout.Height(28))) StartPreview();
                    if (previewing && GUILayout.Button("■ Stop preview (restore pose)", GUILayout.Height(28))) StopPreview();
                }
            }
            if (!string.IsNullOrEmpty(previewError)) EditorGUILayout.HelpBox(previewError, MessageType.Error);
            if (previewing)
            {
                var parts = new List<string>();
                if (handL != null || handR != null) parts.Add("hands");
                if (body != null) parts.Add("body");
                EditorGUILayout.HelpBox("Previewing " + string.Join(" + ", parts) + ". Hands show while HT/<Side>Detected is on, body while BT/Detected is on.", MessageType.None);
            }
        }

        void DrawLive()
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(listening))
                    port = EditorGUILayout.IntField("Listen on port", port);
                if (!listening && GUILayout.Button("Listen", GUILayout.Width(90))) StartListening();
                if (listening && GUILayout.Button("Stop", GUILayout.Width(90))) StopListening();
            }
            if (!string.IsNullOrEmpty(listenError)) EditorGUILayout.HelpBox(listenError, MessageType.Error);

            EditorGUILayout.HelpBox(
                $"In KitsuNexus: OSC settings > Extra OSC send targets > add  127.0.0.1:{port}\n" +
                "Then start tracking in Face, Hands & Body. If VRChat isn't running on this avatar, also tick \"Send every parameter (testing)\" " +
                "(KitsuNexus normally only sends parameters the current VRChat avatar has).\n" +
                "Don't use 9000 here — that's VRChat's own port.", MessageType.None);

            if (listening)
            {
                long ticks = Interlocked.Read(ref lastPacketTicks);
                string ago = ticks == 0 ? "nothing yet" : $"{(DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalSeconds:0.0}s ago";
                EditorGUILayout.LabelField($"Packets: {Interlocked.Read(ref packets)}   Last: {ago}");
                var keys = live.Keys.Where(k => k.StartsWith("HT/") || k.StartsWith("BT/")).OrderBy(k => k).ToList();
                if (keys.Count == 0) EditorGUILayout.LabelField("No HT/ or BT/ values received yet.", EditorStyles.miniLabel);
                foreach (var k in keys)
                {
                    float v = live.TryGetValue(k, out var x) ? x : 0f;
                    var r = EditorGUILayout.GetControlRect(false, 16f);
                    bool signed = IsSigned(k);
                    EditorGUI.ProgressBar(r, signed ? (v + 1f) * 0.5f : Mathf.Clamp01(v), $"{k}  {v:0.00}");
                }
            }
        }

        void DrawSliders()
        {
            if (GUILayout.Button("Reset sliders (standing, open hands, everything detected)")) ResetSliders();
            foldHands = EditorGUILayout.Foldout(foldHands, "Hands (HT/)", true);
            if (foldHands)
                foreach (var side in new[] { "Left", "Right" })
                {
                    EditorGUI.indentLevel++;
                    Toggle($"HT/{side}Detected", side + " hand detected");
                    foreach (var f in new[] { "Thumb", "Index", "Middle", "Ring", "Pinky" }) Slider($"HT/{side}{f}Curl", 0f, 1f);
                    Slider($"HT/{side}Spread", 0f, 1f);
                    EditorGUI.indentLevel--;
                }
            foldBody = EditorGUILayout.Foldout(foldBody, "Body (BT/)", true);
            if (foldBody)
            {
                EditorGUI.indentLevel++;
                Toggle("BT/Detected", "Body detected");
                foreach (var side in new[] { "Left", "Right" })
                {
                    Slider($"BT/{side}UpperLegX", -1f, 1f); Slider($"BT/{side}UpperLegZ", -1f, 1f); Slider($"BT/{side}Knee", 0f, 1f);
                    Slider($"BT/{side}UpperArmX", -1f, 1f); Slider($"BT/{side}UpperArmZ", -1f, 1f); Slider($"BT/{side}Elbow", 0f, 1f);
                }
                Slider("BT/SpineBend", -1f, 1f); Slider("BT/SpineSide", -1f, 1f); Slider("BT/SpineTwist", -1f, 1f); Slider("BT/Crouch", 0f, 1f);
                EditorGUI.indentLevel--;
            }
        }

        void Slider(string name, float min, float max)
        {
            sliders.TryGetValue(name, out var v);
            sliders[name] = EditorGUILayout.Slider(name, v, min, max);
        }

        void Toggle(string name, string label)
        {
            sliders.TryGetValue(name, out var v);
            sliders[name] = EditorGUILayout.Toggle(label, v > 0.5f) ? 1f : 0f;
        }

        void ResetSliders()
        {
            sliders.Clear();
            sliders["HT/LeftDetected"] = 1f; sliders["HT/RightDetected"] = 1f; sliders["BT/Detected"] = 1f;
            // Arms hanging down (UpperArmZ 0 = down, 0.5 = straight out to the side).
            sliders["BT/LeftUpperArmZ"] = 0.08f; sliders["BT/RightUpperArmZ"] = 0.08f;
        }

        static bool IsSigned(string k)
        {
            return k.EndsWith("UpperLegX") || k.EndsWith("UpperLegZ") || k.EndsWith("UpperArmX") || k.EndsWith("UpperArmZ") ||
                   k == "BT/SpineBend" || k == "BT/SpineSide" || k == "BT/SpineTwist";
        }

        /* --------------------------------------------------------- OSC input */

        void StartListening()
        {
            listenError = null;
            if (port < 1 || port > 65535) { listenError = "Pick a port between 1 and 65535."; return; }
            try
            {
                udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, port));
            }
            catch (SocketException e)
            {
                listenError = $"Can't listen on port {port}: {e.Message} (is something else — VRChat, VRCFT, an OSC router — already using it?)";
                udp = null;
                return;
            }
            live.Clear();
            Interlocked.Exchange(ref packets, 0);
            Interlocked.Exchange(ref lastPacketTicks, 0);
            listening = true;
            thread = new Thread(ListenLoop) { IsBackground = true, Name = "KitsuNexus OSC preview" };
            thread.Start();
        }

        void StopListening()
        {
            listening = false;
            try { udp?.Close(); } catch (Exception) { /* closing anyway */ }
            udp = null;
            thread = null;
        }

        void ListenLoop()
        {
            var from = new IPEndPoint(IPAddress.Any, 0);
            var client = udp;
            while (listening && client != null)
            {
                try
                {
                    byte[] data = client.Receive(ref from);
                    Interlocked.Increment(ref packets);
                    Interlocked.Exchange(ref lastPacketTicks, DateTime.UtcNow.Ticks);
                    OscReader.Parse(data, 0, data.Length, (addr, v) =>
                    {
                        if (addr.StartsWith(AddrPrefix)) live[addr.Substring(AddrPrefix.Length)] = v;
                    });
                }
                catch (SocketException) { if (!listening) break; }
                catch (ObjectDisposedException) { break; }
                catch (Exception) { /* malformed packet: ignore */ }
            }
        }

        /* ------------------------------------------------------------ posing */

        void StartPreview()
        {
            previewError = null;
            if (avatar == null) return;
            anim = avatar.GetComponent<Animator>();
            if (anim == null || anim.avatar == null || !anim.avatar.isHuman) { previewError = "The avatar needs a Humanoid Animator."; return; }

            string folder = "Assets/KitsuNexus/Tracking/" + KitsuNexusTrackingSetup.Safe(avatar.gameObject.name);
            handL = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_LeftHand.asset");
            handR = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_RightHand.asset");
            body = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_Body.asset");
            bodyPose = AssetDatabase.LoadAssetAtPath<BlendTree>(folder + "/KN_BodyPose.asset");
            if (handL == null && handR == null && body == null)
            {
                previewError = $"No generated tracking layers found in {folder}. Run Tools > KitsuNexus > Hand & Body Tracking Setup on this avatar first.";
                return;
            }

            muscleByProp = new Dictionary<string, int>();
            for (int i = 0; i < HumanTrait.MuscleCount; i++) muscleByProp[KitsuNexusTrackingSetup.Prop(i)] = i;
            clipCache.Clear();

            var root = anim.transform;
            saved = root.GetComponentsInChildren<Transform>(true).Select(t => (t, t.localPosition, t.localRotation, t.localScale)).ToList();
            handler = new HumanPoseHandler(anim.avatar, root);
            rest = new HumanPose();
            handler.GetHumanPose(ref rest);
            previewing = true;
            if (source == Source.LiveOsc && !listening) StartListening();
        }

        void StopPreview()
        {
            if (!previewing) return;
            previewing = false;
            if (saved != null)
                foreach (var s in saved)
                {
                    if (s.t == null) continue;
                    s.t.localPosition = s.p; s.t.localRotation = s.r; s.t.localScale = s.s;
                }
            saved = null;
            handler?.Dispose();
            handler = null;
            SceneView.RepaintAll();
        }

        void Tick()
        {
            double now = EditorApplication.timeSinceStartup;
            if (previewing && now >= nextApply)
            {
                nextApply = now + 1.0 / 30.0;
                if (avatar == null || anim == null) StopPreview();
                else
                {
                    try { ApplyPose(); }
                    catch (Exception e) { previewError = "Preview stopped: " + e.Message; Debug.LogException(e); StopPreview(); }
                }
            }
            if ((listening || previewing) && now >= nextRepaint) { nextRepaint = now + 0.2; Repaint(); }
        }

        float Value(string name)
        {
            if (name == One) return 1f;
            float v;
            bool has = source == Source.LiveOsc ? live.TryGetValue(name, out v) : sliders.TryGetValue(name, out v);
            if (has) return v;
            return name == HandsOn || name == BodyOn ? 1f : 0f; // toggles default on, like the menu
        }

        void ApplyPose()
        {
            var acc = new Dictionary<string, float>();
            if (handL != null && Value("HT/LeftDetected") > 0.5f && Value(HandsOn) > 0.5f) Eval(handL, 1f, acc);
            if (handR != null && Value("HT/RightDetected") > 0.5f && Value(HandsOn) > 0.5f) Eval(handR, 1f, acc);
            if (body != null && Value("BT/Detected") > 0.5f && Value(BodyOn) > 0.5f) { Eval(body, 1f, acc); Eval(bodyPose, 1f, acc); }

            var pose = rest;
            pose.muscles = (float[])rest.muscles.Clone();
            Vector3 bp = rest.bodyPosition;
            Vector4 bq = new Vector4(rest.bodyRotation.x, rest.bodyRotation.y, rest.bodyRotation.z, rest.bodyRotation.w);
            foreach (var kv in acc)
            {
                if (muscleByProp.TryGetValue(kv.Key, out int i)) { pose.muscles[i] = kv.Value; continue; }
                switch (kv.Key)
                {
                    case "RootT.x": bp.x = kv.Value; break;
                    case "RootT.y": bp.y = kv.Value; break;
                    case "RootT.z": bp.z = kv.Value; break;
                    case "RootQ.x": bq.x = kv.Value; break;
                    case "RootQ.y": bq.y = kv.Value; break;
                    case "RootQ.z": bq.z = kv.Value; break;
                    case "RootQ.w": bq.w = kv.Value; break;
                }
            }
            pose.bodyPosition = bp;
            if (bq.sqrMagnitude > 1e-6f) { bq.Normalize(); pose.bodyRotation = new Quaternion(bq.x, bq.y, bq.z, bq.w); }
            handler.SetHumanPose(ref pose);
            SceneView.RepaintAll();
        }

        // Same maths the Animator uses for these trees: direct children add with their
        // weight parameter, 1D trees blend the two children around the parameter value.
        void Eval(Motion m, float w, Dictionary<string, float> acc)
        {
            if (m == null || w <= 0f) return;
            if (m is AnimationClip clip)
            {
                foreach (var (prop, v) in ClipValues(clip))
                {
                    acc.TryGetValue(prop, out var cur);
                    acc[prop] = cur + w * v;
                }
                return;
            }
            var tree = m as BlendTree;
            if (tree == null) return;
            var kids = tree.children;
            if (kids.Length == 0) return;
            if (tree.blendType == BlendTreeType.Direct)
            {
                foreach (var c in kids) Eval(c.motion, w * Value(c.directBlendParameter), acc);
                return;
            }
            if (tree.blendType == BlendTreeType.FreeformCartesian2D || tree.blendType == BlendTreeType.SimpleDirectional2D || tree.blendType == BlendTreeType.FreeformDirectional2D)
            {
                Eval2D(kids, Value(tree.blendParameter), Value(tree.blendParameterY), w, acc);
                return;
            }
            if (tree.blendType == BlendTreeType.Simple1D)
            {
                var sorted = kids.OrderBy(c => c.threshold).ToArray();
                float x = Value(tree.blendParameter);
                if (x <= sorted[0].threshold) { Eval(sorted[0].motion, w, acc); return; }
                if (x >= sorted[sorted.Length - 1].threshold) { Eval(sorted[sorted.Length - 1].motion, w, acc); return; }
                for (int i = 0; i < sorted.Length - 1; i++)
                {
                    float a = sorted[i].threshold, b = sorted[i + 1].threshold;
                    if (x < a || x > b) continue;
                    float t = b > a ? (x - a) / (b - a) : 0f;
                    Eval(sorted[i].motion, w * (1f - t), acc);
                    Eval(sorted[i + 1].motion, w * t, acc);
                    return;
                }
            }
        }

        // The setup tool lays 2D children out on a full grid: blend the four around (x, y)
        // bilinearly (the Animator's gradient-band blend agrees on the grid points).
        // Anything else: inverse-distance weights.
        void Eval2D(ChildMotion[] kids, float x, float y, float w, Dictionary<string, float> acc)
        {
            var xs = kids.Select(c => c.position.x).Distinct().OrderBy(v => v).ToArray();
            var ys = kids.Select(c => c.position.y).Distinct().OrderBy(v => v).ToArray();
            if (xs.Length * ys.Length == kids.Length && xs.Length > 1 && ys.Length > 1)
            {
                x = Mathf.Clamp(x, xs[0], xs[xs.Length - 1]);
                y = Mathf.Clamp(y, ys[0], ys[ys.Length - 1]);
                int i = 0; while (i < xs.Length - 2 && x > xs[i + 1]) i++;
                int j = 0; while (j < ys.Length - 2 && y > ys[j + 1]) j++;
                float tx = (x - xs[i]) / (xs[i + 1] - xs[i]), ty = (y - ys[j]) / (ys[j + 1] - ys[j]);
                Motion At(float px, float py) => kids.First(c => Mathf.Approximately(c.position.x, px) && Mathf.Approximately(c.position.y, py)).motion;
                Eval(At(xs[i], ys[j]), w * (1 - tx) * (1 - ty), acc);
                Eval(At(xs[i + 1], ys[j]), w * tx * (1 - ty), acc);
                Eval(At(xs[i], ys[j + 1]), w * (1 - tx) * ty, acc);
                Eval(At(xs[i + 1], ys[j + 1]), w * tx * ty, acc);
                return;
            }
            var ws = kids.Select(c => 1f / Mathf.Max(1e-4f, (c.position - new Vector2(x, y)).sqrMagnitude)).ToArray();
            float sum = ws.Sum();
            for (int k = 0; k < kids.Length; k++) Eval(kids[k].motion, w * ws[k] / sum, acc);
        }

        (string, float)[] ClipValues(AnimationClip clip)
        {
            if (clipCache.TryGetValue(clip, out var vals)) return vals;
            vals = AnimationUtility.GetCurveBindings(clip)
                .Select(b => (b.propertyName, AnimationUtility.GetEditorCurve(clip, b)))
                .Where(x => x.Item2 != null)
                .Select(x => (x.propertyName, x.Item2.Evaluate(0f)))
                .ToArray();
            clipCache[clip] = vals;
            return vals;
        }
    }

    // Minimal OSC 1.0 reader: messages and (nested) bundles; f / i / T / F values.
    static class OscReader
    {
        public static void Parse(byte[] b, int off, int len, Action<string, float> onValue)
        {
            int end = off + len;
            if (len >= 16 && b[off] == (byte)'#')
            {
                int q0 = off;
                if (ReadString(b, ref q0, end) != "#bundle") return;
                int p = off + 16; // "#bundle\0" + 8-byte time tag
                while (p + 4 <= end)
                {
                    int size = ReadInt(b, p); p += 4;
                    if (size <= 0 || p + size > end) return;
                    Parse(b, p, size, onValue);
                    p += size;
                }
                return;
            }
            int q = off;
            string addr = ReadString(b, ref q, end);
            if (string.IsNullOrEmpty(addr) || addr[0] != '/') return;
            string tags = ReadString(b, ref q, end);
            if (string.IsNullOrEmpty(tags) || tags[0] != ',') return;
            for (int i = 1; i < tags.Length; i++)
            {
                switch (tags[i])
                {
                    case 'f': if (q + 4 > end) return; onValue(addr, ReadFloat(b, q)); return;
                    case 'i': if (q + 4 > end) return; onValue(addr, ReadInt(b, q)); return;
                    case 'T': onValue(addr, 1f); return;
                    case 'F': onValue(addr, 0f); return;
                    case 'd': case 'h': case 't': q += 8; break;
                    case 's': case 'S': ReadString(b, ref q, end); break;
                    case 'b': { if (q + 4 > end) return; int n = ReadInt(b, q); q += 4 + ((n + 3) & ~3); break; }
                    default: return;
                }
            }
        }

        static string ReadString(byte[] b, ref int q, int end)
        {
            int start = q;
            while (q < end && b[q] != 0) q++;
            if (q >= end) return null;
            string s = Encoding.UTF8.GetString(b, start, q - start);
            q = start + ((q - start + 1 + 3) & ~3);
            return s;
        }

        static int ReadInt(byte[] b, int p) { return (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; }

        static float ReadFloat(byte[] b, int p)
        {
            var tmp = new[] { b[p + 3], b[p + 2], b[p + 1], b[p] };
            if (!BitConverter.IsLittleEndian) Array.Reverse(tmp);
            return BitConverter.ToSingle(tmp, 0);
        }
    }
}
#endif
