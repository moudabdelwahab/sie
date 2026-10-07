/**
 * invariants.test.mjs — properties that hold on EVERY turn, not just the
 * turns a golden conversation happens to assert on.
 * ------------------------------------------------------------
 * Every golden conversation is replayed under each of its profiles, and
 * after every turn three invariants are checked against what really
 * happened in the (recording) database:
 *
 *   INV-TICKET  [G-L5-1][G-L6-2]  The session never claims a ticket that
 *               does not exist. `ticketAlreadyCreated`, `ticket.state =
 *               created` and the "your ticket is still open" reply require a
 *               ticket created in this chat; `ticket.state = existing`
 *               requires an open ticket on the account.
 *   INV-STAMP   [G-L8-2]  Every state the turn persists carries
 *               `sie.lastTurnAt`, stamped with the turn's clock — on every
 *               route, not only the diagnostic one.
 *   INV-EFFECT  [G-L8-5]  The executed effect equals the decided one: a
 *               ticket decision either created the ticket in that turn, or
 *               the persisted ticket state records why it did not
 *               (proposed, declined, withheld, unavailable, existing); and a
 *               ticket is never created by a turn that did not decide one.
 *
 * Violations that exist today are PINNED, exactly like a red golden run: the
 * test fails if the set changes in either direction. A fix shrinks the pin in
 * the same change; WP4 ends with every pin empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGoldens, TEXT } from './helpers/golden-runner.mjs';
import { makeWorld, converse, loadSettingsProfile } from './helpers/runtime-world.mjs';

const TICKET_ACTIONS = new Set(['CREATE_TICKET', 'ESCALATE_TO_HUMAN']);
const NOT_CREATED_STATES = new Set(['proposed', 'declined', 'withheld', 'unavailable', 'existing']);

/**
 * Violations found today, by invariant, as `<golden>[<profile>] <chat>#<turn>`
 * (fixtures/invariant-violations.json). The file is only ever edited by hand,
 * or regenerated with INVARIANTS_WRITE_PIN=1 — and its diff is the record of
 * what a change fixed (or broke).
 */
const PIN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'invariant-violations.json');
const PINNED = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')).violations;

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Replays one golden under one profile and returns its invariant violations. */
async function violations(golden, profile) {
    const settings = golden.settingsOverrides ? { ...loadSettingsProfile(profile), ...golden.settingsOverrides } : null;
    const world = makeWorld({ profile, ...(settings ? { settings } : {}), ...(golden.world || {}) });
    const found = { 'INV-TICKET': [], 'INV-STAMP': [], 'INV-EFFECT': [] };
    for (const chat of golden.chats) {
        if (chat.advanceMinutesBefore) world.advance(chat.advanceMinutesBefore);
        for (const [i, { expect: _expect, ...msg }] of chat.turns.entries()) {
            const before = { persisted: world.persisted.length, tickets: world.ticketsCreated.length };
            const [rec] = await converse(world, chat.chat, [msg]);
            const at = `${golden.id}[${profile}] ${chat.chat}#${i + 1}`;
            const sie = rec.state?.sie;
            const ticketsHere = world.ticketsCreated.filter((t) => t.p_session_id === chat.chat).length;
            const ticketState = get(sie, 'decisionState.ticket.state');

            // INV-TICKET
            const claimsCreated = sie?.decisionState?.ticketAlreadyCreated === true || ticketState === 'created';
            const claimsOpen = rec.reply?.includes(TEXT.TICKET_STILL_OPEN);
            if ((claimsCreated && ticketsHere === 0) ||
                (ticketState === 'existing' && world.openTickets.length === 0) ||
                (claimsOpen && ticketsHere === 0 && world.openTickets.length === 0)) {
                found['INV-TICKET'].push(at);
            }

            // INV-STAMP — every state written this turn (persist_bot_turn and
            // the ticket RPC's bot_state) carries this turn's lastTurnAt.
            const written = [...world.persisted.slice(before.persisted), ...world.ticketsCreated.slice(before.tickets)];
            const stamp = new Date(world.now).toISOString();
            if (written.some((w) => w.p_bot_state?.sie?.lastTurnAt !== stamp)) found['INV-STAMP'].push(at);

            // INV-EFFECT
            const action = rec.trace?.decision?.action;
            if (TICKET_ACTIONS.has(action) && rec.ticketsOpened === 0 && !NOT_CREATED_STATES.has(ticketState)) {
                found['INV-EFFECT'].push(at);
            } else if (rec.ticketsOpened > 0 && rec.trace && !TICKET_ACTIONS.has(action) && action !== undefined) {
                // A ticket created on a turn whose recorded decision was not a
                // ticket (the yes to a proposal records the executed ticket).
                found['INV-EFFECT'].push(`${at} (created under ${action})`);
            }
        }
    }
    return found;
}

const all = { 'INV-TICKET': [], 'INV-STAMP': [], 'INV-EFFECT': [] };
const ready = (async () => {
    for (const g of loadGoldens()) {
        for (const run of g.runs) {
            const v = await violations(g, run.profile);
            for (const k of Object.keys(all)) all[k].push(...v[k]);
        }
    }
    for (const k of Object.keys(all)) all[k].sort();
    if (process.env.INVARIANTS_WRITE_PIN === '1') {
        const doc = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
        fs.writeFileSync(PIN_FILE, JSON.stringify({ ...doc, violations: all }, null, 2) + '\n');
    }
})();

test('[pending:G-L5-1][pending:G-L6-2] INV-TICKET: a ticket is claimed only when one exists (pinned violations)', async () => {
    await ready;
    assert.deepEqual(all['INV-TICKET'], PINNED['INV-TICKET']);
});

test('[pending:G-L8-2] INV-STAMP: every persisted state carries this turn\'s lastTurnAt (pinned violations)', async () => {
    await ready;
    assert.deepEqual(all['INV-STAMP'], PINNED['INV-STAMP']);
});

test('[pending:G-L8-5] INV-EFFECT: the executed effect equals the decided effect (pinned violations)', async () => {
    await ready;
    assert.deepEqual(all['INV-EFFECT'], PINNED['INV-EFFECT']);
});
