-- CreateTable
CREATE TABLE "transcript_purges" (
    "id" TEXT NOT NULL,
    "providerJobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transcript_purges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transcript_purges_providerJobId_key" ON "transcript_purges"("providerJobId");

-- transcript purge trigger: deleting an in-flight transcript (directly, via
-- its Document, or via a matter cascade) queues the provider job for deletion.
CREATE OR REPLACE FUNCTION queue_transcript_purge() RETURNS trigger AS $$
BEGIN
  IF OLD."providerJobId" IS NOT NULL AND OLD.status IN ('queued', 'processing') THEN
    INSERT INTO "transcript_purges" ("id", "providerJobId")
    VALUES ('tp_' || md5(random()::text || clock_timestamp()::text), OLD."providerJobId")
    ON CONFLICT ("providerJobId") DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcripts_queue_purge ON "transcripts";
CREATE TRIGGER transcripts_queue_purge
  BEFORE DELETE ON "transcripts"
  FOR EACH ROW EXECUTE FUNCTION queue_transcript_purge();
