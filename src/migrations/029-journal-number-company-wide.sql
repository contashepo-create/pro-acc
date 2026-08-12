-- Journal numbers are UNIQUE (company_id, number) without a year.
-- The old per-year sequence restarted at 1 each year and collided.
CREATE OR REPLACE FUNCTION next_journal_number(p_company_id UUID, p_year INT)
RETURNS INT AS $$
DECLARE next_num INT;
DECLARE max_existing INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || 'journal_entries'));

  INSERT INTO journal_sequences(company_id, year, last_number)
  VALUES (p_company_id, p_year, 1)
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = journal_sequences.last_number + 1
  RETURNING last_number INTO next_num;

  SELECT COALESCE(MAX(number), 0) INTO max_existing
  FROM journal_entries WHERE company_id = p_company_id;

  IF next_num <= max_existing THEN
    next_num := max_existing + 1;
    UPDATE journal_sequences
      SET last_number = next_num
      WHERE company_id = p_company_id AND year = p_year;
  END IF;

  RETURN next_num;
END;
$$ LANGUAGE plpgsql;
