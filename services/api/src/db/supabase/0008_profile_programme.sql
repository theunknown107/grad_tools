-- ===========================================================================
-- Supabase 0008 — which programme the student is on
-- ===========================================================================
--
-- Authority: Phase 7B.3 §30–§43, §115 · M9 §33
--
-- Forward-only. 0001–0007 are released and are not edited.
--
-- ---------------------------------------------------------------------------
-- WHY THIS COLUMN EXISTS, AND WHAT CAUGHT IT
-- ---------------------------------------------------------------------------
--
-- The applicability engine scopes a notice on seven axes, and VTU states the
-- programme on nearly every one it publishes: "Time Table for B.E. V Semester
-- Examination". The student record had no programme, so the engine read that
-- axis as "the student has not said", which resolves to `unresolved` — and
-- `unresolved` correctly notifies nobody.
--
-- The consequence, found by running the fixtures rather than by reasoning about
-- them: EVERY programme-scoped notice reached zero students. An engine with an
-- axis no record can answer is decoration.
--
-- Nullable with no default, because the honest value for an existing row is
-- that nobody has said. Those students keep getting `unresolved` for
-- programme-scoped notices until they tell us, which is the correct outcome —
-- inferring "B.E." from the presence of a UG scheme is precisely the guess §29
-- forbids, and this project has one M.Tech. fixture in the suite to keep that
-- honest.
--
-- NOTE FOR WHOEVER PICKS THIS UP: the frontend is frozen and does not yet ask
-- for this. The column and the API accept it; nothing collects it. That gap is
-- recorded in docs/42 rather than hidden behind a default.
-- ===========================================================================

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS programme text
    CHECK (programme IS NULL OR length(programme) BETWEEN 1 AND 60);

COMMENT ON COLUMN student_profiles.programme IS
  'The programme the student is enrolled in, as they stated it. Never inferred '
  'from the scheme or the branch (Phase 7B.3 §29, §32).';
