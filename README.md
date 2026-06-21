# 🚦 FlowCast — Intelligent Event-Driven Traffic Impact Forecaster

> **FlowCast** is a machine-learning-powered web application that predicts the traffic impact severity of real-world road events (accidents, construction, water-logging, etc.) and automatically recommends the optimal resource allocation (manpower, barricading, diversion plans) to manage congestion efficiently.

---

## ✨ Features

- 🗺️ **Interactive Leaflet Map** — Features a Leaflet.js interactive map with OpenStreetMap and Geocoder search integration.
- 🤖 **ML-Based Severity Prediction** — Random Forest model trained on historical event data to predict impact severity.
- 📊 **Resource Allocation Engine** — Rule-based recommendations (Manpower, Barricading, Diversion) based on predicted severity.
- ⚡ **Real-Time REST API** — FastAPI backend serving predictions.
- 🎨 **Modern Premium UI** — Responsive, animated bright frontend with modal pop-up results.

---

## 🛠 Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Backend    | Python 3.9+, FastAPI, Uvicorn     |
| ML / Data  | scikit-learn, pandas, numpy, joblib |
| Frontend   | HTML5, CSS3, JavaScript           |
| Map        | Leaflet.js, OpenStreetMap         |

---

## 🚀 Local Setup & Running

### Step 1 — Clone & Environment
```bash
git clone https://github.com/RaviBaskey/Event-Driven-Congestion.git FlowCast
cd FlowCast

# Create and activate a virtual environment
python -m venv venv
# On Windows: .\venv\Scripts\activate
# On Mac/Linux: source venv/bin/activate
```

### Step 2 — Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 3 — Train the Model (Optional)
If `impact_model.pkl` and `encoders.pkl` do not exist, run the training script:
```bash
python train_model.py
```

### Step 4 — Start the Server
```bash
python app.py
```
Open your browser and navigate to `http://localhost:8000`.

---

## 📡 API Reference

### `POST /api/predict`
Predicts traffic impact severity for a given road event.

**Request Body Example:**
```json
{
  "event_cause": "vehicle_breakdown",
  "priority": "High",
  "start_datetime": "2026-06-20 18:30:00",
  "latitude": 12.9716,
  "longitude": 77.5946
}
```

**Response Example:**
```json
{
  "predicted_severity": "High",
  "recommendations": {
    "Manpower": "5+ Traffic Police Personnel",
    "Barricading": "Heavy Barricading Required",
    "DiversionPlan": "Major Route Diversion Needed"
  }
}
```

---