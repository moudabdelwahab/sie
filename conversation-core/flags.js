/**
 * flags.js — أعلام الانتقال لـ Conversation Core.
 *
 * Stored in sie_settings (064 inserts them as false). Old path + new path +
 * flag: a channel goes through Core only when its flag is literally `true`.
 * A missing row, a failed read or any other value means "old path".
 */

export const CORE_FLAG_KEYS = Object.freeze({
    coreIngestWebsite: 'core_ingest_website',
    coreIngestTelegram: 'core_ingest_telegram',
    agentRuntimeEnabled: 'agent_runtime_enabled'
});

/**
 * @param {Array<{key: string, value: *}>|null|undefined} rows - sie_settings rows
 * @returns {Readonly<{coreIngestWebsite: boolean, coreIngestTelegram: boolean, agentRuntimeEnabled: boolean}>}
 */
export function readCoreFlags(rows) {
    const byKey = new Map((Array.isArray(rows) ? rows : []).map((r) => [r?.key, r?.value]));
    return Object.freeze(Object.fromEntries(
        Object.entries(CORE_FLAG_KEYS).map(([name, key]) => [name, byKey.get(key) === true])
    ));
}

/**
 * @param {ReturnType<typeof readCoreFlags>} flags
 * @param {string} channel
 * @returns {boolean}
 */
export function isChannelOnCore(flags, channel) {
    if (channel === 'website') return flags?.coreIngestWebsite === true;
    if (channel === 'telegram') return flags?.coreIngestTelegram === true;
    return false;
}
