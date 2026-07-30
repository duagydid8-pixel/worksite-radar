import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnnualLeaveManagementPage from "./AnnualLeaveManagementPage";

vi.mock("@/lib/firestoreService", () => ({
  loadAnnualLeaveManagementFS: vi.fn().mockResolvedValue({ employees: [], usages: [], uploadedAt: "" }),
  saveAnnualLeaveManagementFS: vi.fn().mockResolvedValue(true),
}));

describe("AnnualLeaveManagementPage", () => {
  it("renders the annual leave workflow labels", async () => {
    render(<AnnualLeaveManagementPage isAdmin={true} />);

    expect(await screen.findByText("연차관리")).toBeInTheDocument();
    expect(screen.getByText("직원별 연차 현황")).toBeInTheDocument();
    expect(screen.getByText("연차 사용 입력")).toBeInTheDocument();
  });

  it("adds a usage record and updates summary from initial data", () => {
    render(
      <AnnualLeaveManagementPage
        isAdmin={true}
        initialEmployees={[
          {
            id: "e1",
            project: "P4-PH4",
            category: "현재직",
            name: "홍길동",
            department: "공무",
            hireDate: "2026-03-15",
            sourceRow: 2,
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
          },
        ]}
        initialUsages={[]}
        initialBasisDate="2026-04-30"
      />
    );

    fireEvent.change(screen.getByLabelText("사용일"), { target: { value: "2026-04-10" } });
    fireEvent.change(screen.getByLabelText("직원"), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText("구분"), { target: { value: "오전반차" } });
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "병원" } });
    fireEvent.click(screen.getByRole("button", { name: "사용내역 추가" }));

    expect(screen.getByText("병원")).toBeInTheDocument();
    expect(screen.getByText("0.5일")).toBeInTheDocument();
    expect(screen.getByTestId("remaining-e1")).toHaveTextContent("1.5");
  });

  it("shows the matching employee usage details when search has one result", () => {
    render(
      <AnnualLeaveManagementPage
        isAdmin={true}
        initialEmployees={[
          {
            id: "e1",
            project: "P4-PH4",
            category: "현재직",
            name: "김기존",
            department: "공무",
            hireDate: "2026-03-15",
            sourceRow: 2,
            createdAt: "2026-03-15T00:00:00.000Z",
            updatedAt: "2026-03-15T00:00:00.000Z",
          },
          {
            id: "e2",
            project: "P4-PH4",
            category: "현재직",
            name: "김검색",
            department: "안전",
            hireDate: "2026-03-16",
            sourceRow: 3,
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        ]}
        initialUsages={[
          {
            id: "u1",
            date: "2026-04-10",
            employeeId: "e1",
            employeeName: "김기존",
            type: "연차",
            days: 1,
            memo: "기존 직원 기록",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:00.000Z",
          },
          {
            id: "u2",
            date: "2026-04-11",
            employeeId: "e2",
            employeeName: "김검색",
            type: "연차",
            days: 1,
            memo: "검색 직원 기록",
            createdAt: "2026-04-11T00:00:00.000Z",
            updatedAt: "2026-04-11T00:00:00.000Z",
          },
        ]}
        initialBasisDate="2026-04-30"
      />
    );

    expect(screen.getByText("기존 직원 기록")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("이름, 부서, 프로젝트 검색"), {
      target: { value: "김검색" },
    });

    expect(screen.getByText("검색 직원 기록")).toBeInTheDocument();
    expect(screen.queryByText("기존 직원 기록")).not.toBeInTheDocument();
  });
});
