import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import { formatDate } from "../utils/format";
import type { BookingRequest, BookingRequestStatus, Gite } from "../utils/types";
import { formatBookingRequestCreatedAt, requestStatusLabels } from "./bookingRequestUi";

type RequestGroup = {
  key: "pending" | "processed";
  title: string;
  statuses: BookingRequestStatus[];
  requests: BookingRequest[];
};

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m9 5 7 7-7 7" />
  </svg>
);

const BookingRequestsPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(
    () => Boolean(searchParams.get("q")),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const status = searchParams.get("status") ?? "";
  const giteId = searchParams.get("gite_id") ?? "";
  const query = searchParams.get("q") ?? "";
  const hasActiveFilters = Boolean(status || giteId || query);

  const updateFilter = (key: "status" | "gite_id" | "q", value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<BookingRequest[]>(
        `/booking-requests?status=${encodeURIComponent(status)}&gite_id=${encodeURIComponent(giteId)}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      ),
      apiFetch<Gite[]>("/gites", { signal: controller.signal }),
    ])
      .then(([requestRows, giteRows]) => {
        setRequests(requestRows);
        setGites(giteRows);
      })
      .catch((fetchError) => {
        if (isAbortError(fetchError)) return;
        setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger les demandes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [giteId, query, status]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    searchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  const groupedRequests = useMemo<RequestGroup[]>(() => {
    const groups: RequestGroup[] = [
      {
        key: "pending",
        title: "Demandes à traiter",
        statuses: ["pending"],
        requests: requests.filter((request) => request.status === "pending"),
      },
      {
        key: "processed",
        title: "Déjà traitées",
        statuses: ["approved", "rejected", "expired"],
        requests: requests.filter((request) => request.status !== "pending"),
      },
    ];

    return groups.filter((group) => {
      if (group.requests.length > 0) return true;
      return !hasActiveFilters && group.key === "pending";
    });
  }, [hasActiveFilters, requests]);

  const listingTarget = `${location.pathname}${location.search}`;

  return (
    <main className="page-shell booking-requests-page">
      <section className="card booking-requests-page__card">
        <div className="booking-requests-page__header">
          <div>
            <h1>Demandes de réservation</h1>
            <p className="section-subtitle">Consultez et traitez les demandes reçues depuis le site.</p>
          </div>
          <button
            type="button"
            className={`booking-requests-page__search-toggle${mobileSearchOpen ? " booking-requests-page__search-toggle--active" : ""}`}
            aria-label={mobileSearchOpen ? "Masquer la recherche" : "Afficher la recherche"}
            aria-expanded={mobileSearchOpen}
            onClick={() => setMobileSearchOpen((current) => !current)}
          >
            <SearchIcon />
            <span>Rechercher</span>
          </button>
        </div>

        <div className="booking-requests-page__filters">
          <label className="field">
            Statut
            <select value={status} onChange={(event) => updateFilter("status", event.target.value)}>
              <option value="">Tous</option>
              <option value="pending">À traiter</option>
              <option value="approved">Approuvées</option>
              <option value="rejected">Refusées</option>
              <option value="expired">Expirées</option>
            </select>
          </label>
          <label className="field">
            Gîte
            <select value={giteId} onChange={(event) => updateFilter("gite_id", event.target.value)}>
              <option value="">Tous</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>{gite.nom}</option>
              ))}
            </select>
          </label>
          <label className={`field booking-requests-page__search-field${mobileSearchOpen ? " booking-requests-page__search-field--open" : ""}`}>
            Recherche
            <span className="booking-requests-page__search-input">
              <SearchIcon />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => updateFilter("q", event.target.value)}
                placeholder="Nom, email, téléphone"
              />
            </span>
          </label>
        </div>

        {error ? <div className="note note--danger">{error}</div> : null}

        <div className="booking-requests-page__list">
          {loading ? <div className="note">Chargement…</div> : null}
          {!loading && requests.length === 0 && hasActiveFilters ? (
            <div className="note">Aucune demande trouvée avec ces filtres.</div>
          ) : null}
          {!loading && groupedRequests.map((group) => (
            <section
              key={group.key}
              className={`booking-requests-page__group booking-requests-page__group--${group.key}`}
            >
              <div className="booking-requests-page__group-title">
                <span>{group.title}</span>
                <strong>{group.requests.length}</strong>
              </div>
              {group.requests.length === 0 ? (
                <div className="booking-requests-page__empty-pending">Tout est traité.</div>
              ) : (
                <div className="booking-requests-page__rows">
                  {group.requests.map((request) => (
                    <Link
                      key={request.id}
                      to={`/demandes/${request.id}`}
                      state={{ from: listingTarget }}
                      className={`booking-requests-page__item booking-requests-page__item--${request.status}`}
                    >
                      <span className="booking-requests-page__item-person">
                        <strong>{request.hote_nom || "Client sans nom"}</strong>
                        <span>{request.gite?.nom ?? request.gite_id} · {request.telephone || request.email || "Contact absent"}</span>
                      </span>
                      <span className="booking-requests-page__item-stay">
                        <strong>{formatDate(request.date_entree)} → {formatDate(request.date_sortie)}</strong>
                        <span>{request.nb_nuits} nuit{request.nb_nuits > 1 ? "s" : ""}</span>
                      </span>
                      <span className="booking-requests-page__item-created">
                        <span>Demande reçue</span>
                        <strong>{formatBookingRequestCreatedAt(request.createdAt)}</strong>
                      </span>
                      <span className={`badge badge--${request.status}`}>{requestStatusLabels[request.status]}</span>
                      <span className="booking-requests-page__item-chevron"><ChevronIcon /></span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </section>
    </main>
  );
};

export default BookingRequestsPage;
