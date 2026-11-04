# MANGO Sec.

日本株・米国株の実際の相場データで学ぶ、公開Webアプリです。画面はGitHub Pages、Google・メール認証と現在の株式口座API・保存はSupabaseで動作します。市場画面のデータは既存のSites APIから取得します。実際の注文や送金は行いません。

- 公開アプリ: https://amongushahahasus-sudo.github.io/MANGO-Sec./
- 口座API: https://wqczekzebhukjayyhuln.supabase.co/functions/v1/mango-sec-api
- 市場API: https://mango-sec-trading.azumaishow781.chatgpt.site

## 機能

- 日本株・米国株11銘柄。キオクシア、JR東日本、任天堂、NVIDIA、Qualcomm、Apple、Microsoft、トヨタ、ソニー、Amazon、Alphabet
- 実際の価格による折れ線・ローソク足チャート。欠けたOHLCは補完しません
- ライト、ダーク、時間帯による自動テーマ（端末の現地時刻7〜19時がライト）
- Google・メールアドレスで登録／ログイン。MANGO FXと共通の会員アカウントで初回に個別の株式仮想口座を作成
- 初期資金は1,000万円と10,000米ドル。通貨別の資産評価・損益、保有銘柄、取引履歴、ウォッチリスト
- 口座・履歴は利用者ごとにサーバー保存。別の端末から同じGoogle・メールアカウントで再利用できます
- Google Financeの参照リンク、取得元・価格時刻・取得時刻の表示

## 起動と検証

Node.js24以降。追加パッケージやAPIキーは不要です。

```sh
npm start
npm test
npm run db:generate
npm run build
```

`npm start` は http://localhost:3000 で相場UIを配信します。認証には公開済みAPIを使います。開発サーバーに渡された `oai-authenticated-*` ヘッダーは破棄し、ローカルHTTP要求が利用者を偽装できないようにしています。

`npm run db:generate` は `db/schema.sql` をSQLiteで検証し、初回のSQLと標準Drizzle形式のジャーナルを生成します。既存の適用済みマイグレーションは上書きしません。以後のスキーマ変更は新しい番号のSQLとジャーナル項目を追加してください。

`npm run build` は外部依存なしで単一Workerモジュールと `dist/.openai/drizzle/` のマイグレーションを生成・検証します。GitHub Actionsでテスト・ビルドを確認し、`public/` をGitHub Pagesへ配信します。口座API変更はSupabase Edge Functionの別デプロイが必要です。市場APIの変更はSitesへ反映します。GitHub PagesだけでDBや認証APIは実行できません。

## 認証・保存

Google・メール認証にはMANGO FXと共通のSupabase Authを使用します。PKCE認証、セッション更新、パスワード処理は公式SDKが担当します。Sec専用キーでブラウザー内にログイン状態を保存し、APIは照会済みの利用者IDでSupabaseの株式口座を分離します。パスワードや秘密キーをSecのサーバーやGitHubへ保存しません。共有端末では利用後にログアウトしてください。以前のChatGPT認証用テーブルとAPIは既存データを保持するため残していますが、現在の登録画面では使いません。

口座APIは確認済み利用者IDでレコードを分離します。売買はサーバーが取得した株価で計算します。口座の更新番号と注文IDを使い、同時操作や応答不明時の二重約定を防ぎます。GitHub Pagesの指定オリジンだけにCORSを許可します。

以前のブラウザー内口座は自動でサーバーにアップロードしません。新しいログイン口座は初期資金から開始します。テーマとチャート表示、未ログイン時のウォッチリストはブラウザー設定です。

.openaiに記録されているD1テーブル `mango_accounts`、`mango_login_codes`、`mango_sessions` は以前の認証方式のデータを保持します。現在の株式口座はSupabaseの `public.mango_sec_accounts` に保存します。`.openai/hosting.json` の `d1: "DB"` をSitesが用意します。マイグレーションは配信前に適用し、HTTP要求の処理中にテーブルを作成しません。

## 相場データとシミュレーションの範囲

Yahoo Financeの非公式チャート取得先をサーバーから参照します。遅延・レート制限・仕様変更がありえます。取得できないときはエラーを表示し、架空の価格に置き換えません。利用条件は [Yahoo Terms of Service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) と [Yahoo Finance data providers](https://help.yahoo.com/kb/finance-for-web/SLN2310.html) を参照してください。

市場時間外も直近の通常取引価格で練習できます。取得から5分以内、価格時刻から7日以内の参照価格を使います。日本株の1株単位も学習用の簡略化です。板、スリッページ、税金、配当、株式分割・併合、指値、為替交換には対応しません。JPYとUSDは別々に管理します。

学習用のシミュレーターであり、投資助言ではありません。

## ホーム画面へのインストール

公開アプリの「インストール」ボタンから追加できます。対応ブラウザーではアプリ追加画面が開き、iPhone/iPadではSafariの共有メニュー →「ホーム画面に追加」の案内を表示します。Android/Chromeでは「アプリをインストール」またはメニューの「ホーム画面に追加」を使えます。

アイコン付きのPWAとして単独ウィンドウで起動します。相場更新、ログイン、売買はインターネット接続が必要です。オフラインでは操作案内を表示し、注文と口座変更を停止します。Service Workerは指定した公開静的ファイルだけをキャッシュし、API、認証URL、クエリ付きURL、外部通信をキャッシュしません。

初めて開いた際は、4ページのチュートリアルと会員登録画面が表示されます。「次へ」「前に戻る」で移動し、あとから「使い方ガイド」で見直せます。登録途中でキャンセルした場合は会員登録画面に戻ります。

## Google・メール認証（v3）

MANGO FXと共通のSupabase会員アカウントを使います。Googleまたはメールアドレス＋パスワードで登録・ログインできます。メール新規登録には確認メールのリンクを開く操作が必要です。パスワード再設定にも対応しています。

Supabase接続先は `public/auth-config.js` の公開用URL・Publishable keyだけです。秘密キーは使いません。SDKはMANGO FXと同じ2.118.0を固定し、NPM配布元のSHA-512整合性を検証して `public/vendor/` に同梱しています。出典・ハッシュ・ライセンスは同フォルダーに記録しています。

SecとFXは認証会員を共通にし、端末内のログイン保存キーと、仮想口座・保有資産・履歴の保存先を分けます。SecでログアウトしてもFXの端末を一括ログアウトしません。SecのAPIはSupabaseの `/auth/v1/user` にトークンを照会して、確認済み利用者IDを取得してから口座を処理します。利用者が編集できるプロフィール情報を権限判定に使いません。

以前のChatGPT認証口座は削除しませんが、メールの一致による自動統合は行いません。新しいGoogle・メール認証のSec口座は初期資金から開始します。現在の画面ではGoogle・メール認証を使用します。

実際のGoogle認証完了、メールの配送、端末へのホーム画面追加は、利用者の端末で確認してください。確認メールやパスワード再設定リンクは、手続きを始めたブラウザーで開くとPKCE認証を完了できます。別のブラウザーで開いた場合は、案内に従い元のブラウザーで開くかメールアドレスでログインしてください。

## 口座APIの公開方法

現在の口座APIは `supabase/functions/mango-sec-api/` のSupabase Edge Functionです。`verify_jwt:false` とし、関数自身がSupabase Authの `/auth/v1/user` へ照会して本人確認を行います。公開ヘルスチェックと相場取得以外は認証が必要です。

`SUPABASE_SERVICE_ROLE_KEY` はSupabaseが関数サーバーに用意する環境変数からだけ取得します。ブラウザーやGitHubには値を記録しません。確認済みUUIDで全ての保存先を限定し、サーバー価格、更新番号、注文IDを確認してから口座を書き換えます。匿名利用者は保存先を読めず、認証済み利用者もテーブルへ直接書き込めません。SQL定義は `supabase/sec-accounts.sql` です。

`npm run build` は共通の売買計算・相場取得モジュールを関数フォルダーへコピーします。関数の公開はSupabaseのデプロイ機能で行います。GitHub Pagesの公開後、Actionsが `npm run check:live` を実行し、公開ファイル、実DB接続、CORS、未認証・不正トークン拒否、匿名DB読取拒否、実相場取得を確認します。実ユーザーへのメール送信やログインはこの検証では行いません。
