/**
 * The review workbench.
 *
 * Authority: docs/17 §17.18 · docs/21 §21.15 · M5A.6 §4–§7
 *
 * NOT AN ADMIN DASHBOARD. It answers one question — "what did GradTools find,
 * and what still needs confirming?" — for one document at a time, in the same
 * visual language as the rest of the app.
 *
 * THE MACHINE VALUE IS NEVER HIDDEN. A corrected field shows the human value
 * with the machine's original struck through beside it. A reviewer who cannot
 * see what the parser said cannot tell a parser bug from a bad scan, and that
 * distinction is the entire reason this corpus is being built (M5A.6 §9).
 *
 * EVERY PIECE OF EXTRACTED TEXT IS RENDERED AS TEXT. It came out of a PDF
 * anyone could have crafted. React escapes it, the API escapes it again on the
 * wire, and nothing here uses `dangerouslySetInnerHTML` (docs/13 §T-21).
 */

import { useCallback, useState } from 'react';
import {
  SOURCE_ROUTES,
  type ExtractedMcqItem,
  type ExtractedPaper,
  type ExtractedQuestion,
  type ExtractedSubQuestion,
  type McqOption,
  type StructuralConfidence,
} from '@gradtools/shared-types';
import { AsyncSection } from '../../components/AsyncSection.js';
import { useAsync } from '../../hooks/useReference.js';
import { apiBaseUrl } from '../../repositories/reference.js';
import styles from './documents.module.css';

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl()}${path}`, init);
  if (!response.ok) throw new Error(`Request failed (${String(response.status)}).`);
  return response.json();
}

/**
 * What the parser found, in the words a student would use.
 *
 * NEVER "accuracy". The parser reports how much the LAYOUT agreed, which is a
 * question geometry can answer; how correct the reading is, it cannot. So the
 * labels describe the evidence, not a score (docs/32 ED-46).
 */
const CONFIDENCE_LABEL: Record<StructuralConfidence, { label: string; tone: string }> = {
  high: { label: 'Clear', tone: 'ok' },
  medium: { label: 'Partly clear', tone: 'info' },
  low: { label: 'Unclear', tone: 'info' },
  review_required: { label: 'Needs review', tone: 'warn' },
};

const REVIEW_LABEL: Record<string, string> = {
  unreviewed: 'Not checked',
  accepted: 'Checked',
  corrected: 'Corrected',
  rejected: 'Dismissed',
};

const PAPER_FORMAT_LABEL: Record<string, string> = {
  descriptive: 'Written answers',
  mcq: 'Multiple choice',
  // `unknown` is a real answer, not a fallback to the commoner format.
  unknown: 'Could not be identified',
};

/** What a reviewer is called in the audit trail on this machine. */
const REVIEWER = 'local-operator';

/* -------------------------------------------------------------------------- */
/* Review actions                                                             */
/* -------------------------------------------------------------------------- */

type ReviewKind = 'question' | 'sub-question' | 'mcq-item';

interface Correction {
  questionNumber?: string | null;
  label?: string | null;
  module?: string | null;
  text?: string | null;
  marks?: number | null;
  bloomLevel?: string | null;
  courseOutcome?: string | null;
  itemNumber?: number | null;
  options?: McqOption[] | null;
}

async function submitReview(
  kind: ReviewKind,
  id: string,
  action: 'accept' | 'correct' | 'reject',
  corrections?: Correction,
): Promise<void> {
  await fetchJson(SOURCE_ROUTES.review(kind, id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      reviewedBy: REVIEWER,
      ...(action === 'correct' && corrections ? { corrections } : {}),
    }),
  });
}

/**
 * Accept · Correct · Reject, and nothing else.
 *
 * Three verbs, because there are exactly three conclusions a reviewer can
 * reach. `Reject` does NOT delete: the row stays, marked, because a removed
 * record cannot tell a later reader whether the parser was wrong or the scan
 * was (M5A.6 §13, §17).
 */
function ReviewActions({
  kind,
  id,
  state,
  onReviewed,
  onCorrect,
}: {
  readonly kind: ReviewKind;
  readonly id: string;
  readonly state: string;
  readonly onReviewed: () => void;
  readonly onCorrect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (action: 'accept' | 'reject') => {
    setBusy(true);
    setError(null);
    void submitReview(kind, id, action)
      .then(onReviewed)
      .catch(() => {
        setError('Could not save that.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className={styles.reviewActions}>
      <button
        type="button"
        className={styles.reviewButton}
        disabled={busy}
        aria-pressed={state === 'accepted'}
        onClick={() => {
          act('accept');
        }}
      >
        Correct as read
      </button>
      <button type="button" className={styles.reviewButton} disabled={busy} onClick={onCorrect}>
        Fix a value
      </button>
      <button
        type="button"
        className={styles.reviewButton}
        disabled={busy}
        aria-pressed={state === 'rejected'}
        onClick={() => {
          act('reject');
        }}
      >
        Not a question
      </button>
      {error !== null && <span className={styles.error}>{error}</span>}
    </div>
  );
}

/** One correctable field. Empty means "leave the machine value alone". */
function Field({
  label,
  name,
  defaultValue,
  type = 'text',
}: {
  readonly label: string;
  readonly name: string;
  readonly defaultValue: string;
  readonly type?: string;
}) {
  const id = `${name}-${label.replace(/\s+/g, '-')}`;
  return (
    <p className={styles.correctionField}>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} defaultValue={defaultValue} />
    </p>
  );
}

/**
 * The correction form.
 *
 * Pre-filled with the effective value so a reviewer edits what they can see;
 * submitting sends the whole set, and the machine columns are untouched by any
 * of it. Cleared fields become `null`, which clears an earlier correction
 * rather than silently keeping it.
 */
function CorrectionForm({
  kind,
  id,
  fields,
  options,
  onDone,
  onCancel,
}: {
  readonly kind: ReviewKind;
  readonly id: string;
  readonly fields: readonly { name: keyof Correction; label: string; value: string }[];
  readonly options?: readonly McqOption[];
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={styles.correction}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const corrections: Correction = {};

        for (const field of fields) {
          const raw = String(data.get(field.name) ?? '').trim();
          if (field.name === 'marks' || field.name === 'itemNumber') {
            corrections[field.name] = raw === '' ? null : Number(raw);
          } else {
            (corrections as Record<string, unknown>)[field.name] = raw === '' ? null : raw;
          }
        }

        if (options !== undefined) {
          const edited = options.map((option, index) => ({
            label: option.label,
            text: String(data.get(`option-${String(index)}`) ?? '').trim(),
          }));
          corrections.options = edited.length > 0 ? edited : null;
        }

        setBusy(true);
        setError(null);
        void submitReview(kind, id, 'correct', corrections)
          .then(onDone)
          .catch(() => {
            setError('Could not save that. Check the values and try again.');
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {fields.map((field) => (
        <Field
          key={String(field.name)}
          label={field.label}
          name={String(field.name)}
          defaultValue={field.value}
          type={field.name === 'marks' || field.name === 'itemNumber' ? 'number' : 'text'}
        />
      ))}

      {options?.map((option, index) => (
        <Field
          key={option.label + String(index)}
          label={`Option ${option.label.toUpperCase()}`}
          name={`option-${String(index)}`}
          defaultValue={option.text}
        />
      ))}

      <div className={styles.reviewActions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Saving…' : 'Save correction'}
        </button>
        <button type="button" className={styles.reviewButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error !== null && <p className={styles.error}>{error}</p>}
    </form>
  );
}

/**
 * A value, showing the machine's original whenever a person changed it.
 *
 * The struck-through original is the point (M5A.6 §6). Replacing it outright
 * would make a corrected record indistinguishable from one the parser got right
 * first time, and the difference between those two is exactly what makes this
 * corpus useful for evaluating the parser later.
 */
function Value({
  machine,
  reviewed,
  suffix = '',
}: {
  readonly machine: string | number | null;
  readonly reviewed: string | number | null | undefined;
  readonly suffix?: string;
}) {
  const changed = reviewed !== null && reviewed !== undefined && reviewed !== machine;
  // A plain text node, not a wrapper: an unchanged value is ordinary prose and
  // should read as one continuous string beside its label.
  if (!changed) return machine === null ? null : <>{`${String(machine)}${suffix}`}</>;
  return (
    <span className={styles.corrected}>
      {`${String(reviewed)}${suffix}`}
      <del className={styles.machineValue}>{machine === null ? 'blank' : String(machine)}</del>
    </span>
  );
}

/**
 * Who reached this conclusion, shown beside it.
 *
 * WHO REVIEWED IT IS PART OF WHAT THE REVIEW MEANS (M5A.7 §13). The M5A.6
 * corpus was adjudicated by an AI agent and stored under `agent-adjudication`;
 * that is diagnostic evidence, not human ground truth, and a reader who cannot
 * see the difference would take it for one.
 */
function ReviewedBy({ state, by }: { readonly state: string; readonly by: string | null }) {
  if (state === 'unreviewed' || by === null) return null;
  return (
    <span className={styles.reviewer}>{by === 'agent-adjudication' ? 'by agent' : `by ${by}`}</span>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The questions found in a document, and the controls to confirm them.
 *
 * Answers "what did GradTools actually find in my paper?" honestly, including
 * when the answer is "nothing".
 */
export function PaperPanel({ documentId }: { readonly documentId: string }) {
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  const paper = useAsync<{
    current: ExtractedPaper | null;
    history: ExtractedPaper[];
  }>(async () => {
    const body = (await fetchJson(SOURCE_ROUTES.documentPaper(documentId))) as {
      data: ExtractedPaper | null;
      history: ExtractedPaper[];
    };
    return { current: body.data, history: body.history };
  }, [documentId, reloadToken]);

  return (
    <AsyncSection
      state={paper.state}
      retry={paper.retry}
      label="questions"
      isEmpty={(value) => value.current === null}
      empty={
        <p className={styles.empty}>
          No question structure has been worked out for this document yet.
        </p>
      }
    >
      {/* `isEmpty` already sent null down the empty branch; this satisfies the type. */}
      {(value) =>
        value.current === null ? null : (
          <PaperDetail paper={value.current} history={value.history} onReviewed={reload} />
        )
      }
    </AsyncSection>
  );
}

function PaperDetail({
  paper,
  history,
  onReviewed,
}: {
  readonly paper: ExtractedPaper;
  readonly history: readonly ExtractedPaper[];
  readonly onReviewed: () => void;
}) {
  const unchecked = paper.reviewSummary.unreviewed;
  const isMcq = paper.paperFormat === 'mcq';

  return (
    <div className={styles.paper}>
      <dl className={styles.meta}>
        <div>
          <dt>Paper type</dt>
          <dd>{PAPER_FORMAT_LABEL[paper.paperFormat]}</dd>
        </div>
        <div>
          <dt>Read from</dt>
          {/*
            Provenance, in plain words. "Scanned pages" is not a hedge: it is
            the difference between the publisher's own text and our reading of
            an image, and it is the first thing that explains a wrong answer.
          */}
          <dd>
            {paper.extractionSource === 'native' ? "The document's own text" : 'Scanned pages'}
          </dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{isMcq ? paper.mcqItemCount : paper.questionCount}</dd>
        </div>
        <div>
          {/*
            "Checked", not "checked by a person": the reviewer's identity lives
            in the audit trail, and asserting who did the checking is a claim
            this field cannot make.
          */}
          <dt>Checked</dt>
          <dd>
            {paper.reviewSummary.total - unchecked} of {paper.reviewSummary.total}
          </dd>
        </div>
      </dl>

      <p className={styles.sectionCount}>
        Worked out automatically by {paper.parserVersion} (version {paper.extractionVersion}).
        Nothing here has been checked against the original unless it says so.
      </p>

      {/*
        Earlier runs are kept, and saying so is the point: a reviewer looking at
        v2 records needs to know v1 records exist beside them, still carrying
        their own review (M5A.7 §13).
      */}
      {history.length > 1 && (
        <p className={styles.sectionCount}>
          {history.length - 1} earlier run{history.length === 2 ? '' : 's'} kept for comparison:{' '}
          {history
            .filter((run) => run.id !== paper.id)
            .map((run) => run.parserVersion)
            .join(', ')}
          .
        </p>
      )}

      {paper.needsReview && paper.reviewReason !== null && (
        <p className={styles.review}>{paper.reviewReason}</p>
      )}

      {isMcq ? (
        <McqList paperId={paper.id} onReviewed={onReviewed} />
      ) : (
        <QuestionList paperId={paper.id} onReviewed={onReviewed} />
      )}
    </div>
  );
}

function QuestionList({
  paperId,
  onReviewed,
}: {
  readonly paperId: string;
  readonly onReviewed: () => void;
}) {
  const questions = useAsync<ExtractedQuestion[]>(async () => {
    const body = (await fetchJson(SOURCE_ROUTES.paperQuestions(paperId))) as {
      data: ExtractedQuestion[];
    };
    return body.data;
  }, [paperId]);

  return (
    <AsyncSection
      state={questions.state}
      retry={questions.retry}
      label="questions"
      isEmpty={(items) => items.length === 0}
      empty={<p className={styles.empty}>No questions could be worked out from this document.</p>}
    >
      {(items) => (
        <ol className={styles.questionList}>
          {items.map((question) => (
            <li key={question.id}>
              <QuestionRow
                question={question}
                onReviewed={() => {
                  questions.retry();
                  onReviewed();
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </AsyncSection>
  );
}

export function QuestionRow({
  question,
  onReviewed,
}: {
  readonly question: ExtractedQuestion;
  readonly onReviewed: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const confidence = CONFIDENCE_LABEL[question.confidence];
  const number = question.reviewed?.questionNumber ?? question.questionNumber;
  const text = question.reviewed?.text ?? question.text;

  const done = () => {
    setCorrecting(false);
    onReviewed();
  };

  return (
    <article className={styles.question} data-review={question.reviewState}>
      <div className={styles.questionHead}>
        <h4 className={styles.questionNumber}>
          {number === null || number === '?' ? 'Unnumbered' : `Q${number}`}
        </h4>
        <span className={styles.state} data-tone={confidence?.tone}>
          {confidence?.label}
        </span>
      </div>

      <p className={styles.questionText}>{text}</p>
      {/*
        A corrected TEXT cannot be struck through inline without becoming
        unreadable, so the machine's original is shown underneath instead. It is
        never hidden: a corrected record must stay distinguishable from one the
        parser got right (M5A.6 §6).
      */}
      {(question.reviewed?.text ?? question.text) !== question.text && (
        <p className={styles.machineText}>Machine read: {question.text}</p>
      )}

      <p className={styles.questionFacts}>
        {(question.reviewed?.module ?? question.module) !== null && (
          <span>
            Module <Value machine={question.module} reviewed={question.reviewed?.module} />
          </span>
        )}
        {(question.reviewed?.marks ?? question.marks) !== null && (
          <span>
            <Value machine={question.marks} reviewed={question.reviewed?.marks} suffix=" marks" />
          </span>
        )}
        {(question.reviewed?.bloomLevel ?? question.bloomLevel) !== null && (
          <span>
            <Value machine={question.bloomLevel} reviewed={question.reviewed?.bloomLevel} />
          </span>
        )}
        {(question.reviewed?.courseOutcome ?? question.courseOutcome) !== null && (
          <span>
            <Value machine={question.courseOutcome} reviewed={question.reviewed?.courseOutcome} />
          </span>
        )}
        <span>Page {question.pageNumber}</span>
        <span className={styles.reviewState}>
          {REVIEW_LABEL[question.reviewState] ?? question.reviewState}
        </span>
        <ReviewedBy state={question.reviewState} by={question.reviewedBy} />
      </p>

      {/* The badge above already says "Needs review"; this says what to do. */}
      {question.needsReview && (
        <p className={styles.review}>Compare this against the original before relying on it.</p>
      )}

      {question.subQuestions.length > 0 && (
        <ul className={styles.subList}>
          {question.subQuestions.map((sub) => (
            <li key={sub.id}>
              <SubQuestionRow sub={sub} onReviewed={onReviewed} />
            </li>
          ))}
        </ul>
      )}

      {correcting ? (
        <CorrectionForm
          kind="question"
          id={question.id}
          fields={[
            { name: 'questionNumber', label: 'Question number', value: number ?? '' },
            { name: 'text', label: 'Question text', value: text },
            {
              name: 'module',
              label: 'Module',
              value: question.reviewed?.module ?? question.module ?? '',
            },
            {
              name: 'marks',
              label: 'Marks',
              value: String(question.reviewed?.marks ?? question.marks ?? ''),
            },
            {
              name: 'bloomLevel',
              label: "Bloom's level",
              value: question.reviewed?.bloomLevel ?? question.bloomLevel ?? '',
            },
            {
              name: 'courseOutcome',
              label: 'Course outcome',
              value: question.reviewed?.courseOutcome ?? question.courseOutcome ?? '',
            },
          ]}
          onDone={done}
          onCancel={() => {
            setCorrecting(false);
          }}
        />
      ) : (
        <ReviewActions
          kind="question"
          id={question.id}
          state={question.reviewState}
          onReviewed={onReviewed}
          onCorrect={() => {
            setCorrecting(true);
          }}
        />
      )}
    </article>
  );
}

function SubQuestionRow({
  sub,
  onReviewed,
}: {
  readonly sub: ExtractedSubQuestion;
  readonly onReviewed: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const label = sub.reviewed?.label ?? sub.label;
  const text = sub.reviewed?.text ?? sub.text;

  return (
    <div className={styles.sub} data-review={sub.reviewState}>
      <div className={styles.subMain}>
        <span className={styles.subLabel}>{label ?? '·'}</span>
        <span className={styles.subText}>
          {text}
          {(sub.reviewed?.text ?? sub.text) !== sub.text && (
            <span className={styles.machineText}>Machine read: {sub.text}</span>
          )}
        </span>
        {(sub.reviewed?.marks ?? sub.marks) !== null && (
          <span className={styles.subMarks}>
            <Value machine={sub.marks} reviewed={sub.reviewed?.marks} suffix=" marks" />
          </span>
        )}
      </div>

      <p className={styles.questionFacts}>
        {(sub.reviewed?.bloomLevel ?? sub.bloomLevel) !== null && (
          <span>
            <Value machine={sub.bloomLevel} reviewed={sub.reviewed?.bloomLevel} />
          </span>
        )}
        {(sub.reviewed?.courseOutcome ?? sub.courseOutcome) !== null && (
          <span>
            <Value machine={sub.courseOutcome} reviewed={sub.reviewed?.courseOutcome} />
          </span>
        )}
        <span>Page {sub.pageNumber}</span>
        <span className={styles.reviewState}>
          {REVIEW_LABEL[sub.reviewState] ?? sub.reviewState}
        </span>
        <ReviewedBy state={sub.reviewState} by={sub.reviewedBy} />
      </p>

      {correcting ? (
        <CorrectionForm
          kind="sub-question"
          id={sub.id}
          fields={[
            { name: 'label', label: 'Part letter', value: label ?? '' },
            { name: 'text', label: 'Part text', value: text },
            {
              name: 'marks',
              label: 'Marks',
              value: String(sub.reviewed?.marks ?? sub.marks ?? ''),
            },
            {
              name: 'bloomLevel',
              label: "Bloom's level",
              value: sub.reviewed?.bloomLevel ?? sub.bloomLevel ?? '',
            },
            {
              name: 'courseOutcome',
              label: 'Course outcome',
              value: sub.reviewed?.courseOutcome ?? sub.courseOutcome ?? '',
            },
          ]}
          onDone={() => {
            setCorrecting(false);
            onReviewed();
          }}
          onCancel={() => {
            setCorrecting(false);
          }}
        />
      ) : (
        <ReviewActions
          kind="sub-question"
          id={sub.id}
          state={sub.reviewState}
          onReviewed={onReviewed}
          onCorrect={() => {
            setCorrecting(true);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MCQ                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * MCQ items.
 *
 * A SEPARATE shape, not questions with empty columns. There is no module, no
 * Bloom's level, no CO and no marks here, and none is offered for correction:
 * the format never contained them, and a blank field invites a reviewer to
 * invent one (M5A.6 §5).
 */
function McqList({
  paperId,
  onReviewed,
}: {
  readonly paperId: string;
  readonly onReviewed: () => void;
}) {
  const items = useAsync<ExtractedMcqItem[]>(async () => {
    const body = (await fetchJson(SOURCE_ROUTES.paperMcqItems(paperId))) as {
      data: ExtractedMcqItem[];
    };
    return body.data;
  }, [paperId]);

  return (
    <AsyncSection
      state={items.state}
      retry={items.retry}
      label="questions"
      isEmpty={(list) => list.length === 0}
      empty={<p className={styles.empty}>No items could be worked out from this document.</p>}
    >
      {(list) => (
        <ol className={styles.questionList}>
          {list.map((item) => (
            <li key={item.id}>
              <McqItemRow
                item={item}
                onReviewed={() => {
                  items.retry();
                  onReviewed();
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </AsyncSection>
  );
}

export function McqItemRow({
  item,
  onReviewed,
}: {
  readonly item: ExtractedMcqItem;
  readonly onReviewed: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const confidence = CONFIDENCE_LABEL[item.confidence];
  const number = item.reviewed?.itemNumber ?? item.itemNumber;
  const text = item.reviewed?.text ?? item.text;
  const options = item.reviewed?.options ?? item.options;

  return (
    <article className={styles.question} data-review={item.reviewState}>
      <div className={styles.questionHead}>
        <h4 className={styles.questionNumber}>
          {number === null ? 'Unnumbered' : `Item ${String(number)}`}
        </h4>
        <span className={styles.state} data-tone={confidence?.tone}>
          {confidence?.label}
        </span>
      </div>

      <p className={styles.questionText}>{text}</p>
      {(item.reviewed?.text ?? item.text) !== item.text && (
        <p className={styles.machineText}>Machine read: {item.text}</p>
      )}

      {options.length > 0 && (
        <ul className={styles.subList}>
          {options.map((option, index) => (
            <li key={option.label + String(index)}>
              <div className={styles.subMain}>
                <span className={styles.subLabel}>{option.label}</span>
                <span className={styles.subText}>{option.text}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.questionFacts}>
        <span>Page {item.pageNumber}</span>
        <span className={styles.reviewState}>
          {REVIEW_LABEL[item.reviewState] ?? item.reviewState}
        </span>
        <ReviewedBy state={item.reviewState} by={item.reviewedBy} />
      </p>

      {item.needsReview && (
        <p className={styles.review}>Compare this against the original before relying on it.</p>
      )}

      {correcting ? (
        <CorrectionForm
          kind="mcq-item"
          id={item.id}
          fields={[
            { name: 'itemNumber', label: 'Item number', value: String(number ?? '') },
            { name: 'text', label: 'Question text', value: text },
          ]}
          options={options}
          onDone={() => {
            setCorrecting(false);
            onReviewed();
          }}
          onCancel={() => {
            setCorrecting(false);
          }}
        />
      ) : (
        <ReviewActions
          kind="mcq-item"
          id={item.id}
          state={item.reviewState}
          onReviewed={onReviewed}
          onCorrect={() => {
            setCorrecting(true);
          }}
        />
      )}
    </article>
  );
}
