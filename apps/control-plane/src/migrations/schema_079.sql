-- Self-signup handoff invitations: the founder's link is shown once through the signup status endpoint, never emailed.
-- A handoff invitation carries delivery_status 'handoff' from the moment it is issued; the outbox delivery states
-- ('queued','sent','failed','local_capture') keep their meaning and only an emailed invitation moves through them.
ALTER TABLE admin_invitations DROP CONSTRAINT admin_invitations_delivery_status_check;
ALTER TABLE admin_invitations
  ADD CONSTRAINT admin_invitations_delivery_status_check
  CHECK(delivery_status IN ('queued','sent','failed','local_capture','handoff'));
