/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@anjemin/legacy-api'],
  outputFileTracingExcludes: {
    '/*': ['./server/data/**/*', './server/uploads/**/*', './.env', './.env.*', './.git/**/*'],
  },
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    '/*': ['./client/index.html'],
  },
};

export default nextConfig;
