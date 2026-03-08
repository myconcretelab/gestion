type ImportedReservationType = "airbnb" | "personal";

export const DEFAULT_IMPORTED_RESERVATION_SOURCE = "A définir";
export const DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE = "Airbnb";

export const resolveImportedReservationSourceType = ({
  reservationType,
  mappedSourceType,
}: {
  reservationType: ImportedReservationType;
  mappedSourceType?: string | null;
}) => {
  if (reservationType !== "airbnb") {
    return DEFAULT_IMPORTED_RESERVATION_SOURCE;
  }

  const normalizedMappedSource =
    typeof mappedSourceType === "string" && mappedSourceType.trim().length > 0 ? mappedSourceType.trim() : null;

  return normalizedMappedSource ?? DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE;
};
