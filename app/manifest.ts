import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/mobile",
    name: "SIP Holdings Reader",
    short_name: "SIP Holdings",
    description: "Spring Investment Platform holdings and risk read-only app.",
    start_url: "/mobile/holdings",
    scope: "/mobile/",
    display: "standalone",
    background_color: "#f4ead6",
    theme_color: "#16352f",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/sip-ledger-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/sip-ledger-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/sip-ledger-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
