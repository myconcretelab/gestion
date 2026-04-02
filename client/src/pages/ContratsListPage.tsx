import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Contrat, Gite } from "../utils/types";
import { formatDate } from "../utils/format";
import {
  buildDocumentEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";
import { useDebouncedValue } from "./shared/useDebouncedValue";

const toLocalDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDateKey = (value: string) => {
  const trimmed = value.trim();
  return trimmed.includes("T") ? trimmed.slice(0, 10) : trimmed;
};

const getReturnBadge = (contrat: Contrat) => {
  if (contrat.statut_reception_contrat === "recu") return null;

  const dueDateKey = toDateKey(contrat.arrhes_date_limite);
  const todayKey = toLocalDateKey(new Date());
  const formattedDueDate = formatDate(contrat.arrhes_date_limite);

  if (dueDateKey < todayKey) {
    return {
      className:
        "reservations-current-pill reservations-current-pill--departure-today contrats-return-pill",
      label: `Retour attendu depuis le ${formattedDueDate}`,
    };
  }

  if (dueDateKey === todayKey) {
    return {
      className: "reservations-current-pill contrats-return-pill",
      label: "Retour attendu aujourd'hui",
    };
  }

  return {
    className: "reservations-current-pill contrats-return-pill",
    label: `Retour attendu avant le ${formattedDueDate}`,
  };
};

type EmailComposerState = {
  contratId: string;
  numeroContrat: string;
  recipient: string;
  subject: string;
  body: string;
};

const ContratsListPage = () => {
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [q, setQ] = useState("");
  const [giteId, setGiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receptionUpdating, setReceptionUpdating] = useState<
    Record<string, boolean>
  >({});
  const [arrhesUpdating, setArrhesUpdating] = useState<Record<string, boolean>>(
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

    apiFetch<Contrat[]>(
      `/contracts${debouncedQueryString ? `?${debouncedQueryString}` : ""}`,
      {
        signal: controller.signal,
      },
    )
      .then((contratsData) => {
        setError(null);
        setContrats(contratsData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(
          err instanceof Error
            ? err.message
            : "Erreur lors du chargement des contrats.",
        );
        setNotice(null);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQueryString]);

  const toggleReception = async (contrat: Contrat) => {
    const nextStatus =
      contrat.statut_reception_contrat === "recu" ? "non_recu" : "recu";
    setReceptionUpdating((prev) => ({ ...prev, [contrat.id]: true }));
    try {
      const updated = await apiFetch<Contrat>(
        `/contracts/${contrat.id}/reception`,
        {
          method: "PATCH",
          json: { statut_reception_contrat: nextStatus },
        },
      );
      setError(null);
      setNotice(null);
      setContrats((prev) =>
        prev.map((item) => (item.id === contrat.id ? updated : item)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReceptionUpdating((prev) => {
        const next = { ...prev };
        delete next[contrat.id];
        return next;
      });
    }
  };

  const toggleArrhes = async (contrat: Contrat) => {
    const nextStatus =
      contrat.statut_paiement_arrhes === "recu" ? "non_recu" : "recu";
    setArrhesUpdating((prev) => ({ ...prev, [contrat.id]: true }));
    try {
      const updated = await apiFetch<Contrat>(
        `/contracts/${contrat.id}/arrhes`,
        {
          method: "PATCH",
          json: { statut_paiement_arrhes: nextStatus },
        },
      );
      setError(null);
      setNotice(null);
      setContrats((prev) =>
        prev.map((item) => (item.id === contrat.id ? updated : item)),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArrhesUpdating((prev) => {
        const next = { ...prev };
        delete next[contrat.id];
        return next;
      });
    }
  };

  const openEmailComposer = async (contrat: Contrat) => {
    if (!contrat.locataire_email) return;
    try {
      const documentUrl = new URL(
        `/api/contracts/${contrat.id}/pdf`,
        window.location.origin,
      ).toString();
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
      );
      const draft = buildDocumentEmailDraft(
        {
          recipient: contrat.locataire_email,
          documentType: "contrat",
          documentNumber: contrat.numero_contrat,
          documentUrl,
          locataireNom: contrat.locataire_nom,
          giteNom: contrat.gite?.nom,
          dateDebut: contrat.date_debut,
          heureArrivee: contrat.heure_arrivee,
          dateFin: contrat.date_fin,
          heureDepart: contrat.heure_depart,
          nbNuits: contrat.nb_nuits,
          arrhesMontant: contrat.arrhes_montant,
          arrhesDateLimite: contrat.arrhes_date_limite,
          soldeMontant: contrat.solde_montant,
        },
        buildDocumentEmailTemplateSettings(emailTextSettings),
      );
      setError(null);
      setEmailComposer({
        contratId: contrat.id,
        numeroContrat: contrat.numero_contrat,
        recipient: draft.recipient ?? contrat.locataire_email,
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
    setEmailSending((prev) => ({ ...prev, [emailComposer.contratId]: true }));
    try {
      const updated = await apiFetch<Contrat>(
        `/contracts/${emailComposer.contratId}/send-email`,
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
        `Contrat ${emailComposer.numeroContrat} envoyé à ${updated.locataire_email}.`,
      );
      setEmailComposer(null);
      setContrats((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
    } finally {
      setEmailSending((prev) => {
        const next = { ...prev };
        if (emailComposer) delete next[emailComposer.contratId];
        return next;
      });
    }
  };

  const remove = async (contrat: Contrat) => {
    const confirmed = window.confirm(
      `Supprimer le contrat ${contrat.numero_contrat} (${contrat.locataire_nom}) ?`,
    );
    if (!confirmed) return;
    setDeletingId(contrat.id);
    try {
      await apiFetch(`/contracts/${contrat.id}`, { method: "DELETE" });
      setContrats((prev) => prev.filter((item) => item.id !== contrat.id));
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
            ? `Email du contrat ${emailComposer.numeroContrat}`
            : "Email contrat"
        }
        recipient={emailComposer?.recipient ?? ""}
        subject={emailComposer?.subject ?? ""}
        body={emailComposer?.body ?? ""}
        sending={Boolean(
          emailComposer && emailSending[emailComposer.contratId],
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
            Nom locataire / N° contrat
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
          <div className="section-title">Contrats</div>
          <Link
            className="contracts-add"
            to="/contrats/nouveau"
            aria-label="Créer un contrat"
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
              <th>Locataire</th>
              <th>Reçu en retour</th>
              <th>Arrhes payées</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contrats.map((contrat) => {
              const returnBadge = getReturnBadge(contrat);

              return (
                <tr key={contrat.id}>
                  <td>
                    <div className="contracts-date-cell">
                      {returnBadge ? (
                        <span className={returnBadge.className}>
                          {returnBadge.label}
                        </span>
                      ) : null}
                      <span>
                        {formatDate(contrat.date_debut)} -{" "}
                        {formatDate(contrat.date_fin)}
                      </span>
                    </div>
                  </td>
                  <td>{contrat.gite?.nom ?? ""}</td>
                  <td>{contrat.locataire_nom}</td>
                  <td>
                    <div className="switch-cell">
                      <div className="switch-group switch-group--table">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={
                              contrat.statut_reception_contrat === "recu"
                            }
                            disabled={Boolean(receptionUpdating[contrat.id])}
                            onChange={() => toggleReception(contrat)}
                          />
                          <span className="slider" />
                        </label>
                        <span>
                          {contrat.statut_reception_contrat === "recu"
                            ? "Reçu"
                            : "En attente"}
                        </span>
                      </div>
                      {contrat.statut_reception_contrat === "recu" &&
                      contrat.date_reception_contrat ? (
                        <div className="switch-meta">
                          Date de réception:{" "}
                          {formatDate(contrat.date_reception_contrat)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="switch-cell">
                      <div className="switch-group switch-group--table">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={contrat.statut_paiement_arrhes === "recu"}
                            disabled={Boolean(arrhesUpdating[contrat.id])}
                            onChange={() => toggleArrhes(contrat)}
                          />
                          <span className="slider" />
                        </label>
                        <span>
                          {contrat.statut_paiement_arrhes === "recu"
                            ? "Payées"
                            : "Non payées"}
                        </span>
                      </div>
                      {contrat.statut_paiement_arrhes === "recu" &&
                      contrat.date_paiement_arrhes ? (
                        <div className="switch-meta">
                          Date de paiement:{" "}
                          {formatDate(contrat.date_paiement_arrhes)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="table-actions-cell">
                    <div className="table-actions">
                      <Link
                        className="table-action table-action--neutral"
                        to={`/contrats/${contrat.id}`}
                      >
                        Détails
                      </Link>
                      {contrat.locataire_email ? (
                        <button
                          type="button"
                          className="table-action table-action--neutral"
                          onClick={() => void openEmailComposer(contrat)}
                          disabled={Boolean(emailSending[contrat.id])}
                        >
                          {emailSending[contrat.id] ? "Envoi..." : "Email"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="table-action table-action--neutral"
                          disabled
                          title="Email locataire non renseigné"
                        >
                          Email
                        </button>
                      )}
                      <Link
                        className="table-action table-action--neutral"
                        to={`/factures/nouvelle?fromContractId=${encodeURIComponent(contrat.id)}`}
                      >
                        Facturer
                      </Link>
                      <button
                        className="table-action table-action--danger"
                        onClick={() => remove(contrat)}
                        disabled={deletingId === contrat.id}
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

export default ContratsListPage;
