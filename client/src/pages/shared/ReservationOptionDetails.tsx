import { getReservationOptionBadges } from "../../utils/reservationOptionBadges";
import type { ContratOptions } from "../../utils/types";
import ReservationOptionBadges from "./ReservationOptionBadges";

type Props = {
  options?: ContratOptions | null;
  fallbackLabel?: string;
};

export default function ReservationOptionDetails({ options, fallbackLabel }: Props) {
  const badges = getReservationOptionBadges(options);
  if (!badges.length) return <span>{fallbackLabel || "Aucune option"}</span>;

  return (
    <span className="reservation-option-details" role="list" aria-label="Options du séjour">
      {badges.map((badge) => {
        const option = options?.[badge.key];
        const quantity = badge.key === "draps"
          ? options?.draps?.nb_lits
          : badge.key === "linge_toilette"
            ? options?.linge_toilette?.nb_personnes
            : badge.key === "chiens"
              ? options?.chiens?.nb
              : undefined;
        return (
          <span className="reservation-option-details__item" role="listitem" key={badge.key}>
            <span aria-hidden="true">
              <ReservationOptionBadges badges={[badge]} />
            </span>
            <span>{badge.label}{quantity !== undefined ? ` ×${quantity}` : ""}</span>
            {option?.offert ? <span className="reservation-option-details__gift">offert</span> : null}
          </span>
        );
      })}
    </span>
  );
}
