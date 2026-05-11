import { Router } from "express";
import path from "path";
import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { toNumber } from "../utils/money.js";

const router = Router();

const mapPublicPhotoUrl = (photo: { id: string; url: string }) =>
  photo.url.startsWith("/api/") ? `/api/public/gites/photos/${photo.id}` : photo.url;

const resolvePhotoContentType = (url: string) => {
  const extension = path.extname(url).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  return "application/octet-stream";
};

const sendPhotoFile = async (photo: { url: string }, res: any) => {
  if (!photo.url.startsWith("/api/")) {
    return res.redirect(photo.url);
  }
  const marker = "/file/";
  const markerIndex = photo.url.indexOf(marker);
  if (markerIndex < 0) {
    return res.status(404).json({ error: "Fichier photo introuvable" });
  }
  const relativePath = decodeURIComponent(photo.url.slice(markerIndex + marker.length));
  const absolutePath = path.join(process.cwd(), relativePath);
  res.setHeader("Content-Type", resolvePhotoContentType(relativePath));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.sendFile(absolutePath);
};

const mapPublicGite = (gite: any) => ({
  id: gite.id,
  ordre: gite.ordre,
  slug: gite.public_slug,
  name: gite.public_title || gite.nom,
  contract_name: gite.nom,
  prefix: gite.prefixe_contrat,
  summary: gite.public_summary,
  description: gite.public_description,
  technical_description: gite.public_technical_description,
  seo: {
    title: gite.public_seo_title,
    description: gite.public_seo_description,
  },
  capacity: {
    max_guests: gite.capacite_max,
    max_adults: gite.nb_adultes_max,
    usual_adults: gite.nb_adultes_habituel,
    max_children: gite.nb_enfants_max,
  },
  address: {
    line1: gite.adresse_ligne1,
    line2: gite.adresse_ligne2,
  },
  location: {
    latitude: gite.public_latitude === null || gite.public_latitude === undefined ? null : toNumber(gite.public_latitude),
    longitude: gite.public_longitude === null || gite.public_longitude === undefined ? null : toNumber(gite.public_longitude),
    info: fromJsonString<unknown>(gite.public_location_info, null),
  },
  structured_content: fromJsonString<unknown>(gite.public_structured_content, null),
  equipment: fromJsonString<unknown>(gite.public_equipment, null),
  rooms: fromJsonString<unknown>(gite.public_rooms, null),
  practical_info: fromJsonString<unknown>(gite.public_practical_info, null),
  characteristics: (gite.caracteristiques ?? "")
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean),
  rules: {
    pets_allowed: gite.regle_animaux_acceptes,
    first_firewood_included: gite.regle_bois_premiere_flambee,
  },
  default_times: {
    arrival: gite.heure_arrivee_defaut,
    departure: gite.heure_depart_defaut,
  },
  photos: Array.isArray(gite.photos)
    ? gite.photos.map((photo: any) => ({
        id: photo.id,
        url: mapPublicPhotoUrl(photo),
        title: photo.title,
        alt: photo.alt,
        credit: photo.credit,
        is_primary: photo.is_primary,
        ordre: photo.ordre,
      }))
    : [],
  updated_at: gite.updatedAt,
});

const publicGiteInclude = {
  photos: {
    where: { is_public: true },
    orderBy: [{ ordre: "asc" as const }, { createdAt: "asc" as const }],
  },
};

router.get("/photos/:photoId", async (req, res, next) => {
  try {
    const photo = await prisma.gitePhoto.findFirst({
      where: {
        id: req.params.photoId,
        is_public: true,
        gite: { public_is_published: true },
      },
      select: { url: true },
    });
    if (!photo) return res.status(404).json({ error: "Photo publique introuvable" });
    return sendPhotoFile(photo, res);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      where: {
        public_is_published: true,
        public_slug: { not: null },
      },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      include: publicGiteInclude,
    });
    res.json(gites.map(mapPublicGite));
  } catch (err) {
    next(err);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const gite = await prisma.gite.findFirst({
      where: {
        public_slug: req.params.slug,
        public_is_published: true,
      },
      include: publicGiteInclude,
    });
    if (!gite) return res.status(404).json({ error: "Gite public introuvable" });
    res.json(mapPublicGite(gite));
  } catch (err) {
    next(err);
  }
});

export default router;
