/**
 * /reports — `reports.view` page gate.
 *
 * The report queries do no permission check of their own (they are
 * firm-wide financial aggregates), so the page is the enforcement
 * point. Pin both sides: without the key the viewer is redirected
 * and NO report query runs; with it the page fetches in the viewer's
 * zone and renders.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/current-user", () => ({
  requireUser: vi.fn(async () => "user_1"),
}));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/queries/reports", () => ({
  getPipelineReport: vi.fn(async () => ({})),
  getUtilizationReport: vi.fn(async () => ({})),
  getArAgingReport: vi.fn(async () => ({})),
  getRealizationReport: vi.fn(async () => []),
}));

// Leaf components — only the gate and the data plumbing are under test.
vi.mock("@/components/layout/topbar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));
vi.mock("@/components/reports/pipeline-card", () => ({
  PipelineCard: () => <div data-testid="pipeline" />,
}));
vi.mock("@/components/reports/utilization-card", () => ({
  UtilizationCard: () => <div data-testid="utilization" />,
}));
vi.mock("@/components/reports/ar-aging-card", () => ({
  ArAgingCard: () => <div data-testid="ar" />,
}));
vi.mock("@/components/reports/realization-card", () => ({
  RealizationCard: () => <div data-testid="realization" />,
}));

import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getArAgingReport,
  getPipelineReport,
  getRealizationReport,
  getUtilizationReport,
} from "@/lib/queries/reports";
import ReportsPage from "./page";

const mockedHasPermission = vi.mocked(currentUserHasPermission);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/reports page gate", () => {
  test("without reports.view: redirects home and runs no report query", async () => {
    mockedHasPermission.mockResolvedValue(false);

    await expect(ReportsPage()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mockedHasPermission).toHaveBeenCalledWith("reports.view");
    expect(getPipelineReport).not.toHaveBeenCalled();
    expect(getUtilizationReport).not.toHaveBeenCalled();
    expect(getArAgingReport).not.toHaveBeenCalled();
    expect(getRealizationReport).not.toHaveBeenCalled();
  });

  test("with reports.view: fetches every report in the viewer's zone and renders the cards", async () => {
    mockedHasPermission.mockResolvedValue(true);

    const { getByTestId } = render(await ReportsPage());

    expect(getPipelineReport).toHaveBeenCalledWith("America/Denver");
    expect(getUtilizationReport).toHaveBeenCalledWith("America/Denver");
    expect(getRealizationReport).toHaveBeenCalledWith("America/Denver");
    expect(getArAgingReport).toHaveBeenCalled();
    for (const id of ["pipeline", "utilization", "ar", "realization"]) {
      expect(getByTestId(id)).toBeInTheDocument();
    }
  });
});
