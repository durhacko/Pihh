# C07: Chorus, the audience's phones compose one display and one choir

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** Judges scan a QR code. Each phone becomes one pixel and one voice. A server combines them into images and harmonies, and each phone only knows its own part.

| Field | Content |
|---|---|
| Audience | Concerts, lectures, the judges themselves |
| Why Composition | The whole emerges from parts. A score is split into per-device parts and recombined. |
| Demo | 20–40 phones in a grid. A camera locates each phone from a flashed ID code. The grid shows the logo, a wave, and a chord with one note per phone. Pull out phones and it recomposes. |
| Mechanism | Node + socket.io server, NTP-style clock sync, camera positioning, Web Audio scheduling |
| Dependencies | **Venue Wi-Fi is high risk** (bring our own router/hotspot). iOS needs a tap before audio plays. |
| Prior art | PixelPhones (phone-pixel display over socket.io), Wham City Lights / CUE (concert light sync). **We differ by** camera-based positions, recomposing when phones drop out, and harmony voices. |
| MVP | QR join, manual grid placement, synced animations and chords |
| Stretch | Camera positioning, live tablet drawing, acting as physical nodes for C01 Encore |
| Effort | S–M |
| Risks | Wi-Fi and sync jitter. Needs many participants at demo time. |
| Sponsor fit | UX / MLH (**unverified**) |
