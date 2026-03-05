// backend/models/Post.js
const mongoose = require('mongoose');

// 定義獎品 (Prizes) 的子結構
const PrizeSchema = new mongoose.Schema({
    id: Number,
    name: String,
    value: Number, // 紋玉數值 (用於價值分析)
    quota: Number, // 中獎名額
    category: String,
});

// 定義貼文元數據 (Post_Meta) 的主結構
const PostMetaSchema = new mongoose.Schema({
    post_title: { type: String, required: true },
    post_url: {
        type: String,
        required: true,
        unique: true // 📌 重複資料篩選的核心
    },
    post_time_range: [String],
    prizes: [PrizeSchema],
});

// 定義統計數據 (Stats) 的子結構
const StatsSchema = new mongoose.Schema({
    total_comments_valid_time: Number,
    total_qualified: Number, // 📌 缺失資料篩選的依據之一
    total_winners: Number,
});

// 我們只需要儲存中獎者的關鍵資訊用於後續查詢
const ParticipantSchema = new mongoose.Schema({
    name: String,
    profile_url: String, // 可以用作查詢個人紀錄的 ID
    is_winner: Boolean, // 應該永遠為 true，因為我們只儲存中獎者
});

// 主貼文資料 (Post) 結構
const PostSchema = new mongoose.Schema({
    post_meta: PostMetaSchema,
    stats: StatsSchema,
    participants: [ParticipantSchema], // 只儲存中獎者以節省空間
    upload_date: { type: Date, default: Date.now }
}, {
    // 設定 collection 名稱，避免 mongoose 自動產生複數名稱
    collection: 'lottery_posts'
});

// 建立索引以加速 post_url 查詢 (雖然已設定 unique，但明確建立索引有助效能)
PostSchema.index({ 'post_meta.post_url': 1 }, { unique: true });

// 匯出 Model，以便在 controller 中使用
module.exports = mongoose.model('Post', PostSchema);