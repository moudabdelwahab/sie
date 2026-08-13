/**
 * sie-api-keys.js — مفاتيح الـAPI العام
 * ============================================================
 * الطبقة اللي بين أي واجهة (لوحة الأدمن، الدالة الطرفية) وبين دوال
 * قاعدة البيانات بتاعة المفاتيح. زي sie-entitlement.js بالظبط: الملف ده
 * مابياخدش قرار صلاحية، بينادي على الدالة اللي بتاخده.
 *
 * ── القاعدة الوحيدة اللي ماتتكسرش ────────────────────────────
 * القيمة الخام للمفتاح بتظهر في مكان واحد بس: نتيجة `createApiKey()` /
 * `rotateApiKey()`، وبتتسلّم للي طلبها فورًا. مفيش دالة هنا بتسجّلها،
 * ومفيش دالة بتخزّنها، ومفيش دالة بترجّعها تاني بعد كده — لأن قاعدة
 * البيانات نفسها مش شايفاها أصلاً، شايفة الهاش بس.
 *
 * ── ليه sha256 في العميل مش في السيرفر ───────────────────────
 * التحقق بياخد الهاش مش المفتاح: كده القيمة الخام عمرها ما بتوصل لسجلات
 * قاعدة البيانات ولا لخطة استعلام ولا لأي أثر تشخيصي. الهاش بيتحسب
 * بـWeb Crypto اللي موجود في Deno وNode والمتصفح، فنفس الكود بيشتغل في
 * التلاتة من غير أي اعتماد إضافي.
 */

/** صيغة المفتاح: sie_<env>_<43 حرف base64url>. */
export const API_KEY_PATTERN = /^sie_(live|test)_[A-Za-z0-9_-]{43}$/;

/** أول ١٦ حرف — القدر اللي بيتكتب في السجلات ويتعرض في اللوحة. */
export const API_KEY_PREFIX_LENGTH = 16;

/**
 * sha256 للمفتاح، hex.
 *
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function hashApiKey(apiKey) {
    const bytes = new TextEncoder().encode(String(apiKey));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * شكل المفتاح صح؟ فحص رخيص قبل أي نداء على قاعدة البيانات.
 *
 * الرفض هنا مابيقولش «المفتاح ده مش موجود» — بيقول «ده مش مفتاح أصلاً»،
 * وده الفرق اللي بيمنع إن الـAPI يبقى أداة تخمين.
 *
 * @param {string} apiKey
 * @returns {boolean}
 */
export const looksLikeApiKey = (apiKey) => API_KEY_PATTERN.test(String(apiKey ?? ''));

/** البادئة اللي تتكتب في السجل. آمنة — مش سر. */
export const apiKeyPrefix = (apiKey) => String(apiKey ?? '').slice(0, API_KEY_PREFIX_LENGTH);

/**
 * ينشئ مفتاح جديد. القيمة الكاملة بترجع هنا **مرة واحدة**.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{userId: string, name: string, environment?: 'live'|'test', expiresAt?: string|null}} params
 * @returns {Promise<{success: boolean, key: Object|null, error: string|null}>}
 */
export async function createApiKey(supabase, { userId, name, environment = 'live', expiresAt = null }) {
    try {
        const { data, error } = await supabase.rpc('sie_api_key_create', {
            p_user_id: userId,
            p_name: name,
            p_environment: environment,
            p_expires_at: expiresAt
        });
        if (error) return { success: false, key: null, error: error.message };

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { success: false, key: null, error: 'no row returned' };

        return { success: true, error: null, key: normalizeCreated(row) };
    } catch (err) {
        return { success: false, key: null, error: String(err?.message || err) };
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null} [userId] - null = كل اللي المتصل مسموح له يشوفه
 * @returns {Promise<Array<Object>>}
 */
export async function listApiKeys(supabase, userId = null) {
    try {
        const { data, error } = await supabase.rpc('sie_api_key_list', { p_user_id: userId });
        if (error) {
            console.warn('[sie] api key list failed:', error.message);
            return [];
        }
        return (data || []).map(normalizeListed);
    } catch (err) {
        console.warn('[sie] api key list threw:', err?.message || err);
        return [];
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} keyId
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function revokeApiKey(supabase, keyId) {
    try {
        const { error } = await supabase.rpc('sie_api_key_revoke', { p_key_id: keyId });
        return { success: !error, error: error ? error.message : null };
    } catch (err) {
        return { success: false, error: String(err?.message || err) };
    }
}

/**
 * تدوير: مفتاح جديد بنفس الاسم والبيئة، والقديم بيتلغي — في معاملة واحدة
 * جوه قاعدة البيانات، فمفيش لحظة التكامل فيها من غير مفتاح شغّال.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} keyId
 * @returns {Promise<{success: boolean, key: Object|null, error: string|null}>}
 */
export async function rotateApiKey(supabase, keyId) {
    try {
        const { data, error } = await supabase.rpc('sie_api_key_rotate', { p_key_id: keyId });
        if (error) return { success: false, key: null, error: error.message };

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { success: false, key: null, error: 'no row returned' };

        return { success: true, error: null, key: normalizeCreated(row) };
    } catch (err) {
        return { success: false, key: null, error: String(err?.message || err) };
    }
}

/**
 * أرقام الاستخدام من سجل الطلبات نفسه.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{userId?: string|null, since?: string|null}} [params]
 * @returns {Promise<{totalRequests: number, okRequests: number, errorRequests: number,
 *                    rateLimited: number, lastRequestAt: string|null, activeKeys: number}|null>}
 */
export async function getApiUsageSummary(supabase, { userId = null, since = null } = {}) {
    try {
        const { data, error } = await supabase.rpc('sie_api_usage_summary', {
            p_user_id: userId,
            p_since: since
        });
        if (error) {
            console.warn('[sie] api usage summary failed:', error.message);
            return null;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;
        return {
            totalRequests: Number(row.total_requests ?? 0),
            okRequests: Number(row.ok_requests ?? 0),
            errorRequests: Number(row.error_requests ?? 0),
            rateLimited: Number(row.rate_limited ?? 0),
            lastRequestAt: row.last_request_at ?? null,
            activeKeys: Number(row.active_keys ?? 0)
        };
    } catch (err) {
        console.warn('[sie] api usage summary threw:', err?.message || err);
        return null;
    }
}

/**
 * يحوّل مفتاح جه في هيدر لهوية عميل.
 *
 * ⚠️ محتاج عميل بـservice_role — الدالة في قاعدة البيانات بترفض أي دور
 * تاني. الدالة الطرفية هي المتصل الوحيد المفروض.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service role
 * @param {string} apiKey
 * @returns {Promise<{valid: boolean, userId: string|null, keyId: string|null,
 *                    environment: string|null, prefix: string, reason: string|null}>}
 */
export async function verifyApiKey(supabase, apiKey) {
    const prefix = apiKeyPrefix(apiKey);

    if (!looksLikeApiKey(apiKey)) {
        return { valid: false, userId: null, keyId: null, environment: null, prefix, reason: 'malformed' };
    }

    try {
        const { data, error } = await supabase.rpc('sie_api_key_verify', {
            p_key_hash: await hashApiKey(apiKey)
        });
        if (error) {
            // الرسالة نفسها مابتتبعتش للعميل: الرد بيبقى invalid_api_key
            // مهما كان السبب الداخلي.
            console.error('[sie] api key verify failed:', error.message);
            return { valid: false, userId: null, keyId: null, environment: null, prefix, reason: 'verify_failed' };
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || row.reason) {
            return {
                valid: false,
                userId: null,
                keyId: row?.key_id ?? null,
                environment: row?.environment ?? null,
                prefix,
                reason: row?.reason ?? 'invalid'
            };
        }

        return {
            valid: true,
            userId: row.user_id,
            keyId: row.key_id,
            environment: row.environment,
            prefix: row.key_prefix ?? prefix,
            reason: null
        };
    } catch (err) {
        console.error('[sie] api key verify threw:', err?.message || err);
        return { valid: false, userId: null, keyId: null, environment: null, prefix, reason: 'verify_failed' };
    }
}

/**
 * يسجّل طلب API. بيبلع أي فشل: سجل ناقص أهون من طلب بيقع عشان السجل وقع.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service role
 * @param {{requestId: string, keyId?: string|null, userId?: string|null, method: string,
 *          path: string, status: number, errorCode?: string|null, durationMs?: number|null}} entry
 * @returns {Promise<void>}
 */
export async function logApiRequest(supabase, entry) {
    try {
        const { error } = await supabase.rpc('sie_api_log_request', {
            p_request_id: entry.requestId,
            p_api_key_id: entry.keyId ?? null,
            p_user_id: entry.userId ?? null,
            p_method: entry.method,
            p_path: entry.path,
            p_status: entry.status,
            p_error_code: entry.errorCode ?? null,
            p_duration_ms: entry.durationMs ?? null
        });
        if (error) console.warn('[sie] api request log failed:', error.message);
    } catch (err) {
        console.warn('[sie] api request log threw:', err?.message || err);
    }
}

/**
 * حد المعدل لنداء بمفتاح. نفس دلو المتصفح بالظبط.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service role
 * @param {{userId: string|null, clientIp?: string|null}} params
 * @returns {Promise<{allowed: boolean, enabled: boolean, limit: number, remaining: number,
 *                    resetSeconds: number, retryAfter: number}>}
 */
export async function checkApiRateLimit(supabase, { userId, clientIp = null }) {
    // بيرجع مفتوح لو النداء نفسه فشل: حد المعدل حماية من الزيادة مش
    // تحكم في الصلاحية — والصلاحية متحققة في مكان تاني خالص.
    const open = { allowed: true, enabled: false, limit: 0, remaining: 0, resetSeconds: 0, retryAfter: 0 };
    try {
        const { data, error } = await supabase.rpc('sie_api_rate_limit_hit', {
            p_user_id: userId,
            p_client_ip: clientIp
        });
        if (error) {
            console.error('[sie] api rate limit failed, allowing:', error.message);
            return open;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return open;

        return {
            allowed: row.allowed === true,
            enabled: row.enabled === true,
            limit: Number(row.limit_per_min ?? 0),
            remaining: Number(row.remaining ?? 0),
            resetSeconds: Number(row.reset_seconds ?? 0),
            retryAfter: Number(row.retry_after ?? 0)
        };
    } catch (err) {
        console.error('[sie] api rate limit threw, allowing:', err?.message || err);
        return open;
    }
}

// ── تحويل الصفوف لشكل واحد ──────────────────────────────────

function normalizeCreated(row) {
    return {
        id: row.id,
        // الحقل الوحيد اللي فيه السر، ومرة واحدة بس.
        apiKey: row.api_key,
        prefix: row.key_prefix,
        last4: row.key_last4,
        environment: row.environment,
        expiresAt: row.expires_at ?? null,
        createdAt: row.created_at ?? null
    };
}

function normalizeListed(row) {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        environment: row.environment,
        prefix: row.key_prefix,
        last4: row.key_last4,
        status: row.status,
        expiresAt: row.expires_at ?? null,
        lastUsedAt: row.last_used_at ?? null,
        revokedAt: row.revoked_at ?? null,
        createdAt: row.created_at ?? null,
        requestCount: Number(row.request_count ?? 0)
    };
}
