// KitsuNexus Kinect v1 bridge (Xbox 360 Kinect / Kinect for Windows v1).
//
// Compiled ON THE USER'S PC by KitsuNexus (kinect.js) with the C# compiler that ships with
// Windows (.NET Framework 4, csc.exe) against the user's own Kinect for Windows SDK /
// Runtime v1.8 (Microsoft.Kinect.dll). Nothing is downloaded and no Microsoft binary is
// shipped with KitsuNexus. Plain C# 5 (no newer syntax) so the built-in compiler accepts it.
//
// Reads the Kinect's depth-based skeleton (20 joints) and writes one JSON line per frame
// to stdout:
//   {"j":[[x,y,z,state,u,v], ... 20 joints]}   skeleton space (metres, sensor at origin,
//                                              +x = sensor's left = the user's right,
//                                              +y up, +z away from the sensor),
//                                              state 2 tracked / 1 inferred / 0 not,
//                                              u,v = position in the 640x480 colour image
//   {"j":null}                                   nobody tracked
//   {"status":"...","detail":"..."}              sensor status changes
// Exits when stdin closes (KitsuNexus stopped it). Arg "seated": Kinect seated mode
// (upper body only, better at a desk).

using System;
using System.Globalization;
using System.Text;
using System.Threading;
using Microsoft.Kinect;

class KinectBridge
{
    static KinectSensor sensor;
    static readonly object writeLock = new object();
    static bool seated;

    static void Main(string[] args)
    {
        seated = args.Length > 0 && args[0] == "seated";
        Console.OutputEncoding = new UTF8Encoding(false);
        KinectSensor.KinectSensors.StatusChanged += (s, e) => Status("sensor", e.Status.ToString());

        // Wait for a connected sensor (it can be plugged in later).
        string last = null;
        while (sensor == null)
        {
            foreach (KinectSensor k in KinectSensor.KinectSensors)
                if (k.Status == KinectStatus.Connected) { sensor = k; break; }
            if (sensor != null) break;
            string st = KinectSensor.KinectSensors.Count == 0 ? "no Kinect found" : KinectSensor.KinectSensors[0].Status.ToString();
            if (st != last) { Status("waiting", st); last = st; }
            Thread.Sleep(2000);
        }

        try
        {
            TransformSmoothParameters smooth = new TransformSmoothParameters();
            smooth.Smoothing = 0.5f; smooth.Correction = 0.5f; smooth.Prediction = 0.5f;
            smooth.JitterRadius = 0.05f; smooth.MaxDeviationRadius = 0.04f;
            sensor.SkeletonStream.Enable(smooth);
            sensor.SkeletonStream.TrackingMode = seated ? SkeletonTrackingMode.Seated : SkeletonTrackingMode.Default;
            sensor.SkeletonFrameReady += OnSkeletonFrame;
            sensor.Start();
            Status("running", seated ? "seated" : "default");
        }
        catch (Exception ex)
        {
            Status("error", ex.Message);
            return;
        }

        // Run until KitsuNexus closes our stdin.
        try { Console.In.ReadToEnd(); } catch (Exception) { }
        try { sensor.Stop(); } catch (Exception) { }
    }

    static void OnSkeletonFrame(object s, SkeletonFrameReadyEventArgs e)
    {
        using (SkeletonFrame frame = e.OpenSkeletonFrame())
        {
            if (frame == null) return;
            Skeleton[] all = new Skeleton[frame.SkeletonArrayLength];
            frame.CopySkeletonDataTo(all);
            Skeleton best = null;
            foreach (Skeleton sk in all)
                if (sk != null && sk.TrackingState == SkeletonTrackingState.Tracked && (best == null || sk.Position.Z < best.Position.Z)) best = sk;

            StringBuilder sb = new StringBuilder(1200);
            if (best == null) sb.Append("{\"j\":null}");
            else
            {
                sb.Append("{\"j\":[");
                for (int i = 0; i < 20; i++)
                {
                    Joint j = best.Joints[(JointType)i];
                    int state = j.TrackingState == JointTrackingState.Tracked ? 2 : (j.TrackingState == JointTrackingState.Inferred ? 1 : 0);
                    ColorImagePoint cp = sensor.CoordinateMapper.MapSkeletonPointToColorPoint(j.Position, ColorImageFormat.RgbResolution640x480Fps30);
                    if (i > 0) sb.Append(',');
                    sb.Append('[').Append(F(j.Position.X)).Append(',').Append(F(j.Position.Y)).Append(',').Append(F(j.Position.Z)).Append(',')
                      .Append(state).Append(',').Append(F(cp.X / 640f)).Append(',').Append(F(cp.Y / 480f)).Append(']');
                }
                sb.Append("]}");
            }
            Write(sb.ToString());
        }
    }

    static string F(float v) { return (float.IsNaN(v) || float.IsInfinity(v) ? 0f : v).ToString("0.####", CultureInfo.InvariantCulture); }

    static void Status(string status, string detail)
    {
        Write("{\"status\":\"" + Esc(status) + "\",\"detail\":\"" + Esc(detail) + "\"}");
    }

    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }

    static void Write(string line)
    {
        lock (writeLock) { try { Console.Out.WriteLine(line); Console.Out.Flush(); } catch (Exception) { } }
    }
}
