import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: '/analysis/dividend-low-vol',
        destination: 'https://hk-dividend-low-vol-lab.streamlit.app/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
