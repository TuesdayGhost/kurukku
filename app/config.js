// Supabase の接続先。ここにあるのは「公開してよい」キー（publishable key）だけ。
// データの読み書きは、データベース側の行レベルセキュリティで家族・端末ごとに制限している。
// 秘密のキー（service_role など）や Claude の APIキーは、ここに絶対に書かないこと。
export const SUPABASE_URL = "https://lcpkhfcsftmgkswwqrfm.supabase.co";
export const SUPABASE_KEY = "sb_publishable_SpYPAotoAGbgCIFGlIrcIg_n3gMz4Jc";
export const TIMEZONE = "Asia/Tokyo";
