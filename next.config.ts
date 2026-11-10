import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
