import type { TenantTransactionClient } from "../../db/prisma.js";
import { BookedValidationError } from "../../services/booked.js";

// A real database write takes the gîte row lock before checking and allocating dates.
// PostgreSQL serializes competing allocations; SQLite serializes writers.
export const lockBookingGite = async (
  tx: TenantTransactionClient,
  giteId: string,
) => {
  await tx.gite.update({
    where: { id: giteId },
    data: { updatedAt: new Date() },
  });
};
export const assertTransactionAvailability = async (
  tx: TenantTransactionClient,
  request: {
    gite_id: string;
    date_entree: Date;
    date_sortie: Date;
    id?: string;
  },
) => {
  const dates = {
    gite_id: request.gite_id,
    date_entree: { lt: request.date_sortie },
    date_sortie: { gt: request.date_entree },
  };
  const reservation = await tx.reservation.findFirst({
    where: dates,
    select: { id: true },
  });
  const otherRequest = await tx.bookingRequest.findFirst({
    where: {
      ...dates,
      status: "pending",
      hold_expires_at: { gt: new Date() },
      ...(request.id ? { NOT: { id: request.id } } : {}),
    },
    select: { id: true },
  });
  if (reservation || otherRequest)
    throw new BookedValidationError({
      statusCode: 409,
      code: "booking_conflict",
      message:
        "Ces dates ne sont plus disponibles. Choisissez un autre séjour.",
    });
};
