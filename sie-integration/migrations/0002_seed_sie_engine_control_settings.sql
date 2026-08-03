-- 0002_seed_sie_engine_control_settings.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- Expands the settings table from the seven original switches to the full
-- set the console now offers: emotional intelligence, diagnosis depth,
-- knowledge sources, memory, support hand-off, and answering behaviour.
--
-- The authoritative definition of these keys — types, ranges, Arabic labels,
-- and which module reads each one — is sie/config/settings-schema.js. This
-- file only seeds rows; the schema is what validates them. If the two ever
-- disagree, the schema wins: mergeStoredSettings() drops any row it does not
-- recognise rather than feeding it to the engine.
--
-- Every value below is the setting's schema default, which by construction
-- describes what the engine already did. Seeding changes no behaviour.
-- ============================================================================

insert into public.sie_settings (key, value) values
    -- الذكاء العاطفي
    ('emotion_detection',            'true'::jsonb),
    ('emotion_anger',                'true'::jsonb),
    ('emotion_frustration',          'true'::jsonb),
    ('emotion_urgency',              'true'::jsonb),
    ('emotion_sarcasm',              'true'::jsonb),
    ('emotion_thanks',               'true'::jsonb),
    ('emotion_satisfaction',         'true'::jsonb),
    ('emotion_reply',                'true'::jsonb),
    -- التشخيص
    ('diagnosis_level',              '"balanced"'::jsonb),
    ('auto_request_more_info',       'true'::jsonb),
    ('explain_root_cause',           'true'::jsonb),
    ('suggest_multiple_solutions',   'false'::jsonb),
    ('max_suggested_solutions',      '2'::jsonb),
    -- المعرفة
    ('knowledge_use_scenarios',      'true'::jsonb),
    ('knowledge_use_articles',       'true'::jsonb),
    ('knowledge_use_live_data',      'true'::jsonb),
    ('knowledge_priority',           '"articles_first"'::jsonb),
    ('knowledge_empathy_replies',    'true'::jsonb),
    ('articles_before_ticket',       'true'::jsonb),
    -- الذاكرة
    ('memory_keep_context',          'true'::jsonb),
    ('memory_context_minutes',       '120'::jsonb),
    ('memory_remember_name',         'true'::jsonb),
    ('memory_remember_last_issue',   'true'::jsonb),
    ('memory_use_past_conversations','false'::jsonb),
    -- إدارة الدعم
    ('ticket_on_low_confidence',     'true'::jsonb),
    ('ticket_on_anger',              'true'::jsonb),
    ('ticket_after_turns',           '6'::jsonb),
    ('ticket_include_summary',       'true'::jsonb),
    ('search_past_tickets',          'false'::jsonb),
    -- الذكاء والسلوك
    ('behavior_profile',             '"balanced"'::jsonb),
    ('answer_confidence',            '0.6'::jsonb),
    ('max_clarifying_questions',     '3'::jsonb),
    ('allow_smart_guess',            'false'::jsonb),
    ('inference_mode',               '"knowledge_and_inference"'::jsonb)
on conflict (key) do nothing;

-- `escalate_when_upset` was superseded by `ticket_on_anger`, which covers
-- the same decision but keyed on the emotion layer that now makes it. Carry
-- the operator's existing choice across rather than silently resetting it,
-- then drop the orphan so it stops being read as an unknown key.
update public.sie_settings tgt
   set value = src.value
  from public.sie_settings src
 where src.key = 'escalate_when_upset'
   and tgt.key = 'ticket_on_anger';

delete from public.sie_settings where key = 'escalate_when_upset';
