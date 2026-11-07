import { ImageResponse } from "next/og";

// Opaque app icon: three numbered tiles on a teal background.
// `inset` shrinks the artwork (maskable icons keep it inside the central 80%).
export function pwaIcon(px: number, inset = 1): ImageResponse {
  const s = px * inset;
  const tileW = s * 0.25;
  const tileH = s * 0.36;
  const gap = s * 0.04;
  const tiles = [
    { n: "7", c: "#dc2626", r: -8 },
    { n: "8", c: "#1d4ed8", r: 0 },
    { n: "9", c: "#111827", r: 8 },
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: px,
          height: px,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f766e",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap }}>
          {tiles.map((t) => (
            <div
              key={t.n}
              style={{
                width: tileW,
                height: tileH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fafaf9",
                borderRadius: tileW * 0.16,
                color: t.c,
                fontSize: tileH * 0.72,
                fontWeight: 800,
                transform: `rotate(${t.r}deg)`,
              }}
            >
              {t.n}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
