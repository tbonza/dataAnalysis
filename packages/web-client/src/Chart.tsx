import { useEffect, useRef } from "react";
import embed from "vega-embed";

/**
 * Renders one Vega-Lite spec.
 *
 * Rendering lives here rather than on either server: the servers return specs as JSON,
 * and the client turns them into pixels. That is what lets the same spec become a PNG,
 * an SVG, or a slide, depending on who is asking.
 */
export function Chart({ spec }: { spec: Record<string, unknown> }): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let view: { finalize: () => void } | undefined;
    let cancelled = false;

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
      },
      (err: unknown) => {
        if (!cancelled) element.textContent = `Could not render this chart: ${String(err)}`;
      }
    );

    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);

  return <div className="chart" ref={host} />;
}
