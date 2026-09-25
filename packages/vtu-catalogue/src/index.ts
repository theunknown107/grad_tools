/**
 * Reading VTU scheme documents into a normalized course catalogue.
 *
 * Authority: docs/38_VTU_INGESTION.md · Phase 7D §26, §27
 *
 * The crawler writes the catalogue and the app reads it. Both go through this
 * package so there is exactly one implementation of what a VTU scheme says.
 */
export type { PositionedText } from './positioned-text.js';
export {
  parseScheme,
  schemePages,
  semesterTotalsOf,
  supersedingPairIn,
  type SupersedingCode,
  type ParsedScheme,
  type SchemeCourse,
  type SchemePage,
  type SchemeRejection,
  type SemesterTotal,
} from './scheme-import.js';
export {
  aliasEvidence,
  aliasesOf,
  canonicalCodeOf,
  COURSE_ALIASES,
  type CourseAlias,
} from './aliases.js';
export {
  optionGroupsOf,
  type OptionGroup,
  type OptionKind,
  type OptionMember,
} from './option-groups.js';
export {
  parseSyllabusDocument,
  type Field,
  type FieldState,
  type ParsedSyllabus,
  type SyllabusModule,
  type SyllabusTopic,
} from './syllabus-import.js';
export {
  courseKey,
  type Catalogue,
  type CatalogueAlias,
  type CatalogueConflict,
  type CatalogueCourse,
  type CourseProvenance,
  type CreditBasis,
} from './types.js';

export {
  cycleGroupOf,
  optionCellsOf,
  streamMembershipOf,
  streamForProgramme,
  resolveFirstYearForStream,
  type StreamMembership,
  type ResolvedFirstYearCourse,
  type UnresolvedFirstYearSlot,
  type FirstYearResolution,
  type OptionCell,
} from './first-year-streams.js';

export {
  buildResultCards,
  findVtuResultSession,
  vtuResultCards,
  vtuResultCatalog,
  type RawResultEntry,
  type VtuResultCard,
  type VtuResultCatalog,
  type VtuResultSection,
  type VtuResultSession,
  type VtuResultType,
  type VtuSessionAnomaly,
} from './result-sessions.js';
