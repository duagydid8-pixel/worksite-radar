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
});
