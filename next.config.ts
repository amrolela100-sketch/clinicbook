import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['*.e2b.app'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  devIndicators: false,
};
export default config;
