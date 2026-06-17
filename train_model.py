import pandas as pd
import numpy as np
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score
import warnings
warnings.filterwarnings('ignore')

def load_and_preprocess(file_path):
    print("Loading dataset...")
    df = pd.read_csv(file_path)
    
    print("Preprocessing data...")
    # Convert datetime columns
    df['start_datetime'] = pd.to_datetime(df['start_datetime'], errors='coerce')
    df['closed_datetime'] = pd.to_datetime(df['closed_datetime'], errors='coerce')
    
    # Feature Engineering
    df['hour'] = df['start_datetime'].dt.hour
    df['day_of_week'] = df['start_datetime'].dt.dayofweek
    df['month'] = df['start_datetime'].dt.month
    
    # Duration in hours
    df['duration_hours'] = (df['closed_datetime'] - df['start_datetime']).dt.total_seconds() / 3600.0
    # Fill missing durations with median
    median_duration = df['duration_hours'].median()
    df['duration_hours'] = df['duration_hours'].fillna(median_duration)
    
    # Handle missing values for categorical features
    df['event_cause'] = df['event_cause'].fillna('unknown')
    df['priority'] = df['priority'].fillna('Low')
    df['corridor'] = df['corridor'].fillna('Non-corridor')
    
    # Create Proxy Target: impact_severity
    print("Generating proxy target 'impact_severity'...")
    conditions = [
        (df['requires_road_closure'] == True) | (df['duration_hours'] > 4),
        (df['priority'] == 'High') | (df['duration_hours'] > 1.5)
    ]
    choices = ['High', 'Medium']
    df['impact_severity'] = np.select(conditions, choices, default='Low')
    
    # Select features for the model
    features = ['event_cause', 'event_type', 'priority', 'requires_road_closure', 
                'hour', 'day_of_week', 'month']
    
    X = df[features].copy()
    y = df['impact_severity']
    
    # Convert boolean to int
    X['requires_road_closure'] = X['requires_road_closure'].astype(int)
    
    # Encode categorical variables
    encoders = {}
    categorical_cols = ['event_cause', 'event_type', 'priority']
    
    for col in categorical_cols:
        le = LabelEncoder()
        # Convert to string and handle unseen classes during prediction later
        X[col] = le.fit_transform(X[col].astype(str))
        encoders[col] = le
        
    # Also encode the target
    target_le = LabelEncoder()
    y_encoded = target_le.fit_transform(y)
    encoders['target'] = target_le
    
    # Handle remaining NaNs
    X = X.fillna(0)
    
    return X, y_encoded, encoders, df

def train_model(X, y):
    print("Training Random Forest Classifier...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    clf = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=10)
    clf.fit(X_train, y_train)
    
    print("Evaluating Model...")
    y_pred = clf.predict(X_test)
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
    
    return clf

if __name__ == "__main__":
    file_path = 'dataset.csv'
    X, y_encoded, encoders, raw_df = load_and_preprocess(file_path)
    
    model = train_model(X, y_encoded)
    
    # Save the model and encoders
    print("Saving model and encoders...")
    joblib.dump(model, 'impact_model.pkl')
    joblib.dump(encoders, 'encoders.pkl')
    print("Done! Model saved as 'impact_model.pkl'")
