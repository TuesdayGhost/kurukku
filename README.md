# kurukku
Built with Claude: Japan 2026

電子伝書鳩「くるっくー」（仮）— 家族の知らせと日々を届ける鳩。

- 仕様書：[docs/spec.md](docs/spec.md)
- 作業リスト：[docs/tasks.md](docs/tasks.md)
- アプリ：[app/](app/)（GitHub Pages で公開。`https://tuesdayghost.github.io/kurukku/`）
- データベース定義：[supabase/migrations/](supabase/migrations/)
- 実機テスト用ページ：[prototypes/sound-test.html](prototypes/sound-test.html)
- テスト：`node --test tests/schedule.test.mjs`

構成：ブラウザで開く静的なWebアプリ ＋ Supabase（データ・ログイン・端末間の同期）。ビルド不要。
