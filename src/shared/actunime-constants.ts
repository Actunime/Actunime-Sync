export type IListStatus =
  | 'WATCHING'
  | 'READING'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'DROPPED'
  | 'PLAN_TO_WATCH'
  | 'PLAN_TO_READ';

export const AnimeListStatusArray: IListStatus[] = [
  'WATCHING',
  'COMPLETED',
  'ON_HOLD',
  'DROPPED',
  'PLAN_TO_WATCH',
];

export const ListStatusLabels: Record<IListStatus, string> = {
  WATCHING: 'En cours de visionnage',
  READING: 'En cours de lecture',
  COMPLETED: 'Terminé',
  ON_HOLD: 'En pause',
  DROPPED: 'Abandonné',
  PLAN_TO_WATCH: 'Plannifié',
  PLAN_TO_READ: 'Plannifié',
};

export const AnimeFormatSelection = [
  { value: 'SERIE', label: 'Série', description: 'Diffusé en épisodes réguliers.' },
  {
    value: 'SERIE_COURTE',
    label: 'Série courte',
    description: 'Diffusé en épisodes courts, généralement moins de 15 minutes chacun.',
  },
  { value: 'FILM', label: 'Film', description: 'Produit comme un long métrage.' },
  { value: 'ONA', label: 'ONA', description: 'Diffusé directement sur Internet.' },
  { value: 'OVA', label: 'OVA', description: 'Destiné à la vente directe aux consommateurs.' },
  {
    value: 'SPECIAL',
    label: 'Spécial',
    description:
      "Un épisode unique ou une série d'épisodes qui ne fait pas partie de la diffusion régulière d'une série.",
  },
  { value: 'UNKNOWN', label: 'Inconnu', description: "Le format de l'anime est inconnu." },
];

export const CountrySelection = [
  { value: 'JAPAN', label: 'Japon', description: 'Manga japonais.' },
  { value: 'KOREA', label: 'Corée du Sud', description: 'Une bande dessinée coréenne.' },
  { value: 'CHINA', label: 'Chine', description: 'Une bande dessinée chinoise.' },
  { value: 'OTHER', label: 'Autre', description: "Le type de pays n'est pas disponible dans ceux proposées." },
];

export const MediaStatusSelection = [
  { value: 'AIRING', label: 'En cours', description: "L'anime est actuellement en cours de diffusion." },
  { value: 'PAUSED', label: 'En pause', description: "La diffusion de l'anime est temporairement interrompue." },
  { value: 'ENDED', label: 'Terminé', description: "L'anime a terminé sa diffusion." },
  { value: 'STOPPED', label: 'Arrêté', description: "La diffusion de l'anime a été arrêtée avant la fin prévue." },
  { value: 'POSTONED', label: 'Reporté', description: "La diffusion de l'anime a été reportée à une date ultérieure." },
  { value: 'SOON', label: 'Bientôt', description: "L'anime commencera à être diffusé prochainement." },
  { value: 'UNKNOWN', label: 'Inconnu', description: "Le statut de diffusion de l'anime est inconnu." },
];
