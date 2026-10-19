import { useState } from "react";
import ReservationDetailsDrawer from "../shared/ReservationDetailsDrawer";
import { TaskEditIcon } from "../shared/GiteTasksDrawer";
import { CategoryChoice, CategoryIcon, TaskIcon } from "./TaskIcons";
import type { Shortcut } from "./types";

type Props = {
  items: Shortcut[];
  busy: boolean;
  error: string | null;
  onSave: (items: Shortcut[]) => Promise<boolean>;
};
export default function TaskPresetsEditor({
  items,
  busy,
  error,
  onSave,
}: Props) {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Shortcut | null>(null);
  const [deleting, setDeleting] = useState(false);
  const existing = items.some((item) => item.key === editor?.key);
  const visible = items.filter((item) =>
    `${item.title} ${item.note}`
      .toLocaleLowerCase("fr")
      .includes(search.toLocaleLowerCase("fr")),
  );
  const openEditor = (item?: Shortcut) => {
    setDeleting(false);
    setEditor(
      item ?? {
        key: crypto.randomUUID(),
        title: "",
        category: "short",
        note: "",
        enabled: true,
      },
    );
  };
  const save = async () => {
    if (!editor) return;
    const next = existing
      ? items.map((item) => (item.key === editor.key ? editor : item))
      : [...items, editor];
    if (await onSave(next)) setEditor(null);
  };
  const move = (index: number, offset: number) => {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    void onSave(next);
  };

  return (
    <section className="tw-library">
      <div className="tw-section-heading">
        <div>
          <h2>Votre bibliothèque</h2>
          <p>
            Des raccourcis communs à tous vos gîtes, disponibles aussi depuis
            les réservations et les checks.
          </p>
        </div>
        <button
          className="tw-primary"
          type="button"
          disabled={busy || items.length >= 80}
          onClick={() => openEditor()}
        >
          <TaskIcon name="plus" />
          Nouveau raccourci
        </button>
      </div>
      <div className="tw-library-info">
        <TaskIcon name="presets" />
        <p>
          Une tâche préenregistrée se crée <strong>à la demande</strong>. Son
          titre, sa catégorie et ses consignes sont copiés dans une nouvelle
          tâche. Les tâches existantes restent inchangées.
        </p>
      </div>
      <div className="tw-toolbar">
        <label className="tw-search">
          <TaskIcon name="search" />
          <input
            type="search"
            placeholder="Chercher un raccourci…"
            aria-label="Chercher un raccourci"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span className="tw-muted">
          {items.filter((item) => item.enabled).length} actifs · {items.length}{" "}
          au total
        </span>
      </div>
      <div className="tw-preset-grid">
        {visible.map((item) => {
          const index = items.findIndex((entry) => entry.key === item.key);
          return (
            <article
              className={`tw-preset${item.enabled ? "" : " is-disabled"}`}
              key={item.key}
            >
              <div className="tw-preset-top">
                <span
                  className={`tw-category-icon tw-category-icon--${item.category}`}
                  title={
                    item.category === "short"
                      ? "Tâche rapide"
                      : "Tâche à long terme"
                  }
                >
                  <CategoryIcon category={item.category} />
                </span>
                <span
                  className={`tw-pill${item.enabled ? "" : " tw-pill--muted"}`}
                >
                  {item.enabled ? "Actif" : "Masqué"}
                </span>
                <button
                  className="tw-icon-button"
                  type="button"
                  disabled={busy}
                  aria-label={`Modifier le raccourci ${item.title}`}
                  onClick={() => openEditor(item)}
                >
                  <TaskEditIcon />
                </button>
              </div>
              <button
                className="tw-preset-title"
                type="button"
                onClick={() => openEditor(item)}
              >
                <h3>{item.title}</h3>
              </button>
              <p>{item.note || "Aucune consigne particulière."}</p>
              <div className="tw-preset-bottom">
                <div className="tw-order">
                  <button
                    type="button"
                    disabled={busy || index === 0 || Boolean(search)}
                    aria-label={`Monter ${item.title}`}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <span>{index + 1}</span>
                  <button
                    type="button"
                    disabled={
                      busy || index === items.length - 1 || Boolean(search)
                    }
                    aria-label={`Descendre ${item.title}`}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </div>
                <button
                  className="tw-text-button"
                  type="button"
                  disabled={busy || items.length >= 80}
                  onClick={() =>
                    openEditor({
                      ...item,
                      key: crypto.randomUUID(),
                      title: `${item.title.slice(0, 111)} (copie)`,
                    })
                  }
                >
                  Dupliquer
                </button>
                <button
                  className="tw-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onSave(
                      items.map((entry) =>
                        entry.key === item.key
                          ? { ...entry, enabled: !entry.enabled }
                          : entry,
                      ),
                    )
                  }
                >
                  {item.enabled ? "Masquer" : "Activer"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length ? (
        <div className="tw-empty">
          <TaskIcon name="presets" />
          <h3>
            {search ? "Aucun raccourci trouvé" : "Vos habitudes, en un geste"}
          </h3>
          <p>
            {search
              ? "Essayez un autre mot."
              : "Créez votre premier raccourci : savon, linge, petit entretien…"}
          </p>
        </div>
      ) : null}
      {editor ? (
        <ReservationDetailsDrawer
          open
          className="tw-form-drawer"
          eyebrow="Bibliothèque de tâches"
          title={existing ? "Modifier le raccourci" : "Nouveau raccourci"}
          busy={busy}
          onClose={() => setEditor(null)}
          footer={
            <>
              <button
                type="button"
                className="tw-secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Annuler
              </button>
              <button
                form="task-preset-form"
                type="submit"
                className="tw-primary"
                disabled={busy || editor.title.trim().length < 2}
              >
                {busy ? "Enregistrement…" : "Enregistrer"}
              </button>
            </>
          }
        >
          <form
            id="task-preset-form"
            className="tw-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {error ? (
              <p className="tw-error" role="alert">
                {error}
              </p>
            ) : null}
            <label>
              Nom de la tâche
              <input
                autoFocus
                required
                minLength={2}
                maxLength={120}
                placeholder="Ex. Apporter du savon à main"
                value={editor.title}
                onChange={(event) =>
                  setEditor({ ...editor, title: event.target.value })
                }
              />
            </label>
            <CategoryChoice
              value={editor.category}
              onChange={(category) => setEditor({ ...editor, category })}
            />
            <label>
              Consignes <span className="tw-optional">facultatif</span>
              <textarea
                rows={4}
                maxLength={2000}
                placeholder="Où trouver le matériel, points à vérifier…"
                value={editor.note}
                onChange={(event) =>
                  setEditor({ ...editor, note: event.target.value })
                }
              />
            </label>
            <label className="tw-check-label">
              <input
                type="checkbox"
                checked={editor.enabled}
                onChange={(event) =>
                  setEditor({ ...editor, enabled: event.target.checked })
                }
              />
              Disponible dans les ajouts rapides
            </label>
            <p className="tw-help">
              Ce raccourci ne crée aucune tâche automatiquement. Chaque
              utilisation laisse la tâche non attribuée, jusqu’au choix d’un
              intervenant.
            </p>
            {existing ? (
              <div className="tw-danger-zone">
                {deleting ? (
                  <>
                    <p>
                      Supprimer ce raccourci ? Les tâches déjà créées seront
                      conservées.
                    </p>
                    <button
                      className="tw-danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await onSave(
                            items.filter((item) => item.key !== editor.key),
                          )
                        )
                          setEditor(null);
                      }}
                    >
                      Confirmer la suppression
                    </button>
                    <button
                      className="tw-text-button"
                      type="button"
                      onClick={() => setDeleting(false)}
                    >
                      Le conserver
                    </button>
                  </>
                ) : (
                  <button
                    className="tw-text-button"
                    type="button"
                    onClick={() => setDeleting(true)}
                  >
                    Supprimer ce raccourci
                  </button>
                )}
              </div>
            ) : null}
          </form>
        </ReservationDetailsDrawer>
      ) : null}
    </section>
  );
}
