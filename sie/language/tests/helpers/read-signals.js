/**
 * read-signals.js — test-only: one message through Layer 1 exactly as the
 * bridge runs it (normalize, then signals on what normalize kept), with the
 * real shipped glossary and Arabizi map.
 */
import { normalize } from '../../normalizer.js';
import { analyzeSignals } from '../../signals.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from './node-providers.js';

const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

export async function readMessage(text, { previousText = '', maxInputChars, typoTolerance } = {}) {
    const n = await normalize(text, { ...providers, ...(maxInputChars ? { maxInputChars } : {}), ...(typoTolerance !== undefined ? { typoTolerance } : {}) });
    const signals = analyzeSignals({
        text: n.rawText, tokens: n.normalizedTokens, previousText,
        truncated: n.truncated, receivedChars: n.receivedChars
    });
    return { ...n, signals };
}

export { providers };
