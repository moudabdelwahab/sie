# @mad3oom/sie

العميل الرسمي لـ**SIE API** — محرك الدعم الذكي العربي.

```
https://sie.mad3oom.com/api/v1
```

JavaScript/TypeScript، من غير أي اعتمادات، بيشتغل في Node 18+ وDeno
والمتصفح.

> ⚠️ **مفتاح الـAPI سر سيرفر.** ماتحطهوش في كود متصفح ولا تطبيق موبايل:
> أي حد بيفتح devtools بيقدر يقراه، وبيستهلك رصيد حسابك.

## التركيب

```bash
npm install @mad3oom/sie
```

## البداية

```js
import { SIE } from '@mad3oom/sie';

const sie = new SIE({ apiKey: process.env.SIE_API_KEY });

const result = await sie.chat({
  message: 'الاشتراك بتاعي منتهي وعايز أجدد',
  endUserId: 'crm-user-4821'
});

console.log(result.reply.text);
console.log(result.session_id);   // ابعته في الرسالة اللي بعدها
```

المفتاح بيتعمل من **لوحة SIE ← الـAPI والمطورين ← مفتاح جديد**. القيمة
الكاملة بتتعرض مرة واحدة بس.

## المصادقة

المفتاح بيتبعت في هيدر `Authorization` تلقائيًا:

```
Authorization: Bearer sie_live_…
```

الشكل بيتفحص محليًا وقت بناء العميل، فمتغير بيئة فاضي بيطلع خطأ واضح
بدل ٤٠١ غامض بعدين.

## المحادثة

```js
// أول رسالة: من غير session_id
const first = await sie.chat({ message: 'مش عارف أدخل على حسابي' });

// اللي بعدها: بنفس المعرّف عشان المحرك يفتكر
const second = await sie.chat({
  message: 'جربت أغيّر الباسورد ومارضيش',
  sessionId: first.session_id
});
```

من غير `sessionId` كل رسالة هتبان للمحرك كأنها أول رسالة، والتشخيص
بيتبني عبر الأدوار.

| الحقل | إيه هو |
|---|---|
| `message` | رسالة العميل زي ما كتبها — فصحى أو عامية أو عربيزي |
| `sessionId` | معرّف المحادثة من نداء سابق |
| `endUserId` | معرّف العميل النهائي عندك — بيفصل ذاكرة كل واحد |
| `metadata` | قيم مسطّحة بتاعتك (٢٠ مفتاح كحد أقصى) |

## التشخيص من غير رد

```js
const verdict = await sie.diagnose({ message: 'الواتساب مش مربوط' });

if (verdict.will_resolve) {
  // SIE هيقدر يحسمها — حوّلها له
  console.log(verdict.candidates[0].scenario_id, verdict.candidates[0].confidence);
}
```

**مابيستهلكش رصيد، ومابيكتبش حاجة، ومابيفتحش تذكرة.** مفيد لتصنيف
التذاكر الواردة أو توجيهها قبل ما تحوّلها.

## الحساب والكتالوج

```js
const me = await sie.me();
me.usage.remaining;              // المتبقي من الرصيد (null = من غير حد)
me.rate_limit.remaining;         // المتبقي في الدقيقة دي

const catalog = await sie.scenarios({ category: 'whatsapp', limit: 50 });
const status  = await sie.health();   // مابيحتاجش مفتاح
```

## التعامل مع الأخطاء

نوعين، بيتعاملوا بشكل مختلف:

```js
import { SIE, SIEError, SIEConnectionError } from '@mad3oom/sie';

try {
  await sie.chat({ message: 'أهلاً' });
} catch (error) {
  if (error instanceof SIEError) {
    // الـAPI رد بخطأ. فرّع على code، مش على message.
    error.code;        // 'quota_exhausted' | 'rate_limited' | …
    error.status;      // 403 | 429 | …
    error.requestId;   // ابعته للدعم
    error.retryable;   // 429 أو 5xx
    error.details;     // اسم الحقل، الحد الأقصى… حسب الخطأ
  } else if (error instanceof SIEConnectionError) {
    // مفيش رد أصلاً: شبكة أو مهلة.
    error.timeout;     // true لو المهلة خلصت
  }
}
```

### إعادة المحاولة

```js
async function withRetry(call, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const retryable = error instanceof SIEConnectionError || error?.retryable;
      if (!retryable || attempt === attempts) throw error;

      // احترم Retry-After لما يكون موجود.
      const wait = error?.details?.retry_after_seconds
        ? error.details.retry_after_seconds * 1000
        : 2 ** attempt * 250;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
```

## الإعدادات

```js
const sie = new SIE({
  apiKey: process.env.SIE_API_KEY,
  baseUrl: 'https://sie.mad3oom.com/api/v1',  // الافتراضي
  timeout: 30_000,                             // ملي ثانية
  fetch: customFetch,                          // اختياري
  userAgent: 'my-app/1.2.3'                    // اختياري
});
```

المهلة تتظبط لكل نداء لوحده كمان، وكل نداء بيقبل `AbortSignal`:

```js
await sie.me({ timeout: 5_000 });
await sie.chat({ message: 'أهلاً', signal: controller.signal });
```

## معرّفات الطلبات

كل رد بيحمل معرّف الطلب كخاصية غير قابلة للعد — موجودة للقراءة، ومش
بتلوّث الـJSON:

```js
const result = await sie.me();
result.requestId;             // 'req_7f3a…'
result.rateLimit.remaining;   // من هيدرز الرد

JSON.stringify(result);       // زي ما الـAPI بعته بالظبط
```

وتقدر تبعت معرّفك أنت (٨ حروف على الأقل) عشان يتطابق مع سجلاتك:

```js
await sie.chat({ message: 'أهلاً', requestId: 'crm-trace-4821' });
```

## TypeScript

الأنواع مشحونة مع الحزمة (`src/index.d.ts`) — من غير `@types` ومن غير
خطوة بناء:

```ts
import { SIE, SIEError, type ChatResult } from '@mad3oom/sie';

const sie = new SIE({ apiKey: process.env.SIE_API_KEY! });
const result: ChatResult = await sie.chat({ message: 'أهلاً' });
```

## مسار مش موجود في الحزمة

الـAPI ممكن يكبر قبل الحزمة. `request()` بيوصل لأي مسار بنفس المصادقة
والمهلة ومعالجة الأخطاء:

```js
const data = await sie.request('GET', '/some-new-endpoint');
```

## الحدود

| | |
|---|---|
| حد المعدل | لكل حساب، في الدقيقة، ومشترك مع استخدام نفس الحساب من الموقع. التجاوز: `429` |
| الرصيد | بيتصرف من `chat()` بس. `diagnose()` و`scenarios()` مجانيين. الاستنفاد: `403` |
| حجم الطلب | ٣٢ كيلوبايت |
| طول الرسالة | ٤٠٠٠ حرف |

## الاختبارات

```bash
node --test sdk/js/tests/
```

الاختبارات بتشغّل **سيرفر HTTP حقيقي بالراوتر الحقيقي** والـSDK بيتكلم
معاه بـfetch عادي — مفيش محاكاة للـAPI. وفيه اختبار
(`api/tests/live-engine.test.mjs`) بيوصّل السلسلة كلها للمحرك الحقيقي.

## التوثيق

- مرجع الـAPI: <https://sie.mad3oom.com/api/docs>
- OpenAPI: <https://sie.mad3oom.com/api/openapi.json>
