# Architecture overview

> Status: **not started; waits on idea selection.** Owner: Arnav (M1 issue). Do not fill this in speculatively.

When the idea is selected, fill in **only the sections the project needs**, briefly. Use Mermaid for diagrams. Put shared contracts in `INTERFACES.md` (create it at M1), and record major choices as ADRs in [`adr/`](adr/).

1. **Objectives and constraints:** what must work at judging; hard deadline 11:00 Sun
2. **MVP boundary:** link to `../product/MVP_SCOPE.md`
3. **Components:** a table of component, responsibility, owner, directory
4. **Data flow:** Mermaid diagram
5. **Interfaces:** link to `INTERFACES.md` (contract-first, so agents can build in parallel against mocks)
6. **State management**
7. **Failure handling and sim/mock modes**
8. **Concurrency / communication** (if relevant)
9. **Runtime environment:** laptops, hardware, network
10. **Credentials:** names in `.env.example`, never values
11. **Observability:** logs or overlays useful for debugging *and* for showing judges
12. **Performance targets:** e.g. fps, latency
13. **Test and integration strategy:** link to `../quality/TEST_STRATEGY.md`
14. **Trade-offs**
15. **Stretch architecture:** kept separate from the MVP
