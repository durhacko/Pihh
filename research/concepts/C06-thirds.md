# C06: Thirds, a robot photographer that composes the shot

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** A pan-tilt camera that improves photographic composition (rule of thirds, headroom, space in the direction of gaze, group balance) rather than just keeping a face in frame, and explains its choices.

| Field | Content |
|---|---|
| Audience | Solo creators, event photo booths |
| Why Composition | Image composition is the goal it optimises: a weighted mix of composition rules |
| Demo | Judges walk into frame. An overlay shows the thirds grid, eye-catching regions, and a live score with a breakdown. The rig pans to give space in the direction of gaze and balances three people into a triangle. A style dial switches thirds ↔ symmetric. It takes the photo and adds it to a scored gallery. |
| Mechanism | MediaPipe pose/face detection plus a saliency map, a scoring function over pan, tilt and crop (grid search), smoothed servo control |
| Likely stack | Python + MediaPipe/OpenCV. UNO Q (vision on Linux, servos on the microcontroller) or laptop plus Arduino. |
| Dependencies | 2 servos, a bracket, a webcam (**hardware availability unverified**) |
| Prior art | Sony PTZ Auto Framing, Obsbot/Pivo, Google Clips. **We differ by** making the composition score the explicit goal, handling multiple subjects, explaining itself, and offering style presets. |
| MVP | Digital-crop "virtual camera" with score and overlays (no hardware) |
| Stretch | Servo rig, blending in a learned aesthetic model (NIMA), LLM critique |
| Fallback | Digital crop if servos jitter or are unavailable |
| Effort | S–M |
| Risks | Too close to commodity auto-framing unless the score is the star |
| Sponsor fit | Arduino UNO Q, hardware, AI (**unverified**) |
