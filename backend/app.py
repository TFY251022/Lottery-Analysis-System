import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from dotenv import load_dotenv
import os
from urllib.parse import urlparse
from datetime import datetime
from bson.objectid import ObjectId
import re

# 載入環境變數
load_dotenv()

# --- MongoDB 連線設定 ---
MONGODB_URI = os.getenv('MONGODB_URI')
if not MONGODB_URI:
    raise ValueError("未設定 MONGODB_URI，請檢查 .env 檔案")

app = Flask(__name__)
CORS(app) 

try:
    db_name = urlparse(MONGODB_URI).path.strip('/') or 'lottery_analysis_db'
    client = MongoClient(MONGODB_URI)
    db = client[db_name]
    posts_collection = db.lottery_posts 
    
    print(f"✅ MongoDB 連線成功，資料庫：{db_name}")

    posts_collection.create_index("post_meta.post_url", unique=True)
    print("✅ 已設定 post_meta.post_url 唯一索引")

except Exception as e:
    print(f"❌ MongoDB 連線失敗或索引設定錯誤: {e}")


# =========================================================
# 路由 1: 資料上傳、缺失與重複篩選 (POST /api/posts/upload)
# (保持不變)
# =========================================================
@app.route('/api/posts/upload', methods=['POST'])
def upload_post():
    new_post_data = request.json
    
    # --- 1. 🚨 缺失資料篩選 (Validation) ---
    post_meta = new_post_data.get('post_meta', {})
    stats = new_post_data.get('stats', {})

    post_url = post_meta.get('post_url')
    post_title = post_meta.get('post_title')
    prizes = post_meta.get('prizes')
    total_qualified = stats.get('total_qualified')

    if not (post_url and post_title and prizes and total_qualified is not None):
        return jsonify({ 
            "success": False, 
            "message": "🚨 資料缺少關鍵欄位 (URL/標題/獎品/合格人數)，已拒絕儲存。",
            "error_detail": "Missing post_url, post_title, prizes, or total_qualified."
        }), 400

    # --- 2. ⚠️ 重複資料篩選 (Duplicate Filtering) ---
    try:
        existing_post = posts_collection.find_one({ 'post_meta.post_url': post_url })

        if existing_post:
            return jsonify({ 
                "success": False,
                "message": f"⚠️ 資料重複：此貼文 URL 已存在於資料庫中，已載入資料庫紀錄進行分析。",
                "existing_data": {
                    "post_meta": existing_post.get('post_meta'),
                    "stats": existing_post.get('stats'),
                    "participants": existing_post.get('participants') 
                }
            }), 409

        # --- 3. 資料處理與儲存 ---
        
        participants_to_save = new_post_data.get('participants', [])

        post_to_save = {
            'post_meta': post_meta,
            'stats': stats,
            'participants': participants_to_save, 
            'upload_date': datetime.now()
        }
        
        result = posts_collection.insert_one(post_to_save)
        
        return jsonify({ 
            "success": True, 
            "message": "🎉 貼文分析結果已成功儲存！", 
            "data": {
                "id": str(result.inserted_id),
                "title": post_title,
                "winners_count": stats.get('total_winners', 0)
            }
        }), 201

    except Exception as e:
        return jsonify({ 
            "success": False, 
            "message": f"❌ 伺服器錯誤，無法儲存資料: {str(e)}", 
            "error_detail": str(e)
        }), 500


# =========================================================
# 路由 2: 分析功能 1: 整體中獎率分析 (修正：整體比率分母為合格人數)
# =========================================================
@app.route('/api/posts/rates', methods=['GET'])
def show_overall_rates():
    
    # 1. 基礎總體統計
    overall_stats_pipeline = [
        {
            "$group": {
                "_id": None, 
                "total_qualified": { "$sum": "$stats.total_qualified" },
                "total_winners": { "$sum": "$stats.total_winners" },
                "total_posts": { "$sum": 1 }
            }
        }
    ]
    results = list(posts_collection.aggregate(overall_stats_pipeline))
    
    if not results:
        return jsonify({ "success": True, "message": "資料庫中沒有足夠資料。", "data": {"total_posts": 0} }), 200

    stats = results[0]
    total_qualified = stats.get('total_qualified', 0)
    total_winners = stats.get('total_winners', 0)
    total_posts = stats.get('total_posts', 0)


    # --- 2. 留言內容分析 (新邏輯：區分含「抽」字與其他) ---

    # A. 計算總留言數
    total_comments_cursor = list(posts_collection.aggregate([
        {"$unwind": "$participants"},
        {"$group": {"_id": None, "count": {"$sum": 1}}}
    ]))
    total_comments = total_comments_cursor[0]['count'] if total_comments_cursor else 0 

    # B. 計算 Group A ('抽'字) 的各項數據 (總數、合格數、中獎數)
    chou_analysis_pipeline = [
        {"$unwind": "$participants"},
        {
            "$match": {"participants.content": {"$regex": "抽", "$options": "i"}}
        },
        {
            "$group": {
                "_id": None,
                "chou_total_count": {"$sum": 1},
                "chou_qualified_count": {"$sum": {"$cond": ["$participants.isQualified", 1, 0]}},
                "chou_winners_count": {"$sum": {"$cond": [{"$and": ["$participants.isQualified", "$participants.isWinner"]}, 1, 0]}},
            }
        }
    ]

    chou_results_cursor = list(posts_collection.aggregate(chou_analysis_pipeline))
    chou_metrics = chou_results_cursor[0] if chou_results_cursor else {}

    chou_total_count = chou_metrics.get('chou_total_count', 0)
    chou_qualified_count = chou_metrics.get('chou_qualified_count', 0)
    chou_winners_count = chou_metrics.get('chou_winners_count', 0)

    # C. 計算 Group B ('其他留言') 的數據 (使用排除法)
    other_total_count = total_comments - chou_total_count
    other_qualified_count = total_qualified - chou_qualified_count
    other_winners_count = total_winners - chou_winners_count 

    # D. 計算比率和中獎率
    
    # 修正：將分母從「總留言數 (total_comments)」替換為「總合格人數 (total_qualified)」
    chou_rate_qualified = (chou_qualified_count / total_qualified * 100) if total_qualified > 0 else 0
    other_rate_qualified = (other_qualified_count / total_qualified * 100) if total_qualified > 0 else 0

    # 中獎率計算保持不變 (以合格人數為分母)
    chou_win_rate = (chou_winners_count / chou_qualified_count * 100) if chou_qualified_count > 0 else 0
    other_win_rate = (other_winners_count / other_qualified_count * 100) if other_qualified_count > 0 else 0


    # 3. 各獎品種類價值中獎率分析 (保持不變)
    prize_value_pipeline = [
        {"$unwind": "$post_meta.prizes"},
        {
            "$group": {
                "_id": {
                    "category": "$post_meta.prizes.category",
                    "value": "$post_meta.prizes.value"
                },
                "total_posts_for_prize": {"$sum": 1},
                "total_winning_rate": {
                    "$sum": { 
                        "$toDouble": {
                            "$replaceAll": {
                                "input": "$stats.winning_rate", 
                                "find": "%", 
                                "replacement": ""
                            }
                        } 
                    }
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "category": "$_id.category",
                "value": "$_id.value",
                "count": "$total_posts_for_prize",
                "average_winning_rate_raw": { "$divide": ["$total_winning_rate", "$total_posts_for_prize"] }
            }
        }
    ]

    raw_category_rates = list(posts_collection.aggregate(prize_value_pipeline))

    # 後處理並重新分組：將列表轉換為字典，並依照 value 降序排序
    category_rates = {'紋玉': [], '現金': [], '周邊': []}
    
    for item in raw_category_rates:
        category = item.get('category')
        value = item.get('value')
        count = item.get('count')
        avg_rate_raw = item.get('average_winning_rate_raw')

        if category and category in category_rates:
            category_rates[category].append({
                "value": value,
                "count": count,
                "average_winning_rate": f"{avg_rate_raw:.2f}%" if avg_rate_raw is not None else "0.00%"
            })
    
    # 依照 value 進行降序排序
    for category in category_rates:
        category_rates[category].sort(key=lambda x: x.get('value', 0), reverse=True)


    overall_win_rate = 0
    if total_qualified > 0:
        overall_win_rate = (total_winners / total_qualified) * 100
        
    data = {
        "total_posts": total_posts,
        "overall_win_rate": f"{overall_win_rate:.2f}%",
        "comment_analysis": {
            "total_comments": total_comments,
            # 使用新計算的「佔總合格人數比率」
            "group_chou": {
                "qualified_count": chou_qualified_count,
                "winners_count": chou_winners_count,
                "overall_rate": f"{chou_rate_qualified:.2f}%", 
                "winning_rate": f"{chou_win_rate:.2f}%",
            },
            # 使用新計算的「佔總合格人數比率」
            "group_other": {
                "qualified_count": other_qualified_count,
                "winners_count": other_winners_count,
                "overall_rate": f"{other_rate_qualified:.2f}%",
                "winning_rate": f"{other_win_rate:.2f}%",
            }
        },
        "best_comment_description": "統計顯示，大部分留言包含『抽』字，但其他內容留言可能具有更高中獎率。",
        "category_rates": category_rates
    }

    return jsonify({
        "success": True,
        "data": data,
        "message": "整體中獎率與留言分析完成。"
    }), 200


# =========================================================
# 路由 3: 個人參與及中獎紀錄查詢 (修正：移除查無紀錄時的 user_info)
# =========================================================
@app.route('/api/posts/user-history', methods=['GET'])
def query_user_history():
    user_name = request.args.get('name')
    profile_url = request.args.get('profile_url')
    
    query_filter = {}
    if user_name:
        query_filter['participants.name'] = user_name
    if profile_url:
        query_filter['participants.profile_url'] = profile_url

    if not query_filter:
        return jsonify({ "success": False, "message": "請提供用戶名或用戶主頁連結進行查詢。" }), 400

    try:
        user_history_cursor = posts_collection.find(
            query_filter, 
            { 
                'post_meta.post_title': 1,
                'post_meta.post_url': 1,
                'post_meta.prizes': 1,
                'stats.winning_rate': 1,
                'participants': 1 
            }
        )

        history = []
        user_info = {"name": user_name, "profile_url": profile_url}
        
        for post in user_history_cursor:
            user_participant = next((p for p in post.get('participants', []) 
                                     if (p.get('name') == user_name and user_name) or (p.get('profile_url') == profile_url and profile_url)), None)

            if user_participant:
                history.append({
                    "post_title": post['post_meta']['post_title'],
                    "post_url": post['post_meta']['post_url'],
                    "prizes": post['post_meta']['prizes'],
                    "is_winner": user_participant.get('isWinner', False),
                    "post_winning_rate": post['stats']['winning_rate'],
                })
                if not user_info['name'] and user_participant.get('name'):
                    user_info['name'] = user_participant.get('name')
                if not user_info['profile_url'] and user_participant.get('profile_url'):
                    user_info['profile_url'] = user_participant.get('profile_url')


        if not history:
             return jsonify({ 
                "success": True, 
                "message": f"查無用戶 {user_name or profile_url} 的參與紀錄，請檢查用戶名與主頁連結是否對應且存在抽獎紀錄。", 
                "history": [],
                # 【修正：user_info 欄位已移除】
            }), 200

        total_participations = len(history)
        total_wins = sum(1 for h in history if h['is_winner'])
        overall_win_rate = f"{(total_wins / total_participations * 100):.2f}%" if total_participations > 0 else "0.00%"
        
        return jsonify({
            "success": True,
            "data": {
                "total_participations": total_participations,
                "total_wins": total_wins,
                "overall_win_rate": overall_win_rate,
                "history": history
            },
            "user_info": user_info,
            "message": f"查詢用戶 {user_info['name'] or user_info['profile_url']} 的 {total_participations} 筆參與紀錄完成。"
        }), 200
        
    except Exception as e:
        print(f"❌ /api/posts/user-history 伺服器分析錯誤: {e}", file=sys.stderr)
        return jsonify({"success": False, "message": f"伺服器分析錯誤，請檢查後端日誌: {str(e)}"}), 500


# =========================================================
# 路由 4: 超級幸運兒 (保持不變)
# =========================================================
@app.route('/api/posts/super-winners', methods=['GET'])
def show_super_winners():
    pipeline = [
        { '$unwind': '$participants' },
        { '$match': { 'participants.isWinner': True } }, 
        { 
            '$group': {
                '_id': {
                    '$ifNull': ['$participants.profile_url', '$participants.name']
                },
                'name': { '$first': '$participants.name' },
                'profile_url': { '$first': '$participants.profile_url' },
                'times_won': { '$sum': 1 }, 
                'winning_posts': { 
                    '$push': { 
                        'title': '$post_meta.post_title',
                        'prizes': '$post_meta.prizes'
                    }
                }
            }
        },
        { '$match': { 'times_won': { '$gte': 2 } } },
        { '$sort': { 'times_won': -1 } }
    ]
    
    try:
        super_winners = list(posts_collection.aggregate(pipeline))

        return jsonify({
            "success": True,
            "data": super_winners,
            "message": f"成功查詢到 {len(super_winners)} 位重複中獎者。"
        }), 200

    except Exception as e:
        return jsonify({"success": False, "message": f"伺服器分析錯誤: {str(e)}"}), 500


# =========================================================
# 伺服器啟動
# =========================================================
if __name__ == '__main__':
    PORT = int(os.getenv('PORT', 5000))
    print(f"🚀 伺服器啟動於 http://127.0.0.1:{PORT} (請確保前端與此端口一致，或使用代理)")
    app.run(debug=True, port=PORT)