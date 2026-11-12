# Arabic precautionary routing — audit #22

## What is implemented

`src/lib/services/agent-service.ts` normalizes Arabic spelling, diacritics and
tatweel before applying lexical emergency rules. It is **not a clinically
validated diagnostic or triage model**. Optional LLM integration generates text;
the application invokes booking tools programmatically, not through model tool
calls. An emergency-rule match returns before directory lookup, appointment
actions or model requests.

The booking assistant's welcome message and emergency panel explicitly describe
precautionary rules and distinguish them from medical diagnosis. The local
capabilities response does the same, and its unmatched-message fallback warns
that the absence of an alert does not establish that symptoms are safe.

This fix covers chest-pain prepositions and possessive forms, colloquial breathing
distress, spelling/diacritic variants, third-person loss of consciousness and
severe bleeding. Examples include `عندي الم على الصدر`, `وجع على الصدر`,
`مش قادر أتنفّس`, `أمي فقدت الوعي فجأة` and `نزيف شديد وما عم يوقف`.

## Reproducible evaluation

Run:

```powershell
npx vitest run tests/unit/agent-triage-accuracy.test.ts --reporter=verbose --silent=false
npx playwright test tests/e2e/agent.spec.ts
```

The unit test calls the exported `processAgentMessage()` interface. Its fixed,
hand-labelled **synthetic** corpus contains 70 examples: 40 emergency-language
examples and 30 benign, non-emergency or specialty-navigation examples. Labels
are engineering expectations, not clinician-reviewed diagnoses or an independent
validation dataset. The clock and local data are fixed, and live model
credentials are disabled for these tests.

| Measure                          | Observed result on this corpus |
| -------------------------------- | ------------------------------ |
| True positives / false negatives | 40 / 0                         |
| True negatives / false positives | 25 / 5                         |
| Recall                           | 100%                           |
| Precision                        | 88.89%                         |
| F1                               | 94.12%                         |

The test enforces the audit's synthetic recall floor of 90% and prevents the
known false-positive count from increasing beyond five. It would reject an
implementation that labelled every message an emergency.

Additional tests verify that an emergency message makes no cloud request even
when a model and database are configured, and cannot cancel an owned appointment
mentioned in that same message. A real-browser test checks the explanatory copy,
the local capabilities response, the missed chest-pain phrase and continued
booking-dialog behavior.

## Closure verification — 2026-11-12

The audit #22 source changes were also verified in an isolated local snapshot
based on `baf8a76`, without the pending audit #19 rendering changes. The complete
unit suite and TypeScript check passed again in the original working tree.

| Check                                         | Result                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| `npm run test:unit`                           | 238/238 tests across 17 files, including 16 audit #22 tests |
| `npx playwright test tests/e2e/agent.spec.ts` | 2/2 browser tests                                           |
| `npx tsc --noEmit --incremental false`        | Pass                                                        |
| Prettier check on the five audit #22 files    | Pass on the staged LF source                                |

Tool versions: Node **22.23.2**, Next.js **15.5.29**, Vitest **5.1.0**,
Playwright **1.64.0**, TypeScript **5.9.3**, Prettier **3.9.10**.
The Windows validation checkout used LF for the formatting check; the
repository's Git configuration was not changed.
The document was checked with `--ignore-path .gitignore`, because the normal
Prettier ignore file excludes `docs/`.

The local-capabilities and unmatched-symptom tests were observed failing on the
old, overconfident replies before the wording was corrected, then passing.
No live model calls, remote migrations or production deployment were performed.

## Limitations — not production clinical approval

The five false alarms are corpus IDs **B10, N07, N08, N09 and N10**: metaphorical,
negated, informational or historical references to emergency terms. Rules do not
reliably distinguish those contexts. These limitations are recorded rather than
hidden by changing the labels or removing difficult examples.

Perfect recall on forty synthetic examples does not establish clinical
sensitivity, safety, performance on unseen dialects or suitability for real
patient decisions. A clinician-reviewed representative dataset and clinical
governance review remain necessary. The response is precautionary guidance to
seek emergency help for current concerning symptoms, never a diagnosis or an
assurance that an unmatched message is safe.

Broader corrections to historical academic-report claims remain part of audit
#23; this document is the current implementation and evaluation record for #22.
