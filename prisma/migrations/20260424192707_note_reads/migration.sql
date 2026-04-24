-- CreateTable
CREATE TABLE "note_reads" (
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "noteId"),
    CONSTRAINT "note_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "note_reads_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "note_reads_noteId_idx" ON "note_reads"("noteId");
