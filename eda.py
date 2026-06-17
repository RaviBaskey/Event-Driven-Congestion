import pandas as pd

df = pd.read_csv('dataset.csv')
print("Columns:", df.columns.tolist())
print("\nEvent types:", df['event_type'].unique())
print("\nEvent causes:", df['event_cause'].unique())
print("\nRequires road closure:", df['requires_road_closure'].unique())
print("\nPriority:", df['priority'].unique())
print("\nMissing values:")
print(df.isnull().sum().sort_values(ascending=False).head(20))
