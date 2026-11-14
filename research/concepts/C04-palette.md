# C04: Palette, reverse-engineering paint recipes

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** Point a camera at any colour and get a recipe from 3–5 real base paints. Mix it, measure it, and the system corrects the recipe.

| Field | Content |
|---|---|
| Audience | Painters, model makers, decorators |
| Why Composition | Material composition. A mix's colour is a nonlinear combination of the pigments' spectra (Kubelka–Munk), and we solve the reverse problem. |
| Demo | A judge holds up their lanyard. The screen shows "37% ultramarine / 12% cadmium yellow / 51% white", the predicted swatch, and the colour error (ΔE). A teammate mixes it, the camera re-measures it, and a correction is issued. |
| Mechanism | Kubelka–Munk or Mixbox forward model, a constrained solver (SLSQP) minimising CIEDE2000, grey-card calibration |
| Likely stack | Python (scipy) plus a web UI |
| Dependencies | Mixbox licence is non-commercial (likely OK for a hackathon, **verify**). Paints or food colouring. Pumps are an access risk. |
| Prior art | Mixbox only mixes forward. Paint-shop matching uses proprietary tints. **We differ by** solving recipes for your own paints, closing the loop with a camera, and showing the composition. |
| MVP | Forward and reverse model for 5 pigments, camera target pick, recipe plus ΔE |
| Stretch | Pump rig on a UNO Q, turning an image into a paint-by-numbers palette |
| Fallback | Calibration card for lighting. Digital-only mode. |
| Effort | M |
| Risks | Colour science under hall lighting. Mess. Needs consumables bought or sourced today. |
| Sponsor fit | Hardware (with pumps), design (**unverified**) |
