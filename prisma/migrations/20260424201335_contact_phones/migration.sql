-- CreateTable
CREATE TABLE "contact_phones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "label" TEXT,
    "number" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_phones_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "contact_phones_contactId_idx" ON "contact_phones"("contactId");

-- CreateIndex
CREATE INDEX "contact_phones_contactId_isPrimary_idx" ON "contact_phones"("contactId", "isPrimary");
