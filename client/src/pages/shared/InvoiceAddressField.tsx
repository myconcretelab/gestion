import { useEffect, useId, useState, type ReactNode } from "react";
import type { InvoiceFiscalInput } from "@contrats/shared";
import { apiFetch } from "../../utils/api";

type AddressSuggestion = Pick<
  InvoiceFiscalInput["buyer"],
  "address_line1" | "postal_code" | "city"
>;

type AddressLookup = {
  query: string;
  suggestions: AddressSuggestion[];
  unavailable?: boolean;
};

export default function InvoiceAddressField({
  label,
  value,
  enabled,
  onChange,
  onSelect,
}: {
  label: ReactNode;
  value: string;
  enabled: boolean;
  onChange: (address: string) => void;
  onSelect: (address: AddressSuggestion) => void;
}) {
  const listId = useId();
  const [typedValue, setTypedValue] = useState<string | null>(null);
  const [lookup, setLookup] = useState<AddressLookup | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmed = typedValue === value ? value.trim() : "";
  const query = enabled && trimmed.length >= 3 && trimmed.length <= 160 ? trimmed : "";
  const result = query && lookup?.query === query ? lookup : null;
  const suggestions = result?.suggestions ?? [];
  const expanded = suggestions.length > 0;

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const items = await apiFetch<AddressSuggestion[]>("/invoices/address-suggestions", {
          method: "POST",
          json: { query },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setLookup({ query, suggestions: items });
      } catch {
        if (!controller.signal.aborted) setLookup({ query, suggestions: [], unavailable: true });
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const close = () => {
    setTypedValue(null);
    setLookup(null);
    setActiveIndex(-1);
  };

  const select = (suggestion: AddressSuggestion) => {
    close();
    onSelect(suggestion);
  };

  return (
    <div className="field invoice-address">
      <label htmlFor="buyer-address">{label}</label>
      <input
        id="buyer-address"
        value={value}
        maxLength={500}
        autoComplete={enabled ? "off" : undefined}
        role={enabled ? "combobox" : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-expanded={enabled ? expanded : undefined}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          const address = event.currentTarget.value;
          setTypedValue(address);
          setActiveIndex(-1);
          onChange(address);
        }}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && query) {
            event.preventDefault();
            close();
          }
          if (!expanded) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => event.key === "ArrowDown"
              ? Math.min(current + 1, suggestions.length - 1)
              : current < 0 ? suggestions.length - 1 : Math.max(current - 1, 0));
          }
          if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            select(suggestions[activeIndex]);
          }
        }}
      />
      {expanded && (
        <ul id={listId} role="listbox" aria-label="Suggestions d’adresses" className="invoice-address__suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.address_line1}|${suggestion.postal_code}|${suggestion.city}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={activeIndex === index}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => select(suggestion)}
            >
              <span>{suggestion.address_line1}</span>
              <small>{suggestion.postal_code} {suggestion.city}</small>
            </li>
          ))}
        </ul>
      )}
      {result && !expanded && (
        <div role="status" className="field-hint">
          {result.unavailable ? "Suggestions indisponibles." : "Aucune adresse trouvée."} Vous pouvez continuer la saisie.
        </div>
      )}
    </div>
  );
}
