# معمارية الربط بين `sie` و `mad3oom.online`

> **تاريخ التحليل:** 2026-08-02
> **الريبوهات:** `moudabdelwahab/sie` (فرع `claude/sie-mad3oom-architecture-kop8fe`) و `moudabdelwahab/mad3oom.online` (commit `a5483a0`)
> **قاعدة البيانات:** مشروع Supabase واحد — `srnelrdpqkcntbgudyto`
> **النية المعمارية المؤكَّدة من صاحب المشروع:** SIE **ليس** منتجًا مستقلًا. هو **مربوط بمنصة مدعوم ويشترك معها في نفس قاعدة البيانات**.

---

## 1. الخلاصة السريعة (TL;DR)

**هل الريبوهين مربوطين؟** — آه، ولازم يفضلوا مربوطين. الاشتراك في قاعدة البيانات **مقصود وصحيح**، مش عيب.

**هل كل حاجة شغالة بسلاسة؟** — **لأ.** والسبب مش إن الربط ناقص، السبب إن **طبقة ربط جديدة اتبنت على افتراض غلط**.

الفصل اللي اتعمل في 23 يوليو كان **نقل ملفات** من ريبو مدعوم لريبو `sie`. النقل ده كسر الـ imports المباشرة اللي كانت شغالة. وبدل ما المسار اللي بيخدم الملفات يترجّع، اتكتبت في 25 يوليو طبقة HTTP جديدة (`sie-client.js` + `sie-config.js`) مبنية على مقدمة مكتوبة حرفيًا في الكود:

> *"SIE is a fully independent product — it is not embedded in this repository, and per the platform's architecture rules Mad3oom must never import SIE source code."*
> — `assets/js/sie-client.js:6-9`

**المقدمة دي مخالفة لنية المشروع.** والطبقة المبنية عليها **ما اكتملتش أصلًا** — مسار الشات فيها بيرجّع `501`. فالنتيجة إن SIE **مش شغال في الإنتاج دلوقتي**، وكمان **إدارة الصلاحيات في لوحة الأدمن واقفة**.

| المحور | الحالة | ملاحظة |
|---|---|---|
| اشتراك قاعدة البيانات | ✅ **مقصود وسليم** | مش مشكلة — ده التصميم المطلوب |
| منطق المحرك `/sie` (Modules 1-9) | ✅ سليم | 454 اختبار ناجح |
| طبقة الربط `/sie-integration` | ✅ **سليمة ومكتوبة صح للنموذج المقصود** | بس مش متوصّلة |
| مسار خدمة الملفات (serving) | ❌ **مكسور** | `/sie/*` و `/sie-integration/*` مش متاحين من origin مدعوم |
| طبقة HTTP (`sie-client` + `sie-api`) | ❌ **زيادة عن الحاجة ومكسورة** | مبنية على افتراض مرفوض |
| شات SIE في الإنتاج | ❌ **لا يعمل إطلاقًا** | `501 not_implemented` |
| لوحة أدمن SIE | ❌ **لا تعمل** | مسارات API متعارضة |
| استهلاك الكوتة | ❌ **لا يحدث** | العدّاد واقف |
| ملفات الـ migrations | ❌ مش مطابقة للقاعدة الحية | مستقلة عن النموذج |
| اختبارات `/sie` | ⚠️ 6 فشل من 460 | مستقلة عن النموذج |

---

## 2. التسلسل الزمني — إيه اللي حصل بالظبط

ده متتبَّع من git history بتاع ريبو مدعوم، مش استنتاج:

| التاريخ | الـ commit | الحدث |
|---|---|---|
| قبل 23/7 | — | `sie/` و `sie-integration/` **جوه ريبو مدعوم**. `chat-logic.js` بيعمل `import { getSieReply } from '/sie-integration/sie-chat-bridge.js'` — **وكان شغال** |
| 2026-07-23 | `e3e7291` | `Delete sie-integration directory` |
| 2026-07-23 | `d6ca1e7` | `Delete sie directory` |
| 2026-07-25 | `6d490cb` | `Add sie-client.js for SIE API integration` |
| 2026-07-25 | `d1485ad` | `Refactor sie-client.js for improved API handling` |

الكود القديم نفسه بيوثّق إن الربط كان مكتمل:

```js
// chatbot-mode-service.js (النسخة القديمة، سطر 219)
* الآن SIE مربوط فعليًا (تم دمج /sie و /sie-integration في المشروع).
```

**الاستنتاج:** طبقة الـ HTTP مكنتش قرار معماري مدروس — كانت **رد فعل على imports اتكسرت** بعد نقل الملفات بيومين. والافتراض اللي اتكتب عشان يبررها ("منتج مستقل") هو عكس نية المشروع.

---

## 3. النموذجان: المقصود مقابل الحالي

### النموذج المقصود (وكان شغال قبل 23 يوليو)

```
مدعوم (نفس الـ origin)
  chat-logic.js ──import──► /sie-integration/sie-chat-bridge.js ──import──► /sie/**
  chat-widget.js ──import──►         │
  admin/users.js ──import──► /sie-integration/sie-entitlement.js
  chatbot-mode-service.js ──┘        │
                                     ▼
                        Supabase المشترك (نفس المشروع)
                        sie_consume_message · persist_bot_turn
                        create_ticket_with_message_and_session_update
```

بسيط. مفيش شبكة. مفيش latency. مفيش circuit breaker. مفيش خادم لازم يتصان. والكتابة **ذرّية** (رسالة + تذكرة + حالة جلسة في transaction واحدة).

### النموذج الحالي (مكسور)

```
مدعوم
  chat-logic.js ──► sie-client.js ──► sie-config.js ──► https://sie.mad3oom.com/api/v1/*
                                                              │
                                                              ▼
                                                    ❌ مفيش حاجة بتخدم المسار ده
                                                       (ريبو sie مالوش backend خالص)

  Edge Function sie-api (موجودة في Supabase، مش في أي ريبو)
      يخدم /v1/* — مسارات مختلفة عن اللي العميل بيناديها
      /v1/chat/reply → 501 not_implemented
```

---

## 4. جوهر المشكلة

**طبقة HTTP كاملة اتبنت عشان تحل مشكلة مش موجودة أصلًا.**

طول ما SIE مربوط بمدعوم وبيشترك معاه في نفس قاعدة البيانات، **مفيش أي داعي** لـ:
- خادم HTTP مستقل
- `sie-config.js` (اكتشاف بيئات + دومينات منفصلة)
- `sie-client.js` (circuit breaker + retries + timeouts + تحقق من شكل الرد)
- Edge Function `sie-api`
- تمرير JWT بين خدمتين

ده كله تعقيد **بيحل مشكلة الاستقلال** — واللي هي مش مطلوبة. والدليل الأقوى: `sie_consume_message` نفسها **بترفض** أي نداء من خدمة مستقلة:

```sql
if p_user_id is null or p_user_id <> auth.uid() then
    return query select false, 'unauthorized'::text, null::integer;
```

يعني القاعدة نفسها متصمَّمة على أساس إن اللي بينادي هو **جلسة العميل نفسها** — مش خدمة خارجية. المعمارية الحقيقية للبيانات بتقول "مربوط"، والكود الجديد بيقول "مستقل". التعارض ده هو أصل كل الأعطال.

---

## 5. المشكلات

### القسم أ — مشكلات ناتجة عن الافتراض الغلط (بتتحل بالرجوع للنموذج المقصود)

#### 🔴 A1 — شات SIE مش شغال إطلاقًا في الإنتاج

Edge Function `sie-api` بترجّع صراحة على `/v1/chat/reply`:

```json
{ "error": "not_implemented",
  "message": "POST /v1/chat/reply is staged for the next deployment of this API." }
```

**الأثر:** في `chat-logic.js:697-706`، لما `getSieReply()` ترجّع `null` بيتكتب في المحادثة:
> «محرك الدعم الذكي (SIE) واجه مشكلة مؤقتة في الرد على رسالتك. جرّب تبعتها تاني...»

ده **مش مؤقت — دايم**. وفيه **صفّين فعليًا** في `customer_sie_access`، يعني فيه عملاء واقعين في اللوب ده النهارده.

التعليق جوه `chat-reply.ts` بيقول إن التطبيق محتاج "porting the full pipeline (~30 files under /sie) into this Deno function" — **شغل ضخم مش محتاجينه أصلًا في النموذج المقصود، لأن الـ pipeline ده شغال وجاهز في `/sie` من غير أي نقل**.

#### 🔴 A2 — كل مسارات الـ API متعارضة

| ما يناديه `sie-client.js:48-53` | ما يخدمه `sie-api` | النتيجة |
|---|---|---|
| `GET /api/v1/health` | لا يوجد مسار health | **404** |
| `GET /api/v1/admin/is-admin` | `GET /v1/admin/is-admin` | يحتاج rewrite يشيل `/api` |
| `GET /api/v1/access/{userId}` | `GET /v1/access/status?userId=` | **404** |
| `POST /api/v1/admin/access` | `POST /v1/access/set` | **404** |
| `POST /api/v1/admin/access/reset-usage` | `POST /v1/access/reset` | **404** |
| `POST /api/v1/chat/reply` | `POST /v1/chat/reply` → **501** | لا يعمل |

**الأثر المباشر:**
- **لوحة الأدمن** (`assets/js/admin/users.js`) — تفعيل/تعطيل SIE وتصفير الاستخدام **بيفشلوا بصمت**.
- **قائمة اختيار وضع الشات** (`chatbot-mode-service.js:244`) — بتقرأ الصلاحية عبر مسار غلط → `null` → `available: false` → **خيار SIE مش بيظهر للعميل أصلًا**.

#### 🔴 A3 — مفيش حاجة بتخدم `sie.mad3oom.com/api/v1/*`

- `sie-config.js` بيوجّه على `https://sie.mad3oom.com`، والدومين ده **بيـ resolve فعلاً على Vercel**.
- لكن ريبو `sie` **مالوش أي backend**: مفيش `package.json`، مفيش `vercel.json`، مفيش serverless functions، مفيش Dockerfile. أقصى حاجة ينفع يخدمها هي `index.html` والملفات الساكنة.
- `vercel.json` بتاع مدعوم فيه rewrites للـ OAuth والـ MCP بس — **مفيش أي rewrite لـ `/api/v1/*`**.
- كمان: `sie-config.js` بيستخدم دومين **`mad3oom.com`** بينما الموقع على **`mad3oom.online`**.

#### 🟠 A4 — الكوتة مش بتتخصم أبدًا

`sie_consume_message` هي المكان الوحيد اللي بيزوّد `messages_used`. راجعت الاتنين:
- في مدعوم: **صفر نداءات**.
- في `sie-api`: **صفر نداءات** (كانت مفروض تتنادى من `chat-reply` غير المطبّق).
- في `sie-integration/sie-entitlement.js`: **موجودة وصحيحة** — بس الملف مش متوصّل.

يعني: **الكود الصح موجود في `/sie-integration` — هو بس مفصول.** الرجوع للنموذج المقصود بيصلّح دي مجانًا.

#### 🟠 A5 — `sie-integration/` كلها "مكسورة" ظاهريًا وهي في الحقيقة سليمة

`sie-chat-bridge.js` بيعمل:
```js
import { normalize } from '/sie/language/normalizer.js';
```
مسارات absolute على نفس الـ origin. ده **صح تمامًا للنموذج المقصود** ومكسور بس لأن الملفات مش بتتخدم من origin مدعوم.

نفس الكلام على العقد بتاعها: بترجّع `{ reply, options, alreadyPersisted: true, ticketNumber }` وبتكتب بنفسها ذرّيًا — وده **أفضل** من الوضع الحالي في `chat-logic.js` اللي بيكتب `chat_messages` بـ `.insert()` عادي.

والنسخة القديمة من `chat-logic.js` كانت بتتعامل مع ده **صح**:
```js
if (sieResult) {
    // Action Layer (Module 8) already كتب رسالة البوت + حالة الجلسة ذرّيًا
    renderQuickOptions(sieResult.options);
    return;   // ← بيتخطّى الـ insert، فمفيش كتابة مزدوجة
}
```

> ⚠️ **تحذير مهم:** لو رجّعت `sie-integration` من غير ما ترجّع الـ `return` ده، هيحصل **كتابة مزدوجة لكل رسالة بوت** (مرة من `persist_bot_turn` ومرة من `.insert()` بتاع `chat-logic.js`).

#### 🟠 A6 — لوحة Review Center "مكسورة" وهي كمان سليمة

`sie/observability/admin-ui/review-center.{html,js,css}` (~600 سطر: Review Center + Validation Lab + إدارة صلاحيات العملاء) بتعمل:
```js
import { checkAdminAuth, updateAdminUI } from '/assets/js/admin/auth.js';
import { initSidebar } from '/assets/js/admin/sidebar.js';
import { supabase } from '/api-config.js';
import { ... } from '/sie-integration/sie-entitlement.js';
```

في النموذج المقصود (كله على origin واحد) **الـ imports دي صحيحة 100%**. المشكلة الحقيقية الوحيدة: **مفيش أي لينك ليها من أي صفحة أدمن في مدعوم** — يعني الصفحة موجودة بس محدش يقدر يوصلها.

#### 🟡 A7 — كود الـ Edge Function مش محفوظ في أي ريبو

Edge Function `sie-api` فيها 9 ملفات TypeScript حقيقية (`index.ts`, `_shared/{cors,http,supabase-client}.ts`, `handlers/{is-admin,access-status,access-set,access-reset,chat-reply}.ts`) — **مش موجودين في أي من الريبوهين**.

في النموذج المقصود دي **بتتشال** أصلًا، فالبند ده بيتحل بالحذف مش بالحفظ. بس **لو هتتشال، خدلها نسخة الأول** قبل ما تتمسح من Supabase.

---

### القسم ب — مشكلات حقيقية مستقلة عن النموذج (لازم تتصلح في كل الأحوال)

#### 🟡 B1 — ملفات الـ migrations مش مطابقة للقاعدة الحية

`sie/action/migrations/0001_...sql` بتقول:
```sql
insert into chat_messages (session_id, turn, sender, text, created_at)
```
**الأعمدة دي مش موجودة**. الحقيقية: `id, session_id, sender_id, message_text, is_bot_reply, is_admin_reply, created_at, image_url, audio_url`

| البند | ملف migration في ريبو sie | القاعدة الحية |
|---|---|---|
| `persist_bot_turn` | `returns void`، بيكتب `turn`/`sender`/`text` | `returns jsonb`، بيكتب `is_bot_reply` |
| `is_chat_engine_staff()` | `profiles.role = 'staff'` | `role in ('admin','support','super_user')` |
| `chat_engine_scenarios` | عمود `author_note` | عمود `notes` |
| `chat_engine_scenarios` | `unique (scenario_key, version)` | **لا يوجد** — PK على `id` بس |
| `chat_engine_knowledge_entries` | عمود `definition` | عمود `content` |
| `publish_chat_engine_scenario` | 3 معاملات | **2 معاملات فقط** |
| `create_chat_engine_*_draft` | موجودة | **غير موجودة في القاعدة** |

ملفات `*.supabase.js` (الـ ports) **اتصلّحت فعلاً** ضد القاعدة الحية (commits `df7bfe4`, `800b1a6`, `cfb93a9`) — لكن **ملفات الـ migration نفسها ما اتحدّثتش**. أي حد يشغّلها على بيئة جديدة هيبني schema غلط تمامًا. **فخ حقيقي لأي staging/dev.**

#### 🟡 B2 — 6 اختبارات فاشلة من 460

```
# tests 460 | pass 454 | fail 6
```

مش أخطاء في كود الإنتاج — **fixtures ما اتحدّثتش** مع تصليحات الـ ports:

| الاختبار | السبب |
|---|---|
| `knowledge/tests/static-knowledge-supabase.test.mjs` (4) | fixture بتحط `definition:` والقارئ بقى بيقرا `content:` |
| `observability/tests/observability-read-port-supabase.test.mjs` (2) | fixture بتحط `{turn, sender, text}` والقارئ بقى بيقرا `{message_text, is_bot_reply, is_admin_reply, created_at}` |

#### 🟡 B3 — رقم الـ turn مش بيتحفظ

`persist_bot_turn` الحية بتاخد `p_turn` **وما بتكتبهوش في أي مكان**. فمفيش رقم turn في `chat_messages`، و`observability-read-port.supabase.js` بيشتقّه من ترتيب `created_at`.

**كسر محتمل:** لو محادثة اتنقلت بين المحركين (تقليدي ↔ SIE)، أو فيها ردود أدمن في النص، الترقيم المشتق **مش هيطابق** `bot_state.sie.turnCount` ولا `chat_engine_trace_events.turn`. أي replay أو shadow-run على المحادثات دي هيدّي نتائج غلط **بصمت**.

#### 🟢 B4 — تعريفات متضاربة لـ "الأدمن"

تلات تعريفات مختلفة لنفس السؤال:
- `is_sie_admin()` → إيميل واحد متكتوب حرفيًا: `support@mad3oom.online`
- `is_chat_engine_staff()` → `role in ('admin','support','super_user')`
- `review-center.js` → `user.profile?.role === 'admin'`

#### 🟢 B5 — متفرقات

- **مفيش CI** في ريبو sie (مفيش `.github/workflows`) — عشان كده الـ 6 اختبارات الفاشلة عدّت.
- **`internal_service_secrets`** (صفّين في القاعدة) — يبان إنها لآلية service-to-service، ومفيش أي كود بيقراها. في النموذج المقصود غالبًا **زيادة عن الحاجة** — تتراجع وتتشال.
- **`sie-integration/README.md` قديم ومضلّل**: بيقول عن `CHATBOT_MODES.SIE` "متستخدمهوش، ده placeholder منفصل" — بينما مدعوم **بيستخدمه فعلاً** كبوابة أولى (`chat-logic.js:679`).
- **مفيش `CLAUDE.md`** ولا وثيقة قواعد معمارية في أي ريبو، رغم إن `sie-config.js` بيشير لواحدة. غياب الوثيقة دي هو اللي سمح أصلًا إن افتراض "منتج مستقل" يتكتب من غير ما حد يوقفه.

---

## 6. الحاجات اللي شغالة كويس

- ✅ **454 اختبار ناجح** بيغطوا الـ 9 modules بمنطق حقيقي.
- ✅ **`/sie-integration` مكتوبة صح** للنموذج المقصود — التسلسل كامل (Language → Diagnostics → Ranking → Decision → Knowledge → Dialogue → Action)، وفيها معالجة واعية لتأكيد فتح التذكرة، والتصعيد للبشري، والـ small talk.
- ✅ **الكتابة ذرّية**: `persist_bot_turn` و`create_ticket_with_message_and_session_update` بيعملوا كل الكتابات في transaction واحدة على مستوى القاعدة.
- ✅ **الـ RPCs الحية متينة**: `sie_consume_message` فيها `for update` (قفل الصف) فمفيش double-spend من تابين مفتوحين.
- ✅ **RLS مفعّلة** على كل جداول SIE، والدوال `SECURITY INVOKER` فمفيش تجاوز للصلاحيات.
- ✅ **UX سليم عند سحب الصلاحية وسط محادثة**: `handleSieRevokedMidConversation()` بتبلّغ العميل بوضوح وبتحفظ التحويل في القاعدة.
- ✅ **البيانات موجودة ومنشورة**: 7 سيناريوهات + 9 مدخلات معرفة في `chat_engine_*`، و4 trace events، وصفّين صلاحية.

**المحرك جاهز. طبقة الربط جاهزة. الناقص هو المسار اللي يخدمهم.**

---

## 7. خطة الإصلاح — الرجوع للنموذج المقصود

### المرحلة صفر — قرار وحفظ (قبل أي كود)

1. **احسم الدومين**: `mad3oom.com` ولا `mad3oom.online`؟ (`sie-config.js` بيستخدم الأول والموقع على التاني).
2. **خد نسخة من كود Edge Function `sie-api`** واحفظها في git قبل ما تتشال — حاليًا نسخة واحدة على السيرفر من غير backup.

### المرحلة الأولى — المشكلة الهندسية الحقيقية الوحيدة: خدمة `/sie` من origin مدعوم

دي **البند الوحيد اللي محتاج قرار هندسي حقيقي**. الملفات في ريبو منفصل، ولازم تتخدم من `mad3oom.online/sie/*` و `mad3oom.online/sie-integration/*` عشان الـ imports تشتغل. تلات خيارات:

| الخيار | إزاي | المميزات | العيوب |
|---|---|---|---|
| **(أ) Git submodule** | `git submodule add` ريبو sie جوه مدعوم على مسار `/sie` | الريبوهين يفضلوا منفصلين، وإصدار SIE متثبّت (pinned) | لازم `submodules: true` في إعدادات Vercel؛ الفريق لازم يعرف يتعامل مع submodules |
| **(ب) خطوة نسخ في الـ build** | script في `vercel-build` بيـ clone/ينسخ `/sie` و `/sie-integration` وقت الـ deploy | مفيش تعقيد submodules للمطورين | محتاج توكن للريبو الخاص؛ الـ build بقى بيعتمد على الشبكة |
| **(ج) رجّع الملفات لريبو مدعوم** | اعكس commits `d6ca1e7` و `e3e7291` | أبسط حاجة على الإطلاق، وبيرجّع الحالة اللي كانت شغالة بالظبط | ريبو `sie` يفضل للتوثيق/التطوير بس، أو يتشال |

> **توصيتي: (أ) submodule** — بتحقق اللي إنت عايزه (ريبو منفصل للمحرك) من غير ما تكسر الـ imports، وبتديك تحكم في إصدار SIE اللي منشور. لو الأولوية إنك ترجّع كل حاجة تشتغل بأسرع وقت وبأقل مخاطرة، **(ج)** أضمن خيار.

### المرحلة الثانية — رجّع الـ imports المباشرة

3. **اعكس commits `6d490cb` و `d1485ad`** في مدعوم، أو عدّل الأربع مواضع يدويًا:

| الملف | من | إلى |
|---|---|---|
| `assets/js/chat-logic.js:6` | `/assets/js/sie-client.js` | `/sie-integration/sie-chat-bridge.js` |
| `chat-widget.js:20` | `/assets/js/sie-client.js` | `/sie-integration/sie-chat-bridge.js` |
| `assets/js/admin/users.js:5` | `/assets/js/sie-client.js` | `/sie-integration/sie-entitlement.js` |
| `assets/js/chatbot-mode-service.js:18` | `/assets/js/sie-client.js` | `/sie-integration/sie-entitlement.js` |

4. **⚠️ رجّع منطق `alreadyPersisted`** في `chat-logic.js` و`chat-widget.js` — الـ `return` بعد `renderQuickOptions(sieResult.options)`. **من غيره هيحصل كتابة مزدوجة لكل رسالة بوت.** ده أهم سطر في الخطة كلها.

5. **امسح الطبقة الزيادة**: `assets/js/sie-client.js`، `sie-config.js`، و Edge Function `sie-api` (بعد أخذ النسخة في المرحلة صفر). ولو `internal_service_secrets` مالهاش استخدام تاني، تتشال كمان.

6. **اختبر المسار كامل**: عميل مفعّل له SIE يبعت رسالة → يوصله رد حقيقي → `messages_used` **يزيد بواحد** → صف واحد بس في `chat_messages` (مش اتنين).

### المرحلة الثالثة — النضافة (مستقلة عن كل اللي فوق)

7. **حدّث ملفات الـ migrations** تطابق القاعدة الحية، أو علّم عليها بوضوح `-- SUPERSEDED — لا تشغّلها`.
8. **صلّح الـ 6 fixtures** الفاشلة.
9. **ضيف GitHub Actions** يشغّل `node --test "sie/**/tests/*.test.mjs"` على كل PR.
10. **اربط `review-center.html`** بلينك من لوحة الأدمن — الصفحة جاهزة ومحدش يقدر يوصلها.
11. **وحّد تعريف الأدمن** في مكان واحد (يُفضَّل `is_chat_engine_staff()` لأنها الأمرن والأقل هشاشة من إيميل متكتوب حرفيًا).
12. **حدّث `sie-integration/README.md`** — الجزء بتاع `CHATBOT_MODES.SIE` غلط.
13. **اكتب `CLAUDE.md`** في الريبوهين بالقاعدة المعمارية الصريحة:
    > **SIE موديول مربوط بمدعوم، بيتخدم من نفس الـ origin وبيشترك معاه في نفس قاعدة البيانات. الربط عن طريق ES imports مباشرة من `/sie-integration` — مش عن طريق HTTP. ممنوع إدخال طبقة شبكة بين مدعوم و SIE.**

    الوثيقة دي هي اللي كانت هتمنع المشكلة دي من الأساس.

---

## 8. Checklist للتحقق

| # | التحقق | الحالة |
|---|---|---|
| 1 | `/sie/*` و `/sie-integration/*` بيتخدموا من origin مدعوم | ❌ |
| 2 | الأربع ملفات بتـ import من `/sie-integration` مش `sie-client` | ❌ |
| 3 | منطق `alreadyPersisted` راجع (مفيش كتابة مزدوجة) | ❌ |
| 4 | `sie_consume_message` بتتنادى فعليًا والعدّاد بيتحرك | ❌ |
| 5 | عميل مفعّل بيوصله رد SIE حقيقي | ❌ |
| 6 | لوحة أدمن SIE شغالة (تفعيل/تعطيل/تصفير) | ❌ |
| 7 | خيار SIE بيظهر في قائمة اختيار الوضع | ❌ |
| 8 | `sie-client.js` + `sie-config.js` + `sie-api` اتشالوا (بعد أخذ نسخة) | ❌ |
| 9 | ملفات migrations = القاعدة الحية | ❌ |
| 10 | كل اختبارات `/sie` بتعدّي | ❌ (454/460) |
| 11 | CI بيشغّل الاختبارات | ❌ |
| 12 | `review-center.html` موصولة بلينك من لوحة الأدمن | ❌ |
| 13 | تعريف موحّد للأدمن | ❌ (3 تعريفات) |
| 14 | قاعدة بيانات مشتركة | ✅ **مقصود** |
| 15 | منطق `/sie` سليم ومختبَر | ✅ |
| 16 | `/sie-integration` مكتوبة صح للنموذج المقصود | ✅ |
| 17 | RLS مفعّلة والكتابة ذرّية | ✅ |

---

## 9. إجابة السؤال الأصلي

**المشروعين مربوطين، والاشتراك في قاعدة البيانات مقصود وصحيح.** المشكلة مش في الربط نفسه — المشكلة إن **نقل الملفات في 23 يوليو كسر الـ imports، وبدل ما مسار الخدمة يترجّع، اتبنت طبقة HTTP في 25 يوليو على افتراض "منتج مستقل" مخالف لنية المشروع — والطبقة دي ما اكتملتش.**

النتيجة: **SIE مش شغال في الإنتاج، ولوحة الأدمن بتاعته واقفة.**

الخبر الحلو إن **مفيش حاجة اتكسرت في المحرك نفسه**. `/sie` و `/sie-integration` سليمين ومكتوبين صح للنموذج اللي إنت عايزه. المطلوب مش بناء — المطلوب **إزالة**: شيل طبقة الـ HTTP، رجّع المسار اللي بيخدم الملفات، ورجّع الأربع imports. ونقطة واحدة لازم تتعمل بحرص: **رجّع منطق `alreadyPersisted`** وإلا هتحصل كتابة مزدوجة لكل رسالة.

---

### ملاحظة عن نطاق التحقق

كل الأرقام والأسماء والتوقيعات والتواريخ متحقّق منها فعليًا: قراءة الكود في الريبوهين، **تتبّع git history بتاع مدعوم** (بما فيه محتوى الملفات قبل الفصل)، استعلامات SQL مباشرة على القاعدة الحية (`information_schema`, `pg_proc`, `pg_constraint`)، قراءة كود Edge Function من Supabase، وتشغيل اختبارات `/sie` محليًا.

الاستثناء الوحيد: **لم أستطع فحص `https://sie.mad3oom.com` بـ HTTP** — سياسة الشبكة في بيئة التشغيل دي بترفض الاتصال بيه وبـ `srnelrdpqkcntbgudyto.supabase.co` (403 من الـ proxy). الاستنتاج إن الدومين مفيهوش `/api/v1/*` مبني على غياب أي backend في ريبو sie وغياب أي rewrite في `vercel.json` — ينفع يتأكد بسطر واحد:

```bash
curl -i https://sie.mad3oom.com/api/v1/health
```
