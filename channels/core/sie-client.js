/**
 * sie-client.js
 * ------------------------------------------------------------
 * النقطة الوحيدة اللي أي قناة بتكلّم SIE من خلالها.
 *
 * ------------------------------------------------------------
 * WHY A CLIENT AND NOT A DIRECT CALL
 *
 * Every adapter could import sie-runtime.js itself. Then five adapters
 * would each grow their own idea of how to build a session, what to do
 * with a null reply, and how to map a turn onto the engine's arguments —
 * and they would drift. One client means "how a channel runs a turn" is
 * defined once.
 *
 * It also keeps the promise this layer is built on: SIE learns nothing
 * about channels. The engine's contract is unchanged — text, sessionId,
 * userId, botState in; reply, options, botState out. The channel-specific
 * work of turning a Telegram chat into a Mad3oom session happens on this
 * side of the seam, never inside the engine.
 *
 * ------------------------------------------------------------
 * TWO TRANSPORTS, ONE CONTRACT
 *
 * `inProcess`  imports sie-runtime.js and calls getSieReply() directly.
 *              This is the default and the recommended one: it is what
 *              the architecture already mandates between Mad3oom and SIE
 *              ("no HTTP layer between them"), and a webhook that already
 *              runs server-side gains nothing by adding a network hop to
 *              itself.
 *
 * `http`       POSTs to sie-api's /v1/chat/reply. Provided for a
 *              deployment where the channel runs somewhere the engine
 *              does not.
 *
 *              ⚠️ As of this writing that endpoint returns 501
 *              not_implemented (verified against the live function, see
 *              handlers/chat-reply.ts). This transport is therefore
 *              written and tested against the contract but cannot carry
 *              real traffic until that handler is built. Do not select it
 *              expecting it to work today.
 *
 * ------------------------------------------------------------
 * STREAMING (requirement 12)
 *
 * SIE does not stream. getSieReply() is a single await that returns a
 * complete reply, because the pipeline's last stage writes the message
 * and the ticket in one transaction — there is no partial state to emit.
 * So this is plain request/response, which is also what Telegram wants:
 * its Bot API has no streaming send, and editMessageText polling would be
 * a worse experience than one complete answer. If the engine ever grows
 * a streaming path, it belongs behind this same reply() signature.
 */
import { CHANNELS } from './channel-message.js';

/**
 * @typedef {Object} SieClient
 * @property {(params: {message: Object, identity: Object}) => Promise<Object|null>} reply
 */

/**
 * The in-process transport.
 *
 * @param {Object} params
 * @param {Object} params.supabase - a Supabase client; see the session note below
 * @param {Object} params.sessions - the channel session store
 * @param {Function} [params.getSieReply] - injectable for tests; defaults to the real runtime
 * @param {Object} [params.logger]
 * @returns {SieClient}
 */
export function createInProcessSieClient({ supabase, sessions, getSieReply, logger = null }) {
    return {
        async reply({ message, identity }) {
            const session = await sessions.getOrCreate({
                userId: identity.userId,
                channel: message.channel,
                channelChatId: message.channelChatId
            });

            const runTurn = getSieReply ?? (await loadRuntime());

            const result = await runTurn({
                text: message.text,
                supabase,
                sessionId: session.sessionId,
                userId: identity.userId,
                botState: session.botState
            });

            if (!result) return null;

            // The engine hands back the full bot_state blob; persisting it is
            // the channel's job because the engine's Action Layer only wrote
            // it for the session it was given.
            await sessions.saveState(session.sessionId, result.botState);

            logger?.info('SIE answered', {
                channel: message.channel,
                session: session.sessionId,
                ticket: result.ticketNumber ?? null
            });

            return {
                text: result.reply,
                options: result.options ?? [],
                ticketNumber: result.ticketNumber ?? null
            };
        }
    };
}

/**
 * Loaded lazily so importing this module in a test does not drag in the
 * whole engine, and so a channel that only ever uses the HTTP transport
 * never pays for the engine's import cost.
 */
async function loadRuntime() {
    const runtime = await import('../../sie-integration/sie-runtime.js');
    return runtime.getSieReply;
}

/**
 * The HTTP transport. See the 501 warning in this file's header before
 * selecting it.
 *
 * @param {Object} params
 * @param {string} params.baseUrl - e.g. https://<ref>.supabase.co/functions/v1/sie-api
 * @param {() => Promise<string>} params.getAuthToken - a JWT for the acting user
 * @param {Object} params.sessions
 * @param {Function} [params.fetchImpl]
 * @param {Object} [params.logger]
 * @returns {SieClient}
 */
export function createHttpSieClient({ baseUrl, getAuthToken, sessions, fetchImpl = fetch, logger = null }) {
    return {
        async reply({ message, identity }) {
            const session = await sessions.getOrCreate({
                userId: identity.userId,
                channel: message.channel,
                channelChatId: message.channelChatId
            });

            const token = await getAuthToken();
            const response = await fetchImpl(`${baseUrl}/v1/chat/reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    text: message.text,
                    sessionId: session.sessionId,
                    userId: identity.userId,
                    botState: session.botState
                })
            });

            if (response.status === 501) {
                throw new Error('sie-api /v1/chat/reply is not implemented yet');
            }
            if (!response.ok) {
                throw new Error(`sie-api returned ${response.status}`);
            }

            const body = await response.json();
            if (!body || body.handled === false) return null;

            await sessions.saveState(session.sessionId, body.botState);
            logger?.info('SIE answered over HTTP', { channel: message.channel, session: session.sessionId });

            return {
                text: body.reply,
                options: body.options ?? [],
                ticketNumber: body.ticketNumber ?? null
            };
        }
    };
}

/**
 * Picks a transport by name so a deployment chooses with an environment
 * variable rather than a code change.
 *
 * @param {string} kind - 'in-process' | 'http'
 * @param {Object} params
 * @returns {SieClient}
 */
export function createSieClient(kind, params) {
    if (kind === 'http') return createHttpSieClient(params);
    if (kind === 'in-process' || !kind) return createInProcessSieClient(params);
    throw new Error(`unknown SIE transport: ${kind}`);
}

/** Re-exported so adapters never import two modules to get the basics. */
export { CHANNELS };
