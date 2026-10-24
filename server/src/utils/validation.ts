import { z } from "zod";

/** A PATCH must leave absent fields untouched, even when the create schema supplies defaults. */
export const partialInputSchema = <Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
) => {
  const partial = schema.partial();
  const shape = { ...partial.shape };
  for (const key in schema.shape) {
    const field = schema.shape[key];
    if (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) {
      shape[key] = z.optional(
        field.unwrap(),
      ) as unknown as (typeof shape)[typeof key];
    }
  }
  return partial.extend(shape) as unknown as typeof partial;
};
