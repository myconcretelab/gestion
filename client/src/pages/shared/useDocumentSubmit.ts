import { useCallback } from "react";
import { apiFetch } from "../../utils/api";

export const useDocumentSubmit = <TDocument, TFieldKey extends string>(params: {
  endpointBase: string;
  id?: string;
  isEdit: boolean;
  canSubmit?: boolean;
  payload: unknown;
  payloadKey: string;
  getValidationFieldErrors: (error: unknown) => Partial<Record<TFieldKey, string>>;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  setFieldErrors: (value: Partial<Record<TFieldKey, string>>) => void;
  setCreatedDocument: (value: TDocument | null) => void;
  setCreatedPayloadKey: (value: string | null) => void;
  setEditingDocument?: (value: TDocument) => void;
  unknownErrorMessage: string;
}) =>
  useCallback(async () => {
    if (params.canSubmit === false) return;

    params.setSaving(true);
    params.setError(null);
    params.setFieldErrors({});
    params.setCreatedDocument(null);
    params.setCreatedPayloadKey(null);

    try {
      const endpoint = params.isEdit && params.id ? `${params.endpointBase}/${params.id}` : params.endpointBase;
      const method = params.isEdit ? "PUT" : "POST";
      const saved = await apiFetch<TDocument>(endpoint, {
        method,
        json: params.payload,
      });

      params.setCreatedDocument(saved);
      if (params.isEdit && params.setEditingDocument) params.setEditingDocument(saved);
      params.setCreatedPayloadKey(params.payloadKey);
    } catch (err: unknown) {
      const validationErrors = params.getValidationFieldErrors(err);
      const hasFieldErrors = Object.keys(validationErrors).length > 0;
      params.setFieldErrors(validationErrors);
      if (hasFieldErrors) {
        params.setError("Veuillez corriger les champs en erreur.");
      } else if (err instanceof Error) {
        params.setError(err.message);
      } else {
        params.setError(params.unknownErrorMessage);
      }
    } finally {
      params.setSaving(false);
    }
  }, [
    params.canSubmit,
    params.endpointBase,
    params.id,
    params.isEdit,
    params.payload,
    params.payloadKey,
    params.getValidationFieldErrors,
    params.setSaving,
    params.setError,
    params.setFieldErrors,
    params.setCreatedDocument,
    params.setCreatedPayloadKey,
    params.setEditingDocument,
    params.unknownErrorMessage,
  ]);
