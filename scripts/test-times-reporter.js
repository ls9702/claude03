// node:test reporter used by scripts/run-tests.js: sums the durations of the top-level tests per test file and
// writes them as JSON ({"<absolute file>": ms}) to its destination. The runner keeps the numbers in
// node_modules/.cache/ to balance the next run's shards. Not meant to be used on its own.
export default async function* testTimes(source) {
  const times = {};
  for await (const ev of source) {
    if ((ev.type === 'test:pass' || ev.type === 'test:fail') && ev.data.nesting === 0 && ev.data.file) {
      times[ev.data.file] = (times[ev.data.file] ?? 0) + (ev.data.details?.duration_ms ?? 0);
    }
  }
  yield JSON.stringify(times);
}
