import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import InquirySupport from "./InquirySupport";

describe("InquirySupport", () => {
  it("renders KakaoTalk and manual inquiry menus", () => {
    render(<InquirySupport />);

    expect(screen.getByRole("button", { name: "카카오톡" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "메뉴얼" })).toBeInTheDocument();
    expect(screen.getByText("카카오톡 문의")).toBeInTheDocument();
  });
});
