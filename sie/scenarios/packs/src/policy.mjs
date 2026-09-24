/**
 * policy.mjs — vocabulary policy shared by the rebalancer and the audit.
 *
 * GENERIC WORDS
 * Pack-only tokens whose patterns are everyday words («اوقف» stop,
 * «موقوف» suspended, «كتبته» I wrote it, «مقفولة» closed). Alone, such a
 * word does not name a case: «اوقف» answered "turn off two-step
 * verification" and «موقوف» answered "API key states" — to a customer who
 * may have meant anything. Found by listing every bare pack word that
 * ANSWERS on its own (≈150; these are the ones that are not product terms).
 *
 * A generic word may lead only WEAKLY — at most GENERIC_MAX_CONFIDENCE, a
 * clarifying question, never an answer — and only in one scenario; in every
 * other it is inactive (the atom rule). Combined with the rest of its
 * signature it still decides. The rebalancer enforces the cap
 * (scripts/pack-rebalance.mjs); the audit checks the outcome
 * (edition-audit generic_word_answers).
 *
 * @no-legitimate-corpus
 */
export const GENERIC_MAX_CONFIDENCE = 0.34;

export const GENERIC_WORDS = Object.freeze({
    pro: Object.freeze([
        'entity_closed_state', 'entity_turn_off', 'entity_colleague', 'entity_my_name', 'entity_early_timing',
        'entity_coming_soon', 'entity_useful_vote', 'intent_thank_agent', 'entity_ticket_draft_lost',
        'entity_attach_in_reply', 'entity_reply_unclear', 'entity_not_started', 'entity_operator_scope',
        'entity_key_state', 'intent_hide_ticket', 'entity_how_will_i_know', 'entity_post_topic',
        'entity_ticket_counter', 'entity_linked_word',
        'entity_traditional_mode', 'entity_sample_data', 'entity_reset_link'
    ]),
    max: Object.freeze([])
});
