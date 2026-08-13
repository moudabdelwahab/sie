/**
 * openapi.js — عقد SIE API، مكتوب مرة واحدة
 * ============================================================
 * المستند ده بيتبني من نفس جدول المسارات اللي الراوتر بيوجّه بيه
 * (`ROUTES` في api/v1/router.js)، فمستحيل يتوثّق مسار مش موجود أو
 * يتنسى مسار موجود — الاختبار بيقارن الاتنين.
 *
 * ── ليه ملف كود مش JSON ثابت ────────────────────────────────
 * عنوان السيرفر بيختلف حسب مكان النشر، والمسارات بتتقرا من جدول
 * الراوتر. مستند ثابت كان هيتنسخ ويقدم. الملف ده بيتحول لـJSON عند
 * الطلب على /api/openapi.json، وهو نفسه اللي بيغذّي صفحة التوثيق.
 *
 * ── الأمثلة ────────────────────────────────────────────────
 * كل مثال هنا مطابق للي الـAPI بيرجّعه فعلاً، والاختبار
 * (api/tests/openapi.test.mjs) بيتأكد من ده على رد حقيقي من الراوتر.
 * مثال بيكدب أسوأ من مفيش مثال.
 */
import { ROUTES, SUPPORTED_VERSIONS } from './v1/router.js';
import { ERRORS } from './v1/errors.js';
import { MAX_MESSAGE_CHARS, MAX_BODY_BYTES } from './v1/http.js';

export const DEFAULT_BASE_URL = 'https://sie.mad3oom.com';
export const OPENAPI_VERSION = '3.1.0';
export const API_DOC_VERSION = '1.0.0';

/**
 * @param {{baseUrl?: string}} [options]
 * @returns {Object} مستند OpenAPI كامل
 */
export function buildOpenApiDocument({ baseUrl = DEFAULT_BASE_URL } = {}) {
    return {
        openapi: OPENAPI_VERSION,
        info: {
            title: 'SIE API',
            version: API_DOC_VERSION,
            summary: 'Support Intelligence Engine — تشخيص وردود دعم فني عربية.',
            description: [
                'SIE بيقرا رسالة عميل بالعربي (فصحى، عامية، أو عربيزي)، بيشخّص المشكلة،',
                'وبيرد بحل جاهز أو بيفتح تذكرة لفريق الدعم.',
                '',
                'الـAPI ده بيديك نفس المحرك اللي بيرد على عملاء مدعوم على الموقع وتيليجرام:',
                'نفس الكتالوج، نفس الإعدادات، نفس الرصيد.',
                '',
                '## المصادقة',
                'كل نداء (ما عدا `/health`) محتاج مفتاح API في الهيدر:',
                '',
                '```',
                'Authorization: Bearer sie_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                '```',
                '',
                'المفاتيح بتتعمل من لوحة SIE ← «الـAPI والمطورين». القيمة الكاملة بتتعرض',
                '**مرة واحدة** وقت الإنشاء ومابتترجعش تاني، فاحفظها في مكان آمن.',
                '',
                '## الإصدارات',
                `الإصدار في المسار: \`/api/v1\`. الإصدارات المدعومة دلوقتي: ${SUPPORTED_VERSIONS.join(', ')}.`,
                'أي إضافة لحقل في الرد مش تغيير كاسر — اكتب عميلك عشان يتجاهل الحقول اللي مايعرفهاش.',
                '',
                '## معرّف الطلب',
                'كل رد فيه هيدر `X-Request-Id`. ابعت القيمة دي للدعم لو حصلت مشكلة.',
                'تقدر كمان تبعت المعرّف بتاعك في نفس الهيدر وهنستخدمه بدل ما نولّد واحد.',
                '',
                '## حدود المعدل',
                'الحد بيتحسب لكل حساب (مش لكل مفتاح)، ونفس الدلو بيتشارك مع استخدام',
                'العميل من الموقع. كل رد فيه `RateLimit-Limit` و`RateLimit-Remaining`',
                'و`RateLimit-Reset`، والرفض بيرجع `429` مع `Retry-After`.'
            ].join('\n'),
            contact: { name: 'SIE Support', url: 'https://mad3oom.com' }
        },

        servers: [
            { url: `${baseUrl}/api/v1`, description: 'Production' }
        ],

        security: [{ ApiKeyAuth: [] }],

        tags: [
            { name: 'Chat', description: 'تشغيل المحرك على رسالة عميل.' },
            { name: 'Intelligence', description: 'تشخيص وتصنيف من غير أي أثر.' },
            { name: 'Catalog', description: 'اللي المحرك بيعرف يشخّصه.' },
            { name: 'Account', description: 'الحساب والرصيد والحدود.' },
            { name: 'System', description: 'التوفر.' }
        ],

        paths: buildPaths(),

        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'sie_live_…',
                    description: 'مفتاح API من لوحة SIE. الشكل: `sie_live_…` أو `sie_test_…`.'
                }
            },
            schemas: buildSchemas(),
            responses: buildErrorResponses()
        }
    };
}

// ── المسارات ────────────────────────────────────────────────

const OPERATIONS = {
    getHealth: {
        tags: ['System'],
        summary: 'حالة الخدمة',
        description: 'مفتوح من غير مفتاح: فحص محتاج مصادقة مايقدرش يفرّق بين خدمة واقعة ومفتاح باظ.',
        security: [],
        responses: {
            200: jsonResponse('حالة الخدمة والمحرك', 'HealthResponse', {
                status: 'ok',
                service: 'sie-api',
                version: 'v1',
                engine: { loaded: true, catalog_size: 650 }
            })
        }
    },

    getMe: {
        tags: ['Account'],
        summary: 'الحساب اللي المفتاح بيتكلم باسمه',
        description: 'مين أنا عند SIE، ومسموح لي بكام، وفاضلي كام. أول نداء تعمله لما تجرّب مفتاح جديد.',
        responses: {
            200: jsonResponse('الحساب والرصيد والحد', 'MeResponse', {
                account: {
                    id: '9f1c2b7e-4d3a-4f5b-8c6d-0e1f2a3b4c5d',
                    sie_enabled: true,
                    status: 'مفعّل',
                    access_mode: 'quota',
                    expires_at: null
                },
                api_key: { id: '2b7e9f1c-3a4d-5f6b-8c7d-1e0f2a3b4c5d', prefix: 'sie_live_9fA2xQ', environment: 'live' },
                usage: { messages_used: 128, message_quota: 500, remaining: 372 },
                rate_limit: { enabled: true, limit_per_minute: 100, remaining: 99, reset_seconds: 30 }
            }),
            401: ref('Unauthorized'),
            429: ref('RateLimited')
        }
    },

    createChatTurn: {
        tags: ['Chat'],
        summary: 'دور محادثة كامل',
        description: [
            'بيشغّل المحرك على رسالة عميل ويرجّع الرد.',
            '',
            'الدور ده بيستهلك رسالة من رصيد الحساب، وبيكتب المحادثة، وممكن يفتح تذكرة —',
            'بالظبط زي ما بيحصل لو العميل كتب على الموقع.',
            '',
            'سيب `session_id` فاضي في أول رسالة، وابعت اللي رجع لك في اللي بعدها:',
            'من غير ده كل رسالة هتبان للمحرك كأنها أول رسالة في المحادثة.'
        ].join('\n'),
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/ChatRequest' },
                    examples: {
                        first: {
                            summary: 'أول رسالة في محادثة',
                            value: { message: 'الاشتراك بتاعي منتهي وعايز أجدد', end_user_id: 'crm-user-4821' }
                        },
                        followUp: {
                            summary: 'رسالة تانية في نفس المحادثة',
                            value: {
                                message: 'جربت أجدد ومارضيش',
                                session_id: '5c1b9d3e-77a2-4c0f-9f2a-1d8e6b4a0c31',
                                metadata: { crm_ticket: 'T-9182', priority: 2 }
                            }
                        }
                    }
                }
            }
        },
        responses: {
            200: jsonResponse('رد المحرك', 'ChatResponse', {
                request_id: 'req_7f3a1c9e2b8d4a5f6c0e1d2b3a4f5c6d',
                session_id: '5c1b9d3e-77a2-4c0f-9f2a-1d8e6b4a0c31',
                reply: {
                    text: 'اشتراكك خلص يوم ١٢ يونيو. تقدر تجدده من صفحة الاشتراكات…',
                    options: []
                },
                ticket: null,
                usage: { messages_used: 129, message_quota: 500, remaining: 371 }
            }),
            400: ref('BadRequest'),
            401: ref('Unauthorized'),
            403: ref('Forbidden'),
            404: ref('NotFound'),
            409: ref('Conflict'),
            413: ref('PayloadTooLarge'),
            422: ref('UnprocessableEntity'),
            429: ref('RateLimited'),
            503: ref('EngineUnavailable')
        }
    },

    diagnoseMessage: {
        tags: ['Intelligence'],
        summary: 'تشخيص من غير رد',
        description: [
            'بيمرّر الرسالة على اللغة ← التشخيص ← الترتيب، وبيقف هناك.',
            '',
            '**مابيستهلكش رصيد، ومابيكتبش أي حاجة، ومابيفتحش تذكرة.**',
            'مفيد لتصنيف التذاكر الواردة أو توجيهها قبل ما تحوّلها لـSIE.'
        ].join('\n'),
        requestBody: {
            required: true,
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/DiagnoseRequest' },
                    examples: {
                        basic: { summary: 'تصنيف رسالة', value: { message: 'الواتساب مش مربوط', limit: 3 } }
                    }
                }
            }
        },
        responses: {
            200: jsonResponse('أقرب السيناريوهات', 'DiagnoseResponse', {
                request_id: 'req_1a2b3c4d5e6f70819a2b3c4d5e6f7081',
                message: 'الواتساب مش مربوط',
                will_resolve: true,
                confidence_threshold: 0.6,
                candidates: [
                    {
                        scenario_id: 'whatsapp_not_linked',
                        label: 'رقم الواتساب مش مربوط',
                        label_en: 'WhatsApp number not linked',
                        category: 'whatsapp',
                        confidence: 0.82
                    }
                ],
                signals: [{ token: 'entity_whatsapp', source: 'glossary' }]
            }),
            400: ref('BadRequest'),
            401: ref('Unauthorized'),
            422: ref('UnprocessableEntity'),
            429: ref('RateLimited')
        }
    },

    listScenarios: {
        tags: ['Catalog'],
        summary: 'السيناريوهات المنشورة',
        description: 'اللي المحرك بيعرف يشخّصه دلوقتي. الأسماء والأقسام بس — من غير نصوص الحلول.',
        parameters: [
            { name: 'category', in: 'query', required: false, schema: { type: 'string' }, description: 'فلترة بقسم واحد.' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } }
        ],
        responses: {
            200: jsonResponse('صفحة من الكتالوج', 'ScenarioListResponse', {
                total: 650,
                limit: 100,
                offset: 0,
                data: [{
                    id: 'whatsapp_not_linked',
                    label: 'رقم الواتساب مش مربوط',
                    label_en: 'WhatsApp number not linked',
                    category: 'whatsapp',
                    resolves_automatically: true,
                    opens_ticket_if_unresolved: true
                }]
            }),
            401: ref('Unauthorized'),
            429: ref('RateLimited')
        }
    }
};

function buildPaths() {
    const paths = {};
    for (const route of ROUTES) {
        const operation = OPERATIONS[route.operationId];
        if (!operation) continue;
        paths[route.path] = paths[route.path] ?? {};
        paths[route.path][route.method.toLowerCase()] = {
            operationId: route.operationId,
            ...operation
        };
    }
    return paths;
}

// ── المخططات ────────────────────────────────────────────────

function buildSchemas() {
    return {
        Error: {
            type: 'object',
            required: ['error'],
            properties: {
                error: {
                    type: 'object',
                    required: ['code', 'message', 'request_id'],
                    properties: {
                        code: {
                            type: 'string',
                            description: 'كود ثابت للتفريع في الكود. ده اللي تبني عليه، مش الرسالة.',
                            enum: Object.keys(ERRORS)
                        },
                        message: { type: 'string', description: 'شرح بالإنجليزي للمطوّر.' },
                        message_ar: { type: 'string', description: 'نفس الشرح بالعربي.' },
                        request_id: { type: 'string', description: 'نفس قيمة هيدر X-Request-Id.' },
                        details: { type: 'object', additionalProperties: true, description: 'تفاصيل حسب نوع الخطأ (اسم الحقل، الحد الأقصى…).' }
                    }
                }
            }
        },

        Usage: {
            type: 'object',
            properties: {
                messages_used: { type: 'integer', description: 'الرسائل اللي اتصرفت من الرصيد.' },
                message_quota: { type: ['integer', 'null'], description: 'الرصيد الكلي. `null` معناها من غير حد.' },
                remaining: { type: ['integer', 'null'], description: 'المتبقي. `null` لما يكون مفيش حد.' }
            }
        },

        RateLimit: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean' },
                limit_per_minute: { type: ['integer', 'null'] },
                remaining: { type: ['integer', 'null'] },
                reset_seconds: { type: ['integer', 'null'] }
            }
        },

        HealthResponse: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['ok', 'degraded'] },
                service: { type: 'string' },
                version: { type: 'string' },
                engine: {
                    type: 'object',
                    properties: {
                        loaded: { type: 'boolean' },
                        catalog_size: { type: 'integer', description: 'عدد السيناريوهات المحمّلة.' }
                    }
                }
            }
        },

        MeResponse: {
            type: 'object',
            properties: {
                account: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        sie_enabled: { type: 'boolean' },
                        status: { type: 'string', description: 'الحالة بالعربي زي ما بتظهر في اللوحة.' },
                        access_mode: { type: ['string', 'null'], enum: ['unlimited', 'quota', 'expiration', null] },
                        expires_at: { type: ['string', 'null'], format: 'date-time' }
                    }
                },
                api_key: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        prefix: { type: 'string', description: 'أول ١٦ حرف بس — القيمة الكاملة مابترجعش أبدًا.' },
                        environment: { type: 'string', enum: ['live', 'test'] }
                    }
                },
                usage: { $ref: '#/components/schemas/Usage' },
                rate_limit: { $ref: '#/components/schemas/RateLimit' }
            }
        },

        ChatRequest: {
            type: 'object',
            required: ['message'],
            properties: {
                message: {
                    type: 'string',
                    minLength: 1,
                    maxLength: MAX_MESSAGE_CHARS,
                    description: 'رسالة العميل زي ما كتبها — عربي فصحى أو عامية أو عربيزي.'
                },
                session_id: {
                    type: 'string',
                    description: 'معرّف المحادثة من نداء سابق. سيبه فاضي في أول رسالة.'
                },
                end_user_id: {
                    type: 'string',
                    maxLength: 120,
                    description: 'معرّف العميل النهائي في نظامك. بيفصل محادثات مستخدمينك عن بعض.'
                },
                metadata: {
                    type: 'object',
                    additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
                    maxProperties: 20,
                    description: 'قيم مسطّحة بتاعتك. بتترجع زي ما هي في سجلك ومابتأثرش على المحرك.'
                }
            }
        },

        ChatResponse: {
            type: 'object',
            properties: {
                request_id: { type: 'string' },
                session_id: { type: 'string', description: 'ابعته في الرسالة اللي بعدها عشان المحرك يفتكر.' },
                reply: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: 'الرد الجاهز للعرض للعميل.' },
                        options: {
                            type: 'array',
                            description: 'اختيارات سريعة لو المحرك عرضها.',
                            items: {
                                type: 'object',
                                properties: { label: { type: 'string' }, value: { type: 'string' } }
                            }
                        }
                    }
                },
                ticket: {
                    type: ['object', 'null'],
                    description: 'بيتملى لو الدور ده فتح تذكرة دعم.',
                    properties: { number: { type: 'string' } }
                },
                usage: { $ref: '#/components/schemas/Usage' }
            }
        },

        DiagnoseRequest: {
            type: 'object',
            required: ['message'],
            properties: {
                message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_CHARS },
                limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'عدد أقرب السيناريوهات.' }
            }
        },

        DiagnoseResponse: {
            type: 'object',
            properties: {
                request_id: { type: 'string' },
                message: { type: 'string' },
                will_resolve: {
                    type: 'boolean',
                    description: 'هل أقرب سيناريو وصل لحد الحسم — يعني SIE هيرد بدل ما يسأل.'
                },
                confidence_threshold: { type: 'number', description: 'الحد اللي فوقه المحرك بيحسم.' },
                candidates: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            scenario_id: { type: 'string' },
                            label: { type: 'string' },
                            label_en: { type: ['string', 'null'] },
                            category: { type: ['string', 'null'] },
                            confidence: { type: 'number', minimum: 0, maximum: 1 }
                        }
                    }
                },
                signals: {
                    type: 'array',
                    description: 'الكلمات الدالة اللي المحرك شافها في الرسالة.',
                    items: {
                        type: 'object',
                        properties: {
                            token: { type: 'string' },
                            source: { type: ['string', 'null'] }
                        }
                    }
                }
            }
        },

        ScenarioListResponse: {
            type: 'object',
            properties: {
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            label_en: { type: ['string', 'null'] },
                            category: { type: ['string', 'null'] },
                            resolves_automatically: { type: 'boolean' },
                            opens_ticket_if_unresolved: { type: 'boolean' }
                        }
                    }
                }
            }
        }
    };
}

/**
 * ردود الأخطاء المشتركة، ومثال حقيقي لكل واحد.
 * الأكواد جاية من قاموس الأخطاء نفسه، فمفيش كود موثّق مش موجود.
 */
function buildErrorResponses() {
    const example = (code) => ({
        error: {
            code,
            message: ERRORS[code].message,
            message_ar: ERRORS[code].messageAr,
            request_id: 'req_7f3a1c9e2b8d4a5f6c0e1d2b3a4f5c6d'
        }
    });

    const response = (description, codes) => ({
        description,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: Object.fromEntries(codes.map((code) => [code, { summary: code, value: example(code) }]))
            }
        }
    });

    return {
        BadRequest: response('طلب غلط الشكل.', ['invalid_request', 'invalid_json']),
        Unauthorized: response('المفتاح ناقص أو مش صالح.', ['missing_api_key', 'invalid_api_key', 'api_key_revoked', 'api_key_expired']),
        Forbidden: response('الحساب مش مسموح له دلوقتي.', ['access_disabled', 'access_expired', 'quota_exhausted']),
        NotFound: response('المورد مش موجود.', ['not_found', 'resource_not_found', 'unsupported_version']),
        Conflict: response('تعارض مع حالة موجودة.', ['session_conflict']),
        PayloadTooLarge: response(`الجسم أكبر من ${MAX_BODY_BYTES} بايت.`, ['payload_too_large']),
        UnprocessableEntity: response('الشكل سليم لكن فيه قيمة برّه المدى.', ['unprocessable_entity']),
        RateLimited: response('طلبات كتير. شوف هيدر Retry-After.', ['rate_limited']),
        EngineUnavailable: response('المحرك مالوش رد على الدور ده.', ['engine_unavailable'])
    };
}

// ── مساعدات ────────────────────────────────────────────────

function jsonResponse(description, schemaName, example) {
    return {
        description,
        content: {
            'application/json': {
                schema: { $ref: `#/components/schemas/${schemaName}` },
                example
            }
        }
    };
}

// تصريح دالة مش ثابت سهم: جدول العمليات فوق بيتبني وقت تحميل الوحدة،
// وبينادي عليها قبل السطر ده.
function ref(name) {
    return { $ref: `#/components/responses/${name}` };
}
