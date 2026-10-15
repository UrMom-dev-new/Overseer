export interface LiveNewsFeed {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  url: string;
  channel_id: string | null;
  embed_allowed: boolean;
  category: string;
  language: string;
}

function youtube(id: string, name: string, city: string, country: string, lat: number, lng: number, channel: string, category = 'mainstream'): LiveNewsFeed {
  return { id, name, city, country, lat, lng, channel_id: channel,
    url: `https://www.youtube.com/channel/${channel}/live`, embed_allowed: true, category, language: 'en' };
}

// These are broadcaster references. Current live video and embedding permission
// are checked on launch; a catalog entry is not proof of working playback.
export const LIVE_NEWS_FEEDS: LiveNewsFeed[] = [
  youtube('nbcnews', 'NBC News NOW', 'New York', 'US', 40.759, -73.980, 'UCeY0bbntWzzVIaj2z3QigXg'),
  youtube('cbsnews', 'CBS News 24/7', 'New York', 'US', 40.764, -73.973, 'UC8p1vwvWtl6T73JiExfWs1g'),
  youtube('abcnews', 'ABC News Live', 'New York', 'US', 40.763, -73.979, 'UCBi2mrWuNuyYy4gbM6fU18Q'),
  youtube('bloomberg', 'Bloomberg TV', 'New York', 'US', 40.756, -73.988, 'UCIALMKvObZNtJ6AmdCLP7Lg', 'finance'),
  youtube('cspan', 'C-SPAN', 'Washington DC', 'US', 38.897, -77.036, 'UCb--64Gl51jIEVE-GLDAVTg', 'government'),
  youtube('cbc', 'CBC News', 'Toronto', 'CA', 43.644, -79.387, 'UCuFFtHWoLl5fauMMD5Ww2jA'),
  youtube('skynews', 'Sky News', 'London', 'GB', 51.500, -0.118, 'UCoMdktPbSTixAyNGwb-UYkQ'),
  youtube('france24en', 'France 24 EN', 'Paris', 'FR', 48.830, 2.280, 'UCQfwfsi5VrQ8yKZ-UWmAEFg'),
  youtube('dwnews', 'DW News', 'Berlin', 'DE', 52.508, 13.376, 'UCknLrEdhRCp1aegoMqRaCZg'),
  youtube('aljazeera', 'Al Jazeera EN', 'Doha', 'QA', 25.286, 51.534, 'UCNye-wNBqNL5ZzHSJj3l8Bg'),
  youtube('nhkworld', 'NHK World', 'Tokyo', 'JP', 35.690, 139.692, 'UCSPEjw8F2nQDtmUKPFNF7_A'),
  youtube('cna', 'CNA 24/7', 'Singapore', 'SG', 1.290, 103.852, 'UC83jt4dlz1Gjl58fzQrrKZg'),
  youtube('wion', 'WION', 'New Delhi', 'IN', 28.614, 77.209, 'UC_gUM8rL-Lrg6O3adPW9K1g'),
  youtube('cgtn', 'CGTN', 'Beijing', 'CN', 39.904, 116.407, 'UCgrNz-aDmcr2uuto8_DL2jg', 'state'),
  { id: 'rt', name: 'RT News', city: 'Moscow', country: 'RU', lat: 55.755, lng: 37.617,
    url: 'https://rumble.com/c/RTNewsEN', channel_id: null, embed_allowed: false, category: 'state', language: 'en' },
];

export function getLiveNewsFeed(id: string): LiveNewsFeed | undefined {
  return LIVE_NEWS_FEEDS.find((feed) => feed.id === id);
}
