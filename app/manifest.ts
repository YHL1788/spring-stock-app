import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SIP Holdings Reader",
    short_name: "SIP Holdings",
    description: "Spring Investment Platform holdings and risk read-only app.",
    start_url: "/mobile/holdings",
    scope: "/mobile",
    display: "standalone",
    background_color: "#f4ead6",
    theme_color: "#16352f",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/sip-ledger-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/sip-ledger-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
