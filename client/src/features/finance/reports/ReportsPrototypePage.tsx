import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { canCurrentUserWritePage } from "../../../utils/auth";
import { createPrototypeState, type PrototypeState } from "./reportPrototype";
import { parsePrototypeState, PROTOTYPE_STORAGE_KEY } from "./prototypeStorage";
import { ReportDialog, ReportIcon } from "./ReportUi";
import ReportsOverview from "./ReportsOverview";
import ReportDetail from "./ReportDetail";
import ReportEditor from "./ReportEditor";
import ReportSourceEditor from "./ReportSourceEditor";
import "./reports.css";

export type ReportWorkspace = {
  state: PrototypeState;
  setState: Dispatch<SetStateAction<PrototypeState>>;
  month: string;
  setMonth: (month: string) => void;
  href: (path?: string) => string;
  canEdit: boolean;
  notify: (message: string) => void;
  storageError: boolean;
};

export default function ReportsPrototypePage() {
  const location = useLocation();
  const [state, setState] = useState(() => {
    try {
      return parsePrototypeState(sessionStorage.getItem(PROTOTYPE_STORAGE_KEY));
    } catch {
      return createPrototypeState();
    }
  });
  const [storageError, setStorageError] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [params, setParams] = useSearchParams();
  const candidate = params.get("periode") ?? "2026-10";
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(candidate)
    ? candidate
    : "2026-10";
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (Number(state.version) !== 2) {
      setState(parsePrototypeState(JSON.stringify(state)));
    }
  }, [state]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);
  useEffect(() => {
    try {
      sessionStorage.setItem(PROTOTYPE_STORAGE_KEY, JSON.stringify(state));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  if (Number(state.version) !== 2) {
    return <p role="status">Mise à jour des données de démonstration…</p>;
  }
  const workspace: ReportWorkspace = {
    state,
    setState,
    month,
    setMonth: (value) => {
      if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))
        setParams({ periode: value });
    },
    href: (path = "") => `/rapports${path}?periode=${month}`,
    canEdit: canCurrentUserWritePage("statistics"),
    notify,
    storageError,
  };
  return (
    <div className="reports-prototype">
      <aside className="rp-demo-banner" aria-label="Version de démonstration">
        <div>
          <span className="rp-demo-label">Aperçu interactif</span>
          <span>
            Données fictives · Modifications conservées dans cet onglet.
          </span>
        </div>
        <button
          type="button"
          className="rp-text-button"
          onClick={() => setResetOpen(true)}
          disabled={!workspace.canEdit}
        >
          Réinitialiser les exemples
        </button>
      </aside>
      {storageError && (
        <p className="rp-notice" role="alert">
          Les changements restent disponibles ici, mais ce navigateur ne permet
          pas de les conserver après un rechargement.
        </p>
      )}
      <Routes>
        <Route index element={<ReportsOverview workspace={workspace} />} />
        <Route
          path="corriger/:issueType/:sourceId"
          element={<ReportSourceEditor workspace={workspace} />}
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
      <footer className="rp-workspace-footer">
        <ReportIcon name="info" />
        <span>
          Démonstration uniquement · Aucun chiffre réel modifié · Aucune
          transmission externe
        </span>
      </footer>
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
      {resetOpen && (
        <ReportDialog
          title="Repartir des exemples initiaux ?"
          onClose={() => setResetOpen(false)}
        >
          <p>
            Les rapports, brouillons et corrections de démonstration de cet
            onglet seront réinitialisés.
          </p>
          <div className="rp-dialog__actions">
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={() => setResetOpen(false)}
            >
              Conserver mes essais
            </button>
            <button
              type="button"
              className="rp-button"
              onClick={() => {
                setState(createPrototypeState());
                setResetOpen(false);
                notify("Les exemples ont été réinitialisés.");
              }}
            >
              Réinitialiser
            </button>
          </div>
        </ReportDialog>
      )}
    </div>
  );
}
