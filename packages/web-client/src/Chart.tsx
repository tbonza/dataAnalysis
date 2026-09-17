import { useEffect, useRef, useState } from "react";
import type { View } from "vega";
import embed from "vega-embed";
import { downloadPng } from "./download.js";

/**
 * Renders one Vega-Lite spec.
 *
 * Rendering lives here rather than on either server: the servers return specs as JSON,
 * and the client turns them into pixels. That is what lets the same spec become a PNG,
 * an SVG, or a slide, depending on who is asking.
 */
export function Chart({
  chartId,
  spec,
}: {
  chartId?: string;
  spec: Record<string, unknown>;
}): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  // Kept in a ref, not just the effect's closure, so the download button — which lives
  // outside the effect — can reach the view that's current right now.
  const viewRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let view: View | undefined;
    let cancelled = false;
    setReady(false);

    void embed(element, spec as Parameters<typeof embed>[1], {
      actions: { export: true, source: false, compiled: false, editor: true },
      renderer: "canvas",
    }).then(
      (result) => {
        if (cancelled) {
          result.view.finalize();
          return;
        }
        view = result.view;
        viewRef.current = result.view;
        setReady(true);
      },
      (err: unknown) => {
        if (!cancelled) element.textContent = `Could not render this chart: ${String(err)}`;
      }
    );

    return () => {
      cancelled = true;
      view?.finalize();
      viewRef.current = null;
    };
  }, [spec]);

  const onDownload = () => {
    const view = viewRef.current;
    if (!view) return;
    void downloadPng(view, chartId ? `chart-${chartId}.png` : "chart.png");
  };

  return (
    <div className="chart-wrap">
      <div className="chart" ref={host} />
      {ready && (
        <button type="button" className="ghost download" onClick={onDownload}>
          Download PNG
        </button>
      )}
    </div>
  );
}
