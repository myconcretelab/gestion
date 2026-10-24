/** Editable booking messages share the document email settings and variable syntax. */
export const bookingEmailTemplates = {
  bookingRequestReceived: {
    label: "Demande reçue · client",
    subject: "Demande reçue pour {{giteName}}",
    body: "{{greeting}}\n\nVotre demande de réservation a bien été reçue.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}} · {{travellersSummary}}.\nTotal estimatif : {{totalGlobal}}.\n\n{{optionsSummary}}\n\nNous vous répondrons après vérification. Les dates sont bloquées temporairement jusqu’au {{holdExpiresAt}}.\n\nBien cordialement",
  },
  bookingRequestOwner: {
    label: "Nouvelle demande · propriétaire",
    subject: "Nouvelle demande de réservation · {{giteName}}",
    body: "Une nouvelle demande de réservation a été enregistrée.\n\n{{clientDetails}}\n{{clientMessage}}\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}} · {{travellersSummary}}.\nTotal estimatif : {{totalGlobal}}.\n\n{{optionsSummary}}\n\nDates bloquées jusqu’au {{holdExpiresAt}}.\n{{requestReference}}",
  },
  bookingRequestRejected: {
    label: "Demande refusée · client",
    subject: "Votre demande n’a pas pu être retenue · {{giteName}}",
    body: "{{greeting}}\n\nVotre demande pour un séjour du {{dateEntreeLong}} au {{dateSortieLong}} n’a pas pu être retenue.\n\n{{decisionNote}}\n\nN’hésitez pas à nous contacter pour d’autres dates.\n\nBien cordialement",
  },
  bookingPaymentReceipt: {
    label: "Paiement d’une réservation existante",
    subject: "Paiement reçu pour votre réservation · {{giteName}}",
    body: "{{greeting}}\n\nVotre paiement par carte a bien été reçu et enregistré sur votre réservation.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}}.\nTotal du séjour : {{totalGlobal}}.\nOptions et frais : {{totalOptions}}.\n\n{{optionsSummary}}\n\n{{paymentSummary}}\n\n{{requestReference}}\n\nBien cordialement",
  },
  bookingPaymentReview: {
    label: "Paiement à vérifier",
    subject: "Paiement reçu — suivi nécessaire · {{giteName}}",
    body: "{{greeting}}\n\nVotre paiement a été reçu mais nécessite une vérification. Nous vous contacterons rapidement. Aucun nouveau paiement n’est nécessaire.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}}.\n\n{{paymentSummary}}\n\n{{requestReference}}",
  },
  bookingPaymentRefunded: {
    label: "Remboursement enregistré",
    subject: "Remboursement de votre réservation · {{giteName}}",
    body: "{{greeting}}\n\nUn remboursement de votre réservation a été enregistré.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}}.\n\n{{paymentSummary}}\n\nContactez-nous pour faire le point sur le règlement de votre séjour.\n{{requestReference}}",
  },
} as const;
export type BookingEmailTemplateKey = keyof typeof bookingEmailTemplates;
export const bookingEmailTemplateKeys = Object.keys(
  bookingEmailTemplates,
) as BookingEmailTemplateKey[];
export const defaultBookingEmailTextSettings = Object.fromEntries(
  bookingEmailTemplateKeys.map((key) => [
    key,
    {
      subject: bookingEmailTemplates[key].subject,
      body: bookingEmailTemplates[key].body,
    },
  ]),
) as Record<BookingEmailTemplateKey, { subject: string; body: string }>;
