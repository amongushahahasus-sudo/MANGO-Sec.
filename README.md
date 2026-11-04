# MANGO Sec.

日本株・米国株の実際の相場データで学ぶ、公開Webアプリです。画面はGitHub Pages、認証・相場API・口座保存はSitesのCloudflare WorkerとD1で動作します。実際の注文や送金は行いません。

- 公開アプリ: https://amongushahahasus-sudo.github.io/MANGO-Sec./
- API: https://mango-sec-trading.azumaishow781.chatgpt.site

## 機能

- 日本株・米国株11銘柄。キオクシア、JR東日本、任天堂、NVIDIA、Qualcomm、Apple、Microsoft、トヨタ、ソニー、Amazon、Alphabet
- 実際の価格による折れ線・ローソク足チャート。欠けたOHLCは補完しません
- ライト、ダーク、時間帯による自動テーマ（端末の現地時刻7〜19時がライト）
- ChatGPTで登録・ログイン。初回ログイン時に個別の仮想口座を作成
- 初期資金は1,000万円と10,000米ドル。通貨別の資産評価・損益、保有銘柄、取引履歴、ウォッチリスト
- 口座・履歴は利用者ごとにサーバー保存。別の端末から同じChatGPTアカウントで再利用できます
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

`npm run build` は外部依存なしで単一Workerモジュールと `dist/.openai/drizzle/` のマイグレーションを生成・検証します。GitHub Actionsでテスト・ビルドを確認し、`public/` をGitHub Pagesへ配信します。API変更はSitesへの別デプロイが必要です。GitHub PagesだけでDBや認証APIは実行できません。

## 認証・保存

SitesのChatGPT認証を使います。GitHub Pagesへの復帰時は一回限り・5分期限のコードとPKCEで確認し、APIトークンを渡します。トークンのハッシュだけをD1に保存し、有効期限は7日です。ブラウザーではsessionStorageに保存し、タブを閉じると再ログインが必要になります。サーバーに保存された口座は消えません。アプリがChatGPTのパスワードを受け取ることはありません。

口座APIは確認済み利用者IDでレコードを分離します。売買はサーバーが取得した株価で計算します。口座の更新番号と注文IDを使い、同時操作や応答不明時の二重約定を防ぎます。GitHub Pagesの指定オリジンだけにCORSを許可します。

以前のブラウザー内口座は自動でサーバーにアップロードしません。新しいログイン口座は初期資金から開始します。テーマとチャート表示、未ログイン時のウォッチリストはブラウザー設定です。

D1テーブルは `mango_accounts`、`mango_login_codes`、`mango_sessions` です。`.openai/hosting.json` の `d1: "DB"` をSitesが用意します。マイグレーションは配信前に適用し、HTTP要求の処理中にテーブルを作成しません。

## 相場データとシミュレーションの範囲

Yahoo Financeの非公式チャート取得先をサーバーから参照します。遅延・レート制限・仕様変更がありえます。取得できないときはエラーを表示し、架空の価格に置き換えません。利用条件は [Yahoo Terms of Service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) と [Yahoo Finance data providers](https://help.yahoo.com/kb/finance-for-web/SLN2310.html) を参照してください。

市場時間外も直近の通常取引価格で練習できます。取得から5分以内、価格時刻から7日以内の参照価格を使います。日本株の1株単位も学習用の簡略化です。板、スリッページ、税金、配当、株式分割・併合、指値、為替交換には対応しません。JPYとUSDは別々に管理します。

学習用のシミュレーターであり、投資助言ではありません。
