-- Data only: the new documents.edit permission (rename a document / change
-- its category after upload; there was no way to do either before). Grant
-- it to every role that can already upload documents, so nobody who files
-- documents is left unable to fix a typo; everyone else must be granted it
-- in the role matrix. Admins bypass the matrix. Idempotent.
INSERT INTO "role_permissions" ("roleId", "permission")
SELECT DISTINCT "roleId", 'documents.edit'
FROM "role_permissions"
WHERE "permission" = 'documents.upload'
ON CONFLICT ("roleId", "permission") DO NOTHING;
