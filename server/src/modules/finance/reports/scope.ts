import type { ReportOperator, ReportProperty } from "@contrats/shared";
type ScopeGite = {
  id: string;
  nom: string;
  gestionnaire_id: string | null;
  fiscal_establishment: {
    fiscal_entity_id: string;
    fiscal_entity: { id: string; legal_name: string };
  } | null;
};
export function buildReportScope(
  gites: ScopeGite[],
  managerRows: Array<{ id: string; nom: string; prenom: string }>,
) {
  const managers = managerRows.map((row) => ({
    id: row.id,
    name: `${row.prenom} ${row.nom}`.trim(),
  }));
  const operators: ReportOperator[] = managerRows.map((row) => ({
    id: `manager:${row.id}`,
    name: `${row.prenom} ${row.nom}`.trim(),
    legacy: true,
  }));
  for (const gite of gites) {
    const entity = gite.fiscal_establishment?.fiscal_entity;
    if (entity && !operators.some((row) => row.id === entity.id))
      operators.push({ id: entity.id, name: entity.legal_name, legacy: false });
  }
  const properties: ReportProperty[] = gites.map((row) => ({
    id: row.id,
    name: row.nom,
    initials: row.nom
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join(""),
    operatorId:
      row.fiscal_establishment?.fiscal_entity_id ??
      (row.gestionnaire_id ? `manager:${row.gestionnaire_id}` : null),
    managerId: row.gestionnaire_id,
  }));
  return { managers, operators, properties };
}
