import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { copyText } from "./clipboard.js";

describe("copyText", () => {
  it("writes exactly the given text to the clipboard", async () => {
    const writeText = mock.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await copyText("Revenue is up 12%.");

    assert.equal(writeText.mock.callCount(), 1);
    assert.deepEqual(writeText.mock.calls[0]?.arguments, ["Revenue is up 12%."]);
  });

  it("propagates a rejection instead of swallowing it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mock.fn(async () => {
          throw new Error("permission denied");
        }),
      },
      configurable: true,
    });

    await assert.rejects(() => copyText("x"), /permission denied/);
  });
});
