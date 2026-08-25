import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "STOR 24 Operations",
    short_name: "STOR 24",
    description: "Secure operations workspace for STOR 24 facilities.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F3EA",
    theme_color: "#071411",
    orientation: "any",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
