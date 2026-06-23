import pandas as pd
import numpy as np
import joblib
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score, mean_absolute_error, r2_score
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
    
    # Duration in hours — this is our ETR regression target
    df['duration_hours'] = (df['closed_datetime'] - df['start_datetime']).dt.total_seconds() / 3600.0
    # Fill missing durations with median
    median_duration = df['duration_hours'].median()
    df['duration_hours'] = df['duration_hours'].fillna(median_duration)
    # Clamp ETR to realistic range: 15 minutes to 24 hours
    df['duration_hours'] = df['duration_hours'].clip(lower=0.25, upper=24.0)
    
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
    y_class = df['impact_severity']
    y_etr = df['duration_hours']
    
    # Convert boolean to int
    X['requires_road_closure'] = X['requires_road_closure'].astype(int)
    
    # Encode categorical variables
    encoders = {}
    categorical_cols = ['event_cause', 'event_type', 'priority']
    
    for col in categorical_cols:
        le = LabelEncoder()
        X[col] = le.fit_transform(X[col].astype(str))
        encoders[col] = le
        
    # Also encode the classification target
    target_le = LabelEncoder()
    y_class_encoded = target_le.fit_transform(y_class)
    encoders['target'] = target_le
    
    # Handle remaining NaNs
    X = X.fillna(0)
    
    return X, y_class_encoded, y_etr, encoders, df


def train_severity_classifier(X, y):
    """Train the Random Forest Classifier for impact severity prediction."""
    print("\n--- Training Severity Classifier (RandomForestClassifier) ---")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    clf = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=10)
    clf.fit(X_train, y_train)
    
    print("Evaluating Classifier...")
    y_pred = clf.predict(X_test)
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))
    
    return clf


def train_etr_regressor(X, y_etr):
    """Train the Random Forest Regressor for Estimated Time to Resolution (ETR)."""
    print("\n--- Training ETR Regressor (RandomForestRegressor) ---")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_etr, test_size=0.2, random_state=42
    )
    
    reg = RandomForestRegressor(n_estimators=100, random_state=42, max_depth=10)
    reg.fit(X_train, y_train)
    
    print("Evaluating Regressor...")
    y_pred = reg.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    print(f"Mean Absolute Error: {mae:.4f} hours")
    print(f"R² Score:            {r2:.4f}")
    
    return reg


if __name__ == "__main__":
    file_path = 'dataset.csv'
    X, y_class_encoded, y_etr, encoders, raw_df = load_and_preprocess(file_path)
    
    # Train both models
    clf_model = train_severity_classifier(X, y_class_encoded)
    etr_model = train_etr_regressor(X, y_etr)
    
    # Save all artifacts
    print("\nSaving models and encoders...")
    joblib.dump(clf_model, 'impact_model.pkl')
    joblib.dump(etr_model, 'etr_model.pkl')
    joblib.dump(encoders, 'encoders.pkl')
    
    print("\n[DONE] All models saved successfully!")
    print("  -> impact_model.pkl  (Severity Classifier)")
    print("  -> etr_model.pkl     (ETR Regressor)")
    print("  -> encoders.pkl      (Label Encoders)")
