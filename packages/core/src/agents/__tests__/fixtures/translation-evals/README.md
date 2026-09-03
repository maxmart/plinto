# Recorded translation transcripts

Empty on purpose. The eval suite in `../../translation-evals.test.ts` replays
recorded model transcripts from here; none have been committed yet, so those
cases skip. To record them, run the suite with `ANTHROPIC_API_KEY` set: the
recording driver writes one `<scenario>.json` per case, keyed to the exact
prompts, and refuses to replay against prompts that have since changed.
