# Third-party notices — Face & Hand Tracking

Parts of this folder are ported (translated to JavaScript and changed) from the
projects below, which are licensed under the **Apache License, Version 2.0**
(https://www.apache.org/licenses/LICENSE-2.0). Those parts remain under the
Apache License 2.0; the KitsuNexus licence applies to everything else.

## VRCFaceTracking
- Source: https://github.com/benaclejames/VRCFaceTracking — Copyright the VRCFaceTracking contributors.
- Used in: `unifiedExpressions.js` (Unified Expressions list, simple-expression
  weights), `ftParams.js` (the v2 parameter set and formulas, Float/Bool/binary
  parameter types, avatar address matching, native eye-tracking parameters),
  `avatarConfig.js` (reading VRChat's OSC avatar config).
- Changes: rewritten in JavaScript; runs inside KitsuNexus instead of as a
  separate app with tracking modules; parameters are evaluated per frame and
  only changed values are sent.

## FoxyFace
- Source: https://github.com/Jeka8833/FoxyFace — Copyright Jeka8833.
- Used in: `unifiedExpressions.js` (MediaPipe blendshape → Unified Expression
  mapping, eye gaze from eyeLook* blendshapes, head position/rotation from the
  facial transformation matrix, calibration interpolation), `oneEuro.js` (use
  of the One Euro filter on blendshapes).
- Changes: rewritten in JavaScript; MediaPipe runs in the browser (Tasks
  Vision for Web) instead of Python; values go straight to VRChat over OSC
  instead of to VRCFaceTracking over UDP; added hand tracking on the same
  camera stream.

## MediaPipe
- `@mediapipe/tasks-vision` (npm) and the `face_landmarker.task`,
  `hand_landmarker.task` and `pose_landmarker_full.task` models — Copyright Google LLC, Apache License 2.0.
  The models are not shipped in this repository; they are downloaded from
  Google's MediaPipe model storage on first use.

## Not used: XR Animator
XR Animator / System Animator Online (ButzYung/SystemAnimatorOnline) was looked
at for camera body tracking but none of its code is used here: it is licensed
CC BY-NC-SA 4.0. `bodyTracking.js` is an independent implementation on top of
MediaPipe Pose and VRChat's published OSC tracker format.
