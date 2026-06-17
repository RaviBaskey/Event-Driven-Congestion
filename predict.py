import pandas as pd
import joblib

def recommend_resources(severity):
    """Rule-based engine to recommend resources based on predicted severity."""
    if severity == 'High':
        return {
            'Manpower': '5+ Traffic Police Personnel',
            'Barricading': 'Heavy Barricading Required',
            'Diversion Plan': 'Major Route Diversion Needed'
        }
    elif severity == 'Medium':
        return {
            'Manpower': '2-4 Traffic Police Personnel',
            'Barricading': 'Moderate Barricading (Local)',
            'Diversion Plan': 'Minor/Local Diversion Recommended'
        }
    else: # Low
        return {
            'Manpower': '1 Traffic Police Personnel',
            'Barricading': 'Not Required',
            'Diversion Plan': 'No Diversion Needed'
        }

def predict_event_impact(input_data, model_path='impact_model.pkl', encoder_path='encoders.pkl'):
    try:
        model = joblib.load(model_path)
        encoders = joblib.load(encoder_path)
    except FileNotFoundError:
        print("Model files not found. Please run train_model.py first.")
        return

    # Convert input to DataFrame
    df = pd.DataFrame([input_data])
    
    # Feature engineering for input (extract hour, day, month if start_datetime is provided)
    if 'start_datetime' in df.columns:
        dt = pd.to_datetime(df['start_datetime'])
        df['hour'] = dt.dt.hour
        df['day_of_week'] = dt.dt.dayofweek
        df['month'] = dt.dt.month
        df = df.drop(columns=['start_datetime'])
    
    # Fill missing with defaults
    default_vals = {
        'event_cause': 'unknown',
        'event_type': 'unplanned',
        'priority': 'Low',
        'requires_road_closure': False,
        'hour': 12,
        'day_of_week': 0,
        'month': 1
    }
    
    for col, default in default_vals.items():
        if col not in df.columns:
            df[col] = default
            
    # Ensure correct types and ordering
    features = ['event_cause', 'event_type', 'priority', 'requires_road_closure', 
                'hour', 'day_of_week', 'month']
    df = df[features]
    
    # Encode categorical features safely
    categorical_cols = ['event_cause', 'event_type', 'priority']
    for col in categorical_cols:
        le = encoders.get(col)
        # Handle unseen labels by assigning a default class (e.g., 0) if not in classes
        df[col] = df[col].astype(str).map(lambda s: s if s in le.classes_ else le.classes_[0])
        df[col] = le.transform(df[col])
        
    df['requires_road_closure'] = df['requires_road_closure'].astype(int)
    
    # Predict
    pred_encoded = model.predict(df)[0]
    
    # Decode target
    target_le = encoders['target']
    severity = target_le.inverse_transform([pred_encoded])[0]
    
    print(f"\n--- Event Analysis ---")
    print(f"Input Data: {input_data}")
    print(f"Predicted Impact Severity: {severity}")
    
    # Get Recommendations
    recommendations = recommend_resources(severity)
    print("\n--- Recommended Actions ---")
    for k, v in recommendations.items():
        print(f"- {k}: {v}")

if __name__ == "__main__":
    # Test case 1: A major breakdown requiring road closure during peak hours
    sample_event_1 = {
        'start_datetime': '2024-03-07 18:30:00',
        'event_cause': 'vehicle_breakdown',
        'event_type': 'unplanned',
        'priority': 'High',
        'requires_road_closure': True
    }
    
    # Test case 2: A minor pothole issue early in the morning
    sample_event_2 = {
        'start_datetime': '2024-01-30 04:00:00',
        'event_cause': 'pot_holes',
        'event_type': 'unplanned',
        'priority': 'Low',
        'requires_road_closure': False
    }

    print("Running Sample Predictions...")
    predict_event_impact(sample_event_1)
    predict_event_impact(sample_event_2)
