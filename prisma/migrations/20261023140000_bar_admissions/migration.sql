-- CreateTable
CREATE TABLE "bar_admissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bar_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bar_admissions_userId_state_key" ON "bar_admissions"("userId", "state");

-- AddForeignKey
ALTER TABLE "bar_admissions" ADD CONSTRAINT "bar_admissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing bar numbers move to the firm's state.
INSERT INTO "bar_admissions" ("id", "userId", "state", "number", "createdAt")
SELECT gen_random_uuid()::text, u."id", s."code", left(btrim(u."barNumber"), 40), now()
FROM "users" u
JOIN "firms" f ON f."id" = u."firmId"
CROSS JOIN LATERAL (
  SELECT CASE
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('al', 'alabama') THEN 'AL'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ak', 'alaska') THEN 'AK'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('as', 'american samoa') THEN 'AS'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('az', 'arizona') THEN 'AZ'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ar', 'arkansas') THEN 'AR'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ca', 'california') THEN 'CA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('co', 'colorado') THEN 'CO'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ct', 'connecticut') THEN 'CT'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('de', 'delaware') THEN 'DE'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('dc', 'district of columbia') THEN 'DC'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('fl', 'florida') THEN 'FL'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ga', 'georgia') THEN 'GA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('gu', 'guam') THEN 'GU'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('hi', 'hawaii') THEN 'HI'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('id', 'idaho') THEN 'ID'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('il', 'illinois') THEN 'IL'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('in', 'indiana') THEN 'IN'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ia', 'iowa') THEN 'IA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ks', 'kansas') THEN 'KS'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ky', 'kentucky') THEN 'KY'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('la', 'louisiana') THEN 'LA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('me', 'maine') THEN 'ME'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('md', 'maryland') THEN 'MD'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ma', 'massachusetts') THEN 'MA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('mi', 'michigan') THEN 'MI'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('mn', 'minnesota') THEN 'MN'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ms', 'mississippi') THEN 'MS'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('mo', 'missouri') THEN 'MO'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('mt', 'montana') THEN 'MT'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ne', 'nebraska') THEN 'NE'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nv', 'nevada') THEN 'NV'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nh', 'new hampshire') THEN 'NH'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nj', 'new jersey') THEN 'NJ'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nm', 'new mexico') THEN 'NM'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ny', 'new york') THEN 'NY'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nc', 'north carolina') THEN 'NC'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('nd', 'north dakota') THEN 'ND'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('mp', 'northern mariana islands') THEN 'MP'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('oh', 'ohio') THEN 'OH'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ok', 'oklahoma') THEN 'OK'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('or', 'oregon') THEN 'OR'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('pa', 'pennsylvania') THEN 'PA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('pr', 'puerto rico') THEN 'PR'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ri', 'rhode island') THEN 'RI'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('sc', 'south carolina') THEN 'SC'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('sd', 'south dakota') THEN 'SD'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('tn', 'tennessee') THEN 'TN'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('tx', 'texas') THEN 'TX'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('vi', 'us virgin islands') THEN 'VI'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('ut', 'utah') THEN 'UT'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('vt', 'vermont') THEN 'VT'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('va', 'virginia') THEN 'VA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('wa', 'washington') THEN 'WA'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('wv', 'west virginia') THEN 'WV'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('wi', 'wisconsin') THEN 'WI'
      WHEN lower(regexp_replace(replace(btrim(f."state"), '.', ''), '\s+', ' ', 'g')) IN ('wy', 'wyoming') THEN 'WY'
  END AS "code"
) s
WHERE btrim(coalesce(u."barNumber", '')) <> ''
  AND s."code" IS NOT NULL
ON CONFLICT DO NOTHING;
