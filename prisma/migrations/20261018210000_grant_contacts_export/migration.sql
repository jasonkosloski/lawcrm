-- Data only: the new contacts.export permission (bulk CSV export of the
-- contact directory used to need just a session). Grant it to every role
-- that can already edit contacts, so nobody who curates the directory
-- loses export; everyone else must be granted it in the role matrix.
-- Admins bypass the matrix. Idempotent.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'contacts.export'
FROM "role_permissions"
WHERE "permission" = 'contacts.edit'
ON CONFLICT ("roleId", "permission") DO NOTHING;
