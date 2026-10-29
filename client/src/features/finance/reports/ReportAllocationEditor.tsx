import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { ReportAllocation } from "@contrats/shared";
import { apiFetch } from "../../../utils/api";
import { canCurrentUserWritePage } from "../../../utils/auth";
import type { ReportWorkspace } from "./ReportsPage";
import ReportPageHeader from "./ReportPageHeader";
import { formatReportValue } from "./reportModel";

const categories = [
  { id: "cleaning", name: "Ménage" },
  { id: "linen", name: "Linge" },
  { id: "extras", name: "Autres prestations" },
] as const;
export default function ReportAllocationEditor({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { reservationId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<ReportAllocation | null>(null);
  const [values, setValues] = useState({
    cleaning: "0",
    linen: "0",
    extras: "0",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const back = workspace.href(
    params.get("rapport") ? `/${params.get("rapport")}` : "",
  );
  const endpoint = `/reservations/${encodeURIComponent(reservationId ?? "")}/reporting-allocation`;
  const canEdit = canCurrentUserWritePage("reservations");
  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setError("");
    void apiFetch<ReportAllocation>(endpoint, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setSource(data);
        setValues({
          cleaning: String((data.amounts?.cleaning ?? 0) / 100),
          linen: String((data.amounts?.linen ?? 0) / 100),
          extras: String((data.amounts?.extras ?? data.totalCents) / 100),
        });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Chargement impossible.",
          );
      });
    return () => controller.abort();
  }, [endpoint]);
  const toCents = (value: string) =>
    /^\d+(?:[.,]\d{1,2})?$/.test(value.trim())
      ? Math.round(Number(value.replace(",", ".")) * 100)
      : NaN;
  const amounts = {
    cleaning: toCents(values.cleaning),
    linen: toCents(values.linen),
    extras: toCents(values.extras),
  };
  const total = amounts.cleaning + amounts.linen + amounts.extras;
  const format = (value: number) =>
    formatReportValue({ kind: "custom" }, value);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!source || !canEdit || saving) return;
    if (!Number.isSafeInteger(total) || total !== source.totalCents) {
      setError(
        "La ventilation doit correspondre au total des prestations. Utilisez au plus deux décimales.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch(endpoint, {
        method: "PUT",
        json: { updatedAt: source.updatedAt, amounts },
      });
      await workspace.refresh();
      workspace.notify("Ventilation des prestations enregistrée.");
      navigate(back);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ReportPageHeader
        title="Ventiler les prestations"
        back={{ to: back, label: "Revenir au rapport" }}
        meta={
          source ? (
            <span>
              {source.guest} · {source.property}
            </span>
          ) : undefined
        }
      />
      {error && (
        <p className="rp-notice" role="alert">
          {error}
        </p>
      )}
      {source ? (
        <form
          className="rp-panel rp-editor-section"
          onSubmit={(event) => void save(event)}
        >
          <p>
            Prestations enregistrées sur la réservation :{" "}
            <strong>{format(source.totalCents)}</strong>
          </p>
          <p className="rp-muted">
            Répartissez ce montant entre les catégories. Cette ventilation
            s’applique aux rapports de la réservation ; le prix total reste
            identique.
          </p>
          {categories.map((category) => (
            <label className="rp-field" key={category.id}>
              {category.name} (€)
              <input
                inputMode="decimal"
                value={values[category.id]}
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [category.id]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
          <p role="status">
            {Number.isFinite(total)
              ? `Total ventilé : ${format(total)} · Reste à ventiler : ${format(source.totalCents - total)}`
              : "Vérifiez les montants saisis."}
          </p>
          <div className="rp-dialog__actions">
            <Link to={back} className="rp-button rp-button--secondary">
              Annuler
            </Link>
            {canEdit && (
              <button
                className="rp-button"
                disabled={
                  saving ||
                  !Number.isSafeInteger(total) ||
                  total !== source.totalCents
                }
              >
                {saving ? "Enregistrement…" : "Enregistrer la ventilation"}
              </button>
            )}
          </div>
        </form>
      ) : !error ? (
        <p role="status">Chargement des prestations…</p>
      ) : null}
    </>
  );
}
