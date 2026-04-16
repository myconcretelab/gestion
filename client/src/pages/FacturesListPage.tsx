import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Facture, Gite } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  buildDocumentEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";
import { useDebouncedValue } from "./shared/useDebouncedValue";

type EmailComposerState = {
  factureId: string;
  numeroFacture: string;
  recipient: string;
  subject: string;
  body: string;
};

const FacturesListPage = () => {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [q, setQ] = useState("");
  const [giteId, setGiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>(
    {},
  );
  const [emailSending, setEmailSending] = useState<Record<string, boolean>>({});
  const [emailComposer, setEmailComposer] = useState<EmailComposerState | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (giteId) params.set("giteId", giteId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [q, giteId, from, to]);
  const debouncedQueryString = useDebouncedValue(queryString, 250);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<Gite[]>("/gites", { signal: controller.signal })
      .then((gitesData) => {
        setError(null);
        setGites(gitesData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement des gîtes.",
        );
        setNotice(null);
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);

    apiFetch<Facture[]>(
      `/invoices${debouncedQueryString ? `?${debouncedQueryString}` : ""}`,
      {
        signal: controller.signal,
      },
    )
      .then((facturesData) => {
        setError(null);
        setFactures(facturesData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement des factures.",
        );
        setNotice(null);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQueryString]);

  const togglePayment = async (facture: Facture) => {
    const nextStatus =
      facture.statut_paiement === "reglee" ? "non_reglee" : "reglee";
    setStatusUpdating((prev) => ({ ...prev, [facture.id]: true }));
    try {
      const updated = await apiFetch<Facture>(
        `/invoices/${facture.id}/payment`,
        {
          method: "PATCH",
          json: { statut_paiement: nextStatus },
        },
      );
      setError(null);
      setNotice(null);
      setFactures((prev) =>
        prev.map((item) => (item.id === facture.id ? updated : item)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStatusUpdating((prev) => {
        const next = { ...prev };
        delete next[facture.id];
        return next;
      });
    }
  };

  const openEmailComposer = async (facture: Facture) => {
    if (!facture.locataire_email) return;
    try {
      const documentUrl = new URL(
        `/api/invoices/${facture.id}/pdf`,
        window.location.origin,
      ).toString();
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
      );
      const draft = buildDocumentEmailDraft(
        {
          recipient: facture.locataire_email,
          documentType: "facture",
          documentNumber: facture.numero_facture,
          documentUrl,
          locataireNom: facture.locataire_nom,
          giteNom: facture.gite?.nom,
        },
        buildDocumentEmailTemplateSettings(emailTextSettings),
      );
      setError(null);
      setEmailComposer({
        factureId: facture.id,
        numeroFacture: facture.numero_facture,
        recipient: draft.recipient ?? facture.locataire_email,
        subject: draft.subject,
        body: draft.body,
      });
    } catch (err) {
      setError((err as Error).message);
      setNotice(null);
    }
  };

  const sendEmail = async () => {
    if (!emailComposer) return;
    setEmailSending((prev) => ({ ...prev, [emailComposer.factureId]: true }));
    try {
      const updated = await apiFetch<Facture>(
        `/invoices/${emailComposer.factureId}/send-email`,
        {
          method: "POST",
          json: {
            recipient: emailComposer.recipient,
            subject: emailComposer.subject,
            body: emailComposer.body,
          },
        },
      );
      setError(null);
      setNotice(
        `Facture ${emailComposer.numeroFacture} envoyée à ${updated.locataire_email}.`,
      );
      setEmailComposer(null);
      setFactures((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
    } finally {
      setEmailSending((prev) => {
        const next = { ...prev };
        if (emailComposer) delete next[emailComposer.factureId];
        return next;
      });
    }
  };

  const remove = async (facture: Facture) => {
    const confirmed = window.confirm(
      `Supprimer la facture ${facture.numero_facture} (${facture.locataire_nom}) ?`,
    );
    if (!confirmed) return;
    setDeletingId(facture.id);
    try {
      await apiFetch(`/invoices/${facture.id}`, { method: "DELETE" });
      setFactures((prev) => prev.filter((item) => item.id !== facture.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <DocumentEmailComposerDialog
        open={Boolean(emailComposer)}
        title={
          emailComposer
            ? `Email de la facture ${emailComposer.numeroFacture}`
            : "Email facture"
        }
        recipient={emailComposer?.recipient ?? ""}
        subject={emailComposer?.subject ?? ""}
        body={emailComposer?.body ?? ""}
        sending={Boolean(
          emailComposer && emailSending[emailComposer.factureId],
        )}
        onClose={() => setEmailComposer(null)}
        onRecipientChange={(value) =>
          setEmailComposer((prev) =>
            prev ? { ...prev, recipient: value } : prev,
          )
        }
        onSubjectChange={(value) =>
          setEmailComposer((prev) =>
            prev ? { ...prev, subject: value } : prev,
          )
        }
        onBodyChange={(value) =>
          setEmailComposer((prev) => (prev ? { ...prev, body: value } : prev))
        }
        onSubmit={sendEmail}
      />
      <div className="card">
        <div className="section-title">Recherche</div>
        {error && <div className="note">{error}</div>}
        {notice && <div className="note note--success">{notice}</div>}
        <div className="grid-2">
          <label className="field">
            Client / N° facture
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="field">
            Gîte
            <select value={giteId} onChange={(e) => setGiteId(e.target.value)}>
              <option value="">Tous</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Date début (à partir de)
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            Date début (jusqu'à)
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="contracts-header">
          <div className="section-title">Factures</div>
          <Link
            className="contracts-add contracts-add--invoice"
            to="/factures/nouvelle"
            aria-label="Créer une facture"
          >
            <span className="contracts-add__icon" aria-hidden="true">
              +
            </span>
          </Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Dates</th>
              <th>Gîte</th>
              <th>Client</th>
              <th>Total</th>
              <th>Envoyée le</th>
              <th>Réglée</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {factures.map((facture) => {
              const totalMontant =
                Number(facture.solde_montant ?? 0) +
                Number(facture.arrhes_montant ?? 0);
              return (
                <tr key={facture.id}>
                  <td>
                    {formatDate(facture.date_debut)} -{" "}
                    {formatDate(facture.date_fin)}
                  </td>
                  <td>{facture.gite?.nom ?? ""}</td>
                  <td>{facture.locataire_nom}</td>
                  <td>{formatEuro(totalMontant)}</td>
                  <td>
                    {facture.date_envoi_email
                      ? formatDate(facture.date_envoi_email)
                      : "—"}
                  </td>
                  <td>
                    <div className="switch-group switch-group--table">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={facture.statut_paiement === "reglee"}
                          disabled={Boolean(statusUpdating[facture.id])}
                          onChange={() => togglePayment(facture)}
                        />
                        <span className="slider" />
                      </label>
                      <span>
                        {facture.statut_paiement === "reglee" ? "Oui" : "Non"}
                      </span>
                    </div>
                  </td>
                  <td className="table-actions-cell">
                    <div className="table-actions">
                      <Link
                        className="table-action table-action--neutral"
                        to={`/factures/${facture.id}`}
                      >
                        Détails
                      </Link>
                      {facture.locataire_email ? (
                        <button
                          type="button"
                          className="table-action table-action--neutral"
                          onClick={() => void openEmailComposer(facture)}
                          disabled={Boolean(emailSending[facture.id])}
                        >
                          {emailSending[facture.id] ? "Envoi..." : "Email"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="table-action table-action--neutral"
                          disabled
                          title="Email client non renseigné"
                        >
                          Email
                        </button>
                      )}
                      <button
                        className="table-action table-action--danger"
                        onClick={() => remove(facture)}
                        disabled={deletingId === facture.id}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FacturesListPage;
