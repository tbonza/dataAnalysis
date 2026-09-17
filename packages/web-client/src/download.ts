/** The slice of `vega.View` this needs — kept minimal so a test can pass a fake one
 *  without touching vega-embed or a real `<canvas>`. */
export interface Exportable {
  toImageURL(type: "png", scaleFactor?: number): Promise<string>;
}

/**
 * Downloads a rendered chart as a PNG.
 *
 * `toImageURL` resolves to a `data:` URL rather than a blob URL, so this needs no
 * `URL.createObjectURL`/revoke dance — set it directly as the link's `href`.
 */
export async function downloadPng(view: Exportable, filename: string): Promise<void> {
  const url = await view.toImageURL("png", 2);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}
