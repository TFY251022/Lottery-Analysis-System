// script.js (最終 API 實時互動版 V13 - 修正用戶查詢驗證與錯誤訊息)

let currentAnalysisData = null;
// 🚨 請確認此 URL 與 app.py 運行端口一致 (預設為 5000)
const API_BASE_URL = 'https://miao-midterm-backend.onrender.com/api/posts';

// ==========================================================
// 輔助函式 (數據解析與格式化)
// ==========================================================

/**
 * 檢查 JSON 數據是否包含分析所需的核心欄位
 */
function checkRequiredFields(data) {
    if (!data.post_meta) { return ['post_meta (貼文元數據區塊)']; }
    if (!data.stats) { return ['stats (統計數據區塊)']; }
    if (!Array.isArray(data.participants) || data.participants.length === 0) {
        return ['participants (參與名單區塊，且不能為空)'];
    }

    const post_meta = data.post_meta;
    const requiredMetaFields = ['post_title', 'post_url', 'prizes'];
    const missingFields = [];

    requiredMetaFields.forEach(field => {
        if (field === 'prizes') {
            if (!Array.isArray(post_meta.prizes) || post_meta.prizes.length === 0) {
                missingFields.push('post_meta.prizes (抽獎獎品)');
            }
        } else if (!post_meta[field]) {
            missingFields.push(`post_meta.${field}`);
        }
    });

    // 檢查 participants 關鍵欄位
    const firstParticipant = data.participants[0];
    if (!firstParticipant.name || !firstParticipant.profile_url) {
        missingFields.push('participants (參與者需包含 name/profile_url)');
    }
    if (typeof data.stats.total_winners !== 'number' || data.stats.total_winners < 0) {
        missingFields.push('stats.total_winners (中獎人數)');
    }

    return missingFields;
}

/**
 * 格式化顯示訊息：將 **粗體** 改為 【】符號，並應用顏色
 */
function formatMessage(message) {
    message = message.replace(/\*\*(.*?)\*\*/g, '【$1】');
    // 使用 g 旗標確保替換所有匹配項
    message = message.replace(/❌ 【連線錯誤】:/g, '<span style="color:red;">❌ 【連線錯誤】:</span>');
    message = message.replace(/❌ 【上傳失敗】:/g, '<span style="color:red;">❌ 【上傳失敗】:</span>');
    message = message.replace(/❌ 【查詢失敗】:/g, '<span style="color:red;">❌ 【查詢失敗】:</span>');
    // **新增/修正**：用於精確顯示前端驗證失敗和後端解析錯誤
    message = message.replace(/❌ 【驗證失敗】:/g, '<span style="color:red;">❌ 【驗證失敗】:</span>');
    message = message.replace(/❌ 【查詢\/解析錯誤】:/g, '<span style="color:red;">❌ 【查詢/解析錯誤】:</span>');
    message = message.replace(/⚠️ 【驗證失敗】:/g, '<span style="color:orange;">⚠️ 【驗證失敗】:</span>');
    return message;
}

/**
 * 將前端分析後的數據結構轉換為後端 API 期望的結構
 */
function mapToApiStructure(data) {

    const actualWinnersCount = data.participants.filter(p => p.is_winner).length;

    const stats_combined = {
        total_participants: data.participants.length,
        total_qualified: data.stats.total_qualified,
        total_winners: actualWinnersCount,
        qualified_rate: ((data.stats.total_qualified / data.participants.length) * 100).toFixed(2) + '%',
        winning_rate: ((actualWinnersCount / data.stats.total_qualified) * 100).toFixed(2) + '%',
    };

    const prizeQuantity = data.post_meta.prizes.reduce((sum, p) => sum + (p.quota || 0), 0);

    const post_meta_combined = {
        ...data.post_meta,
        prize_quantity: prizeQuantity,
    };

    return {
        post_meta: post_meta_combined,
        stats: stats_combined,
        participants: data.participants.map(p => ({
            name: p.name,
            profile_url: p.profile_url,
            content: p.comment_content || '',
            time: p.comment_time || '',
            liked: p.has_like || false,
            isWinner: p.is_winner || false,
            isQualified: p.is_qualified || false
        }))
    };
}


// ==========================================================
// 1. 單次貼文分析功能 (核心邏輯)
// ==========================================================
/**
 * 處理 JSON 檔案讀取和解析的函式 
 */
function handleFileUpload(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (event) {
            try {
                let rawText = event.target.result;

                if (rawText.charCodeAt(0) === 0xFEFF) {
                    rawText = rawText.slice(1);
                }
                rawText = rawText.trim();

                rawText = rawText.replace(/: NaN/g, ': null');

                const parsedData = JSON.parse(rawText);

                const missingFields = checkRequiredFields(parsedData);

                if (missingFields.length > 0) {
                    reject(`❌ **檔案結構錯誤:** 此貼文缺：${missingFields.join('、')}。`);
                    return;
                }

                // 計算前端顯示所需的統計數據
                const totalParticipants = parsedData.participants.length;
                const qualifiedCount = parsedData.stats.total_qualified;
                const actualWinners = parsedData.stats.total_winners;

                parsedData.total_participants = totalParticipants;
                parsedData.qualified_count = qualifiedCount;
                parsedData.actual_winners = actualWinners;

                parsedData.qualified_rate_display = (totalParticipants > 0) ?
                    ((qualifiedCount / totalParticipants) * 100).toFixed(2) + '%' : '0%';

                parsedData.winning_rate_display = (qualifiedCount > 0) ?
                    ((actualWinners / qualifiedCount) * 100).toFixed(2) + '%' : '0%';

                parsedData.prize_quantity = parsedData.post_meta.prizes.reduce((sum, p) => sum + (p.quota || 0), 0);


                resolve(parsedData);

            } catch (e) {
                console.error("JSON 解析錯誤：", e);
                reject('❌ **檔案解析失敗:** 請確保上傳的是有效的 JSON 格式文件。 (請檢查文件是否有隱藏字符或格式錯誤)');
            }
        };

        reader.onerror = function () {
            reject('❌ **檔案讀取錯誤。**');
        };

        reader.readAsText(file);
    });
}


/**
 * 處理「開始分析」按鈕點擊事件 (只執行本地分析和驗證)
 */
async function analyzePostData() {
    const fileInput = document.getElementById('data-file');
    const messageP = document.getElementById('result-message');
    const uploadBtn = document.getElementById('upload-db-btn');
    const uploadMsg = document.getElementById('upload-message');

    // --- 【清空與初始化】 ---
    const summaryDiv = document.getElementById('summary-data');
    const winnersTbody = document.getElementById('winners-table').querySelector('tbody');

    currentAnalysisData = null;
    uploadBtn.disabled = true;
    uploadMsg.textContent = "請先完成分析並通過驗證。";
    summaryDiv.innerHTML = '';
    winnersTbody.innerHTML = '';
    messageP.textContent = "正在處理中...";


    if (fileInput.files.length === 0) {
        messageP.innerHTML = formatMessage('⚠️ **驗證失敗:** 請先上傳 JSON 檔案。');
        return;
    }

    let dataToAnalyze = null;

    // --- 1. 檔案讀取與基礎驗證 ---
    messageP.textContent = '正在讀取並分析上傳的 JSON 檔案...';
    try {
        dataToAnalyze = await handleFileUpload(fileInput.files[0]);
    } catch (error) {
        messageP.innerHTML = formatMessage(error);
        return;
    }

    // --- 2. 儲存分析結果 ---
    currentAnalysisData = dataToAnalyze;

    // --- 3. 顯示結果 ---
    messageP.innerHTML = formatMessage(`✅ **檔案結構驗證通過！** 請檢視下方分析結果。`);
    displayAnalysisResult(currentAnalysisData); // 傳入數據顯示

    // --- 4. 啟用上傳按鈕 ---
    uploadBtn.disabled = false;
    uploadMsg.textContent = "✅ 已通過驗證，可以將結果上傳至資料庫。";
}


/**
 * 顯示分析結果 (只顯示中獎者, 修正為 3 欄)
 */
function displayAnalysisResult(data) {
    const summaryDiv = document.getElementById('summary-data');
    const winnersTbody = document.getElementById('winners-table').querySelector('tbody');

    const postMeta = data.post_meta;
    const prizesNames = postMeta.prizes.map(p => p.name).join('、');


    // 貼文分析數據
    summaryDiv.innerHTML = `
        <p><strong>貼文標題:</strong> ${postMeta.post_title}</p>
        <p><strong>🎁 抽獎獎品:</strong> ${prizesNames}</p>
        <p><strong>🔢 獎項數量:</strong> ${data.prize_quantity} 位</p>
        <p><strong>⏳ 抽獎活動時間:</strong> ${postMeta.post_time}</p>
        <p><strong>🔗 抽獎貼文連結:</strong> <a href="${postMeta.post_url}" target="_blank">${postMeta.post_url}</a></p>
        <hr>
        <p><strong>✅ 符合資格人數:</strong> ${data.qualified_count} / ${data.total_participants} 人 (<strong>${data.qualified_rate_display}</strong>)</p>
        <p><strong>📈 總中獎率:</strong> ${data.actual_winners} / ${data.qualified_count} 人 (<strong>${data.winning_rate_display}</strong>)</p>
    `;

    // 只列出中獎者 (is_winner: true)
    const winners = data.participants.filter(p => p.is_winner);

    if (winners.length === 0) {
        // 表格內容 colspan 設置為 3 (配合 index.html 的表頭)
        winnersTbody.innerHTML = '<tr><td colspan="3">查無中獎紀錄。</td></tr>';
    } else {
        winnersTbody.innerHTML = ''; // 清空 tbody
        winners.forEach(p => {
            const row = winnersTbody.insertRow();
            row.classList.add('highlight'); // 中獎者恆定高亮
            row.insertCell().textContent = p.name;

            const commentContent = p.comment_content || '';
            row.insertCell().textContent = commentContent.substring(0, 30) + (commentContent.length > 30 ? '...' : '');
            row.insertCell().textContent = p.has_like ? '是' : '否';
        });
    }
}

/**
 * 將分析結果上傳至資料庫 (實時 API 呼叫)
 */
async function uploadToDatabase() {
    const uploadMsg = document.getElementById('upload-message');
    const uploadBtn = document.getElementById('upload-db-btn');

    if (!currentAnalysisData) {
        uploadMsg.textContent = "錯誤：沒有分析結果或未通過驗證。";
        return;
    }

    uploadBtn.disabled = true; // 上傳中，禁用按鈕
    uploadMsg.textContent = "正在上傳資料庫... 檢查重複資料中...";

    const apiData = mapToApiStructure(currentAnalysisData);

    try {
        const response = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(apiData)
        });

        const result = await response.json();

        if (response.ok) {
            const postTitle = apiData.post_meta.post_title;
            uploadMsg.innerHTML = `🎉 【上傳成功！】 ${postTitle} 分析結果已儲存。`;
        } else if (response.status === 409) {
            uploadMsg.innerHTML = formatMessage(`❌ 【上傳失敗】: 偵測到重複資料 (${apiData.post_meta.post_url})。已取消上傳。`);
        } else {
            uploadMsg.innerHTML = formatMessage(`❌ 【上傳失敗】: (錯誤碼 ${response.status}) ${result.message}`);
        }

    } catch (error) {
        uploadMsg.innerHTML = formatMessage(`❌ 【連線錯誤】: 無法連接後端 API。請檢查 app.py 是否正在運行於 ${API_BASE_URL}。`);
        uploadBtn.disabled = false; // 連線失敗，讓使用者可以再次嘗試
    }
}


// ==========================================================
// 2. 資料庫整體查詢功能 (歷史數據查詢 - API 呼叫)
// ==========================================================

async function showOverallRates() {
    const overallRatesDiv = document.getElementById('overall-rates');

    overallRatesDiv.innerHTML = '正在查詢整體資料庫分析...';

    try {
        const response = await fetch(`${API_BASE_URL}/rates`);
        const result = await response.json();

        if (!response.ok) {
            overallRatesDiv.innerHTML = formatMessage(`❌ 【查詢失敗】: ${result.message || '後端返回錯誤，但未提供訊息'}`);
            return;
        }

        const data = result.data;

        if (data.total_posts === 0) {
            overallRatesDiv.innerHTML = '⚠️ 目前資料庫中沒有任何已上傳的分析紀錄，請先進行分析並上傳。';
            return;
        }

        // --- 處理新的留言內容分析數據結構 ---
        const commentAnalysis = data.comment_analysis || {};
        const groupChou = commentAnalysis.group_chou || {};
        const groupOther = commentAnalysis.group_other || {};


        // 1. 基礎分析結果
        let contentHTML = `
            <h4>基於 ${data.total_posts} 筆歷史紀錄的分析</h4>
            <p><strong>📈 總體中獎率 (所有貼文合格者平均):</strong> ${data.overall_win_rate || 'N/A'}。</p>
            <hr>
            
            <h4>💬 留言內容分析 (總留言數：${commentAnalysis.total_comments})</h4>
            <p>此分析將留言分為「含『抽』字」與「其他內容」兩大類，並比較其【合格中獎率】。</p>

            <table class="data-table">
                <thead><tr><th>留言分類</th><th>佔總留言比率</th><th>合格參與人數</th><th>中獎人數</th><th>合格中獎率</th></tr></thead>
                <tbody>
                    <tr>
                        <td>含「抽」字</td>
                        <td>${groupChou.overall_rate || '0.00%'}</td>
                        <td>${groupChou.qualified_count || 0} 人</td>
                        <td>${groupChou.winners_count || 0} 人</td>
                        <td style="font-weight: bold;">${groupChou.winning_rate || '0.00%'}</td>
                    </tr>
                    <tr>
                        <td>其他內容</td>
                        <td>${groupOther.overall_rate || '0.00%'}</td>
                        <td>${groupOther.qualified_count || 0} 人</td>
                        <td>${groupOther.winners_count || 0} 人</td>
                        <td style="font-weight: bold; color: ${parseFloat(groupOther.winning_rate) > parseFloat(groupChou.winning_rate) ? 'red' : 'inherit'};">${groupOther.winning_rate || '0.00%'}</td>
                    </tr>
                </tbody>
            </table>
            <hr>

            <h3>各獎品種類價值中獎率</h3>
        `;

        // 2. 獎品分類表格 (處理新的 Object 結構: 紋玉, 現金, 周邊)
        const categories = ['紋玉', '現金', '周邊'];
        const categoryRates = data.category_rates || {}; // 確保 category_rates 是一個物件

        categories.forEach(category => {
            // items 已經在 app.py 中按照 value 由大到小排序
            const items = categoryRates[category] || [];

            contentHTML += `
                <h4>${category} 類獎品 (共 ${items.length} 個不同價值紀錄)</h4>
            `;

            if (items.length > 0) {
                let tableRows = '';
                items.forEach(item => {
                    // 根據 app.py 的邏輯，item.value 是數字
                    tableRows += `
                        <tr>
                            <td>${item.value}</td> 
                            <td>${item.count} 筆</td>
                            <td>${item.average_winning_rate}</td>
                        </tr>
                    `;
                });

                contentHTML += `
                    <table class="data-table">
                        <thead><tr><th>獎品價值</th><th>出現貼文數</th><th>平均中獎率 (合格者)</th></tr></thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                 `;
            } else {
                contentHTML += '<p>查無此分類的紀錄。</p>';
            }
            contentHTML += '<br>'; // 增加間隔
        });

        overallRatesDiv.innerHTML = contentHTML;

    } catch (error) {
        overallRatesDiv.innerHTML = formatMessage(`❌ 【連線錯誤】: 無法連接後端 API。請檢查 app.py 是否正在運行於 ${API_BASE_URL}。`);
    }
}


/**
 * 查詢個人參與紀錄
 */
async function queryUserHistory() {
    const userName = document.getElementById('user-name-input').value.trim();
    const userProfileUrl = document.getElementById('user-profile-url-input').value.trim();
    const userHistoryDiv = document.getElementById('user-history');

    // **【修正 1: 恢復「必須同時輸入」的限制】**
    if (!userName || !userProfileUrl) {
        userHistoryDiv.innerHTML = formatMessage('❌ 【驗證失敗】: 請**同時輸入**【用戶名】和【主頁連結】才能進行查詢。');
        return;
    }

    const query = new URLSearchParams();
    query.append('name', userName);
    query.append('profile_url', userProfileUrl);

    // 顯示查詢中的訊息 (此處使用兩個欄位，避免誤解)
    userHistoryDiv.textContent = `正在查詢用戶 ${userName} (${userProfileUrl}) 的參與紀錄...`;

    try {
        const response = await fetch(`${API_BASE_URL}/user-history?${query.toString()}`);
        const result = await response.json();

        if (!response.ok) {
            // 後端返回非 2xx 狀態碼時顯示
            userHistoryDiv.innerHTML = formatMessage(`❌ 【查詢失敗】: ${result.message || '後端返回錯誤，但未提供訊息'}`);
            return;
        }

        // 成功回應，但可能查無數據 (Status 200)
        const userInfo = result.user_info; // 只有有數據時才有
        // 兼容 app.py 的結構（有數據時是 result.data.history，無數據時是 result.history）
        const history = result.history || (result.data ? result.data.history : []);

        if (history.length === 0) {
            // **【修正 2: 查無數據的顯示】**：只顯示後端傳來的訊息，不需顯示 userInfo
            userHistoryDiv.innerHTML = `<h4>查詢結果</h4><p>${result.message}</p>`;
            return;
        }

        const totalParticipations = result.data.total_participations;
        const totalWins = result.data.total_wins;
        const overallRate = result.data.overall_win_rate;

        let tableHTML = `
            <h4>用戶 ${userInfo.name} 參與紀錄 (共 ${totalParticipations} 次，中獎 ${totalWins} 次)</h4>
            <p><strong>主頁連結:</strong> <a href="${userInfo.profile_url}" target="_blank">${userInfo.profile_url}</a></p>
            <p>✨ 該用戶總中獎率: <strong>${overallRate}</strong></p>
            <table class="data-table">
                <thead><tr><th>貼文/獎品</th><th>此貼文中獎率</th><th>是否中獎</th></tr></thead>
                <tbody>
        `;

        history.forEach(h => {
            const highlightClass = h.is_winner ? 'highlight' : '';
            const prizeList = h.prizes.map(p => p.name).join('、');

            tableHTML += `
                <tr class="${highlightClass}">
                    <td><a href="${h.post_url}" target="_blank">${h.post_title}</a> (${prizeList})</td>
                    <td>${h.post_winning_rate}</td>
                    <td>${h.is_winner ? '是' : '否'}</td>
                </tr>
            `;
        });

        tableHTML += '</tbody></table>';
        userHistoryDiv.innerHTML = tableHTML;
    } catch (error) {
        // **【修正 3: 修正為更精確的 JSON 解析錯誤】**
        userHistoryDiv.innerHTML = formatMessage(`❌ 【查詢/解析錯誤】: 無法處理後端回應或無法連線。詳情: ${error.message}`);
    }
}

async function querySuperWinners() {
    const superWinnersDiv = document.getElementById('super-winners');

    superWinnersDiv.textContent = '正在查詢重複中獎的超級幸運兒...';

    try {
        const response = await fetch(`${API_BASE_URL}/super-winners`);
        const result = await response.json();

        if (!response.ok) {
            superWinnersDiv.innerHTML = formatMessage(`❌ 【查詢失敗】: ${result.message || '後端返回錯誤，但未提供訊息'}`);
            return;
        }

        const superWinners = result.data;

        if (superWinners.length === 0) {
            superWinnersDiv.innerHTML = '<h4>🥳 資料庫中目前沒有發現重複中獎的幸運兒。</h4>';
            return;
        }


        let tableHTML = '<h4>🎉 發現重複中獎的幸運兒！</h4>';
        tableHTML += `
             <table class="data-table">
                 <thead><tr><th>FB 名稱</th><th>主頁連結</th><th>重複中獎次數</th><th>中獎貼文/獎品列表</th></tr></thead>
                 <tbody>
         `;

        superWinners.forEach(w => {
            const prizeList = w.winning_posts.map(p => {
                const names = (p.prizes || []).map(p => p.name).join('、');
                return `【${p.title}】 (${names || 'N/A'})`;
            }).join('<br>');

            const urlText = (w.profile_url || 'N/A').length > 30 ? (w.profile_url || 'N/A').substring(0, 30) + '...' : (w.profile_url || 'N/A');

            tableHTML += `
                 <tr class="highlight">
                     <td>${w.name}</td>
                     <td><a href="${w.profile_url || '#'}" target="_blank">${urlText}</a></td>
                     <td>${w.times_won} 次</td>
                     <td>${prizeList}</td> 
                 </tr>
             `;
        });

        tableHTML += '</tbody></table>';
        superWinnersDiv.innerHTML = tableHTML;

    } catch (error) {
        superWinnersDiv.innerHTML = formatMessage(`❌ 【連線錯誤】: 無法連接後端 API。`);
    }
}