import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Scrubber } from "./Scrubber";

const START = "2026-08-13T00:00:00Z";
const END = "2026-08-14T00:00:00Z"; // exactly 24h later

describe("Scrubber", () => {
  it("renders the slider at its rightmost position when value is null", () => {
    render(<Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.value)).toBe(Number(slider.max));
  });

  it("calls onChange with a timestamp between startTime and endTime when dragged to the midpoint", () => {
    const onChange = vi.fn();
    render(<Scrubber startTime={START} endTime={END} value={null} onChange={onChange} playing={false} onTogglePlay={vi.fn()} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    const midpoint = String(Math.round(Number(slider.max) / 2));
    fireEvent.change(slider, { target: { value: midpoint } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const cutoff = onChange.mock.calls[0][0] as string;
    expect(cutoff > START).toBe(true);
    expect(cutoff < END).toBe(true);
  });

  it("calling onChange with the exact slider max maps back to null (full range, not scrubbing)", () => {
    const onChange = vi.fn();
    render(<Scrubber startTime={START} endTime={END} value="2026-08-13T12:00:00Z" onChange={onChange} playing={false} onTogglePlay={vi.fn()} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a pause label when playing, and a play label otherwise", () => {
    const { rerender } = render(
      <Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /lecture/i })).toBeInTheDocument();

    rerender(<Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={true} onTogglePlay={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("calls onTogglePlay when the play/pause button is clicked", () => {
    const onTogglePlay = vi.fn();
    render(<Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={false} onTogglePlay={onTogglePlay} />);
    fireEvent.click(screen.getByRole("button", { name: /lecture/i }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("renders at the max slider position without NaN when startTime === endTime (single-event period)", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const SAME = "2026-08-13T12:00:00Z";
    render(<Scrubber startTime={SAME} endTime={SAME} value={null} onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.value)).toBe(Number(slider.max));
    expect(Number.isNaN(Number(slider.value))).toBe(false);
    const nanWarning = consoleError.mock.calls.some((call) => String(call[0]).includes("NaN"));
    expect(nanWarning).toBe(false);
    consoleError.mockRestore();
  });

  it("has an accessible name on the range input", () => {
    render(<Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />);
    expect(screen.getByRole("slider", { name: /curseur temporel/i })).toBeInTheDocument();
  });

  it("shows 'maintenant' when value is null, and updates the timestamp label when value changes", () => {
    const { rerender } = render(
      <Scrubber startTime={START} endTime={END} value={null} onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />
    );
    expect(screen.getByText(/maintenant/i)).toBeInTheDocument();

    rerender(
      <Scrubber startTime={START} endTime={END} value="2026-08-13T12:00:00Z" onChange={vi.fn()} playing={false} onTogglePlay={vi.fn()} />
    );
    expect(screen.queryByText(/maintenant/i)).not.toBeInTheDocument();
    expect(screen.getByText(new Date("2026-08-13T12:00:00Z").toLocaleString())).toBeInTheDocument();
  });
});
