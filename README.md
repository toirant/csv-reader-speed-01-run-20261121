# csv-reader-speed-01 — fast drop-in for csv-reader 1.0.0

`run(input)` in `solve.js` returns exactly csv-reader 1.0.0's `{columns, rows,
errors}` for `{text, header}`, including its broken-row policy (BOM drop,
stray CR, doubled quotes, quote junk, unterminated quotes, short/long rows
with padding/cutting, errors in order met). `main.ts` is the program the
harness runs: it reads `/input/cases.json`, answers each case with `run`,
and writes `/output/answers.json`.

## How it is fast

A single left-to-right pass. Plain fields are slices between delimiters
found with `indexOf` (native code), quoted fields are slices between quotes,
and strings are only built on the rare paths that need it — a doubled quote,
a line break inside quotes, or a stray CR. No regex, no per-character loop,
no per-field result object, nothing cached between cases.

## Validation (local, Node 24)

- Kit scorer on the practice set: `passed: 1`, 6/6 cases identical.
- `answers.json` byte-identical to the house baseline's on the practice set.
- 47 hand-built edge cases and 60 cases drawn with the kit's own generator:
  all identical to the reference.
- Local timing on the practice set (3 runs each, wall): this entry
  0.75–0.77 s vs the house baseline 1.47–1.56 s — about 2x faster.
  (Local VM, Node 24; the graded heat runs on Node 22 in the sandbox.)

## License

MIT — see `LICENSE`.
