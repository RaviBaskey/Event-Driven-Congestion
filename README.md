# 🚦 FlowCast — Intelligent Event-Driven Traffic Impact Forecaster

> **FlowCast** is a machine-learning-powered web application that predicts the traffic impact severity of real-world road events (accidents, construction, water-logging, etc.) and automatically recommends the optimal resource allocation (manpower, barricading, diversion plans) to manage congestion efficiently.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Local Setup & Running](#-local-setup--running)
- [API Reference](#-api-reference)
- [How It Works](#-how-it-works)
- [Dataset](#-dataset)

---

## 🌟 Project Overview

FlowCast addresses the problem of **reactive traffic management** by replacing it with a **proactive, data-driven approach**. When a road event is reported, the system:

1. Takes event details as input (cause, priority, start time, location).
2. Uses a trained **Random Forest Classifier** to predict whether the event's traffic impact will be **High**, **Medium**, or **Low**.
3. Outputs a recommended **resource allocation plan** (personnel, barricading level, diversion routing).

The result is displayed on an interactive map-based web dashboard.

---

## ✨ Features

- 🗺️ **Interactive Map** — Click anywhere on the Leaflet.js map to pin event location (lat/lng).
- 🤖 **ML-Based Severity Prediction** — Random Forest model trained on historical event data.
- 📊 **Resource Allocation Engine** — Rule-based recommendations based on predicted severity.
- ⚡ **Real-Time REST API** — FastAPI backend serving predictions via `/api/predict`.
- 🎨 **Modern Glassmorphism UI** — Responsive, animated frontend with dark theme.

---

## 🛠 Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Backend    | Python 3.9+, FastAPI, Uvicorn     |
| ML / Data  | scikit-learn, pandas, numpy, joblib |
| Frontend   | HTML5, CSS3 (Vanilla), JavaScript |
| Map        | Leaflet.js v1.9.4                 |
| Fonts      | Google Fonts (Inter)              |

---

## 📁 Project Structure

```
FlowCast/
│
├── app.py               # FastAPI application — API routes & server entry point
├── train_model.py       # ML training pipeline (preprocessing + Random Forest)
├── predict.py           # Standalone CLI prediction script for testing
├── eda.py               # Exploratory Data Analysis helper script
│
├── dataset.csv          # Historical road event dataset (training data)
├── impact_model.pkl     # Trained Random Forest model (auto-generated)
├── encoders.pkl         # Label encoders for categorical features (auto-generated)
│
├── static/
│   ├── index.html       # Main web dashboard UI
│   ├── style.css        # Glassmorphism styling & animations
│   └── script.js        # Frontend logic, form handling, map & API calls
│
├── .gitignore
└── README.md
```

---

## ✅ Prerequisites

Ensure you have the following installed:

- **Python 3.9 or higher** — [Download](https://www.python.org/downloads/)
- **pip** (comes bundled with Python)

---

## 🚀 Local Setup & Running

Follow these steps in order:

### Step 1 — Clone the Repository

```bash
git clone <your-repository-url>
cd FlowCast
```

### Step 2 — Create a Virtual Environment (Recommended)

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### Step 3 — Install Dependencies

```bash
pip install fastapi uvicorn pandas numpy scikit-learn joblib
```

> **Note:** `dataset.csv`, `impact_model.pkl`, and `encoders.pkl` must be present in the project root.

### Step 4 — Train the Machine Learning Model

> ⚠️ **Run this step only once** (or whenever `dataset.csv` is updated). This generates `impact_model.pkl` and `encoders.pkl`. If these `.pkl` files are already present in the repository, you can skip to Step 5.

```bash
python train_model.py
```

**Expected output:**
```
Loading dataset...
Preprocessing data...
Generating proxy target 'impact_severity'...
Training Random Forest Classifier...
Evaluating Model...
Accuracy: 0.XX
Classification Report:
    ...
Saving model and encoders...
Done! Model saved as 'impact_model.pkl'
```

### Step 5 — Start the FastAPI Server

```bash
python app.py
```

Or equivalently using Uvicorn directly:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

**Expected output:**
```
Model and Encoders loaded successfully.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Step 6 — Open the Web App

Open your browser and navigate to:

```
http://localhost:8000
```

You will be redirected to the FlowCast dashboard at `http://localhost:8000/static/index.html`.

---

## 🧪 Testing Predictions via CLI

You can test predictions directly from the command line without the web UI:

```bash
python predict.py
```

This runs two pre-configured sample events:
1. **Vehicle breakdown + road closure during peak hours** → Expected: High severity
2. **Minor pothole early morning** → Expected: Low severity

---

## 📡 API Reference

### `POST /api/predict`

Predicts traffic impact severity for a given road event.

**Request Body (JSON):**

```json
{
  "event_cause": "vehicle_breakdown",
  "event_type": "unplanned",
  "priority": "High",
  "requires_road_closure": true,
  "start_datetime": "2024-03-07 18:30:00",
  "latitude": 12.9716,
  "longitude": 77.5946
}
```

| Field                  | Type    | Required | Description                                                               |
|------------------------|---------|----------|---------------------------------------------------------------------------|
| `event_cause`          | string  | ✅       | `vehicle_breakdown`, `tree_fall`, `water_logging`, `pot_holes`, `public_event`, `construction`, `accident`, `others` |
| `event_type`           | string  | ❌       | `unplanned` (default) or `planned`                                        |
| `priority`             | string  | ❌       | `Low` (default) or `High`                                                 |
| `requires_road_closure`| boolean | ❌       | `false` (default) or `true`                                               |
| `start_datetime`       | string  | ✅       | Format: `YYYY-MM-DD HH:MM:SS`                                             |
| `latitude`             | float   | ❌       | Geographic latitude of the event                                          |
| `longitude`            | float   | ❌       | Geographic longitude of the event                                         |

**Success Response (200):**

```json
{
  "predicted_severity": "High",
  "recommendations": {
    "Manpower": "5+ Traffic Police Personnel",
    "Barricading": "Heavy Barricading Required",
    "DiversionPlan": "Major Route Diversion Needed"
  },
  "received_lat": 12.9716,
  "received_lng": 77.5946
}
```

**Error Response (500):**
```json
{
  "detail": "Machine learning models are not loaded."
}
```

---

## ⚙️ How It Works

```
User Input (Web Form)
        ↓
  FastAPI Backend (/api/predict)
        ↓
  Feature Engineering
  (extract hour, day_of_week, month from datetime)
        ↓
  Label Encoding
  (event_cause, event_type, priority → numeric)
        ↓
  Random Forest Classifier
  (impact_model.pkl)
        ↓
  Decode Prediction → "High" / "Medium" / "Low"
        ↓
  Rule-Based Resource Recommender
        ↓
  JSON Response → Frontend Dashboard
```

### Severity Classification Logic (Training)

The proxy target `impact_severity` is derived from historical data:

| Condition                                          | Severity |
|----------------------------------------------------|----------|
| `requires_road_closure == True` OR `duration > 4h` | **High** |
| `priority == 'High'` OR `duration > 1.5h`          | **Medium** |
| Otherwise                                          | **Low**  |

### Model Features

| Feature                | Description                        |
|------------------------|------------------------------------|
| `event_cause`          | Type/cause of the road event       |
| `event_type`           | Planned vs. unplanned              |
| `priority`             | Operator-assigned priority         |
| `requires_road_closure`| Whether road closure is needed     |
| `hour`                 | Hour of day the event started      |
| `day_of_week`          | Day of the week (0=Mon, 6=Sun)     |
| `month`                | Month of the year                  |

---

## 📊 Dataset

The `dataset.csv` file contains historical road event records with the following key columns:

| Column                 | Description                             |
|------------------------|-----------------------------------------|
| `start_datetime`       | Event start timestamp                   |
| `closed_datetime`      | Event resolution timestamp              |
| `event_cause`          | Root cause of the event                 |
| `event_type`           | `planned` or `unplanned`                |
| `priority`             | Priority level assigned to the event    |
| `requires_road_closure`| Boolean flag for road closure necessity |
| `corridor`             | Road corridor/zone identifier           |

---

## 📝 License

This project was developed as part of the **Flipkart Grid 6.0** engineering challenge.
