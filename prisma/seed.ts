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
  await prisma.matterContact.deleteMany();
  await prisma.matterTeamMember.deleteMany();
  await prisma.matter.deleteMany();
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
  // Matters (12 cases from the prototype)
  // ─────────────────────────────────────────────────────────────────────
  console.log("  Creating matters…");
  const matters = {
    alvarez: await prisma.matter.create({
      data: {
        name: "Alvarez v. City of Aurora et al.",
        caseNumber: "2026-CV-00481",
        area: "§1983",
        stage: "Discovery",
        court: "D. Colorado · Hon. L. Martinez",
        filedDate: new Date("2026-01-14"),
        trialDate: new Date("2026-10-05"),
        feeStructure: "contingent",
        trustBalance: 5000,
        wipAmount: 28400,
        description:
          "Excessive force claim arising from Jan 2026 arrest. Officer Doe's body camera captures the use-of-force sequence at 14:32.",
        color: "#3d83b8",
        isPinned: true,
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
        area: "§1983",
        stage: "Dispositive",
        court: "D. Colorado",
        filedDate: new Date("2025-08-12"),
        trialDate: new Date("2026-07-15"),
        feeStructure: "contingent",
        trustBalance: 0,
        wipAmount: 14200,
        description: "§1983 wrongful arrest and prolonged detention claim.",
        color: "#3d83b8",
        isPinned: true,
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
        area: "Housing/FHA",
        stage: "Retained",
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
        area: "Employment/CADA",
        stage: "Pre-suit",
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
        area: "ADA",
        stage: "Discovery",
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
        area: "Class",
        stage: "Cert",
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
        area: "Criminal",
        stage: "Pretrial",
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
        area: "Housing/FHA",
        stage: "Pre-suit",
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
        area: "Education/IDEA",
        stage: "Pre-suit",
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
        area: "§1983",
        stage: "Intake",
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
        area: "§1983",
        stage: "Settled",
        feeStructure: "contingent",
        trustBalance: 425000,
        wipAmount: 0,
        description: "Settled — distribution pending lien negotiations.",
        color: "#3d83b8",
        isPinned: true,
        clientId: contacts.carlaRivera.id,
        createdAt: new Date("2024-06-01"),
      },
    }),
    jenner: await prisma.matter.create({
      data: {
        name: "Jenner — employment",
        area: "Employment/CADA",
        stage: "Closed",
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

  // Link key contacts to the Alvarez matter (plaintiff, defendants, witness, expert)
  await prisma.matterContact.createMany({
    data: [
      {
        matterId: matters.alvarez.id,
        contactId: contacts.mariaAlvarez.id,
        role: "plaintiff",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.cityOfAurora.id,
        role: "defendant",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.officerDoe.id,
        role: "defendant",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.sgtCarter.id,
        role: "witness",
      },
      {
        matterId: matters.alvarez.id,
        contactId: contacts.drSingh.id,
        role: "expert",
      },
      {
        matterId: matters.williams.id,
        contactId: contacts.derekWilliams.id,
        role: "plaintiff",
      },
      {
        matterId: matters.williams.id,
        contactId: contacts.denverCityAtty.id,
        role: "opposing_counsel",
      },
      {
        matterId: matters.rivera.id,
        contactId: contacts.carlaRivera.id,
        role: "plaintiff",
      },
      {
        matterId: matters.rivera.id,
        contactId: contacts.memorialHospital.id,
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
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
