import { z } from "zod";

const IGN_SEARCH_URL = "https://data.geopf.fr/geocodage/search";
const SUGGESTION_LIMIT = 5;

const smallNumbers = [
  "", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix-sept", "dix-huit", "dix-neuf",
];
const tens = ["vingt", "trente", "quarante", "cinquante", "soixante"];

const spellHouseNumber = (number: number) => {
  if (number < 20) return smallNumbers[number];
  if (number === 80) return "quatre-vingts";
  if (number > 80) return `quatre-vingt-${smallNumbers[number - 80]}`;
  const ten = Math.min(Math.floor(number / 10) * 10, 60);
  const remainder = number - ten;
  const prefix = tens[ten / 10 - 2];
  if (!remainder) return prefix;
  return `${prefix}${remainder === 1 || remainder === 11 ? "-et-" : "-"}${smallNumbers[remainder]}`;
};

const houseNumbers = new Map(
  Array.from({ length: 99 }, (_, index) => [spellHouseNumber(index + 1), index + 1]),
);
const spelledNumberPrefix = /^([a-z]+(?:[- ][a-z]+){0,3}?)( (?:(?:bis|ter|quater) )?)(?=(?:rue|avenue|boulevard|impasse|allée|route|chemin|place|passage|quai|cours|square|sentier|voie)\s)/iu;

const normalizeAddressQuery = (query: string) => {
  const text = query.trim().replace(/\s+/g, " ");
  const prefix = text.match(spelledNumberPrefix);
  if (!prefix) return text;
  const number = houseNumbers.get(prefix[1].toLowerCase().replace(/ /g, "-"));
  return number ? `${number}${prefix[2]}${text.slice(prefix[0].length)}` : text;
};

const featureSchema = z.object({
  properties: z.object({
    name: z.string().trim().min(1).max(500),
    postcode: z.string().regex(/^\d{5}$/),
    city: z.string().trim().min(1).max(500),
    type: z.enum(["housenumber", "street", "locality"]),
  }),
});
const ignResponseSchema = z.object({ features: z.array(z.unknown()) });

export async function searchFrenchAddresses(query: string) {
  const text = normalizeAddressQuery(query);
  const url = new URL(IGN_SEARCH_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("index", "address");
  url.searchParams.set("limit", String(SUGGESTION_LIMIT));
  if (/^\d/.test(text)) url.searchParams.set("type", "housenumber");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error("Service d’adresses indisponible.");

  const { features } = ignResponseSchema.parse(await response.json());
  const suggestions = new Map<string, { address_line1: string; postal_code: string; city: string }>();
  for (const feature of features) {
    const parsed = featureSchema.safeParse(feature);
    if (!parsed.success) continue;
    const { name, postcode, city } = parsed.data.properties;
    suggestions.set(JSON.stringify([name, postcode, city]), {
      address_line1: name,
      postal_code: postcode,
      city,
    });
    if (suggestions.size >= SUGGESTION_LIMIT) break;
  }
  return [...suggestions.values()];
}
