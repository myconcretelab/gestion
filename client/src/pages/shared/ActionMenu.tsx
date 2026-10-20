import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import ActionIcon, { type ActionIconName } from "./ActionIcon";
import { actionMenuPosition } from "./actionMenuPosition";

type Action = {
  id: string;
  label: string;
  icon: ActionIconName;
  description?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};
export type ActionMenuItem = Action &
  (
    | { onSelect: () => void; to?: never; href?: never; external?: never }
    | { to: string; onSelect?: never; href?: never; external?: never }
    | { href: string; external?: boolean; onSelect?: never; to?: never }
  );

export default function ActionMenu({
  items,
  ariaLabel = "Actions",
  context,
}: {
  items: readonly ActionMenuItem[];
  ariaLabel?: string;
  context?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<
    typeof actionMenuPosition
  > | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  const focusPendingRef = useRef(false);
  const searchRef = useRef({ text: "", time: 0 });
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const entries = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      if (
        anchor.bottom <= 0 ||
        anchor.top >= window.innerHeight ||
        anchor.right <= 0 ||
        anchor.left >= window.innerWidth
      ) {
        close();
        return;
      }
      const next = actionMenuPosition(
        anchor,
        {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        },
        panel.scrollHeight + 2,
      );
      setPosition((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    reposition();
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) reposition();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", reposition);
    const observer = new ResizeObserver(reposition);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", reposition);
      observer.disconnect();
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !position || !focusPendingRef.current) return;
    focusPendingRef.current = false;
    const enabled = entries();
    const entry =
      initialFocusRef.current === "last" ? enabled.at(-1) : enabled[0];
    const panel = panelRef.current;
    (entry ?? panel)?.focus({ preventScroll: true });
    if (entry && panel) {
      const top =
        entry.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      if (top < 6) panel.scrollTop += top - 6;
      else if (top + entry.offsetHeight > panel.clientHeight - 6)
        panel.scrollTop += top + entry.offsetHeight - panel.clientHeight + 6;
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      )
        close();
    };
    const otherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("app:action-menu-open", otherMenu);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("app:action-menu-open", otherMenu);
    };
  }, [open, close, id]);

  const show = (initial: "first" | "last" = "first") => {
    initialFocusRef.current = initial;
    focusPendingRef.current = true;
    searchRef.current = { text: "", time: 0 };
    document.dispatchEvent(
      new CustomEvent("app:action-menu-open", { detail: id }),
    );
    setOpen(true);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = entries();
    const current = enabled.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(true);
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : ((current < 0 && event.key === "ArrowUp" ? 0 : current) +
                (event.key === "ArrowDown" ? 1 : -1) +
                enabled.length) %
              enabled.length;
      enabled[next]?.focus();
    } else if (
      event.key.length === 1 &&
      event.key.trim() &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const normalize = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase("fr");
      const now = Date.now();
      const char = normalize(event.key);
      const old =
        now - searchRef.current.time < 600 ? searchRef.current.text : "";
      const text = old === char ? char : old + char;
      searchRef.current = { text, time: now };
      const ordered = [
        ...enabled.slice(current + 1),
        ...enabled.slice(0, current + 1),
      ];
      ordered
        .find((entry) => normalize(entry.dataset.label ?? "").startsWith(text))
        ?.focus();
      event.preventDefault();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={`${id}-trigger`}
        className="action-menu__trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close(true);
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowUp" ? "last" : "first");
          } else if (event.key === "Escape" && open) {
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <ActionIcon name="menu" />
        <span>Actions</span>
        <ActionIcon name="chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={`${id}-menu`}
            role="menu"
            aria-labelledby={`${id}-trigger`}
            tabIndex={-1}
            className="action-menu__panel"
            data-placement={position?.placement}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: position?.width,
              maxHeight: position?.maxHeight,
              visibility: position ? "visible" : "hidden",
            }}
            onKeyDown={keyboard}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (
                next &&
                !event.currentTarget.contains(next) &&
                !triggerRef.current?.contains(next)
              )
                close();
            }}
          >
            {context && (
              <div className="action-menu__context" role="presentation">
                {context}
              </div>
            )}
            {items.map((item, index) => {
              const common = {
                role: "menuitem",
                "aria-label": item.label,
                tabIndex: -1,
                "data-label": item.label,
                className: `action-menu__item${item.danger ? " action-menu__item--danger" : ""}`,
                "aria-describedby": item.description
                  ? `${id}-${index}-hint`
                  : undefined,
                onClick: () => {
                  close(true);
                  item.onSelect?.();
                },
              };
              const content = (
                <>
                  <span className="action-menu__icon">
                    <ActionIcon name={item.icon} />
                  </span>
                  <span className="action-menu__copy">
                    <span>{item.label}</span>
                    {item.description && (
                      <small id={`${id}-${index}-hint`}>
                        {item.description}
                      </small>
                    )}
                  </span>
                  {item.external && (
                    <span className="action-menu__external">
                      <ActionIcon name="external" />
                    </span>
                  )}
                </>
              );
              return (
                <div key={item.id} role="presentation">
                  {item.separatorBefore && index > 0 && (
                    <div role="separator" className="action-menu__separator" />
                  )}
                  {item.disabled ? (
                    <button {...common} type="button" disabled>
                      {content}
                    </button>
                  ) : item.to ? (
                    <Link {...common} to={item.to}>
                      {content}
                    </Link>
                  ) : item.href ? (
                    <a
                      {...common}
                      href={item.href}
                      target={item.external ? "_blank" : undefined}
                      rel={item.external ? "noopener noreferrer" : undefined}
                    >
                      {content}
                    </a>
                  ) : (
                    <button {...common} type="button">
                      {content}
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
