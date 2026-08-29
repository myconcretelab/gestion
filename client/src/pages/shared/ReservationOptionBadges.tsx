import type { CSSProperties } from "react";
import type { ReservationOptionBadge } from "../../utils/reservationOptionBadges";

type ReservationOptionBadgesProps = {
  badges: ReservationOptionBadge[];
  layout?: "inline" | "orbit";
  className?: string;
};

const getOrbitPosition = (index: number, count: number) => {
  const angle = -90 + (index * 360) / Math.max(count, 1);
  const angleInRadians = (angle * Math.PI) / 180;
  const radius = 36;
  return {
    "--reservation-option-x": `${Math.cos(angleInRadians) * radius}px`,
    "--reservation-option-y": `${Math.sin(angleInRadians) * radius}px`,
  } as CSSProperties;
};

const ReservationOptionBadges = ({
  badges,
  layout = "inline",
  className,
}: ReservationOptionBadgesProps) => {
  if (badges.length === 0) return null;

  const labels = badges.map((badge) => `${badge.label}${badge.muted ? " (départ)" : ""}`).join(", ");

  return (
    <span
      className={[
        "reservation-option-badges",
        `reservation-option-badges--${layout}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Options : ${labels}`}
    >
      {badges.map((badge, index) => (
        <span
          key={`${badge.muted ? "departure" : "arrival"}-${badge.key}-${index}`}
          className={`reservation-option-badge${badge.muted ? " reservation-option-badge--muted" : ""}`}
          style={{
            "--reservation-option-color": badge.color,
            ...(layout === "orbit" ? getOrbitPosition(index, badges.length) : {}),
          } as CSSProperties}
          title={`${badge.label}${badge.muted ? " · départ" : ""}`}
          aria-hidden="true"
        >
          {badge.letter}
        </span>
      ))}
    </span>
  );
};

export default ReservationOptionBadges;
