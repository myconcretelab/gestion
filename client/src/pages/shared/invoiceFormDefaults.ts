import {
  emptyInvoiceFiscalInput,
  type InvoiceFiscalInput,
} from "@contrats/shared";

// Defaults apply to new forms only; saved business identities and countries stay intact.
export const createInvoiceFormInput = (): InvoiceFiscalInput => {
  const input = emptyInvoiceFiscalInput();
  input.buyer.kind = "individual";
  input.buyer.country_code = "FR";
  return input;
};
