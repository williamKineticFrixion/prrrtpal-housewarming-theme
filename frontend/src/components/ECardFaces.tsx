// src/components/ECardFaces.tsx
// Renders the front and inside faces of each built-in housewarming ecard as
// pure SVG. No external images or fonts — everything is self-contained so the
// cards work offline. Animations are CSS keyframes declared inside each SVG.

interface FaceProps { width?: number | string; height?: number | string; name?: string; }

/* ─── HELPERS ─────────────────────────────────────────────── */

// Inline <style> inside SVG — needed for CSS animations inside SVG
function SvgStyle({ css }: { css: string }) {
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const FULL = { width: "100%", height: "100%" } as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 200" style={FULL} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// Shared inside-face scaffold: warm paper, thin accent border, three text lines.
function Inside({ accent, line1, line2, line3, name }: { accent: string; line1: string; line2: string; line3: string; name?: string }) {
  return (
    <Frame>
      <rect width="320" height="200" fill="#FBF7F0" rx="12" />
      <rect x="8" y="8" width="304" height="184" fill="none" stroke={accent} strokeWidth="2" rx="9" opacity=".55" />
      <text x="160" y="62" textAnchor="middle" fontFamily="Georgia,serif" fontSize="15" fill="#3d3229">{line1.replace("{name}", name || "friends")}</text>
      <text x="160" y="92" textAnchor="middle" fontFamily="Georgia,serif" fontSize="12" fill="#7a6a5b">{line2}</text>
      <text x="160" y="110" textAnchor="middle" fontFamily="Georgia,serif" fontSize="12" fill="#7a6a5b">{line3}</text>
      <text x="160" y="146" textAnchor="middle" fontFamily="Georgia,serif" fontSize="11" fill="#a4917d">🏡 With love 🏡</text>
    </Frame>
  );
}

/* ─── 1. GOLDEN KEY ───────────────────────────────────────── */
export function GoldenKeyFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes keyturn { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(10deg)} }
        .key-swing { transform-origin:160px 60px; animation:keyturn 2.4s ease-in-out infinite; }
      `} />
      <rect width="320" height="200" fill="#2E2A24" rx="12" />
      <circle cx="160" cy="100" r="72" fill="#3B352C" />
      <g className="key-swing">
        <circle cx="160" cy="66" r="20" fill="none" stroke="#D9A441" strokeWidth="9" />
        <rect x="155" y="84" width="10" height="58" fill="#D9A441" rx="4" />
        <rect x="160" y="120" width="18" height="8" fill="#D9A441" rx="2" />
        <rect x="160" y="132" width="13" height="8" fill="#D9A441" rx="2" />
      </g>
      <text x="160" y="172" textAnchor="middle" fontFamily="Georgia,serif" fontSize="17" fontWeight="bold" fill="#F3E3C3">THE KEY TO HAPPINESS?</text>
      <text x="160" y="190" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fill="#D9A441">A home filled with people you love.</text>
    </Frame>
  );
}
export function GoldenKeyInside({ name }: FaceProps) {
  return <Inside accent="#D9A441" name={name} line1="🔑  Congratulations, {name}!" line2="May every door in this house" line3="open onto something wonderful." />;
}

/* ─── 2. WELCOME MAT ──────────────────────────────────────── */
export function WelcomeMatFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <rect width="320" height="200" fill="#EFE6D8" rx="12" />
      {/* door */}
      <rect x="112" y="18" width="96" height="128" fill="#C96F4A" rx="6" />
      <rect x="122" y="28" width="76" height="50" fill="#B25E3C" rx="4" />
      <rect x="122" y="86" width="76" height="50" fill="#B25E3C" rx="4" />
      <circle cx="192" cy="86" r="4" fill="#D9A441" />
      {/* mat */}
      <rect x="94" y="152" width="132" height="30" fill="#7C9A6D" rx="5" />
      <rect x="99" y="157" width="122" height="20" fill="none" stroke="#EFE6D8" strokeWidth="2" rx="3" />
      <text x="160" y="172" textAnchor="middle" fontFamily="Georgia,serif" fontSize="14" fontWeight="bold" fill="#FBF7F0">WELCOME HOME</text>
      {/* potted plants flanking */}
      <rect x="60" y="120" width="26" height="26" fill="#C96F4A" rx="3" />
      <circle cx="73" cy="108" r="16" fill="#7C9A6D" />
      <rect x="234" y="120" width="26" height="26" fill="#C96F4A" rx="3" />
      <circle cx="247" cy="108" r="16" fill="#7C9A6D" />
    </Frame>
  );
}
export function WelcomeMatInside({ name }: FaceProps) {
  return <Inside accent="#C96F4A" name={name} line1="🚪  Welcome home, {name}!" line2="May your doormat wear out" line3="from all the friends stopping by." />;
}

/* ─── 3. HOUSEPLANT ───────────────────────────────────────── */
export function HouseplantFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes sway { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
        .leafL { transform-origin:160px 128px; animation:sway 3s ease-in-out infinite; }
        .leafR { transform-origin:160px 128px; animation:sway 3s ease-in-out infinite reverse; }
      `} />
      <rect width="320" height="200" fill="#F4EFE4" rx="12" />
      <circle cx="160" cy="100" r="80" fill="#EAE2CF" />
      {/* pot */}
      <path d="M132 138 h56 l-7 44 h-42 z" fill="#C96F4A" />
      <rect x="126" y="130" width="68" height="12" fill="#B25E3C" rx="4" />
      {/* leaves */}
      <g className="leafL">
        <path d="M160 132 C120 110 112 70 126 48 C150 62 162 96 160 132" fill="#7C9A6D" />
        <path d="M160 132 C136 112 128 88 134 70" stroke="#5F7B52" strokeWidth="2.5" fill="none" />
      </g>
      <g className="leafR">
        <path d="M160 132 C200 110 208 70 194 48 C170 62 158 96 160 132" fill="#8FAC7E" />
        <path d="M160 132 C184 112 192 88 186 70" stroke="#5F7B52" strokeWidth="2.5" fill="none" />
      </g>
      <path d="M160 132 C158 96 158 66 160 40 C162 66 162 96 160 132" fill="#6B8A5C" />
      <text x="160" y="196" textAnchor="middle" fontFamily="Georgia,serif" fontSize="14" fontWeight="bold" fill="#5F7B52">GROW SOMETHING GOOD HERE 🌱</text>
    </Frame>
  );
}
export function HouseplantInside({ name }: FaceProps) {
  return <Inside accent="#7C9A6D" name={name} line1="🪴  Happy housewarming, {name}!" line2="May your plants thrive and" line3="your roots grow deep here." />;
}

/* ─── 4. STRING LIGHTS ────────────────────────────────────── */
export function StringLightsFront({ name: _n }: FaceProps) {
  const bulbs = [40, 80, 120, 160, 200, 240, 280];
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes bulb { 0%,100%{opacity:.35} 50%{opacity:1} }
        .b0{animation:bulb 1.8s ease-in-out infinite}
        .b1{animation:bulb 1.8s ease-in-out .6s infinite}
        .b2{animation:bulb 1.8s ease-in-out 1.2s infinite}
      `} />
      <rect width="320" height="200" fill="#2B2C3D" rx="12" />
      <path d="M10 46 Q160 96 310 46" stroke="#171826" strokeWidth="3" fill="none" />
      {bulbs.map((x, i) => {
        const y = 46 + Math.round(50 * Math.sin(Math.PI * (x - 10) / 300));
        return (
          <g key={x} className={`b${i % 3}`}>
            <circle cx={x} cy={y + 14} r="9" fill="#F6CE6B" />
            <circle cx={x} cy={y + 14} r="15" fill="#F6CE6B" opacity=".25" />
            <rect x={x - 3} y={y} width="6" height="7" fill="#4A4B5E" rx="1" />
          </g>
        );
      })}
      <text x="160" y="140" textAnchor="middle" fontFamily="Georgia,serif" fontSize="20" fontWeight="bold" fill="#F6E7C6">MAY YOUR HOME</text>
      <text x="160" y="166" textAnchor="middle" fontFamily="Georgia,serif" fontSize="20" fontWeight="bold" fill="#E8B54D">ALWAYS GLOW</text>
    </Frame>
  );
}
export function StringLightsInside({ name }: FaceProps) {
  return <Inside accent="#E8B54D" name={name} line1="💡  Shine on, {name}!" line2="Wishing you bright evenings" line3="and warm light in every window." />;
}

/* ─── 5. COZY HEARTH ──────────────────────────────────────── */
export function HearthFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes flick { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.18) skewX(-3deg)} }
        .flame { transform-origin:160px 128px; animation:flick 1.1s ease-in-out infinite; }
        .flame2 { transform-origin:160px 128px; animation:flick 1.1s ease-in-out .4s infinite; }
      `} />
      <rect width="320" height="200" fill="#3A2E28" rx="12" />
      {/* brick surround */}
      <rect x="86" y="26" width="148" height="128" fill="#8A5844" rx="6" />
      <rect x="104" y="44" width="112" height="92" fill="#241B16" rx="4" />
      <rect x="80" y="16" width="160" height="14" fill="#5F4032" rx="4" />
      {/* fire */}
      <g className="flame"><path d="M160 128 C140 108 146 86 160 68 C174 86 180 108 160 128" fill="#E07A3F" /></g>
      <g className="flame2"><path d="M160 126 C150 112 154 98 160 86 C166 98 170 112 160 126" fill="#F3B65C" /></g>
      <rect x="118" y="128" width="84" height="9" fill="#5F4032" rx="4" />
      <text x="160" y="182" textAnchor="middle" fontFamily="Georgia,serif" fontSize="16" fontWeight="bold" fill="#F3D9B8">KEEP THE HOME FIRES BURNING 🔥</text>
    </Frame>
  );
}
export function HearthInside({ name }: FaceProps) {
  return <Inside accent="#C0563B" name={name} line1="🔥  Stay cozy, {name}!" line2="May this house keep you warm" line3="in every season of life." />;
}

/* ─── 6. CHEERS TO HOME ───────────────────────────────────── */
export function CheersFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes rise { 0%{transform:translateY(0);opacity:.9} 100%{transform:translateY(-46px);opacity:0} }
        .bub0{animation:rise 2.2s linear infinite}
        .bub1{animation:rise 2.2s linear .7s infinite}
        .bub2{animation:rise 2.2s linear 1.4s infinite}
      `} />
      <rect width="320" height="200" fill="#F7F0E2" rx="12" />
      {/* glasses */}
      <g stroke="#C7A66B" strokeWidth="4" fill="#FDF8EC">
        <path d="M118 60 L142 60 L138 104 C138 116 122 116 122 104 Z" />
        <line x1="130" y1="112" x2="130" y2="146" />
        <line x1="116" y1="148" x2="144" y2="148" />
        <path d="M178 60 L202 60 L198 104 C198 116 182 116 182 104 Z" transform="rotate(8 190 100)" />
        <line x1="192" y1="114" x2="198" y2="146" />
        <line x1="184" y1="149" x2="212" y2="145" />
      </g>
      <path d="M120 64 L140 64 L138 88 C138 94 124 94 124 88 Z" fill="#E8B54D" opacity=".8" />
      <path d="M180 63 L200 66 L196 90 C195 96 182 94 183 88 Z" fill="#E8B54D" opacity=".8" />
      {[0, 1, 2].map((i) => (
        <g key={i} className={`bub${i}`}>
          <circle cx={128 + i * 6} cy={70} r="2.5" fill="#D9A441" />
          <circle cx={186 + i * 5} cy={72} r="2" fill="#D9A441" />
        </g>
      ))}
      <text x="160" y="40" textAnchor="middle" fontFamily="Georgia,serif" fontSize="20" fontWeight="bold" fill="#B08331">CHEERS!</text>
      <text x="160" y="180" textAnchor="middle" fontFamily="Georgia,serif" fontSize="15" fontWeight="bold" fill="#8A6A2E">To the new place & the people in it 🥂</text>
    </Frame>
  );
}
export function CheersInside({ name }: FaceProps) {
  return <Inside accent="#D9A441" name={name} line1="🥂  A toast to you, {name}!" line2="To full glasses, full plates," line3="and a full house of friends." />;
}

/* ─── 7. MOVING DAY ───────────────────────────────────────── */
export function MovingBoxesFront({ name: _n }: FaceProps) {
  return (
    <Frame>
      <rect width="320" height="200" fill="#EFE8DC" rx="12" />
      {/* stacked boxes */}
      <g stroke="#7E5A41" strokeWidth="2.5">
        <rect x="70" y="112" width="86" height="66" fill="#B98A63" rx="3" />
        <line x1="70" y1="140" x2="156" y2="140" />
        <rect x="164" y="126" width="76" height="52" fill="#C79A72" rx="3" />
        <rect x="102" y="52" width="78" height="56" fill="#C79A72" rx="3" />
        <line x1="102" y1="76" x2="180" y2="76" />
      </g>
      {/* tape */}
      <rect x="108" y="50" width="66" height="8" fill="#E8DDC8" transform="rotate(2 141 54)" />
      <text x="113" y="98" fontFamily="Georgia,serif" fontSize="12" fontWeight="bold" fill="#5F4632">FRAGILE</text>
      <text x="80" y="166" fontFamily="Georgia,serif" fontSize="12" fontWeight="bold" fill="#5F4632">KITCHEN</text>
      <text x="172" y="158" fontFamily="Georgia,serif" fontSize="12" fontWeight="bold" fill="#5F4632">BOOKS</text>
      {/* heart escaping a box */}
      <path d="M206 106 c-5 -9 8 -15 10 -5 c2 -10 15 -4 10 5 c-4 7 -10 10 -10 10 s-6 -3 -10 -10" fill="#C98A8A" />
      <text x="160" y="34" textAnchor="middle" fontFamily="Georgia,serif" fontSize="17" fontWeight="bold" fill="#7E5A41">HOME IS WHERE THE BOXES ARE 📦</text>
    </Frame>
  );
}
export function MovingBoxesInside({ name }: FaceProps) {
  return <Inside accent="#9A6B4F" name={name} line1="📦  You made it, {name}!" line2="May the boxes unpack quickly" line3="and the memories stack high." />;
}

/* ─── 8. HOME SWEET HOME WREATH ───────────────────────────── */
export function WreathFront({ name: _n }: FaceProps) {
  const leaves = Array.from({ length: 14 }, (_, i) => (i * 360) / 14);
  return (
    <Frame>
      <rect width="320" height="200" fill="#FBF4E9" rx="12" />
      <g transform="translate(160 100)">
        {leaves.map((a) => (
          <g key={a} transform={`rotate(${a}) translate(0 -62)`}>
            <ellipse rx="7" ry="15" fill={a % 51 < 26 ? "#7C9A6D" : "#8FAC7E"} />
          </g>
        ))}
        {[30, 150, 270].map((a) => (
          <g key={a} transform={`rotate(${a}) translate(0 -62)`}>
            <circle r="5" fill="#C98A8A" />
          </g>
        ))}
      </g>
      <text x="160" y="92" textAnchor="middle" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#5F4632">HOME</text>
      <text x="160" y="112" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fill="#8A6A5B">sweet</text>
      <text x="160" y="132" textAnchor="middle" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#5F4632">HOME</text>
    </Frame>
  );
}
export function WreathInside({ name }: FaceProps) {
  return <Inside accent="#7C9A6D" name={name} line1="🏡  Home sweet home, {name}!" line2="May these walls know laughter" line3="and every room feel like yours." />;
}

/* ─── 9. EVENING GLOW ─────────────────────────────────────── */
export function HouseNightFront({ name: _n }: FaceProps) {
  const stars = [[30, 26], [66, 14], [255, 20], [288, 40], [200, 12], [110, 20]];
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes tw { 0%,100%{opacity:.25} 50%{opacity:1} }
        @keyframes windowglow { 0%,100%{fill:#F6CE6B} 50%{fill:#FBE3A3} }
        .st{animation:tw 2.6s ease-in-out infinite}
        .win{animation:windowglow 2.2s ease-in-out infinite}
      `} />
      <rect width="320" height="200" fill="#232A40" rx="12" />
      {stars.map(([x, y], i) => <circle key={i} className="st" cx={x} cy={y} r="2" fill="#fff" style={{ animationDelay: `${i * 0.4}s` }} />)}
      <circle cx="272" cy="46" r="17" fill="#F3E9C8" />
      <circle cx="266" cy="42" r="14" fill="#232A40" opacity=".35" />
      {/* hill + house */}
      <ellipse cx="160" cy="215" rx="200" ry="70" fill="#2E3A57" />
      <rect x="112" y="96" width="96" height="66" fill="#4A3B35" rx="3" />
      <path d="M102 98 L160 58 L218 98 Z" fill="#5F4A40" />
      <rect x="126" y="112" width="20" height="22" className="win" rx="2" />
      <rect x="174" y="112" width="20" height="22" className="win" rx="2" style={{ animationDelay: ".8s" }} />
      <rect x="150" y="126" width="20" height="36" fill="#3A2E28" rx="2" />
      <rect x="188" y="66" width="10" height="24" fill="#4A3B35" />
      <text x="160" y="188" textAnchor="middle" fontFamily="Georgia,serif" fontSize="14" fontWeight="bold" fill="#D9C79A">THE LIGHTS ARE ON — YOU'RE HOME 🌙</text>
    </Frame>
  );
}
export function HouseNightInside({ name }: FaceProps) {
  return <Inside accent="#3E4C6E" name={name} line1="🌙  Sweet dreams, {name}!" line2="May every evening end with" line3="a warm light in the window." />;
}

/* ─── 10. GARDEN BLOOMS ───────────────────────────────────── */
export function GardenFront({ name: _n }: FaceProps) {
  const flowers = [[60, 150, "#C98A8A"], [110, 162, "#D9A441"], [160, 150, "#C96F4A"], [210, 164, "#C98A8A"], [262, 152, "#D9A441"]] as const;
  return (
    <Frame>
      <SvgStyle css={`
        @keyframes bloomsway { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
        .fl{animation:bloomsway 3.4s ease-in-out infinite}
      `} />
      <rect width="320" height="200" fill="#F2F0E4" rx="12" />
      <rect x="0" y="168" width="320" height="32" fill="#8FAC7E" />
      {flowers.map(([x, y, c], i) => (
        <g key={i} className="fl" style={{ transformOrigin: `${x}px ${y + 20}px`, animationDelay: `${i * 0.35}s` }}>
          <line x1={x} y1={y} x2={x} y2={y + 24} stroke="#6B8A5C" strokeWidth="3" />
          <ellipse cx={x - 7} cy={y + 15} rx="7" ry="4" fill="#7C9A6D" transform={`rotate(-30 ${x - 7} ${y + 15})`} />
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx={x} cy={y - 10} rx="6" ry="10" fill={c} transform={`rotate(${a} ${x} ${y})`} />
          ))}
          <circle cx={x} cy={y} r="5.5" fill="#F3D9B8" />
        </g>
      ))}
      <text x="160" y="46" textAnchor="middle" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#5F7B52">BLOOM WHERE</text>
      <text x="160" y="70" textAnchor="middle" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#B0724F">YOU'RE PLANTED 🌸</text>
    </Frame>
  );
}
export function GardenInside({ name }: FaceProps) {
  return <Inside accent="#C98A8A" name={name} line1="🌸  Congratulations, {name}!" line2="May your garden flourish and" line3="your home bloom with joy." />;
}

/* ─── FACE MAP ────────────────────────────────────────────── */
export const ECARD_FACES: Record<string, { Front: (p: FaceProps) => JSX.Element; Inside: (p: FaceProps) => JSX.Element }> = {
  "golden-key":    { Front: GoldenKeyFront,    Inside: GoldenKeyInside },
  "welcome-mat":   { Front: WelcomeMatFront,   Inside: WelcomeMatInside },
  "houseplant":    { Front: HouseplantFront,   Inside: HouseplantInside },
  "string-lights": { Front: StringLightsFront, Inside: StringLightsInside },
  "hearth":        { Front: HearthFront,       Inside: HearthInside },
  "cheers":        { Front: CheersFront,       Inside: CheersInside },
  "moving-boxes":  { Front: MovingBoxesFront,  Inside: MovingBoxesInside },
  "wreath":        { Front: WreathFront,       Inside: WreathInside },
  "house-night":   { Front: HouseNightFront,   Inside: HouseNightInside },
  "garden":        { Front: GardenFront,       Inside: GardenInside },
};
