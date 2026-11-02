import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ReportIcon } from "./ReportUi";

export default function ReportPageHeader({
  title,
  back,
  meta,
  status,
  actions,
  identity,
}: {
  title: string;
  back?: { to: string; label: string };
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  identity?: { name: string; label: string; detail?: string };
}) {
  return (
    <header
      className={`rp-page-header${back ? " rp-page-header--with-back" : ""}${identity ? " rp-page-header--identity" : ""}`}
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
          <div className="rp-heading-main">
            <div className="rp-heading-title">
              <h1>{title}</h1>
              {status}
            </div>
            {identity && (
              <div className="rp-heading-identity">
                <span className="rp-identity-avatar" aria-hidden="true">
                  {identity.name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </span>
                <div>
                  <span className="rp-identity-label">{identity.label}</span>
                  <strong className="rp-identity-name">{identity.name}</strong>
                  {identity.detail && (
                    <span className="rp-identity-detail">
                      {identity.detail}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {meta && <div className="rp-heading-meta">{meta}</div>}
      </div>
      {actions && <div className="rp-header-actions">{actions}</div>}
    </header>
  );
}
