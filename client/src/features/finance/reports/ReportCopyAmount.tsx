import { useState } from "react";
import { ReportIcon } from "./ReportUi";
import { dispatchAppNotice } from "../../../utils/appNotices";

export default function ReportCopyAmount({
  totalCents,
}: {
  totalCents: number;
}) {
  const value = String(
    Math.sign(totalCents) * Math.floor((Math.abs(totalCents) + 50) / 100),
  );
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = async () => {
    if (pending) return;
    setPending(true);
    setCopiedValue(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      dispatchAppNotice({
        label: "Copie",
        message: "Montant arrondi copié : " + value + ".",
        tone: "success",
        timeoutMs: 2500,
      });
    } catch {
      dispatchAppNotice({
        label: "Copie",
        message: "Copie impossible. Sélectionnez le montant pour le copier.",
        tone: "error",
        timeoutMs: 4500,
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      className="rp-button rp-total-copy"
      type="button"
      onClick={() => void copy()}
      disabled={pending}
      aria-label="Copier le montant sans centimes"
      title={"Copier " + value + " · arrondi à l’euro"}
    >
      <ReportIcon name="copy" />
      {pending
        ? "Copie…"
        : copiedValue === value
          ? "Copié : " + value
          : "Copier sans centimes"}
      {copiedValue !== value && <small>{value}</small>}
    </button>
  );
}
