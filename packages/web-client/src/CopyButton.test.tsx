import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import assert from "node:assert/strict";
import { after, afterEach, describe, it, mock } from "node:test";
import { CopyButton } from "./CopyButton.js";

function stubClipboard(writeText: ReturnType<typeof mock.fn>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("CopyButton", () => {
  afterEach(() => cleanup());
  after(() => mock.reset());

  it("copies the given text and shows confirmation", async () => {
    const writeText = mock.fn(async () => {});
    stubClipboard(writeText);

    render(<CopyButton text="Revenue is up 12%." />);
    fireEvent.click(screen.getByRole("button"));

    assert.equal(writeText.mock.callCount(), 1);
    assert.deepEqual(writeText.mock.calls[0]?.arguments, ["Revenue is up 12%."]);
    await screen.findByRole("button", { name: "Copied" });
  });

  it("shows a failure state when the clipboard write is rejected", async () => {
    const writeText = mock.fn(async () => {
      throw new Error("denied");
    });
    stubClipboard(writeText);

    render(<CopyButton text="x" />);
    fireEvent.click(screen.getByRole("button"));

    await screen.findByRole("button", { name: "Copy failed" });
  });
});
