/**
 * run-all.mjs — every benchmark, in order. `npm run bench`.
 *
 * Run with --expose-gc for the memory figures:
 *     node --expose-gc bench/run-all.mjs
 */
const BENCHMARKS = ['./retrieval-bench.mjs'];

for (const bench of BENCHMARKS) {
    console.log(`\n${'='.repeat(84)}\n${bench}\n${'='.repeat(84)}`);
    await import(bench);
}
