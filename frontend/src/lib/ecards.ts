// src/lib/ecards.ts
// Built-in ecard definitions for the Fontanez Family Housewarming.
// Each card has a front face and an inside face rendered as inline SVG
// (see components/ECardFaces.tsx). `animated` cards use CSS keyframes
// declared inside the SVG itself, so nothing external is needed.

export interface ECard {
  id: string;
  label: string;
  emoji: string;        // used in the picker grid
  animated: boolean;
  accent: string;       // dominant color for border / picker highlight
}

export const ECARDS: ECard[] = [
  { id: "golden-key",    label: "Golden Key",       emoji: "🔑", animated: true,  accent: "#D9A441" },
  { id: "welcome-mat",   label: "Welcome Mat",      emoji: "🚪", animated: false, accent: "#C96F4A" },
  { id: "houseplant",    label: "Housewarming Plant", emoji: "🪴", animated: true, accent: "#7C9A6D" },
  { id: "string-lights", label: "String Lights",    emoji: "💡", animated: true,  accent: "#E8B54D" },
  { id: "hearth",        label: "Cozy Hearth",      emoji: "🔥", animated: true,  accent: "#C0563B" },
  { id: "cheers",        label: "Cheers to Home",   emoji: "🥂", animated: true,  accent: "#D9A441" },
  { id: "moving-boxes",  label: "Moving Day",       emoji: "📦", animated: false, accent: "#9A6B4F" },
  { id: "wreath",        label: "Home Sweet Home",  emoji: "🏡", animated: false, accent: "#7C9A6D" },
  { id: "house-night",   label: "Evening Glow",     emoji: "🌙", animated: true,  accent: "#3E4C6E" },
  { id: "garden",        label: "Garden Blooms",    emoji: "🌸", animated: true,  accent: "#C98A8A" },
];
