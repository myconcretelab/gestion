import { useCallback, type Dispatch, type SetStateAction } from "react";

export const useDocumentFieldErrors = <TFieldKey extends string>(
  fieldErrors: Partial<Record<TFieldKey, string>>,
  setFieldErrors: Dispatch<SetStateAction<Partial<Record<TFieldKey, string>>>>
) => {
  const clearFieldError = useCallback(
    (field: TFieldKey) => {
      setFieldErrors((previous) => {
        if (!previous[field]) return previous;
        const next = { ...previous };
        delete next[field];
        return next;
      });
    },
    [setFieldErrors]
  );

  const getFieldClassName = useCallback(
    (field: TFieldKey, className = "field") => `${className}${fieldErrors[field] ? " field--error" : ""}`,
    [fieldErrors]
  );

  const renderFieldError = useCallback(
    (field: TFieldKey) => {
      const message = fieldErrors[field];
      if (!message) return null;
      return <div className="field-error">{message}</div>;
    },
    [fieldErrors]
  );

  return {
    clearFieldError,
    getFieldClassName,
    renderFieldError,
  };
};
