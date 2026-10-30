export function airbnbFixture(
  overrides: Record<string, string> = {},
  options: { resolution?: boolean; reference?: string; code?: string } = {},
) {
  const headers = [
    "Date",
    "Arrivée au plus tard le",
    "Type",
    "Code de confirmation",
    "Date de réservation",
    "Date de début",
    "Date de fin",
    "Nuits",
    "Voyageur",
    "Logement",
    "Détails",
    "Code de référence",
    "Devise",
    "Montant",
    "Versé",
    "Frais de service",
    "Frais de Versement sur carte bancaire",
    "Frais de ménage",
    "Revenus bruts",
    "Taxes reversées par Airbnb",
    "Année des revenus",
  ];
  const reference = options.reference ?? "TEST-PAYOUT-1",
    code = options.code ?? "HM12345678";
  const base = { Date: "10/31/2026", Devise: "EUR" };
  const rows: Array<Record<string, string>> = [
    {
      ...base,
      Type: "Payout",
      "Arrivée au plus tard le": "11/05/2026",
      "Code de référence": reference,
      Versé: options.resolution === false ? "85.00" : "100.00",
    },
    {
      ...base,
      Type: "Réservation",
      "Code de confirmation": code,
      "Date de réservation": "10/01/2026",
      "Date de début": "10/30/2026",
      "Date de fin": "11/03/2026",
      Nuits: "4",
      Voyageur: "Client Test",
      Logement: "Logement Test",
      Montant: "85.00",
      "Frais de service": "15,00",
      "Revenus bruts": "100.00",
      ...overrides,
    },
    ...(options.resolution === false
      ? []
      : [
          {
            ...base,
            Type: "Versement de résolution",
            "Code de confirmation": code,
            "Date de début": "10/30/2026",
            "Date de fin": "11/03/2026",
            Voyageur: "Client Test",
            Logement: "Logement Test",
            Montant: "15.00",
            "Revenus bruts": "15.00",
            Détails: "Demande d’argent : linge",
          },
        ]),
  ];
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((row) => row.map(quote).join(","))
    .join("\r\n");
}
