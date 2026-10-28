/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@anjemin/legacy-api', 'pg'],
  outputFileTracingExcludes: {
    '/*': ['./server/data/**/*', './server/uploads/**/*', './.env', './.env.*', './.git/**/*', './node_modules/@electric-sql/pglite/**/*'],
  },
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    '/*': ['./client/index.html', './server/src/**/*.js', './server/certs/*.crt'],
  },
};

export default nextConfig;
