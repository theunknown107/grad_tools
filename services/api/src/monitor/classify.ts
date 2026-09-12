/**
 * What kind of thing a source item is, and how much it matters.
 *
 * Authority: Phase 7B.3 §28–§29, §44–§48
 *
 * ---------------------------------------------------------------------------
 * DETERMINISTIC, AND REVIEWABLE BY A PERSON
 * ---------------------------------------------------------------------------
 *
 * Classification decides whether a student is interrupted about their degree,
 * so the authoritative answer is a set of stated phrases and the reasons they
 * fired — not a score, not a similarity, not an embedding (§29). Every decision
 * this module makes can be read back as "it said this word", which is what
 * makes a wrong answer fixable rather than mysterious.
 *
 * ---------------------------------------------------------------------------
 * AMBIGUOUS IS AN ANSWER
 * ---------------------------------------------------------------------------
 *
 * An item matching nothing, or matching two categories equally, is
 * `unresolved`. It is stored, it is reviewable, and it notifies nobody — which
 * is what §35 requires and is strictly better than picking the first match and
 * interrupting a few thousand people on the strength of it.
 */

export type SourceCategory =
  | 'administration'
  | 'examination'
  | 'exam_timetable'
  | 'result'
  | 'revaluation'
  | 'registration'
  | 'academic_calendar'
  | 'scheme'
  | 'syllabus'
  | 'regulation'
  | 'other'
  | 'unresolved';

export type Importance = 'high' | 'medium' | 'low';

export interface Classification {
  readonly category: SourceCategory;
  /** The phrases that fired, verbatim. The whole audit trail (§54). */
  readonly signals: readonly string[];
}

/**
 * The phrases each category is recognised by.
 *
 * Every one of these is a phrase VTU actually prints on the documents this
 * project has seen, or a phrase whose meaning is unambiguous in this domain.
 * They are ordered most specific first, because "revised time table" is an
 * exam timetable before it is an examination notice, and reading it as the
 * looser category would file a reschedule under general news.
 */
const RULES: readonly { readonly category: SourceCategory; readonly phrases: readonly RegExp[] }[] =
  [
    {
      category: 'exam_timetable',
      phrases: [/\btime\s*table\b/i, /\bexamination\s+schedule\b/i],
    },
    {
      category: 'result',
      phrases: [
        /\bresults?\s+(announced|declared|published)\b/i,
        /\bannouncement\s+of\s+results?\b/i,
      ],
    },
    {
      category: 'revaluation',
      phrases: [/\bre-?valuation\b/i, /\bre-?totall?ing\b/i, /\bphoto\s*cop(y|ies)\b/i],
    },
    {
      category: 'registration',
      phrases: [/\bexam(ination)?\s+(registration|application)\b/i, /\bapply\s+online\b/i],
    },
    {
      category: 'academic_calendar',
      phrases: [/\bacademic\s+calendar\b/i, /\bcalendar\s+of\s+events\b/i],
    },
    { category: 'regulation', phrases: [/\bregulations?\b/i, /\bordinance\b/i] },
    /*
     * SCHEME BEFORE SYLLABUS, and the order is load-bearing. VTU publishes one
     * document called "Scheme and Syllabus", and it is a scheme document that
     * contains a syllabus. Reading the looser word first filed every PG scheme
     * under `syllabus` — which running the fixtures is what caught.
     */
    {
      category: 'scheme',
      phrases: [/\bscheme\s+of\s+teaching\b/i, /\bscheme\s*(&|and)\s*syllabus\b/i],
    },
    { category: 'syllabus', phrases: [/\bsyllabus\b/i, /\bsyllabi\b/i] },
    { category: 'examination', phrases: [/\bexamination\b/i, /\bexam\b/i] },
    { category: 'administration', phrases: [/\bcircular\b/i, /\bnotification\b/i, /\bnotice\b/i] },
  ];

/**
 * What this item is about.
 *
 * The FIRST rule to fire wins, and the order above is the statement of
 * precedence rather than an accident of arrangement. An item that fires
 * nothing is `unresolved`, not `other`: "other" would say we read it and
 * decided, and we did not.
 */
export function classifySourceItem(text: string): Classification {
  for (const rule of RULES) {
    /*
     * THE SIGNAL IS THE WORDS THE DOCUMENT USED, not the pattern that found
     * them. An operator reviewing a wrong answer needs to see "Revised Time
     * Table"; the pattern that matched it tells them what we wrote, which they
     * already know.
     */
    const signals = rule.phrases
      .map((phrase) => phrase.exec(text))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[0].replace(/\s+/g, ' ').trim());
    if (signals.length === 0) continue;
    return { category: rule.category, signals };
  }
  return { category: 'unresolved', signals: [] };
}

/**
 * Phrases that mean a student has to DO something, and soon.
 *
 * Importance is about consequence, not about how the item is worded. A
 * timetable is high because missing it means missing an examination; a
 * regulation is high because it changes the rules a degree is awarded under.
 */
const DEADLINE = /\blast\s+date\b|\bdeadline\b|\bon\s+or\s+before\b|\bclosing\s+date\b/i;
const CHANGE = /\brevised\b|\bpostponed\b|\bpreponed\b|\brescheduled\b|\bcancell?ed\b/i;

/**
 * How much this matters to a student, given what it is.
 *
 * ---------------------------------------------------------------------------
 * A CHANGE OUTRANKS THE THING IT CHANGES
 * ---------------------------------------------------------------------------
 *
 * "Revised time table" and "examination postponed" are high whatever category
 * they landed in, because a student who already planned around the first
 * version is the one person who must be told. That is the case the whole
 * engine exists for.
 *
 * Categories with no immediate action are low even when they are interesting.
 * §48's point stands: this is not a news feed, and an app that interrupts
 * people about tenders teaches them to ignore it before the exam notice
 * arrives.
 */
export function importanceOf(category: SourceCategory, text: string): Importance {
  if (CHANGE.test(text)) return 'high';
  if (DEADLINE.test(text)) return 'high';

  switch (category) {
    case 'exam_timetable':
    case 'result':
    case 'revaluation':
    case 'registration':
      return 'high';
    case 'academic_calendar':
    case 'regulation':
    case 'scheme':
    case 'syllabus':
      return 'medium';
    case 'examination':
      return 'medium';
    case 'administration':
    case 'other':
    case 'unresolved':
      return 'low';
  }
}
