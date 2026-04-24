/**
 * Seed script — Kosloski Law CRM
 *
 * Populates the dev database with realistic fixture data drawn from the
 * design prototype. Running this wipes existing data and re-creates a
 * consistent snapshot so the dashboard, matters list, calendar, and
 * time/billing surfaces all hang together.
 *
 * Usage:
 *   npm run db:seed           # re-seed without touching migrations
 *   npm run db:reset          # drop DB, re-run migrations, then seed
 *
 * All timestamps are anchored to `NOW` (2026-04-24) so relative labels
 * like "deadlines this week" and "hours today" match reality.
 */

import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

// Anchor date — everything relative is computed from this.
const NOW = new Date("2026-04-24T09:00:00-06:00");

/** Helpers for relative date arithmetic. */
const daysFromNow = (days: number, hour = 9, minute = 0): Date => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const at = (hour: number, minute = 0): Date => daysFromNow(0, hour, minute);

async function main() {
  console.log("🌱 Seeding database…\n");

  // ─────────────────────────────────────────────────────────────────────
  // Clear existing data (child → parent to respect FK constraints)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Clearing existing data…");
  await prisma.settlementApproval.deleteMany();
  await prisma.settlementLien.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.trustTransaction.deleteMany();
  await prisma.emailAttachment.deleteMany();
  await prisma.emailLabel.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.emailThread.deleteMany();
  await prisma.emailAccount.deleteMany();
  await prisma.flaggedMoment.deleteMany();
  await prisma.evidenceSync.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.calendarAttendee.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.deadline.deleteMany();
  await prisma.task.deleteMany();
  await prisma.note.deleteMany();
  await prisma.document.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.userMatterPin.deleteMany();
  await prisma.matterContact.deleteMany();
  await prisma.matterTeamMember.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.matterStage.deleteMany();
  await prisma.practiceArea.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.automation.deleteMany();
  await prisma.user.deleteMany();

  // ─────────────────────────────────────────────────────────────────────
  // Users (firm team)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating users…");
  const [jason, leo, rachel, marco, elena] = await Promise.all([
    prisma.user.create({
      data: {
        email: "jkosloski@kosloskilaw.com",
        name: "Jason Kosloski",
        initials: "JM",
        role: "Managing",
        barNumber: "CO-44821",
        phone: "(303) 555-0100",
      },
    }),
    prisma.user.create({
      data: {
        email: "leo@kosloskilaw.com",
        name: "Leo Kosloski",
        initials: "LK",
        role: "Partner",
        barNumber: "CO-39110",
        phone: "(303) 555-0101",
      },
    }),
    prisma.user.create({
      data: {
        email: "rachel@kosloskilaw.com",
        name: "Rachel Kim",
        initials: "RK",
        role: "Paralegal",
        phone: "(303) 555-0102",
      },
    }),
    prisma.user.create({
      data: {
        email: "marco@kosloskilaw.com",
        name: "Marco Guerra",
        initials: "MG",
        role: "Investigator",
        phone: "(303) 555-0103",
      },
    }),
    prisma.user.create({
      data: {
        email: "elena@kosloskilaw.com",
        name: "Elena Serrano",
        initials: "ES",
        role: "Intake",
        phone: "(303) 555-0104",
      },
    }),
  ]);

  // ─────────────────────────────────────────────────────────────────────
  // Contacts (clients, opposing parties, witnesses, experts)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating contacts…");
  const contacts = {
    mariaAlvarez: await prisma.contact.create({
      data: {
        name: "Maria Alvarez",
        email: "maria.alvarez@email.com",
        phone: "(303) 555-0182",
        type: "client",
        city: "Aurora",
        state: "CO",
      },
    }),
    cityOfAurora: await prisma.contact.create({
      data: {
        name: "City of Aurora",
        organization: "Aurora City Attorney's Office",
        email: "r.alvarado@aurora.gov",
        type: "government",
      },
    }),
    officerDoe: await prisma.contact.create({
      data: {
        name: "Officer J. Doe",
        organization: "Aurora Police Dept · Badge #4412",
        type: "opposing_counsel",
      },
    }),
    sgtCarter: await prisma.contact.create({
      data: {
        name: "Sgt. Carter",
        organization: "APD · Badge #2211",
        type: "witness",
      },
    }),
    drSingh: await prisma.contact.create({
      data: {
        name: "Dr. M. Singh",
        email: "msingh@ohealth.org",
        organization: "Orthopedic Health",
        type: "expert",
      },
    }),
    derekWilliams: await prisma.contact.create({
      data: {
        name: "Derek Williams",
        email: "d.williams@email.com",
        phone: "(303) 555-0221",
        type: "client",
      },
    }),
    priyaPatel: await prisma.contact.create({
      data: {
        name: "Priya Patel",
        email: "ppatel@email.com",
        phone: "(720) 555-0188",
        type: "client",
      },
    }),
    anaMoreno: await prisma.contact.create({
      data: {
        name: "Ana Moreno",
        email: "amoreno@email.com",
        type: "client",
      },
    }),
    danChen: await prisma.contact.create({
      data: {
        name: "Dan Chen",
        email: "dchen@email.com",
        type: "client",
      },
    }),
    henryNguyen: await prisma.contact.create({
      data: {
        name: "Henry Nguyen",
        email: "hnguyen@email.com",
        type: "client",
      },
    }),
    luisRodriguez: await prisma.contact.create({
      data: {
        name: "Luis Rodriguez",
        email: "lrodriguez@email.com",
        type: "client",
      },
    }),
    sarahEllis: await prisma.contact.create({
      data: {
        name: "Sarah Ellis",
        email: "sellis@email.com",
        type: "client",
      },
    }),
    robertBoaz: await prisma.contact.create({
      data: {
        name: "Robert Boaz",
        type: "client",
      },
    }),
    carlaRivera: await prisma.contact.create({
      data: {
        name: "Carla Rivera",
        email: "crivera@email.com",
        type: "client",
      },
    }),
    markJenner: await prisma.contact.create({
      data: {
        name: "Mark Jenner",
        email: "mjenner@email.com",
        type: "client",
      },
    }),
    denverCityAtty: await prisma.contact.create({
      data: {
        name: "Denver City Attorney",
        organization: "City and County of Denver",
        type: "opposing_counsel",
      },
    }),
    memorialHospital: await prisma.contact.create({
      data: {
        name: "Memorial Hospital",
        type: "medical_provider",
      },
    }),
  };

  // ─────────────────────────────────────────────────────────────────────
  // Practice areas + stages (firm-configurable in settings)
  //
  // Each area seeds with the default 10-stage lifecycle. Firms can
  // rename, reorder, archive, or add/remove stages per area via the
  // settings UI. Matters always link to a specific stage row rather
  // than carrying a stage-name string, so renames don't orphan data.
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating practice areas + stages…");
  const AREA_SEEDS: Array<{
    name: string;
    label: string;
    color: string;
    order: number;
  }> = [
    { name: "§1983", label: "§1983 · Civil rights", color: "#2563a8", order: 0 },
    { name: "Housing/FHA", label: "Housing · FHA", color: "#2d8a5f", order: 1 },
    { name: "Employment/CADA", label: "Employment · CADA", color: "#b6623d", order: 2 },
    { name: "Criminal", label: "Criminal", color: "#7a5aa6", order: 3 },
    { name: "Class", label: "Class actions", color: "#8a6a2d", order: 4 },
    { name: "ADA", label: "ADA", color: "#3a8a7a", order: 5 },
    { name: "Education/IDEA", label: "Education · IDEA", color: "#3a8a7a", order: 6 },
  ];

  const DEFAULT_STAGES: Array<{ name: string; isTerminal?: boolean }> = [
    { name: "Intake" },
    { name: "Pre-suit" },
    { name: "Retained" },
    { name: "Discovery" },
    { name: "Dispositive" },
    { name: "Pretrial" },
    { name: "Cert" },
    { name: "Trial/Settle" },
    { name: "Settled", isTerminal: true },
    { name: "Closed", isTerminal: true },
  ];

  const practiceAreas: Record<
    string,
    { id: string; color: string; stages: Record<string, string> }
  > = {};
  for (const area of AREA_SEEDS) {
    const pa = await prisma.practiceArea.create({
      data: {
        name: area.name,
        label: area.label,
        color: area.color,
        order: area.order,
      },
    });
    const stages: Record<string, string> = {};
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      const s = DEFAULT_STAGES[i];
      const stage = await prisma.matterStage.create({
        data: {
          practiceAreaId: pa.id,
          name: s.name,
          order: i,
          isTerminal: s.isTerminal ?? false,
        },
      });
      stages[s.name] = stage.id;
    }
    practiceAreas[area.name] = { id: pa.id, color: area.color, stages };
  }

  /** Resolve area + stage names to FK ids for matter seed rows. */
  const ref = (area: string, stage: string) => ({
    practiceAreaId: practiceAreas[area].id,
    stageId: practiceAreas[area].stages[stage],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Matters (12 cases from the prototype)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating matters…");
  const matters = {
    alvarez: await prisma.matter.create({
      data: {
        name: "Alvarez v. City of Aurora et al.",
        caseNumber: "2026-CV-00481",
        ...ref("§1983", "Discovery"),
        court: "D. Colorado · Hon. L. Martinez",
        filedDate: new Date("2026-01-14"),
        trialDate: new Date("2026-10-05"),
        feeStructure: "contingent",
        trustBalance: 5000,
        wipAmount: 28400,
        description:
          "Excessive force claim arising from Jan 2026 arrest. Officer Doe's body camera captures the use-of-force sequence at 14:32.",
        color: "#3d83b8",
        clientId: contacts.mariaAlvarez.id,
        opposingParty: "Officer J. Doe, APD, City of Aurora",
        opposingFirm: "Aurora City Attorney · R. Alvarado",
        createdAt: new Date("2026-01-10"),
      },
    }),
    williams: await prisma.matter.create({
      data: {
        name: "Williams v. Denver",
        caseNumber: "2025-CV-02014",
        ...ref("§1983", "Dispositive"),
        court: "D. Colorado",
        filedDate: new Date("2025-08-12"),
        trialDate: new Date("2026-07-15"),
        feeStructure: "contingent",
        trustBalance: 0,
        wipAmount: 14200,
        description: "§1983 wrongful arrest and prolonged detention claim.",
        color: "#3d83b8",
        clientId: contacts.derekWilliams.id,
        opposingParty: "Denver PD officers",
        opposingFirm: "Denver City Attorney",
        createdAt: new Date("2025-08-01"),
      },
    }),
    patel: await prisma.matter.create({
      data: {
        name: "Patel — FHA",
        caseNumber: "2026-CV-00655",
        ...ref("Housing/FHA", "Retained"),
        feeStructure: "hourly",
        trustBalance: 4120,
        wipAmount: 3800,
        description: "Fair Housing Act discrimination claim against landlord.",
        color: "#2d8a5f",
        clientId: contacts.priyaPatel.id,
        createdAt: daysFromNow(-10),
      },
    }),
    moreno: await prisma.matter.create({
      data: {
        name: "Moreno — CADA",
        ...ref("Employment/CADA", "Pre-suit"),
        feeStructure: "hybrid",
        trustBalance: 2500,
        wipAmount: 6200,
        description: "CADA employment discrimination — pre-suit demand phase.",
        color: "#b6623d",
        clientId: contacts.anaMoreno.id,
        createdAt: daysFromNow(-35),
      },
    }),
    chen: await prisma.matter.create({
      data: {
        name: "Chen — ADA transit",
        caseNumber: "2026-CV-00311",
        ...ref("ADA", "Discovery"),
        feeStructure: "contingent",
        trustBalance: 0,
        wipAmount: 11900,
        color: "#3d83b8",
        clientId: contacts.danChen.id,
        createdAt: new Date("2026-01-20"),
      },
    }),
    aurora: await prisma.matter.create({
      data: {
        name: "In re: Aurora class",
        caseNumber: "2026-CV-00122",
        ...ref("Class", "Cert"),
        court: "D. Colorado",
        filedDate: new Date("2026-02-03"),
        feeStructure: "contingent",
        trustBalance: 0,
        wipAmount: 41800,
        description: "Class action cert motion in progress. 142 class members.",
        color: "#8a6a2d",
        createdAt: new Date("2026-01-28"),
      },
    }),
    nguyen: await prisma.matter.create({
      data: {
        name: "Nguyen — DUI",
        ...ref("Criminal", "Pretrial"),
        feeStructure: "flat",
        trustBalance: 3500,
        wipAmount: 1200,
        color: "#7a5aa6",
        clientId: contacts.henryNguyen.id,
        createdAt: daysFromNow(-45),
      },
    }),
    rodriguez: await prisma.matter.create({
      data: {
        name: "Rodriguez — FHA",
        ...ref("Housing/FHA", "Pre-suit"),
        feeStructure: "hourly",
        trustBalance: 1200,
        wipAmount: 2400,
        color: "#2d8a5f",
        clientId: contacts.luisRodriguez.id,
        createdAt: daysFromNow(-3),
      },
    }),
    ellis: await prisma.matter.create({
      data: {
        name: "Ellis — IDEA",
        ...ref("Education/IDEA", "Pre-suit"),
        feeStructure: "contingent",
        trustBalance: 0,
        wipAmount: 800,
        color: "#3a8a7a",
        clientId: contacts.sarahEllis.id,
        createdAt: daysFromNow(-60),
      },
    }),
    boaz: await prisma.matter.create({
      data: {
        name: "Boaz — §1983 prisoner",
        ...ref("§1983", "Intake"),
        feeStructure: "pro_bono",
        trustBalance: 0,
        wipAmount: 0,
        color: "#3d83b8",
        clientId: contacts.robertBoaz.id,
        createdAt: daysFromNow(-5),
      },
    }),
    rivera: await prisma.matter.create({
      data: {
        name: "Rivera v. Lakewood",
        caseNumber: "2024-CV-01188",
        ...ref("§1983", "Settled"),
        feeStructure: "contingent",
        trustBalance: 425000,
        wipAmount: 0,
        description: "Settled — distribution pending lien negotiations.",
        color: "#3d83b8",
        clientId: contacts.carlaRivera.id,
        createdAt: new Date("2024-06-01"),
      },
    }),
    jenner: await prisma.matter.create({
      data: {
        name: "Jenner — employment",
        ...ref("Employment/CADA", "Closed"),
        feeStructure: "hourly",
        trustBalance: 0,
        wipAmount: 0,
        isArchived: true,
        color: "#b6623d",
        clientId: contacts.markJenner.id,
        createdAt: new Date("2024-11-15"),
      },
    }),
  };

  // ─────────────────────────────────────────────────────────────────────
  // Team assignments (lead + support per matter)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Assigning teams…");
  const teamAssignments: Array<{
    matterId: string;
    userId: string;
    role: string;
  }> = [
    { matterId: matters.alvarez.id, userId: jason.id, role: "lead" },
    { matterId: matters.alvarez.id, userId: rachel.id, role: "paralegal" },
    { matterId: matters.alvarez.id, userId: leo.id, role: "co_counsel" },
    { matterId: matters.alvarez.id, userId: marco.id, role: "investigator" },
    { matterId: matters.williams.id, userId: jason.id, role: "lead" },
    { matterId: matters.williams.id, userId: rachel.id, role: "paralegal" },
    { matterId: matters.patel.id, userId: rachel.id, role: "lead" },
    { matterId: matters.moreno.id, userId: jason.id, role: "lead" },
    { matterId: matters.chen.id, userId: jason.id, role: "lead" },
    { matterId: matters.aurora.id, userId: leo.id, role: "lead" },
    { matterId: matters.aurora.id, userId: jason.id, role: "co_counsel" },
    { matterId: matters.nguyen.id, userId: marco.id, role: "lead" },
    { matterId: matters.rodriguez.id, userId: rachel.id, role: "lead" },
    { matterId: matters.ellis.id, userId: jason.id, role: "lead" },
    { matterId: matters.boaz.id, userId: jason.id, role: "lead" },
    { matterId: matters.rivera.id, userId: jason.id, role: "lead" },
    { matterId: matters.jenner.id, userId: leo.id, role: "lead" },
  ];
  await prisma.matterTeamMember.createMany({ data: teamAssignments });

  // Jason's pinned matters — previously modeled as a global Matter.isPinned
  // boolean; now per-user via UserMatterPin. Leo, Rachel, etc. start with no
  // pins (empty sidebar "Pinned" section) so users curate their own.
  console.log("  Pinning matters for Jason…");
  await prisma.userMatterPin.createMany({
    data: [
      { userId: jason.id, matterId: matters.alvarez.id },
      { userId: jason.id, matterId: matters.williams.id },
      { userId: jason.id, matterId: matters.rivera.id },
    ],
  });

  // Link key contacts to the Alvarez matter. `category` is the
  // display bucket; `role` is the finer-grained subrole.
  await prisma.matterContact.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        contactId: contacts.mariaAlvarez.id,
        category: "client",
        role: "plaintiff",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.cityOfAurora.id,
        category: "opposing",
        role: "defendant",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.officerDoe.id,
        category: "opposing",
        role: "defendant",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.sgtCarter.id,
        category: "lay_witness",
        role: "witness",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.drSingh.id,
        category: "expert_witness",
        role: "expert",
      },
      {
        matterId: matters.williams.id,
        contactId: contacts.derekWilliams.id,
        category: "client",
        role: "plaintiff",
      },
      {
        matterId: matters.williams.id,
        contactId: contacts.denverCityAtty.id,
        category: "opposing",
        role: "opposing_counsel",
      },
      {
        matterId: matters.rivera.id,
        contactId: contacts.carlaRivera.id,
        category: "client",
        role: "plaintiff",
      },
      {
        matterId: matters.rivera.id,
        contactId: contacts.memorialHospital.id,
        category: "other",
        role: "lienholder",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Today's calendar events (drives "Today's agenda" on dashboard)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating calendar events…");
  await prisma.calendarEvent.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        title: "Alvarez — deposition prep",
        type: "meeting",
        startTime: at(9, 0),
        endTime: at(10, 0),
        location: "Office",
      },
      {
        matterId: matters.williams.id,
        title: "Williams — status conference call",
        type: "hearing",
        startTime: at(10, 30),
        endTime: at(11, 0),
        location: "Tel",
      },
      {
        matterId: null,
        title: "Intake — Patel phone screen",
        type: "intake",
        startTime: at(13, 0),
        endTime: at(13, 30),
        location: "Zoom",
      },
      {
        matterId: matters.rivera.id,
        title: "Rivera — settlement distribution review",
        type: "meeting",
        startTime: at(14, 30),
        endTime: at(15, 30),
        location: "Office",
      },
      {
        matterId: null,
        title: "Team standup",
        type: "meeting",
        startTime: at(16, 0),
        endTime: at(16, 30),
        location: "Office",
      },
      {
        matterId: matters.alvarez.id,
        title: "Deposition — Officer Doe",
        type: "deposition",
        startTime: daysFromNow(3, 9, 0),
        endTime: daysFromNow(3, 16, 0),
        location: "Court reporter · Denver",
      },
      {
        matterId: matters.aurora.id,
        title: "Class cert hearing",
        type: "hearing",
        startTime: daysFromNow(7, 13, 30),
        endTime: daysFromNow(7, 15, 0),
        location: "D. Colorado · Courtroom A601",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Deadlines (drives "Deadlines this week" panel)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating deadlines…");
  await prisma.deadline.createMany({
    data: [
      {
        matterId: matters.patel.id,
        title: "CGIA notice — Patel",
        dueDate: daysFromNow(2, 17, 0),
        kind: "critical",
        sourceType: "statute",
        sourceRef: "CRS §24-10-109",
        description:
          "Colorado Governmental Immunity Act — 182-day notice required before suit.",
        ownerId: jason.id,
      },
      {
        matterId: matters.williams.id,
        title: "Discovery cutoff — Williams",
        dueDate: daysFromNow(4, 17, 0),
        kind: "auto_rule",
        sourceType: "scheduling_order",
        ownerId: jason.id,
      },
      {
        matterId: matters.alvarez.id,
        title: "Expert report deadline — Alvarez",
        dueDate: daysFromNow(5, 17, 0),
        kind: "auto_rule",
        sourceType: "scheduling_order",
        ownerId: jason.id,
      },
      {
        matterId: matters.rivera.id,
        title: "Client meeting — Rivera",
        dueDate: daysFromNow(6, 14, 0),
        kind: "manual",
        ownerId: jason.id,
      },
      {
        matterId: matters.alvarez.id,
        title: "MTC response due",
        dueDate: daysFromNow(12, 17, 0),
        kind: "auto_rule",
        sourceType: "filing_rule",
        sourceRef: "FRCP 37",
        ownerId: jason.id,
      },
      {
        matterId: matters.aurora.id,
        title: "Class cert reply brief",
        dueDate: daysFromNow(19, 17, 0),
        kind: "critical",
        sourceType: "scheduling_order",
        ownerId: leo.id,
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Time entries — drives "Hours today" (4.2) and "Billable MTD" (142.6)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating time entries…");
  // Today — totals 4.2 hours for Jason
  await prisma.timeEntry.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        userId: jason.id,
        date: NOW,
        hours: 1.5,
        activity: "Deposition prep — Officer Doe",
        utbmsCode: "L330",
        rate: 550,
        amount: 825,
        source: "calendar",
        status: "draft",
      },
      {
        matterId: matters.williams.id,
        userId: jason.id,
        date: NOW,
        hours: 0.7,
        activity: "Status conference call w/ opposing",
        utbmsCode: "L120",
        rate: 550,
        amount: 385,
        source: "calendar",
        status: "draft",
      },
      {
        matterId: matters.alvarez.id,
        userId: jason.id,
        date: NOW,
        hours: 1.2,
        activity: "Review Officer Doe CORA production",
        utbmsCode: "L310",
        rate: 550,
        amount: 660,
        source: "manual",
        status: "draft",
      },
      {
        matterId: matters.rivera.id,
        userId: jason.id,
        date: NOW,
        hours: 0.8,
        activity: "Settlement distribution review",
        utbmsCode: "L160",
        rate: 550,
        amount: 440,
        source: "calendar",
        status: "draft",
      },
    ],
  });

  // Prior days this month — backfill to ~142.6h MTD for Jason
  // Today contributes 4.2h; we need ~138.4 more across 23 prior days.
  const priorDayEntries: Array<{
    matterId: string;
    userId: string;
    date: Date;
    hours: number;
    activity: string;
    rate: number;
    amount: number;
    source: string;
    status: string;
  }> = [];
  const matterIds = [
    matters.alvarez.id,
    matters.williams.id,
    matters.chen.id,
    matters.aurora.id,
    matters.patel.id,
    matters.moreno.id,
  ];
  const activities = [
    "Draft motion",
    "Client conference",
    "Review discovery production",
    "Deposition prep",
    "Research — qualified immunity",
    "Draft interrogatory responses",
    "Review ECF filings",
    "Witness prep",
    "Meet and confer",
    "Draft opposition brief",
  ];
  // Spread 138.4h across weekdays in April so far (approx 6h/weekday).
  for (let daysBack = 1; daysBack <= 23; daysBack++) {
    const d = daysFromNow(-daysBack, 10, 0);
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    // 2-3 entries per day averaging ~6.5 hours
    const entryCount = 2 + (daysBack % 2);
    const dayTotal = 6 + ((daysBack % 3) - 1) * 0.8; // ~5.2–6.8
    for (let i = 0; i < entryCount; i++) {
      const hours = +(dayTotal / entryCount).toFixed(1);
      priorDayEntries.push({
        matterId: matterIds[(daysBack + i) % matterIds.length],
        userId: jason.id,
        date: d,
        hours,
        activity: activities[(daysBack + i) % activities.length],
        rate: 550,
        amount: +(hours * 550).toFixed(2),
        source: "manual",
        status: "billable",
      });
    }
  }
  await prisma.timeEntry.createMany({ data: priorDayEntries });

  // ─────────────────────────────────────────────────────────────────────
  // Activity log — drives "Recent activity" on dashboard
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating activity log…");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
  await prisma.activityLog.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        userId: null,
        type: "filing",
        icon: "gavel",
        source: "PACER",
        title: "PACER filing received — Alvarez",
        detail: "ECF #42 · Order on MTC",
        timestamp: hoursAgo(2),
      },
      {
        matterId: matters.williams.id,
        userId: null,
        type: "email",
        icon: "mail",
        source: "Email",
        title: "Email from opposing counsel — Williams",
        detail: "Re: Rule 26 disclosures",
        timestamp: hoursAgo(3),
      },
      {
        matterId: matters.alvarez.id,
        userId: marco.id,
        type: "evidence",
        icon: "video",
        source: "Evidence",
        title: "Evidence synced — Alvarez",
        detail: "BWC · Officer Doe #4412 · 14:22",
        timestamp: hoursAgo(5),
      },
      {
        matterId: matters.rivera.id,
        userId: rachel.id,
        type: "task_complete",
        icon: "check",
        source: "Task",
        title: "Task completed — Rivera lien negotiation",
        detail: "Memorial Hospital · $12,400 → $8,200",
        timestamp: hoursAgo(26),
      },
      {
        matterId: matters.patel.id,
        userId: null,
        type: "automation",
        icon: "zap",
        source: "Automation",
        title: "Automation ran — CGIA notice",
        detail: "Patel intake → CGIA notice generated",
        timestamp: hoursAgo(28),
      },
      {
        matterId: matters.alvarez.id,
        userId: jason.id,
        type: "note",
        icon: "note",
        source: "System",
        title: "Strategy note added — Alvarez",
        detail: "Settlement posture updated after comps review",
        timestamp: hoursAgo(48),
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Trust transactions — drives "Trust balance" KPI (~$142,800 across 6)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating trust transactions…");
  const trustSeeds: Array<[string, number, string, number]> = [
    [matters.alvarez.id, 5000, "Initial retainer deposit", -60],
    [matters.patel.id, 5000, "Retainer deposit", -45],
    [matters.patel.id, -880, "Filing fees disbursement", -10],
    [matters.moreno.id, 2500, "Consultation retainer", -30],
    [matters.nguyen.id, 3500, "Flat fee retainer", -20],
    [matters.rodriguez.id, 1200, "Initial deposit", -15],
    [matters.rivera.id, 425000, "Settlement funds received", -3],
    [matters.rivera.id, -286400, "Firm fee transferred to operating", -2],
  ];
  await prisma.trustTransaction.createMany({
    data: trustSeeds.map(([matterId, amount, description, offset]) => ({
      matterId,
      type: amount > 0 ? "deposit" : "disbursement",
      amount,
      description,
      date: daysFromNow(offset),
      reconciled: true,
      createdBy: jason.id,
    })),
  });

  // ─────────────────────────────────────────────────────────────────────
  // Leads (intake queue)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating leads…");
  await prisma.lead.createMany({
    data: [
      {
        name: "Priya Patel",
        email: "ppatel@email.com",
        phone: "(720) 555-0188",
        source: "referral",
        sourceDetail: "referral · Fox",
        summary:
          "Alleged FHA violation — landlord refused reasonable accommodation for service animal.",
        dateOfIncident: new Date("2026-02-18"),
        score: 82,
        liabilityAssessment: "strong",
        damagesAssessment: "moderate",
        statuteWindow: 340,
        conflictCheck: "clear",
        stage: "converted",
        convertedMatterId: matters.patel.id,
      },
      {
        name: "Jessica Hale",
        email: "jhale@email.com",
        phone: "(303) 555-0244",
        source: "web",
        summary:
          "Police encounter — alleged excessive force during traffic stop. Seeking representation.",
        dateOfIncident: new Date("2026-04-02"),
        score: 76,
        liabilityAssessment: "strong",
        damagesAssessment: "strong",
        statuteWindow: 720,
        conflictCheck: "clear",
        stage: "qualifying",
      },
      {
        name: "David Okafor",
        email: "dokafor@email.com",
        source: "court_appointment",
        summary: "Prisoner civil rights inquiry — mail not delivered.",
        score: 41,
        liabilityAssessment: "moderate",
        damagesAssessment: "weak",
        conflictCheck: "clear",
        stage: "new",
      },
      {
        name: "Tanya Brooks",
        phone: "(720) 555-0331",
        source: "phone",
        summary: "Workplace retaliation after pregnancy disclosure.",
        dateOfIncident: new Date("2026-03-15"),
        score: 68,
        liabilityAssessment: "moderate",
        damagesAssessment: "moderate",
        statuteWindow: 265,
        conflictCheck: "pending",
        stage: "contacted",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tasks (a handful linked to Alvarez to populate the Tasks tab later)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating tasks…");
  await prisma.task.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        title: "Draft Officer Doe deposition outline",
        priority: "high",
        status: "in_progress",
        dueDate: daysFromNow(2, 17, 0),
        ownerId: jason.id,
      },
      {
        matterId: matters.alvarez.id,
        title: "Obtain Officer Doe UOF history via CORA",
        priority: "high",
        status: "open",
        dueDate: daysFromNow(5, 17, 0),
        ownerId: marco.id,
      },
      {
        matterId: matters.alvarez.id,
        title: "Coordinate Dr. Singh expert report",
        priority: "urgent",
        status: "open",
        dueDate: daysFromNow(5, 17, 0),
        ownerId: rachel.id,
      },
      {
        matterId: matters.patel.id,
        title: "File CGIA notice",
        priority: "urgent",
        status: "open",
        dueDate: daysFromNow(2, 17, 0),
        ownerId: jason.id,
      },
      {
        matterId: matters.rivera.id,
        title: "Finalize lien negotiations w/ Memorial",
        priority: "high",
        status: "in_review",
        dueDate: daysFromNow(6, 17, 0),
        ownerId: rachel.id,
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Notes (strategy memo on Alvarez)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating notes…");
  await prisma.note.create({
    data: {
      matterId: matters.alvarez.id,
      authorId: jason.id,
      type: "strategy",
      isPinned: true,
      content:
        "Best evidence: Officer Doe's own BWC footage (14:32 strike sequence) + supervisor Carter's contemporaneous statement (\"ease up, she's down\") + Dr. Singh's orthopedic findings.\n\nRisks: Aurora will cite Kisela v. Hughes. Counter with Estate of Smart v. Aurora (10th Cir. 2025) — factually on-point and clearly established.\n\nSettlement posture: Comps support $380–520k. Won't engage seriously until after MTD ruling (~Jun). Floor: $300k.\n\nOpen questions: UOF history on Doe — still waiting on CORA compliance. If pattern shows, open Monell theory.",
    },
  });

  // ─────────────────────────────────────────────────────────────────────
  // Documents (a few per major matter)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating documents…");
  await prisma.document.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        name: "Complaint — Alvarez v. Aurora",
        category: "filing",
        source: "ECF",
        status: "filed",
        uploadedBy: jason.id,
      },
      {
        matterId: matters.alvarez.id,
        name: "Amended complaint",
        category: "filing",
        source: "ECF",
        status: "filed",
        uploadedBy: jason.id,
      },
      {
        matterId: matters.alvarez.id,
        name: "Answer · defendants",
        category: "pleading",
        source: "ECF",
        status: "received",
      },
      {
        matterId: matters.alvarez.id,
        name: "Dr. Singh — expert report (draft)",
        category: "expert_report",
        source: "upload",
        status: "review",
        uploadedBy: rachel.id,
      },
      {
        matterId: matters.williams.id,
        name: "Rule 26 disclosures — plaintiff",
        category: "discovery",
        source: "generated",
        status: "filed",
        uploadedBy: jason.id,
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────────────
  // Email account + threads for Jason (Communication page demo data)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating email account + threads…");
  const jasonAccount = await prisma.emailAccount.create({
    data: {
      userId: jason.id,
      provider: "gmail",
      emailAddress: "jkosloski@kosloskilaw.com",
      syncStatus: "connected",
      lastSyncAt: NOW,
      threadsIndexed: 847,
    },
  });

  const JASON_EMAIL = "jkosloski@kosloskilaw.com";

  type ThreadSeed = {
    subject: string;
    snippet: string;
    matterId: string | null;
    lastMessageAt: Date;
    isRead: boolean;
    isStarred: boolean;
    hasAttachments: boolean;
    labels?: string[];
    messages: Array<{
      fromName: string;
      fromEmail: string;
      toRecipients: Array<{ name: string; email: string }>;
      ccRecipients?: Array<{ name: string; email: string }>;
      body: string;
      sentAt: Date;
      isPrivileged?: boolean;
      attachments?: Array<{
        filename: string;
        contentType: string;
        fileSize: number;
      }>;
    }>;
  };

  const threadSeeds: ThreadSeed[] = [
    {
      subject: "Rule 26 disclosures — schedule",
      snippet:
        "Attached the initial disclosures. We propose discovery cutoff of…",
      matterId: matters.williams.id,
      lastMessageAt: hoursAgo(3),
      isRead: false,
      isStarred: true,
      hasAttachments: true,
      labels: ["opposing_counsel"],
      messages: [
        {
          fromName: "A. McGrath",
          fromEmail: "a.mcgrath@denvergov.org",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          ccRecipients: [
            { name: "Rachel Kim", email: "rachel@kosloskilaw.com" },
          ],
          body: `Counsel,

Attached are the City's initial Rule 26 disclosures. We propose a discovery cutoff of July 15 and expert disclosures on staggered dates per the attached schedule.

Please confirm by EOD Friday so I can circulate a joint proposed order.

Best,
A. McGrath
Senior Counsel
Denver City Attorney's Office`,
          sentAt: hoursAgo(3),
          attachments: [
            {
              filename: "Denver — Rule 26 disclosures.pdf",
              contentType: "application/pdf",
              fileSize: 284_112,
            },
            {
              filename: "Proposed schedule.pdf",
              contentType: "application/pdf",
              fileSize: 98_420,
            },
          ],
        },
      ],
    },
    {
      subject: "CORA request — Officer Doe UOF history",
      snippet: "We're following up on the CORA request filed 4/02 regarding…",
      matterId: matters.alvarez.id,
      lastMessageAt: hoursAgo(6),
      isRead: false,
      isStarred: false,
      hasAttachments: false,
      messages: [
        {
          fromName: "Marco Guerra",
          fromEmail: "marco@kosloskilaw.com",
          toRecipients: [
            { name: "APD Records", email: "records@aurorapd.org" },
          ],
          ccRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `APD Records,

Following up on CORA request #A-2023-441 filed April 2. We requested Officer J. Doe's (badge #4412) use-of-force history for the past 5 years, including any internal affairs findings.

Per CRS §24-72-205(6), the statutory response window closes this Friday. Please confirm receipt and provide a production schedule.

Regards,
Marco Guerra
Investigator, Kosloski Law`,
          sentAt: hoursAgo(48),
        },
        {
          fromName: "APD Records",
          fromEmail: "records@aurorapd.org",
          toRecipients: [
            { name: "Marco Guerra", email: "marco@kosloskilaw.com" },
          ],
          body: `Mr. Guerra,

Request acknowledged. We require an additional 7 business days per CRS §24-72-203(3)(b). Production expected by April 30.

— APD Records`,
          sentAt: hoursAgo(6),
        },
      ],
    },
    {
      subject: "Meet & confer — MTD briefing",
      snippet:
        "Proposing Thursday 2pm for the meet & confer on the pending MTD…",
      matterId: matters.alvarez.id,
      lastMessageAt: hoursAgo(26),
      isRead: true,
      isStarred: false,
      hasAttachments: false,
      labels: ["opposing_counsel"],
      messages: [
        {
          fromName: "Ruben Alvarado",
          fromEmail: "r.alvarado@aurora.gov",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `Jason,

Proposing Thursday 4/25 at 2pm for the meet & confer on the pending MTD. We have a few narrow issues to discuss on the Monell claim; shouldn't take more than 30 minutes.

Zoom or phone — your preference.

Best,
Ruben Alvarado
Deputy City Attorney, Aurora`,
          sentAt: hoursAgo(26),
        },
      ],
    },
    {
      subject: "Memorial lien — revised reduction",
      snippet:
        "Memorial came back with $8,200 — that's 34% off original. Recommend accepting…",
      matterId: matters.rivera.id,
      lastMessageAt: hoursAgo(28),
      isRead: true,
      isStarred: true,
      hasAttachments: true,
      messages: [
        {
          fromName: "Rachel Kim",
          fromEmail: "rachel@kosloskilaw.com",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `Jason,

Memorial Hospital came back on the Rivera lien negotiation. They'll accept $8,200 — that's 34% off the original $12,400. Reasoning: the billed rates exceed what Medicare would've paid for comparable care.

Client net impact: adds ~$4,200 to Carla's distribution.

Recommend we accept. Need your sign-off.

— Rachel`,
          sentAt: hoursAgo(28),
          isPrivileged: true,
          attachments: [
            {
              filename: "Memorial lien — revised letter.pdf",
              contentType: "application/pdf",
              fileSize: 62_800,
            },
          ],
        },
      ],
    },
    {
      subject: "Dr. Singh expert engagement — retainer",
      snippet:
        "Engagement letter attached. Retainer $7,500 on receipt. Looking forward to working together…",
      matterId: matters.alvarez.id,
      lastMessageAt: daysFromNow(-2, 10, 15),
      isRead: true,
      isStarred: false,
      hasAttachments: true,
      messages: [
        {
          fromName: "Dr. M. Singh",
          fromEmail: "msingh@ohealth.org",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `Jason,

Engagement letter attached. Retainer is $7,500 on receipt, standard hourly after. CV and testimony log are also attached per the disclosure schedule.

I've blocked May 6–7 for a full records review and can do a video consult on 5/8 to walk through findings. Let me know if that works.

Best,
Meera Singh, MD
Orthopedic Health`,
          sentAt: daysFromNow(-2, 10, 15),
          attachments: [
            {
              filename: "Singh engagement letter.pdf",
              contentType: "application/pdf",
              fileSize: 142_300,
            },
            {
              filename: "Singh CV (2026).pdf",
              contentType: "application/pdf",
              fileSize: 198_040,
            },
          ],
        },
      ],
    },
    {
      subject: "Client update — next steps post-Rule 26",
      snippet:
        "Derek — quick summary of where we are. Disclosures went out today; we expect…",
      matterId: matters.williams.id,
      lastMessageAt: daysFromNow(-3, 16, 22),
      isRead: true,
      isStarred: false,
      hasAttachments: false,
      messages: [
        {
          fromName: "Jason Kosloski",
          fromEmail: JASON_EMAIL,
          toRecipients: [
            { name: "Derek Williams", email: "d.williams@email.com" },
          ],
          body: `Derek,

Quick summary of where we are on your case:

• Initial disclosures went out today. Denver has 21 days to respond.
• We've subpoenaed the body-cam footage and 911 dispatch tapes.
• Expert discovery opens May 15 — we'll be retaining a policing-practices expert.

Trial is still set for July 2 but realistically we'll spend the summer in discovery. Settlement window opens if/when Denver sees our expert's report.

Any questions, call anytime.

Jason`,
          sentAt: daysFromNow(-3, 16, 22),
        },
        {
          fromName: "Derek Williams",
          fromEmail: "d.williams@email.com",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `Jason — thanks for the clear update. Appreciate it. Will you be in touch before the 15th?`,
          sentAt: daysFromNow(-3, 17, 5),
        },
      ],
    },
    {
      subject: "Intake — Priya Patel follow-up",
      snippet:
        "Sending the retainer + conflict check confirmation. Welcome to Kosloski Law…",
      matterId: matters.patel.id,
      lastMessageAt: daysFromNow(-10, 11, 30),
      isRead: true,
      isStarred: false,
      hasAttachments: true,
      messages: [
        {
          fromName: "Elena Serrano",
          fromEmail: "elena@kosloskilaw.com",
          toRecipients: [{ name: "Priya Patel", email: "ppatel@email.com" }],
          ccRecipients: [
            { name: "Rachel Kim", email: "rachel@kosloskilaw.com" },
          ],
          body: `Priya,

Welcome to Kosloski Law. Attached:

• Engagement letter
• Rachel's contact info — she's your paralegal lead
• FHA intake questionnaire (short)

Please return the signed engagement letter at your earliest convenience. We'll follow up next week to schedule a kickoff call.

Best,
Elena Serrano
Intake Coordinator`,
          sentAt: daysFromNow(-10, 11, 30),
          attachments: [
            {
              filename: "Engagement letter — Patel.pdf",
              contentType: "application/pdf",
              fileSize: 124_000,
            },
            {
              filename: "FHA intake questionnaire.pdf",
              contentType: "application/pdf",
              fileSize: 84_200,
            },
          ],
        },
      ],
    },
    {
      subject: "PACER filing notification — Alvarez",
      snippet:
        "U.S. District Court, District of Colorado / 2026-CV-00481 / Minute Order…",
      matterId: matters.alvarez.id,
      lastMessageAt: hoursAgo(2),
      isRead: false,
      isStarred: false,
      hasAttachments: true,
      labels: ["auto_filed"],
      messages: [
        {
          fromName: "PACER (Notices)",
          fromEmail: "noreply@pacer.psc.uscourts.gov",
          toRecipients: [{ name: "Jason Kosloski", email: JASON_EMAIL }],
          body: `This is an automatic notification from the United States District Court for the District of Colorado.

Case: Alvarez v. City of Aurora et al. (2026-CV-00481)
Document #42: Minute Order on Motion to Compel
Filed: 04/24/2026

A copy of the document is available through PACER and is attached for your records. Response deadlines, if any, will run from the date of service.

— PACER NEF`,
          sentAt: hoursAgo(2),
          attachments: [
            {
              filename: "ECF 42 — Minute Order on MTC.pdf",
              contentType: "application/pdf",
              fileSize: 156_720,
            },
          ],
        },
      ],
    },
  ];

  for (const t of threadSeeds) {
    const thread = await prisma.emailThread.create({
      data: {
        accountId: jasonAccount.id,
        matterId: t.matterId,
        subject: t.subject,
        snippet: t.snippet,
        isRead: t.isRead,
        isStarred: t.isStarred,
        hasAttachments: t.hasAttachments,
        messageCount: t.messages.length,
        lastMessageAt: t.lastMessageAt,
        labels: t.labels
          ? { create: t.labels.map((label) => ({ label })) }
          : undefined,
      },
    });
    for (const msg of t.messages) {
      const created = await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          fromName: msg.fromName,
          fromEmail: msg.fromEmail,
          toRecipients: JSON.stringify(msg.toRecipients),
          ccRecipients: msg.ccRecipients
            ? JSON.stringify(msg.ccRecipients)
            : null,
          body: msg.body,
          sentAt: msg.sentAt,
          isPrivileged: msg.isPrivileged ?? false,
        },
      });
      if (msg.attachments && msg.attachments.length > 0) {
        await prisma.emailAttachment.createMany({
          data: msg.attachments.map((a) => ({
            messageId: created.id,
            filename: a.filename,
            contentType: a.contentType,
            fileSize: a.fileSize,
          })),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.matter.count(),
    prisma.contact.count(),
    prisma.lead.count(),
    prisma.calendarEvent.count(),
    prisma.deadline.count(),
    prisma.timeEntry.count(),
    prisma.activityLog.count(),
    prisma.task.count(),
    prisma.emailThread.count(),
  ]);
  console.log("\n✅ Seed complete:");
  console.log(`   ${counts[0]} users`);
  console.log(`   ${counts[1]} matters`);
  console.log(`   ${counts[2]} contacts`);
  console.log(`   ${counts[3]} leads`);
  console.log(`   ${counts[4]} calendar events`);
  console.log(`   ${counts[5]} deadlines`);
  console.log(`   ${counts[6]} time entries`);
  console.log(`   ${counts[7]} activity log entries`);
  console.log(`   ${counts[8]} tasks`);
  console.log(`   ${counts[9]} email threads`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
