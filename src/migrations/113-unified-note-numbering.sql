-- 113 — توحيد ترقيم الإشعارات الدائنة والمدينة
-- ---------------------------------------------------------------------------
-- عيب حرج اكتشفه الفحص المحاسبي البرمجي (2026-08):
--   عمود credit_notes.number مقيّد بـ UNIQUE(company_id, number) ويخدم النوعين
--   معًا (note_type IN ('credit','debit'))، لكن التسلسلين كانا مستقلين:
--     - next_credit_note_number يغذّي عدّادَه من كل الإشعارات (صحيح)
--     - next_debit_note_number يغذّي عدّادَه من المدينة فقط (خطأ)
--   النتيجة: أول إشعار مدينة في السنة يصادم أول إشعار دائن (كلاهما #1) برسالة
--   23505، وبعد أي خلط بين النوعين ينحرف عدّاد المدينة عن الدائن فتتكرر
--   الاصطدامات. أي شركة تصدر النوعين في سنة واحدة متضررة حتمًا.
-- الإصلاح: عدّاد واحد مشترك للنوعين (credit_note_sequences) مع قاع ذاتية
--   الشفاء على أعلى رقم فعلي في الجدول، فلا يمكن لأي حالة تاريخية أن تُنتج
--   رقمًا مستخدمًا من قبل.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_credit_note_number(p_company_id UUID, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_number INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('credit-note-number:' || p_company_id::text));
  INSERT INTO credit_note_sequences(company_id, year, last_number)
  SELECT p_company_id, p_year, COALESCE(max(number), 0) + 1
  FROM credit_notes WHERE company_id = p_company_id
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = GREATEST(credit_note_sequences.last_number,
    (SELECT COALESCE(max(number), 0) FROM credit_notes
     WHERE company_id = p_company_id)) + 1
  RETURNING last_number INTO v_number;
  RETURN v_number;
END
$$;
REVOKE ALL ON FUNCTION public.next_credit_note_number(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_credit_note_number(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.next_debit_note_number(p_company_id UUID, p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- الإشعارات المدينة تشارك عدّاد الدائنة: عمود واحد UNIQUE يخدم النوعين،
-- فلا بد من عدّاد واحد يرقّمهما معًا (انظر ملاحظة الإصدار 113).
BEGIN
  RETURN next_credit_note_number(p_company_id, p_year);
END
$$;
REVOKE ALL ON FUNCTION public.next_debit_note_number(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_debit_note_number(UUID, INTEGER) TO service_role;
