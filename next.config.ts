import type { NextConfig } from 'next';

const config: NextConfig = {
  // sharp is a native module; keep it out of the bundle.
  serverExternalPackages: ['sharp'],
  // Opened from the phone and the MacBook over Tailscale while developing.
  allowedDevOrigins: ['*.ts.net', '100.*.*.*'],
};

export default config;
