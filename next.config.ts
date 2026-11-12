import type { NextConfig } from 'next';
const config: NextConfig = {
  // Demo browser tests must not reuse a production Webpack/type artifact.
  distDir: process.env.CLINICBOOK_NEXT_DIST_DIR ?? '.next',
  typescript: { tsconfigPath: process.env.CLINICBOOK_NEXT_TSCONFIG ?? 'tsconfig.json' },
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
