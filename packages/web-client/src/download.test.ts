import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { downloadPng, type Exportable } from "./download.js";

describe("downloadPng", () => {
  it("points a download link at the view's PNG data URL, under the given filename", async () => {
    const toImageURL = mock.fn(async () => "data:image/png;base64,Zm9v");
    const view: Exportable = { toImageURL };
    const click = mock.method(HTMLAnchorElement.prototype, "click", () => {});
    try {
      await downloadPng(view, "chart-c1.png");

      assert.equal(toImageURL.mock.callCount(), 1);
      assert.deepEqual(toImageURL.mock.calls[0]?.arguments, ["png", 2]);
      assert.equal(click.mock.callCount(), 1);
      const link = click.mock.calls[0]?.this as HTMLAnchorElement;
      assert.equal(link.href, "data:image/png;base64,Zm9v");
      assert.equal(link.download, "chart-c1.png");
    } finally {
      click.mock.restore();
    }
  });

  it("never touches URL.createObjectURL — toImageURL already returns a data: URL", async () => {
    const view: Exportable = { toImageURL: mock.fn(async () => "data:image/png;base64,Zm9v") };
    const click = mock.method(HTMLAnchorElement.prototype, "click", () => {});
    const createObjectURL = mock.method(URL, "createObjectURL", () => {
      throw new Error("should not be called");
    });
    try {
      await downloadPng(view, "chart.png");
      assert.equal(createObjectURL.mock.callCount(), 0);
    } finally {
      click.mock.restore();
      createObjectURL.mock.restore();
    }
  });
});
