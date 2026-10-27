import type { TodayReservationClickAction } from "../../utils/todayWidgets";

export default function TodayReservationClickSetting({ value, onChange }: {
  value: TodayReservationClickAction;
  onChange: (value: TodayReservationClickAction) => void;
}) {
  return (
    <section className="today-reservation-click-setting">
      <label>
        <strong>Clic sur un rond de réservation (ordinateur)</strong>
        <select value={value} onChange={(event) => onChange(event.target.value === "reservation" ? "reservation" : "drawer")}>
          <option value="drawer">Ouvrir le panneau de détail</option>
          <option value="reservation">Ouvrir la page Réservations</option>
        </select>
      </label>
      <p>Le panneau permet de consulter le séjour sans quitter Aujourd’hui. Sur mobile, le clic conserve les actions habituelles.</p>
    </section>
  );
}
