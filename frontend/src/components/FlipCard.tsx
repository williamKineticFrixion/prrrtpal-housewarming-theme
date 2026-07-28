// src/components/FlipCard.tsx
// A CSS 3D flip card.  Click/tap to flip from front to inside.
// Self-contained — all styles are inline so no separate CSS is needed.

import { useState } from "react";

interface FlipCardProps {
  front: React.ReactNode;   // card front face (SVG or image)
  inside: React.ReactNode;  // card inside face (SVG, message, audio)
  onClose: () => void;
  senderName?: string;
}

export function FlipCard({ front, inside, onClose, senderName }: FlipCardProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      onClick={() => setFlipped(!flipped)}
      style={{
        perspective: "1200px",
        width: "min(96vw, 860px)",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* flip hint */}
      {!flipped && (
        <p style={{ textAlign: "center", color: "#fff", fontWeight: 700, fontSize: 13, marginBottom: 10, opacity: .85 }}>
          Tap the card to open it 💌
        </p>
      )}

      {/* card container */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "8 / 5", // 320:200 — plays nicer on iPhone/iPad than the paddingBottom hack
          transformStyle: "preserve-3d",
          transition: "transform 0.7s cubic-bezier(.4,0,.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT face */}
        <div
          style={{
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 8px 40px rgba(0,0,0,.5)",
          }}
        >
          <div style={{ width: "100%", height: "100%" }}>{front}</div>
        </div>

        {/* INSIDE face */}
        <div
          style={{
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 8px 40px rgba(0,0,0,.5)",
            background: "#f8fafc",
          }}
          onClick={(e) => e.stopPropagation()} // stop re-flipping when interacting inside
        >
          <div style={{ width: "100%", height: "100%" }}>{inside}</div>
        </div>
      </div>

      {flipped && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          {senderName && (
            <p style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
              A card from {senderName} 💝
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
              style={{ padding: "6px 16px", borderRadius: 999, border: "none", background: "rgba(255,255,255,.2)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              ← Flip back
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ padding: "6px 16px", borderRadius: 999, border: "none", background: "#C96F4A", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              Close ✕
            </button>
          </div>
        </div>
      )}

      {!flipped && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ padding: "5px 14px", borderRadius: 999, border: "none", background: "rgba(255,255,255,.15)", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
          >
            Close ✕
          </button>
        </div>
      )}
    </div>
  );
}
