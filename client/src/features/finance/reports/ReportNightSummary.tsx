import { summarizeNightRegister, type NightRegister } from "@contrats/shared";

const count = (value: number | null) =>
  value === null ? "À compléter" : value.toLocaleString("fr-FR");
const money = (value: number | null) =>
  value === null
    ? "À compléter"
    : (value / 100).toLocaleString("fr-FR", {
        style: "currency",
        currency: "EUR",
      });

export default function ReportNightSummary({ data }: { data: NightRegister }) {
  const summary = data.summary ?? summarizeNightRegister(data);
  return (
    <div className="rp-night-summary">
      <h2>Synthèse pour la déclaration</h2>
      <p className="rp-muted">
        {data.period.label} · Une nuitée correspond à une personne pendant une
        nuit. Chaque séjour est compté une seule fois, même avec plusieurs
        perceptions.
      </p>
      <div
        className="rp-night-summary-scroll"
        role="region"
        aria-label="Synthèse des nuitées par gîte"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Gîte</th>
              <th scope="col">Nuitées personnes</th>
              <th scope="col">Taxables</th>
              <th scope="col">Mineurs exonérés</th>
              <th scope="col">Adultes exonérés</th>
              <th scope="col">Hors application</th>
              <th scope="col">Collectée par l’hébergeur</th>
              <th scope="col">Collectée par les plateformes</th>
              <th scope="col">Part hors taxes additionnelles</th>
              <th scope="col">Taxes additionnelles</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.propertyId}>
                <th scope="row">
                  {row.propertyName}
                  <small>
                    {row.stays} séjour(s)
                    {row.incompleteStays
                      ? ` · ${row.incompleteStays} à compléter`
                      : ""}
                  </small>
                </th>
                <td>{count(row.personNights)}</td>
                <td>{count(row.taxablePersonNights)}</td>
                <td>{count(row.exemptMinorPersonNights)}</td>
                <td>{count(row.exemptAdultPersonNights)}</td>
                <td>{count(row.nonApplicablePersonNights)}</td>
                <td>{money(row.hostCollectedCents)}</td>
                <td>{money(row.platformCollectedCents)}</td>
                <td>{money(row.baseCollectedCents)}</td>
                <td>{money(row.additionalCollectedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rp-muted">
        Les montants correspondent aux perceptions identifiées et affectées à
        cette période. « À compléter » signale une donnée inconnue ; une taxe
        calculée ne constitue pas une perception.
      </p>
    </div>
  );
}
