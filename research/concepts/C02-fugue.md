# C02: Fugue, an AI ensemble you conduct with your hands

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** Four music agents (bass, chords, melody, drums) compose live by listening to each other under harmony rules. A human conducts them with hand gestures.

| Field | Content |
|---|---|
| Audience | Non-musicians, performers |
| Why Composition | It is musical composition in the literal sense, and the piece comes out of the agents' combined rules |
| Demo | A judge conducts in front of a webcam. Palm raised: crescendo. Point: a section solos. Fist: cut. "Kill the bass agent" and the others adapt. A visualiser shows each agent's notes and the who-listens-to-whom graph. |
| Mechanism | A shared clock and a bar-by-bar shared "blackboard". Each agent proposes its next bar from the others' last bar and the harmonic plan (rules or Markov chains). An optional LLM picks the form between phrases only. |
| Likely stack | Browser: Tone.js, MediaPipe Hands |
| Dependencies | None. LLM optional (latency). |
| Prior art | DJ Claude (several agents jamming via Strudel, no gestures). DigiJam (air instruments with MediaPipe, no agents). **We differ by** agents that listen under explicit counterpoint rules, gesture conducting, and a visible influence graph. |
| MVP | 3 rule-based agents in one key, 4 gestures, visualiser |
| Stretch | LLM "form" agent, MIDI out, phones as extra agents |
| Fallback | Keyboard or sliders if gestures misfire. Restrict to diatonic/pentatonic so it never sounds bad. |
| Effort | M |
| Risks | Musical quality is subjective. The hall will be noisy (bring a speaker). |
| Sponsor fit | Best use of AI / UX / MLH (**unverified**) |
