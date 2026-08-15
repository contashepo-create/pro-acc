-- 045 - Prevent client-side subscription activation before payment confirmation.
-- A paid checkout request is represented by subscriptions.status='pending'.
-- Payment webhook processing is the only path that may transition it to active.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trial', 'pending', 'expired', 'cancelled'));
