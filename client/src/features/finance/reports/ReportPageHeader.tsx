import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ReportIcon } from "./ReportUi";

export default function ReportPageHeader({
  title,
  back,
  meta,
  status,
  actions,
}: {
  title: string;
  back?: { to: string; label: string };
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      className={`rp-page-header${back ? " rp-page-header--with-back" : ""}`}
    >
      <div className="rp-heading">
        <div className="rp-heading-line">
          {back && (
            <Link
              className="rp-back-link"
              to={back.to}
              aria-label={back.label}
              title={back.label}
            >
              <ReportIcon name="back" />
            </Link>
          )}
          <div className="rp-heading-title">
            <h1>{title}</h1>
            {status}
          </div>
        </div>
        {meta && <div className="rp-heading-meta">{meta}</div>}
      </div>
      {actions && <div className="rp-header-actions">{actions}</div>}
    </header>
  );
}
