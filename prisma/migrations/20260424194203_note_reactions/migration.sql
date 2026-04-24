-- CreateTable
CREATE TABLE "note_reactions" (
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "noteId", "emoji"),
    CONSTRAINT "note_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "note_reactions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "note_reactions_noteId_idx" ON "note_reactions"("noteId");

-- CreateIndex
CREATE INDEX "note_reactions_noteId_emoji_idx" ON "note_reactions"("noteId", "emoji");
