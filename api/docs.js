/**
 * docs.js — صفحة توثيق SIE API
 * ============================================================
 * صفحة واحدة، بتتبني من مستند OpenAPI نفسه. أي مسار أو خطأ أو مثال
 * بيظهر هنا جاي من العقد مش مكتوب بالإيد، فالتوثيق مايقدرش يوصف API
 * تاني غير الموجود.
 *
 * ── ليه مش Swagger UI ───────────────────────────────────────
 * Swagger UI أداة ممتازة، وحوالي ١.٥ ميجا من CDN خارجي، بشكل مالوش
 * علاقة بهوية المنتج، وبإنجليزي في منتج عربي. الصفحة دي مكتوبة هنا
 * عشان تفضل بلا اعتمادات خارجية (مهم لصفحة بتتقدّم من دالة طرفية)
 * وبنفس لغة ولغة تصميم باقي SIE.
 *
 * ── «جرّب» ──────────────────────────────────────────────────
 * الصفحة بتتقدّم من نفس أصل الـAPI، فالتجربة نداء same-origin عادي.
 * المفتاح بيقعد في الذاكرة بس: مافيش localStorage ولا كوكي ولا إرسال
 * لأي مكان تاني — المفتاح ده اللي بيتحط في السيرفر، ومحطة تجربة
 * بتحفظه في المتصفح بتحوّله لسر مكشوف.
 */
import { buildOpenApiDocument, DEFAULT_BASE_URL } from './openapi.js';

/**
 * @param {{baseUrl?: string}} [options]
 * @returns {string} HTML
 */
export function renderDocsPage({ baseUrl = DEFAULT_BASE_URL } = {}) {
    const spec = buildOpenApiDocument({ baseUrl });
    const apiBase = `${baseUrl}/api/v1`;

    const endpoints = Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({
            path, method: method.toUpperCase(), ...operation
        })));

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIE API — توثيق المطورين</title>
<meta name="description" content="توثيق واجهة SIE البرمجية: المصادقة، المسارات، الأخطاء، الحدود، وSDK.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='26' fill='%234F46E5'/%3E%3Ccircle cx='50' cy='54' r='22' fill='none' stroke='white' stroke-width='7'/%3E%3Ccircle cx='50' cy='24' r='6' fill='white'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <a class="brand" href="#top">
      <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12.5" r="6.5"/><circle cx="12" cy="3.6" r="1.6"/></svg></span>
      <span><b>SIE API</b><small>v${spec.info.version}</small></span>
    </a>
    <nav class="side-nav">
      <p class="side-title">البداية</p>
      <a href="#quickstart">البداية السريعة</a>
      <a href="#auth">المصادقة</a>
      <a href="#keys">مفاتيح الـAPI</a>
      <p class="side-title">المسارات</p>
      ${endpoints.map((endpoint) => `
        <a href="#${slug(endpoint)}"><code>${escapeHtml(endpoint.path)}</code></a>`).join('')}
      <p class="side-title">التفاصيل</p>
      <a href="#errors">الأخطاء</a>
      <a href="#limits">الحدود والرصيد</a>
      <a href="#requestids">معرّفات الطلبات</a>
      <a href="#versioning">الإصدارات</a>
      <a href="#sdk">SDK</a>
      <a href="#practices">أفضل الممارسات</a>
      <a href="../openapi.json">openapi.json ↗</a>
    </nav>
  </aside>

  <main class="main" id="top">
    <header class="hero">
      <span class="eyebrow">Developer Platform</span>
      <h1>SIE API</h1>
      <p class="lede">${escapeHtml(spec.info.summary)}</p>
      <div class="base-url">
        <span>Base URL</span>
        <code id="baseUrl">${escapeHtml(apiBase)}</code>
        <button class="copy" data-copy="${escapeHtml(apiBase)}">نسخ</button>
      </div>
    </header>

    <section id="quickstart" class="section">
      <h2>البداية السريعة</h2>
      <p>تلات خطوات من صفر لأول رد من المحرك.</p>
      <ol class="steps">
        <li><b>اعمل مفتاح</b><span>من لوحة SIE ← «الـAPI والمطورين» ← «مفتاح جديد». القيمة الكاملة بتتعرض مرة واحدة بس.</span></li>
        <li><b>اتأكد إنه شغّال</b><span>ناد <code>GET /me</code> — بيرجّع حسابك ورصيدك وحدّك.</span></li>
        <li><b>ابعت رسالة</b><span><code>POST /chat</code> بيشغّل المحرك ويرجّع الرد الجاهز للعرض.</span></li>
      </ol>

      ${codeBlock('curl', `curl -X POST ${apiBase}/chat \\
  -H "Authorization: Bearer $SIE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"الاشتراك بتاعي منتهي","end_user_id":"crm-user-4821"}'`)}

      ${codeBlock('javascript', `import { SIE } from '@mad3oom/sie';

const sie = new SIE({ apiKey: process.env.SIE_API_KEY });

const { reply, session_id } = await sie.chat({
  message: 'الاشتراك بتاعي منتهي',
  endUserId: 'crm-user-4821'
});

console.log(reply.text);`)}
    </section>

    <section id="auth" class="section">
      <h2>المصادقة</h2>
      <p>كل نداء — ما عدا <code>/health</code> — محتاج مفتاح في هيدر <code>Authorization</code>:</p>
      ${codeBlock('http', 'Authorization: Bearer sie_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')}
      <div class="callout callout--warn">
        <b>المفتاح سر سيرفر.</b>
        ماتحطهوش في كود متصفح ولا تطبيق موبايل ولا مستودع عام. أي حد معاه المفتاح
        بيقدر يستهلك رصيد حسابك ويقرا كتالوجك. لو اتسرّب: ألغيه من اللوحة فورًا —
        الإلغاء بيسري على الطلب اللي بعده على طول.
      </div>
      <p>المفتاح بيسمّي حساب بعينه. مابيوسّعش صلاحياته: نفس الرصيد، نفس الحد، نفس الاستحقاق اللي في اللوحة.</p>
    </section>

    <section id="keys" class="section">
      <h2>مفاتيح الـAPI</h2>
      <p>
        المفاتيح بتتعمل وتتلغى وتتدوّر من <b>لوحة SIE</b> بس، بحساب مسؤول محرك.
        مفيش مسار في الـAPI بيعمل مفاتيح — عن قصد: مفتاح يقدر يولّد مفاتيح معناه إن
        سرقة واحدة بتبقى دايمة.
      </p>
      <table class="table">
        <thead><tr><th>الحاجة</th><th>التفاصيل</th></tr></thead>
        <tbody>
          <tr><td>الشكل</td><td><code>sie_live_…</code> للتشغيل، <code>sie_test_…</code> للتجربة (٤٣ حرف عشوائي)</td></tr>
          <tr><td>التخزين</td><td>إحنا بنخزّن هاش المفتاح بس. القيمة الكاملة بتتعرض مرة واحدة وقت الإنشاء</td></tr>
          <tr><td>الإلغاء</td><td>فوري. الطلب اللي بعده بياخد <code>401 api_key_revoked</code></td></tr>
          <tr><td>التدوير</td><td>بيعمل مفتاح جديد ويلغي القديم في معاملة واحدة</td></tr>
          <tr><td>الانتهاء</td><td>اختياري. بعد التاريخ: <code>401 api_key_expired</code></td></tr>
        </tbody>
      </table>
    </section>

    ${endpoints.map((endpoint) => renderEndpoint(endpoint, apiBase, spec)).join('')}

    <section id="errors" class="section">
      <h2>الأخطاء</h2>
      <p>
        كل خطأ بيرجع بحالة HTTP بتوصفه — مفيش خطأ جوه <code>200</code> أبدًا — وبنفس الشكل ده:
      </p>
      ${codeBlock('json', JSON.stringify({
          error: {
              code: 'invalid_api_key',
              message: 'The API key is invalid.',
              message_ar: 'مفتاح الـAPI مش صالح.',
              request_id: 'req_7f3a1c9e2b8d4a5f6c0e1d2b3a4f5c6d'
          }
      }, null, 2))}
      <p>فرّع في كودك على <code>code</code> مش على <code>message</code>: الرسالة ممكن تتحسّن، والكود ثابت.</p>
      <table class="table">
        <thead><tr><th>الكود</th><th>HTTP</th><th>المعنى</th></tr></thead>
        <tbody>
          ${errorRows(spec)}
        </tbody>
      </table>
    </section>

    <section id="limits" class="section">
      <h2>الحدود والرصيد</h2>
      <p>فيه حدّين مختلفين، وبيرجعوا أخطاء مختلفة:</p>
      <div class="cards">
        <div class="card">
          <b>حد المعدل — «بأي سرعة»</b>
          <p>لكل حساب، في الدقيقة، ومشترك مع استخدام نفس الحساب من الموقع.</p>
          <p>التجاوز: <code>429 rate_limited</code> مع <code>Retry-After</code>.</p>
        </div>
        <div class="card">
          <b>الرصيد — «كام رسالة إجمالاً»</b>
          <p>بيتصرف من <code>/chat</code> بس. <code>/diagnose</code> و<code>/scenarios</code> مابيستهلكوش رصيد.</p>
          <p>الاستنفاد: <code>403 quota_exhausted</code>.</p>
        </div>
      </div>
      <p>كل رد بيشيل الحالة الحالية للحد:</p>
      ${codeBlock('http', `RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 34`)}
      <p>لما تاخد <code>429</code>، استنى المدة اللي في <code>Retry-After</code> وبعدين أعد المحاولة. أضف تأخير متزايد لو تكرر.</p>
    </section>

    <section id="requestids" class="section">
      <h2>معرّفات الطلبات</h2>
      <p>
        كل رد فيه <code>X-Request-Id</code>، وكل خطأ فيه نفس القيمة جوه الجسم.
        سجّلها عندك: بالمعرّف ده الدعم بيلاقي طلبك بالظبط.
      </p>
      <p>تقدر تبعت معرّفك أنت في نفس الهيدر (٨ حروف على الأقل) وهنستخدمه بدل ما نولّد واحد.</p>
    </section>

    <section id="versioning" class="section">
      <h2>الإصدارات</h2>
      <p>الإصدار في المسار: <code>/api/v1</code>. المدعوم دلوقتي: <b>${spec.info.version.split('.')[0] === '1' ? 'v1' : 'v1'}</b>.</p>
      <ul class="bullets">
        <li>إضافة حقل جديد في الرد <b>مش</b> تغيير كاسر — تجاهل اللي ماتعرفوش.</li>
        <li>إضافة كود خطأ جديد مش تغيير كاسر — عامل الأكواد اللي ماتعرفهاش زي فئتها (4xx/5xx).</li>
        <li>أي تغيير كاسر بيطلع على <code>/api/v2</code>، و<code>/api/v1</code> بيفضل شغّال زي ما هو.</li>
        <li>إصدار مش موجود بياخد <code>404 unsupported_version</code> وجواه قائمة المدعوم.</li>
      </ul>
    </section>

    <section id="sdk" class="section">
      <h2>SDK الرسمي</h2>
      <p>JavaScript / TypeScript، من غير أي اعتمادات، بيشتغل في Node وDeno والمتصفح (سيرفر بس — المفتاح سر).</p>
      ${codeBlock('bash', 'npm install @mad3oom/sie')}
      ${codeBlock('typescript', `import { SIE, SIEError } from '@mad3oom/sie';

const sie = new SIE({
  apiKey: process.env.SIE_API_KEY!,
  timeout: 20_000               // اختياري
});

try {
  const result = await sie.chat({ message: 'مش عارف أدخل على حسابي' });
  console.log(result.reply.text, result.session_id);
} catch (error) {
  if (error instanceof SIEError) {
    console.error(error.code, error.status, error.requestId);
  }
}`)}
      <p><a href="https://github.com/moudabdelwahab/sie/tree/main/sdk/js">التوثيق الكامل للـSDK ↗</a></p>
    </section>

    <section id="practices" class="section">
      <h2>أفضل الممارسات</h2>
      <ul class="bullets">
        <li><b>خزّن <code>session_id</code></b> مع محادثة العميل عندك. من غيره المحرك بينسى، وكل رسالة بتبقى أول رسالة.</li>
        <li><b>استخدم <code>end_user_id</code></b> لو بتخدم أكتر من عميل نهائي — بيفصل ذاكرة كل واحد.</li>
        <li><b>جرّب بـ<code>/diagnose</code></b> قبل ما تحوّل تذكرة لـSIE: بيقولك هيحسمها ولا لأ، من غير ما يستهلك رصيد.</li>
        <li><b>افصل مفاتيح التجربة</b> (<code>sie_test_…</code>) عن التشغيل، وألغِ اللي مش مستخدم.</li>
        <li><b>احترم <code>Retry-After</code></b> بدل إعادة المحاولة فورًا.</li>
        <li><b>سجّل <code>X-Request-Id</code></b> مع كل نداء — ده أسرع طريق لحل أي مشكلة مع الدعم.</li>
      </ul>
    </section>

    <footer class="foot">
      <span>SIE — محرك الدعم الذكي</span>
      <span><a href="../openapi.json">openapi.json</a> · <a href="#top">لأول الصفحة</a></span>
    </footer>
  </main>
</div>

<script>${SCRIPT}</script>
</body>
</html>`;
}

// ── أجزاء الصفحة ────────────────────────────────────────────

function renderEndpoint(endpoint, apiBase, spec) {
    const id = slug(endpoint);
    const requestExample = firstExample(endpoint.requestBody?.content?.['application/json']);
    const okResponse = endpoint.responses?.[200]?.content?.['application/json'];
    const statuses = Object.keys(endpoint.responses ?? {});

    return `
    <section id="${id}" class="section endpoint">
      <div class="endpoint-head">
        <span class="method method--${endpoint.method.toLowerCase()}">${endpoint.method}</span>
        <code class="endpoint-path">${escapeHtml(endpoint.path)}</code>
        ${endpoint.security && endpoint.security.length === 0
            ? '<span class="tag tag--open">من غير مفتاح</span>'
            : '<span class="tag">محتاج مفتاح</span>'}
      </div>
      <h2>${escapeHtml(endpoint.summary)}</h2>
      <p class="endpoint-desc">${markdownish(endpoint.description ?? '')}</p>

      ${endpoint.parameters?.length ? `
      <h3>معاملات الاستعلام</h3>
      <table class="table">
        <thead><tr><th>الاسم</th><th>النوع</th><th>الوصف</th></tr></thead>
        <tbody>${endpoint.parameters.map((parameter) => `
          <tr><td><code>${escapeHtml(parameter.name)}</code></td>
              <td>${escapeHtml(parameter.schema?.type ?? '')}</td>
              <td>${escapeHtml(parameter.description ?? '')}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}

      ${requestExample ? `<h3>الطلب</h3>${codeBlock('json', JSON.stringify(requestExample, null, 2))}` : ''}
      ${okResponse?.example ? `<h3>الرد</h3>${codeBlock('json', JSON.stringify(okResponse.example, null, 2))}` : ''}

      <h3>الحالات المحتملة</h3>
      <p class="statuses">${statuses.map((status) => `<span class="status status--${String(status)[0]}xx">${status}</span>`).join('')}</p>

      <div class="tryit" data-method="${endpoint.method}" data-path="${escapeHtml(endpoint.path)}">
        <div class="tryit-head">
          <b>جرّبه دلوقتي</b>
          <span class="sub">المفتاح بيفضل في الذاكرة بس ومابيتخزنش في المتصفح.</span>
        </div>
        <div class="tryit-row">
          <input type="password" class="tryit-key" placeholder="sie_live_…" autocomplete="off" spellcheck="false"
                 aria-label="مفتاح الـAPI">
          ${requestExample ? `<textarea class="tryit-body" rows="3" spellcheck="false" aria-label="جسم الطلب">${escapeHtml(JSON.stringify(requestExample, null, 2))}</textarea>` : ''}
          <button class="btn tryit-send" type="button">إرسال</button>
        </div>
        <pre class="tryit-out" hidden></pre>
      </div>
    </section>`;
}

function errorRows(spec) {
    const schema = spec.components.schemas.Error.properties.error.properties;
    const codes = schema.code.enum;
    const byCode = {};

    for (const response of Object.values(spec.components.responses)) {
        const examples = response.content['application/json'].examples ?? {};
        for (const [code, example] of Object.entries(examples)) {
            byCode[code] = example.value.error;
        }
    }

    return codes.map((code) => {
        const entry = byCode[code];
        return `<tr>
            <td><code>${escapeHtml(code)}</code></td>
            <td>${entry ? statusOf(spec, code) : '—'}</td>
            <td>${escapeHtml(entry?.message_ar ?? '')}</td>
        </tr>`;
    }).join('');
}

/** الحالة اللي الكود ده بيظهر تحتها في مستند العقد. */
function statusOf(spec, code) {
    for (const [, methods] of Object.entries(spec.paths)) {
        for (const operation of Object.values(methods)) {
            for (const [status, response] of Object.entries(operation.responses ?? {})) {
                const ref = response.$ref;
                if (!ref) continue;
                const name = ref.split('/').pop();
                const examples = spec.components.responses[name]?.content['application/json'].examples ?? {};
                if (code in examples) return status;
            }
        }
    }
    return '—';
}

function firstExample(content) {
    if (!content) return null;
    if (content.example) return content.example;
    const examples = Object.values(content.examples ?? {});
    return examples.length ? examples[0].value : null;
}

const slug = (endpoint) =>
    `${endpoint.method.toLowerCase()}${endpoint.path.replace(/[^a-z0-9]+/gi, '-')}`;

function codeBlock(language, code) {
    return `<div class="code">
      <div class="code-head"><span>${escapeHtml(language)}</span>
        <button class="copy" data-copy="${escapeHtml(code)}">نسخ</button></div>
      <pre dir="ltr"><code>${escapeHtml(code)}</code></pre>
    </div>`;
}

/** تحويل بسيط: أسطر، وقائمة، و`code`. مش محرك ماركداون. */
function markdownish(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, ' ');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

// ── الشكل ───────────────────────────────────────────────────

const STYLES = `
:root{
  --bg:#F7F8FA;--surface:#fff;--surface-2:#F1F3F7;--border:#E6E9F1;--border-strong:#D6DCE7;
  --text:#101B2D;--text-2:#505B6D;--text-3:#7C8798;
  --primary:#4F46E5;--primary-soft:#EEF0FF;--primary-text:#4338CA;
  --ok:#047857;--ok-soft:#ECFDF5;--warn:#B45309;--warn-soft:#FFFBEB;--danger:#B91C1C;--danger-soft:#FEF2F2;
  --mono:'IBM Plex Mono',ui-monospace,monospace;--r:12px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;font-size:15px;line-height:1.75}
a{color:var(--primary-text);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
code{font-family:var(--mono);font-size:.88em;direction:ltr;unicode-bidi:isolate;
  background:var(--surface-2);padding:.12em .4em;border-radius:6px}
h1,h2,h3{font-family:'Cairo',sans-serif;line-height:1.3;margin:0}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);max-width:1400px;margin-inline:auto}

.side{position:sticky;top:0;height:100dvh;overflow-y:auto;padding:1.5rem 1rem;
  border-inline-start:1px solid var(--border);background:var(--surface)}
.brand{display:flex;align-items:center;gap:.7rem;margin-bottom:1.5rem;color:var(--text)}
.brand:hover{text-decoration:none}
.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;
  background:linear-gradient(135deg,#6366F1,#4338CA);color:#fff}
.brand-mark svg{width:20px;height:20px}
.brand b{display:block;font-family:'Cairo',sans-serif;letter-spacing:.03em}
.brand small{color:var(--text-3);font-size:11px}
.side-title{margin:1.2rem 0 .4rem;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-3)}
.side-nav a{display:block;padding:.35rem .6rem;border-radius:8px;color:var(--text-2);font-size:13.5px}
.side-nav a:hover{background:var(--surface-2);color:var(--text);text-decoration:none}
.side-nav code{background:none;padding:0;font-size:12.5px}

.main{padding:2.5rem clamp(1rem,4vw,3rem) 5rem;min-width:0}
.hero{padding-bottom:2rem;border-bottom:1px solid var(--border);margin-bottom:2rem}
.eyebrow{display:inline-block;padding:.2rem .7rem;border-radius:99px;background:var(--primary-soft);
  color:var(--primary-text);font-size:12px;font-weight:700;margin-bottom:.8rem}
.hero h1{font-size:2.2rem;margin-bottom:.5rem}
.lede{color:var(--text-2);font-size:1.05rem;max-width:60ch;margin:0}
.base-url{display:inline-flex;align-items:center;gap:.7rem;margin-top:1.4rem;padding:.55rem .8rem;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r)}
.base-url span{font-size:12px;color:var(--text-3);font-weight:600}
.base-url code{background:none;font-size:14px;color:var(--primary-text)}

.section{padding:2rem 0;border-bottom:1px solid var(--border);scroll-margin-top:1rem}
.section h2{font-size:1.4rem;margin-bottom:.6rem}
.section h3{font-size:1rem;margin:1.4rem 0 .5rem;color:var(--text-2)}
.section>p{color:var(--text-2);max-width:70ch}

.steps{counter-reset:s;list-style:none;padding:0;margin:1.2rem 0;display:grid;gap:.9rem}
.steps li{counter-increment:s;position:relative;padding-inline-start:2.4rem}
.steps li::before{content:counter(s);position:absolute;inset-inline-start:0;top:.1rem;width:26px;height:26px;
  display:grid;place-items:center;border-radius:99px;background:var(--primary-soft);color:var(--primary-text);
  font-size:12px;font-weight:700}
.steps b{display:block}
.steps span{color:var(--text-2);font-size:14px}
.bullets{color:var(--text-2);max-width:75ch;padding-inline-start:1.2rem}
.bullets li{margin-bottom:.5rem}

.code{margin:1rem 0;border:1px solid var(--border);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.code-head{display:flex;justify-content:space-between;align-items:center;padding:.4rem .8rem;
  background:var(--surface-2);border-bottom:1px solid var(--border);font-size:11.5px;color:var(--text-3);
  font-family:var(--mono)}
.code pre{margin:0;padding:1rem;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.7}
.copy{border:1px solid var(--border-strong);background:var(--surface);border-radius:7px;padding:.15rem .55rem;
  font:inherit;font-size:11.5px;cursor:pointer;color:var(--text-2)}
.copy:hover{border-color:var(--primary);color:var(--primary-text)}

.callout{padding:.9rem 1.1rem;border-radius:var(--r);border:1px solid;margin:1.2rem 0;font-size:14px;max-width:75ch}
.callout--warn{background:var(--warn-soft);border-color:#FDF0CC;color:var(--warn)}
.callout b{display:block;margin-bottom:.2rem}

.table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:14px;
  border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.table th{background:var(--surface-2);text-align:start;padding:.6rem .9rem;font-size:12.5px;color:var(--text-2)}
.table td{padding:.6rem .9rem;border-top:1px solid var(--border);background:var(--surface);vertical-align:top}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin:1.2rem 0}
.card{padding:1rem 1.2rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--r)}
.card b{display:block;margin-bottom:.4rem}
.card p{margin:.3rem 0;color:var(--text-2);font-size:14px}

.endpoint-head{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-bottom:.7rem}
.method{padding:.15rem .6rem;border-radius:7px;font-family:var(--mono);font-size:12px;font-weight:600;color:#fff}
.method--get{background:#0E7490}.method--post{background:#4338CA}
.endpoint-path{font-size:15px;background:none;padding:0}
.tag{font-size:11.5px;padding:.1rem .55rem;border-radius:99px;background:var(--surface-2);color:var(--text-3)}
.tag--open{background:var(--ok-soft);color:var(--ok)}
.endpoint-desc{color:var(--text-2);max-width:70ch}
.statuses{display:flex;gap:.35rem;flex-wrap:wrap}
.status{font-family:var(--mono);font-size:12px;padding:.1rem .5rem;border-radius:6px;background:var(--surface-2);color:var(--text-2)}
.status--2xx{background:var(--ok-soft);color:var(--ok)}
.status--4xx{background:var(--warn-soft);color:var(--warn)}
.status--5xx{background:var(--danger-soft);color:var(--danger)}

.tryit{margin-top:1.4rem;padding:1rem;border:1px dashed var(--border-strong);border-radius:var(--r);background:var(--surface)}
.tryit-head{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
.tryit-head .sub{color:var(--text-3);font-size:12px}
.tryit-row{display:grid;gap:.5rem}
.tryit input,.tryit textarea{width:100%;padding:.55rem .7rem;border:1px solid var(--border-strong);
  border-radius:9px;font:inherit;font-size:13px;font-family:var(--mono);direction:ltr;background:var(--bg)}
.tryit input:focus,.tryit textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(79,70,229,.18)}
.btn{padding:.55rem 1.1rem;border:0;border-radius:9px;background:var(--primary);color:#fff;
  font:inherit;font-weight:600;font-size:14px;cursor:pointer;justify-self:start}
.btn:hover{background:var(--primary-text)}
.btn:disabled{opacity:.6;cursor:not-allowed}
.tryit-out{margin:.8rem 0 0;padding:.8rem;background:var(--surface-2);border-radius:9px;
  font-family:var(--mono);font-size:12.5px;direction:ltr;text-align:left;overflow-x:auto;white-space:pre-wrap}

.foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;padding-top:2rem;
  color:var(--text-3);font-size:13px}

@media(max-width:900px){
  .layout{grid-template-columns:1fr}
  .side{position:static;height:auto;border:0;border-bottom:1px solid var(--border)}
  .side-nav{display:flex;flex-wrap:wrap;gap:.3rem}
  .side-title{width:100%;margin:.6rem 0 .2rem}
}
@media(prefers-color-scheme:dark){
  :root{--bg:#0A0F1A;--surface:#111827;--surface-2:#16202F;--border:rgba(255,255,255,.09);
    --border-strong:rgba(255,255,255,.16);--text:#EAEEF6;--text-2:#A3AFC2;--text-3:#7C8798;
    --primary:#6366F1;--primary-soft:rgba(99,102,241,.14);--primary-text:#A5B0FF;
    --ok:#34D399;--ok-soft:rgba(16,185,129,.13);--warn:#FBBF24;--warn-soft:rgba(245,158,11,.13);
    --danger:#FCA5A5;--danger-soft:rgba(239,68,68,.13)}
}
`;

const SCRIPT = `
document.addEventListener('click', async (event) => {
  const copy = event.target.closest('.copy');
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.copy);
    const original = copy.textContent;
    copy.textContent = 'اتنسخ ✓';
    setTimeout(() => { copy.textContent = original; }, 1400);
    return;
  }

  const send = event.target.closest('.tryit-send');
  if (!send) return;

  const box = send.closest('.tryit');
  const out = box.querySelector('.tryit-out');
  const key = box.querySelector('.tryit-key').value.trim();
  const bodyField = box.querySelector('.tryit-body');
  const base = document.getElementById('baseUrl').textContent.trim();

  if (!key) {
    out.hidden = false;
    out.textContent = 'اكتب مفتاح API الأول.';
    return;
  }

  send.disabled = true;
  out.hidden = false;
  out.textContent = '…';

  try {
    const init = { method: box.dataset.method, headers: { Authorization: 'Bearer ' + key } };
    if (bodyField) {
      init.headers['Content-Type'] = 'application/json';
      init.body = bodyField.value;
    }
    const response = await fetch(base + box.dataset.path, init);
    const text = await response.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}

    out.textContent = [
      'HTTP ' + response.status,
      'X-Request-Id: ' + (response.headers.get('X-Request-Id') || '—'),
      'RateLimit-Remaining: ' + (response.headers.get('RateLimit-Remaining') || '—'),
      '',
      pretty
    ].join('\\n');
  } catch (error) {
    out.textContent = 'الطلب فشل: ' + error.message;
  } finally {
    send.disabled = false;
  }
});
`;
