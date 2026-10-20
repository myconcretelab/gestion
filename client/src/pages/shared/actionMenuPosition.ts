export function actionMenuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const margin = 12;
  const gap = 8;
  const width = Math.min(288, Math.max(0, viewport.width - margin * 2));
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const desiredHeight = Math.min(contentHeight, 448);
  const opensAbove = below < Math.min(desiredHeight, 240) && above > below;
  const maxHeight = Math.max(0, Math.min(448, opensAbove ? above : below));
  return {
    width,
    left: Math.max(
      margin,
      Math.min(anchor.right - width, viewport.width - margin - width),
    ),
    top: opensAbove
      ? Math.max(margin, anchor.top - gap - Math.min(desiredHeight, maxHeight))
      : anchor.bottom + gap,
    maxHeight,
    placement: opensAbove ? "above" : "below",
  };
}
