import type { DragEventHandler } from "react";

export type GiteTabItem = {
  id: string;
  label: string;
  badge?: number | null;
  badgeLabel?: string | null;
  title?: string;
  variant?: "default" | "all";
  draggable?: boolean;
  disabled?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: DragEventHandler<HTMLButtonElement>;
  onDragOver?: DragEventHandler<HTMLButtonElement>;
  onDrop?: DragEventHandler<HTMLButtonElement>;
  onDragEnd?: DragEventHandler<HTMLButtonElement>;
};

type GiteTabsProps = {
  activeId: string;
  items: GiteTabItem[];
  onChange: (id: string) => void;
  sticky?: boolean;
  ariaLabel?: string;
  className?: string;
};

const joinClasses = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

const GiteTabs = ({ activeId, items, onChange, sticky = false, ariaLabel = "Navigation des gîtes", className }: GiteTabsProps) => (
  <div
    className={joinClasses(
      "reservations-tabs",
      sticky ? "reservations-tabs--sticky" : "reservations-tabs--static",
      className
    )}
    role="tablist"
    aria-label={ariaLabel}
  >
    {items.map((item) => {
      const isActive = activeId === item.id;
      const badgeCount = Number(item.badge ?? 0);
      const shouldShowBadge = Number.isFinite(badgeCount) && badgeCount > 0;

      return (
        <button
          type="button"
          key={item.id}
          role="tab"
          aria-selected={isActive}
          className={joinClasses(
            "reservations-tab",
            item.variant === "all" && "reservations-tab--all",
            isActive && "reservations-tab--active",
            item.isDragging && "reservations-tab--dragging",
            item.isDragOver && !item.isDragging && "reservations-tab--drag-over"
          )}
          draggable={item.draggable}
          onDragStart={item.onDragStart}
          onDragOver={item.onDragOver}
          onDrop={item.onDrop}
          onDragEnd={item.onDragEnd}
          onClick={() => onChange(item.id)}
          disabled={item.disabled}
          title={item.title}
        >
          <span className="reservations-tab__label">{item.label}</span>
          {shouldShowBadge ? (
            <span className="reservations-tab__badge" aria-label={item.badgeLabel ?? undefined} title={item.badgeLabel ?? undefined}>
              {badgeCount}
            </span>
          ) : null}
        </button>
      );
    })}
  </div>
);

export default GiteTabs;
