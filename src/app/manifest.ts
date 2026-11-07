import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Remi",
    short_name: "Remi",
    description: "Remi pe tablă, jucat cu 1-3 prieteni pe telefon.",
    id: "/remi/",
    start_url: "/remi/",
    // "/" on purpose: leaving the game for the hub stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/remi/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/remi/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/remi/pwa-icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
