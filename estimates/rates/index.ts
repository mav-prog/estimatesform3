import type { RateCard } from '../engine';
import stucco from './stucco.json';
import eifs from './eifs.json';

/** Rate cards shipped with the app. Edits made in the app are stored on top of these. */
export const DEFAULT_RATE_CARDS: Record<string, RateCard> = {
  stucco: stucco as unknown as RateCard,
  eifs: eifs as unknown as RateCard,
};
