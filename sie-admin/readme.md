# لوحة تسجيل الدخول المستقلة — sie-admin

## ليه الصفحة كانت بتدّي 404s

الصفحة القديمة (`sie-admin/login.html` + `login.js`) بتعمل import/link لملفات
من **ريبو مدعوم نفسه**، مش من ريبو `sie`:

- `/styles.css`
- `/theme-manager.js`
- `/api-config.js` (وده الأخطر — بيصدّر الـ Supabase client، فبدونه تسجيل
  الدخول مش هيشتغل أصلًا)
- `/assets/images/logo.png`

لما الصفحة بتتفتح من دومين منفصل بيخدم ريبو `sie` بس (زي
`sie.mad3oom.com`)، الملفات دي مش موجودة → 404، وأهمها `api-config.js`
بيوقف الصفحة عن الاشتغال خالص.

## الحل هنا

4 ملفات مستقلة تمامًا، بتعتمد على بعضها بس، وعلى نفس مشروع Supabase:

| الملف | بيحل محل |
|---|---|
| `supabase-client.js` | `/api-config.js` — عميل Supabase مستقل، بنفس المشروع |
| `base-theme.css` | متغيرات الألوان اللي كانت جاية من `/styles.css` |
| `theme-toggle.js` | `/theme-manager.js` — تبديل بسيط بين الوضع الفاتح والداكن |
| `login.html` | نسخة مستقلة من `login.html` الأصلية، بنفس الشكل والتصميم |
| `login.js` | نسخة من `login.js` الأصلية، بس بتستورد من `supabase-client.js` بدل `/api-config.js` |

`sie-admin.css` و `sie-integration/sie-runtime.js` **متغيرتش** — دول
أصلًا جوه ريبو `sie` نفسه، فبيتحمّلوا عادي من نفس الأورجن.

## خطوات التركيب

1. انسخ الملفات الخمسة دي جوه فولدر `sie-admin/` في ريبو `sie` (فوق
   `login.html`/`login.js` الحاليين، أو جنبهم لو عايز تختبر الأول).

2. **افتح `supabase-client.js` واملأ القيمتين دول:**
   ```js
   const SUPABASE_URL = 'https://srnelrdpqkcntbgudyto.supabase.co'; // تأكد إنه ده الصح
   const SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE';
   ```
   القيمتين موجودين في: **Supabase Dashboard → Project Settings → API**.
   لازم يكونوا بالظبط نفس القيم اللي `/api-config.js` بتاع منصة مدعوم
   بيستخدمها — عشان الجلسة والمستخدمين يبقوا نفسهم بالظبط.

   الـ anon key آمن إنه يبقى ظاهر في كود الفرونت إند (كل تطبيقات
   Supabase بتحطه في الـ bundle بتاعها) — الحماية الحقيقية جايه من
   Row Level Security على الجداول، مش من إخفاء المفتاح ده.

3. **افتح `login.js` وراجع السطر ده:**
   ```js
   const PLATFORM_HOME = 'https://mad3oom.online/customer-dashboard.html';
   ```
   ده الرابط اللي أي حساب مش staff/admin هيتحوّل عليه. اتأكد إنه الدومين
   الصح بتاع منصة مدعوم الحية.

4. جرّب `login.html` — المفروض دلوقتي مفيش أي 404s في الـ console، وتسجيل
   الدخول يشتغل ويوديك لـ `settings.html` لو حسابك staff/admin.

## ملاحظة أمان مهمة (منفصلة عن المشكلة دي)

في السكرين شوت اللي بعتّه، شفت إن الإيميل وكلمة المرور كانوا مكتوبين
صراحة في الـ URL (`login.html?email=...&password=...`). الكود مالوش أي
منطق بيقرا query string زي ده — يبدو إنه اتبنى يدويًا للتجربة. تجنّب
الطريقة دي تمامًا، وامسح أي رابط زي ده من الـ history، وغيّر الباسورد ده
لأنه ممكن يكون اتسجّل في مكان (browser history, server logs).

## خارج نطاق الطلب الحالي (لو احتجته لاحقًا)

`sie-admin/settings.html` و `settings.js` عندهم نفس المشكلة بالظبط
(بيعتمدوا على `/styles.css`, `/theme-manager.js`, `/api-config.js`). لو
عايز، أقدر أعمل نفس التصليح ليهم — هيستخدموا نفس `supabase-client.js`,
`base-theme.css`, `theme-toggle.js` اللي هنا من غير أي تكرار.
