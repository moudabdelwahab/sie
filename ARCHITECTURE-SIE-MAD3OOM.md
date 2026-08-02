# معمارية الربط بين `sie` و `mad3oom.online`

> **تاريخ التحليل:** 2026-08-02
> **الريبوهات:** `moudabdelwahab/sie` (فرع `claude/sie-mad3oom-architecture-kop8fe`) و `moudabdelwahab/mad3oom.online` (commit `a5483a0`)
> **قاعدة البيانات:** مشروع Supabase واحد — `srnelrdpqkcntbgudyto` (`info@mad3oom.online's Project`)

---

## 1. الخلاصة السريعة (TL;DR)

**هل الريبوهات مربوطين ببعض؟** — **آه، مربوطين، وبقوة.** الفصل اللي اتعمل كان **فصل ملفات** مش **فصل معماري**. الاتنين لسه بيشتركوا في نفس قاعدة البيانات، ونفس الجداول، ونفس الـ RPCs، وكل واحد فيهم فيه كود بيفترض وجود التاني.

**هل كل حاجة شغالة بسلاسة؟** — **لأ.** الربط حاليًا **مكسور فعليًا في الإنتاج**. لو عميل اختار وضع "محرك الدعم الذكي (SIE)" النهارده، **مش هيوصله أي رد من SIE إطلاقًا** — هيشوف رسالة "محرك الدعم الذكي (SIE) واجه مشكلة مؤقتة في الرد على رسالتك" على كل رسالة يبعتها.

| المحور | الحالة |
|---|---|
| فصل الكود (files/imports) | ✅ اتعمل — مفيش `import` مباشر من mad3oom لكود `/sie` |
| فصل قاعدة البيانات | ❌ **لم يحدث** — جداول SIE عايشة جوه Supabase بتاع مدعوم |
| عقد الـ HTTP API | ❌ **متعارض** — العميل والخادم بيتكلموا مسارات مختلفة |
| مسار الشات الفعلي (`/chat/reply`) | ❌ **غير مطبّق** — بيرجّع `501 Not Implemented` |
| كود الـ API الحي (Edge Function `sie-api`) | ❌ **مش موجود في أي ريبو** — عايش في Supabase بس |
| لوحة الـ Review Center داخل `/sie` | ❌ **مكسورة** — بتـ import ملفات مدعوم |
| اختبارات `/sie` | ⚠️ **6 فشل من 460** |
| استهلاك الكوتة (quota) | ❌ **مش بيحصل** — العدّاد مش بيتحرك أبدًا |

---

## 2. خريطة المكونات الحالية

```
┌───────────────────────────── ريبو mad3oom.online ─────────────────────────────┐
│                                                                               │
│  assets/js/chat-logic.js  ──┐                                                 │
│  chat-widget.js           ──┤                                                 │
│  assets/js/admin/users.js ──┼──► assets/js/sie-client.js ──► sie-config.js     │
│  assets/js/chatbot-mode-service.js ──┘         (البوابة الوحيدة)  (يحدّد الـ URL) │
│                                                        │                      │
└────────────────────────────────────────────────────────┼──────────────────────┘
                                                         │  HTTPS
                                                         │  https://sie.mad3oom.com/api/v1/*
                                                         ▼
                                            ┌───────────────────────┐
                                            │   ؟؟؟ لا يوجد خادم    │   ◄── الحلقة المفقودة
                                            └───────────────────────┘

┌──────────────────────── Supabase (مشروع واحد مشترك) ───────────────────────────┐
│  Edge Function: sie-api      (يخدم /v1/* — مش /api/v1/*)                       │
│      ↳ الكود مش محفوظ في أي ريبو                                               │
│  جداول مدعوم:  chat_messages · chat_sessions · tickets · profiles              │
│  جداول SIE:    customer_sie_access · customer_sie_access_audit                 │
│                chat_engine_trace_events · chat_engine_scenarios                │
│                chat_engine_knowledge_entries · chat_engine_conversation_reviews │
│                chat_engine_validation_runs · chat_engine_publish_overrides      │
│  RPCs:  is_sie_admin · sie_consume_message · sie_admin_set_access               │
│         sie_admin_reset_usage · persist_bot_turn                               │
│         create_ticket_with_message_and_session_update                          │
│         is_chat_engine_staff · publish_chat_engine_scenario/knowledge           │
└───────────────────────────────────────────────────────────────────────────────┘
                                                         ▲
┌──────────────────────────────── ريبو sie ───────────────┼─────────────────────┐
│  /sie/**            محرك خالص (Modules 1-9) — ES modules للمتصفح               │
│  /sie-integration/  bridge بيفترض إنه شغال *جوه* مدعوم على نفس الـ origin ──────┘
│  /index.html        صفحة تسويقية للمحرك                                        │
│  ❌ مفيش package.json · مفيش خادم HTTP · مفيش Dockerfile · مفيش CI · مفيش deploy │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. أربع طبقات ربط — واحدة سليمة وتلاتة مكسورين

### 3.1 طبقة الـ HTTP API — ❌ عقد متعارض

`mad3oom.online/assets/js/sie-client.js` هو **البوابة الوحيدة** لأي كلام مع SIE (وده تصميم سليم ومحترم). لكن المسارات اللي بيناديها مش موجودة في أي مكان:

| ما يناديه العميل (`sie-client.js:48-53`) | ما يخدمه Edge Function `sie-api` | النتيجة |
|---|---|---|
| `GET /api/v1/health` | — لا يوجد مسار health إطلاقًا | **404** |
| `GET /api/v1/admin/is-admin` | `GET /v1/admin/is-admin` | يشتغل **فقط** لو فيه rewrite يشيل `/api` |
| `GET /api/v1/access/{userId}` | `GET /v1/access/status?userId=` | **404** — شكل مختلف تمامًا |
| `POST /api/v1/admin/access` | `POST /v1/access/set` | **404** |
| `POST /api/v1/admin/access/reset-usage` | `POST /v1/access/reset` | **404** |
| `POST /api/v1/chat/reply` | `POST /v1/chat/reply` → **`501 not_implemented`** | **لا يعمل** |

### 3.2 طبقة الاستضافة (Hosting) — ❌ حلقة مفقودة

- `sie-config.js` بيوجّه كل الطلبات على `https://sie.mad3oom.com` (production).
- الدومين ده **بيـ resolve فعلاً على Vercel** (`4dd359f07142f8f2.vercel-dns-017.com`)، يعني فيه deployment موجود.
- لكن ريبو `sie` **مالوش أي backend خالص**: مفيش `package.json`، مفيش `vercel.json`، مفيش serverless functions، مفيش Dockerfile. أقصى حاجة ممكن الدومين ده يخدمها هي `index.html` (صفحة تسويقية) والملفات الساكنة.
- `vercel.json` بتاع مدعوم فيه rewrites للـ OAuth والـ MCP بس — **مفيش أي rewrite لـ `/api/v1/*` ناحية `sie-api`**.
- ملاحظة إضافية: `sie-config.js` بيستخدم دومين `mad3oom.com`، بينما الموقع الأساسي على `mad3oom.online`. الدومينين مختلفين ولازم يتأكد أنهم مقصودين.

**الخلاصة:** حتى لو المسارات اتظبطت، مفيش حاجة على `sie.mad3oom.com` بتخدم `/api/v1/*`.

### 3.3 طبقة قاعدة البيانات — ⚠️ مشتركة بالكامل (أخطر ربط خفي)

ده الربط اللي **لم ينفصل إطلاقًا**، ومش ظاهر في الكود:

- جداول SIE (`customer_sie_access`، `chat_engine_*`) عايشة **جوه نفس مشروع Supabase** بتاع مدعوم، جنب `chat_messages` و`tickets` و`profiles`.
- `sie_consume_message` بيرفض أي نداء `p_user_id <> auth.uid()` → يعني **مينفعش** يتنادى بـ service-role من خادم SIE مستقل. مربوط إجباريًا بجلسة العميل نفسه.
- `persist_bot_turn` و`create_ticket_with_message_and_session_update` بيكتبوا مباشرة في `chat_messages`/`chat_sessions`/`tickets` بتوع مدعوم، ومعتمدين على RLS و`auth.uid()`.
- `is_sie_admin()` فيها إيميل مدعوم متكتوب حرفيًا في الـ SQL:
  ```sql
  return coalesce((select email from auth.users where id = auth.uid())
                  = 'support@mad3oom.online', false);
  ```
- `is_chat_engine_staff()` بتقرأ `profiles.role` بتاع مدعوم.

**يعني: SIE مش "منتج مستقل" على مستوى البيانات — هو schema جوه قاعدة بيانات مدعوم.** أي خطة لفصل حقيقي لازم تتعامل مع ده أولًا.

### 3.4 طبقة الـ imports المباشرة — ✅ سليمة من ناحية مدعوم / ❌ مكسورة من ناحية sie

- ✅ **مدعوم نضيف**: مفيش ولا `import` واحد من كود `/sie` جوه ريبو مدعوم. القاعدة المكتوبة في `sie-client.js` (كل تعامل عبر HTTP بس) محترمة فعليًا.
- ❌ **ريبو sie مش نضيف**: فيه ملفات لسه بتـ import من مدعوم:
  - `sie/observability/admin-ui/review-center.js:1` → `import ... from '/assets/js/admin/auth.js'`
  - `sie/observability/admin-ui/review-center.js:2` → `import ... from '/assets/js/admin/sidebar.js'`
  - `sie/observability/admin-ui/review-center.js:3` → `import { supabase } from '/api-config.js'`
  - `review-center.html` بيحمّل `/styles.css`, `/robot.css`, `/theme-manager.js`, `/error-tracker.js`, `/assets/images/logo.png` — كلها ملفات مدعوم.

  الملفات دي **مش موجودة في ريبو sie**، فالصفحة دي مكسورة تمامًا لو اتنشرت من ريبو sie لوحده.

---

## 4. المشكلات مرتبة حسب الخطورة

### 🔴 P0 — الشات بـ SIE لا يعمل إطلاقًا في الإنتاج

`POST /v1/chat/reply` في Edge Function `sie-api` بيرجّع صراحة:

```json
{ "error": "not_implemented",
  "message": "POST /v1/chat/reply is staged for the next deployment of this API." }
```

والتعليق في الكود بيقول إن الـ pipeline كامل (~30 ملف تحت `/sie`) لسه محتاج يتنقل لـ Deno.

**الأثر على العميل:** في `chat-logic.js:697-706`، لما `getSieReply()` ترجّع `null` بيتكتب في المحادثة:
> «محرك الدعم الذكي (SIE) واجه مشكلة مؤقتة في الرد على رسالتك. جرّب تبعتها تاني...»

ده مش "مؤقت" — ده **دائم** طول ما المسار مش متطبّق. أي عميل اتفعّل له SIE (فيه **صفّين** فعلاً في `customer_sie_access`) بيقع في اللوب ده.

### 🔴 P0 — كود الـ API الحي غير محفوظ في أي ريبو

Edge Function `sie-api` (v2، آخر تعديل 2026) فيها 9 ملفات TypeScript حقيقية:
`index.ts`, `_shared/cors.ts`, `_shared/http.ts`, `_shared/supabase-client.ts`,
`handlers/{is-admin,access-status,access-set,access-reset,chat-reply}.ts`.

بحثت في **الريبوهين** — الكود ده **مش موجود في ولا واحد منهم**. مفيش مجلد `supabase/functions/` أصلاً في مدعوم.

**المخاطر:** مفيش code review، مفيش history، مفيش rollback، مفيش CI. أي حد بـ deploy جديد بيمسح النسخة الحالية بدون أثر. **ده أخطر بند في التقرير كله من ناحية استمرارية التشغيل.**

### 🔴 P0 — كل مسارات الـ API متعارضة (ما عدا واحد)

راجع الجدول في القسم 3.1. النتيجة العملية:
- **لوحة الأدمن** (`assets/js/admin/users.js`) — تفعيل/تعطيل SIE لعميل، وتصفير الاستخدام: **كلها بتفشل بصمت** (الدوال بترجّع `{ error }` وبتـ warn في الـ console بس).
- **قائمة اختيار وضع الشات** (`chatbot-mode-service.js:244`) — بتقرأ حالة الصلاحية عن طريق `getSieAccessStatus` اللي بينادي مسار غلط → بيرجّع `null` → `getSieAccessInfo` بترجّع `available: false` → **خيار SIE مش هيظهر للعميل أصلًا**.

الجانب الإيجابي الوحيد: كل الدوال دي **fail-closed** بتصميم واعي، فمفيش انهيار في الواجهة — بس مفيش وظيفة كمان.

### 🟠 P1 — تعارض جذري في عقد "مين بيكتب في قاعدة البيانات"

فيه **تصميمين متناقضين** لنفس العملية:

| | `sie-integration/sie-chat-bridge.js` (ريبو sie) | `chat-logic.js` (مدعوم) |
|---|---|---|
| مين بيكتب `chat_messages`؟ | **SIE نفسه** عبر `executeDecision()` | **مدعوم** عبر `.insert()` مباشر |
| مين بيحدّث `bot_state`؟ | SIE (جوه الـ RPC، atomically) | مدعوم (`chat-logic.js:714`) |
| شكل الـ return | `{ reply, options, alreadyPersisted: true, ticketNumber }` | متوقع `{ reply, options, botState }` |
| الوصول لـ Supabase | بياخد `supabase` client كـ parameter | SIE مفروض **مالوش** وصول |
| استهلاك الكوتة | `tryConsumeSieMessage()` جوه الـ bridge | مفيش — فحص قراءة بس |

`sie-integration/` **مكتوب للمعمارية القديمة** (SIE جوه مدعوم على نفس الـ origin). حتى الـ imports بتاعته بتثبت ده:
```js
import { normalize } from '/sie/language/normalizer.js';   // مسار absolute على نفس الـ origin
```
ده **ميشتغلش** لو SIE مستضاف على دومين تاني، وميشتغلش خالص جوه Deno Edge Function.

**قرار مطلوب:** يا إما `sie-integration/` يتحوّل لـ Deno adapter حقيقي جوه SIE، يا إما يتشال لأنه بقى تراث معماري مضلّل.

### 🟠 P1 — الكوتة مش بتتخصم أبدًا

`sie_consume_message` هي المكان الوحيد اللي بيزوّد `messages_used`. راجعت الريبوهين:
- في مدعوم: **صفر نداءات** لها.
- في `sie-api` Edge Function: **صفر نداءات** لها (كانت مفروض تتنادى من `chat-reply` غير المطبّق).
- في `sie-integration/sie-entitlement.js`: موجودة — بس الملف ده مش بيتنادى من حتة شغالة.

**الأثر:** لو `/chat/reply` اتطبّق من غير ما ينادي `sie_consume_message`، عملاء `access_mode = 'quota'` هيبقى عندهم **استخدام غير محدود**. مشكلة فوترة/إساءة استخدام مباشرة.

كمان `sie_consume_message` **بيستهلك رسالة حتى لو الرد فشل بعد كده** (الـ bridge بينادي الـ gate الأول، وبعدين لو الـ pipeline رمى exception بيرجّع `null`) — يعني العميل بيخسر من كوتته من غير ما ياخد رد.

### 🟠 P1 — لوحة الـ Review Center مكسورة ومش موصولة

`sie/observability/admin-ui/review-center.{html,js,css}` (~600 سطر) فيها واجهة كاملة لـ Review Center + Validation Lab + إدارة صلاحيات العملاء. لكن:
- بتـ import من `/assets/js/admin/auth.js` و`/assets/js/admin/sidebar.js` و`/api-config.js` → **مش موجودين في ريبو sie**.
- بتـ import من `/sie-integration/sie-entitlement.js` → اللي بينادي الـ RPCs مباشرة (تعارض مع قاعدة "كل حاجة عبر HTTP").
- بحثت في ريبو مدعوم: **مفيش أي لينك ليها** من أي صفحة أدمن.

يعني: كود موجود، شغال معماريًا في المكان الغلط، ومش قابل للتشغيل في أي من الاتنين حاليًا.

### 🟡 P2 — ملفات الـ migrations في ريبو sie **مش مطابقة** للقاعدة الحية

`sie/action/migrations/0001_...sql` بتقول:
```sql
insert into chat_messages (session_id, turn, sender, text, created_at)
values (p_session_id, p_turn, 'bot', p_message_text, now());
```
لكن **الأعمدة دي مش موجودة**. الأعمدة الحقيقية في `chat_messages` هي:
`id, session_id, sender_id, message_text, is_bot_reply, is_admin_reply, created_at, image_url, audio_url`

النسخة **الحية** من `persist_bot_turn` مختلفة تمامًا (بتستخدم `is_bot_reply`، بترجّع `jsonb` مش `void`، وفيها `raise exception` لو الجلسة مش بتاعة المستخدم).

فروق مؤكدة تانية:

| البند | ملف migration في ريبو sie | القاعدة الحية |
|---|---|---|
| `is_chat_engine_staff()` | `profiles.role = 'staff'` | `profiles.role in ('admin','support','super_user')` |
| `chat_engine_scenarios` | عمود `author_note` | عمود `notes` |
| `chat_engine_scenarios` | `unique (scenario_key, version)` | **لا يوجد** — PK على `id` بس |
| `chat_engine_knowledge_entries` | عمود `definition` | عمود `content` |
| `publish_chat_engine_scenario` | 3 معاملات (`+ p_override_reason`) | **2 معاملات فقط** |
| `create_chat_engine_*_draft` RPCs | موجودة في الـ migration | **غير موجودة في القاعدة** |
| `persist_bot_turn` | `returns void` | `returns jsonb` |

الخبر الحلو: ملفات `*.supabase.js` (الـ ports) **اتصلّحت فعلاً** ضد القاعدة الحية (شايف commits `df7bfe4`, `800b1a6`, `cfb93a9`).
الخبر الوحش: **ملفات الـ migration نفسها ما اتحدّثتش**، فأي حد يشغّلها على بيئة جديدة هيبني schema غلط تمامًا. **دي فخ حقيقي لأي staging/dev environment.**

### 🟡 P2 — 6 اختبارات فاشلة من 460

```
# tests 460 | pass 454 | fail 6
```

كلها في اختبارات الـ Supabase adapters، والسبب: **الـ fixtures بتاعة الاختبارات ما اتحدّثتش** مع تصليحات الـ ports:

| الاختبار | السبب |
|---|---|
| `knowledge/tests/static-knowledge-supabase.test.mjs` (4 اختبارات) | الـ fixture بتحط `definition:` والقارئ بقى بيقرا `content:` |
| `observability/tests/observability-read-port-supabase.test.mjs` (2 اختبار) | الـ fixture بتحط `{ turn, sender, text }` والقارئ بقى بيقرا `{ message_text, is_bot_reply, is_admin_reply, created_at }` |

مش أخطاء في كود الإنتاج — أخطاء في بيانات الاختبار. تصليحها شغل بسيط بس لازم يتعمل، لأن حاليًا **الـ 6 اختبارات دي بتخفي تغطية حقيقية للمسارات دي**.

### 🟡 P2 — بديل الـ turn number ضاع

الـ RPC الحية `persist_bot_turn` بتاخد `p_turn` **وما بتكتبهوش في أي مكان**. فمفيش رقم turn محفوظ في `chat_messages`. الحل الحالي في `observability-read-port.supabase.js` بيشتقّ الـ turn من ترتيب `created_at`.

**كسر محتمل:** لو محادثة اتنقلت بين المحركين (تقليدي ↔ SIE)، أو فيها ردود أدمن في النص، الترقيم المشتق ده **مش هيطابق** الترقيم المحفوظ في `bot_state.sie.turnCount` ولا اللي في `chat_engine_trace_events.turn`. أي replay أو shadow-run على المحادثات دي هيدّي نتائج غلط بصمت.

### 🟢 P3 — ملاحظات أصغر

- **تضارب في مفهوم "الأدمن"**: `is_sie_admin()` = إيميل واحد (`support@mad3oom.online`)، بينما `review-center.js` بيتحقق من `user.profile?.role === 'admin'`، و`is_chat_engine_staff()` بتقبل 3 أدوار. تلات تعريفات مختلفة لنفس السؤال.
- **`internal_service_secrets`** (صفّين) موجود في القاعدة — يبان إنه لآلية service-to-service للـ SIE، بس مفيش أي كود في أي ريبو بيقراه. لازم يتراجع أو يتشال.
- **`CHATBOT_MODES.SIE`**: `sie-integration/README.md` بيقول صراحة "متستخدمهوش، ده placeholder منفصل". بينما مدعوم **بيستخدمه فعلاً** كبوابة أولى (`chat-logic.js:679`). التوثيق في ريبو sie **قديم ومضلّل**.
- **مفيش `CLAUDE.md`** ولا وثيقة قواعد معمارية في أي من الريبوهين، رغم إن `sie-config.js` بيشير لواحدة ("see architecture rules in CLAUDE.md"). القاعدة المعمارية عايشة في تعليقات متفرقة بس.
- **مفيش CI** في ريبو sie — مفيش `.github/workflows`، فالـ 6 اختبارات الفاشلة مكنش فيه حاجة تمسكها.

---

## 5. الحاجات اللي **شغالة** فعلاً (عشان الصورة تبقى كاملة)

مهم نقول إن الشغل ده مش كله مكسور — فيه أساس قوي:

- ✅ **454 اختبار ناجح** بيغطوا كل الـ 9 modules بمنطق حقيقي (Language, Scenarios, Diagnostics, Ranking, Decision, Dialogue, Knowledge, Action, Observability).
- ✅ **`sie-client.js` تصميم ممتاز**: بوابة واحدة، circuit breaker، timeouts، retry واحد للأخطاء المؤقتة، تحقق من شكل الرد، fail-closed في كل دالة، ومش بيـ log التوكن أبدًا.
- ✅ **الحدود المعمارية محترمة من ناحية مدعوم** — صفر imports لكود SIE.
- ✅ **أمان الـ Edge Function صح**: JWT العميل بيتمرّر كما هو (مش service-role)، و`verify_jwt: true`، والـ OPTIONS بيتعامل قبل الـ auth، وكل قرارات الصلاحية سايبة للقاعدة.
- ✅ **الـ RPCs الحية متينة**: `sie_consume_message` فيها `for update` (قفل الصف) فمفيش double-spend من تابين مفتوحين، وفيها فحص `auth.uid()`.
- ✅ **UX سليم عند سحب الصلاحية وسط محادثة**: `handleSieRevokedMidConversation()` بتبلّغ العميل بوضوح وبتحفظ تحويله للوضع التقليدي في القاعدة، مش محليًا بس.
- ✅ **البيانات موجودة**: 7 سيناريوهات + 9 مدخلات معرفة **منشورة فعلاً** في `chat_engine_scenarios` / `chat_engine_knowledge_entries`، و4 trace events، وصفّين صلاحية.

**يعني: المحرك جاهز. الأنبوبة اللي توصّله بمدعوم هي اللي ناقصة.**

---

## 6. خطة الإصلاح المقترحة

### المرحلة صفر — إنقاذ فوري (قبل أي حاجة تانية)

1. **انسخ كود Edge Function `sie-api` لريبو `sie`** تحت `supabase/functions/sie-api/`. الكود ده حاليًا في نسخة واحدة على السيرفر ومفيش نسخة احتياطية.
2. **حدّث ملفات الـ migrations** في `sie/action/migrations/` و`sie/observability/migrations/` عشان تطابق القاعدة الحية، أو علّم عليها بوضوح `-- SUPERSEDED — لا تشغّلها`.

### المرحلة الأولى — رجّع الوظايف اللي مش محتاجة `/chat/reply`

3. **وحّد مسارات الـ API.** أسهل حل وأقلّه مخاطرة: عدّل `SIE_ENDPOINTS` في `sie-client.js:47-54` تطابق الموجود فعلاً في `sie-api`:
   ```js
   HEALTH:             `/${API_VERSION}/health`,
   IS_ADMIN:           `/${API_VERSION}/admin/is-admin`,
   ACCESS_STATUS:      (userId) => `/${API_VERSION}/access/status?userId=${encodeURIComponent(userId)}`,
   ADMIN_SET_ACCESS:   `/${API_VERSION}/access/set`,
   ADMIN_RESET_USAGE:  `/${API_VERSION}/access/reset`,
   CHAT_REPLY:         `/${API_VERSION}/chat/reply`
   ```
   (البديل — تغيير الـ Edge Function — بيعقّد الأمور أكتر لأنه بيحتاج rewrite layer برضه.)
4. **ضيف مسار `/v1/health`** للـ Edge Function — دلوقتي بيرجّع 404 والـ circuit breaker بيتقفل بالغلط.
5. **اظبط الاستضافة.** قرار مطلوب بين:
   - **(أ)** خلّي `sie-config.js` يوجّه مباشرة على `https://srnelrdpqkcntbgudyto.supabase.co/functions/v1/sie-api` (أبسط وأسرع)، أو
   - **(ب)** ضيف rewrite في `vercel.json` بتاع الدومين اللي بيخدم `sie.mad3oom.com` يوجّه `/api/v1/*` ← الـ Edge Function (بيحافظ على شكل الـ URL النضيف).
   - كمان: **أكّد الدومين** — `mad3oom.com` ولا `mad3oom.online`؟
6. بعد الخطوات دي: **لوحة الأدمن وقائمة اختيار الوضع هيرجعوا يشتغلوا فورًا**.

### المرحلة التانية — طبّق `/chat/reply` (الشغل الكبير)

7. انقل الـ pipeline (~30 ملف تحت `/sie`) لـ Deno جوه `sie-api`. الملفات JS خالص من غير dependencies فالنقل مباشر نسبيًا.
8. بدّل الـ providers من JSON محلي ← `chat_engine_scenarios` / `chat_engine_knowledge_entries` (`.supabase.js` جاهزين ومصلّحين).
9. **نادِ `sie_consume_message` جوه الـ handler** — دي البند اللي هيمنع استهلاك بلا حدود.
10. **احسم عقد الكتابة.** التوصية: خلّي الـ Edge Function هو اللي يكتب (عن طريق `persist_bot_turn`)، وسيب `chat-logic.js` يتخطّى الـ insert بتاعه — أفضل من الوضع الحالي لأنه بيدّي **ذرّية حقيقية** للتذاكر (رسالة + تذكرة + حالة جلسة في transaction واحدة). ولو اتقرر إن مدعوم هو اللي يكتب، لازم `persist_bot_turn` ما تتناداش من ناحية SIE خالص، وإلا هيحصل **كتابة مزدوجة** لكل رسالة.
11. **قرّر مصير `sie-integration/`** — يتحوّل لـ adapter لـ Deno، أو يتشال. سيبانه زي ما هو بيضلّل أي حد جاي جديد على المشروع.

### المرحلة التالتة — النضافة

12. صلّح الـ 6 fixtures الفاشلة.
13. ضيف GitHub Actions يشغّل `node --test "sie/**/tests/*.test.mjs"` على كل PR.
14. اتخلص من الـ imports المكسورة في `review-center.js`/`.html` (تخدمها من مدعوم، أو تخلّيها self-contained في sie).
15. وحّد تعريف "الأدمن" في مكان واحد.
16. اكتب `CLAUDE.md` في الريبوهين بالقاعدة المعمارية الصريحة: **"كل تعامل بين مدعوم و SIE عبر HTTP بس، والبوابة الوحيدة هي `sie-client.js` من ناحية، و`sie-api` من الناحية التانية."**
17. **قرار استراتيجي:** قاعدة البيانات المشتركة. طول ما جداول SIE جوه Supabase بتاع مدعوم، "المنتج المستقل" ده مجازي مش حقيقي. لو الاستقلال الحقيقي هدف، ده أكبر بند متبقّي — ولو مش هدف، الأحسن يتوثّق صراحة عشان مايفضلش الكود بيدّعي حاجة مش صح.

---

## 7. Checklist للتحقق النهائي

| # | التحقق | الحالة |
|---|---|---|
| 1 | كود `sie-api` محفوظ في git | ❌ |
| 2 | مسارات `sie-client.js` = مسارات `sie-api` | ❌ |
| 3 | `sie.mad3oom.com` بيخدم `/api/v1/*` | ❌ |
| 4 | `/v1/health` موجود | ❌ |
| 5 | `/v1/chat/reply` مطبّق | ❌ (501) |
| 6 | `sie_consume_message` بتتنادى من مسار حي | ❌ |
| 7 | مفيش كتابة مزدوجة في `chat_messages` | ⚠️ يعتمد على قرار البند 10 |
| 8 | ملفات migrations = القاعدة الحية | ❌ |
| 9 | كل اختبارات `/sie` بتعدّي | ❌ (454/460) |
| 10 | مفيش imports مكسورة في ريبو sie | ❌ (`review-center.js`) |
| 11 | مدعوم مش بيـ import كود SIE | ✅ |
| 12 | fail-closed في كل مسارات SIE | ✅ |
| 13 | الـ Edge Function بتمرّر JWT العميل مش service-role | ✅ |
| 14 | RLS مفعّلة على كل جداول SIE | ✅ |
| 15 | تعريف موحّد للأدمن | ❌ (3 تعريفات) |
| 16 | CI بيشغّل الاختبارات | ❌ |
| 17 | قاعدة بيانات منفصلة لـ SIE | ❌ (قرار استراتيجي) |

---

## 8. إجابة السؤال الأصلي في سطرين

المشروعين **اتفصلوا في الملفات بس، مش في المعمارية**. الحدود على مستوى الكود اتعملت صح ومحترمة من ناحية مدعوم، لكن **الأنبوبة اللي كانت شايلة الوظيفة (استدعاء دالة محلية) اتشالت ومحطّش مكانها حاجة شغالة** — لا خادم HTTP، ولا مسارات متطابقة، ولا مسار شات مطبّق — بينما **قاعدة البيانات فضلت مشتركة بالكامل**.

النتيجة: **SIE مش شغال في الإنتاج دلوقتي**، والوصول لسلاسة حقيقية محتاج المرحلتين صفر و1 من الخطة فوق كحد أدنى عشان الأدمن ترجع تشتغل، والمرحلة 2 عشان العملاء يشوفوا ردود SIE فعلاً.

---

### ملاحظة عن نطاق التحقق

كل الأرقام والأسماء والتوقيعات في التقرير ده متحقّق منها **فعليًا**: قراءة الكود في الريبوهين، استعلامات SQL مباشرة على القاعدة الحية (`information_schema`, `pg_proc`, `pg_constraint`)، قراءة كود Edge Function من Supabase، وتشغيل اختبارات `/sie` محليًا.

الاستثناء الوحيد: **لم أستطع فحص `https://sie.mad3oom.com` بـ HTTP** — سياسة الشبكة في بيئة التشغيل دي بترفض الاتصال بالدومين ده وبـ `srnelrdpqkcntbgudyto.supabase.co` (403 من الـ proxy). فالاستنتاج إن الدومين مفيهوش `/api/v1/*` مبني على غياب أي backend في ريبو sie وغياب أي rewrite في `vercel.json` — **ينفع يتأكد بسطر واحد**:

```bash
curl -i https://sie.mad3oom.com/api/v1/health
```
