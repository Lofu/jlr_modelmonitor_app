import os
from google import genai
from dashboard.config import GCP_PROJECT, GCP_LOCATION_GEMINI

def test_vertex_connection():
    print("=" * 50)
    print("🚀 Vertex AI (Gemini) 連線測試工具")
    print("=" * 50)
    
    # 檢查並清除有問題的環境變數，強制使用 ADC
    if 'GOOGLE_APPLICATION_CREDENTIALS' in os.environ:
        old_cred = os.environ['GOOGLE_APPLICATION_CREDENTIALS']
        print(f"⚠️ 偵測到您終端機仍殘留無效的憑證變數: {old_cred}")
        print("   -> 已在程式內臨時清除該變數，強制改用 Application Default Credentials (ADC)。\n")
        del os.environ['GOOGLE_APPLICATION_CREDENTIALS']
    else:
        print("🌍 未發現手動設定 GOOGLE_APPLICATION_CREDENTIALS。")
        print("   -> 已自動套用 Application Default Credentials (ADC)。\n")

    print(f"\n📂 目標專案: {GCP_PROJECT}")
    print(f"📍 所在區域: {GCP_LOCATION_GEMINI}")
    
    try:
        print("\n⏳ 正在建立 Vertex AI GenAI Client 的連線...")
        
        # 使用官方新版 google-genai 寫法（對應您的 extractor.py）
        client = genai.Client(
            vertexai=True, 
            project=GCP_PROJECT, 
            location=GCP_LOCATION_GEMINI
        )
        print("✅ 連線 Client 建立成功！")
        
        # 測試模型對話
        print("\n⏳ 正在呼叫 gemini-2.5-pro 測試連線回應...")
        model_name = "gemini-2.5-pro"
        prompt = "你好，請你用簡短的一句話回覆我：連線成功！"
        
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
        )
        
        print("\n" + "="*50)
        print("🎉 Vertex AI API 呼叫測試通過！")
        print("="*50)
        print(f"⭐ 模型回覆內容: \n{response.text.strip()}")
        print("="*50)
        
    except Exception as e:
        print("\n❌ 測試失敗！發生錯誤:")
        print(f"錯誤類型: {type(e).__name__}")
        print(f"錯誤訊息: {str(e)}")
        print("\n💡 提示:")
        print("1. 請確認 `gcloud auth application-default login` 已經執行過了。")
        print("2. 請確認該帳號有 `Vertex AI User` 的權限。")
        print("3. 請確認 GCP 專案中已經啟用 Vertex AI API。")

if __name__ == "__main__":
    test_vertex_connection()
