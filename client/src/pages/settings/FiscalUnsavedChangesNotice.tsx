export default function FiscalUnsavedChangesNotice({
  target,
  onCancel,
  onDiscard,
}: {
  target: "company" | "establishment";
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      className="fiscal-unsaved-notice"
      role="alert"
      aria-label="Modifications non enregistrées"
    >
      <h3>Conserver les modifications en cours ?</h3>
      <p>
        {target === "company"
          ? "Changer d’entreprise abandonnera les saisies non enregistrées de cette fiche, de ses établissements et des accès SuperPDP."
          : "Changer d’établissement abandonnera les saisies non enregistrées de cet établissement."}{" "}
        Vous pouvez aussi rester ici et enregistrer d’abord.
      </p>
      <div className="actions">
        <button type="button" autoFocus onClick={onCancel}>
          Rester et conserver mes saisies
        </button>
        <button type="button" className="secondary" onClick={onDiscard}>
          Abandonner et changer
        </button>
      </div>
    </section>
  );
}
