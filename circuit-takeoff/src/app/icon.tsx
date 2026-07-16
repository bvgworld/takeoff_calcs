import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#141E2C",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            border: "3px solid #2C64F2",
            borderRadius: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#F6F7FC",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "sans-serif",
          }}
        >
          C
        </div>
      </div>
    ),
    { ...size }
  );
}
