/**
 * Pro · الذرّات — generic, OPEN words shared by pack scenarios.
 *
 * A glossary layer may only claim words the base glossary leaves unresolved
 * (normalizer applyGlossaryLayers), and many support situations are made of
 * exactly such words: "close", "reply", "by itself", "where". Giving each
 * scenario its own copy of "اقفل" would make those scenarios pattern
 * collisions of each other; giving the concept ONE token lets signatures
 * compose it with base tokens instead ("close" + entity_ticket, "close" +
 * entity_account).
 *
 * The rule that keeps atoms from becoming noise: an atom is never weighted
 * so that it decides a scenario on its own. It is at most half of any
 * signature — the base token it combines with carries the rest.
 *
 * @no-legitimate-corpus
 */
import { T } from '../dsl.mjs';

export default {
    tokens: [
        T('atom_close', 'قفل', 'close', ['اقفل', 'اقفلها', 'اقفله', 'قفلوها', 'قفلوه', 'قفلوا', 'اتقفلت', 'اتقفل', 'مقفولة', 'مقفوله', 'close', 'closed']),
        T('atom_reply', 'رد', 'reply', ['رديت', 'ارد', 'ردي', 'رد', 'بعت رد', 'ابعت رد', 'reply', 'replied']),
        T('atom_open_action', 'فتح', 'open', ['فتحت', 'اتفتحت', 'افتح', 'افتحها', 'open', 'opened']),
        T('atom_reopen', 'إعادة فتح', 'reopen', ['اعيد فتحها', 'اعيد فتح', 'افتحها تاني', 'اعادة الفتح', 'اعاده الفتح', 'reopen']),
        T('atom_unchanged', 'مااتغيرش', 'unchanged', ['ماتغيرتش', 'مااتغيرتش', 'متغيرتش', 'ماتغيرش', 'زي ما هي', 'زي ما هو', 'ثابتة', 'ثابته']),
        T('atom_by_itself', 'لوحده', 'by itself', ['لوحدها', 'لوحده', 'من نفسها', 'من نفسه', 'تلقائي', 'تلقائيا', 'by itself']),
        T('atom_by_mistake', 'بالغلط', 'by mistake', ['بالغلط', 'بالخطأ', 'بالخطا', 'غلط مني']),
        T('atom_similar', 'مشابه', 'similar', ['مشابهة', 'مشابهه', 'مشابه', 'زيها', 'شبهها', 'similar']),
        T('atom_where', 'فين', 'where', ['فين', 'الاقيه فين', 'الاقيها فين', 'مكانه فين', 'where']),
        T('atom_when', 'إمتى', 'when', ['امتى', 'امتي', 'إمتى', 'when']),
        T('atom_change', 'تغيير', 'change', ['اغير', 'اتغيرت', 'اتغير', 'غيرت', 'اعدل', 'عدلت', 'تعديل']),
        T('atom_remove', 'حذف', 'remove', ['امسح', 'احذف', 'اشيل', 'شيلت', 'مسحت']),
        T('atom_member', 'عضو في الفريق', 'team member', ['موظف', 'عضو', 'الاعضاء', 'زميلي', 'زميل', 'زملائي', 'member', 'teammate']),
        T('atom_owner', 'مالك الحساب', 'account owner', ['مالك', 'مالكه', 'صاحب الحساب', 'صاحب الشركة', 'owner']),
        T('atom_company', 'الشركة', 'company', ['الشركة', 'الشركه', 'شركتنا', 'شركتي', 'company']),
        T('atom_device', 'جهاز', 'device', ['جهاز', 'اجهزة', 'الاجهزة', 'اجهزه', 'الاجهزه', 'device', 'devices']),
        T('atom_renewal', 'تجديد', 'renewal', ['تجديد', 'جددت', 'اجدد', 'التجديد', 'renew', 'renewal']),
        T('atom_upgrade', 'ترقية', 'upgrade', ['ترقية', 'ترقيه', 'رقيت', 'ارقي']),
        T('atom_cancel', 'إلغاء', 'cancel', ['الغاء', 'الغي', 'لغيت']),
        T('atom_balance', 'رصيد', 'balance', ['رصيد', 'الرصيد', 'رصيدي']),
        T('atom_topup', 'شحن', 'top-up', ['شحن', 'اشحن', 'شحنت', 'topup', 'top up']),
        T('atom_transfer', 'تحويل', 'transfer', ['تحويل', 'حولت', 'حواله', 'حوالة', 'transfer']),
        T('atom_button', 'زرار', 'button', ['زرار', 'زر', 'الزرار', 'button']),
        T('atom_support', 'فريق الدعم', 'support team', ['الدعم', 'فريق الدعم', 'الدعم الفني', 'خدمة الدعم', 'support', 'support team']),
        T('atom_follow', 'متابعة', 'follow up', ['متابعة', 'متابعه', 'اتابع', 'يتابع', 'نتابع', 'follow up', 'follow']),
        T('atom_shows', 'مكتوب/ظاهر', 'shows', ['مكتوب', 'بيقول', 'ظهرلي', 'بيظهر', 'ظاهر', 'says', 'shows'])
    ],
    scenarios: []
};
