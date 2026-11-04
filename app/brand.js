// くるっくーのロゴ（11/5 決定：判子のシンボルA-2＋線で組んだ「くるっくー」B-1）。
// 色は currentColor。家族の画面・ログイン画面のヘッダーで使う。本人の画面には出さない（spec 1章「装飾が予定への注意を奪わない」）。
// 形の設計と他の案：docs/brand.md
export const LOGO = `<svg viewBox="0 0 476 160" aria-hidden="true" focusable="false" class="logo">
  <defs>
    <mask id="kuru-b1-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
      <rect width="256" height="256" fill="#fff"/>
      <circle cx="128" cy="128" r="102" fill="none" stroke="#000" stroke-width="6"/>
      <g transform="translate(30 27.6) scale(0.8)">
        <path d="M44 150L82.9 107.97A56 56 0 0 1 131.5 90.5A16 16 0 0 0 148.99 79.19A24 24 0 0 1 195.48 81.01L213.08 94.73L191.42 100.11A24 24 0 0 1 183.7 106.96A16 16 0 0 0 176.5 126.5A56 56 0 0 1 98.39 195.8L56 174Z" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round"/>
        <circle cx="178" cy="81" r="6.5" fill="#fff"/>
        <path d="M90 142A34 34 0 0 1 130 112.5" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
      </g>
    </mask>
  </defs>
  <g transform="translate(12 12) scale(0.53125)">
    <circle cx="128" cy="128" r="118" fill="currentColor" mask="url(#kuru-b1-cut)"/>
  </g>
  <g transform="translate(168 22) scale(0.72)" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M64 14L28 50L64 86" transform="translate(0 0)"/><path d="M26 16H68L28.25 53.86A24 24 0 1 1 29.22 76A9 9 0 0 1 44.8 67A9 9 0 0 1 29.22 76" transform="translate(84 0)"/><path d="M26 56L40.48 43.33A22 22 0 1 1 37.67 83.42" transform="translate(170 0)"/><path d="M64 14L28 50L64 86" transform="translate(236 0)"/><path d="M14 50H78" transform="translate(320 0)"/></g>
</svg>`;
