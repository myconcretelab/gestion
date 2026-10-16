import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import { canCurrentUserManageIntegrations } from "../utils/auth";
import "./shared/purchaseInvoices.css";

type Entity = { id: string; legal_name: string; siren: string | null };
type InboxState = {
  available: boolean;
  reason: string | null;
  revision: number;
  sync: null | {
    id: string;
    enabled: boolean;
    busy: boolean;
    last_synced_at: string | null;
    last_error_code: string | null;
  };
};
type Expense = {
  id: string;
  label: string;
  amount: number;
  scope: string;
  gite_id: string | null;
  year: number;
  month: number;
  updated_at: string;
};
type PurchaseInvoice = {
  id: string;
  fiscal_entity_id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  issue_date: string | null;
  type_code: number | null;
  currency: string | null;
  total_without_vat: string | null;
  total_vat: string | null;
  total_with_vat: string | null;
  remote_invoice_id: string;
  remote_created_at: string;
  details_pending: boolean;
  has_structured: boolean;
  expense: Expense | null;
  expense_changed: boolean;
  revision: number;
};
type List = {
  items: PurchaseInvoice[];
  count: number;
  page: number;
  page_size: number;
};
type Detail = {
  invoice: PurchaseInvoice;
  events: Array<{
    id: string;
    status_code: string;
    occurred_at: string;
    details: {
      status_text?: string;
      data?: { reason?: string };
      details?: Array<{
        reason?: string;
        notes?: Array<{ contents?: Array<{ content: string }> }>;
      }>;
    };
  }>;
  history_truncated: boolean;
};
const money = (value: string | null, currency: string | null) =>
  value === null ? "À extraire" : `${value} ${currency ?? ""}`;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Opération indisponible.";

export default function PurchaseInvoicesPage() {
  const allowed = canCurrentUserManageIntegrations();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState(
    () => new URLSearchParams(window.location.search).get("entreprise") ?? "",
  );
  const [inbox, setInbox] = useState<InboxState | null>(null);
  const [list, setList] = useState<List | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [candidates, setCandidates] = useState<{
    items: Expense[];
    reason: string;
  } | null>(null);
  const [expenseId, setExpenseId] = useState("");
  const [confirmMatch, setConfirmMatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    apiFetch<Entity[]>("/fiscal-entities", { signal: controller.signal })
      .then(setEntities)
      .catch((err) => {
        if (!isAbortError(err)) setError(messageOf(err));
      });
    return () => controller.abort();
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setList(null);
    setInbox(null);
    setError(null);
    const query = new URLSearchParams({ page: String(page) });
    if (entityId) query.set("entity_id", entityId);
    apiFetch<List>(`/purchase-invoices?${query}`, { signal: controller.signal })
      .then(setList)
      .catch((err) => {
        if (!isAbortError(err)) setError(messageOf(err));
      });
    if (entityId)
      apiFetch<InboxState>(
        `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp/inbox`,
        { signal: controller.signal },
      )
        .then(setInbox)
        .catch((err) => {
          if (!isAbortError(err)) setError(messageOf(err));
        });
    return () => controller.abort();
  }, [allowed, entityId, page, refresh]);
  useEffect(() => {
    if (!allowed || !selected) {
      setDetail(null);
      setCandidates(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setCandidates(null);
    setExpenseId("");
    setConfirmMatch(false);
    Promise.all([
      apiFetch<Detail>(`/purchase-invoices/${encodeURIComponent(selected)}`, {
        signal: controller.signal,
      }),
      apiFetch<{ items: Expense[]; reason: string }>(
        `/purchase-invoices/${encodeURIComponent(selected)}/expense-candidates`,
        { signal: controller.signal },
      ),
    ])
      .then(([value, proposals]) => {
        setDetail(value);
        setCandidates(proposals);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(messageOf(err));
      });
    return () => controller.abort();
  }, [allowed, selected, refresh]);
  const configure = async (enabled: boolean) => {
    if (!entityId || !inbox) return;
    if (
      enabled &&
      !window.confirm(
        "Activer uniquement la récupération locale des achats de cette entreprise SuperPDP de TEST ? Aucun annuaire ni statut ne sera créé ou envoyé.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setInbox(
        await apiFetch<InboxState>(
          `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp/inbox`,
          {
            method: "PUT",
            json: { revision: inbox.revision, enabled, confirm_sandbox: true },
          },
        ),
      );
      setNotice(
        enabled
          ? "Synchronisation des achats de test activée. Les imports seront traités en arrière-plan."
          : "Synchronisation locale arrêtée. Les archives reçues sont conservées.",
      );
    } catch (err) {
      setError(messageOf(err));
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };
  const syncNow = async () => {
    if (!entityId) return;
    setBusy(true);
    setError(null);
    try {
      setInbox(
        await apiFetch<InboxState>(
          `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp/inbox/sync`,
          { method: "POST", json: {} },
        ),
      );
      setNotice(
        "Demande de synchronisation enregistrée. Actualisez la boîte après son traitement.",
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const match = async () => {
    const expense = candidates?.items.find((item) => item.id === expenseId);
    if (!detail || !expense || !confirmMatch) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setDetail(
        await apiFetch<Detail>(
          `/purchase-invoices/${encodeURIComponent(detail.invoice.id)}/match`,
          {
            method: "PUT",
            json: {
              revision: detail.invoice.revision,
              expense_id: expense.id,
              expense_updated_at: expense.updated_at,
              confirm_match: true,
            },
          },
        ),
      );
      setNotice(
        "Rapprochement documentaire enregistré. La dépense, ses montants et son paiement n’ont pas été modifiés.",
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    if (
      !detail ||
      !window.confirm(
        "Retirer seulement le rapprochement ? La facture reçue et la dépense seront conservées.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      setDetail(
        await apiFetch<Detail>(
          `/purchase-invoices/${encodeURIComponent(detail.invoice.id)}/match`,
          {
            method: "DELETE",
            json: { revision: detail.invoice.revision, confirm_unlink: true },
          },
        ),
      );
      setNotice(
        "Rapprochement retiré, sans suppression de document ou de dépense.",
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  if (!allowed)
    return (
      <p className="note">
        La boîte d’achats SuperPDP de test est réservée à l’administrateur
        connecté.
      </p>
    );
  const invoice = detail?.invoice;
  return (
    <div className="purchase-invoices-page">
      <header>
        <h1>Factures d’achat — SuperPDP de test</h1>
        <Link to="/frais-professionnels">Revenir aux frais professionnels</Link>
      </header>
      <p className="note">
        Cette boîte archive les factures déjà reçues dans SuperPDP de test. Elle
        n’active pas l’inscription d’une entreprise dans un annuaire et n’envoie
        aucun accusé, acceptation ou statut de paiement. Aucun enregistrement
        comptable n’est créé automatiquement.
      </p>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="note" role="status">
          {notice}
        </p>
      )}
      <label className="field">
        Entreprise
        <select
          value={entityId}
          disabled={busy}
          onChange={(event) => {
            setEntityId(event.target.value);
            setPage(1);
            setSelected(null);
          }}
        >
          <option value="">Toutes les entreprises — consultation</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.legal_name} · {entity.siren ?? "SIREN à compléter"}
            </option>
          ))}
        </select>
      </label>
      {entityId && (
        <section className="card" aria-label="Synchronisation des achats">
          <h2>Récupération locale des achats</h2>
          {!inbox ? (
            <p>Chargement de la configuration…</p>
          ) : (
            <>
              <p>
                {inbox.sync?.enabled
                  ? "Synchronisation activée"
                  : "Synchronisation arrêtée ou non configurée"}
                {inbox.sync?.busy ? " — import en cours" : ""}
              </p>
              {!inbox.available && <p className="note">{inbox.reason}</p>}
              <div className="actions">
                <button
                  type="button"
                  disabled={busy || (!inbox.sync?.enabled && !inbox.available)}
                  onClick={() => void configure(!inbox.sync?.enabled)}
                >
                  {inbox.sync?.enabled
                    ? "Arrêter la synchronisation locale"
                    : "Activer la synchronisation de test"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    busy ||
                    !inbox.available ||
                    !inbox.sync?.enabled ||
                    inbox.sync.busy
                  }
                  onClick={() => void syncNow()}
                >
                  Synchroniser maintenant
                </button>
              </div>
              {inbox.sync?.last_synced_at && (
                <p>
                  Dernière synchronisation :{" "}
                  {new Date(inbox.sync.last_synced_at).toLocaleString("fr-FR")}
                </p>
              )}
              {inbox.sync?.last_error_code && (
                <p className="note">
                  Dernier import non confirmé : {inbox.sync.last_error_code}.
                  Les documents non enregistrés seront repris.
                </p>
              )}
            </>
          )}
          <p>
            <Link
              to={`/parametres/entreprises?entreprise=${encodeURIComponent(entityId)}`}
            >
              Vérifier la connexion OAuth de cette entreprise
            </Link>
          </p>
        </section>
      )}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Actualiser la boîte locale
        </button>
      </div>
      {!list ? (
        <p>Chargement des factures reçues…</p>
      ) : (
        <>
          <p>
            {list.count} document(s) archivé(s). Les montants sont ceux de la
            facture, sans conversion de devise ni déduction du paiement.
          </p>
          {!list.items.length && (
            <p>Aucune facture d’achat archivée pour cette sélection.</p>
          )}
          <ul className="purchase-invoices-list">
            {list.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`secondary purchase-invoice-choice${selected === item.id ? " is-selected" : ""}`}
                  disabled={busy}
                  onClick={() => {
                    setSelected(item.id);
                    setError(null);
                  }}
                >
                  <strong>
                    {item.supplier_name ?? "Fournisseur en cours d’extraction"}
                  </strong>
                  <span>
                    {item.type_code === 381 ? "Avoir" : "Facture"}{" "}
                    {item.invoice_number ?? item.remote_invoice_id} ·{" "}
                    {item.issue_date ?? "Date à extraire"}
                  </span>
                  <span>
                    {money(item.total_with_vat, item.currency)} TTC ·{" "}
                    {entities.find(
                      (entity) => entity.id === item.fiscal_entity_id,
                    )?.legal_name ?? "Entreprise"}
                  </span>
                  <span>
                    {item.details_pending
                      ? "Données détaillées à compléter"
                      : item.expense
                        ? item.expense_changed
                          ? "Rapprochement à revérifier"
                          : "Rapprochée d’une dépense"
                        : "Non rapprochée"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || page <= 1}
              onClick={() => {
                setPage((value) => value - 1);
                setSelected(null);
              }}
            >
              Précédente
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              className="secondary"
              disabled={busy || page * list.page_size >= list.count}
              onClick={() => {
                setPage((value) => value + 1);
                setSelected(null);
              }}
            >
              Suivante
            </button>
          </div>
        </>
      )}
      {selected && !detail && <p>Chargement du détail…</p>}
      {invoice && detail && (
        <section className="card" aria-label="Détail de la facture reçue">
          <h2>
            {invoice.invoice_number ?? "Document reçu"} —{" "}
            {invoice.supplier_name ?? "Fournisseur à extraire"}
          </h2>
          <p>
            HT : {money(invoice.total_without_vat, invoice.currency)} · TVA :{" "}
            {money(invoice.total_vat, invoice.currency)} · TTC :{" "}
            {money(invoice.total_with_vat, invoice.currency)}
          </p>
          <p>
            Identifiant SuperPDP : {invoice.remote_invoice_id}. Reçue dans la
            plateforme le{" "}
            {new Date(invoice.remote_created_at).toLocaleString("fr-FR")}.
          </p>
          <div className="actions">
            <a
              href={`/api/purchase-invoices/${encodeURIComponent(invoice.id)}/original`}
              target="_blank"
              rel="noreferrer"
            >
              Télécharger le fichier original
            </a>
            {invoice.has_structured && (
              <a
                href={`/api/purchase-invoices/${encodeURIComponent(invoice.id)}/structured`}
                target="_blank"
                rel="noreferrer"
              >
                Exporter les données structurées
              </a>
            )}
          </div>
          {invoice.details_pending && (
            <p className="note">
              L’original est archivé. SuperPDP n’a pas encore fourni un détail
              exploitable ; il sera revérifié sans perdre le document.
            </p>
          )}
          <h3>Rapprochement avec une dépense existante</h3>
          {invoice.expense ? (
            <>
              <p>
                {invoice.expense.label} · {invoice.expense.amount.toFixed(2)}{" "}
                EUR · {invoice.expense.month}/{invoice.expense.year} ·{" "}
                {invoice.expense.scope === "all_gites"
                  ? "Tous gîtes"
                  : "Gîte sélectionné"}
              </p>
              {invoice.expense_changed && (
                <p className="note">
                  La dépense a changé depuis le rapprochement. Vérifiez-la, puis
                  retirez et refaites le lien si nécessaire.
                </p>
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void unlink()}
              >
                Retirer le rapprochement
              </button>
            </>
          ) : (
            <>
              <p>{candidates?.reason ?? "Chargement des propositions…"}</p>
              <label className="field">
                Dépense professionnelle à rapprocher
                <select
                  value={expenseId}
                  disabled={busy || !candidates?.items.length}
                  onChange={(event) => {
                    setExpenseId(event.target.value);
                    setConfirmMatch(false);
                  }}
                >
                  <option value="">Choisir après vérification</option>
                  {candidates?.items.map((expense) => (
                    <option key={expense.id} value={expense.id}>
                      {expense.label} · {expense.amount.toFixed(2)} EUR ·{" "}
                      {expense.month}/{expense.year} ·{" "}
                      {expense.scope === "all_gites" ? "Tous gîtes" : "Gîte"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={confirmMatch}
                    disabled={busy || !expenseId}
                    onChange={(event) => setConfirmMatch(event.target.checked)}
                  />{" "}
                  J’ai vérifié le fournisseur, la période, le montant TTC et le
                  périmètre de cette dépense. Ce lien ne crée pas de paiement.
                </span>
              </label>
              <button
                type="button"
                disabled={busy || !expenseId || !confirmMatch}
                onClick={() => void match()}
              >
                Confirmer le rapprochement documentaire
              </button>
            </>
          )}
          <p>
            <Link to="/frais-professionnels">
              Consulter ou saisir les frais professionnels dans l’interface
              habituelle
            </Link>
          </p>
          <h3>Événements de cette facture</h3>
          {!detail.events.length ? (
            <p>Aucun événement synchronisé pour l’instant.</p>
          ) : (
            <ul>
              {detail.events.map((event) => (
                <li key={event.id}>
                  {new Date(event.occurred_at).toLocaleString("fr-FR")} ·{" "}
                  {event.status_code}
                  {event.details.status_text
                    ? ` — ${event.details.status_text}`
                    : ""}
                  {event.details.data?.reason
                    ? ` — ${event.details.data.reason}`
                    : ""}
                  {event.details.details
                    ?.flatMap((entry) => [
                      entry.reason,
                      ...(entry.notes?.flatMap(
                        (note) =>
                          note.contents?.map((content) => content.content) ??
                          [],
                      ) ?? []),
                    ])
                    .filter(Boolean)
                    .map((value, index) => (
                      <span key={index}> · {value}</span>
                    ))}
                </li>
              ))}
            </ul>
          )}
          {detail.history_truncated && (
            <p>
              Les 200 derniers événements sont affichés ; le journal complet
              reste archivé.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
