import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import GitesPage from "./pages/GitesPage";
import ContratsListPage from "./pages/ContratsListPage";
import ContratFormPage from "./pages/ContratFormPage";
import ContratDetailPage from "./pages/ContratDetailPage";
import FacturesListPage from "./pages/FacturesListPage";
import FactureFormPage from "./pages/FactureFormPage";
import FactureDetailPage from "./pages/FactureDetailPage";

const App = () => {
  const location = useLocation();
  const isContratsSection =
    location.pathname === "/contrats" ||
    location.pathname.startsWith("/contrats/");
  const isFacturesSection =
    location.pathname === "/factures" ||
    location.pathname.startsWith("/factures/");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Contrats Gîtes</div>
        <nav className="nav">
          <NavLink
            to="/contrats"
            className={() => (isContratsSection ? "active" : undefined)}
            aria-current={isContratsSection ? "page" : undefined}
          >
            Contrats
          </NavLink>
          <NavLink
            to="/factures"
            className={() => (isFacturesSection ? "active" : undefined)}
            aria-current={isFacturesSection ? "page" : undefined}
          >
            Factures
          </NavLink>
          <NavLink to="/gites">Gîtes</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/contrats" replace />} />
          <Route path="/gites" element={<GitesPage />} />
          <Route path="/contrats" element={<ContratsListPage />} />
          <Route path="/contrats/nouveau" element={<ContratFormPage />} />
          <Route path="/contrats/:id/edition" element={<ContratFormPage />} />
          <Route path="/contrats/:id" element={<ContratDetailPage />} />
          <Route path="/factures" element={<FacturesListPage />} />
          <Route path="/factures/nouvelle" element={<FactureFormPage />} />
          <Route path="/factures/:id/edition" element={<FactureFormPage />} />
          <Route path="/factures/:id" element={<FactureDetailPage />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
