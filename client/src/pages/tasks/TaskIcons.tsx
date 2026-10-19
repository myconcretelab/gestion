import type { Category } from "./types";

export function CategoryIcon({ category }: { category: Category }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {category === "short" ? (
        <path d="m13 3-9 11h7l-1 7 10-12h-7l1-6Z" />
      ) : (
        <>
          <path d="M6 3h12M6 21h12M7 3v4c0 3 10 7 10 10v4M17 3v4c0 3-10 7-10 10v4" />
          <path d="m8 18 4-3 4 3" />
        </>
      )}
    </svg>
  );
}
export function TaskIcon({
  name,
}: {
  name:
    | "plus"
    | "search"
    | "check"
    | "presets"
    | "repeat"
    | "person"
    | "home"
    | "arrow";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : name === "search" ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      ) : name === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : name === "presets" ? (
        <>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M8 9h8M8 13h8M8 17h4" />
        </>
      ) : name === "repeat" ? (
        <>
          <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
        </>
      ) : name === "person" ? (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
        </>
      ) : name === "home" ? (
        <path d="m3 11 9-8 9 8v9H3Zm6 9v-7h6v7" />
      ) : (
        <path d="m9 5 7 7-7 7" />
      )}
    </svg>
  );
}
export function CategoryChoice({
  value,
  onChange,
}: {
  value: Category;
  onChange: (value: Category) => void;
}) {
  return (
    <div
      className="tw-category-choice"
      role="group"
      aria-label="Catégorie de tâche"
    >
      {(["short", "long"] as const).map((category) => (
        <button
          type="button"
          key={category}
          aria-pressed={value === category}
          onClick={() => onChange(category)}
        >
          <CategoryIcon category={category} />
          {category === "short" ? "Rapide" : "Long terme"}
        </button>
      ))}
    </div>
  );
}
