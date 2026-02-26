import { useEffect, useState } from "react";

type PreviewOverflow = {
  before: boolean;
  after: boolean;
  compact: boolean;
};

export const useHtmlPreview = (params: {
  url: string;
  payload: unknown;
  ready: boolean;
  overflowHeader: string;
  overflowAfterHeader: string;
  compactHeader: string;
  delayMs?: number;
}) => {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOverflow, setPreviewOverflow] = useState<PreviewOverflow | null>(null);

  useEffect(() => {
    if (!params.ready) {
      setPreviewError(null);
      setPreviewLoading(false);
      setPreviewHtml(null);
      setPreviewOverflow(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewOverflow(null);
      try {
        const response = await fetch(params.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Erreur preview (${response.status})`;
          try {
            const payload = await response.json();
            if (payload?.error) message = payload.error;
          } catch {
            // ignore
          }
          throw new Error(message);
        }

        const overflowBefore = response.headers.get(params.overflowHeader) === "1";
        const overflowAfter = response.headers.get(params.overflowAfterHeader) === "1";
        const compact = response.headers.get(params.compactHeader) === "1";
        setPreviewOverflow({ before: overflowBefore, after: overflowAfter, compact });

        const html = await response.text();
        setPreviewHtml(html);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setPreviewError(err?.message ?? "Erreur lors de la previsualisation.");
      } finally {
        setPreviewLoading(false);
      }
    }, params.delayMs ?? 600);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    params.url,
    params.payload,
    params.ready,
    params.overflowHeader,
    params.overflowAfterHeader,
    params.compactHeader,
    params.delayMs,
  ]);

  return {
    previewHtml,
    previewError,
    previewLoading,
    previewOverflow,
  };
};
