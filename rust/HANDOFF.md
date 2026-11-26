# Handoff: last session, Gate 3 (2026-11-21)

> **Status: PAUSED — GATE 3 PASSED WITH LIMITATIONS.** The crate is experimental and is
> not wired into the app; the TypeScript timetable parser remains the one in use.
> Committed on `chore/verified-android-release-candidate` on 2026-11-23 for safekeeping.

## Start the next session with

1. Read `rust/MAP.md`, `rust/PORT_MAP.md`, `rust/DECISIONS.md` (ADR-12 is open) and this file.
2. Run `git status`. Nothing here is committed, and the tree also holds unrelated uncommitted work. **Never reset, clean or stash.**
3. Re-check the crate:
   - `rust-anything map`
   - `rust-anything diff <abs path>/rust/timetable-rs`
   - `rust-anything gate <abs path>/rust/timetable-rs`

   Use the absolute crate path on Windows.

The full report and evidence are kept outside the repository, in the private migration artifacts (`gate3/GATE3_REPORT.md`).

## Done at Gate 3

**Runtime (G3.1).** The real WASM (wasm-bindgen 0.2.130, `--target web`, the same `.wasm` bytes as the Node build) ran all 1,029 recorded cases with exact results in:

- Chromium 151, Firefox 153 and WebKit 26.5, bundled by the repo's Vite 7.3.7;
- the Capacitor app's own WebView (Chrome 157) on an Android 17 / API 37 x86_64 emulator, loading the asset from the packaged `https://localhost/...` path.

Also checked:

- A bad init path rejects, and the TypeScript path keeps working.
- A second init is a no-op, and wasm memory stays at 1.5 MB.
- The app still starts afterwards.
- **API 24 was not tested** (no API 24 device or image).

**Boundary (G3.2).** No mid-size boundary is justified; see ADR-12. No new Rust was written.

**Ground truth and shadow (G3.3/G3.4), run off-app.** The TS parser and a Rust-backed candidate (the same parser, with `readSlot`, `normalizeSubjectToken` and `subjectKey` routed to the WASM build) were run on the 15 private documents:

- PaddleOCR-mobile words go through `wordsToPositioned`; T02 goes through `docxTimetables`.
- **15/15 identical outputs.** The frozen scorer gives the same result for both: 238/447 complete, 73 missing, 13 extra, 0 false confirmations.
- No in-app shadow was added: no cohesive boundary exists to shadow (ADR-12).

**Config.** `rust-anything.json` `root` is now `"../.."` (ADR-13).

## Next (each needs approval)

1. **Decide ADR-12.** Either port `parseTimetable` + `docxTimetables` as a dedicated multi-session unit, then wire an in-app, dev-only shadow at `lib/result-file.ts` / `DocumentImport`; or pause the timetable migration.
2. **If API 24 matters,** test on an API 24 emulator image before any app caller depends on WASM.
3. **Size:** about 300 KB gzipped / 232 KB brotli for 4 small functions. Try `regex-lite`, `opt-level = "s"` and `wasm-opt` before shipping anything.
