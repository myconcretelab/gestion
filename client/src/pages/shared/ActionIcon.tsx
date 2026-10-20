export type ActionIconName =
  | "menu"
  | "chevron"
  | "edit"
  | "save"
  | "copy"
  | "split"
  | "options"
  | "external"
  | "phone"
  | "contract"
  | "invoice"
  | "email"
  | "trash"
  | "check";

const paths: Record<ActionIconName, JSX.Element> = {
  menu: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  edit: (
    <>
      <path d="m15 5 4 4M4 16l-1 5 5-1L20 8a2.8 2.8 0 0 0-4-4Z" />
      <path d="M13 21h8" />
    </>
  ),
  save: (
    <>
      <path d="m5 12 4 4L19 6" />
      <path d="M20 13v7H4V4h9" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v13h5" />
    </>
  ),
  split: (
    <>
      <path d="M12 21v-7M12 14 5 7V3M12 14l7-7V3M2 6l3-3 3 3M16 6l3-3 3 3" />
    </>
  ),
  options: (
    <>
      <path d="M4 7h5M15 7h5M4 17h9M19 17h1" />
      <circle cx="12" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7M21 3l-10 10" />
      <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
    </>
  ),
  phone: (
    <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2Z" />
  ),
  contract: (
    <>
      <path d="M14 3H5v18h14V8ZM14 3v5h5M8 12h7M8 16h4" />
      <path d="m14 18 2 2 5-5" />
    </>
  ),
  invoice: (
    <>
      <path d="M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h4" />
      <path d="M15 16h1M15 19h1" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
};

export default function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
