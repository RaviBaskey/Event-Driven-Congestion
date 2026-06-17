from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import joblib
import os

app = FastAPI()

# Mount the static directory
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# Load Models
MODEL_PATH = 'impact_model.pkl'
ENCODERS_PATH = 'encoders.pkl'

try:
    model = joblib.load(MODEL_PATH)
    encoders = joblib.load(ENCODERS_PATH)
    print("Model and Encoders loaded successfully.")
except Exception as e:
    print(f"Warning: Could not load models. Ensure train_model.py has been run. Error: {e}")
    model, encoders = None, None

class EventInput(BaseModel):
    event_cause: str
    event_type: str = 'unplanned'
    priority: str = 'Low'
    requires_road_closure: bool = False
    start_datetime: str # format: YYYY-MM-DD HH:MM:SS
    latitude: Optional[float] = None
    longitude: Optional[float] = None

def recommend_resources(severity):
    if severity == 'High':
        return {
            'Manpower': '5+ Traffic Police Personnel',
            'Barricading': 'Heavy Barricading Required',
            'DiversionPlan': 'Major Route Diversion Needed'
        }
    elif severity == 'Medium':
        return {
            'Manpower': '2-4 Traffic Police Personnel',
            'Barricading': 'Moderate Barricading (Local)',
            'DiversionPlan': 'Minor/Local Diversion Recommended'
        }
    else: # Low
        return {
            'Manpower': '1 Traffic Police Personnel',
            'Barricading': 'Not Required',
            'DiversionPlan': 'No Diversion Needed'
        }

@app.post("/api/predict")
async def predict_impact(event: EventInput):
    if model is None or encoders is None:
        raise HTTPException(status_code=500, detail="Machine learning models are not loaded.")

    try:
        df = pd.DataFrame([event.dict()])
        
        # Feature engineering
        dt = pd.to_datetime(df['start_datetime'].iloc[0])
        df['hour'] = dt.hour
        df['day_of_week'] = dt.dayofweek
        df['month'] = dt.month
        
        features = ['event_cause', 'event_type', 'priority', 'requires_road_closure', 
                    'hour', 'day_of_week', 'month']
        
        # Make sure all features exist
        for f in features:
            if f not in df.columns:
                df[f] = 0 if f not in ['event_cause', 'event_type', 'priority'] else 'unknown'
                
        df = df[features]
        
        # Encode
        categorical_cols = ['event_cause', 'event_type', 'priority']
        for col in categorical_cols:
            le = encoders.get(col)
            val = str(df[col].iloc[0])
            if val not in le.classes_:
                val = le.classes_[0]
            df[col] = le.transform([val])
            
        df['requires_road_closure'] = df['requires_road_closure'].astype(int)
        
        # Predict
        pred_encoded = model.predict(df)[0]
        severity = encoders['target'].inverse_transform([pred_encoded])[0]
        
        recommendations = recommend_resources(severity)
        
        return {
            "predicted_severity": severity,
            "recommendations": recommendations,
            "received_lat": event.latitude,
            "received_lng": event.longitude
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/")
async def root():
    # Redirect root to the static index.html
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
