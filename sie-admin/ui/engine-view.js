/**
 * engine-view.js
 * ------------------------------------------------------------
 * بناء الـHTML بتاع قسم «قدرات المحرك» — دوال نقية، مالهاش علاقة بالـDOM.
 *
 * ------------------------------------------------------------
 * ليه منفصل عن settings.js
 *
 * القسم ده هو مركز التحكم، واللي بيتعرض فيه قرار مش شكل: «بتراقب بس» و«بتمنع»
 * لازم يبانوا مختلفين، والقدرة المفتوحة من غير دليل لازم تبان إنها من غير
 * دليل. كل ده كلام يستاهل اختبار.
 *
 * وما دام البناء جوه `settings.js` فهو مش قابل للاختبار من غير متصفح، و
 * المستودع ده **مافيهوش ولا حزمة npm** عن قصد — إضافة متصفح للاختبار تكسر
 * الخاصية دي عشان نتأكد من نص.
 *
 * فالقسم اتقسم: الدوال هنا بتاخد بيانات وترجّع نص HTML، و`settings.js`
 * بتحطه في مكانه وتربط الأحداث. اللي بيستاهل اختبار بقى قابل للاختبار من
 * غير أي تبعية، واللي فاضل (حطّ النص، اربط `change`) قصير لدرجة إن الخطأ
 * فيه بيبان من أول فتحة للصفحة.
 */
import { SWITCH_STATE, PROOF_STATE } from '../../sie/config/engine-status.js';

/** نفس دوال العرض المشتركة، متمرّرة بدل ما تتستورد — عشان الاختبار يقدر
 *  يمرّر نسخ بسيطة منها بدل ما يحمّل نظام الأيقونات كله. */
const defaultHelpers = {
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    icon: () => '',
    badge: (label, tone) => `<span class="badge badge--${tone}">${label}</span>`,
    fmtNumber: (n) => Number(n ?? 0).toLocaleString('en-US'),
    fmtRelative: (iso) => String(iso)
};

/** الكارت الكبير: المحرك نفسه. */
export function engineMasterHtml(caps, { isStaff = true, helpers = {} } = {}) {
    const h = { ...defaultHelpers, ...helpers };
    const engine = caps.find((c) => c.id === 'engine');
    const on = engine.switchState === SWITCH_STATE.ON;
    const live = caps.filter((c) => c.id !== 'engine' && c.switchState !== SWITCH_STATE.OFF).length;
    const total = caps.length - 1;

    return `
      <div class="master-row">
        <span class="master-dot master-dot--${on ? 'on' : 'off'}"></span>
        <div class="master-text">
          <h2>${on ? 'المحرك شغّال' : 'المحرك متوقف'}</h2>
          <p>${h.esc(engine.means)}</p>
          ${on ? `<p class="master-sub">${live} من ${total} قدرات إضافية مفتوحة.</p>` : ''}
        </div>
        <label class="switch switch--lg">
          <input type="checkbox" data-key="engine_enabled" ${on ? 'checked' : ''}
                 ${isStaff ? '' : 'disabled'} aria-label="تشغيل المحرك">
          <span class="slider"></span>
        </label>
      </div>`;
}

/** شبكة القدرات. */
export function capabilityGridHtml(caps, { isStaff = true, helpers = {} } = {}) {
    const h = { ...defaultHelpers, ...helpers };

    return caps.filter((c) => c.id !== 'engine').map((cap) => {
        const tone = cap.switchState === SWITCH_STATE.ON ? 'on'
            : cap.switchState === SWITCH_STATE.WATCHING ? 'watching' : 'off';

        const control = cap.alwaysOn
            ? '<span class="cap-always">مدمجة</span>'
            : `<label class="switch">
                 <input type="checkbox" data-key="${h.esc(cap.keys[0])}"
                        ${cap.switchState !== SWITCH_STATE.OFF ? 'checked' : ''}
                        ${isStaff ? '' : 'disabled'} aria-label="${h.esc(cap.title)}">
                 <span class="slider"></span>
               </label>`;

        // «الحماية» ليها درجتين: بتراقب، وبتنفّذ. الدرجة التانية بتظهر بس
        // لما الأولى تتفتح — مفتاح مالوش معنى على الشاشة بيخلي المسؤول
        // يفتكر إنه ظبط حاجة وهو ماظبطش.
        const second = cap.id === 'trust' && cap.switchState !== SWITCH_STATE.OFF
            ? `<label class="cap-step">
                 <input type="checkbox" data-key="trust_boundary_enforce"
                        ${cap.switchState === SWITCH_STATE.ON ? 'checked' : ''}
                        ${isStaff ? '' : 'disabled'}>
                 <span>تمنع فعلاً، مش تسجّل بس</span>
               </label>`
            : '';

        const proof = cap.proofLabel
            ? `<footer class="cap-proof cap-proof--${cap.proofState === PROOF_STATE.CONFIRMED ? 'yes' : 'no'}">
                 ${h.icon(cap.proofState === PROOF_STATE.CONFIRMED ? 'checkCircle' : 'clock')}
                 <span>${h.esc(cap.proofLabel)}</span>
               </footer>`
            : '';

        return `
        <article class="cap-card cap-card--${tone}">
          <header class="cap-head">
            <div class="cap-title-wrap">
              <h3>${h.esc(cap.title)}</h3>
              ${h.badge(cap.switchLabel, tone === 'on' ? 'success' : tone === 'watching' ? 'warning' : 'neutral')}
            </div>
            ${control}
          </header>
          <p class="cap-what">${h.esc(cap.what)}</p>
          <p class="cap-means">${h.esc(cap.means)}</p>
          ${second}
          ${proof}
        </article>`;
    }).join('');
}

/** بطاقة حد الطلبات. */
export function rateLimitHtml(status, { helpers = {} } = {}) {
    const h = { ...defaultHelpers, ...helpers };
    const rows = [
        ['الحالة', status.headline],
        ['المسموح في الدقيقة', status.perMinute ?? '—'],
        ['سماح إضافي للدفعات', status.burst ?? '—'],
        ['طلبات عدّت عليه', status.requests === null ? 'مش معروف' : h.fmtNumber(status.requests)],
        ['طلبات اترفضت', status.rejected === null ? 'مش معروف' : h.fmtNumber(status.rejected)],
        ['آخر طلب', status.lastSeen ? h.fmtRelative(status.lastSeen) : 'مفيش']
    ];

    return `
      <div class="status-line status-line--${h.esc(status.tone)}">
        <span class="status-dot"></span>
        <span>${h.esc(status.detail)}</span>
      </div>
      <dl class="kv">
        ${rows.map(([k, v]) => `<div><dt>${h.esc(k)}</dt><dd>${h.esc(String(v))}</dd></div>`).join('')}
      </dl>
      ${status.enabled && !status.verified
        ? `<p class="hint hint--warn">${h.icon('info')} الإعداد مفتوح، بس مفيش طلبات عدّت عليه لسه — فمش قادرين نأكد إنه بيشتغل فعلاً.</p>`
        : ''}`;
}

/** بطاقة النسخة التجريبية. */
export function shadowHtml({ enabled, records = [] }, { helpers = {} } = {}) {
    const h = { ...defaultHelpers, ...helpers };
    const ok = records.filter((r) => r && r.status === 'ok');
    const agreed = ok.filter((r) => r.agreed).length;

    if (!enabled) {
        return `
          <div class="status-line status-line--neutral">
            <span class="status-dot"></span>
            <span>النسخة التجريبية مش شغّالة دلوقتي، فمفيش مقارنة.</span>
          </div>
          <p class="hint">لما تفتحها من «قدرات المحرك» فوق، كل رسالة هتتسجّل معاها مقارنة بين النسختين. العميل مش بيشوف منها أي حاجة.</p>`;
    }

    if (ok.length === 0) {
        return `
          <div class="status-line status-line--warning">
            <span class="status-dot"></span>
            <span>شغّالة، بس لسه مافيش مقارنات متسجّلة.</span>
          </div>
          <p class="hint">المقارنة بتتسجّل مع كل رسالة جديدة. استنى شوية ترافيك وارجع.</p>`;
    }

    const rate = Math.round((100 * agreed) / ok.length);
    const differed = ok.length - agreed;
    const tone = differed === 0 ? 'success' : rate >= 95 ? 'warning' : 'danger';

    return `
      <div class="status-line status-line--${tone}">
        <span class="status-dot"></span>
        <span>النسختين اتفقوا في <b class="num">${rate}%</b> من آخر ${h.fmtNumber(ok.length)} رسالة.</span>
      </div>
      <dl class="kv">
        <div><dt>اتفقوا</dt><dd>${h.fmtNumber(agreed)}</dd></div>
        <div><dt>اختلفوا</dt><dd>${h.fmtNumber(differed)}</dd></div>
        <div><dt>أخطاء</dt><dd>${h.fmtNumber(records.filter((r) => r.status === 'error').length)}</dd></div>
        <div><dt>تجاوزوا الوقت</dt><dd>${h.fmtNumber(records.filter((r) => r.status === 'timeout').length)}</dd></div>
      </dl>
      <p class="hint">${differed === 0
        ? 'مفيش أي اختلاف لسه — النسخة الجديدة بتوصل لنفس القرار.'
        : `فيه ${h.fmtNumber(differed)} حالة اختلفوا فيها. ده مش بالضرورة غلط، بس محتاج مراجعة قبل ما تعتمد النسخة الجديدة.`}</p>`;
}

/** التنبيهات — المهم بس، اللي المسؤول لازم يعمل تجاهه حاجة. */
export function engineAlerts(caps, settings, { isStaff = true } = {}) {
    const alerts = [];
    const engine = caps.find((c) => c.id === 'engine');
    const trust = caps.find((c) => c.id === 'trust');

    if (engine.switchState === SWITCH_STATE.OFF) {
        alerts.push({ tone: 'danger', text: 'المحرك متوقف — كل العملاء بيرد عليهم البوت العادي.' });
    }
    if (settings.rate_limit_enabled === false) {
        alerts.push({ tone: 'danger', text: 'حد الطلبات مقفول — أي جهة تقدر تبعت أي عدد طلبات.' });
    }
    if (trust.switchState === SWITCH_STATE.WATCHING) {
        alerts.push({
            tone: 'info',
            text: 'الحماية بتسجّل بس ومابتمنعش. ده الوضع الصح في البداية — راجع الأرقام قبل ما تخليها تمنع فعلاً.'
        });
    }
    if (!isStaff) {
        alerts.push({ tone: 'info', text: 'إنت بتتفرّج بس — تغيير الإعدادات محتاج صلاحية فريق العمل.' });
    }
    return alerts;
}
