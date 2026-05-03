import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Contrat, Gite } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  buildDocumentEmailDraft,
  buildDocumentEmailTemplateSettings,
  type BuildDocumentEmailDraftParams,
  type DocumentEmailDeliveryMode,
  type DocumentEmailTextSettings,
  type DocumentEmailTemplateSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";
import ContractReturnDrawer from "./shared/ContractReturnDrawer";
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

const formatCompactDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
};

const normalizeInternalComment = (value: string | null | undefined) =>
  String(value ?? "").trim();

const getReturnBadge = (contrat: Contrat) => {
  if (contrat.statut_reception_contrat === "recu") return null;

  const dueDateKey = toDateKey(contrat.arrhes_date_limite);
  const todayKey = toLocalDateKey(new Date());
  const formattedDueDate = formatCompactDate(contrat.arrhes_date_limite);

  if (dueDateKey < todayKey) {
    return {
      className:
        "reservations-current-pill reservations-current-pill--departure-today contrats-return-pill",
      label: `Attendu depuis le ${formattedDueDate}`,
    };
  }

  if (dueDateKey === todayKey) {
    return {
      className: "reservations-current-pill contrats-return-pill",
      label: "Attendu aujourd'hui",
    };
  }

  return {
    className: "reservations-current-pill contrats-return-pill",
    label: `Attendu avant le ${formattedDueDate}`,
  };
};

type EmailComposerState = {
  contratId: string;
  numeroContrat: string;
  recipient: string;
  subject: string;
  body: string;
  deliveryMode: DocumentEmailDeliveryMode;
  draftParams: BuildDocumentEmailDraftParams;
  templateSettings: DocumentEmailTemplateSettings;
  autoSubject: string;
  autoBody: string;
};

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 20h4l9.8-9.8a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="m12.5 7.5 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const CrossIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="m8 8 8 8M16 8l-8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
  const [emailSending, setEmailSending] = useState<Record<string, boolean>>({});
  const [emailComposer, setEmailComposer] = useState<EmailComposerState | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [returnDrawerContractId, setReturnDrawerContractId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSaving, setCommentSaving] = useState<Record<string, boolean>>({});
  const commentInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const resizeCommentInput = (input: HTMLTextAreaElement | null) => {
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${input.scrollHeight}px`;
  };

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
        setCommentDrafts(
          Object.fromEntries(
            contratsData.map((contrat) => [contrat.id, contrat.commentaire_interne ?? ""]),
          ),
        );
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

  useEffect(() => {
    Object.values(commentInputRefs.current).forEach((input) => {
      resizeCommentInput(input);
    });
  }, [commentDrafts, contrats]);

  useEffect(() => {
    if (!returnDrawerContractId) return;
    if (contrats.some((contrat) => contrat.id === returnDrawerContractId)) return;
    setReturnDrawerContractId(null);
  }, [contrats, returnDrawerContractId]);

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
      const templateSettings = buildDocumentEmailTemplateSettings(
        emailTextSettings,
      );
      const draftParams: BuildDocumentEmailDraftParams = {
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
        statutPaiementArrhes: contrat.statut_paiement_arrhes,
        datePaiementArrhes: contrat.date_paiement_arrhes ?? null,
        modePaiementArrhes: contrat.mode_paiement_arrhes ?? null,
        soldeMontant: contrat.solde_montant,
        deliveryMode: "attachment",
      };
      const draft = buildDocumentEmailDraft(draftParams, templateSettings);
      setError(null);
      setEmailComposer({
        contratId: contrat.id,
        numeroContrat: contrat.numero_contrat,
        recipient: draft.recipient ?? contrat.locataire_email,
        subject: draft.subject,
        body: draft.body,
        deliveryMode: draftParams.deliveryMode ?? "attachment",
        draftParams,
        templateSettings,
        autoSubject: draft.subject,
        autoBody: draft.body,
      });
    } catch (err) {
      setError((err as Error).message);
      setNotice(null);
    }
  };

  const saveInternalComment = async (contrat: Contrat) => {
    const draft = commentDrafts[contrat.id] ?? "";
    if (
      normalizeInternalComment(draft) ===
      normalizeInternalComment(contrat.commentaire_interne)
    ) {
      if (draft !== (contrat.commentaire_interne ?? "")) {
        setCommentDrafts((prev) => ({
          ...prev,
          [contrat.id]: contrat.commentaire_interne ?? "",
        }));
      }
      return;
    }

    setCommentSaving((prev) => ({ ...prev, [contrat.id]: true }));
    try {
      const updated = await apiFetch<Contrat>(
        `/contracts/${contrat.id}/internal-comment`,
        {
          method: "PATCH",
          json: { commentaire_interne: draft },
        },
      );
      setError(null);
      setNotice(null);
      setContrats((prev) =>
        prev.map((item) => (item.id === contrat.id ? updated : item)),
      );
      setCommentDrafts((prev) => ({
        ...prev,
        [contrat.id]: updated.commentaire_interne ?? "",
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCommentSaving((prev) => {
        const next = { ...prev };
        delete next[contrat.id];
        return next;
      });
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
            deliveryMode: emailComposer.deliveryMode,
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

  const selectedReturnDrawerContract =
    contrats.find((contrat) => contrat.id === returnDrawerContractId) ?? null;

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
        deliveryMode={emailComposer?.deliveryMode ?? "attachment"}
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
        onDeliveryModeChange={(value) =>
          setEmailComposer((prev) => {
            if (!prev) return prev;
            const nextDraftParams = { ...prev.draftParams, deliveryMode: value };
            const nextDraft = buildDocumentEmailDraft(
              nextDraftParams,
              prev.templateSettings,
            );
            return {
              ...prev,
              deliveryMode: value,
              draftParams: nextDraftParams,
              subject:
                prev.subject === prev.autoSubject
                  ? nextDraft.subject
                  : prev.subject,
              body: prev.body === prev.autoBody ? nextDraft.body : prev.body,
              autoSubject: nextDraft.subject,
              autoBody: nextDraft.body,
            };
          })
        }
        onSubmit={sendEmail}
      />
      <ContractReturnDrawer
        open={Boolean(selectedReturnDrawerContract)}
        contract={selectedReturnDrawerContract}
        onClose={() => setReturnDrawerContractId(null)}
        onUpdated={(updated) => {
          setError(null);
          setNotice(null);
          setContrats((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        }}
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
        <table className="table contracts-table">
          <colgroup>
            <col className="contracts-table__col contracts-table__col--dates" />
            <col className="contracts-table__col contracts-table__col--gite" />
            <col className="contracts-table__col contracts-table__col--locataire" />
            <col className="contracts-table__col contracts-table__col--retour" />
            <col className="contracts-table__col contracts-table__col--arrhes" />
            <col className="contracts-table__col contracts-table__col--commentaire" />
            <col className="contracts-table__col contracts-table__col--restant" />
            <col className="contracts-table__col contracts-table__col--actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Dates</th>
              <th>Gîte</th>
              <th>Locataire</th>
              <th>Reçu en retour</th>
              <th>Arrhes payées</th>
              <th>Commentaire</th>
              <th>Restant dû</th>
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
                      <span>
                        {formatDate(contrat.date_debut)} -{" "}
                        {formatDate(contrat.date_fin)}
                      </span>
                    </div>
                  </td>
                  <td>{contrat.gite?.nom ?? ""}</td>
                  <td>{contrat.locataire_nom}</td>
                  <td>
                    {contrat.statut_reception_contrat === "recu" ? (
                      <div className="contract-return-status">
                        <div className="contract-return-status__summary">
                          <span className="contract-return-status__text">Retour reçu</span>
                          <strong>{formatDate(contrat.date_reception_contrat ?? contrat.date_derniere_modif)}</strong>
                        </div>
                        <div className="contract-return-status__actions">
                          <button
                            type="button"
                            className="table-action table-action--icon table-action--neutral"
                            onClick={() => setReturnDrawerContractId(contrat.id)}
                            aria-label={`Modifier le retour du contrat ${contrat.numero_contrat}`}
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--icon table-action--neutral"
                            onClick={() => void toggleReception(contrat)}
                            disabled={Boolean(receptionUpdating[contrat.id])}
                            aria-label={`Annuler la réception du contrat ${contrat.numero_contrat}`}
                          >
                            <CrossIcon />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="contract-return-pending">
                        <button
                          type="button"
                          className="contract-return-trigger"
                          onClick={() => setReturnDrawerContractId(contrat.id)}
                        >
                          Traiter le retour
                        </button>
                        <div className="contract-return-pending__meta">
                          {returnBadge ? returnBadge.label : "Contrat en attente de retour"}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                      <div className="switch-cell">
                        <div className="switch-meta contract-arrhes-status">
                          {contrat.statut_paiement_arrhes === "recu" ? "Payées" : "En attente"}
                        </div>
                      {contrat.date_paiement_arrhes ? (
                        <div className="switch-meta contract-tracking-meta">
                          Payé le {formatDate(contrat.date_paiement_arrhes)}
                        </div>
                      ) : null}
                      {contrat.mode_paiement_arrhes ? (
                        <div className="switch-meta contract-tracking-meta">
                          {contrat.mode_paiement_arrhes}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="contract-comment-cell">
                    <div className="contract-comment-editor">
                      <textarea
                        className="contract-comment-editor__input"
                        rows={2}
                        ref={(input) => {
                          commentInputRefs.current[contrat.id] = input;
                          resizeCommentInput(input);
                        }}
                        value={commentDrafts[contrat.id] ?? ""}
                        placeholder="Commentaire interne"
                        disabled={Boolean(commentSaving[contrat.id])}
                        onChange={(event) => {
                          resizeCommentInput(event.currentTarget);
                          setCommentDrafts((prev) => ({
                            ...prev,
                            [contrat.id]: event.target.value,
                          }));
                        }}
                        onBlur={() => {
                          void saveInternalComment(contrat);
                        }}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            void saveInternalComment(contrat);
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      {commentSaving[contrat.id] ? (
                        <div className="contract-comment-editor__meta">Enregistrement...</div>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <strong>{formatEuro(contrat.solde_montant)}</strong>
                  </td>
                  <td className="table-actions-cell">
                    <div className="reservations-actions-cell">
                      <Link
                        className="table-action table-action--neutral"
                        to={`/contrats/${contrat.id}`}
                      >
                        Détails
                      </Link>
                      <div className="reservations-actions-menu">
                        <button
                          type="button"
                          className="table-action table-action--neutral reservations-actions-trigger"
                          title="Actions"
                        >
                          ⋯
                        </button>
                        <div className="reservations-row-actions">
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
                            type="button"
                            className="table-action table-action--danger"
                            onClick={() => remove(contrat)}
                            disabled={deletingId === contrat.id}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
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
