import { NextResponse } from 'next/server';

// Major stock exchange status
const EXCHANGES = [
  { name: 'NYSE', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'NASDAQ', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'LSE', tz: 'Europe/London', open: 8, close: 16.5, country: 'GB' },
  { name: 'TSE', tz: 'Asia/Tokyo', open: 9, close: 15, country: 'JP' },
  { name: 'SSE', tz: 'Asia/Shanghai', open: 9.5, close: 15, country: 'CN' },
  { name: 'HKEX', tz: 'Asia/Hong_Kong', open: 9.5, close: 16, country: 'HK' },
  { name: 'BSE', tz: 'Asia/Kolkata', open: 9.25, close: 15.5, country: 'IN' },
  { name: 'FRA', tz: 'Europe/Berlin', open: 8, close: 20, country: 'DE' },
  { name: 'TSX', tz: 'America/Toronto', open: 9.5, close: 16, country: 'CA' },
  { name: 'ASX', tz: 'Australia/Sydney', open: 10, close: 16, country: 'AU' },
  { name: 'KRX', tz: 'Asia/Seoul', open: 9, close: 15.5, country: 'KR' },
  { name: 'MOEX', tz: 'Europe/Moscow', open: 10, close: 18.5, country: 'RU' },
];

function isExchangeOpen(ex: typeof EXCHANGES[0]): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ex.tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    if (['Sat', 'Sun'].includes(weekday)) return false;
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const decimal = hour + minute / 60;
    return decimal >= ex.open && decimal < ex.close;
  } catch { return false; }
}

export async function GET() {
  try {
    const exchangeStatus = EXCHANGES.map(ex => ({
      name: ex.name, country: ex.country, open: isExchangeOpen(ex),
    }));

    return NextResponse.json({
      countries: [],
      country_risk_status: {
        availability: 'not_configured',
        dataState: 'unavailable',
        message: 'Synthetic country-risk scores were removed. Configure a real country-risk provider before emitting country risk records.',
      },
      alternate_sources: [
        { name: 'ReliefWeb API', url: 'https://api.reliefweb.int/v1/reports', note: 'Humanitarian reports; requires route-specific normalization.' },
        { name: 'GDACS', url: 'https://www.gdacs.org/xml/rss.xml', note: 'Disaster alerts; can support disaster-specific country indicators.' },
        { name: 'ACLED', url: 'https://acleddata.com/data-export-tool/', note: 'Conflict-event data; API access may require credentials.' },
      ],
      exchanges: exchangeStatus,
      open_exchanges: exchangeStatus.filter(e => e.open).length,
      total_exchanges: exchangeStatus.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ countries: [], exchanges: [], error: 'Failed' }, { status: 500 });
  }
}
