import { useEffect, useId, useState, type ComponentProps } from "react";
import { ReservationPaymentDetails, ReservationPaymentTile } from "./ReservationPaymentSummary";
import { formatEuro } from "../../utils/format";
import { getReservationOptionBadges } from "../../utils/reservationOptionBadges";
import { buildSmsHref, buildTelephoneHref } from "../../utils/sms";
import type { Reservation } from "../../utils/types";
import MobileReservationActionsBar from "./MobileReservationActionsBar";
import { GiteTasksButton, type GiteTaskSummary } from "./GiteTasksDrawer";

type ReservationInfo = Pick<Reservation, "id" | "date_entree" | "date_sortie" | "nb_nuits" | "prix_total" | "source_paiement"> &
  Partial<Pick<Reservation, "options" | "commentaire" | "telephone" | "airbnb_url" |
    "online_payment" | "linked_contract" | "remise_montant" | "frais_optionnels_montant" | "nb_adultes" | "nb_enfants_2_17" |
    "energy_consumption_kwh" | "energy_cost_eur" | "energy_live_consumption_kwh" | "energy_live_cost_eur">>;

type Props = Pick<ComponentProps<typeof MobileReservationActionsBar>,
  "open" | "title" | "onClose" | "onEdit" | "highlightedCard" | "sourcePicker"> & {
  reservation: ReservationInfo;
  total?: number;
  paymentLoading?: boolean;
  paymentError?: string | null;
  onToggleSource: () => void;
  giteId?: string | null;
  giteName?: string | null;
  onTasksChanged?: (summary: GiteTaskSummary) => void;
};

const formatShortDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", {
  day: "numeric", month: "short", timeZone: "UTC",
});

const MobileReservationInfoDrawer = ({
  reservation,
  total,
  paymentLoading,
  paymentError,
  onToggleSource,
  giteId,
  giteName,
  onTasksChanged,
  highlightedCard,
  ...props
}: Props) => {
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const paymentDetailsId = useId();
  useEffect(() => { setPaymentExpanded(false); }, [reservation.id, props.open]);
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
          value: "",
          content: <ReservationPaymentTile reservation={reservation} expanded={paymentExpanded}
            onToggle={() => setPaymentExpanded((current) => !current)} detailsId={paymentDetailsId}
            statusLabel={paymentLoading ? "Chargement…" : paymentError ? "Indisponible" : undefined} />,
        },
        ...(energyCost !== null ? [{ label: "Conso", value: formatEuro(energyCost) }] : []),
      ]}
      highlightedCard={paymentExpanded && !reservation.online_payment?.refunded_amount && reservation.online_payment?.status !== "requires_review" ? highlightedCard : undefined}
      paymentInfo={paymentExpanded ? paymentLoading || paymentError ? (
        <section id={paymentDetailsId} className="reservation-payment-details" aria-label="Détail du règlement">
          <p role="status">{paymentError || "Chargement des règlements…"}</p>
        </section>
      ) : <ReservationPaymentDetails reservation={reservation}
        detailsId={paymentDetailsId} monthlyTotal={total} onChangeSource={onToggleSource} /> : null}
      note={reservation.commentaire}
      phoneHref={buildTelephoneHref(reservation.telephone)}
      smsHref={buildSmsHref(reservation.telephone ?? "")}
      airbnbUrl={reservation.airbnb_url}
      tasksButton={giteId ? <GiteTasksButton
        giteId={giteId}
        giteName={giteName || "ce gîte"}
        reservationId={reservation.id}
        onChanged={onTasksChanged}
      /> : null}
    />
  );
};

export default MobileReservationInfoDrawer;
