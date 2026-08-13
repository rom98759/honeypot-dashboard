import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkeletonBlock } from "./SkeletonBlock";

describe("SkeletonBlock", () => {
  it("renders the requested number of skeleton lines", () => {
    const { container } = render(<SkeletonBlock rows={3} />);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(3);
  });

  it("defaults to 4 rows", () => {
    const { container } = render(<SkeletonBlock />);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(4);
  });
});
