export function actionMenuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number; left?: number; top?: number },
  contentHeight: number,
) {
  const margin = 12;
  const gap = 8;
  const width = Math.min(288, Math.max(0, viewport.width - margin * 2));
  const minLeft = (viewport.left ?? 0) + margin;
  const minTop = (viewport.top ?? 0) + margin;
  const right = (viewport.left ?? 0) + viewport.width - margin;
  const bottom = (viewport.top ?? 0) + viewport.height - margin;
  const below = Math.max(0, bottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - minTop);
  const desiredHeight = Math.max(0, Math.min(contentHeight, bottom - minTop));
  const opensAbove = below < desiredHeight && above > below;
  const maxHeight = Math.min(desiredHeight, opensAbove ? above : below);
  const fitsRight = anchor.right + gap + width <= right;
  const fitsLeft = anchor.left - gap - width >= minLeft;
  // Long menus can use the screen's full height alongside the row.
  if ((fitsRight || fitsLeft) && desiredHeight > maxHeight) {
    return {
      width,
      left: fitsRight ? anchor.right + gap : anchor.left - gap - width,
      top: Math.max(minTop, Math.min(anchor.top, bottom - desiredHeight)),
      maxHeight: desiredHeight,
      placement: fitsRight ? "right" : "left",
    };
  }
  return {
    width,
    left: Math.max(minLeft, Math.min(anchor.right - width, right - width)),
    top: opensAbove
      ? Math.max(minTop, anchor.top - gap - maxHeight)
      : Math.max(minTop, anchor.bottom + gap),
    maxHeight,
    placement: opensAbove ? "above" : "below",
  };
}
