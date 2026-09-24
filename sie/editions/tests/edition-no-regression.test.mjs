/**
 * A bigger edition may not handle core vocabulary worse than Free.
 *
 * The whole behaviour corpus (built from the CORE catalog — every message is
 * something Free was designed for) runs through Free and through each larger
 * edition exactly as the bridge runs them. Gate:
 *   - no message Free answered correctly is lost (regressed_lost_correct)
 *   - no more stand-offs than Free (ambiguous count)
 *   - no more hand-offs than Free (tickets)
 *   - no change of interpretation (a pack is data; it cannot change what
 *     KIND of message this is)
 * Found the Pro single-word stand-off problem (94 new stand-offs, 161 extra
 * tickets) that the signature audit alone could not see.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotEdition, summarize } from '../../../bench/edition-compare.mjs';
import { diffSnapshots } from '../../../bench/behavior-snapshot.mjs';
import { buildBehaviorCorpus } from '../../../bench/corpora/behavior.mjs';
import { readCore, readBaseGlossary } from './helpers/node-editions.js';

const messages = buildBehaviorCorpus({ catalog: readCore(), glossary: readBaseGlossary() });
const freeRows = await snapshotEdition('free', messages);
const free = summarize(freeRows);

for (const edition of ['pro', 'max']) {
    test(`${edition} handles core vocabulary at least as well as Free`, async () => {
        const rows = await snapshotEdition(edition, messages);
        const s = summarize(rows);
        const d = diffSnapshots(freeRows, rows);
        const show = (cat) => d.changed.filter((c) => c.category === cat).slice(0, 5)
            .map((c) => `${messages.find((m) => m.id === c.id).text} → ${c.after.scenarioId}`).join('\n');
        assert.equal(d.counts.regressed_lost_correct || 0, 0, `lost correct answers:\n${show('regressed_lost_correct')}`);
        assert.equal(d.counts.interpretation_changed || 0, 0, `interpretation changed:\n${show('interpretation_changed')}`);
        assert.ok(s.ambiguous <= free.ambiguous, `${edition} ambiguous ${s.ambiguous} > Free ${free.ambiguous}:\n${show('ambiguity_introduced')}`);
        assert.ok(s.tickets <= free.tickets, `${edition} tickets ${s.tickets} > Free ${free.tickets}`);
        assert.ok(s.targetedCorrect >= free.targetedCorrect, `${edition} targeted-correct ${s.targetedCorrect} < Free ${free.targetedCorrect}`);
    });
}
