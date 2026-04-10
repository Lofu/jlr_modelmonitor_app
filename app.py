"""
LLM 模型萃取準確度監控 Dashboard
使用 Streamlit 建立互動式前端界面
"""
import streamlit as st
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
import json
from datetime import datetime

# 本地模組
from dashboard.config import (
    REFERENCE_MODELS,
    ModelConfig,
    get_extract_filename,
    get_jsonl_filename,
    extract_model_id_from_filename,
    EXTRACT_DIR,
    OUTPUT_DIR,
    PDF_DIR,
    BASE_DIR,
    GROUND_TRUTH_FILE,
    GCP_LOCATION_GEMINI,
    GCP_LOCATION_CLAUDE,
    SYSTEM_PROMPT
)
from dashboard.extractor import PDFExtractor
from dashboard.analyzer import AccuracyAnalyzer

# ============================================================================
# Streamlit 頁面配置
# ============================================================================
st.set_page_config(
    page_title="LLM 萃取準確度監控",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 設定中文字型
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'Microsoft JhengHei', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# ============================================================================
# 側邊欄
# ============================================================================
st.sidebar.title("🎯 LLM 萃取監控")
st.sidebar.markdown("---")

st.sidebar.subheader("📌 系統資訊")
st.sidebar.info(f"""
**版本**: v3.3 動態配置版  
**專案路徑**: {BASE_DIR.name}  
**PDF 數量**: {len(list(PDF_DIR.glob('*.pdf')))}  
""")

st.sidebar.markdown("---")
st.sidebar.subheader("📚 常用模型參考")

st.sidebar.markdown("**Gemini 模型**")
st.sidebar.code("""gemini-2.0-flash-001
gemini-3.1-pro-preview""", language="text")

st.sidebar.markdown("**Claude 模型**")
st.sidebar.code("""claude-sonnet-4-5@20250929
claude-sonnet-4-6""", language="text")

st.sidebar.markdown("---")
st.sidebar.subheader("🌍 Location 建議")

with st.sidebar.expander("Gemini Locations"):
    st.markdown("""
    - `global` (預設)
    - `us-central1`
    - `asia-east1`
    - `europe-west4`
    """)

with st.sidebar.expander("Claude Locations"):
    st.markdown("""
    - `us-central1` (預設)
    - `us-east5`
    - `europe-west4`
    """)

# ============================================================================
# 主要功能區
# ============================================================================
st.title("📊 LLM 萃取準確度監控 Dashboard")
st.markdown("---")

# Tabs
tab1, tab2, tab3 = st.tabs(["📄 PDF 萃取", "📈 準確度分析", "📦 檔案管理"])

# ============================================================================
# Tab 1: PDF 萃取
# ============================================================================
with tab1:
    st.header("📄 PDF 檔案萃取")
    
    col1, col2 = st.columns([2, 1])
    
    with col1:
        st.subheader("萃取設定")
        
        # GCP 專案設定
        st.markdown("#### ☁️ GCP 專案設定")
        
        col_gcp1, col_gcp2 = st.columns(2)
        with col_gcp1:
            gcp_project = st.text_input(
                "GCP Project ID",
                value="cdcda-lab-377808",
                help="輸入您的 GCP 專案 ID"
            )
        with col_gcp2:
            # 這裡先留空，等選擇模型後再顯示 location
            st.empty()
        
        st.markdown("---")
        
        # 模型輸入框
        st.markdown("#### 🤖 模型參數設定")
        
        model_input = st.text_input(
            "Model ID",
            value="gemini-2.0-flash-001",
            placeholder="例如: claude-sonnet-4-5@20250929 或 gemini-2.0-flash-001",
            help="輸入要使用的模型 ID，可參考側邊欄的模型列表"
        )
        
        # Provider 判斷邏輯
        if model_input.strip():
            model_id = model_input.strip()
            model_id_lower = model_id.lower()
            
            # 智能判斷 provider（包含關鍵字即可）
            # Gemini 關鍵字: gemini, palm, bison
            if any(keyword in model_id_lower for keyword in ["gemini", "palm", "bison"]):
                default_provider = "gemini"
                default_location = "global"
            # Claude 關鍵字: claude, anthropic, sonnet, opus, haiku
            elif any(keyword in model_id_lower for keyword in ["claude", "anthropic", "sonnet", "opus", "haiku"]):
                default_provider = "claude"
                default_location = "us-central1"
            # 預設使用 Gemini
            else:
                default_provider = "gemini"
                default_location = "global"
            
            # Provider 和 Location 選擇
            col_a, col_b = st.columns(2)
            with col_a:
                provider = st.selectbox(
                    "Provider",
                    options=["gemini", "claude"],
                    index=0 if default_provider == "gemini" else 1,
                    help="選擇模型提供者"
                )
            with col_b:
                # 動態提示建議的 Location
                location_help = {
                    "gemini": "Gemini 建議: global, us-central1, asia-east1",
                    "claude": "Claude 建議: us-central1, us-east5, europe-west4"
                }
                
                location = st.text_input(
                    "Location",
                    value=default_location,
                    help=location_help[provider]
                )
        
        st.markdown("---")
        
        if not model_input.strip():
            st.warning("⚠️ 請輸入模型 ID")
        elif not gcp_project.strip():
            st.warning("⚠️ 請輸入 GCP Project ID")
        else:
            model_id = model_input.strip()
            
            # 檢查模型是否在參考清單中
            if model_id in REFERENCE_MODELS:
                ref = REFERENCE_MODELS[model_id]
                display_name = ref["display_name"]
                st.success(f"✅ 識別為參考模型：**{display_name}**")
            else:
                display_name = model_id
                st.info(f"ℹ️ 自定義模型：**{model_id}**")
            
            st.markdown("---")
            
            # 🆕 Prompt 自訂區域
            st.subheader("💬 Prompt 設定")
            
            with st.expander("🔧 自訂 System Prompt（點擊展開編輯）", expanded=False):
                st.caption("預設使用系統 Prompt，如需調整請在下方編輯")
                
                # 提供預設 prompt 和自訂選項
                use_custom_prompt = st.checkbox("使用自訂 Prompt", value=False)
                
                if use_custom_prompt:
                    custom_prompt = st.text_area(
                        "編輯 Prompt",
                        value=SYSTEM_PROMPT,
                        height=400,
                        help="請輸入完整的 system prompt。這將覆蓋預設的 prompt。"
                    )
                    st.info("✏️ 使用自訂 Prompt")
                else:
                    custom_prompt = SYSTEM_PROMPT
                    st.success("✅ 使用預設 Prompt")
                    
                    # 顯示預設 prompt 的預覽（只讀）
                    with st.expander("👁️ 預覽預設 Prompt"):
                        st.code(SYSTEM_PROMPT, language="markdown")
            
            # 儲存到 session_state 供後續使用
            st.session_state['system_prompt'] = custom_prompt
            
            st.markdown("---")
            
            # 建立 ModelConfig
            model_config = ModelConfig(
                model_id=model_id,
                provider=provider,
                location=location,
                display_name=display_name
            )
            
            # 顯示配置摘要
            st.success("✅ 配置完成")
            with st.expander("📋 查看完整配置"):
                st.code(f"""
GCP Project:  {gcp_project}
Model ID:     {model_id}
Provider:     {provider}
Location:     {location}
Display Name: {display_name}
Output File:  {get_extract_filename(model_id)}
                """.strip())
            
            # 檢查 PDF 檔案
            pdf_files = list(PDF_DIR.glob("*.pdf"))
            st.write(f"📁 找到 {len(pdf_files)} 個 PDF 檔案")
            
            # 顯示部分檔案
            with st.expander("查看 PDF 檔案列表 (前10個)"):
                for pdf in pdf_files[:10]:
                    st.text(f"  • {pdf.name}")
                if len(pdf_files) > 10:
                    st.text(f"  ... 還有 {len(pdf_files) - 10} 個檔案")
            
            st.markdown("---")
            
            # 選擇要處理的檔案數量
            st.subheader("📊 萃取範圍設定")
            
            # 提供快速選項和自定義選項
            range_option = st.radio(
                "選擇處理範圍",
                options=["測試 (5個)", "小批次 (20個)", "中批次 (50個)", "全部", "自定義"],
                index=0,
                horizontal=True,
                help="選擇要處理的 PDF 檔案數量"
            )
            
            # 根據選項設定數量
            if range_option == "測試 (5個)":
                num_files_to_process = min(5, len(pdf_files))
            elif range_option == "小批次 (20個)":
                num_files_to_process = min(20, len(pdf_files))
            elif range_option == "中批次 (50個)":
                num_files_to_process = min(50, len(pdf_files))
            elif range_option == "全部":
                num_files_to_process = len(pdf_files)
            else:  # 自定義
                num_files_to_process = st.number_input(
                    "輸入要處理的檔案數量",
                    min_value=1,
                    max_value=len(pdf_files),
                    value=min(10, len(pdf_files)),
                    step=1
                )
            
            # 顯示將要處理的檔案
            if num_files_to_process < len(pdf_files):
                st.info(f"📝 將處理前 {num_files_to_process} 個檔案（共 {len(pdf_files)} 個）")
            else:
                st.success(f"📝 將處理全部 {num_files_to_process} 個檔案")
            
            # ⏰ 執行時間限制設定（用於 Cloud Run）
            st.markdown("### ⏰ 執行時間限制")
            enable_time_limit = st.checkbox(
                "啟用時間限制",
                value=False,
                help="適用於 Cloud Run 等有時間限制的環境。到達時間限制時會自動停止，下次執行會繼續處理剩餘檔案。"
            )
            
            max_runtime_minutes = None
            if enable_time_limit:
                max_runtime_minutes = st.slider(
                    "最大執行時間（分鐘）",
                    min_value=5,
                    max_value=55,
                    value=45,
                    step=5,
                    help="建議設定 45 分鐘，為 Cloud Run 的 60 分鐘限制留下安全邊際"
                )
                st.caption(f"⚠️ 執行將在 {max_runtime_minutes} 分鐘後自動停止，已處理的資料會被保存")
            
            st.markdown("---")
            
            # 檢查已存在的結果
            st.subheader("📋 萃取結果預覽")
            csv_file = EXTRACT_DIR / get_extract_filename(model_id)
            
            if csv_file.exists():
                df = pd.read_csv(csv_file, nrows=5)
                modified_time = datetime.fromtimestamp(csv_file.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
                st.warning(f"⚠️ 已存在萃取結果：`{csv_file.name}` ({len(pd.read_csv(csv_file))} 筆記錄, 更新於 {modified_time})")
                st.caption("點擊「開始萃取」將會覆蓋現有結果")
                
                with st.expander("查看現有結果（前 5 筆）"):
                    st.dataframe(df, use_container_width=True)
            else:
                st.info(f"✨ 尚未萃取此模型，結果將儲存為：`{csv_file.name}`")
            
            # 萃取按鈕
            if st.button("🚀 開始萃取", type="primary", use_container_width=True):
                st.markdown("---")
                st.subheader("萃取進度")
                
                st.write(f"### 🤖 {display_name}")
                
                # 準備輸出路徑
                output_csv = EXTRACT_DIR / get_extract_filename(model_id)
                output_jsonl = OUTPUT_DIR / get_jsonl_filename(model_id)
                
                # 進度條和狀態顯示
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                # 時間統計顯示
                col_time1, col_time2, col_time3 = st.columns(3)
                with col_time1:
                    time_elapsed = st.empty()
                with col_time2:
                    time_avg = st.empty()
                with col_time3:
                    time_remaining = st.empty()
                
                error_container = st.container()
                
                # 建立萃取器（傳入 GCP Project ID 和自訂 prompt）
                try:
                    import time
                    start_time = time.time()
                    
                    # 獲取自訂 prompt（如果有的話）
                    custom_prompt = st.session_state.get('system_prompt', SYSTEM_PROMPT)
                    
                    extractor = PDFExtractor(
                        model_config, 
                        gcp_project=gcp_project,
                        system_prompt=custom_prompt
                    )
                    
                    # 錯誤收集和統計（在函數外定義）
                    error_list = []
                    success_count = [0]  # 使用列表避免 nonlocal 問題
                    
                    def progress_callback(current, total, filename, status, error_msg=None):
                        progress = current / total
                        progress_bar.progress(progress)
                        
                        # 計算時間統計
                        elapsed = time.time() - start_time
                        elapsed_str = f"{int(elapsed // 60)}分 {int(elapsed % 60)}秒"
                        
                        # 更新時間顯示
                        time_elapsed.metric("⏱️ 已用時間", elapsed_str)
                        
                        if current > 0:
                            avg_time = elapsed / current
                            avg_str = f"{avg_time:.1f} 秒/個"
                            time_avg.metric("⚡ 平均速度", avg_str)
                            
                            # 預估剩餘時間
                            remaining_count = total - current
                            remaining_seconds = avg_time * remaining_count
                            remaining_str = f"{int(remaining_seconds // 60)}分 {int(remaining_seconds % 60)}秒"
                            time_remaining.metric("🕐 預估剩餘", remaining_str)
                        
                        if status == "success":
                            success_count[0] += 1
                            status_text.text(f"✅ [{current}/{total}] {filename}")
                        elif status == "error":
                            error_list.append({"file": filename, "error": error_msg})
                            # 顯示完整錯誤（不截斷）
                            status_text.text(f"❌ [{current}/{total}] {filename}")
                    
                    # 執行萃取（只處理選定數量的檔案）
                    selected_pdf_files = pdf_files[:num_files_to_process]
                    pdf_file_names = [pdf.name for pdf in selected_pdf_files]
                    
                    st.info(f"📌 開始處理 {len(pdf_file_names)} 個 PDF 檔案...")
                    
                    result_df = extractor.batch_extract(
                        pdf_files=pdf_file_names,
                        output_jsonl=output_jsonl,
                        output_csv=output_csv,
                        progress_callback=progress_callback,
                        max_runtime_minutes=max_runtime_minutes
                    )
                    
                    # 最終時間統計
                    total_time = time.time() - start_time
                    total_time_str = f"{int(total_time // 60)}分 {int(total_time % 60)}秒"
                    
                    # 完成訊息
                    st.markdown("---")
                    
                    # 顯示最終時間統計
                    col_final1, col_final2, col_final3 = st.columns(3)
                    with col_final1:
                        st.metric("⏱️ 總耗時", total_time_str)
                    with col_final2:
                        if success_count[0] > 0:
                            final_avg = total_time / success_count[0]
                            st.metric("⚡ 平均速度", f"{final_avg:.1f} 秒/個")
                    with col_final3:
                        st.metric("📊 處理數量", f"{success_count[0] + len(error_list)} 個")
                    
                    if success_count[0] > 0 and len(error_list) == 0:
                        st.success(f"🎉 全部成功！共萃取 {len(result_df)} 筆記錄")
                    elif success_count[0] > 0 and len(error_list) > 0:
                        st.warning(f"⚠️ 部分完成：成功 {success_count[0]} 個，失敗 {len(error_list)} 個")
                    else:
                        st.error(f"❌ 全部失敗！共 {len(error_list)} 個錯誤")
                    
                    st.write(f"  • CSV: `{output_csv.name}`")
                    st.write(f"  • JSONL: `{output_jsonl.name}`")
                    
                    # 顯示錯誤詳情
                    if error_list:
                        st.markdown("---")
                        st.subheader(f"❌ 錯誤詳情 ({len(error_list)} 個)")
                        
                        # 檢查是否有 403 權限錯誤
                        has_403 = any("403" in str(err["error"]) or "PERMISSION_DENIED" in str(err["error"]) for err in error_list)
                        
                        if has_403:
                            st.error("🔒 偵測到權限錯誤 (403 PERMISSION_DENIED)")
                            st.markdown("### 🔧 解決方法：")
                            st.code(f"""# 1. 確認你的帳號有 Vertex AI 使用權限
gcloud projects add-iam-policy-binding {gcp_project} \\
    --member='user:yangafu978@gmail.com' \\
    --role='roles/aiplatform.user'

# 2. 重新設定認證
gcloud auth application-default login

# 3. 確認 API 已啟用
gcloud services enable aiplatform.googleapis.com --project={gcp_project}

# 4. 檢查當前權限
gcloud projects get-iam-policy {gcp_project} \\
    --flatten='bindings[].members' \\
    --filter='bindings.members:yangafu978@gmail.com'""", language="bash")
                        
                        # 顯示前 10 個錯誤
                        with st.expander(f"📋 查看錯誤列表 (前 10 個)", expanded=True):
                            for i, err in enumerate(error_list[:10], 1):
                                st.markdown(f"**{i}. {err['file']}**")
                                st.code(err['error'], language="text")
                        
                        # 錯誤日誌檔案
                        error_log_file = output_jsonl.parent / f"{output_jsonl.stem}_errors.jsonl"
                        if error_log_file.exists():
                            st.info(f"📄 完整錯誤日誌已儲存：`{error_log_file.name}`")
                    
                    # 顯示預覽
                    if not result_df.empty:
                        with st.expander("查看萃取結果預覽 (前 20 筆)"):
                            st.dataframe(result_df.head(20))
                
                except Exception as e:
                    st.error(f"❌ 初始化失敗：{str(e)}")
                    import traceback
                    
                    # 特別處理 403 錯誤
                    error_str = str(e)
                    if "403" in error_str or "PERMISSION_DENIED" in error_str:
                        st.markdown("### 🔒 權限不足")
                        st.markdown(f"""你的帳號 `yangafu978@gmail.com` 沒有存取專案 `{gcp_project}` 的 Vertex AI 權限。

**解決步驟：**
1. 請專案管理員授予你 `Vertex AI User` 角色
2. 或使用有管理員權限的帳號執行：
""")
                        st.code(f"""gcloud projects add-iam-policy-binding {gcp_project} \\
    --member='user:yangafu978@gmail.com' \\
    --role='roles/aiplatform.user'""", language="bash")
                    
                    with st.expander("查看完整錯誤訊息", expanded=True):
                        st.code(traceback.format_exc())
    
    with col2:
        st.subheader("萃取說明")
        st.markdown("""
        ### 📝 操作步驟
        
        1. **輸入模型 ID**  
           在左側輸入框輸入模型參數名稱
           - 預設模型：可參考側邊欄列表
           - 自定義模型：輸入任意 Vertex AI 模型 ID
        
        2. **（選填）自訂檔名前綴**  
           設定萃取結果的檔名前綴
           - 留空則自動使用模型 ID
        
        3. **開始萃取**  
           點擊「開始萃取」按鈕
        
        4. **等待完成**  
           萃取過程中會顯示即時進度
        
        ### ⚠️ 注意事項
        
        - 萃取需要 **GCP 認證**
        - 會呼叫 **Vertex AI API**（產生費用）
        - 每個 PDF 平均需要 5-10 秒
        - **已存在的結果會被覆蓋**
        
        ### 💾 輸出檔案
        
        - **CSV**: `{前綴}_extract_v1.0.csv`
        - **JSONL**: `{前綴}_extract_v1.0.jsonl`
        - **位置**: 專案根目錄 / outputs 資料夾
        
        ### 📌 範例
        
        **範例 1: 使用預設模型**
        ```
        Model ID: gemini-2.0-flash-001
        前綴: (留空)
        結果: Gemini_2_0_flash_001_extract_v1.0.csv
        ```
        
        **範例 2: 自定義模型**
        ```
        Model ID: my-custom-model-001
        前綴: My_Test_Model
        結果: My_Test_Model_extract_v1.0.csv
        ```
        """)


# ============================================================================
# Tab 2: 準確度分析（使用 Checkbox 選擇檔案）
# ============================================================================
with tab2:
    st.header("📈 準確度分析與視覺化")
    
    # 載入基準資料
    ground_truth_path = GROUND_TRUTH_FILE
    if not ground_truth_path.exists():
        st.error(f"❌ 找不到基準資料：{ground_truth_path.name}")
        st.info(f"請確認檔案位於：{ground_truth_path}")
        st.stop()
    
    # 自動偵測編碼
    try:
        ground_truth_df = pd.read_csv(ground_truth_path, encoding='utf-8')
    except UnicodeDecodeError:
        try:
            ground_truth_df = pd.read_csv(ground_truth_path, encoding='big5')
        except UnicodeDecodeError:
            ground_truth_df = pd.read_csv(ground_truth_path, encoding='utf-8-sig')
    
    st.success(f"✅ 已載入基準資料 (NotebookLM): {len(ground_truth_df)} 筆記錄")
    
    st.markdown("---")
    
    # 尋找所有可用的萃取結果檔案
    st.subheader("📂 選擇要分析的模型萃取結果")
    
    all_csv_files = list(EXTRACT_DIR.glob("*_extract_*.csv"))
    
    if not all_csv_files:
        st.warning("⚠️ 找不到任何萃取結果檔案（*_extract_*.csv）")
        st.info("""
        請確認：
        - 檔案命名符合 `{模型ID}_extract_v{版本}.csv` 格式
        - 檔案位於專案根目錄
        - 或在「PDF 萃取」頁面執行萃取
        
        範例檔名：
        - claude-sonnet-4-5@20250929_extract_v1.0.csv
        - gemini-2.0-flash-001_extract_v1.0.csv
        """)
        st.stop()
    
    # 建立檔案資訊字典
    file_info = {}
    for csv_file in all_csv_files:
        try:
            df = pd.read_csv(csv_file, nrows=1)  # 只讀第一行檢查
            df_full = pd.read_csv(csv_file)
            model_id = extract_model_id_from_filename(csv_file.name)
            file_info[csv_file.name] = {
                'path': csv_file,
                'records': len(df_full),
                'modified': datetime.fromtimestamp(csv_file.stat().st_mtime).strftime('%Y-%m-%d %H:%M'),
                'model_id': model_id
            }
        except Exception as e:
            st.warning(f"⚠️ 無法讀取 {csv_file.name}: {e}")
    
    if not file_info:
        st.error("❌ 沒有可讀取的萃取結果檔案")
        st.stop()
    
    # 顯示檔案選擇（Checkbox）
    st.write(f"找到 {len(file_info)} 個萃取結果檔案，請勾選要分析的檔案：")
    
    selected_files = []
    
    # 使用 columns 排版
    num_cols = 2
    cols = st.columns(num_cols)
    
    for idx, (filename, info) in enumerate(file_info.items()):
        col = cols[idx % num_cols]
        with col:
            if st.checkbox(
                f"**{filename}**",
                value=True,
                key=f"select_{filename}"
            ):
                selected_files.append(filename)
            st.caption(f"📊 {info['records']} 筆 | 🕒 {info['modified']}")
            st.markdown("---")
    
    if not selected_files:
        st.warning("⚠️ 請至少選擇一個檔案進行分析")
        st.stop()
    
    st.info(f"✅ 已選擇 {len(selected_files)} 個檔案")
    
    # 分析按鈕
    col1, col2, col3 = st.columns([2, 1, 2])
    with col2:
        analyze_button = st.button("🔍 開始分析", type="primary", use_container_width=True)
    
    if analyze_button:
        with st.spinner("🔄 分析中，請稍候..."):
            try:
                # 建立分析器
                analyzer = AccuracyAnalyzer(ground_truth_df)
                
                # 載入選中的模型結果
                model_dfs = {}
                model_display_names = {}
                
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                for idx, filename in enumerate(selected_files):
                    info = file_info[filename]
                    status_text.text(f"載入 {filename}...")
                    
                    df = pd.read_csv(info['path'])
                    original_model_id = info['model_id']
                    
                    # 載入模型結果（會自動規範化模型名稱）
                    model_df = analyzer.load_model_result(df, original_model_id)
                    
                    # 使用規範化的模型名稱作為 key（與 notebook 一致）
                    normalized_model_id = analyzer._normalize_model_name(original_model_id)
                    model_dfs[normalized_model_id] = model_df
                    
                    # 設定顯示名稱（優先使用參考模型的 display_name）
                    if original_model_id in REFERENCE_MODELS:
                        model_display_names[normalized_model_id] = REFERENCE_MODELS[original_model_id]['display_name']
                    else:
                        model_display_names[normalized_model_id] = original_model_id  # 使用原始 model_id 顯示
                    
                    progress_bar.progress((idx + 1) / len(selected_files))
                
                progress_bar.empty()
                status_text.text("合併資料...")
                
                # 合併結果
                merged_df = analyzer.merge_results(model_dfs)
                
                status_text.text("計算準確度...")
                
                # 計算準確度
                accuracy_df, detailed_df = analyzer.calculate_accuracy(
                    merged_df,
                    list(model_dfs.keys())
                )
                
                # 計算姓名準確度
                name_accuracy_df = analyzer.calculate_name_accuracy(
                    merged_df,
                    list(model_dfs.keys())
                )
                
                # 合併姓名準確度
                full_accuracy_df = pd.concat([name_accuracy_df, accuracy_df], axis=0).reset_index(drop=True)
                
                status_text.empty()
                
                # 儲存到 session state
                st.session_state['accuracy_df'] = full_accuracy_df
                st.session_state['detailed_df'] = detailed_df
                st.session_state['model_names'] = list(model_dfs.keys())
                st.session_state['model_display_names'] = model_display_names
                st.session_state['selected_files'] = selected_files
                
                st.success("✅ 分析完成！")
                st.balloons()
                
            except Exception as e:
                st.error(f"❌ 分析失敗：{str(e)}")
                with st.expander("查看錯誤詳情"):
                    import traceback
                    st.code(traceback.format_exc())
    
    # 顯示分析結果
    if 'accuracy_df' in st.session_state:
        st.markdown("---")
        st.subheader("📊 分析結果")
        
        accuracy_df = st.session_state['accuracy_df']
        model_names = st.session_state['model_names']
        model_display_names = st.session_state['model_display_names']
        
        # 顯示已分析的檔案
        with st.expander(f"📑 本次分析的檔案 ({len(st.session_state.get('selected_files', []))} 個)"):
            for f in st.session_state.get('selected_files', []):
                st.text(f"  • {f}")
        
        # 摘要數據卡片
        st.markdown("### 📊 摘要統計")
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric("分析模型數", len(model_names))
        with col2:
            st.metric("基準記錄數", len(ground_truth_df))
        with col3:
            avg_accuracy = accuracy_df['完全一致率'].mean()
            st.metric("平均一致率", f"{avg_accuracy:.2%}")
        with col4:
            total_comparisons = len(accuracy_df)
            st.metric("比對項目數", total_comparisons)
        
        # 摘要表格
        st.markdown("### 📋 準確度摘要表")
        
        # 使用 Pandas Styler 美化表格
        def highlight_accuracy(val):
            """根據準確度值設定顏色"""
            if isinstance(val, (int, float)):
                if val >= 0.9:
                    color = '#d4edda'  # 綠色
                elif val >= 0.7:
                    color = '#fff3cd'  # 黃色
                else:
                    color = '#f8d7da'  # 紅色
                return f'background-color: {color}'
            return ''
        
        # 準備顯示用的 DataFrame
        display_df = accuracy_df.copy()
        
        # 添加紅綠燈指標
        def accuracy_indicator(val):
            if val >= 0.9:
                return '🟢'  # 綠燈
            elif val >= 0.7:
                return '🟡'  # 黃燈
            else:
                return '🔴'  # 紅燈
        
        display_df['狀態'] = display_df['完全一致率'].apply(accuracy_indicator)
        
        # 重新排列欄位順序
        display_df = display_df[['狀態', '模型', '欄位', '平均相似度', '完全一致率', '完全一致數', '完全不一致率', '完全不一致數', '總筆數']]
        
        # 套用樣式：顏色條 + 背景色
        styled_df = display_df.style.background_gradient(
            subset=['平均相似度', '完全一致率'],
            cmap='RdYlGn',  # 紅-黃-綠漸層
            vmin=0,
            vmax=1
        ).format({
            '平均相似度': '{:.4f}',
            '完全一致率': '{:.4f}',
            '完全不一致率': '{:.4f}',
            '完全一致數': '{:.0f}',
            '完全不一致數': '{:.0f}',
            '總筆數': '{:.0f}'
        })
        
        st.dataframe(styled_df, use_container_width=True, height=500)
        
        # 視覺化圖表
        st.markdown("### 📈 視覺化圖表")
        
        # 圖表1：完全一致率比較
        st.markdown("#### 1️⃣ 各模型在四個欄位的完全一致率比較")
        
        fields = ['NAME', 'SEX', 'DATE_OF_BIRTH_YEAR', 'PLACE_OF_BIRTH']
        field_labels = ['姓名\n(NAME)', '性別\n(SEX)', '生日年份\n(DATE_OF_BIRTH_YEAR)', '地址\n(PLACE_OF_BIRTH)']
        
        fig1, ax1 = plt.subplots(figsize=(16, 8))
        
        x_pos = np.arange(len(fields))
        width = 0.8 / max(len(model_names), 1)
        colors = ['#66BB6A', '#FFB74D', '#64B5F6', '#F06292', '#BA68C8', '#9C27B0']
        
        for idx, model in enumerate(model_names):
            model_data = []
            for field in fields:
                value = accuracy_df[
                    (accuracy_df['模型'] == model) &
                    (accuracy_df['欄位'] == field)
                ]['完全一致率'].values
                
                model_data.append(value[0] if len(value) > 0 else 0)
            
            offset = (idx - len(model_names)/2 + 0.5) * width
            bars = ax1.bar(x_pos + offset, model_data, width,
                          label=model_display_names.get(model, model),
                          color=colors[idx % len(colors)], alpha=0.85,
                          edgecolor='black', linewidth=0.5)
            
            # 添加數值標籤
            for bar in bars:
                height = bar.get_height()
                if height > 0:
                    ax1.text(bar.get_x() + bar.get_width()/2., height + 0.01,
                            f'{height:.3f}',
                            ha='center', va='bottom', fontsize=9, fontweight='bold')
        
        ax1.set_xlabel('比對欄位', fontsize=14, fontweight='bold', labelpad=10)
        ax1.set_ylabel('完全一致率', fontsize=14, fontweight='bold', labelpad=10)
        ax1.set_title('各模型與 NotebookLM 的完全一致率比較', fontsize=16, fontweight='bold', pad=20)
        ax1.set_xticks(x_pos)
        ax1.set_xticklabels(field_labels, fontsize=11)
        ax1.set_ylim(0, min(1.15, max([val for model in model_names for val in [accuracy_df[(accuracy_df['模型'] == model) & (accuracy_df['欄位'].isin(fields))]['完全一致率'].max()] if not accuracy_df[(accuracy_df['模型'] == model) & (accuracy_df['欄位'].isin(fields))].empty] + [1.0]) + 0.15))
        ax1.legend(fontsize=11, loc='lower left', framealpha=0.95, edgecolor='black')
        ax1.grid(axis='y', alpha=0.6, linestyle='--', linewidth=0.8)
        
        st.pyplot(fig1)
        plt.close(fig1)
        
        # 詳細比較表
        st.markdown("### 📊 詳細比較表")
        
        try:
            pivot_df = accuracy_df.pivot(
                index='欄位',
                columns='模型',
                values='完全一致率'
            )
            
            # 重命名列
            pivot_df.columns = [model_display_names.get(col, col) for col in pivot_df.columns]
            
            # 格式化為百分比
            pivot_df_display = pivot_df.applymap(lambda x: f'{x*100:.2f}%' if pd.notna(x) else '-')
            
            st.dataframe(pivot_df_display, use_container_width=True)
        except Exception as e:
            st.warning(f"無法生成比較表：{e}")
        
        # 下載結果
        st.markdown("### 💾 下載分析結果")
        
        col1, col2 = st.columns(2)
        
        with col1:
            csv_data = accuracy_df.to_csv(index=False, encoding='utf-8-sig')
            st.download_button(
                label="📥 下載準確度摘要 (CSV)",
                data=csv_data,
                file_name=f"accuracy_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True
            )
        
        with col2:
            detailed_csv = st.session_state['detailed_df'].to_csv(index=False, encoding='utf-8-sig')
            st.download_button(
                label="📥 下載詳細資料 (CSV)",
                data=detailed_csv,
                file_name=f"detailed_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True
            )

# ============================================================================
# Tab 3: 檔案管理
# ============================================================================
with tab3:
    st.header("📦 檔案管理")
    
    st.subheader("已萃取的模型結果")
    
    all_csv_files = list(EXTRACT_DIR.glob("*_extract_*.csv"))
    
    if not all_csv_files:
        st.info("尚未有任何萃取結果檔案")
    else:
        st.write(f"找到 {len(all_csv_files)} 個萃取結果檔案：")
        
        for csv_file in all_csv_files:
            with st.container():
                col1, col2, col3, col4 = st.columns([3, 2, 2, 1])
                
                with col1:
                    st.text(f"📄 {csv_file.name}")
                
                with col2:
                    try:
                        df = pd.read_csv(csv_file)
                        st.text(f"📊 {len(df)} 筆記錄")
                    except:
                        st.text("❌ 無法讀取")
                
                with col3:
                    modified_time = datetime.fromtimestamp(csv_file.stat().st_mtime)
                    st.text(f"🕒 {modified_time.strftime('%Y-%m-%d %H:%M')}")
                
                with col4:
                    if st.button("🗑️", key=f"delete_{csv_file.name}"):
                        csv_file.unlink()
                        st.success(f"已刪除 {csv_file.name}")
                        st.rerun()
                
                st.markdown("---")
    
    st.markdown("---")
    st.subheader("輸出檔案")
    
    if OUTPUT_DIR.exists():
        output_files = list(OUTPUT_DIR.glob("*"))
        st.write(f"找到 {len(output_files)} 個輸出檔案")
        
        if output_files:
            for output_file in output_files[:20]:
                st.text(f"  • {output_file.name}")
            if len(output_files) > 20:
                st.text(f"  ... 還有 {len(output_files) - 20} 個檔案")
    else:
        st.info("輸出資料夾不存在")
