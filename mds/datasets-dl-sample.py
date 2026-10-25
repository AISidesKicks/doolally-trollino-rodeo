import pandas as pd
from datasets import load_dataset

def build_high_risk_dataset():
    print("🔄 Loading datasets from Hugging Face...")
    
    # 1. Load Yahoo Answers (10 Categories)
    # Mapping: 2 = Business & Finance, 6 = Health, 7 = Politics & Government
    yahoo = load_dataset("yassiracharki/Yahoo_Answers_10_categories_for_NLP", split="train")
    df_yahoo = yahoo.to_pandas()
    
    # 2. Load AG News (4 Categories)
    # Mapping: 2 = Business (Finance/Crypto), 3 = Sci/Tech (Has strong Medical/Health overlap)
    ag_news = load_dataset("fancyzhx/ag_news", split="train")
    df_ag = ag_news.to_pandas()

    print("✂️ Filtering and mapping target categories...")
    compiled_data = []

    # --- CATEGORY 1: Politics & Elections ---
    yahoo_politics = df_yahoo[df_yahoo['label'] == 7].copy()
    for text in yahoo_politics['text'].dropna().head(10000):
        compiled_data.append({"text": text, "label": "Politics & Elections"})

    # --- CATEGORY 2: Medical & Health ---
    yahoo_health = df_yahoo[df_yahoo['label'] == 6].copy()
    for text in yahoo_health['text'].dropna().head(10000):
        compiled_data.append({"text": text, "label": "Medical & Health"})

    # --- CATEGORY 3: Financial & Crypto ---
    yahoo_finance = df_yahoo[df_yahoo['label'] == 2].copy()
    for text in yahoo_finance['text'].dropna().head(10000):
        compiled_data.append({"text": text, "label": "Financial & Crypto"})
        
    ag_finance = df_ag[df_ag['label'] == 2].copy() # 2 is Business in AG News
    for text in ag_finance['text'].dropna().head(5000):
        compiled_data.append({"text": text, "label": "Financial & Crypto"})

    # --- CATEGORY 4: Legal & Regulatory ---
    # Legal is often intertwined with Business/Gov text in public news benchmarks.
    # We sample instances containing high-density legal keywords.
    legal_keywords = ['court', 'lawsuit', 'sued', 'compliance', 'regulation', 'attorney', 'judge', 'illegal', 'contract']
    legal_pattern = '|'.join(legal_keywords)
    
    # Extract legal contexts from Yahoo Government and AG Business classes
    yahoo_gov = df_yahoo[df_yahoo['label'] == 7]
    yahoo_legal = yahoo_gov[yahoo_gov['text'].str.contains(legal_pattern, case=False, na=False)]
    for text in yahoo_legal['text'].head(5000):
        compiled_data.append({"text": text, "label": "Legal & Regulatory"})

    ag_biz = df_ag[df_ag['label'] == 2]
    ag_legal = ag_biz[ag_biz['text'].str.contains(legal_pattern, case=False, na=False)]
    for text in ag_legal['text'].head(5000):
        compiled_data.append({"text": text, "label": "Legal & Regulatory"})

    # Create Final DataFrame
    final_df = pd.DataFrame(compiled_data)
    
    # Shuffle dataset to mix categories
    final_df = final_df.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print("\n✅ Dataset compilation successful!")
    print(f"📊 Total records collected: {len(final_df)}")
    print("\nClass Distribution:")
    print(final_df['label'].value_counts())
    
    # Save output
    final_df.to_csv("high_risk_topical_context_dataset.csv", index=False)
    print("\n💾 Saved as 'high_risk_topical_context_dataset.csv'")
    
    return final_df

if __name__ == "__main__":
    # Ensure you have run: pip install datasets pandas pyarrow
    df = build_high_risk_dataset()
