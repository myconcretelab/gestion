import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";
import { canCurrentUserManageIntegrations } from "../../utils/auth";

export default function SandboxWorkshopEntry() {
  const [available, setAvailable] = useState(false);
  const owner = canCurrentUserManageIntegrations();
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    apiFetch<{ available: boolean }>("/superpdp-workshop", {
      signal: controller.signal,
    })
      .then((result) => setAvailable(result.available))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, [owner]);
  return owner && available ? (
    <p>
      <Link className="secondary" to="/factures/test-superpdp">
        Ouvrir l’atelier de test SuperPDP
      </Link>
    </p>
  ) : null;
}
