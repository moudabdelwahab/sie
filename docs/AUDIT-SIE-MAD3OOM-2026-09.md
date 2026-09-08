# Deep Technical Audit — SIE × مدعوم (Mad3oom)

> **تاريخ التدقيق:** 2026-09-07
> **الريبوهات:** `moudabdelwahab/sie` @ `d265d32` · `moudabdelwahab/Mad3oom` @ `b8cce81`
> **قاعدة البيانات:** مشروع Supabase واحد مشترك — `srnelrdpqkcntbgudyto` (Postgres 17.6)
> **طريقة التحقق:** قراءة الكود في الريبوهين · استعلامات SQL مباشرة على قاعدة الإنتاج (`pg_proc`, `pg_policies`, `pg_constraint`, `pg_indexes`, `pg_trigger`, بيانات فعلية) · Supabase advisors · `git diff` بين الكوميتات المنشورة · تشغيل الاختبارات محليًا (675/675 ناجحة)
> **حدود التحقق:** سياسة الشبكة في بيئة التدقيق ترفض الاتصال بـ `*.supabase.co` و `cdn.jsdelivr.net` و `mad3oom.*` (403 من الـproxy). أي بند يعتمد على استجابة HTTP حية مُعلَّم صراحةً **Potential issue — requires verification**.

---

## 1. Executive Summary

SIE **ليس** مكسورًا. المحرك سليم، 675 اختبار بيعدّوا، والكتابات على القاعدة ذرّية وRLS مفعّلة على كل جدول. المشكلة مش في الجودة — المشكلة في **الهوية المعمارية**.

النظام النهارده بيشتغل بـ**ثلاثة نماذج تكامل متزامنة ومتناقضة**، وبـ**نسختين مختلفتين من المحرك في الإنتاج في نفس اللحظة**:

| المسار | كيف يصل للمحرك | نسخة المحرك | الكتالوج المُجمَّع |
|---|---|---|---|
| موقع مدعوم | `sie-client.js` → HTTPS → Edge Function `sie-api` → jsDelivr CDN | `6c8d164` · runtime **2.3.0** | **650** سيناريو |
| تيليجرام | Edge Function `sie-channel-telegram` → jsDelivr CDN (in-process) | `8252e57` · runtime **2.2.0** | **383** سيناريو |
| لوحة sie-admin | ملفات ثابتة → `import '/sie-integration/sie-runtime.js'` مباشرة | HEAD (وقت النشر) | 650 |

الفارق بين النسختين **26 كوميت** و**11,268 سطر اختلاف في ملف السيناريوهات** و**3,433 سطر في المعجم التقني**. يعني نفس العميل، نفس السؤال، إجابة مختلفة حسب القناة.

وفوق ده كله — وده أخطر اكتشاف في التقرير — **الكتالوج بتاع الـ650 سيناريو مش مستخدم أصلاً في الإنتاج.** الإعداد `use_published_scenarios = true` بيخلي المحرك يقرا من جدول `chat_engine_scenarios`، واللي فيه **7 صفوف بس**. في نفس الوقت `listActiveScenarios()` — اللي بتغذّي فحص الصحة ولوحة الأدمن — بتقرا من الملف المُجمَّع وبترجّع 650. **المشغّل بيشوف 650 والعميل بياخد 7.**

**الحُكم:** الربط شغّال ميكانيكيًا، لكنه **غير محكوم**. مفيش مصدر حقيقة واحد للسيناريوهات، ولا لنسخة المحرك، ولا لمخطط قاعدة البيانات (7 جداول إنتاج مالهاش migration خالص). الأولوية مش إعادة بناء — الأولوية **توحيد وضبط**.

**التقييم العام:** لا توجد ثغرة أمنية حرجة قابلة للاستغلال مباشرةً. الأخطار الحقيقية في **اتساق البيانات، ونزاهة الكتالوج، وهشاشة النشر**.

---

## 2. Current Architecture

```
                         ┌────────────────────────────────────────────┐
                         │   Supabase srnelrdpqkcntbgudyto (مشترك)     │
                         │   PG 17.6 · RLS على كل جداول SIE            │
                         └────────────────────────────────────────────┘
                              ▲             ▲              ▲
        ┌─────────────────────┘             │              └──────────────────┐
        │ JWT العميل                        │ service_role                    │ JWT الموظف
        │                                   │                                 │
┌───────┴────────┐              ┌───────────┴────────────┐        ┌───────────┴──────────┐
│ Edge: sie-api  │              │ Edge:                  │        │ sie-admin (static)   │
│ verify_jwt=off │              │ sie-channel-telegram   │        │ login/settings.html  │
│ rate-limit ✓   │              │ rate-limit ✗           │        │ مفتاح anon قديم       │
└───────┬────────┘              └───────────┬────────────┘        └───────────┬──────────┘
        │ static import                     │ static import                    │ ES import
        ▼                                   ▼                                  ▼
   jsDelivr @6c8d164                  jsDelivr @8252e57              /sie-integration/*
   (650 سيناريو، v2.3.0)              (383 سيناريو، v2.2.0)              (HEAD)
        ▲                                   ▲
        │ HTTPS                             │ webhook + secret_token
┌───────┴────────────────┐          ┌───────┴──────────┐
│ مدعوم (Vercel)          │          │  Telegram Bot API │
│ chat-logic / chat-widget│          └──────────────────┘
│ → assets/js/sie-client.js│
│ → /sie-config.js         │
└─────────────────────────┘
```

**ملاحظتان معماريتان مهمتان:**

1. `vercel.json` بتاع مدعوم **مافيهوش أي rewrite لـ `/api/v1/*`**. الاتصال شغّال لأن `sie-config.js:45` بيوجّه مباشرةً على `https://srnelrdpqkcntbgudyto.supabase.co/functions/v1/sie-api` — مش على `sie.mad3oom.com`. الدومين ده مذكور في التعليقات بس، ومش في المسار الفعلي.

2. الريبو `moudabdelwahab/sie` **عام (public)** — متحقَّق منه عبر GitHub API (`"private": false`, `"visibility": "public"`). ده **شرط تشغيلي** لأن jsDelivr بيخدم الريبوهات العامة بس.

---

## 3. SIE Architecture Map

**ما هو SIE؟** محرك دعم تشخيصي حتمي (deterministic) — مش LLM. بيحوّل رسالة العميل لأدلة (tokens)، بيرتّب فرضيات مقابل كتالوج سيناريوهات، وبيقرر: يجاوب، يسأل سؤال توضيحي، أو يفتح تذكرة.

**التسلسل الفعلي** (`sie-integration/sie-chat-bridge.js:626` → `runSieTurn`):

```
Settings (sie_settings)          ← لو engine_enabled=false → null فورًا، بدون تكلفة
   ↓
Entitlement (sie_consume_message) ← ⚠️ الكوتة بتتخصم هنا، قبل أي شغل
   ↓
Language     (Module 1) normalizer · dialect · arabizi · typo · emotion · small-talk
   ↓
Diagnostics  (Module 2) evidence-extractor → hypothesis-tracker
   ↓
Ranking      (Module 3) rankDiagnosticState + activation threshold
   ↓
Decision     (Module 4) ANSWER | CLARIFY | CREATE_TICKET | ESCALATE
   ↓
Knowledge    (Module 5) answer-composer ← static-knowledge.local.js (ملف مُجمَّع)
   ↓
Dialogue     (Module 6) renderDecision (ar/en)
   ↓
Action       (Module 8) persist_bot_turn | create_ticket_with_message_and_session_update
   ↓
Observability(Module 9) logTraceEvent → chat_engine_trace_events   (best-effort)
```

**الواجهة العامة الوحيدة:** `sie-integration/sie-runtime.js` (`SIE_RUNTIME_VERSION`). كل حاجة تحتها internal.

**الجداول المملوكة لـSIE:** `sie_settings` (43) · `chat_engine_scenarios` (7) · `chat_engine_knowledge_entries` (9) · `chat_engine_trace_events` (16) · `chat_engine_conversation_reviews` (2) · `chat_engine_validation_runs` (0) · `chat_engine_publish_overrides` (0) · `customer_sie_access` (3) · `customer_sie_access_audit` (90) · `sie_customer_memory` (2) · `sie_rate_limit_*` · `sie_api_keys` (0) · `sie_api_requests` (0) · `channel_identities` (1) · `channel_link_codes` (1) · `channel_secrets` (2).

**الجداول المملوكة لمدعوم واللي SIE بيلمسها عبر RPC فقط:** `chat_messages` (474) · `chat_sessions` (41) · `tickets` (35).

---

## 4. Mad3oom Integration Map

| # | نقطة التكامل | الاتجاه | آلية المصادقة | الحالة |
|---|---|---|---|---|
| 1 | `POST /v1/chat/reply` | مدعوم → SIE | JWT العميل (يُعاد التحقق منه بـ`auth.getUser()`) | شغّال؛ **بدون idempotency** |
| 2 | `GET /v1/access/:userId` | مدعوم → SIE | JWT + RLS | شغّال؛ نداء إضافي لكل رسالة |
| 3 | `GET /v1/admin/is-admin` | مدعوم → SIE | JWT → `is_sie_admin()` | شغّال |
| 4 | `POST /v1/admin/access` | مدعوم → SIE | JWT → `sie_admin_set_access()` | شغّال |
| 5 | `POST /v1/admin/access/reset-usage` | مدعوم → SIE | JWT → `sie_admin_reset_usage()` | شغّال |
| 6 | `GET /v1/health` | مدعوم → SIE | **بدون توكن** (`verify_jwt=false`) | شغّال؛ **بيبلّغ رقم كتالوج مضلِّل** |
| 7 | Telegram webhook | Telegram → SIE | `X-Telegram-Bot-Api-Secret-Token` (مقارنة constant-time) | شغّال وآمن |
| 8 | قاعدة بيانات مشتركة | ثنائي الاتجاه | RLS + SECURITY DEFINER RPCs | مقصود وسليم |
| 9 | `chat_sessions.guest_id` | SIE → مدعوم | `channel:telegram:<chat_id>` | **حقل نصّي مُعاد استخدامه، بلا قيد** |
| 10 | `chat_sessions.bot_state.sie` | ثنائي الاتجاه | namespace داخل JSONB مشترك | سليم؛ لا يصطدم بالمحرك التقليدي |
| 11 | `profiles.chatbot_mode = 'sie'` | مدعوم | تفضيل العميل (البوابة 1) | شغّال |
| 12 | `customer_sie_access` | SIE | قرار إداري (البوابة 2) | شغّال |
| 13 | jsDelivr CDN | SIE → SIE | **بدون مصادقة — ريبو عام** | نقطة فشل مفردة |

**البوابتان يكمّلان بعضهما** (`chat-logic.js:679`): العميل لازم يختار `sie` **و** الإدارة لازم تفعّل `customer_sie_access`. التصميم ده صحيح، ومعالجة السحب أثناء المحادثة (`handleSieRevokedMidConversation`) ممتازة — بتكتب التحويل في القاعدة وبتبلّغ العميل داخل نص المحادثة.

---

## 5. Data Flow

### أ) دورة محادثة على الموقع

```
العميل يكتب
  ↓
chat-logic.js: insert chat_messages (رسالة العميل)     ← trigger: N إشعارات للأدمنز
  ↓
getSieAccessInfo() → HTTP → sie-api /v1/access/:id      ← نداء 1، توكن rate-limit 1
  ↓
getSieReply() → HTTP → sie-api /v1/chat/reply           ← نداء 2، توكن rate-limit 2
  ↓                                                        (timeout 15s، retry واحد)
sie-api: auth.getUser() → تحقق ملكية chat_sessions
  ↓
CDN import → runSieTurn()
  ↓
  sie_consume_message()   ← معاملة منفصلة، بتـcommit فورًا  ⚠️
  ↓
  … البايبلاين …
  ↓
  persist_bot_turn()      ← معاملة واحدة: رسالة البوت + bot_state (+ تذكرة)
  ↓
  logTraceEvent()         ← best-effort
  ↓
{ reply, options, alreadyPersisted: true, ticketNumber }
  ↓
chat-logic.js: لو alreadyPersisted → renderQuickOptions + return (لا كتابة مزدوجة ✅)
```

### ب) مصفوفة الملكية

| البيانات | المالك | من يكتب | التزامن | التكرار |
|---|---|---|---|---|
| `chat_messages` | مدعوم | SIE عبر RPC فقط · مدعوم مباشرة | معاملة واحدة | ✅ لا يوجد (`alreadyPersisted` محترم في `chat-logic.js:715` و`chat-widget.js:881`) |
| `chat_sessions.bot_state` | مشترك | `persist_bot_turn` ثم `sessions.saveState()` (تيليجرام) | كتابتان متتاليتان | ⚠️ كتابة زائدة على مسار القناة |
| `customer_sie_access.messages_used` | SIE | `sie_consume_message` بقفل `for update` | ذرّي ✅ | ⚠️ لا يوجد مسار استرجاع عند الفشل |
| كتالوج السيناريوهات | **مُنازَع** | ملف مُجمَّع (650) **أو** جدول (7) | لا يوجد | ❌ مصدرا حقيقة متوازيان |
| `sie_customer_memory` | SIE | تيليجرام فقط عمليًا | — | ❌ الكتابة من الويب مرفوضة بصمت |

### ج) أسئلة الفشل

| السؤال | الإجابة الحالية |
|---|---|
| الخدمة الأخرى مش بترد؟ | circuit breaker 30 ثانية → `null` → رسالة «مشكلة مؤقتة». **الكوتة اتخصمت لو الفشل كان بعد الاستهلاك.** |
| ردّت بعد الـtimeout؟ | العميل عمل retry → **دور تاني كامل** → كوتة مرتين + رسالتَي بوت. لا يوجد idempotency key. |
| الحدث وصل مرتين؟ | تيليجرام: dedupe في الذاكرة فقط (per-instance). الويب: لا يوجد dedupe إطلاقًا. |
| الحدث وصل بترتيب خاطئ؟ | لا يوجد ترتيب مفروض. `p_turn` بيتبعت ومابيتخزنش. |
| اتغيّرت البيانات في نظام؟ | القاعدة مشتركة، فلا يوجد تزامن مطلوب — وده أقوى نقطة في التصميم. |
| اتمسح صف؟ | `chat_engine_trace_events` → CASCADE. `chat_messages` → NO ACTION (بيمنع حذف الجلسة). **دلالات حذف غير متسقة.** |

---

## 6. Authentication & Authorization

**آلية المصادقة:** Supabase Auth (JWT). `sie-client.js` بيمرّر `access_token` من `getSession()` (اللي بيجدّد تلقائيًا) — مافيش تنفيذ محلي لتجديد التوكن، وده صحيح.

**التفويض مفروض في القاعدة، مش في الواجهة.** ده متحقَّق منه ومُطبَّق بجدية:
- `sie_admin_set_access` / `sie_admin_reset_usage` / `sie_api_key_*` كلهم بيندهوا `is_sie_admin()` جوّه الدالة ويرموا exception. الواجهة بتخفي الأزرار بس — مش بتحرس.
- `sie_consume_message` بترفض `p_user_id <> auth.uid()` إلا لو الطالب `service_role`.
- `chat-reply.ts` بيقرا الهوية من التوكن، وبيرفض body فيه `userId` مختلف بـ403، وبيتحقق من ملكية الجلسة **قبل** استهلاك الكوتة.

**نتيجة فحص IDOR:** فحصت كل دالة `SECURITY DEFINER` بتاخد `p_user_id` وهي متاحة لـ`authenticated` (11 دالة). **كلها محروسة صح.** `sie_api_key_list` و`sie_api_usage_summary` بيقيّدوا بـ`(is_sie_admin() OR is_chat_engine_staff() OR user_id = auth.uid())`. **لا يوجد IDOR.**

**ثلاثة تعريفات مختلفة للأدمن — مشكلة حقيقية:**

| الدالة | التعريف | الاستخدام |
|---|---|---|
| `is_sie_admin()` | `email = 'support@mad3oom.online'` — **إيميل واحد** | صلاحيات SIE، مفاتيح API، حدود المعدل |
| `is_main_admin()` | `email IN ('support@…','info@…')` | RLS على `chat_messages` / `chat_sessions` |
| `is_chat_engine_staff()` | `role IN ('admin','support','super_user')` | كتالوج السيناريوهات والمعرفة، الإعدادات |

**الأثر:** لو الحساب `support@mad3oom.online` اتقفل أو اتغيّر إيميله، **مفيش حد على الإطلاق يقدر يفعّل SIE لعميل جديد** ولا يدير مفاتيح الـAPI. مفيش مسار استرجاع غير تعديل الدالة في القاعدة يدويًا. ده **bus factor = 1** مكتوب في SQL.

---

## 7. Database Analysis

**الإيجابيات (متحقَّق منها):**
- RLS مفعّلة على **كل** جدول عام (لا استثناءات).
- `channel_secrets` و`internal_service_secrets`: RLS مفعّلة و**صفر سياسات** → رفض كامل لأي دور غير `service_role`. صحيح تمامًا.
- `sie_consume_message` بتستخدم `SELECT … FOR UPDATE` → مفيش double-spend من تابين مفتوحين.
- قيود `CHECK` على `customer_sie_access` محكمة: `chk_quota_mode_has_quota`, `chk_expiration_mode_has_date`, `chk_quota_requires_mode`, `chk_expiration_requires_mode`, `message_quota > 0`, `messages_used >= 0`. الحالات غير المتسقة **مستحيلة** على مستوى القاعدة.
- الفهارس على المسارات الساخنة موجودة: `chat_engine_trace_events(session_id, turn)`, `chat_engine_scenarios(scenario_key, status)`, `sie_customer_memory(user_id)`.
- تدقيق `customer_sie_access_audit` (90 صف) شغّال عبر trigger.

**المشاكل:**

| # | المشكلة | الدليل |
|---|---|---|
| D1 | **7 جداول إنتاج مالهاش migration** في الريبو إطلاقًا: `customer_sie_access`, `customer_sie_access_audit`, `sie_customer_memory`, `internal_service_secrets`, `chat_ai_usage_counters`, `sie_api_keys`, `sie_api_requests` | `grep "create table.*<t>"` عبر كل ملفات `.sql` → صفر نتائج |
| D2 | **لا UNIQUE على `(scenario_key, version)`** ولا `(knowledge_key, version)` | `pg_constraint`: فقط PK على `id`. الفهرس `chat_engine_scenarios_key_version_idx` غير فريد |
| D3 | `publish_chat_engine_scenario` بتعمل `UPDATE … RETURNING id INTO v_id` — مع D2، صفّان بنفس المفتاح والنسخة يتنشروا الاتنين و`INTO` بتاخد واحد بصمت | تعريف الدالة + غياب STRICT |
| D4 | `persist_bot_turn` بتاخد `p_turn` و**ما بتكتبهوش في أي مكان** | تعريف الدالة؛ `observability-read-port.supabase.js:51` بيشتقّ الترقيم من ترتيب `created_at` |
| D5 | دوال معلنة في migration وغير موجودة في الإنتاج: `create_chat_engine_scenario_draft`, `create_chat_engine_knowledge_draft` | استعلام `pg_proc` → MISSING. (الكود اتصلّح ومابقاش بينده عليهم — `supabase-port.supabase.js:132`) |
| D6 | `sie_customer_memory`: **لا سياسة INSERT ولا UPDATE** | `pg_policies`: SELECT + DELETE فقط |
| D7 | مراجع FK غير متسقة: `customer_sie_access.user_id → profiles(id)` بينما `channel_identities.user_id → auth.users(id)` | `pg_constraint` |
| D8 | `sie_rate_limit_buckets` بلا أي وظيفة تنظيف | `cron.job` فيه `oauth-cleanup-daily` بس |
| D9 | `is_chat_engine_staff()` SECURITY DEFINER بـ`search_path` قابل للتغيير | `pg_proc.proconfig = NULL` + Supabase advisor |

---

## 8. API Analysis

`sie-api` — Edge Function واحدة، `verify_jwt = false`، 6 مسارات.

| المسار | مصادقة | تحقق مدخلات | تفويض | ملاحظات |
|---|---|---|---|---|
| `GET /v1/health` | ❌ بدون توكن (مقصود) | — | — | بيسرّب `catalogSize` **من مصدر مختلف عن اللي المحرك بيستخدمه** |
| `GET /v1/admin/is-admin` | JWT | — | `is_sie_admin()` | سليم |
| `GET /v1/access/:id` | JWT + `getUser()` | لا تحقق من شكل UUID | RLS | لا يفرّق «مش موجود» عن «مخفي» — قرار صحيح |
| `POST /v1/access/set` | JWT | حقول مطلوبة فقط؛ لا تحقق أنواع | RPC | نصوص الأخطاء بتتطابق بـ`String.includes()` — هشّ |
| `POST /v1/access/reset` | JWT | `userId` موجود فقط | RPC | نفس الهشاشة |
| `POST /v1/chat/reply` | JWT + `getUser()` | `text`/`sessionId` نصوص؛ **لا حد أقصى لطول `text`** | ملكية الجلسة | **بلا idempotency** |

**ملاحظات مهمة:**

1. **`verify_jwt = false` مبرَّر ومُوثَّق جيدًا** (عشان `/health` يشتغل بدون توكن). المنطق سليم لأن كل مسار تاني بيتحقق من الهوية بنفسه أو عبر RPC. لكن ده يخلي **حد المعدل متاحًا لمجهولي الهوية** — شوف S3.
2. **مطابقة الأخطاء بالنص** (`message.includes('access denied')`) — أي تعديل على نص الاستثناء في SQL بيحوّل 403 لـ500 بصمت.
3. **لا حد أقصى لحجم الجسم أو طول النص** على `/v1/chat/reply`. رسالة بميجابايتات هتعدّي على كل البايبلاين.
4. **رسالتان لكل رد**: `getSieAccessInfo` ثم `getSieReply` = نداءان + **توكنَي rate-limit** لكل رسالة عميل. الحد المُعلن (100/دقيقة) عمليًا 50.
5. `sie-api` بيقرا `X-Forwarded-For` ويأخذ **أول** قيمة (`split(',')[0]`) — القيمة اللي العميل بيتحكم فيها.

---

## 9. Webhook / Event Analysis

**Telegram → SIE** (`sie-channel-telegram`):

| البند | الحالة |
|---|---|
| التحقق من التوقيع | ✅ `X-Telegram-Bot-Api-Secret-Token` بمقارنة **constant-time** |
| سر مفقود = رفض | ✅ fail-closed صريح |
| Replay | ⚠️ dedupe في ذاكرة الـinstance فقط، 500 مفتاح / 10 دقائق |
| ترتيب | ❌ غير مفروض |
| دائمًا 200 | ✅ قرار صحيح — يمنع إعادة إرسال تيليجرام لمدة 24 ساعة |
| 401 للطلب غير الموثَّق | ✅ |
| إعادة محاولة الإرسال | ✅ 3 محاولات، exponential + full jitter، يحترم `Retry-After`، لا يعيد على 4xx (عدا 429) |
| حد المعدل | ❌ **غير موجود على مسار تيليجرام إطلاقًا** |
| معالجة جزئية | ⚠️ `dedupe.remember()` **قبل** المعالجة → انهيار في المنتصف = الرد ضاع نهائيًا والكوتة اتخصمت |

**هل يمكن حدوث loop بين SIE ومدعوم؟** — **لا.** المسار أحادي الاتجاه في كل الحالات: تيليجرام → SIE → قاعدة البيانات → Telegram API. مفيش webhook من مدعوم لـSIE. الردود بتتكتب بـ`is_bot_reply=true`، والـtrigger `handle_new_chat_message` بيتجاهلها صراحةً (`IF NEW.is_bot_reply = FALSE AND NEW.is_admin_reply = FALSE`). **لا يوجد خطر loop.**

**دليل تشغيلي:** `sie_rate_limit_buckets` فيه مفاتيح `integration:` بس — **صفر مفاتيح `user:` أو `ip:`**. يعني `sie_rate_limit_hit()` (بتاعة sie-api) **ما اشتغلتش ولا مرة بنجاح**. وفي نفس الوقت آخر دور SIE كان **2026-09-04** (بـ16 trace event مسجّلة). الاستنتاج: **حركة SIE الحقيقية كلها بتمرّ من تيليجرام، ومسار الموقع إمّا غير مستخدَم أو غير واصل.** — *Potential issue — requires verification* (لا يمكن اختبار HTTP من بيئة التدقيق).

---

## 10. Security Findings

### S1 — الاعتماد على ريبو GitHub عام + jsDelivr كمسار تشغيل إنتاجي · **HIGH**

* **المكوّن:** `supabase/functions/sie-api/handlers/chat-reply.ts:59`، `index.ts:37`، `sie-channel-telegram/index.remote.ts:59-67`
* **الدليل:** GitHub API يؤكد `"private": false, "visibility": "public"`. jsDelivr `/gh/` بيخدم الريبوهات العامة فقط.
* **سيناريو الهجوم/الفشل:** تحويل الريبو لخاص (قرار إداري عادي جدًا) أو إعادة تسميته أو حذف كوميت → **الدالتان تفشلان في الإقلاع عند أول cold start**. SIE بيقف على الموقع وتيليجرام معًا، بدون تغيير كود وبدون تحذير. كمان: أي كود أو بيانات في الريبو **علنية للجميع** (650 سيناريو + المعجم التقني + منطق التشخيص).
* **السبب الجذري:** استخدام CDN عام كآلية توزيع كود داخلي، لأن الـmanagement API مابيقبلش رسم بياني 65 موديول/1 ميجا.
* **الإصلاح:** تجميع (bundle) المحرك في أصل الدالة وقت النشر عبر `supabase functions deploy` من checkout، أو استضافة الأصول المُجمَّعة في Supabase Storage خاص. الـpinning على commit صحيح ولازم يفضل.

### S2 — حد المعدل مبني على ترويسة يتحكم فيها العميل + جدول بلا تنظيف · **HIGH**

* **المكوّن:** `_shared/rate-limit.ts:51-55` (`clientIp`)، `sie_rl_spend()`، جدول `sie_rate_limit_buckets`
* **الدليل:** `forwarded.split(',')[0].trim()` = أقصى يسار = القيمة اللي المهاجم بعتها. `verify_jwt=false` يعني المسارات كلها بتوصل للـlimiter **قبل** التحقق من الهوية. `cron.job` مافيهوش أي وظيفة تنظيف للجدول.
* **سيناريو الهجوم:** مهاجم مجهول يبعت `POST /v1/chat/reply` مع `X-Forwarded-For` عشوائي في كل طلب → (أ) تجاوز كامل لحد المعدل، (ب) صف جديد في `sie_rate_limit_buckets` لكل طلب، ينمو بلا حد ويستهلك مساحة القاعدة.
* **السبب الجذري:** استعمال أول hop في `X-Forwarded-For` بدل آخر hop موثوق، وغياب سياسة احتفاظ للجدول.
* **الإصلاح:** استخدم آخر قيمة في السلسلة (أو `cf-connecting-ip` وحده)، وأضف `DELETE FROM sie_rate_limit_buckets WHERE last_request_at < now() - interval '1 day'` عبر `pg_cron`. الفهرس `sie_rate_limit_buckets_last_request_idx` موجود بالفعل لده.

### S3 — العميل يقدر يزوّر رسائل بوت/أدمن في محادثته · **MEDIUM**

* **المكوّن:** سياسة `chat_messages_insert_own_or_admin`
* **الدليل:** `WITH CHECK` بتقيّد `session_id` و`sender_id` بس — **مافيش أي قيد على `is_bot_reply` أو `is_admin_reply`**.
* **سيناريو الهجوم:** عميل مسجَّل يبعت `POST /rest/v1/chat_messages` بـ`{session_id: <جلسته>, sender_id: null, is_admin_reply: true, message_text: "وافقنا على استرداد 5000 جنيه"}`. الصف بيتقبل. بعدين يفتح نزاع بلقطة شاشة من محادثته الحقيقية.
* **السبب الجذري:** السياسة اتكتبت للملكية، وأعمدة «مين المتكلم» اتعامل معاها كبيانات مش كامتياز.
* **الإصلاح:** `WITH CHECK (… AND is_admin_reply = false AND is_bot_reply = false)` للعميل؛ الكتابة كبوت تفضل حصريًا عبر `persist_bot_turn`.

### S4 — العميل يقدر يزوّر آثار التشخيص · **MEDIUM**

* **المكوّن:** سياسة `Staff can insert trace events` على `chat_engine_trace_events`
* **الدليل:** `WITH CHECK (is_chat_engine_staff() OR session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()))`
* **سيناريو الهجوم:** عميل بيحقن صفوف `decision`/`ranking`/`hypotheses` مفبركة لجلساته. الصفوف دي بتغذّي Review Center وview `chat_engine_learning_queue` وجولات التحقق (`chat_engine_validation_runs`). يعني **تسميم مباشر لحلقة تحسين المحرك**، والموظف بيشوفها كأنها قرارات المحرك الحقيقية.
* **السبب الجذري:** السماح للعميل بالكتابة عشان مسار المتصفح يقدر يسجّل، بدل ما التسجيل يمرّ من RPC موقّعة زي باقي الكتابات.
* **الإصلاح:** حوّل تسجيل الأثر لـ`SECURITY DEFINER` RPC (زي `queue_conversation_for_review` بالظبط)، واسحب الـINSERT من العميل.

### S5 — `is_chat_engine_staff()` بـsearch_path قابل للتغيير · **MEDIUM**

* **الدليل:** `pg_proc.proconfig = NULL` + Supabase advisor `function_search_path_mutable`.
* **الأثر:** الدالة دي هي البوابة لكل كتالوج السيناريوهات والمعرفة والإعدادات. دور يقدر ينشئ كائنات في schema أسبق في الـsearch_path يقدر يظلّل `profiles`.
* **قابلية الاستغلال اليوم:** منخفضة — PG 17 بيسحب `CREATE` على `public` من `PUBLIC` افتراضيًا. **دفاع في العمق، مش ثغرة نشطة.**
* **الإصلاح:** `ALTER FUNCTION public.is_chat_engine_staff() SET search_path = public`. (نفس الشيء لـ`touch_customer_sie_access_updated_at` و`touch_sie_settings_updated_at`.)

### S6 — نقطة فشل إدارية مفردة (إيميل مكتوب حرفيًا) · **MEDIUM**

مشروح في القسم 6. فقدان `support@mad3oom.online` = **فقدان دائم للقدرة على إدارة صلاحيات SIE**.

### S7 — CORS بيعكس أي Origin · **LOW**

`corsHeaders`: `'Access-Control-Allow-Origin': origin ?? '*'`. مش قابل للاستغلال عمليًا لأن المصادقة بترويسة `Authorization` (مش كوكيز)، وصفحة المهاجم مش بتقدر تقرا `localStorage` بتاع مدعوم. لكنه بيلغي دفاع طبقي بلا مقابل. الإصلاح: allow-list صريح.

### S8 — نسختان مختلفتان من مفتاح Supabase العام · **LOW**

`sie-admin/supabase-client.js:35` بيستخدم مفتاح anon بصيغة JWT القديمة (بتعليق `// TODO: fill in` جنبه)، بينما مدعوم بيستخدم `sb_publishable_…`. تدوير مفتاح واحد مش هيدوّر التاني. **لم يُعثر على أي service-role key مسرَّب في أي من الريبوهين** — الفحص نظيف.

---

## 11. Reliability Findings

### R1 — الكوتة بتتخصم قبل ما الدور ينجح، وبلا مسار استرجاع · **HIGH**

* **المكوّن:** `sie-chat-bridge.js:639` (`tryConsumeSieMessage`) مقابل `:945` و`:983`
* **الدليل:** `sie_consume_message` نداء RPC مستقل → معاملة خاصة بيها بتـcommit فورًا. بعد كده أي فشل (`actionResult.success === false`، أو أي استثناء في البايبلاين) بيرجّع `null` **بدون أي decrement**.
* **السيناريو:** عطل مستمر في المحرك + `chat-logic.js:701` بيقول للعميل «جرّب تبعتها تاني» → كل محاولة بتخصم رسالة. عميل بـ`access_mode='quota'` ممكن يستهلك كوتته بالكامل و**يستلم صفر ردود**.
* **السبب الجذري:** حدّ المعاملة اتحدّد حوالين الكتابة (`persist_bot_turn`) مش حوالين الدور كله. الاستهلاك خارج الحدّ.
* **الإصلاح الصحيح (مش workaround):** خصم بعد النجاح، أو `sie_refund_message(p_user_id)` تتنادى في مسار الفشل. الأنظف: حجز/تأكيد (reserve/commit) بنفس قفل `for update` الموجود.

### R2 — إعادة محاولة بلا idempotency = دور مزدوج · **HIGH**

* **المكوّن:** `sie-client.js:98-108` (`isRetryableError` بيقبل `AbortError`) + `:488` (`timeoutMs: 15000`)
* **الدليل:** timeout بيولّد `AbortError` → retryable → محاولة تانية. الدالة على الجهة التانية ممكن تكون خلّصت الدور بالفعل (كتبت الرسالة + خصمت الكوتة). `/v1/chat/reply` **مالوش `Idempotency-Key`** ولا أي مفتاح إزالة تكرار.
* **الواقعية:** أزمنة المعالجة المُقاسة في الإنتاج 2166–3235ms في الحالة الدافئة؛ cold start + سحب ~1 ميجا من CDN يخلّي 15 ثانية احتمالًا حقيقيًا، مش نظريًا.
* **الأثر:** العميل بيشوف الرد مرتين، الكوتة بتتخصم مرتين، والـtrace بيتسجّل مرتين بنفس رقم الـturn.
* **الإصلاح:** `Idempotency-Key` (مثلاً `sessionId + hash(text) + turn`) مخزَّن ومُتحقَّق منه في `sie_consume_message` أو في جدول idempotency مخصص. بديل أضعف: عدم إعادة المحاولة على timeout لعمليات غير idempotent.

### R3 — إزالة التكرار على تيليجرام في الذاكرة فقط · **MEDIUM**

`createMemoryDeduplicator` (`delivery.js:162`) — `Map` في نطاق الـmodule. Supabase بيشغّل عدد غير محدد من الـinstances وبيعيد تدويرها بلا إشعار. إعادة إرسال تنزل على instance بارد = دور مكرر كامل. الملف موثِّق الحد ده بأمانة، لكنه يفضل خطرًا. **الإصلاح:** جدول `channel_processed_messages(channel, message_id)` بـPK مركّب و`pg_cron` للتنظيف.

### R4 — `index.ts` و`index.remote.ts` اتفرّقوا فعلاً · **HIGH (خطر نشر)**

* **الدليل:** `diff` تحت سطر الاستيراد بيوضح إن `index.remote.ts` (المنشور) فيه **منطق زيادة غير موجود في `index.ts`**: دالة `readSecret()` بتقرا `channel_secrets` كاحتياطي لسر الويبهوك، ودالة `autoRegisterWebhook()` بتسجّل الويبهوك تلقائيًا. التعليق في رأس الملف بيقول «كل حاجة تحت الاستيراد مطابقة لـindex.ts ولازم تفضل كده» — **الشرط ده مكسور بالفعل**.
* **السيناريو:** أي حد يشغّل `supabase functions deploy sie-channel-telegram` من checkout هينشر `index.ts` — فيشيل احتياطي `channel_secrets` (لو السر مش في env، القناة بتقع بـ`misconfigured 500`) **ويبدّل نسخة المحرك** من CDN@8252e57 لنسخة HEAD المحلية. نشر روتيني بيغيّر السلوك والمحرك مع بعض.
* **الإصلاح:** ملف entrypoint واحد. لو الاتنين ضروريين، خلّي المنطق المشترك في موديول واحد والملفين مجرد أسطر استيراد.

### R5 — مسار تيليجرام بلا أي حد معدل · **MEDIUM**

`sie-channel-telegram` مابيندهش `checkRateLimit` إطلاقًا. مؤكَّد بالبيانات: صفر مفاتيح `user:`/`ip:` في `sie_rate_limit_buckets`. عميل مربوط يقدر يبعت بأقصى سرعة يسمح بيها تيليجرام، محدود بالكوتة بس.

### R6 — كاش الإعدادات في نطاق module داخل دالة serverless · **LOW**

`sie-entitlement.js:358-374`: `settingsCache` + TTL 60 ثانية في نطاق الـmodule → مشترك بين كل الطلبات على نفس الـinstance. إطفاء `engine_enabled` بياخد لحد 60 ثانية على كل instance دافئ. مقبول، لكن لازم يكون معروف.

### R7 — كتابة `bot_state` مزدوجة على مسار القناة · **LOW**

`channels/core/sie-client.js:94` بيندهي `sessions.saveState()` بعد ما الـAction Layer كتب نفس الحالة جوّه `persist_bot_turn`. كتابة زائدة + نافذة سباق ضيقة لو الاتنين اختلفوا.

---

## 12. Performance Findings

| # | البند | الدليل | الأثر |
|---|---|---|---|
| P1 | **تراجع زمن الاستجابة 5–10×** | `chat_engine_trace_events.processing_time_ms`: **264–603ms** في 2026-07-20 → **2166–3235ms** من 2026-08-03 وبعدها | كل دور بقى أبطأ بـ~2.5 ثانية بعد الانتقال لمعمارية الـCDN |
| P2 | **نداءان + توكنَي rate-limit لكل رسالة** | `chat-logic.js:680` ثم `:686` | الحد الفعلي نص المُعلن؛ latency مضاعفة |
| P3 | **trigger `handle_new_chat_message` على المسار الساخن** | حلقة `FOR admin_id IN (SELECT id FROM profiles WHERE role='admin')` بـINSERT لكل أدمن، جوّه معاملة العميل. `notifications` وصلت 1733 صف | تضخيم كتابة N× + زمن على مسار إرسال الرسالة |
| P4 | **cast بيعطّل الفهرس في نفس الـtrigger** | `WHERE id::text = session_user_id` على `profiles` | seq scan لكل رسالة عميل (بسيط عند 27 صف، حقيقي عند التوسّع) |
| P5 | **سحب ~1 ميجا من CDN عند كل cold start** | `index.remote.ts` بيوثّق «~1 MB، dominated by 580 KB data» | زمن إقلاع بارد طويل → يغذّي R2 |
| P6 | لا فهرس مركّب `(session_id, created_at)` على `chat_messages` | `pg_indexes` | ترتيب منفصل عند اشتقاق الـturns |
| P7 | `getSieSettings` استعلام لكل دور (مخفَّف بكاش 60s) | `sie-chat-bridge.js:632` | مقبول |

---

## 13. Code Quality Findings

### Q1 — عقيدتان معماريتان متناقضتان، مكتوبتان حرفيًا في الكود · **جذر معظم ما سبق**

```
Mad3oom/assets/js/sie-client.js:5-8
  "SIE is a fully independent product — it is not embedded in this
   repository, and per the platform's architecture rules Mad3oom must
   never import SIE source code."

sie/sie-integration/sie-runtime.js:6-13
  "SIE is the intelligence subsystem of the Mad3oom Platform — not a
   standalone SaaS product… same origin, direct ES imports, no network
   hop in between.  Mad3oom imports THIS FILE AND NOTHING ELSE."
```

الاتنين **حيّين في الإنتاج دلوقتي**، والاتنين **بيوصفوا معمارية مش المنشورة**. المنشور فعليًا: مدعوم → HTTP → Edge Function → CDN → المحرك. و`sie-runtime.js` بيدّعي إن مدعوم بيستورده مباشرةً — **مافيش ولا ملف واحد في مدعوم بيعمل كده** (متحقَّق: كل استيرادات SIE في مدعوم بتروح لـ`/assets/js/sie-client.js`).

غياب وثيقة قاعدة معمارية واحدة (مفيش `CLAUDE.md` في أي من الريبوهين، رغم إن `sie-config.js:4` بيشير لواحدة) هو اللي سمح للنموذجين يتعايشوا.

### Q2 — توثيق قديم يناقض الكود

* `channels/core/sie-client.js:35-40` لسه بيقول `/v1/chat/reply` بيرجّع **501 not_implemented** — المسار متنفَّذ من زمان.
* `sie-runtime.js:337` بيوصف `listActiveScenarios()` بأنها «exactly what the live engine diagnoses against right now» — **غير صحيح** لما `use_published_scenarios = true`.
* `ARCHITECTURE-SIE-MAD3OOM.md` (2026-08-02) متناقَض في معظم بنوده (الاختبارات بقت 675/675، الـmigrations اتصلّحت، `alreadyPersisted` رجع، `chat/reply` اتنفّذ).

### Q3 — منطق مكرَّر

`evaluateSieAccessRow` متنفّذة مرتين: `sie/sie-integration/sie-entitlement.js:159` (الأصلية، بترجّع `reason` و`remaining`) و`Mad3oom/assets/js/chatbot-mode-service.js` (نسخة محلية بترجّع `statusLabel` بس). متطابقتان سلوكيًا اليوم — قيود `CHECK` بتمنع الانحراف — لكنها نسختان.

### Q4 — لا CI في ريبو SIE

مافيش `.github/workflows` إطلاقًا. 675 اختبار بيعدّوا لكن مافيش حاجة بتفرض ده. مدعوم عنده `codeql.yml` بس. **ومافيش اختبار بيتأكد إن الدالتين مثبَّتتين على نفس الكوميت** — وهي الفجوة اللي سمحت بـI1.

### Q5 — مطابقة الأخطاء بالنص

`access-set.ts:50-57` و`access-reset.ts:32-33` بيقرروا حالة HTTP بـ`message.includes('access denied')`. تعديل نص استثناء في SQL يحوّل 403 لـ500 بصمت. استخدم `SQLSTATE` (الكود بيستخدمه بالفعل في `sie_api_key_*` — `errcode = '42501'`).

### Q6 — أي رسالة من 8 حروف/أرقام بتتبلع كـكود ربط

`channels/core/channel-identity.js`: `extractLinkCode()` بتشتغل **قبل** حلّ الهوية، وبتطابق `/^[A-Z0-9]{8}$/`. عميل **مربوط بالفعل** بيبعت رقم تذكرة زي `AB123456` بياخد «الكود ده مش مظبوط» بدل ما ياخد دعم. الإصلاح: شغّل استخراج الكود للحسابات غير المربوطة فقط، أو اطلب بادئة (`/link AB123456`).

---

## 14. Production Drift

| النوع | التفاصيل |
|---|---|
| **مخطط في الإنتاج غير موجود في أي migration** | `customer_sie_access` · `customer_sie_access_audit` · `sie_customer_memory` · `internal_service_secrets` · `chat_ai_usage_counters` · `sie_api_keys` · `sie_api_requests` — **7 جداول، من ضمنها نظام الصلاحيات كله**. بيئة جديدة من الريبو هتفتقد الجداول دي تمامًا. |
| **migration بيعلن ما ليس في الإنتاج** | `create_chat_engine_scenario_draft`, `create_chat_engine_knowledge_draft` في `sie/observability/migrations/0001` — غير موجودتين في `pg_proc`. الكود اتصلّح ومابقاش يعتمد عليهم، فالملف بقى مضلِّلًا فقط. |
| **قيود ناقصة مقابل النية** | لا UNIQUE على `(scenario_key, version)` / `(knowledge_key, version)` رغم إن `publish_*` بتفترض صفًا واحدًا. |
| **سياسات ناقصة** | `sie_customer_memory` بلا INSERT/UPDATE policy → ميزة الذاكرة مكسورة على الويب بصمت. |
| **انحراف نسخة الكود المنشور** | `sie-api` @ `6c8d164` · `sie-channel-telegram` @ `8252e57` · HEAD = `d265d32`. **مافيش أي نسخة منشورة = HEAD.** |
| **انحراف بين entrypoints** | `index.remote.ts` (المنشور) فيه `readSecret()` و`autoRegisterWebhook()` غير موجودين في `index.ts`. |
| **انحراف تكوين** | `use_published_scenarios` = `true` في الإنتاج، بينما الافتراضي في `settings-schema.js:85` = `false`. الافتراضي في الكود مش بيعكس الإنتاج. |
| **انحراف مفاتيح** | sie-admin على مفتاح anon بصيغة JWT؛ مدعوم على `sb_publishable_`. |
| **الأثر (`turn`)** | `persist_bot_turn` بتاخد `p_turn` وترميه؛ الترقيم بيتشتق من `created_at`، فبيختلف عن `chat_engine_trace_events.turn` في أي محادثة اتنقلت بين محركين أو فيها ردود أدمن. |

---

## 15. Complete Issue Register

| # | المشكلة | النظام | النوع | Severity | Root Cause | Impact | الإصلاح المقترح |
|---|---|---|---|---|---|---|---|
| I1 | نسختان مختلفتان من المحرك في الإنتاج (383 مقابل 650 سيناريو، v2.2 مقابل v2.3) | SIE | Integration | **HIGH** | ترقية الـSHA اتعملت لدالة واحدة بس؛ مافيش اختبار بيربطهم | نفس السؤال، إجابة مختلفة حسب القناة | ثابت واحد للـSHA + اختبار بيفرض التساوي |
| I2 | كتالوج الـ650 غير مستخدَم؛ المحرك بيشخّص بـ7 سيناريوهات، والأدوات بتعرض 650 | SIE | Correctness | **HIGH** | مصدرا كتالوج متوازيان يتحكم فيهم إعداد واحد؛ `listActiveScenarios` مش بتحترمه | 99% من الكتالوج ميت؛ المشغّل مضلَّل | وحّد مصدر الحقيقة؛ خلّي `listActiveScenarios` تقرأ نفس المزوّد |
| S1 | ريبو عام + jsDelivr كمسار تشغيل إنتاجي | SIE | Security/Availability | **HIGH** | CDN عام كآلية توزيع كود | تحويل الريبو لخاص = انقطاع فوري؛ الكود علني | تجميع الأصول في النشر أو Storage خاص |
| R1 | خصم الكوتة قبل نجاح الدور، بلا استرجاع | SIE | Data/Billing | **HIGH** | حدّ المعاملة حوالين الكتابة مش حوالين الدور | استنزاف كوتة العميل بصفر ردود | خصم بعد النجاح، أو RPC استرجاع |
| R2 | إعادة محاولة على timeout بلا idempotency | كلاهما | Reliability | **HIGH** | العقد مافيهوش مفتاح idempotency | كوتة مزدوجة + رد مكرر | `Idempotency-Key` مخزَّن ومُتحقَّق |
| R4 | `index.ts` و`index.remote.ts` اتفرّقوا؛ نشر روتيني بيرجّع سلوك ويغيّر المحرك | SIE | Deployment | **HIGH** | ملفان يدويّان مفروض يفضلوا متطابقين | نشر عادي يكسر القناة | entrypoint واحد |
| S2 | rate-limit على `X-Forwarded-For` + جدول بلا تنظيف | SIE | Security | **HIGH** | أول hop بدل آخر hop موثوق؛ لا سياسة احتفاظ | تجاوز الحد + نمو غير محدود | آخر hop + `pg_cron` تنظيف |
| D1 | 7 جداول إنتاج بلا migration (منها نظام الصلاحيات) | SIE | Drift | **HIGH** | الجداول اتعملت من لوحة Supabase مباشرة | الإنتاج غير قابل لإعادة الإنتاج | استخرج المخطط الحي كـmigration مرجعية |
| S3 | العميل يقدر يزوّر رسائل بوت/أدمن في محادثته | مدعوم | Security | **MEDIUM** | السياسة قيّدت الملكية مش الامتياز | تزوير أدلة نزاع؛ تلويث الأرشيف | امنع `is_*_reply=true` من العميل |
| S4 | العميل يقدر يزوّر آثار التشخيص | SIE | Security/Data | **MEDIUM** | السماح بالكتابة المباشرة بدل RPC | تسميم Review Center والتحقق | حوّل التسجيل لـRPC |
| D6 | `sie_customer_memory` بلا سياسة كتابة → الذاكرة مكسورة على الويب | SIE | Data | **MEDIUM** | السياسات اتكتبت للقراءة بس؛ الخطأ مبلوع | ميزة موعودة لا تعمل | أضف INSERT/UPDATE policy أو RPC |
| S6 | ثلاثة تعريفات للأدمن؛ إيميل واحد يحكم صلاحيات SIE | كلاهما | Security | **MEDIUM** | نمو تدريجي بلا توحيد | فقدان الحساب = فقدان الإدارة نهائيًا | وحّد على دور، لا إيميل |
| S5 | `is_chat_engine_staff()` بـsearch_path متغيّر | SIE | Security | **MEDIUM** | إغفال | دفاع في العمق مفقود | `SET search_path = public` |
| D2/D3 | لا UNIQUE على (key, version) + `RETURNING … INTO` غير STRICT | SIE | Data | **MEDIUM** | القيد اتنسي | نسختان منشورتان بصمت | أضف UNIQUE + `INTO STRICT` |
| D4 | `p_turn` بيتبعت ومابيتخزنش | SIE | Data | **MEDIUM** | العمود مش موجود | replay/shadow-run غلط بصمت | خزّن `turn` أو اشتقّه من مصدر واحد |
| R3 | dedupe تيليجرام في الذاكرة فقط | SIE | Reliability | **MEDIUM** | تجنُّب جدول | دور مكرر عند إعادة الإرسال | جدول dedupe + تنظيف |
| R5 | لا حد معدل على مسار تيليجرام | SIE | Reliability | **MEDIUM** | الـlimiter اتحط في sie-api بس | مسار غير محمي | مرّر نفس `sie_rate_limit_hit` |
| P1 | تراجع زمن الاستجابة 5–10× بعد معمارية الـCDN | SIE | Performance | **MEDIUM** | سحب ~1 ميجا + hop شبكة | +2.5 ثانية لكل دور | تجميع محلي (يعالج S1 كمان) |
| P2 | نداءان + توكنَي rate-limit لكل رسالة | كلاهما | Performance | **MEDIUM** | فحص الصلاحية منفصل عن الرد | الحد الفعلي النص | ضمّ حالة الصلاحية في رد `chat/reply` |
| P3/P4 | trigger إشعارات N× بـcast يعطّل الفهرس | مدعوم | Performance | **MEDIUM** | trigger قديم | تضخيم كتابة على المسار الساخن | إدراج مجمّع + إزالة الـcast |
| Q6 | أي رسالة 8 حروف/أرقام بتتبلع كـكود ربط | SIE | Correctness/UX | **MEDIUM** | الاستخراج قبل حلّ الهوية | عميل مربوط ما بياخدش دعم | طبّقه على غير المربوطين فقط |
| Q1 | عقيدتان معماريتان متناقضتان في الكود | كلاهما | Architecture | **MEDIUM** | غياب وثيقة قاعدة | جذر I1/I2/R4/S1 | `CLAUDE.md` واحدة حاسمة |
| D5 | migration بيعلن دوال غير موجودة في الإنتاج | SIE | Drift | **MEDIUM** | الكود اتصلّح والملف لأ | فخ لأي بيئة جديدة | حدّث أو علّم SUPERSEDED |
| Q5 | مطابقة الأخطاء بالنص | SIE | Code quality | **LOW** | راحة وقتية | 403 بيبقى 500 بصمت | استخدم SQLSTATE |
| Q4 | لا CI في ريبو SIE | SIE | Process | **LOW** | إغفال | 675 اختبار بلا حارس | GitHub Actions + اختبار تطابق SHA |
| R6 | كاش إعدادات في نطاق module داخل serverless | SIE | Reliability | **LOW** | افتراض متصفح | تأخير 60s في الإطفاء | كاش لكل طلب أو TTL أقصر |
| R7 | كتابة `bot_state` مزدوجة على مسار القناة | SIE | Code quality | **LOW** | مسؤولية مزدوجة | كتابة زائدة | احذف `saveState` |
| S7 | CORS بيعكس أي Origin | SIE | Security | **LOW** | تبسيط | دفاع طبقي ملغي | allow-list |
| S8 | صيغتان مختلفتان لمفتاح Supabase | كلاهما | Security | **LOW** | نسخ قديم | خطر تدوير | وحّد الصيغة |
| Q2/Q3 | توثيق قديم + منطق مكرَّر | كلاهما | Code quality | **LOW** | تطوّر سريع | تضليل + خطر انحراف | حدّث واستورد بدل النسخ |
| D7 | مراجع FK غير متسقة (`profiles` مقابل `auth.users`) | SIE | Data | **LOW** | نمو تدريجي | دلالات حذف مختلفة | وحّد المرجع |
| P6 | لا فهرس مركّب `(session_id, created_at)` | مدعوم | Performance | **INFO** | — | ترتيب إضافي | أضف عند التوسّع |

---

## 16. Root Cause Analysis

### الجذر الأول — لماذا نسختان من المحرك في الإنتاج؟

```
المشكلة: تيليجرام بـ383 سيناريو، الموقع بـ650.
  ↓ ليه؟   الدالتان بتستوردا من jsDelivr بـSHA مختلف.
  ↓ ليه؟   ترقية الكتالوج (كوميت 6c8d164) اتعملت على sie-api بس.
  ↓ ليه؟   الـSHA مكتوب حرفيًا في **10 أسطر استيراد منفصلة** عبر ملفين — مفيش مكان واحد يمثّل «نسخة المحرك».
  ↓ ليه؟   استيراد ES الساكن **لازم** يكون نصًا حرفيًا وقت النشر (موثَّق في index.remote.ts) — فمينفعش متغير بيئة ولا ثابت مشترك.
  ↓ ليه؟   المحرك بيتوزّع عبر CDN عام بدل ما يتجمّع في أصل الدالة.
──────────────────────────────────────────────
الجذر: آلية التوزيع (jsDelivr + SHA حرفي) بتخلي «نسخة المحرك» مفهومًا موزّعًا على أسطر نصية مش أصلاً قابلًا للإدارة.
الإصلاح الصحيح: تجميع المحرك في النشر (`supabase functions deploy` من checkout). النسخة تبقى = الكوميت المنشور، تلقائيًا، لكل الدوال. وده بيصلّح S1 وP1 وP5 في نفس الحركة.
الـworkaround (مرفوض كحلّ نهائي): ترقية الـSHA يدويًا في المكانين — نفس الخطأ هيتكرر.
```

### الجذر الثاني — لماذا 650 سيناريو ميتة؟

```
المشكلة: المحرك بيشخّص بـ7 سيناريوهات، والأدوات بتعرض 650.
  ↓ ليه؟   sie_settings.use_published_scenarios = true → المزوّد بيقرا chat_engine_scenarios (7 صفوف).
  ↓ ليه؟   الملف المُجمَّع (650) والجدول (7) **مصدرا حقيقة متوازيان** لنفس البيانات.
  ↓ ليه؟   listActiveScenarios() بتقرا الملف المحلي دايمًا، والبايبلاين بيقرا حسب الإعداد.
  ↓ ليه؟   مافيش مزوّد واحد بيحلّ السؤال «إيه الكتالوج الفعّال؟» لكل القرّاء.
──────────────────────────────────────────────
الجذر: سؤال «أي كتالوج؟» متجاوَب عليه في مكانين مختلفين بمنطق مختلف.
الإصلاح الصحيح: دالة واحدة `resolveScenarioProvider(settings, supabase)` يستعملها **كل** قارئ — البايبلاين وlistActiveScenarios وفحص الصحة ولوحة الأدمن. وقتها الفحص بيبلّغ 7 لو الإنتاج بيستعمل 7، والتناقض يبان فورًا.
```

### الجذر الثالث — لماذا الكوتة بتضيع؟

```
المشكلة: عميل بيتخصم منه بدون ما ياخد رد.
  ↓ ليه؟   tryConsumeSieMessage بتـcommit، وأي فشل بعدها بيرجّع null بلا decrement.
  ↓ ليه؟   الاستهلاك نداء RPC مستقل = معاملة مستقلة.
  ↓ ليه؟   الحدّ الذرّي اتصمّم حوالين **الكتابة** (persist_bot_turn) مش حوالين **الدور**.
  ↓ ليه؟   الاستهلاك اتعامل معاه كبوابة دخول، مش كجزء من وحدة العمل.
──────────────────────────────────────────────
الجذر: حدود المعاملات مرسومة حول العمليات، مش حول الوحدة التجارية (الدور).
الإصلاح الصحيح: نمط حجز/تأكيد — sie_reserve_message() قبل، sie_commit_message() بعد نجاح persist_bot_turn، وانتهاء صلاحية للحجوزات غير المؤكَّدة. نفس قفل for update الموجود بالفعل.
الـworkaround (مقبول مرحليًا): sie_refund_message() في مسار الفشل.
```

---

## 17. Recommended Fix Plan

### P0 — فورًا (نزاهة البيانات وسلامة النشر)

1. **وحّد نسخة المحرك** — رقّي `sie-channel-telegram` لنفس SHA بتاع `sie-api`، وضيف اختبار بيفشل لو الاتنين اختلفوا. *(I1)*
2. **احسم مصدر الكتالوج** — قرّر: الجدول ولا الملف؟ ثم خلّي كل القرّاء يستعملوا نفس المزوّد. لو الجدول هو المقصود، انشر الـ650 فيه. لو الملف، اقفل `use_published_scenarios`. *(I2)*
3. **أصلح ضياع الكوتة** — استرجاع في مسار الفشل كحدّ أدنى. *(R1)*
4. **وحّد entrypoint تيليجرام** — النشر الروتيني حاليًا بيكسر القناة. *(R4)*
5. **استخرج المخطط الحي كـmigration مرجعية** للسبع جداول الناقصة. *(D1)*

### P1 — قبل الإنتاج / الإصدار القادم

6. **`Idempotency-Key` على `/v1/chat/reply`** *(R2)*
7. **rate-limit: آخر hop + `pg_cron` تنظيف** *(S2)*
8. **اقفل `chat_messages` ضد تزوير البوت/الأدمن** *(S3)*
9. **حوّل كتابة `chat_engine_trace_events` لـRPC** *(S4)*
10. **أضف سياسة كتابة لـ`sie_customer_memory`** *(D6)*
11. **`SET search_path = public` على الدوال الثلاث** *(S5)*
12. **UNIQUE على `(scenario_key, version)` و`(knowledge_key, version)` + `INTO STRICT`** *(D2/D3)*
13. **تعريف أدمن موحَّد** — دور بدل إيميل، مع مسار استرجاع *(S6)*
14. **GitHub Actions يشغّل الـ675 اختبار** *(Q4)*

### P2 — مهم وقابل للتأجيل

15. تجميع المحرك في النشر بدل CDN (يعالج S1 + P1 + P5 + الجذر الأول)
16. جدول dedupe لتيليجرام *(R3)* · rate-limit على تيليجرام *(R5)*
17. ضمّ حالة الصلاحية في رد `chat/reply` *(P2)*
18. إصلاح trigger الإشعارات *(P3/P4)*
19. استخراج كود الربط للحسابات غير المربوطة فقط *(Q6)*
20. تخزين `turn` فعليًا *(D4)*

### P3 — تحسينات مستقبلية

21. `CLAUDE.md` واحدة تحسم العقيدة المعمارية *(Q1)* — دي أرخص وقاية من تكرار كل ما سبق
22. SQLSTATE بدل مطابقة النصوص *(Q5)* · CORS allow-list *(S7)* · توحيد صيغة المفتاح *(S8)* · حذف `evaluateSieAccessRow` المكرَّرة *(Q3)* · تحديث التوثيق القديم *(Q2)*

---

## 18. Risk Assessment — ماذا لو لم يُصلَح؟

| لو لم يُصلَح | النتيجة المتوقعة |
|---|---|
| I1 (نسختان) | تقارير أعطال «البوت جاوب غلط» مستحيلة التشخيص — الفرق مش في الكود اللي بتقراه |
| I2 (الكتالوج الميت) | شهور من كتابة السيناريوهات بلا أي أثر على العملاء؛ والفريق مش هيعرف |
| S1 (الريبو العام) | أول قرار «نخلي الريبو خاص» = انقطاع كامل لـSIE على كل القنوات، بدون تغيير كود |
| R1 (الكوتة) | عملاء مدفوعين بيستهلكوا حصتهم بصفر ردود → نزاعات ورد أموال |
| R2 (idempotency) | مع نمو الحمل، cold starts بتكتر، والردود المكررة والخصم المزدوج بيتحوّلوا من نادر لمنتظم |
| R4 (entrypoints) | أول `supabase functions deploy` روتيني بيوقّع قناة تيليجرام |
| D1 (لا migrations) | استحالة بناء staging؛ وأي تعافٍ من كارثة بيتم من backup فقط، بلا مرجع للمخطط |
| S2 (rate-limit) | نمو غير محدود في `sie_rate_limit_buckets` + الحد بلا معنى |
| S3/S4 (التزوير) | أدلة نزاع مفبركة؛ وحلقة تحسين المحرك بتتدرّب على بيانات مسمومة |
| S6 (إيميل واحد) | فقدان الحساب = فقدان دائم للقدرة على إدارة صلاحيات SIE |

---

## 19. Architecture Recommendation

**لا. لا حاجة لإعادة بناء.** ولا حتى لـrefactor كبير.

المحرك (9 modules، 675 اختبار) سليم ومعزول كويس. طبقة `/channels` مصمَّمة بشكل ممتاز — عقد الـadapter (verify/parse/send/typing) وترتيب `handleInbound` (verify → parse → dedupe → resolve → run → send) مبرَّرين سطرًا بسطر وصح. `sie-runtime.js` كواجهة عامة وحيدة قرار صحيح. الكتابات الذرّية عبر RPC صحيحة. مشاركة قاعدة البيانات **مقصودة وصحيحة** ومش عيب.

**اللي محتاج تغيير هو الحوكمة، مش الهيكل:**

| مقترح شائع | الحكم |
|---|---|
| Event-driven architecture | ❌ غير مبرَّر. مافيش fan-out ولا معالجة غير متزامنة مطلوبة. هيضيف تعقيدًا بلا مقابل. |
| API Gateway | ❌ `sie-api` **هي** البوابة بالفعل، ومسؤولياتها واضحة. |
| Synchronization layer | ❌ **مضاد للتصميم.** قاعدة بيانات واحدة = مفيش حاجة تتزامن. إضافة طبقة تزامن هتخترع مشكلة اتحُلّت بالفعل. |
| Shared service | ❌ موجودة (`sie-runtime.js`). |
| Decoupling | ❌ الفصل الحالي كافٍ ومحترَم. |
| **Stronger integration layer** | ✅ **بالمعنى الضيق فقط:** إصدارات محكومة، idempotency، وحدود معاملات صحيحة. |

**التوصية المحدَّدة — ثلاث ضوابط، مش معمارية جديدة:**

1. **مصدر واحد لنسخة المحرك.** التجميع وقت النشر يخلي «النسخة» = الكوميت المنشور تلقائيًا. لحد ما ده يحصل: ثابت واحد + اختبار يفرض التساوي.
2. **مصدر واحد للكتالوج.** دالة `resolveScenarioProvider()` واحدة يستعملها كل قارئ، عشان الفحص واللوحة والمحرك يقولوا نفس الرقم دايمًا.
3. **حدود معاملات حول الدور، مش حول العملية.** حجز/تأكيد للكوتة + idempotency key.

وفوق التلاتة دي: **`CLAUDE.md` واحدة** تحسم «SIE إيه بالظبط بالنسبة لمدعوم؟». التناقض المكتوب حرفيًا في `sie-client.js` مقابل `sie-runtime.js` هو الجذر النهائي لمعظم ما في التقرير ده.

---

## 20. Final Verdict

**هل SIE ومدعوم متكاملان بشكل صحيح؟**
متكاملان **ميكانيكيًا** — المسارات شغّالة، المصادقة سليمة، الكتابات ذرّية، ومشاركة القاعدة قرار صحيح. **لكنهما غير محكومين**: مفيش مصدر حقيقة واحد لنسخة المحرك، ولا للكتالوج، ولا لمخطط قاعدة البيانات.

**أكبر 5 مشاكل**
1. نسختان مختلفتان من المحرك في الإنتاج (383 مقابل 650 سيناريو)
2. كتالوج الـ650 غير مستخدَم؛ المحرك بيشخّص بـ7 والأدوات بتعرض 650
3. الإنتاج معتمد على ريبو GitHub عام + jsDelivr
4. الكوتة بتتخصم قبل نجاح الدور بلا استرجاع
5. `index.ts` و`index.remote.ts` اتفرّقوا — نشر روتيني بيكسر تيليجرام

**أخطر مشكلة على الإطلاق**
**I2 — الكتالوج الميت.** مش لأنها بتكسر حاجة، بل لأنها **مش بتكسر حاجة بشكل مرئي**. الفريق بيكتب سيناريوهات، اللوحة بتقول 650، الفحص بيقول 650، والعملاء بياخدوا 7. مشكلة ساكتة بتضيّع شغل شهور.

**أكثر ما قد يكسر الإنتاج**
**S1 + R4.** تحويل الريبو لخاص = انقطاع فوري وكامل. و`supabase functions deploy sie-channel-telegram` من checkout = قناة تيليجرام تقع. الاتنين إجراءات روتينية تمامًا ومحدش هيتوقع منها ضرر.

**أكثر ما قد يسبب Data inconsistency**
**R2 (لا idempotency) + R1 (لا استرجاع كوتة).** الاتنين بيخلّوا `messages_used` و`chat_messages` يتفرّقوا عن الواقع، والاتنين بيسوءوا مع الحمل مش مع الوقت.

**أكبر Security risk**
**S2 (rate-limit على ترويسة يتحكم فيها العميل + جدول بلا تنظيف)** — الوحيد القابل للاستغلال من مهاجم مجهول تمامًا. بعده S3/S4 (التزوير) — يحتاجان حسابًا مسجَّلًا لكن أثرهما على النزاهة أعمق.
**لا توجد ثغرة تصعيد صلاحيات ولا IDOR:** فحصت الـ11 دالة `SECURITY DEFINER` المتاحة لـ`authenticated` واللي بتاخد `p_user_id` — كلها محروسة صح.

**ما الذي يجب إصلاحه قبل أي تطوير جديد؟**
**بنود P0 الخمسة.** وتحديدًا **رقم 2 (مصدر الكتالوج)** أولًا: أي سيناريو جديد يتكتب قبل حسمه هو شغل ضائع.

---

## What I Would Fix First

| # | المشكلة | السبب الجذري | التأثير | الإصلاح | الخطورة | Migration؟ | تغيير عقد API؟ | تغيير SIE؟ | تغيير مدعوم؟ | تنسيق نشر؟ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | كتالوج الـ650 غير مستخدَم؛ الأدوات بتقول 650 والمحرك بيستعمل 7 | سؤال «أي كتالوج؟» متجاوَب عليه في مكانين | شغل شهور ضائع بصمت | مزوّد واحد يستعمله كل القرّاء + انشر الكتالوج في الجدول أو اقفل الإعداد | **HIGH** | لا (بيانات فقط) | لا | ✅ | لا | لا |
| 2 | نسختان من المحرك في الإنتاج | الـSHA حرفي في 10 أسطر استيراد | إجابات مختلفة حسب القناة | ثابت واحد + اختبار يفرض التساوي؛ ثم التجميع وقت النشر | **HIGH** | لا | لا | ✅ | لا | ✅ نشر الدالتين معًا |
| 3 | `index.ts` ≠ `index.remote.ts` | ملفان يدويّان | نشر روتيني يوقّع تيليجرام | entrypoint واحد، المنطق المشترك في موديول | **HIGH** | لا | لا | ✅ | لا | ✅ |
| 4 | الكوتة بتتخصم بلا استرجاع | حدّ المعاملة حول العملية مش حول الدور | استنزاف كوتة بصفر ردود | حجز/تأكيد (أو استرجاع مرحليًا) | **HIGH** | ✅ RPC جديدة | لا | ✅ | لا | لا |
| 5 | الإنتاج معتمد على ريبو عام + jsDelivr | CDN عام كآلية توزيع | تحويل الريبو لخاص = انقطاع كامل | تجميع في النشر (يعالج الأداء كمان) | **HIGH** | لا | لا | ✅ | لا | ✅ |
| 6 | 7 جداول إنتاج بلا migration | الجداول اتعملت من اللوحة | الإنتاج غير قابل لإعادة الإنتاج | استخرج المخطط الحي كـmigration مرجعية | **HIGH** | ✅ (توثيقية) | لا | ✅ | لا | لا |
| 7 | لا idempotency + إعادة محاولة على timeout | العقد مافيهوش مفتاح | كوتة مزدوجة + رد مكرر | `Idempotency-Key` مخزَّن ومُتحقَّق | **HIGH** | ✅ جدول/عمود | ✅ ترويسة جديدة | ✅ | ✅ | ✅ SIE الأول |
| 8 | rate-limit على `X-Forwarded-For` + بلا تنظيف | أول hop بدل آخر hop | تجاوز الحد + نمو غير محدود | آخر hop + `pg_cron` تنظيف | **HIGH** | ✅ cron job | لا | ✅ | لا | لا |
| 9 | تزوير رسائل البوت/الأدمن وآثار التشخيص | السياسة قيّدت الملكية مش الامتياز | أدلة نزاع مفبركة + تسميم التحقق | اقفل الأعمدة في `WITH CHECK`؛ حوّل الأثر لـRPC | **MEDIUM** | ✅ سياسات | لا | ✅ | لا | لا |
| 10 | ثلاثة تعريفات للأدمن؛ إيميل واحد يحكم SIE | نمو بلا توحيد | فقدان الحساب = فقدان الإدارة نهائيًا | وحّد على دور بمسار استرجاع | **MEDIUM** | ✅ تعديل دوال | لا | ✅ | ✅ | ✅ |

---

*كل بند في هذا التقرير مبني على قراءة الكود المُشار إليه بالملف والسطر، أو على استعلام مباشر على قاعدة الإنتاج. البنود اللي ما قدرتش أتحقق منها بسبب حجب الشبكة معلَّمة صراحةً بـ**Potential issue — requires verification**، ومذكور فيها الأمر اللي يحسمها.*
