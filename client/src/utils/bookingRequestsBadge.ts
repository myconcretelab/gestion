export const BOOKING_REQUESTS_CHANGED_EVENT = "booking-requests-changed";

export const dispatchBookingRequestsChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BOOKING_REQUESTS_CHANGED_EVENT));
};
