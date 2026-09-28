import { useEffect, useState, type CSSProperties } from "react";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, TEMPLATES, applyAppearance, readAppearance, saveAppearance, type Appearance } from "../utils/appearance";

function Dial({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="retro-dial">
    <span className="retro-dial__face" style={{ "--rotation": `${-135 + value * 2.7}deg` } as CSSProperties} aria-hidden="true"><span /></span>
    <span className="retro-dial__label">{label} <output>{value} %</output></span>
    <input type="range" min="0" max="100" value={value} onChange={event => onChange(Number(event.target.value))} aria-label={label} />
  </label>;
}
export default function AppearanceSettings() {
  const [saved, setSaved] = useState(readAppearance);
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) {
        const value = readAppearance(); setSaved(value); setDraft(value); setNotice("");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const update = (value: Partial<Appearance>) => { setDraft(current => ({ ...current, ...value })); setNotice(""); };
  const selectedTemplate = TEMPLATES.find(template => template.id === draft.template)!;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  return <section className="settings-cluster template-manager" aria-labelledby="template-title">
    <div className="settings-cluster__header"><div className="settings-cluster__eyebrow">Votre espace, votre style</div><h2 id="template-title">Templates d’apparence</h2><p>Choisissez une ambiance et réglez ses finitions. Ce choix est enregistré uniquement dans ce navigateur.</p></div>
    <div className="template-grid" role="group" aria-label="Choisir un template">
      {TEMPLATES.map(template => <button type="button" key={template.id} className={`template-option${draft.template === template.id ? " is-selected" : ""}`} aria-pressed={draft.template === template.id} onClick={() => update({ template: template.id })}>
        <span className={`template-swatch template-swatch--${template.id}`} aria-hidden="true"><span className="template-swatch__panel"><span className="template-swatch__line" /><span className="template-swatch__knobs"><i /><i /><i /></span></span></span>
        <span className="template-option__heading">{template.name}<span className="template-status">{saved.template === template.id ? "Actif" : draft.template === template.id ? "Sélectionné" : "Disponible"}</span></span><span className="template-option__description">{template.description}</span>
      </button>)}
    </div>
    <div className={`template-preview template-preview--${draft.template}`} style={{ "--wood-shade": draft.wood / 180, "--copper-light": `${78 - draft.copper * 0.22}%` } as CSSProperties}>
      <div className="template-preview__panel"><div className="template-preview__heading"><div><span className="template-preview__eyebrow">Aperçu · {selectedTemplate.name}</span><h3>Les beaux séjours</h3><p>Votre quotidien, avec un supplément de caractère.</p></div><span className="template-preview__led" aria-hidden="true" /></div>
        <div className="template-preview__stats"><div><small>Réservations</small><strong>24</strong></div><div><small>Occupation</small><strong>86 <small>%</small></strong></div><div><small>Prochaine arrivée</small><strong>14:00</strong></div></div>
        {draft.template === "retro" ? <div className="retro-controls"><Dial label="Profondeur du bois" value={draft.wood} onChange={wood => update({ wood })} /><Dial label="Patine du cuivre" value={draft.copper} onChange={copper => update({ copper })} /><p>Tournez l’ambiance à votre goût.<br />Réglages accessibles avec les curseurs ou les flèches du clavier.</p></div> : <p className="template-preview__caption">{selectedTemplate.description}</p>}
      </div>
    </div>
    <div className="template-actions"><button type="button" onClick={() => { const persisted = saveAppearance(draft); setSaved({ ...draft }); setNotice(persisted ? "Template appliqué et enregistré." : "Template appliqué pour cette session. Le navigateur ne permet pas de l’enregistrer."); }}>Appliquer le template</button><button type="button" className="secondary" disabled={!changed} onClick={() => { setDraft({ ...saved }); applyAppearance(saved); setNotice(""); }}>Annuler les modifications</button><button type="button" className="secondary" onClick={() => { setDraft({ ...DEFAULT_APPEARANCE }); setNotice("Réglages par défaut prêts à être appliqués."); }}>Réinitialiser</button></div>
    <p className="template-feedback" role="status">{notice || (changed ? "Modifications dans l’aperçu, en attente d’application." : "Le template actif est utilisé sur toutes les pages de votre espace.")}</p>
  </section>;
}
