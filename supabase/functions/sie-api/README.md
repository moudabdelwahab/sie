# sie-api — واجهة SIE اللي منصة مدعوم بتكلمها

الدالة دي هي **الحد الوحيد** بين مدعوم وبين SIE. مدعوم مابيستوردش أي كود
من SIE — ده مكتوب في `assets/js/sie-client.js` عندهم كقاعدة معمارية —
فكل حاجة بتعدي من هنا عن طريق HTTP.

## ليه المصدر بقى في الريبو دلوقتي

الدالة كانت **منشورة من غير مصدر في أي ريبو**. اتسحبت من النشرة
(`get_edge_function`) واتحطت هنا، فأي تعديل بعد كده يكون مراجَع ومتتبَّع
زي أي كود تاني.

## اللي كان مكسور

مدعوم كان بينده مسارات مالهاش وجود:

| اللي العميل بينده | اللي الدالة كانت بترد بيه |
|---|---|
| `GET  /api/v1/health` | 404 |
| `GET  /api/v1/admin/is-admin` | 404 — الموجود كان `/v1/admin/is-admin` |
| `GET  /api/v1/access/:userId` | 404 — الموجود كان `/v1/access/status?userId=` |
| `POST /api/v1/admin/access` | 404 — الموجود كان `/v1/access/set` |
| `POST /api/v1/admin/access/reset-usage` | 404 — الموجود كان `/v1/access/reset` |
| `POST /api/v1/chat/reply` | **501 not_implemented** |

يعني وضع SIE في المنصة **عمره ما اشتغل**: كل رسالة كانت بتاخد
`getSieReply() -> null` والعميل بيشوف «محرك الدعم الذكي (SIE) واجه مشكلة
مؤقتة في الرد على رسالتك».

دلوقتي المسارين شغالين — القديم والجديد — عشان تغيير الواجهة مايكسرش أي
حد بينده الشكل القديم.

## المسارات

كلها بتقبل بادئة `/api` أو من غيرها، وبتقبل إن Supabase بيقدّم الدالة على
`/functions/v1/sie-api/...`.

| المسار | الطريقة | بيعمل إيه |
|---|---|---|
| `/v1/health` | GET | فحص توفر + هل بيانات المحرك حمّلت. مفتوح من غير توكن. |
| `/v1/admin/is-admin` | GET | `is_sie_admin()` |
| `/v1/access/status?userId=` أو `/v1/access/:userId` | GET | صف `customer_sie_access` |
| `/v1/access/set` أو `/v1/admin/access` | POST | `sie_admin_set_access` |
| `/v1/access/reset` أو `/v1/admin/access/reset-usage` | POST | `sie_admin_reset_usage` |
| `/v1/chat/reply` | POST | دور محادثة كامل |

## الهوية

الدالة بتبني عميل Supabase بـ **توكن الطالب نفسه** مش بـ service role. ده
مش تشدد زيادة — ده الشرط عشان الحاجة تشتغل أصلاً:

- `sie_consume_message(p_user_id)` بترفض لو `p_user_id != auth.uid()`
- `persist_bot_turn` و`create_ticket_with_message_and_session_update`
  بيعتمدوا على RLS بتطابق `auth.uid()` مع `chat_sessions.user_id`

عميل بـ service role هنا هيبقى صلاحيته **أقل** مش أكتر، لأن الدوال دي
بتعتبر «مافيش هوية» = «مافيش إذن».

### ليه `verify_jwt = false`

عشان `/v1/health` يشتغل. `checkSieHealth()` في عميل مدعوم مابيبعتش توكن،
وفحص محتاج جلسة سليمة مايقدرش يفرّق بين «SIE واقع» و«التوكن بتاعي خلص» —
وده الفرق الوحيد اللي هو موجود عشانه.

شيل حارس البوابة آمن **هنا بالذات** لأن الحماية كلها في قاعدة البيانات مش
في الدالة: الأربع دوال فوق كلهم SECURITY DEFINER وبيستنتجوا الطالب من
`auth.uid()`. من غير توكن، `auth.uid()` بتبقى NULL، فـ`is_sie_admin()`
بترجّع false، ودالتين الأدمن بيرموا «access denied»، والمسارين بتوع العميل
بيقعوا على `auth.getUser()`.

اتأكدنا من ده على الدالة المنشورة فعلاً: نداء `/v1/chat/reply` من غير توكن
بيرجّع 401، و`/v1/admin/is-admin` بيرجّع `{isAdmin:false}`.

⚠️ أي مسار جديد بيقرا بيانات **لازم** يتحقق من الهوية بنفسه، وإلا المنطق
ده بيقع.

## `alreadyPersisted` — أهم حاجة في العقد ده

المحرك **بيكتب دور المحادثة بنفسه** (رسالة البوت + `bot_state` +
التذكرة لو اتفتحت) جوه طبقة التنفيذ، عشان أثر التشخيص والتذكرة يبقوا
معاملة واحدة.

فالرد بيرجع `alreadyPersisted: true`، ومدعوم **لازم يتخطى** الكتابة بتاعته
لما يشوفها. من غير كده كل رد بيتكتب مرتين والعميل بيشوف نفس الرسالة
مكررة.

## النشر

```bash
supabase functions deploy sie-api --project-ref srnelrdpqkcntbgudyto
```

`handlers/chat-reply.ts` بيستورد المحرك من jsDelivr **مثبّت على commit**
مش فرع — نفس الطريقة اللي في `sie-channel-telegram`، وللأسباب نفسها
(مشروحة في `index.remote.ts` بتاعتها). ترقية المحرك = تغيير الـ SHA
وإعادة نشر، مش push عادي بيغيّر الدنيا تحت دالة شغالة.
