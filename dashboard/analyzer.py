"""
分析服務模組
負責比對模型萃取結果與基準資料，計算準確度
"""
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np

from .config import ANALYSIS_FIELDS, BASE_DIR


class AccuracyAnalyzer:
    """準確度分析器"""
    
    def __init__(self, ground_truth_df: pd.DataFrame):
        """
        初始化分析器
        
        Args:
            ground_truth_df: 基準資料 (NotebookLM)
        """
        self.ground_truth_df = ground_truth_df.copy()
        
        # 標準化欄位名稱
        if '檔案名稱' in self.ground_truth_df.columns:
            self.ground_truth_df.rename(columns={
                '檔案名稱': 'file_name',
                '被告人姓名': 'NAME',
                '被告人生日': 'notebookLM_DATE_OF_BIRTH',
                '被告人性別': 'notebookLM_SEX',
                '被告人出生地': 'notebookLM_PLACE_OF_BIRTH'
            }, inplace=True)
    
    @staticmethod
    def _normalize_model_name(model_name: str) -> str:
        """
        統一模型名稱格式（與 notebook 一致）
        
        Args:
            model_name: 原始模型名稱（如 gemini-2.5-pro, claude-sonnet-4-5@20250929）
        
        Returns:
            標準化的模型名稱（如 gemini_2.5, claude_sonnet_4.5）
        
        Examples:
            gemini-2.5-pro -> gemini_2.5
            gemini-2.0-flash-001 -> flash_2.0
            claude-sonnet-4-5@20250929 -> claude_sonnet_4.5
            claude-sonnet-4-6@20241022 -> claude_sonnet_4.6
        """
        import re
        
        # 移除 @ 後面的部分（日期版本號）
        model_name = model_name.split('@')[0]
        
        # 根據模型類型轉換
        if 'gemini-2.5' in model_name:
            return 'gemini_2.5'
        elif 'gemini-2.0-flash' in model_name or 'flash' in model_name.lower():
            return 'flash_2.0'
        elif 'gemini-3.1' in model_name or 'gemini-exp' in model_name:
            return 'gemini_3.1'
        elif 'claude-sonnet-4-5' in model_name or 'claude-sonnet-4.5' in model_name:
            return 'claude_sonnet_4.5'
        elif 'claude-sonnet-4-6' in model_name or 'claude-sonnet-4.6' in model_name:
            return 'claude_sonnet_4.6'
        else:
            # 一般情況：將 - 替換為 _
            return model_name.replace('-', '_')
    
    def load_model_result(self, source, model_name: str) -> pd.DataFrame:
        """
        載入模型萃取結果
        
        Args:
            source: CSV 檔案路徑 (Path) 或 DataFrame
            model_name: 模型名稱 (用於欄位重命名)
        
        Returns:
            處理後的 DataFrame
        """
        # 🔧 統一模型名稱格式（與 notebook 一致）
        # gemini-2.5-pro -> gemini_2.5
        # claude-sonnet-4-5@20250929 -> claude_sonnet_4.5
        normalized_model_name = self._normalize_model_name(model_name)
        
        # 如果是 Path，讀取 CSV；如果是 DataFrame，直接使用
        if isinstance(source, Path):
            df = pd.read_csv(source)
        elif isinstance(source, pd.DataFrame):
            df = source.copy()
        else:
            df = pd.read_csv(str(source))
        
        # 🔧 修正舊格式的 CASE_LINK（從 local:// 轉換為標準 URL）
        if 'CASE_LINK' in df.columns and 'DOC_ID' in df.columns:
            # 檢查是否有 local:// 格式
            local_mask = df['CASE_LINK'].str.startswith('local://', na=False)
            if local_mask.any():
                # 將 local://xxx.pdf 格式轉換為標準 URL
                df.loc[local_mask, 'CASE_LINK'] = df.loc[local_mask, 'DOC_ID'].apply(
                    lambda x: f'https://congbobanan.toaan.gov.vn/{x}/chi-tiet-ban-an'
                )
        
        # 提取 file_name（與 notebook 處理邏輯一致）
        if 'CASE_LINK' in df.columns:
            # 從標準 URL 格式提取：https://congbobanan.toaan.gov.vn/{doc_id}/chi-tiet-ban-an
            file_names = df['CASE_LINK'].str.extract(r'\.vn/([^/]+)/chi')[0]
            # 如果提取成功，添加 .pdf 後綴
            df['file_name'] = file_names.apply(lambda x: f'{x}.pdf' if pd.notna(x) else None)
            # 如果提取失敗（例如 local:// 格式），嘗試從 DOC_ID 生成
            if df['file_name'].isna().any() and 'DOC_ID' in df.columns:
                df.loc[df['file_name'].isna(), 'file_name'] = df.loc[df['file_name'].isna(), 'DOC_ID'] + '.pdf'
        elif 'DOC_ID' in df.columns:
            df['file_name'] = df['DOC_ID'] + '.pdf'
        
        # 只保留需要的欄位並重命名（使用標準化的模型名稱）
        rename_map = {
            'NAME_NEW_EXTRACT': 'NAME',
            'SEX_NEW_EXTRACT': f'{normalized_model_name}_SEX',
            'DATE_OF_BIRTH_NEW_EXTRACT': f'{normalized_model_name}_DATE_OF_BIRTH',
            'PLACE_OF_BIRTH_NEW_EXTRACT': f'{normalized_model_name}_PLACE_OF_BIRTH',
            'CASE_LINK': f'CASE_LINK_{normalized_model_name}'
        }
        
        # 如果沒有 _NEW_EXTRACT 後綴，使用原始欄位名
        if 'NAME_NEW_EXTRACT' not in df.columns and 'NAME' in df.columns:
            rename_map = {
                'NAME': 'NAME',
                'SEX': f'{normalized_model_name}_SEX',
                'DATE_OF_BIRTH': f'{normalized_model_name}_DATE_OF_BIRTH',
                'PLACE_OF_BIRTH': f'{normalized_model_name}_PLACE_OF_BIRTH',
                'CASE_LINK': f'CASE_LINK_{normalized_model_name}'
            }
        
        df = df.rename(columns=rename_map)
        
        # 選擇欄位
        selected_cols = ['file_name', 'NAME']
        for col in df.columns:
            if normalized_model_name in col:
                selected_cols.append(col)
        
        return df[selected_cols]
    
    def merge_results(self, model_dfs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        """
        合併所有模型結果
        
        Args:
            model_dfs: {model_name: DataFrame} 字典
        
        Returns:
            合併後的 DataFrame
        """
        merged = self.ground_truth_df.copy()
        
        for model_name, model_df in model_dfs.items():
            merged = merged.merge(
                model_df,
                on=['file_name', 'NAME'],
                how='left'
            )
        
        return merged
    
    @staticmethod
    def is_null_value(val) -> bool:
        """檢查是否為空值"""
        if pd.isna(val) or val is None:
            return True
        if isinstance(val, str) and val.strip() == "":
            return True
        if str(val).lower() in ['nan', 'none', 'null', '未提及', '未提到', '无', '無']:
            return True
        return False
    
    @staticmethod
    def exact_match(val1, val2) -> float:
        """精確匹配"""
        is_null1 = AccuracyAnalyzer.is_null_value(val1)
        is_null2 = AccuracyAnalyzer.is_null_value(val2)
        
        if is_null1 and is_null2:
            return 1.0
        if is_null1 or is_null2:
            return 0.0
        
        str1 = str(val1).strip()
        str2 = str(val2).strip()
        
        # 嘗試數字比較
        try:
            num1 = float(str1)
            num2 = float(str2)
            if num1 == int(num1) and num2 == int(num2):
                return 1.0 if int(num1) == int(num2) else 0.0
            else:
                return 1.0 if num1 == num2 else 0.0
        except (ValueError, TypeError):
            return 1.0 if str1 == str2 else 0.0
    
    @staticmethod
    def extract_year(date_str) -> Optional[str]:
        """從日期字串中提取年份"""
        if AccuracyAnalyzer.is_null_value(date_str):
            return None
        
        date_str = str(date_str).strip()
        year_pattern = r'\b(19\d{2}|20\d{2})\b'
        match = re.search(year_pattern, date_str)
        
        return match.group(1) if match else None
    
    @staticmethod
    def year_match(date1, date2) -> float:
        """年份匹配（特殊規則：yyyy-01-01 可與 yyyy 視為相同）"""
        if AccuracyAnalyzer.is_null_value(date1) and AccuracyAnalyzer.is_null_value(date2):
            return 1.0
        if AccuracyAnalyzer.is_null_value(date1) or AccuracyAnalyzer.is_null_value(date2):
            return 0.0
        
        str1 = str(date1).strip()
        str2 = str(date2).strip()
        
        if str1 == str2:
            return 1.0
        
        is_pure_year = lambda s: re.match(r'^\d{4}$', s) is not None
        is_year_jan_first = lambda s: re.match(r'^\d{4}-01-01$', s) is not None
        
        year1 = AccuracyAnalyzer.extract_year(str1)
        year2 = AccuracyAnalyzer.extract_year(str2)
        
        if year1 is None or year2 is None:
            return 0.0
        
        if year1 != year2:
            return 0.0
        
        # 年份相同，檢查特殊規則
        if is_pure_year(str1) and not is_pure_year(str2):
            return 1.0 if is_year_jan_first(str2) else 0.0
        if is_pure_year(str2) and not is_pure_year(str1):
            return 1.0 if is_year_jan_first(str1) else 0.0
        if is_pure_year(str1) and is_pure_year(str2):
            return 1.0
        
        return 0.0
    
    @staticmethod
    def jaccard_similarity(str1, str2, n: int = 3) -> float:
        """Jaccard 相似度（基於 n-gram）"""
        is_null1 = AccuracyAnalyzer.is_null_value(str1)
        is_null2 = AccuracyAnalyzer.is_null_value(str2)
        
        if is_null1 and is_null2:
            return 1.0
        if is_null1 or is_null2:
            return 0.0
        
        str1 = str(str1).lower().strip()
        str2 = str(str2).lower().strip()
        
        if str1 == str2:
            return 1.0
        
        def get_ngrams(text, n):
            text = " " + text + " "
            if len(text) < n:
                return {text}
            return {text[i:i+n] for i in range(len(text) - n + 1)}
        
        tokens1 = get_ngrams(str1, n)
        tokens2 = get_ngrams(str2, n)
        intersection = tokens1.intersection(tokens2)
        union = tokens1.union(tokens2)
        
        if len(union) == 0:
            return 0.0
        
        return len(intersection) / len(union)
    
    def calculate_accuracy(
        self,
        merged_df: pd.DataFrame,
        model_names: List[str]
    ) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        計算各模型的準確度
        
        Args:
            merged_df: 合併後的 DataFrame
            model_names: 模型名稱列表
        
        Returns:
            (準確度摘要 DataFrame, 帶有相似度分數的完整 DataFrame)
        """
        merged_df = merged_df.copy()
        results = []
        
        # 資料標準化
        for model in model_names:
            for field in ['SEX', 'DATE_OF_BIRTH', 'PLACE_OF_BIRTH']:
                model_col = f"{model}_{field}"
                notebooklm_col = f"notebookLM_{field}"
                
                if model_col not in merged_df.columns:
                    continue
                
                if field == 'SEX':
                    # 性別統一轉為整數字串
                    def normalize_sex(val):
                        if pd.isna(val):
                            return val
                        try:
                            num = float(val)
                            if num == int(num):
                                return str(int(num))
                            return str(num)
                        except (ValueError, TypeError):
                            return str(val).strip()
                    
                    merged_df[model_col] = merged_df[model_col].apply(normalize_sex)
                    merged_df[notebooklm_col] = merged_df[notebooklm_col].apply(normalize_sex)
                
                elif field == 'PLACE_OF_BIRTH':
                    # 出生地：未提及轉空字串
                    def normalize_place(val):
                        if pd.isna(val):
                            return ''
                        val_str = str(val).strip()
                        if val_str.lower() in ['未提及', '未提到', '无', '無', 'nan', 'none', 'null', '']:
                            return ''
                        return val_str
                    
                    merged_df[model_col] = merged_df[model_col].apply(normalize_place)
                    merged_df[notebooklm_col] = merged_df[notebooklm_col].apply(normalize_place)
                
                else:
                    merged_df[model_col] = merged_df[model_col].fillna('').astype(str).str.strip()
                    merged_df[notebooklm_col] = merged_df[notebooklm_col].fillna('').astype(str).str.strip()
        
        # 計算各模型各欄位的準確度
        fields = ['SEX', 'DATE_OF_BIRTH', 'DATE_OF_BIRTH_YEAR', 'PLACE_OF_BIRTH']
        
        for model in model_names:
            for field in fields:
                # DATE_OF_BIRTH_YEAR 使用 DATE_OF_BIRTH 的數據
                if field == 'DATE_OF_BIRTH_YEAR':
                    model_col = f"{model}_DATE_OF_BIRTH"
                    notebooklm_col = "notebookLM_DATE_OF_BIRTH"
                else:
                    model_col = f"{model}_{field}"
                    notebooklm_col = f"notebookLM_{field}"
                
                if model_col not in merged_df.columns:
                    continue
                
                # 選擇比較方法
                if field == 'SEX' or field == 'DATE_OF_BIRTH':
                    similarity_scores = merged_df.apply(
                        lambda row: self.exact_match(row[model_col], row[notebooklm_col]),
                        axis=1
                    )
                elif field == 'DATE_OF_BIRTH_YEAR':
                    similarity_scores = merged_df.apply(
                        lambda row: self.year_match(row[model_col], row[notebooklm_col]),
                        axis=1
                    )
                else:  # PLACE_OF_BIRTH
                    similarity_scores = merged_df.apply(
                        lambda row: self.jaccard_similarity(row[model_col], row[notebooklm_col], n=3),
                        axis=1
                    )
                
                # 儲存相似度分數
                merged_df[f'{model}_{field}_similarity'] = similarity_scores
                
                # 統計結果
                total_count = len(merged_df)
                
                if field == 'PLACE_OF_BIRTH':
                    # 出生地：只計算雙方都有值的記錄
                    valid_mask = (merged_df[model_col] != '') & (merged_df[notebooklm_col] != '')
                    valid_scores = similarity_scores[valid_mask]
                    
                    avg_similarity = valid_scores.mean() if len(valid_scores) > 0 else 0.0
                    median_similarity = valid_scores.median() if len(valid_scores) > 0 else 0.0
                    exact_match_count = (similarity_scores == 1.0).sum()
                    exact_mismatch_count = (similarity_scores == 0.0).sum()
                    
                    results.append({
                        '模型': model,
                        '欄位': field,
                        '平均相似度': avg_similarity,
                        '中位數相似度': median_similarity,
                        '完全一致數': exact_match_count,
                        '完全一致率': exact_match_count / total_count,
                        '完全不一致數': exact_mismatch_count,
                        '完全不一致率': exact_mismatch_count / total_count,
                        '總筆數': total_count
                    })
                else:
                    results.append({
                        '模型': model,
                        '欄位': field,
                        '平均相似度': similarity_scores.mean(),
                        '中位數相似度': similarity_scores.median(),
                        '完全一致數': (similarity_scores == 1.0).sum(),
                        '完全一致率': (similarity_scores == 1.0).sum() / total_count,
                        '完全不一致數': (similarity_scores == 0.0).sum(),
                        '完全不一致率': (similarity_scores == 0.0).sum() / total_count,
                        '總筆數': total_count
                    })
        
        return pd.DataFrame(results), merged_df
    
    def calculate_name_accuracy(
        self,
        merged_df: pd.DataFrame,
        model_names: List[str]
    ) -> pd.DataFrame:
        """
        計算姓名匹配準確度（使用精確匹配，與 Notebook 一致）
        
        Args:
            merged_df: 合併後的 DataFrame
            model_names: 模型名稱列表
        
        Returns:
            姓名準確度 DataFrame
        """
        results = []
        total_records = len(merged_df)
        
        for model in model_names:
            # 使用 NAME 欄位進行精確匹配，而不是 CASE_LINK
            # 注意：NAME 欄位在 merge 時是用於 join 的欄位，所以一定存在
            # 我們需要檢查該模型是否有成功萃取出資料（CASE_LINK 不為空）
            case_link_col = f"CASE_LINK_{model}"
            
            if case_link_col in merged_df.columns:
                # 只計算該模型有成功處理的記錄（CASE_LINK 不為 NaN）
                # 因為 merge 是基於 NAME 做的，所以這些記錄的 NAME 就是完全一致的
                na_count = merged_df[case_link_col].isna().sum()
                matched_count = total_records - na_count
                
                # 完全一致數 = 成功 merge 的數量
                # 因為 merge 的 key 就是 NAME，能 merge 上就代表 NAME 一致
                results.append({
                    '模型': model,
                    '欄位': 'NAME',
                    '平均相似度': matched_count / total_records,
                    '中位數相似度': matched_count / total_records,
                    '完全一致數': matched_count,
                    '完全一致率': matched_count / total_records,
                    '完全不一致數': na_count,
                    '完全不一致率': na_count / total_records,
                    '總筆數': total_records
                })
        
        return pd.DataFrame(results)
