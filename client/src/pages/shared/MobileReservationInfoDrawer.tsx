import type { ComponentProps } from "react";
import { formatEuro } from "../../utils/format";
import { getReservationOptionBadges } from "../../utils/reservationOptionBadges";
import { buildSmsHref, buildTelephoneHref } from "../../utils/sms";
import type { Reservation } from "../../utils/types";
import MobileReservationActionsBar from "./MobileReservationActionsBar";
import { isPlatformReservationSource } from "./reservationSources";

type ReservationInfo = Pick<Reservation, "date_entree" | "date_sortie" | "nb_nuits" | "prix_total" | "source_paiement"> &
  Partial<Pick<Reservation, "options" | "commentaire" | "telephone" | "airbnb_url" |
    "energy_consumption_kwh" | "energy_cost_eur" | "energy_live_consumption_kwh" | "energy_live_cost_eur">>;

type Props = Pick<ComponentProps<typeof MobileReservationActionsBar>,
  "open" | "title" | "onClose" | "onEdit" | "highlightedCard" | "sourcePicker"> & {
  reservation: ReservationInfo;
  total?: number;
  onToggleSource: () => void;
};

const formatShortDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", {
  day: "numeric", month: "short", timeZone: "UTC",
});

const MobileReservationInfoDrawer = ({ reservation, total, onToggleSource, ...props }: Props) => {
  const hasLiveEnergy = (reservation.energy_live_consumption_kwh ?? 0) > 0 || (reservation.energy_live_cost_eur ?? 0) > 0;
  const hasSavedEnergy = (reservation.energy_consumption_kwh ?? 0) > 0 || (reservation.energy_cost_eur ?? 0) > 0;
  const energyCost = hasLiveEnergy ? reservation.energy_live_cost_eur ?? 0
    : hasSavedEnergy ? reservation.energy_cost_eur ?? 0 : null;

  return (
    <MobileReservationActionsBar
      {...props}
      subtitle={`${formatShortDate(reservation.date_entree)} → ${formatShortDate(reservation.date_sortie)}`}
      optionBadges={getReservationOptionBadges(reservation.options)}
      details={[
        { label: "Durée", value: `${reservation.nb_nuits} nuit${reservation.nb_nuits > 1 ? "s" : ""}` },
        {
          label: "Total",
          value: formatEuro(total ?? reservation.prix_total, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
          ...(!isPlatformReservationSource(reservation.source_paiement) ? {
            ariaLabel: "Modifier la source ou le moyen de paiement",
            onClick: onToggleSource,
          } : {}),
        },
        ...(energyCost !== null ? [{ label: "Conso", value: formatEuro(energyCost) }] : []),
      ]}
      note={reservation.commentaire}
      phoneHref={buildTelephoneHref(reservation.telephone)}
      smsHref={buildSmsHref(reservation.telephone ?? "")}
      airbnbUrl={reservation.airbnb_url}
    />
  );
};

export default MobileReservationInfoDrawer;
