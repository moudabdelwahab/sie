# نشر الـAPI العام — التوجيه والإطلاق

الملف ده بيشرح الجزء الوحيد من الـAPI العام اللي **مش موجود جوه الكود**:
إزاي `https://sie.mad3oom.com/api/v1/*` بيوصل للدالة الطرفية أصلاً.

---

## ١. المشكلة: الدومين على Vercel، والـAPI على Supabase

```
sie.mad3oom.com  ──DNS──►  4dd359f07142f8f2.vercel-dns-017.com   (Vercel)
الدالة الطرفية    ────────►  srnelrdpqkcntbgudyto.supabase.co      (Supabase)
```

الاتنين مش نفس المكان. من غير إعادة كتابة (rewrite)، أي نداء على
`https://sie.mad3oom.com/api/v1/health` بيقف عند Vercel وبيرجّع 404 —
والدالة مابتشوفش الطلب خالص.

ده مش عيب جديد: هو نفس البند **A3** المرصود في
`ARCHITECTURE-SIE-MAD3OOM.md`، وموجود من قبل الـAPI العام.

---

## ٢. الحل: rewrite واحد

`vercel.json` في جذر الريبو ده فيه القاعدة دي:

```json
{
  "source": "/api/(.*)",
  "destination": "https://srnelrdpqkcntbgudyto.supabase.co/functions/v1/sie-api/api/$1"
}
```

### ليه `/api/(.*)` كله مش `/api/v1/chat` وأخواته بس

الدالة الطرفية بتخدم سطحين على نفس البادئة:

| المسار | مين بيرد عليه |
|---|---|
| `/api/v1/chat/reply`, `/api/v1/access/…` | منصة مدعوم القديمة (بتوكن المستخدم) |
| `/api/v1/chat`, `/api/v1/me`, `/api/v1/scenarios`, … | الـAPI العام (بمفتاح) |
| `/api/openapi.json`, `/api/docs` | المستند والتوثيق |

التفرقة بينهم بتحصل **جوه الدالة** في `api/v1/mount.js` بقائمة صريحة
متولّدة من جدول الراوتر نفسه — مش في Vercel. فـVercel بتوصّل كل `/api/*`
والدالة هي اللي بتوزّع. كده أي مسار جديد بيتضاف للراوتر بيشتغل من غير ما
حد يفتكر يعدّل التوجيه.

### الوجهة ليه فيها `/api` مرتين

```
/api/v1/health
  └─► https://…/functions/v1/sie-api/api/v1/health
                └─ stripMount() بتشيل «/functions/v1/sie-api»
                   └─ يفضل «/api/v1/health» ← ده اللي الراوتر مستنيه
```

الدالة محتاجة تشوف `/api` عشان تفرّق بين مساراتها العامة والقديمة، فلازم
تفضل في الوجهة.

### مافيش حاجة في المتصفح بتتكسر

مجلد `/api/` في الريبو ده كله كود يشتغل على السيرفر — مفيش صفحة ولا سكربت
في `sie-admin/` أو `sie/` أو `index.html` بيستورد منه أي حاجة. القاعدة دي
كمان بتقفل تسريب كان موجود بالغلط: من غيرها Vercel كانت بتخدم
`https://sie.mad3oom.com/api/v1/router.js` كملف مصدر مكشوف للناس.

---

## ٣. لو الدومين متعلّق بمشروع Vercel تاني

`vercel.json` ده بيشتغل على مشروع Vercel بتاع **الريبو ده**
(`sie-six.vercel.app`). لو `sie.mad3oom.com` متعلّق بمشروع تاني — مثلاً
مشروع `mad3oom.online` — فالقاعدة نفسها لازم تتحط في `vercel.json` بتاع
المشروع ده بالظبط زي ما هي.

إزاي تعرف: من لوحة Vercel ← Project ← Settings ← Domains، شوف
`sie.mad3oom.com` تحت أنهي مشروع.

> ⚠️ لو حطيتها في مشروع مدعوم، خلي بالك إن `vercel.json` بتاعه فيه
> rewrites للـOAuth والـMCP. الترتيب مهم: القواعد الأخص بتيجي الأول.
> القاعدة دي بتاخد `/api/*` كله، فلو فيه عندك مسار `/api/…` تاني بيتخدم
> من مدعوم نفسه، حطه فوقها.

---

## ٤. نشر الدالة الطرفية

الـMCP بتاع Supabase مابيقدرش يرفع الدالة دي: ملفاتها بتستورد من الريبو
(`../../../../api/v1/router.js` وغيرها)، والأداة دي بتبعت الملفات اللي
تحت مجلد الدالة بس. لازم CLI:

```bash
supabase functions deploy sie-api --project-ref srnelrdpqkcntbgudyto
```

### قبل النشر: تأكيد تثبيت المحرك

الدالة بتحمّل المحرك وقت الإقلاع من jsDelivr على commit مثبّت. لو الـcommit
ده مش متاح، الدالة **بتفشل في الإقلاع**، مش بترجّع خطأ. فالتأكيد ده مش
اختياري:

```bash
curl -s "https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@e8ceb6f42cf8cf20c65dcbfaf4eb0370769f5310/sie-integration/sie-runtime.js" \
  | grep -m1 "SIE_RUNTIME_VERSION ="
```

المفروض يطلع بالظبط:

```
export const SIE_RUNTIME_VERSION = '2.4.0';
```

أي حاجة تانية (404، صفحة فاضية، إصدار مختلف) معناها **ماتنشرش**.

### متغيرات البيئة

| المتغير | القيمة | لازم؟ |
|---|---|---|
| `SIE_PUBLIC_BASE_URL` | `https://sie.mad3oom.com` | لأ — ده الافتراضي |
| `SIE_API_ALLOWED_ORIGINS` | قائمة أصول بفاصلة | لأ — فاضية = مفيش CORS للمتصفح |

`SIE_API_ALLOWED_ORIGINS` فاضية عن قصد: الـAPI ده للسيرفرات. لو محتاج
تناديه من متصفح، حط الأصول المسموحة صراحة — مافيش `*` في أي حالة.

---

## ٥. بعد النشر: التأكيد

```bash
# ١) الدالة قامت والمحرك حمّل — من غير مفتاح
curl -s https://srnelrdpqkcntbgudyto.supabase.co/functions/v1/sie-api/api/v1/health

# ٢) نفس الحاجة من الدومين العام (بيتأكد إن الـrewrite شغال)
curl -s https://sie.mad3oom.com/api/v1/health

# ٣) المستند والتوثيق
curl -s -o /dev/null -w '%{http_code}\n' https://sie.mad3oom.com/api/openapi.json
curl -s -o /dev/null -w '%{http_code}\n' https://sie.mad3oom.com/api/docs

# ٤) مسار محمي من غير مفتاح — لازم 401
curl -s -o /dev/null -w '%{http_code}\n' https://sie.mad3oom.com/api/v1/me

# ٥) بمفتاح حقيقي (اعمله من اللوحة ← الـAPI والمطورين)
curl -s -H "Authorization: Bearer $SIE_API_KEY" https://sie.mad3oom.com/api/v1/me
```

> المفتاح بيتحط في متغيّر بيئة زي فوق، مايتكتبش في سطر أوامر بيتسجّل ولا
> في تذكرة ولا في تقرير.

والمسارات القديمة لازم تفضل زي ما هي — ده أهم تأكيد بعد النشر:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  https://srnelrdpqkcntbgudyto.supabase.co/functions/v1/sie-api/api/v1/health
# ومن منصة مدعوم نفسها: افتح محادثة في وضع SIE واتأكد إنها بترد.
```
