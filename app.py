from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import pandas as pd
import joblib
import os
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="FlowCast API", version="2.0.0")

# CORS — allow all origins for hackathon/dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the static directory
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# ──────────────────────────────────────────────
# Load Models
# ──────────────────────────────────────────────
MODEL_PATH   = 'impact_model.pkl'
ETR_PATH     = 'etr_model.pkl'
ENCODERS_PATH = 'encoders.pkl'

try:
    model      = joblib.load(MODEL_PATH)
    etr_model  = joblib.load(ETR_PATH)
    encoders   = joblib.load(ENCODERS_PATH)
    print("[OK] Severity classifier, ETR regressor, and encoders loaded successfully.")
except Exception as e:
    print(f"[WARN] Could not load models. Run train_model.py first. Error: {e}")
    model, etr_model, encoders = None, None, None

# ──────────────────────────────────────────────
# In-Memory Event Store
# ──────────────────────────────────────────────
# Each event: { id, event_cause, event_type, priority, requires_road_closure,
#               severity, etr_hours, lat, lng, reported_at, expires_at, reporter, status }
# status can be 'pending' or 'live'
active_events: List[dict] = []

# ──────────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────────
class EventInput(BaseModel):
    event_cause: str
    event_type: str = 'unplanned'
    priority: str = 'Low'
    requires_road_closure: bool = False
    start_datetime: str           # format: YYYY-MM-DD HH:MM:SS
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class ReportEventInput(BaseModel):
    event_cause: str
    event_type: str = 'unplanned'
    priority: str = 'Low'
    requires_road_closure: bool = False
    start_datetime: str
    latitude: float
    longitude: float

class ApproveEventInput(BaseModel):
    priority: str
    requires_road_closure: bool

# ──────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────
def recommend_resources(severity: str) -> dict:
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
    else:
        return {
            'Manpower': '1 Traffic Police Personnel',
            'Barricading': 'Not Required',
            'DiversionPlan': 'No Diversion Needed'
        }

def run_ml_pipeline(event_cause: str, event_type: str, priority: str,
                     requires_road_closure: bool, start_datetime: str):
    """Run both the severity classifier and ETR regressor."""
    if model is None or etr_model is None or encoders is None:
        raise HTTPException(status_code=500, detail="ML models are not loaded. Run train_model.py first.")

    df = pd.DataFrame([{
        'event_cause': event_cause,
        'event_type': event_type,
        'priority': priority,
        'requires_road_closure': requires_road_closure,
        'start_datetime': start_datetime
    }])

    dt = pd.to_datetime(df['start_datetime'].iloc[0])
    df['hour']        = dt.hour
    df['day_of_week'] = dt.dayofweek
    df['month']       = dt.month

    features = ['event_cause', 'event_type', 'priority', 'requires_road_closure',
                'hour', 'day_of_week', 'month']
    df = df[features]

    categorical_cols = ['event_cause', 'event_type', 'priority']
    for col in categorical_cols:
        le  = encoders.get(col)
        val = str(df[col].iloc[0])
        if val not in le.classes_:
            val = le.classes_[0]
        df[col] = le.transform([val])

    df['requires_road_closure'] = df['requires_road_closure'].astype(int)

    pred_encoded = model.predict(df)[0]
    severity = encoders['target'].inverse_transform([pred_encoded])[0]

    etr_raw   = float(etr_model.predict(df)[0])
    etr_hours = round(max(0.25, min(24.0, etr_raw)), 2)

    return severity, etr_hours

# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")

@app.get("/api/config")
async def get_config():
    """Return frontend configuration."""
    return {"TOMTOM_API_KEY": os.getenv("TOMTOM_API_KEY", "")}

@app.post("/api/report-event")
async def report_event(event: ReportEventInput):
    """Admin endpoint: predict severity + ETR, persist the event instantly as 'live'."""
    try:
        severity, etr_hours = run_ml_pipeline(
            event.event_cause, event.event_type, event.priority,
            event.requires_road_closure, event.start_datetime
        )

        now        = datetime.now(timezone.utc)
        expires_at = datetime.fromtimestamp(
            now.timestamp() + etr_hours * 3600, tz=timezone.utc
        )

        new_event = {
            "id":                   str(uuid.uuid4()),
            "event_cause":          event.event_cause,
            "event_type":           event.event_type,
            "priority":             event.priority,
            "requires_road_closure": event.requires_road_closure,
            "severity":             severity,
            "etr_hours":            etr_hours,
            "lat":                  event.latitude,
            "lng":                  event.longitude,
            "reported_at":          now.isoformat(),
            "expires_at":           expires_at.isoformat(),
            "recommendations":      recommend_resources(severity),
            "status":               "live"
        }

        active_events.append(new_event)
        return new_event

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/public-report")
async def public_report_event(event: ReportEventInput):
    """Public endpoint: creates an event with 'pending' status for Commander review. ML is skipped until physical verification."""
    try:
        now = datetime.now(timezone.utc)
        
        new_event = {
            "id":                   str(uuid.uuid4()),
            "event_cause":          event.event_cause,
            "event_type":           event.event_type,
            "priority":             "Pending",
            "requires_road_closure": False,
            "severity":             "Pending",
            "etr_hours":            0.0,
            "lat":                  event.latitude,
            "lng":                  event.longitude,
            "reported_at":          now.isoformat(),
            "expires_at":           now.isoformat(),
            "recommendations":      recommend_resources("Low"),
            "status":               "pending"
        }

        active_events.append(new_event)
        return new_event

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/events")
async def get_active_events():
    """Return all non-expired 'live' events."""
    now = datetime.now(timezone.utc)
    global active_events
    # Only prune live events that have expired; always keep pending events
    active_events = [
        ev for ev in active_events
        if ev["status"] == "pending" or datetime.fromisoformat(ev["expires_at"]) > now
    ]
    live = [ev for ev in active_events if ev["status"] == "live"]
    return {"events": live}

@app.get("/api/events/pending")
async def get_pending_events():
    """Return all pending events for admin review (never expire until approved/rejected)."""
    pending = [ev for ev in active_events if ev["status"] == "pending"]
    return {"events": pending}

@app.put("/api/events/{event_id}/approve")
async def approve_event(event_id: str, data: ApproveEventInput):
    """Admin endpoint: physically verify, run ML, and approve a pending event."""
    for ev in active_events:
        if ev["id"] == event_id and ev["status"] == "pending":
            
            # Run ML on verified data
            severity, etr_hours = run_ml_pipeline(
                ev["event_cause"], ev["event_type"], data.priority,
                data.requires_road_closure, ev["reported_at"].replace('T', ' ')[:19]
            )
            
            ev["priority"] = data.priority
            ev["requires_road_closure"] = data.requires_road_closure
            ev["severity"] = severity
            ev["etr_hours"] = etr_hours
            ev["recommendations"] = recommend_resources(severity)
            
            ev["status"] = "live"
            
            now = datetime.now(timezone.utc)
            ev["reported_at"] = now.isoformat()
            ev["expires_at"] = datetime.fromtimestamp(
                now.timestamp() + ev["etr_hours"] * 3600, tz=timezone.utc
            ).isoformat()
            
            return {"status": "approved", "event": ev}
            
    raise HTTPException(status_code=404, detail="Pending event not found")

@app.put("/api/events/{event_id}/reject")
async def reject_event(event_id: str):
    """Admin endpoint: reject and delete a pending event."""
    for i, ev in enumerate(active_events):
        if ev["id"] == event_id and ev["status"] == "pending":
            active_events.pop(i)
            return {"status": "rejected", "id": event_id}
    raise HTTPException(status_code=404, detail="Pending event not found")

@app.delete("/api/events/{event_id}")
async def dismiss_event(event_id: str):
    """Admin endpoint: manually dismiss/remove an active event."""
    for i, ev in enumerate(active_events):
        if ev["id"] == event_id:
            active_events.pop(i)
            return {"status": "dismissed", "id": event_id}
    raise HTTPException(status_code=404, detail="Event not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
