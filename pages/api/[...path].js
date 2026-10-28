// Keep the existing Node request/response handlers during the data migration.
// No body parser: existing upload, JSON, and webhook handlers consume the stream.
export const config = {
  api: { bodyParser: false, externalResolver: true, responseLimit: false },
};

export default async function handler(req, res) {
  // Local SQLite and uploaded files require a persistent filesystem.
  // Do not silently replace production storage with disposable /tmp data.
  if (process.env.VERCEL) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'Layanan belum tersedia. Silakan coba lagi nanti.',
      code: 'PERSISTENT_BACKEND_REQUIRED',
    });
  }
  const { handleRequest } = await import('@anjemin/legacy-api');
  return handleRequest(req, res);
}
