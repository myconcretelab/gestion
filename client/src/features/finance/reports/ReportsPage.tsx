import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  reportDraftSchema,
  type ReportCommand,
  type ReportDefinition,
  type ReportWorkspaceData,
} from "@contrats/shared";
import {
  canCurrentUserWritePage,
  getCurrentAuthUserId,
} from "../../../utils/auth";
import { apiFetch, isApiError } from "../../../utils/api";
import { ReportIcon } from "./ReportUi";
import OtaImportPage from "./OtaImportPage";
import UndatedPaymentsPage from "./UndatedPaymentsPage";
import ReportsOverview from "./ReportsOverview";
import ReportAllocationEditor from "./ReportAllocationEditor";
import ReportDetail from "./ReportDetail";
import ReportEditor from "./ReportEditor";
import "./reports.css";

export type ReportWorkspace = {
  state: ReportWorkspaceData;
  refresh: () => Promise<void>;
  loading: boolean;
  setDraft: (key: string, definition: ReportDefinition | null) => void;
  mutate: (command: ReportCommand) => Promise<boolean>;
  month: string;
  setMonth: (month: string) => void;
  href: (path?: string) => string;
  canEdit: boolean;
  saving: boolean;
  notify: (message: string) => void;
  storageError: boolean;
  propertyName: (id: string) => string;
};
const draftKey = (organizationId: string) =>
  `contrats:reports:drafts:${organizationId}:${getCurrentAuthUserId()}`;
function readDrafts(organizationId: string) {
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(draftKey(organizationId)) ?? "{}",
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const drafts: Record<string, ReportDefinition> = {};
    for (const [key, value] of Object.entries(raw)) {
      const checked = reportDraftSchema.safeParse(value);
      if (checked.success) drafts[key] = checked.data;
    }
    return drafts;
  } catch {
    return {};
  }
}
export default function ReportsPage() {
  const location = useLocation();
  const [state, setState] = useState<ReportWorkspaceData | null>(null);
  const current = useRef(state);
  current.current = state;
  const [storageError, setStorageError] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState("");
  const [params, setParams] = useSearchParams();
  const now = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const candidate = params.get("periode") ?? now;
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : now;
  const notify = useCallback((message: string) => setNotice(message), []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ReportWorkspaceData>("/reports", { signal });
      if (!signal?.aborted)
        setState((previous) => ({
          ...data,
          drafts:
            previous?.organizationId === data.organizationId
              ? previous.drafts
              : readDrafts(data.organizationId),
        }));
    } catch (failure) {
      if (!signal?.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Chargement des rapports impossible.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);
  const drafts = state?.drafts;
  const organizationId = state?.organizationId;
  useEffect(() => {
    if (!drafts || !organizationId) return;
    try {
      sessionStorage.setItem(draftKey(organizationId), JSON.stringify(drafts));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [drafts, organizationId]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const mutate = async (command: ReportCommand) => {
    const before = current.current;
    if (
      !before ||
      loading ||
      lock.current ||
      !canCurrentUserWritePage("statistics")
    )
      return false;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await apiFetch<ReportWorkspaceData>("/reports/commands", {
        method: "POST",
        json: {
          command,
          month,
          revision: before.revision,
          factsRevision: before.factsRevision,
        },
      });
      setState((previous) => ({ ...data, drafts: previous?.drafts ?? {} }));
      return true;
    } catch (failure) {
      if (isApiError(failure) && failure.status === 409) {
        await refresh();
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "Enregistrement impossible. Réessayez.",
      );
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const workspace: ReportWorkspace | null = state
    ? {
        state,
        month,
        mutate,
        saving,
        loading,
        refresh: () => refresh(),
        setDraft: (key, definition) =>
          setState((previous) => {
            if (!previous) return previous;
            const drafts = { ...previous.drafts };
            if (definition) drafts[key] = definition;
            else delete drafts[key];
            return { ...previous, drafts };
          }),
        setMonth: (value) => {
          if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))
            setParams({ periode: value });
        },
        href: (path = "") => `/rapports${path}?periode=${month}`,
        canEdit: canCurrentUserWritePage("statistics"),
        notify,
        storageError,
        propertyName: (id) =>
          state.properties.find((property) => property.id === id)?.name ?? id,
      }
    : null;
  return (
    <div className="reports-workspace" aria-busy={loading || saving}>
      {error && (
        <div className="rp-notice" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="rp-text-button"
            disabled={loading || saving}
            onClick={() => void refresh()}
          >
            Actualiser
          </button>
        </div>
      )}
      {storageError && (
        <p className="rp-notice" role="alert">
          Le navigateur ne permet pas de conserver les brouillons après un
          rechargement. Les règles appliquées et les copies confirmées sont
          enregistrées sur le serveur.
        </p>
      )}
      {workspace ? (
        <>
          {(saving || loading) && (
            <span className="rp-sr-only" role="status">
              {saving ? "Enregistrement…" : "Actualisation…"}
            </span>
          )}
          <Routes>
            <Route index element={<ReportsOverview workspace={workspace} />} />
            <Route path="import-airbnb" element={<OtaImportPage workspace={workspace} />} />
            <Route path="versements-a-dater" element={<UndatedPaymentsPage workspace={workspace} />} />
            <Route
              path="ventiler/:reservationId"
              element={<ReportAllocationEditor workspace={workspace} />}
            />
            <Route
              path="nouveau"
              element={<ReportEditor workspace={workspace} />}
            />
            <Route
              path=":reportId/modifier"
              element={<ReportEditor workspace={workspace} />}
            />
            <Route
              path=":reportId"
              element={<ReportDetail workspace={workspace} />}
            />
            <Route
              path="*"
              element={
                <div className="rp-empty">
                  <h1>Rapport introuvable</h1>
                  <Link to={workspace.href()}>Revenir aux rapports</Link>
                </div>
              }
            />
          </Routes>
        </>
      ) : loading ? (
        <p role="status">Chargement des rapports…</p>
      ) : null}
      {notice && (
        <div className="rp-toast" role="status">
          <ReportIcon name="check" />
          {notice}
          <button
            type="button"
            className="rp-icon-button"
            aria-label="Masquer la notification"
            onClick={() => setNotice("")}
          >
            <ReportIcon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
