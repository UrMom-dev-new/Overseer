import type { LocationPrecision, LocationRelationship } from './types';

export interface PlaceDefinition {
  id: string;
  names: string[];
  lat: number;
  lng: number;
  precision: LocationPrecision;
  countryCode?: string;
  aliases?: string[];
}

export interface ResolvedLocation {
  coords: [number, number] | null;
  placeName: string | null;
  precision: LocationPrecision;
  relationship: LocationRelationship;
  method: string | null;
  qualityFlags: string[];
  matchedAliases: string[];
}

const PLACES: PlaceDefinition[] = [
  { id: 'kyiv-ua', names: ['kyiv', 'kiev'], lat: 50.45, lng: 30.523, precision: 'city', countryCode: 'UA' },
  { id: 'moscow-ru', names: ['moscow'], lat: 55.755, lng: 37.617, precision: 'city', countryCode: 'RU' },
  { id: 'gaza-ps', names: ['gaza', 'gaza city'], lat: 31.416, lng: 34.333, precision: 'city', countryCode: 'PS' },
  { id: 'beirut-lb', names: ['beirut'], lat: 33.893, lng: 35.502, precision: 'city', countryCode: 'LB' },
  { id: 'taipei-tw', names: ['taipei'], lat: 25.033, lng: 121.565, precision: 'city', countryCode: 'TW' },
  { id: 'tehran-ir', names: ['tehran'], lat: 35.689, lng: 51.389, precision: 'city', countryCode: 'IR' },
  { id: 'ukraine', names: ['ukraine'], lat: 49.487, lng: 31.272, precision: 'country', countryCode: 'UA' },
  { id: 'russia', names: ['russia', 'russian federation'], lat: 61.524, lng: 105.318, precision: 'country', countryCode: 'RU' },
  { id: 'israel', names: ['israel'], lat: 31.046, lng: 34.851, precision: 'country', countryCode: 'IL' },
  { id: 'iran', names: ['iran'], lat: 32.427, lng: 53.688, precision: 'country', countryCode: 'IR' },
  { id: 'lebanon', names: ['lebanon'], lat: 33.854, lng: 35.862, precision: 'country', countryCode: 'LB' },
  { id: 'syria', names: ['syria'], lat: 34.802, lng: 38.996, precision: 'country', countryCode: 'SY' },
  { id: 'yemen', names: ['yemen'], lat: 15.552, lng: 48.516, precision: 'country', countryCode: 'YE' },
  { id: 'china', names: ['china'], lat: 35.861, lng: 104.195, precision: 'country', countryCode: 'CN' },
  { id: 'taiwan', names: ['taiwan'], lat: 23.697, lng: 120.96, precision: 'country', countryCode: 'TW' },
  { id: 'united-states', names: ['united states', 'usa', 'u.s.', 'us'], lat: 38.907, lng: -77.036, precision: 'country', countryCode: 'US' },
  { id: 'middle-east', names: ['middle east'], lat: 31.5, lng: 34.8, precision: 'region' },
  { id: 'europe-region', names: ['europe'], lat: 48.8, lng: 2.3, precision: 'region' },
];

const EVENT_LOCATION_PATTERNS = [
  /\b(?:in|near|at|outside|around|from)\s+([a-z .'-]{2,40})\b/i,
  /\b([a-z .'-]{2,40})\s+(?:region|province|oblast|city)\b/i,
];

function wordRegex(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(term)}([^\\p{L}\\p{N}]|$)`, 'iu');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relationshipFor(text: string, matchedName: string): LocationRelationship {
  for (const pattern of EVENT_LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1] && wordRegex(matchedName).test(match[1])) return 'event_location';
  }
  return 'mentioned_location';
}

export function resolveTextLocation(text: string): ResolvedLocation {
  const haystack = ` ${text.toLowerCase()} `;
  const matches = PLACES.flatMap((place) =>
    place.names
      .filter((name) => wordRegex(name).test(haystack))
      .map((name) => ({ place, name }))
  );

  if (matches.length === 0) {
    return {
      coords: null,
      placeName: null,
      precision: 'unknown',
      relationship: 'unknown',
      method: null,
      qualityFlags: ['unresolved_location'],
      matchedAliases: [],
    };
  }

  const highestPrecision = matches.some((m) => m.place.precision === 'city')
    ? 'city'
    : matches.some((m) => m.place.precision === 'region')
      ? 'region'
      : 'country';

  const candidates = matches.filter((m) => m.place.precision === highestPrecision);
  const uniqueIds = new Set(candidates.map((m) => m.place.id));
  if (uniqueIds.size > 1) {
    return {
      coords: null,
      placeName: null,
      precision: 'unknown',
      relationship: 'unknown',
      method: 'keyword_alias_dictionary_v1',
      qualityFlags: ['ambiguous_location'],
      matchedAliases: candidates.map((m) => m.name),
    };
  }

  const selected = candidates[0];
  return {
    coords: [selected.place.lat, selected.place.lng],
    placeName: selected.place.names[0],
    precision: selected.place.precision,
    relationship: relationshipFor(haystack, selected.name),
    method: 'keyword_alias_dictionary_v1',
    qualityFlags: selected.place.precision === 'country' ? ['country_centroid_approximation'] : [],
    matchedAliases: [selected.name],
  };
}

