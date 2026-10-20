import { useEffect, useRef, useState } from "react";

const steps = [
  { number: 1, label: "Client & séjour" },
  { number: 2, label: "Lignes & paiement" },
  { number: 3, label: "Enregistrer & vérifier" },
] as const;

export default function InvoiceFormHeader({ isEdit }: { isEdit: boolean }) {
  const headerRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(1);

  useEffect(() => {
    const header = headerRef.current;
    const form = header?.closest<HTMLElement>(".invoice-form");
    if (!header || !form) return;
    const topbar = form.closest(".app")?.querySelector<HTMLElement>(".topbar");
    const sections = Array.from(
      form.querySelectorAll<HTMLElement>("[data-invoice-step]"),
    );
    let frame = 0;

    const update = () => {
      frame = 0;
      form.style.setProperty(
        "--invoice-sticky-top",
        `${topbar?.getBoundingClientRect().height ?? 0}px`,
      );
      form.style.setProperty(
        "--invoice-header-height",
        `${header.getBoundingClientRect().height}px`,
      );
      const threshold = header.getBoundingClientRect().bottom + 24;
      let current = 1;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) {
          current = Number(section.dataset.invoiceStep);
        }
      }
      setActiveStep(current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    for (const element of [form, header, topbar, ...sections]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("scroll", scheduleUpdate, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      window.cancelAnimationFrame(frame);
      form.style.removeProperty("--invoice-sticky-top");
      form.style.removeProperty("--invoice-header-height");
    };
  }, []);

  const goToStep = (number: number) => {
    const section = headerRef.current
      ?.closest(".invoice-form")
      ?.querySelector<HTMLElement>(`[data-invoice-step="${number}"]`);
    if (!section) return;
    section.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    section.focus({ preventScroll: true });
  };

  return (
    <header className="invoice-form__intro" ref={headerRef}>
      <div>
        <span className="invoice-form__eyebrow">FACTURATION</span>
        <h2>{isEdit ? "Votre facture, en détail" : "Créons votre facture"}</h2>
      </div>
      <nav aria-label="Étapes de création de la facture">
        <ol className="invoice-form__steps">
          {steps.map(({ number, label }) => (
            <li key={number}>
              <button
                type="button"
                aria-current={activeStep === number ? "step" : undefined}
                onClick={() => goToStep(number)}
              >
                <span className="invoice-form__step-number" aria-hidden="true">
                  {number}
                </span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </header>
  );
}
