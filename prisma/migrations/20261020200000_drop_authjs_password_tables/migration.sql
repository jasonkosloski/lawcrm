-- Staff auth moved to Clerk (ADR-053). Passwords, Auth.js's OAuth
-- account links and verification tokens are no longer used.

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_userId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "emailVerified",
DROP COLUMN "image",
DROP COLUMN "passwordHash";

-- DropTable
DROP TABLE "accounts";

-- DropTable
DROP TABLE "verification_tokens";
