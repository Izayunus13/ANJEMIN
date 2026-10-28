import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const production = process.env.NODE_ENV === 'production';
  const configuredMode = process.env.PAYMENT_MODE || (production ? 'DISABLED' : 'SIMULATION');
  const validModes = ['SIMULATION', 'MIDTRANS_SANDBOX', 'MIDTRANS_LIVE', 'DISABLED'];
  const paymentMode = !validModes.includes(configuredMode) || (production && configuredMode === 'SIMULATION')
    ? 'DISABLED' : configuredMode;

  // Public configuration must not open SQLite or create upload directories.
  return NextResponse.json({
    brand: 'ANJEMIN',
    paymentMode,
    mapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
    mapsEnabled: true,
    mapProvider: 'openstreetmap',
    mapTileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    placesEnabled: Boolean(process.env.GOOGLE_PLACES_SERVER_KEY),
    mode: production ? 'production' : 'development',
    supportEmail: process.env.SUPPORT_EMAIL || '',
    supportWhatsapp: process.env.SUPPORT_WHATSAPP || '',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
