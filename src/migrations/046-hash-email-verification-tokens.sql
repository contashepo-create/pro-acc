-- 046 - Email verification tokens are now SHA-256 digests at rest.
-- Existing plaintext capabilities cannot be safely transformed without the raw
-- email link, so invalidate them. A customer can request a fresh link.
UPDATE users
   SET email_verification_token = NULL,
       email_verification_expires = NULL
 WHERE email_verification_token IS NOT NULL;
