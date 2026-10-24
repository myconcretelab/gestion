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
  bookingRequestApprovedOwner: {
    label: "Réservation confirmée après paiement · propriétaire",
    subject: "Réservation confirmée · {{clientName}} · {{giteName}}",
    body: "Une réservation a été confirmée automatiquement après paiement en ligne.\n\n{{clientDetails}}\n{{clientMessage}}\n\nGîte : {{giteName}}.\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}} · {{travellersSummary}}.\nTotal du séjour : {{totalGlobal}}.\n\n{{optionsSummary}}\n\n{{paymentSummary}}\n\nAucune approbation manuelle n’est nécessaire.\n{{requestReference}}",
  },
  bookingRequestRejected: {
    label: "Demande refusée · client",
    subject: "Votre demande n’a pas pu être retenue · {{giteName}}",
    body: "{{greeting}}\n\nVotre demande pour un séjour du {{dateEntreeLong}} au {{dateSortieLong}} n’a pas pu être retenue.\n\n{{decisionNote}}\n\nN’hésitez pas à nous contacter pour d’autres dates.\n\nBien cordialement",
  },
  bookingPaymentReceipt: {
    label: "Paiement d’une réservation existante · client",
    subject: "Paiement reçu pour votre réservation · {{giteName}}",
    body: "{{greeting}}\n\nVotre paiement par carte a bien été reçu et enregistré sur votre réservation.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}}.\nTotal du séjour : {{totalGlobal}}.\nOptions et frais : {{totalOptions}}.\n\n{{optionsSummary}}\n\n{{paymentSummary}}\n\n{{requestReference}}\n\nBien cordialement",
  },
  bookingPaymentReceiptOwner: {
    label: "Paiement d’une réservation existante · propriétaire",
    subject: "Paiement reçu · {{clientName}} · {{giteName}}",
    body: "Un paiement en ligne a été enregistré sur une réservation existante.\n\n{{clientDetails}}\n\nGîte : {{giteName}}.\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}} · {{travellersSummary}}.\nTotal du séjour : {{totalGlobal}}.\n\n{{optionsSummary}}\n\n{{paymentSummary}}\n\n{{requestReference}}",
  },
  bookingPaymentReview: {
    label: "Paiement à vérifier · client",
    subject: "Paiement reçu — suivi nécessaire · {{giteName}}",
    body: "{{greeting}}\n\nVotre paiement a été reçu mais nécessite une vérification. Nous vous contacterons rapidement. Aucun nouveau paiement n’est nécessaire.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}}.\n\n{{paymentSummary}}\n\n{{requestReference}}",
  },
  bookingPaymentReviewOwner: {
    label: "Paiement à vérifier · propriétaire",
    subject: "Paiement à vérifier · {{clientName}} · {{giteName}}",
    body: "Un paiement a été reçu mais nécessite une vérification dans Gestion.\n\n{{clientDetails}}\n\nGîte : {{giteName}}.\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}}.\nMontant reçu : {{paidAmount}}.\n\n{{paymentSummary}}\n\nContrôler le dossier et le règlement avant toute confirmation.\n{{requestReference}}",
  },
  bookingPaymentRefunded: {
    label: "Remboursement enregistré · client",
    subject: "Remboursement de votre réservation · {{giteName}}",
    body: "{{greeting}}\n\nUn remboursement de votre réservation a été enregistré.\n\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}}.\n\n{{paymentSummary}}\n\nContactez-nous pour faire le point sur le règlement de votre séjour.\n{{requestReference}}",
  },
  bookingPaymentRefundedOwner: {
    label: "Remboursement enregistré · propriétaire",
    subject: "Remboursement enregistré · {{clientName}} · {{giteName}}",
    body: "Un remboursement a été enregistré pour une réservation.\n\n{{clientDetails}}\n\nGîte : {{giteName}}.\nSéjour du {{dateEntreeLong}} au {{dateSortieLong}} · {{stayDuration}}.\n\n{{paymentSummary}}\n\nLe remboursement n’annule pas automatiquement le séjour. Le dossier reste consultable dans Gestion.\n{{requestReference}}",
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
