import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import GitesPage from "./pages/GitesPage";
import ContratsListPage from "./pages/ContratsListPage";
import ContratFormPage from "./pages/ContratFormPage";
import ContratDetailPage from "./pages/ContratDetailPage";

const App = () => {
  const location = useLocation();
  const isContratsSection =
    location.pathname === "/contrats" ||
    (location.pathname.startsWith("/contrats/") &&
      location.pathname !== "/contrats/nouveau");

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
          <NavLink to="/contrats/nouveau" end>
            Nouveau contrat
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
        </Routes>
      </main>
    </div>
  );
};

export default App;
