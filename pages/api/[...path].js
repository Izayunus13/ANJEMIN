// Existing authentication, authorization, JSON, upload, and webhook handlers are retained.
export const config = {
  maxDuration: 60,
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
};

export default async function handler(req, res) {
  try {
    const { handleRequest } = await import('@anjemin/legacy-api');
    return handleRequest(req, res);
  } catch (error) {
    console.error('[DATABASE INITIALIZATION]', error.code || error.name);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Koneksi database belum tersedia. Hubungi pengelola.' });
  }
}
