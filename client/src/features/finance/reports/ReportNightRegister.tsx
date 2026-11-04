import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NIGHT_REGISTER_LEGAL_URL, type NightRegister } from "@contrats/shared";
import { apiFetch, buildApiUrl, isAbortError } from "../../../utils/api";
import { ReportDialog, ReportIcon } from "./ReportUi";
import ReportNightSummary from "./ReportNightSummary";
import ReportNightRegisterCompletion from "./ReportNightRegisterCompletion";
import type { ReportWorkspace } from "./ReportsPage";

export default function ReportNightRegister({
  reportId,
  month,
  workspace,
  archive,
}: {
  reportId: string;
  month: string;
  workspace: ReportWorkspace;
  archive?: { key: string; resolution?: number };
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NightRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const path = `/reports/${encodeURIComponent(reportId)}/night-register`;
  const archiveKey = archive?.key;
  const archiveResolution = archive?.resolution;
  const sourcesKey = archiveKey
    ? "archive"
    : `${workspace.state.revision}:${workspace.state.factsRevision}`;
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ month });
    if (archiveKey) {
      params.set("source", "confirmed");
      params.set("archiveKey", archiveKey);
    }
    if (archiveResolution !== undefined)
      params.set("resolution", String(archiveResolution));
    apiFetch<NightRegister>(`${path}?${params}`, {
      signal: controller.signal,
    })
      .then((register) => {
        if (!controller.signal.aborted) setData(register);
      })
      .catch((failure) => {
        if (!isAbortError(failure))
          setError(
            failure instanceof Error
              ? failure.message
              : "Le registre ne peut pas être chargé.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, month, refresh, archiveKey, archiveResolution, sourcesKey]);
  async function download(format: "pdf" | "csv" | "summary-csv") {
    if (!data || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        month,
        format,
        revision: data.revision,
      });
      if (archiveKey) {
        params.set("source", "confirmed");
        params.set("archiveKey", archiveKey);
      }
      if (archiveResolution !== undefined)
        params.set("resolution", String(archiveResolution));
      const response = await fetch(buildApiUrl(`${path}?${params}`), {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 409) setData(null);
        const failure = await response.json().catch(() => ({}));
        throw new Error(
          failure.error ?? "Téléchargement impossible. Réessayez.",
        );
      }
      if (
        !(response.headers.get("content-type") ?? "").includes(
          format === "pdf" ? "application/pdf" : "text/csv",
        )
      )
        throw new Error("Le serveur n’a pas renvoyé le document attendu.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      const gites = data.properties
        .map((property) => property.name)
        .join("-")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .slice(0, 90);
      link.href = url;
      link.download = `${format === "summary-csv" ? "synthese-nuitees" : "registre-sejours"}-${gites || "gites"}-${data.period.start}.${format === "summary-csv" ? "csv" : format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Le téléchargement a échoué.",
      );
    } finally {
      setDownloading(false);
    }
  }
  const stays = data
    ? [...new Map(data.rows.map((row) => [row.reservationId, row])).values()]
    : [];
  return (
    <section
      className="rp-panel rp-declaration-panel"
      aria-label="Déclaration de nuitées"
    >
      {loading && <p role="status">Préparation de la synthèse…</p>}
      {!open && error && (
        <p className="rp-notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <ReportNightSummary data={data} />
          {!archive && workspace.canEdit && (
            <p className="rp-muted">
              <Link to={workspace.href(`/${reportId}/modifier`, month)}>
                Configurer la déclaration et les numéros d’enregistrement des
                gîtes
              </Link>
            </p>
          )}
          {data.incompleteCount > 0 && (
            <p className="rp-notice">
              {data.incompleteCount} séjour(s) à compléter avant de finaliser
              une déclaration de taxe de séjour. Consultez le registre pour
              vérifier les informations manquantes.
            </p>
          )}
          {data.archivedAt && (
            <p className="rp-muted">
              Registre figé lors de la confirmation du{" "}
              {new Date(data.archivedAt).toLocaleDateString("fr-FR", {
                timeZone: "Europe/Paris",
              })}
              .
            </p>
          )}
        </>
      )}
      <div className="rp-dialog__actions">
        <button
          type="button"
          className="rp-button rp-button--secondary"
          disabled={!data || loading || downloading}
          onClick={() => void download("summary-csv")}
        >
          Exporter la synthèse CSV
        </button>
        <button
          type="button"
          className="rp-button rp-button--secondary"
          onClick={() => setOpen(true)}
        >
          <ReportIcon name="download" /> Télécharger le registre
        </button>
      </div>
      {open && (
        <ReportDialog
          title="Registre des séjours"
          wide
          onClose={() => setOpen(false)}
        >
          <p className="rp-muted">
            {archive
              ? "Ce justificatif reprend les données figées lors de la confirmation."
              : "Le justificatif reprend les données actuelles des gîtes et de la période de ce rapport."}
          </p>
          {loading && <p role="status">Préparation du registre…</p>}
          {error && (
            <p className="rp-notice" role="alert">
              {error}
            </p>
          )}
          {data && (
            <>
              <div className="rp-register-summary">
                <strong>{data.period.label}</strong>
                <span>
                  {data.stayCount} séjour{data.stayCount > 1 ? "s" : ""} ·{" "}
                  {data.reportNights} nuitées retenues par le rapport
                </span>
                <div className="rp-register-properties">
                  {data.properties.map((property) => (
                    <span
                      className="rp-report-property-badge"
                      key={property.id}
                    >
                      <ReportIcon name="home" />
                      <span>{property.name}</span>
                    </span>
                  ))}
                </div>
              </div>
              {data.incompleteCount > 0 && (
                <p className="rp-notice">
                  {data.incompleteCount} séjour
                  {data.incompleteCount > 1 ? "s comportent" : " comporte"} des
                  informations à compléter. Le PDF les signale ; le tableau CSV
                  permet de les renseigner avant transmission. Une taxe calculée
                  n’est pas assimilée à une taxe perçue.
                </p>
              )}
              <ReportNightSummary data={data} />
              {!archive && (
                <ReportNightRegisterCompletion
                  key={data.revision}
                  data={data}
                  workspace={workspace}
                  month={month}
                  onSaved={() => setRefresh((value) => value + 1)}
                />
              )}
              <ul
                className="rp-register-stays"
                aria-label="Séjours du registre"
              >
                {stays.map((row) => (
                  <li key={row.reservationId}>
                    <div>
                      <strong>{row.propertyName}</strong>
                      <span>
                        {row.arrival.split("-").reverse().join("/")} au{" "}
                        {row.departure.split("-").reverse().join("/")} ·{" "}
                        {row.nights} nuit{row.nights > 1 ? "s" : ""} dans la
                        période
                      </span>
                    </div>
                    {row.issues.length > 0 && (
                      <details>
                        <summary>
                          {row.issues.length} information
                          {row.issues.length > 1 ? "s" : ""} à vérifier
                        </summary>
                        <ul>
                          {row.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {!stays.length && (
                <p>Aucun séjour dans le périmètre de cette période.</p>
              )}
            </>
          )}
          <p className="rp-muted">
            <a href={NIGHT_REGISTER_LEGAL_URL} target="_blank" rel="noreferrer">
              Champs prévus par l’article L. 2333-34 du CGCT
            </a>
            . Les informations non enregistrées restent indiquées « À compléter
            ».
          </p>
          <div className="rp-dialog__actions">
            <button
              type="button"
              className="rp-text-button"
              disabled={loading || downloading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Recharger l’aperçu
            </button>
            <button
              type="button"
              className="rp-button rp-button--secondary"
              disabled={!data || loading || downloading}
              onClick={() => void download("csv")}
            >
              <ReportIcon name="download" /> Télécharger le tableau CSV
            </button>
            <button
              type="button"
              className="rp-button"
              disabled={!data || loading || downloading}
              onClick={() => void download("pdf")}
            >
              <ReportIcon name="download" /> Télécharger le PDF
            </button>
          </div>
        </ReportDialog>
      )}
    </section>
  );
}
