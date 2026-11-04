# kurukku
Built with Claude: Japan 2026

電子伝書鳩「くるっくー」（仮）— 家族の知らせと日々を届ける鳩。

- 仕様書：[docs/spec.md](docs/spec.md)
- 作業リスト：[docs/tasks.md](docs/tasks.md)
- アプリ：[app/](app/)（GitHub Pages で公開。`https://tuesdayghost.github.io/kurukku/`）
- データベース定義：[supabase/migrations/](supabase/migrations/)
- 実機テスト用ページ：[prototypes/sound-test.html](prototypes/sound-test.html)
- テスト：`node --test tests/*.test.mjs tests/*.test.ts`
- UI設計・レビューのSkill：[.claude/skills/kurukku-ui-review/](.claude/skills/kurukku-ui-review/)（WCAG 2.2 等を根拠に、規格要件・推奨・仮説・好みを区別して判断する。レビュー記録は references/baseline-*.md）

構成：ブラウザで開く静的なWebアプリ ＋ Supabase（データ・ログイン・端末間の同期）。ビルド不要。
